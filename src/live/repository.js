// Repositorio del modo live: la ÚNICA fuente de verdad es el servidor. Carga y guarda en memoria (nunca en storage).
//
// Un "slice" es una porción de datos con nombre (y, opcionalmente, una clave: un id, un filtro). Cada módulo define los suyos
// con repo.define(nombre, { load(ctx, clave) }). El repositorio se ocupa de lo común:
//  - estado de carga/error por slice (idle | loading | ready | error) y datos viejos visibles mientras se actualiza;
//  - una sola carga en vuelo por slice (las repetidas comparten promesa) y cancelación de la anterior si se fuerza;
//  - descartar respuestas tardías si mientras tanto se cerró la sesión (época) o se pidió una carga más nueva;
//  - refresh() tras cada escritura confirmada, y notificación por lotes a la interfaz.
import { ApiError } from "../api/errors.js";

const IDLE = Object.freeze({ status: "idle", data: undefined, error: null, loadedAt: 0, refreshing: false, forbidden: false });

export function createRepository({ api, can = () => true, now = () => Date.now(), maxAgeMs = 60_000, concurrency = 3 } = {}) {
  const definitions = new Map();
  const entries = new Map();
  const inflight = new Map();
  const listeners = new Set();
  let epoch = 0;
  let notifyQueued = false;

  const keyOf = (name, key = "") => `${name}\u0000${key}`;

  function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      for (const listener of [...listeners]) listener();
    });
  }

  function set(name, key, patch) {
    const id = keyOf(name, key);
    entries.set(id, { ...(entries.get(id) || IDLE), ...patch });
    notify();
  }

  function define(name, definition) {
    if (definitions.has(name)) throw new Error(`El slice "${name}" ya está definido.`);
    definitions.set(name, definition);
  }

  const get = (name, key = "") => entries.get(keyOf(name, key)) || IDLE;
  const data = (name, key = "") => get(name, key).data;

  /**
   * Garantiza que el slice esté cargado. `force` ignora la caché y cancela la carga en vuelo.
   * Devuelve los datos; si falla, rechaza (el estado de error queda guardado para dibujarlo).
   */
  function ensure(name, key = "", { force = false, maxAge = maxAgeMs } = {}) {
    const definition = definitions.get(name);
    if (!definition) return Promise.reject(new Error(`Slice desconocido: ${name}`));
    const id = keyOf(name, key);
    const current = get(name, key);
    if (definition.permission && !can(definition.permission)) {
      set(name, key, { status: "ready", data: definition.forbiddenValue, forbidden: true, error: null });
      return Promise.resolve(definition.forbiddenValue);
    }
    const fresh = current.status === "ready" && !current.error && now() - current.loadedAt < maxAge;
    if (fresh && !force) return Promise.resolve(current.data);
    if (inflight.has(id) && !force) return inflight.get(id).promise;
    inflight.get(id)?.controller.abort();

    const controller = new AbortController();
    const token = Symbol(id);
    const startedAt = epoch;
    set(name, key, current.data === undefined ? { status: "loading", error: null } : { refreshing: true, error: null });
    const slot = { promise: null, controller, token };
    inflight.set(id, slot);
    slot.promise = (async () => {
      try {
        const value = await definition.load({ api, repo: facade, signal: controller.signal, can }, key);
        if (startedAt !== epoch || inflight.get(id)?.token !== token) return value;
        set(name, key, { status: "ready", data: value, error: null, loadedAt: now(), refreshing: false, forbidden: false });
        return value;
      } catch (error) {
        if (startedAt !== epoch || inflight.get(id)?.token !== token) throw error;
        if (error instanceof ApiError && error.code === "ABORTED") {
          set(name, key, { refreshing: false, ...(get(name, key).data === undefined ? { status: "idle" } : {}) });
          throw error;
        }
        const hasData = get(name, key).data !== undefined;
        set(name, key, { status: hasData ? "ready" : "error", error, refreshing: false });
        throw error;
      } finally {
        if (inflight.get(id)?.token === token) inflight.delete(id);
      }
    })();
    // La promesa guardada nunca queda sin manejar: quien la necesita la espera; la interfaz lee el estado.
    slot.promise.catch(() => {});
    return slot.promise;
  }

  /** Carga varios slices con la misma definición y una concurrencia acotada (no satura el límite de la API). */
  async function ensureAll(name, keys, options = {}) {
    const queue = [...keys];
    const results = new Map();
    async function worker() {
      while (queue.length) {
        const key = queue.shift();
        try { results.set(key, await ensure(name, key, options)); } catch (error) { results.set(key, error); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    return results;
  }

  /** Paginación acumulativa: la definición aporta `more(ctx, key, actual)` y devuelve los datos ya combinados. */
  async function more(name, key = "") {
    const definition = definitions.get(name);
    const current = get(name, key);
    if (!definition?.more || current.data === undefined) return current.data;
    const startedAt = epoch;
    set(name, key, { refreshing: true, error: null });
    try {
      const merged = await definition.more({ api, repo: facade, signal: undefined, can }, key, current.data);
      if (startedAt === epoch) set(name, key, { status: "ready", data: merged, refreshing: false, loadedAt: now() });
      return merged;
    } catch (error) {
      if (startedAt === epoch) set(name, key, { refreshing: false, error });
      throw error;
    }
  }

  /** Vuelve a pedir los slices indicados ([nombre, clave] o nombre). Los que nunca se cargaron se saltean. */
  async function refresh(targets) {
    const list = (targets || []).map((target) => (Array.isArray(target) ? target : [target, ""]));
    const unique = [...new Map(list.map(([name, key]) => [keyOf(name, key), [name, key ?? ""]])).values()];
    const results = await Promise.allSettled(unique.filter(([name, key]) => get(name, key).status !== "idle" || inflight.has(keyOf(name, key))).map(([name, key]) => ensure(name, key, { force: true })));
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  /** Marca como vencido sin tirar los datos (se reutilizan hasta que llegue la recarga). */
  function invalidate(name, key) {
    for (const [id, entry] of entries) {
      const [entryName, entryKey] = id.split("\u0000");
      if (entryName === name && (key === undefined || entryKey === key)) entries.set(id, { ...entry, loadedAt: 0 });
    }
  }

  /** Marca TODO como vencido (los datos siguen visibles): el próximo ensure() de cada pantalla los recarga. Se usa tras un 409. */
  function invalidateAll() {
    for (const [id, entry] of entries) entries.set(id, { ...entry, loadedAt: 0 });
  }

  /** Copia de lo cargado: { slice: { clave: datos } }. Solo para exportar lo que se está viendo. */
  function snapshot() {
    const result = {};
    for (const [id, entry] of entries) {
      if (entry.data === undefined || entry.forbidden) continue;
      const [name, key] = id.split("\u0000");
      (result[name] ||= {})[key || "_"] = entry.data;
    }
    return result;
  }

  /** Cierre de sesión o cambio de cuenta: nada de lo cargado sobrevive, y lo que viene en camino se descarta. */
  function clear() {
    epoch++;
    for (const { controller } of inflight.values()) controller.abort();
    inflight.clear();
    entries.clear();
    notify();
  }

  const isLoading = (name, key = "") => get(name, key).status === "loading" || get(name, key).refreshing;
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  const loadedKeys = (name) => [...entries.keys()].filter((id) => id.startsWith(`${name}\u0000`)).map((id) => id.split("\u0000")[1]);

  const facade = { define, get, data, ensure, ensureAll, more, refresh, invalidate, invalidateAll, snapshot, clear, subscribe, isLoading, loadedKeys };
  return facade;
}
