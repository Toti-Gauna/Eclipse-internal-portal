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
  const seed = normalize(buildSeed());
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
  const data = normalize(buildSeed());
  save(data);
  return data;
}

export function clear() {
  const data = normalize(emptyData());
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
  for (const key of ["goals", "calendarEvents", "audit"]) {
    if (input[key] !== undefined && !Array.isArray(input[key])) throw new Error(`La lista "${key}" no es válida.`);
  }
  const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime()) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  const validTime = (value) => !value || (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
  const goals = input.goals || [];
  const calendarEvents = input.calendarEvents || [];
  for (const goal of goals) {
    if (!goal || typeof goal.id !== "string" || typeof goal.title !== "string" || !validDate(goal.due) || !validTime(goal.time) || !Array.isArray(goal.steps) || goal.steps.some((step) => !step || typeof step.id !== "string" || typeof step.title !== "string" || typeof step.done !== "boolean")) throw new Error("Una meta del respaldo tiene datos inválidos.");
  }
  for (const event of calendarEvents) {
    if (!event || typeof event.id !== "string" || typeof event.title !== "string" || !validDate(event.date) || typeof event.time !== "string" || !event.time || !validTime(event.time) || !Number.isFinite(event.duration) || event.duration <= 0) throw new Error("Un evento del calendario tiene datos inválidos.");
  }
  if ((input.audit || []).some((entry) => !entry || typeof entry.id !== "string" || typeof entry.title !== "string" || !validDate(entry.date) || !validTime(entry.time))) throw new Error("La bitácora del respaldo tiene datos inválidos.");
  return {
    ...input,
    version: 3,
    example: !!input.example,
    settings: { ...SETTINGS, ...(input.settings || {}) },
    projects: input.projects.map(migrateProject),
    goals,
    calendarEvents,
    audit: input.audit || [],
  };
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
