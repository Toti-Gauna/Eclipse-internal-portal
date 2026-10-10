// Cliente HTTP del portal interno para la API de Eclipse (/api/v1).
// - Cookies HttpOnly de sesión (credentials: "include"); ningún token ni CSRF toca storage: el CSRF de sesión vive solo en memoria
//   y se recupera tras recargar con GET /auth/admin/csrf.
// - 401 en una llamada autenticada → UN refresh single-flight (POST /auth/admin/refresh) y UN reintento; si falla, sesión perdida.
// - 403 en una escritura → una vez, se vuelve a pedir el CSRF de sesión; si cambió, se reintenta (el servidor rechazó, no procesó).
// - Lecturas: un reintento ante cortes transitorios. Escrituras: solo si llevan Idempotency-Key (el reintento es seguro).
import { ApiError, errorFromResponse, isTransient } from "./errors.js";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createApiClient({ baseUrl, fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 15000, sleep = defaultSleep, onSessionLost = null } = {}) {
  if (!baseUrl) throw new Error("createApiClient necesita baseUrl.");
  const base = baseUrl.replace(/\/+$/, "");
  const state = { csrf: null, admin: null };
  let csrfLoading = null;
  let refreshing = null;

  function buildUrl(path, query) {
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    const text = params.toString();
    return text ? `${url}?${text}` : url;
  }

  /** Una sola llamada HTTP, sin políticas de sesión. Lanza ApiError ante cualquier falla. */
  async function rawFetch(method, path, { body, rawBody, contentType, asBlob = false, query, headers = {}, signal, timeout = timeoutMs, context = null } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      let response;
      try {
        response = await fetchImpl(buildUrl(path, query), {
          method,
          credentials: "include",
          cache: "no-store",
          headers: { Accept: asBlob ? "*/*" : "application/json", ...(rawBody !== undefined ? { "Content-Type": contentType } : body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
          body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch {
        const aborted = !timedOut && signal?.aborted;
        throw new ApiError({ code: timedOut ? "TIMEOUT" : aborted ? "ABORTED" : "NETWORK", context, unknownOutcome: method !== "GET" && !aborted });
      }
      if (asBlob && response.ok) {
        // Descarga binaria (documentos): el archivo viaja como Blob; los errores siguen siendo JSON.
        try {
          return { blob: await response.blob(), contentType: response.headers.get("Content-Type") || "", disposition: response.headers.get("Content-Disposition") || "" };
        } catch {
          throw new ApiError({ code: timedOut ? "TIMEOUT" : signal?.aborted ? "ABORTED" : "NETWORK", context });
        }
      }
      let text;
      try {
        text = await response.text();
      } catch {
        throw new ApiError({ code: timedOut ? "TIMEOUT" : signal?.aborted ? "ABORTED" : "NETWORK", context, unknownOutcome: method !== "GET" });
      }
      let data = null;
      let parsed = true;
      if (text) {
        try { data = JSON.parse(text); } catch { parsed = false; }
      }
      if (!response.ok) throw errorFromResponse(response, parsed ? data : null, { context, method });
      if (!parsed) throw new ApiError({ code: "INVALID_RESPONSE", status: response.status, context, unknownOutcome: method !== "GET" });
      return data;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  function loseSession(cause) {
    const had = state.csrf !== null || state.admin !== null;
    state.csrf = null;
    state.admin = null;
    if (had || cause) onSessionLost?.(cause || null);
  }

  const expired = (error) => new ApiError({ code: "UNAUTHORIZED", status: 401, requestId: error?.requestId || null, sessionExpired: true });

  /** CSRF de sesión: en memoria; si falta (recarga), se recupera. Una sola consulta a la vez. */
  async function ensureSessionCsrf(signal) {
    if (state.csrf) return state.csrf;
    if (!csrfLoading) {
      csrfLoading = (async () => {
        try {
          const data = await rawFetch("GET", "/auth/admin/csrf", { signal });
          if (typeof data?.csrfToken !== "string" || !data.csrfToken) throw new ApiError({ code: "INVALID_RESPONSE", status: 200 });
          state.csrf = data.csrfToken;
          return state.csrf;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) { loseSession(error); throw expired(error); }
          throw error;
        } finally { csrfLoading = null; }
      })();
    }
    return csrfLoading;
  }

  /** Renovación única y compartida: dos 401 simultáneos esperan el mismo refresh (rotarlo dos veces revoca la sesión). */
  function refreshSession() {
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const token = await ensureSessionCsrf();
          const data = await rawFetch("POST", "/auth/admin/refresh", { body: {}, headers: { "X-CSRF-Token": token } });
          if (data?.csrfToken) state.csrf = data.csrfToken;
          if (data?.admin) state.admin = data.admin;
        } catch (error) {
          if (error instanceof ApiError && !error.sessionExpired && [400, 401, 403].includes(error.status)) { loseSession(error); throw expired(error); }
          throw error;
        } finally { refreshing = null; }
      })();
    }
    return refreshing;
  }

  /**
   * Llamada con las políticas de sesión.
   * opciones: body, query, signal, timeout, idempotencyKey, auth (false para el login), csrf ("session" | "none" | token de preauth), context.
   */
  async function request(method, path, options = {}) {
    const { auth = true, idempotencyKey, context = null } = options;
    const writes = method !== "GET";
    const csrfMode = options.csrf ?? (writes ? "session" : "none");
    let refreshed = false;
    let csrfRetried = false;
    let transientRetried = false;
    for (;;) {
      try {
        const headers = { ...(options.headers || {}) };
        if (csrfMode === "session") headers["X-CSRF-Token"] = await ensureSessionCsrf(options.signal);
        else if (csrfMode !== "none") headers["X-CSRF-Token"] = csrfMode;
        if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
        return await rawFetch(method, path, { body: options.body, rawBody: options.rawBody, contentType: options.contentType, asBlob: options.asBlob, query: options.query, headers, signal: options.signal, timeout: options.timeout, context });
      } catch (error) {
        if (!(error instanceof ApiError) || error.sessionExpired) throw error;
        if (auth && error.status === 401 && !refreshed) { refreshed = true; await refreshSession(); continue; }
        if (csrfMode === "session" && error.status === 403 && !csrfRetried) {
          csrfRetried = true;
          const before = state.csrf;
          state.csrf = null;
          const fresh = await ensureSessionCsrf(options.signal).catch(() => null);
          if (fresh && fresh !== before) continue;
          if (before) state.csrf = before;
        }
        const retriable = isTransient(error) && !transientRetried && (!writes || (idempotencyKey && ["NETWORK", "TIMEOUT"].includes(error.code)));
        if (retriable && !options.signal?.aborted) { transientRetried = true; await sleep(350); continue; }
        throw error;
      }
    }
  }

  /** Paginación por cursor con tope duro: devuelve { items, truncated, pages }. */
  async function listAll(path, { query = {}, key, limit = 50, maxPages = 20, signal } = {}) {
    const items = [];
    let cursor;
    let pages = 0;
    do {
      const data = await request("GET", path, { query: { ...query, limit, cursor }, signal });
      if (!Array.isArray(data?.[key])) throw new ApiError({ code: "INVALID_RESPONSE", status: 200 });
      items.push(...data[key]);
      cursor = data.nextCursor || undefined;
      pages++;
    } while (cursor && pages < maxPages);
    return { items, truncated: Boolean(cursor), pages };
  }

  // ---- Ingreso en dos pasos (contraseña → código) ----
  async function preauthToken(signal) {
    const data = await rawFetch("GET", "/auth/csrf", { signal });
    if (typeof data?.csrfToken !== "string" || !data.csrfToken) throw new ApiError({ code: "INVALID_RESPONSE", status: 200 });
    return data.csrfToken;
  }

  /** POST con CSRF preauth; si el par anónimo venció (10 min, 403), se pide uno nuevo una vez. */
  async function preauthPost(path, body, context, signal) {
    for (let attempt = 0; ; attempt++) {
      const token = await preauthToken(signal);
      try {
        return await rawFetch("POST", path, { body, headers: { "X-CSRF-Token": token }, context, signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 403 && attempt === 0) continue;
        throw error;
      }
    }
  }

  function adopt(data) {
    if (!data?.admin || typeof data.csrfToken !== "string") throw new ApiError({ code: "INVALID_RESPONSE", status: 200 });
    state.admin = data.admin;
    state.csrf = data.csrfToken;
    return data.admin;
  }

  return {
    request,
    get: (path, options) => request("GET", path, options),
    post: (path, body, options) => request("POST", path, { ...options, body }),
    patch: (path, body, options) => request("PATCH", path, { ...options, body }),
    /** Sube un archivo tal cual (cuerpo binario con su propio Content-Type). Sin Idempotency-Key: nunca se reintenta solo. */
    upload: (path, file, options = {}) => request("POST", path, { ...options, rawBody: file, contentType: options.contentType || file.type, timeout: options.timeout ?? 60000 }),
    /** Descarga un archivo autenticado: devuelve { blob, contentType, disposition }. */
    download: (path, options = {}) => request("GET", path, { ...options, asBlob: true, timeout: options.timeout ?? 60000 }),
    listAll,
    get admin() { return state.admin; },
    get hasSessionCsrf() { return state.csrf !== null; },
    /** Paso 1. Devuelve { mfaRequired: true, expiresAt } o { admin } si la cuenta no exige código. */
    async login(email, password, { signal } = {}) {
      const data = await preauthPost("/auth/admin/login", { email, password }, "login", signal);
      if (data?.mfaRequired) return { mfaRequired: true, expiresAt: data.expiresAt };
      return { admin: adopt(data) };
    },
    /** Paso 2: el código de seis dígitos. */
    async verifyMfa(code, { signal } = {}) {
      return { admin: adopt(await preauthPost("/auth/admin/login/mfa", { code }, "mfa", signal)) };
    },
    /** Recupera la sesión tras recargar. null si no hay sesión; lanza ante fallas de red o permisos. */
    async restoreSession({ signal } = {}) {
      try {
        const data = await request("GET", "/auth/admin/me", { signal });
        state.admin = data.admin;
        await ensureSessionCsrf(signal);
        return state.admin;
      } catch (error) {
        if (error instanceof ApiError && (error.sessionExpired || error.status === 401)) return null;
        throw error;
      }
    },
    /** Cierra la sesión en el servidor y siempre limpia la memoria local, aunque el servidor no responda. */
    async logout() {
      let failure = null;
      try {
        if (state.admin || state.csrf) await request("POST", "/auth/admin/logout", { body: {}, auth: false });
      } catch (error) {
        failure = error;
      }
      state.csrf = null;
      state.admin = null;
      return { ok: !failure || failure.status === 401, error: failure };
    },
    /** Olvida todo lo que haya en memoria (por ejemplo, al perder la sesión). */
    forget() { state.csrf = null; state.admin = null; },
  };
}
