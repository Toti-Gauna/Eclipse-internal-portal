import { buildSeed, SETTINGS } from "./seed.js";

const KEY = "eclipse-ops-v1";

export function load() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* Sin storage o datos ilegibles: se arranca con los ejemplos sin pisar lo guardado. */ }
  const seed = buildSeed();
  // Primera visita: se guardan los ejemplos para que sus fechas relativas queden fijas.
  if (!raw) save(seed);
  return seed;
}

export function save(data) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function reset() {
  const data = buildSeed();
  save(data);
  return data;
}

/** Valida un respaldo importado; lanza un error legible si no tiene la forma esperada. */
export function normalize(input) {
  if (!input || typeof input !== "object") throw new Error("El archivo no es un respaldo de Eclipse.");
  for (const key of ["prospects", "batches", "projects", "payments", "subscriptions"]) {
    if (!Array.isArray(input[key])) throw new Error(`Falta la lista "${key}" en el respaldo.`);
  }
  return { version: 1, ...input, settings: { ...SETTINGS, ...(input.settings || {}) } };
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
