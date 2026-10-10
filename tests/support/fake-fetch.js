// fetch falso para las pruebas: una tabla de rutas `"MÉTODO /ruta"` → respuesta, y el registro de llamadas.
export const reply = (status, body, headers = {}) => ({ status, body, headers });
export const ok = (body, headers) => reply(200, body, headers);
export const fail = (status, code, requestId = "11111111-1111-4111-8111-111111111111", headers = {}) =>
  reply(status, { error: { code, message: "x" }, requestId }, headers);

export function createFakeFetch(routes, { base = "https://api.test/api/v1" } = {}) {
  const calls = [];
  const queues = new Map();
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(new URL(base).pathname, "") || "/";
    const key = `${init.method || "GET"} ${path}`;
    const call = { key, method: init.method || "GET", path, query: Object.fromEntries(parsed.searchParams), headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined, credentials: init.credentials, signal: init.signal };
    calls.push(call);
    let handler = routes[key];
    if (Array.isArray(handler)) {
      const index = queues.get(key) ?? 0;
      queues.set(key, index + 1);
      handler = handler[Math.min(index, handler.length - 1)];
    }
    if (typeof handler === "function") handler = await handler(call, calls);
    if (handler instanceof Error) throw handler;
    if (!handler) throw new Error(`Sin ruta para ${key}`);
    if (handler.hang) {
      await new Promise((resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    }
    const status = handler.status ?? 200;
    const text = handler.body === undefined || status === 204 ? "" : JSON.stringify(handler.body);
    return new Response(text || null, { status, headers: { "Content-Type": "application/json", ...(handler.headers || {}) } });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

export const ADMIN = { id: "0e2e0e2e-0e2e-4e2e-8e2e-0e2e0e2e0e2e", email: "admin@eclipse.test", permissions: ["auth:read", "projects:read", "projects:write", "billing:read", "billing:write", "requests:read", "requests:review", "updates:send", "clients:read"], mfa: true };
export const noSleep = () => Promise.resolve();
