import { buildSeed, emptyData, SETTINGS } from "./seed.js";

const KEY = "eclipse-ops-v2";
const LEGACY_KEY = "eclipse-ops-v1";

export function load() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = normalize(JSON.parse(legacy));
      save(migrated);
      return migrated;
    }
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

export function clear() {
  const data = emptyData();
  save(data);
  return data;
}

// Etapas internas de la v1 → etapas públicas del portal (las mismas que ve el cliente).
const V1_STAGES = { build: "build", qa: "eclipseReview", entrega: "delivery", cobro: "delivery", referido: "delivery", cerrado: "closed" };

function migrateProject(project) {
  if (!V1_STAGES[project.stage] || project.history) return project;
  const stage = V1_STAGES[project.stage];
  return {
    code: "", service: "", maintenance: 0, clientAction: null, referral: project.referral || null, pausedIn: null,
    ...project,
    stage,
    history: [{ stage: "preparation", start: project.startedAt }, ...(stage === "preparation" ? [] : [{ stage, start: project.startedAt }])],
    milestone: project.deliveryDate && !project.deliveredAt ? { title: "Entrega", owner: "Eclipse", due: project.deliveryDate } : null,
    deliveryEstimate: project.deliveryDate || null,
    updates: [],
  };
}

/** Valida un respaldo importado (v1 o v2); lanza un error legible si no tiene la forma esperada. */
export function normalize(input) {
  if (!input || typeof input !== "object") throw new Error("El archivo no es un respaldo de Eclipse.");
  for (const key of ["prospects", "batches", "projects", "payments", "subscriptions"]) {
    if (!Array.isArray(input[key])) throw new Error(`Falta la lista "${key}" en el respaldo.`);
  }
  return {
    ...input,
    version: 2,
    example: !!input.example,
    settings: { ...SETTINGS, ...(input.settings || {}) },
    projects: input.projects.map(migrateProject),
  };
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
