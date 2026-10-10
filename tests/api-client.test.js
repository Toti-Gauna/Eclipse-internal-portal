import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../src/api/client.js";
import { ApiError, ERROR_MESSAGES } from "../src/api/errors.js";
import { createIdempotencyStore, newIdempotencyKey, UUID_V4 } from "../src/api/idempotency.js";
import { ADMIN, createFakeFetch, fail, noSleep, ok, reply } from "./support/fake-fetch.js";

const BASE = "https://api.test/api/v1";
const make = (routes, extra = {}) => {
  const fetchImpl = createFakeFetch(routes);
  return { fetchImpl, api: createApiClient({ baseUrl: BASE, fetchImpl, sleep: noSleep, ...extra }) };
};

test("el ingreso es en dos pasos con CSRF preauth y deja el CSRF de sesión solo en memoria", async () => {
  const storage = [];
  const guard = { setItem: (...args) => storage.push(args), getItem: () => null };
  globalThis.localStorage = guard;
  globalThis.sessionStorage = guard;
  const { api, fetchImpl } = make({
    "GET /auth/csrf": [ok({ csrfToken: "pre-1" }), ok({ csrfToken: "pre-2" })],
    "POST /auth/admin/login": ok({ mfaRequired: true, expiresAt: "2026-10-10T16:31:39.986Z" }),
    "POST /auth/admin/login/mfa": ok({ admin: ADMIN, csrfToken: "sess-1" }),
    "GET /projects-demo": ok({ fine: true }),
    "POST /admin/echo": ok({ done: true }),
  });
  const first = await api.login("admin@eclipse.test", "secreto-largo-1234");
  assert.deepEqual(first, { mfaRequired: true, expiresAt: "2026-10-10T16:31:39.986Z" });
  assert.equal(api.admin, null, "sin código no hay sesión");
  const second = await api.verifyMfa("123456");
  assert.equal(second.admin.email, "admin@eclipse.test");
  const calls = fetchImpl.calls;
  assert.deepEqual(calls.map((call) => call.key), ["GET /auth/csrf", "POST /auth/admin/login", "GET /auth/csrf", "POST /auth/admin/login/mfa"]);
  assert.equal(calls[1].headers["X-CSRF-Token"], "pre-1");
  assert.equal(calls[3].headers["X-CSRF-Token"], "pre-2", "el código usa un par CSRF anónimo nuevo");
  assert.deepEqual(calls[1].body, { email: "admin@eclipse.test", password: "secreto-largo-1234" });
  assert.deepEqual(calls[3].body, { code: "123456" });
  await api.post("/admin/echo", { a: 1 });
  assert.equal(fetchImpl.calls.at(-1).headers["X-CSRF-Token"], "sess-1");
  assert.ok(fetchImpl.calls.every((call) => call.credentials === "include"));
  assert.deepEqual(storage, [], "ningún token ni CSRF se guarda en storage");
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

test("un 429 en el código se explica como bloqueo y conserva la espera sugerida", async () => {
  const { api } = make({
    "GET /auth/csrf": ok({ csrfToken: "pre" }),
    "POST /auth/admin/login/mfa": fail(429, "TOO_MANY_REQUESTS", undefined, { "Retry-After": "900" }),
  });
  await assert.rejects(api.verifyMfa("000000"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "TOO_MANY_REQUESTS");
    assert.match(error.message, /bloqueada/);
    assert.equal(error.retryAfter, 900);
    assert.match(error.describe(), /15 min/);
    return true;
  });
});

test("el par CSRF anónimo vencido se renueva una vez en el login", async () => {
  const { api, fetchImpl } = make({
    "GET /auth/csrf": [ok({ csrfToken: "viejo" }), ok({ csrfToken: "nuevo" })],
    "POST /auth/admin/login": [fail(403, "FORBIDDEN"), ok({ admin: ADMIN, csrfToken: "s" })],
  });
  const result = await api.login("a@b.co", "x".repeat(14));
  assert.equal(result.admin.id, ADMIN.id);
  assert.equal(fetchImpl.calls.filter((call) => call.key === "GET /auth/csrf").length, 2);
});

test("el mensaje de login incorrecto no revela si falló el email o la contraseña", async () => {
  const { api } = make({ "GET /auth/csrf": ok({ csrfToken: "p" }), "POST /auth/admin/login": fail(401, "UNAUTHORIZED") });
  await assert.rejects(api.login("a@b.co", "mala"), (error) => error.message === "Email o contraseña incorrectos." && Boolean(error.requestId));
});

test("dos 401 simultáneos comparten un único refresh y cada llamada se reintenta una vez", async () => {
  let refreshed = false;
  const { api, fetchImpl } = make({
    "GET /auth/admin/csrf": ok({ csrfToken: "sess" }),
    "POST /auth/admin/refresh": () => { refreshed = true; return ok({ admin: ADMIN, csrfToken: "sess-2" }); },
    "GET /admin/a": () => (refreshed ? ok({ a: 1 }) : fail(401, "UNAUTHORIZED")),
    "GET /admin/b": () => (refreshed ? ok({ b: 2 }) : fail(401, "UNAUTHORIZED")),
  });
  const [a, b] = await Promise.all([api.get("/admin/a"), api.get("/admin/b")]);
  assert.deepEqual([a, b], [{ a: 1 }, { b: 2 }]);
  assert.equal(fetchImpl.calls.filter((call) => call.key === "POST /auth/admin/refresh").length, 1);
  assert.deepEqual(fetchImpl.calls.find((call) => call.key === "POST /auth/admin/refresh").body, {});
  assert.equal(fetchImpl.calls.find((call) => call.key === "POST /auth/admin/refresh").headers["X-CSRF-Token"], "sess");
  assert.equal(fetchImpl.calls.filter((call) => call.key === "GET /admin/a").length, 2, "una vez y un reintento, nunca más");
});

test("si el refresh falla la sesión se pierde, se avisa y no se reintenta en bucle", async () => {
  const lost = [];
  const { api, fetchImpl } = make({
    "GET /auth/admin/csrf": ok({ csrfToken: "sess" }),
    "POST /auth/admin/refresh": fail(401, "UNAUTHORIZED"),
    "GET /admin/a": fail(401, "UNAUTHORIZED"),
  }, { onSessionLost: (cause) => lost.push(cause) });
  await assert.rejects(api.get("/admin/a"), (error) => error.sessionExpired === true && error.code === "UNAUTHORIZED");
  assert.equal(lost.length, 1);
  assert.equal(api.admin, null);
  assert.equal(fetchImpl.calls.filter((call) => call.key === "GET /admin/a").length, 1);
});

test("un 401 sin cookies al restaurar la sesión devuelve null", async () => {
  const { api } = make({ "GET /auth/admin/me": fail(401, "UNAUTHORIZED"), "GET /auth/admin/csrf": fail(401, "UNAUTHORIZED") });
  assert.equal(await api.restoreSession(), null);
});

test("restaurar la sesión lee el perfil y recupera el CSRF de sesión", async () => {
  const { api, fetchImpl } = make({ "GET /auth/admin/me": ok({ admin: ADMIN }), "GET /auth/admin/csrf": ok({ csrfToken: "recuperado" }), "POST /admin/x": ok({}) });
  assert.equal((await api.restoreSession()).email, ADMIN.email);
  await api.post("/admin/x", {});
  assert.equal(fetchImpl.calls.at(-1).headers["X-CSRF-Token"], "recuperado");
});

test("403 por CSRF viejo: se pide el CSRF de nuevo y se reintenta; 403 por permiso no se reintenta", async () => {
  let csrfCalls = 0;
  const { api, fetchImpl } = make({
    "GET /auth/admin/csrf": () => ok({ csrfToken: ++csrfCalls === 1 ? "viejo" : "nuevo" }),
    "POST /admin/w": (call) => (call.headers["X-CSRF-Token"] === "nuevo" ? ok({ ok: true }) : fail(403, "FORBIDDEN")),
    "POST /admin/prohibido": fail(403, "FORBIDDEN"),
  });
  assert.deepEqual(await api.post("/admin/w", {}), { ok: true });
  await assert.rejects(api.post("/admin/prohibido", {}), (error) => error.code === "FORBIDDEN" && error.isForbidden);
  assert.equal(fetchImpl.calls.filter((call) => call.key === "POST /admin/prohibido").length, 1, "el token no cambió: es un permiso, no se reintenta");
});

test("las lecturas reintentan una vez ante un corte; las escrituras sin clave nunca", async () => {
  const { api, fetchImpl } = make({
    "GET /admin/r": [new TypeError("fetch failed"), ok({ r: 1 })],
    "GET /auth/admin/csrf": ok({ csrfToken: "s" }),
    "POST /admin/w": new TypeError("fetch failed"),
    "POST /admin/k": [new TypeError("fetch failed"), ok({ replay: true })],
  });
  assert.deepEqual(await api.get("/admin/r"), { r: 1 });
  await assert.rejects(api.post("/admin/w", {}), (error) => error.code === "NETWORK" && error.unknownOutcome === true);
  assert.equal(fetchImpl.calls.filter((call) => call.key === "POST /admin/w").length, 1);
  assert.deepEqual(await api.post("/admin/k", {}, { idempotencyKey: "k" }), { replay: true });
  assert.equal(fetchImpl.calls.filter((call) => call.key === "POST /admin/k")[1].headers["Idempotency-Key"], "k", "el reintento conserva la misma clave");
});

test("un timeout corta la llamada y se informa", async () => {
  const { api } = make({ "GET /admin/lento": { hang: true } }, { timeoutMs: 20 });
  await assert.rejects(api.get("/admin/lento"), (error) => error.code === "TIMEOUT" && error.isNetwork);
});

test("cancelar con AbortSignal no es una falla de red", async () => {
  const { api } = make({ "GET /admin/lento": { hang: true } });
  const controller = new AbortController();
  const promise = api.get("/admin/lento", { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, (error) => error.code === "ABORTED");
});

test("listAll sigue el cursor, respeta limit<=50 y corta en el tope de páginas", async () => {
  const pages = (call) => ok({ items: [{ n: call.query.cursor ? Number(call.query.cursor) : 0 }], nextCursor: String((call.query.cursor ? Number(call.query.cursor) : 0) + 1) });
  const { api, fetchImpl } = make({ "GET /admin/l": pages });
  const result = await api.listAll("/admin/l", { key: "items", maxPages: 3, query: { status: "active", skip: "" } });
  assert.equal(result.items.length, 3);
  assert.equal(result.truncated, true);
  assert.equal(fetchImpl.calls[0].query.limit, "50");
  assert.equal(fetchImpl.calls[0].query.status, "active");
  assert.equal("skip" in fetchImpl.calls[0].query, false, "los filtros vacíos no viajan");
  assert.equal(fetchImpl.calls[1].query.cursor, "1");
});

test("listAll termina cuando no hay más cursor", async () => {
  const { api } = make({ "GET /admin/l": ok({ items: [{ a: 1 }], nextCursor: null }) });
  assert.deepEqual(await api.listAll("/admin/l", { key: "items" }), { items: [{ a: 1 }], truncated: false, pages: 1 });
});

test("los errores usan texto propio en español, el código y el requestId; nunca el texto del servidor", async () => {
  const { api } = make({ "GET /admin/x": fail(409, "CONFLICT", "22222222-2222-4222-8222-222222222222") });
  await assert.rejects(api.get("/admin/x"), (error) => {
    assert.equal(error.message, ERROR_MESSAGES.CONFLICT);
    assert.equal(error.requestId, "22222222-2222-4222-8222-222222222222");
    assert.match(error.describe(), /ref\. 22222222/);
    assert.equal(error.isConflict, true);
    return true;
  });
  for (const code of Object.keys(ERROR_MESSAGES)) assert.ok(new ApiError({ code }).message.length > 10);
});

test("una respuesta que no es JSON se informa como respuesta inválida", async () => {
  const fetchImpl = async () => new Response("<html>", { status: 200 });
  const api = createApiClient({ baseUrl: BASE, fetchImpl, sleep: noSleep });
  await assert.rejects(api.get("/admin/x"), (error) => error.code === "INVALID_RESPONSE");
});

test("cerrar sesión limpia la memoria aunque el servidor no responda", async () => {
  const { api } = make({ "POST /auth/admin/logout": new TypeError("down"), "GET /auth/admin/me": ok({ admin: ADMIN }), "GET /auth/admin/csrf": ok({ csrfToken: "s" }) });
  await api.restoreSession();
  assert.ok(api.admin);
  const result = await api.logout();
  assert.equal(api.admin, null);
  assert.equal(api.hasSessionCsrf, false);
  assert.equal(result.ok, false);
});

test("las claves de idempotencia son UUIDv4 y se reutilizan solo para el mismo envío", () => {
  assert.match(newIdempotencyKey(), UUID_V4);
  let n = 0;
  const store = createIdempotencyStore({ generate: () => `clave-${++n}` });
  const body = { amountCents: 100, kind: "deposit" };
  assert.equal(store.keyFor("pago:a", body), "clave-1");
  assert.equal(store.keyFor("pago:a", { kind: "deposit", amountCents: 100 }), "clave-1", "mismo cuerpo, aunque cambie el orden de claves");
  assert.equal(store.keyFor("pago:a", { ...body, amountCents: 200 }), "clave-2", "cuerpo distinto: es otro envío");
  store.settle("pago:a");
  assert.equal(store.keyFor("pago:a", { ...body, amountCents: 200 }), "clave-3", "tras confirmar, el próximo envío usa otra clave");
});

test("401 con status desconocido y 5xx quedan como INTERNAL_ERROR con resultado incierto en escrituras", async () => {
  const { api } = make({ "GET /auth/admin/csrf": ok({ csrfToken: "s" }), "POST /admin/w": reply(500, { error: { code: "INTERNAL_ERROR", message: "x" }, requestId: "r" }) });
  await assert.rejects(api.post("/admin/w", {}), (error) => error.code === "INTERNAL_ERROR" && error.unknownOutcome === true);
});
