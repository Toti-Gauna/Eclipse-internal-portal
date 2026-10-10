// Cuerpos hacia /admin/planner/*. Mismo contrato que outbound.js: validan con mensajes en español (el servidor responde 400 genéricos)
// y devuelven { body } | { error }. Los esquemas del servidor son estrictos: no se mandan campos vacíos ni de más.
// Viven en su propio archivo para no tocar outbound.js, que comparten otros módulos.
import { isDay } from "./common.js";
import { minutesOf } from "./planner.js";

const CATEGORIES = ["operation", "sales", "project", "personal"];
const PRIORITIES = ["normal", "high"];
const EVENT_TYPES = ["call", "meeting", "follow_up", "milestone", "focus"];
const GOAL_STATUSES = ["open", "done", "cancelled"];
const EVENT_STATUSES = ["scheduled", "done", "cancelled"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const MAX_STEPS = 50;

const text = (value) => String(value ?? "").trim();
const bad = (error) => ({ error });

const hasControl = (value, multiline) => [...value].some((char) => { const code = char.charCodeAt(0); return code === 127 || (code < 32 && !(multiline && (code === 9 || code === 10 || code === 13))); });

function checkText(value, label, max, { required = false, multiline = false } = {}) {
  const v = text(value);
  if (!v) return required ? `${label}: completalo.` : "";
  if ([...v].length > max) return `${label}: máximo ${max} caracteres.`;
  if (hasControl(v, multiline)) return `${label}: tiene caracteres que no se pueden guardar.`;
  return "";
}

function checkDay(value, label, { required = false } = {}) {
  const v = text(value);
  if (!v) return required ? `${label}: elegí una fecha.` : "";
  if (!isDay(v) || new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) !== v) return `${label}: la fecha no es válida.`;
  if (v < "2020-01-01" || v > "2100-12-31") return `${label}: tiene que estar entre 2020 y 2100.`;
  return "";
}

const checkTime = (value, label) => (text(value) && !TIME.test(text(value)) ? `${label}: usá el formato HH:MM.` : "");
const firstError = (...errors) => errors.find(Boolean) || "";

/** "project:<uuid>" / "lead:<uuid>" → { refType, refId }; vacío → sin referencia. */
export function parseReference(value) {
  const v = text(value);
  if (!v) return { ref: null };
  const [type, id] = v.split(":");
  if (!["lead", "project"].includes(type) || !UUID.test(id || "")) return { error: "La referencia no es válida. Elegí un prospecto o un proyecto de la lista." };
  return { ref: { refType: type, refId: id } };
}

/** Un paso por línea, sin vacíos ni repetidos exactos. */
export function parseSteps(value) {
  const seen = new Set();
  const steps = [];
  for (const line of String(value ?? "").split("\n")) {
    const step = line.trim();
    if (!step || seen.has(step)) continue;
    seen.add(step);
    steps.push(step);
  }
  return steps;
}

// ---------- Metas ----------

export function goalCreateBody(values) {
  const ref = parseReference(values.reference);
  const steps = parseSteps(values.steps);
  const error = firstError(
    checkText(values.title, "Meta", 160, { required: true }),
    CATEGORIES.includes(values.category) ? "" : "Área: elegí una de la lista.",
    PRIORITIES.includes(values.priority || "normal") ? "" : "Prioridad: elegí normal o alta.",
    checkDay(values.due, "Día de la meta"),
    checkTime(values.time, "Hora"),
    text(values.time) && !text(values.due) ? "La hora necesita un día: elegí cuándo es la meta." : "",
    checkText(values.notes, "Contexto", 2000, { multiline: true }),
    ref.error || "",
    steps.length > MAX_STEPS ? `Pasos: máximo ${MAX_STEPS}.` : "",
    ...steps.map((step) => checkText(step, "Un paso", 160)),
  );
  if (error) return bad(error);
  const body = { title: text(values.title), category: values.category, priority: values.priority || "normal" };
  if (text(values.due)) body.dueOn = text(values.due);
  if (text(values.time)) body.dueTime = text(values.time);
  if (text(values.notes)) body.notes = text(values.notes);
  if (ref.ref) Object.assign(body, ref.ref);
  if (steps.length) body.steps = steps;
  return { body };
}

/** Solo manda lo que cambió (con la versión que se vio). Vaciar día, hora o contexto manda null. */
export function goalPatchBody(values, goal, { me = null } = {}) {
  const error = firstError(
    checkText(values.title, "Meta", 160, { required: true }),
    CATEGORIES.includes(values.category) ? "" : "Área: elegí una de la lista.",
    PRIORITIES.includes(values.priority || "normal") ? "" : "Prioridad: elegí normal o alta.",
    checkDay(values.due, "Día de la meta"),
    checkTime(values.time, "Hora"),
    text(values.time) && !text(values.due) ? "La hora necesita un día: elegí cuándo es la meta." : "",
    checkText(values.notes, "Contexto", 2000, { multiline: true }),
    // El servidor solo deja volver personal una meta propia: se frena antes de ir.
    values.category === "personal" && goal.category !== "personal" && me && goal.ownerAdminId !== me ? "Solo quien es responsable de la meta puede volverla personal." : "",
  );
  if (error) return bad(error);
  const body = { version: goal.version };
  const title = text(values.title);
  if (title !== goal.title) body.title = title;
  if (values.category !== goal.category) body.category = values.category;
  if ((values.priority || "normal") !== goal.priority) body.priority = values.priority || "normal";
  const due = text(values.due) || null;
  if (due !== goal.due) body.dueOn = due;
  const time = due ? text(values.time) || null : null;
  if (time !== goal.time) body.dueTime = time;
  const notes = text(values.notes) || null;
  if (notes !== (goal.notes || null)) body.notes = notes;
  if (Object.keys(body).length === 1) return bad("No cambiaste nada.");
  return { body };
}

export function goalStatusBody(goal, status) {
  if (!GOAL_STATUSES.includes(status)) return bad("Estado no válido.");
  if (status === "done" && goal.steps?.some((step) => !step.done)) return bad("Esta meta se completa sola cuando terminás todos sus pasos.");
  return { body: { version: goal.version, status } };
}

export function stepAddBody(values) {
  const error = checkText(values.title, "Paso", 160, { required: true });
  return error ? bad(error) : { body: { title: text(values.title) } };
}

export const stepSetBody = (done) => ({ body: { done: Boolean(done) } });

// ---------- Eventos ----------

function checkSchedule(values) {
  const time = text(values.time);
  const duration = text(values.duration);
  if (duration && !time) return "La duración necesita una hora de inicio.";
  if (!duration) return "";
  if (!/^\d{1,4}$/.test(duration) || Number(duration) < 1 || Number(duration) > 1440) return "Duración: entre 1 y 1440 minutos.";
  if (minutesOf(time) + Number(duration) > 1440) return "El evento no puede cruzar la medianoche: acortá la duración o adelantá la hora.";
  return "";
}

export function eventCreateBody(values) {
  const ref = parseReference(values.reference);
  const error = firstError(
    checkText(values.title, "Actividad", 160, { required: true }),
    EVENT_TYPES.includes(values.type) ? "" : "Tipo: elegí uno de la lista.",
    checkDay(values.date, "Día", { required: true }),
    checkTime(values.time, "Hora"),
    checkSchedule(values),
    checkText(values.notes, "Notas", 2000, { multiline: true }),
    ref.error || "",
  );
  if (error) return bad(error);
  const body = { title: text(values.title), type: values.type, onDate: text(values.date) };
  if (text(values.time)) body.startTime = text(values.time);
  if (text(values.duration)) body.durationMinutes = Number(text(values.duration));
  if (text(values.notes)) body.notes = text(values.notes);
  if (ref.ref) Object.assign(body, ref.ref);
  return { body };
}

export function eventPatchBody(values, event) {
  const error = firstError(
    checkText(values.title, "Actividad", 160, { required: true }),
    EVENT_TYPES.includes(values.type) ? "" : "Tipo: elegí uno de la lista.",
    checkDay(values.date, "Día", { required: true }),
    checkTime(values.time, "Hora"),
    checkSchedule(values),
    checkText(values.notes, "Notas", 2000, { multiline: true }),
  );
  if (error) return bad(error);
  const body = { version: event.version };
  if (text(values.title) !== event.title) body.title = text(values.title);
  if (values.type !== event.type) body.type = values.type;
  if (text(values.date) !== event.date) body.onDate = text(values.date);
  const time = text(values.time) || null;
  const duration = time && text(values.duration) ? Number(text(values.duration)) : null;
  if (time !== event.time) body.startTime = time;
  if (duration !== event.duration) body.durationMinutes = duration;
  const notes = text(values.notes) || null;
  if (notes !== (event.notes || null)) body.notes = notes;
  if (Object.keys(body).length === 1) return bad("No cambiaste nada.");
  return { body };
}

export function eventStatusBody(event, status) {
  if (!EVENT_STATUSES.includes(status)) return bad("Estado no válido.");
  return { body: { version: event.version, status } };
}

/** Los eventos de un día único: la API pide siempre un rango. */
export const dayRangeQuery = (day) => ({ from: day, to: day });
