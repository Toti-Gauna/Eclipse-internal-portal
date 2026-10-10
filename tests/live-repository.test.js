import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/api/errors.js";
import { createRepository } from "../src/live/repository.js";
import { createRegistry } from "../src/live/registry.js";
import { MODULES } from "../src/live/modules/index.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(load, extra = {}) {
  const repo = createRepository({ api: {}, can: extra.can || (() => true), now: extra.now, concurrency: 2 });
  repo.define("things", { load, more: extra.more, permission: extra.permission, forbiddenValue: extra.forbiddenValue });
  return repo;
}

test("una sola carga en vuelo por slice: las llamadas repetidas comparten la promesa", async () => {
  let calls = 0;
  const repo = setup(async () => { calls++; await tick(); return { n: calls }; });
  const [a, b] = await Promise.all([repo.ensure("things"), repo.ensure("things")]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(repo.get("things").status, "ready");
});

test("los datos frescos se reutilizan y force los vuelve a pedir manteniendo los viejos visibles", async () => {
  let calls = 0;
  const gate = deferred();
  const repo = setup(async () => { calls++; if (calls === 2) await gate.promise; return { n: calls }; });
  await repo.ensure("things");
  await repo.ensure("things");
  assert.equal(calls, 1, "la segunda llamada usa la caché");
  const refresh = repo.ensure("things", "", { force: true });
  assert.equal(repo.get("things").status, "ready", "mientras actualiza no vuelve a 'cargando'");
  assert.equal(repo.get("things").refreshing, true);
  assert.deepEqual(repo.data("things"), { n: 1 });
  gate.resolve();
  await refresh;
  assert.deepEqual(repo.data("things"), { n: 2 });
  assert.equal(repo.get("things").refreshing, false);
});

test("un error sin datos previos queda como 'error'; con datos previos se conservan y se informa el error", async () => {
  let fail = true;
  const repo = setup(async () => { if (fail) throw new ApiError({ code: "SERVICE_UNAVAILABLE", status: 503 }); return [1]; });
  await assert.rejects(repo.ensure("things"));
  assert.equal(repo.get("things").status, "error");
  assert.equal(repo.get("things").error.code, "SERVICE_UNAVAILABLE");
  fail = false;
  await repo.ensure("things", "", { force: true });
  assert.deepEqual(repo.data("things"), [1]);
  fail = true;
  await assert.rejects(repo.ensure("things", "", { force: true }));
  assert.equal(repo.get("things").status, "ready", "los datos viejos siguen visibles");
  assert.equal(repo.get("things").error.code, "SERVICE_UNAVAILABLE");
});

test("una respuesta tardía no pisa los datos si mientras tanto se cerró la sesión", async () => {
  const gate = deferred();
  const repo = setup(async () => { await gate.promise; return "datos de la sesión anterior"; });
  const pending = repo.ensure("things");
  repo.clear();
  gate.resolve();
  await pending;
  assert.equal(repo.get("things").status, "idle");
  assert.equal(repo.data("things"), undefined);
});

test("forzar una recarga cancela la carga anterior y gana la más nueva", async () => {
  const signals = [];
  const gates = [deferred(), deferred()];
  let n = 0;
  const repo = setup(async ({ signal }) => { const i = n++; signals.push(signal); await gates[i].promise; return `respuesta ${i}`; });
  const first = repo.ensure("things");
  const second = repo.ensure("things", "", { force: true });
  assert.equal(signals[0].aborted, true, "la anterior se aborta");
  gates[1].resolve();
  await second;
  gates[0].resolve();
  await first.catch(() => {});
  assert.equal(repo.data("things"), "respuesta 1");
});

test("refresh() solo recarga lo que ya estaba cargado y avisa a los suscriptores una vez por lote", async () => {
  let calls = 0;
  const repo = setup(async (ctx, key) => { calls++; return `${key}:${calls}`; });
  let notifications = 0;
  repo.subscribe(() => notifications++);
  await repo.ensure("things", "a");
  await repo.refresh([["things", "a"], ["things", "nunca-cargado"]]);
  assert.equal(calls, 2);
  assert.deepEqual(repo.loadedKeys("things"), ["a"]);
  await tick();
  assert.ok(notifications >= 1 && notifications <= 4);
});

test("ensureAll respeta la concurrencia máxima", async () => {
  let active = 0;
  let peak = 0;
  const repo = setup(async (ctx, key) => { active++; peak = Math.max(peak, active); await tick(); active--; return key; });
  const results = await repo.ensureAll("things", ["a", "b", "c", "d", "e"]);
  assert.equal(results.size, 5);
  assert.equal(peak, 2);
});

test("un slice sin el permiso necesario no llama a la API", async () => {
  let calls = 0;
  const repo = setup(async () => { calls++; return "x"; }, { can: () => false, permission: "billing:read", forbiddenValue: [] });
  assert.deepEqual(await repo.ensure("things"), []);
  assert.equal(calls, 0);
  assert.equal(repo.get("things").forbidden, true);
  assert.equal("things" in repo.snapshot(), false, "lo prohibido no se exporta");
});

test("more() acumula páginas con la definición del slice", async () => {
  const repo = setup(async () => ({ items: [1, 2], next: "c1" }), { more: async (ctx, key, current) => ({ items: [...current.items, 3], next: null }) });
  await repo.ensure("things");
  const merged = await repo.more("things");
  assert.deepEqual(merged, { items: [1, 2, 3], next: null });
  assert.deepEqual(repo.data("things"), merged);
});

test("invalidateAll deja los datos visibles pero obliga a recargar", async () => {
  let calls = 0;
  const repo = setup(async () => ++calls);
  await repo.ensure("things");
  repo.invalidateAll();
  assert.equal(repo.data("things"), 1);
  await repo.ensure("things");
  assert.equal(calls, 2);
});

test("el registro indexa módulos y rechaza duplicados", () => {
  const registry = createRegistry(MODULES);
  assert.ok(registry.module("proyectos"));
  assert.equal(registry.hasWizard("new-project"), true);
  assert.equal(registry.hasModal("payment-transition"), true);
  assert.ok(registry.mutation("request-review"));
  assert.deepEqual(registry.nav("main", () => true).map((item) => item.id), ["hoy", "solicitudes", "calendario", "prospectos", "lotes", "proyectos", "cobros", "comunicaciones"]);
  assert.equal(registry.nav("main", () => true).find((item) => item.id === "calendario").status, "pending");
  assert.equal(registry.nav("main", () => false).find((item) => item.id === "cobros").allowed, false);
  assert.throws(() => createRegistry([...MODULES, { id: "proyectos" }]), /duplicado/);
  assert.throws(() => createRegistry([{ id: "a", mutations: { x: () => {} } }, { id: "b", mutations: { x: () => {} } }]), /Mutación "x" duplicado/);
});

test("cada módulo no pendiente declara permisos, slices y pantallas coherentes", () => {
  const registry = createRegistry(MODULES);
  for (const module of registry.modules) {
    if (module.id === "core") continue;
    assert.equal(typeof module.render, "function", module.id);
    assert.equal(typeof module.prepare, "function", module.id);
  }
  const names = registry.sliceDefinitions().map(([name]) => name);
  assert.equal(new Set(names).size, names.length, "ningún slice se define dos veces");
  for (const name of ["projects", "project", "project.payments", "project.finance", "requests", "request", "catalog"]) assert.ok(names.includes(name), name);
});
