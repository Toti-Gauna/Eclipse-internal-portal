// Errores uniformes de la API. El backend responde { error: { code, message }, requestId } con mensajes genéricos en inglés;
// la interfaz muestra siempre texto propio en español rioplatense, nunca el texto del servidor.

export const ERROR_MESSAGES = Object.freeze({
  BAD_REQUEST: "El servidor no aceptó algunos datos. Revisá los campos y probá de nuevo.",
  UNAUTHORIZED: "Tu sesión venció o no es válida. Ingresá de nuevo.",
  FORBIDDEN: "Tu cuenta no tiene permiso para hacer esto.",
  NOT_FOUND: "No encontramos lo que buscás. Puede que ya no exista.",
  CONFLICT: "Esto cambió mientras lo mirabas, o ya no se puede hacer. Actualizamos los datos: revisalos y probá de nuevo.",
  PAYLOAD_TOO_LARGE: "El envío es demasiado grande. Acortá el texto y probá de nuevo.",
  TOO_MANY_REQUESTS: "Hiciste demasiados intentos. Esperá un momento antes de volver a probar.",
  SERVICE_UNAVAILABLE: "El servidor no está disponible ahora. Probá de nuevo en unos minutos.",
  INTERNAL_ERROR: "Algo falló en el servidor. Probá de nuevo; si sigue, pasá el código de referencia.",
  NETWORK: "No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.",
  TIMEOUT: "El servidor tardó demasiado en responder. Probá de nuevo.",
  ABORTED: "La consulta se canceló.",
  INVALID_RESPONSE: "El servidor respondió algo que no entendemos. Probá de nuevo; si sigue, pasá el código de referencia.",
});

/** Matices por contexto: el mismo código significa cosas distintas en el login que en el resto del portal. */
export const CONTEXT_MESSAGES = Object.freeze({
  login: {
    UNAUTHORIZED: "Email o contraseña incorrectos.",
    TOO_MANY_REQUESTS: "Demasiados intentos de ingreso. Esperá unos minutos antes de volver a probar.",
    FORBIDDEN: "No se pudo validar el ingreso. Recargá la página y probá de nuevo.",
  },
  mfa: {
    UNAUTHORIZED: "El código no es correcto, o el desafío venció. Probá con el código vigente de tu app o volvé a empezar.",
    NOT_FOUND: "El desafío de ingreso venció. Volvé a escribir tu email y contraseña.",
    CONFLICT: "Ese código ya se usó. Esperá al próximo código de tu app.",
    TOO_MANY_REQUESTS: "Cuenta bloqueada por intentos fallidos. Esperá unos 15 minutos antes de volver a probar.",
    FORBIDDEN: "No se pudo validar el código. Volvé a empezar.",
  },
});

const CODE_BY_STATUS = { 400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 429: "TOO_MANY_REQUESTS", 503: "SERVICE_UNAVAILABLE" };

export class ApiError extends Error {
  constructor({ code, status = 0, requestId = null, retryAfter = null, context = null, unknownOutcome = false, sessionExpired = false } = {}) {
    const known = ERROR_MESSAGES[code] ? code : "INTERNAL_ERROR";
    super(CONTEXT_MESSAGES[context]?.[known] || ERROR_MESSAGES[known]);
    this.name = "ApiError";
    this.code = known;
    this.status = status;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
    this.context = context;
    /** true cuando la escritura pudo haberse procesado (corte de red, timeout, 5xx): hay que verificar antes de reintentar con otra clave. */
    this.unknownOutcome = unknownOutcome;
    /** true cuando la sesión no se pudo renovar: la interfaz vuelve al ingreso. */
    this.sessionExpired = sessionExpired;
  }

  get isConflict() { return this.code === "CONFLICT"; }
  get isForbidden() { return this.code === "FORBIDDEN"; }
  get isNetwork() { return this.code === "NETWORK" || this.code === "TIMEOUT"; }

  /** Texto listo para mostrar: mensaje + espera sugerida + referencia para soporte. */
  describe() {
    const wait = this.retryAfter ? ` Reintentá en ${formatWait(this.retryAfter)}.` : "";
    const ref = this.requestId ? ` (ref. ${String(this.requestId).slice(0, 8)})` : "";
    return `${this.message}${wait}${ref}`;
  }
}

export function formatWait(seconds) {
  if (seconds < 90) return `${Math.max(1, Math.ceil(seconds))} s`;
  return `${Math.ceil(seconds / 60)} min`;
}

export function codeFromStatus(status) {
  return CODE_BY_STATUS[status] || (status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");
}

/** Construye el ApiError a partir de una respuesta HTTP ya leída. */
export function errorFromResponse(response, body, { context = null, method = "GET" } = {}) {
  const code = ERROR_MESSAGES[body?.error?.code] ? body.error.code : codeFromStatus(response.status);
  const retryHeader = Number(response.headers?.get?.("Retry-After"));
  return new ApiError({
    code,
    status: response.status,
    requestId: typeof body?.requestId === "string" ? body.requestId : response.headers?.get?.("X-Request-Id") || null,
    retryAfter: Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null,
    context,
    unknownOutcome: method !== "GET" && response.status >= 500 && response.status !== 503,
  });
}

/** Errores en los que reintentar la misma lectura tiene sentido. */
export const isTransient = (error) => error instanceof ApiError && (error.code === "NETWORK" || error.code === "TIMEOUT" || [502, 503, 504].includes(error.status));
