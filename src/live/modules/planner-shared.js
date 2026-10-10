// Piezas que comparten Hoy, Mi plan, Calendario, Herramientas y Bitácora: los slices del planificador, referencias a prospectos y
// proyectos, y cómo se vuelve a pedir lo que se vio después de una escritura. No tiene pantalla ni navegación.
import { adaptAgendaItem, adaptEvent, adaptGoal, parseRange } from "../adapters/planner.js";

/** Los estilos propios de estas pantallas viven en planner.css; se enlazan desde acá para no tocar index.html (archivo compartido). */
let styled = false;
export function injectStyles() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../../../planner.css", import.meta.url).href;
  document.head.appendChild(link);
}

/** Último contexto visto: las mutaciones (que no reciben el contexto de la pantalla) lo usan para ajustar filtros de la vista. */
let lastCtx = null;
export const remember = (ctx) => { lastCtx = ctx; injectStyles(); return ctx; };
export const currentCtx = () => lastCtx;

export const PLANNER_SLICES = {
  /** Todas las metas visibles para esta cuenta (propias, del equipo y las personales que son suyas). El servidor topa en 500. */
  "planner.goals": {
    permission: "planner:read",
    forbiddenValue: [],
    load: async ({ api, signal }) => {
      const me = api.admin?.id || null;
      return (await api.get("/admin/planner/goals", { signal })).goals.map((goal) => adaptGoal(goal, { me }));
    },
  },
  /** Eventos de un rango "YYYY-MM-DD..YYYY-MM-DD" (la API admite hasta 120 días). */
  "planner.events": {
    permission: "planner:read",
    forbiddenValue: [],
    load: async ({ api, signal }, key) => {
      const { from, to } = parseRange(key);
      const me = api.admin?.id || null;
      return (await api.get("/admin/planner/events", { query: { from, to }, signal })).events.map((event) => adaptEvent(event, { me }));
    },
  },
  /** Agenda del sistema: clave "desde..hasta|mine" o "|all". Trae además todo lo vencido anterior a `desde`. */
  "planner.agenda": {
    forbiddenValue: [],
    load: async ({ api, signal }, key) => {
      const [range, scope] = key.split("|");
      const { from, to } = parseRange(range);
      const me = api.admin?.id || null;
      const query = { from, to, ...(scope === "mine" && me ? { ownerAdminId: me } : {}) };
      return (await api.get("/admin/planner/agenda", { query, signal })).items.map((item) => adaptAgendaItem(item, { me }));
    },
  },
  /** Prospectos para elegir como referencia y para ponerle nombre a la agenda (la agenda trae solo el id). Hasta 200. */
  "planner.leads": {
    permission: "leads:read",
    forbiddenValue: { list: [], truncated: false },
    load: async ({ api, signal }) => {
      const { items, truncated } = await api.listAll("/admin/leads", { key: "leads", maxPages: 4, signal });
      return { list: items.map((lead) => ({ id: lead.id, name: lead.contactName, company: lead.company || "", stage: lead.stage, updatedAt: lead.updatedAt || null })), truncated };
    },
  },
};

/** Pide un slice una sola vez si nunca se pidió (sirve desde formularios, donde no corre prepare()). Un error no se reintenta solo. */
export function ensureOnce(ctx, slice, key = "", permission = null) {
  if (permission && !ctx.can(permission)) return;
  if (ctx.repo.get(slice, key).status === "idle") ctx.repo.ensure(slice, key).catch(() => {});
}

export const canPlan = (ctx) => ctx.can("planner:read");

// ---------- Lo cargado ----------

export const goalsOf = (ctx) => ctx.repo.data("planner.goals") || [];
export const findGoal = (ctx, id) => goalsOf(ctx).find((goal) => goal.id === id) || null;

/** Todos los eventos cargados, de todos los rangos, sin repetir (el más reciente por id). */
export function loadedEvents(repo) {
  const byId = new Map();
  for (const key of repo.loadedKeys("planner.events")) for (const event of repo.data("planner.events", key) || []) byId.set(event.id, event);
  return [...byId.values()];
}
export const findEvent = (repo, id) => loadedEvents(repo).find((event) => event.id === id) || null;

export function loadedAgenda(repo) {
  const byKey = new Map();
  for (const key of repo.loadedKeys("planner.agenda")) for (const item of repo.data("planner.agenda", key) || []) byKey.set(item.key, item);
  return [...byKey.values()];
}

const leadsOf = (repo) => repo.data("planner.leads")?.list || [];
const projectsOf = (repo) => repo.data("projects")?.list || [];

/** Nombre y enlace de lo que referencia una meta o un evento. Sin cargar, un nombre genérico con el código corto (nunca inventado). */
export function refInfo(repo, refType, refId) {
  if (!refType || !refId) return null;
  if (refType === "project") {
    const project = projectsOf(repo).find((item) => item.id === refId);
    return { label: project ? project.name : `Proyecto #${refId.slice(0, 8)}`, kind: "Proyecto", href: `#proyectos/${encodeURIComponent(refId)}` };
  }
  const lead = leadsOf(repo).find((item) => item.id === refId);
  return { label: lead ? lead.name : `Prospecto #${refId.slice(0, 8)}`, kind: "Prospecto", href: `#prospectos/${encodeURIComponent(refId)}` };
}

/** Opciones de "Vincular a…": solo lo que la cuenta puede leer (el servidor lo exige). */
export function refOptions(ctx) {
  const options = [];
  if (ctx.can("projects:read")) for (const project of projectsOf(ctx.repo)) options.push([`project:${project.id}`, `Proyecto · ${project.name}`]);
  if (ctx.can("leads:read")) for (const lead of leadsOf(ctx.repo)) options.push([`lead:${lead.id}`, `Prospecto · ${lead.name}${lead.company ? ` (${lead.company})` : ""}`]);
  return options;
}

// ---------- Después de escribir ----------

/** Lo que la pantalla tenía cargado: las metas, cada rango de eventos y cada agenda. */
export function plannerTargets(repo) {
  return [
    ["planner.goals", ""],
    ...repo.loadedKeys("planner.events").map((key) => ["planner.events", key]),
    ...repo.loadedKeys("planner.agenda").map((key) => ["planner.agenda", key]),
  ];
}

/** Para las mutaciones: se vuelve a pedir todo eso al terminar (aunque falle con 409). */
export function touchPlanner(h) {
  for (const target of plannerTargets(h.repo)) h.touch(target);
}
