// Planificador, indicadores y auditoría: de la API al modelo de vista (y las cuentas que el portal hace sobre lo ya cargado).
// Reglas: los días son YYYY-MM-DD de la operación y las horas HH:MM; nunca se inventa una hora. Lo que el servidor no trae, no se calcula.
import { monthCells } from "../../planner.js";
import { addDays } from "../../rules.js";
import { dayOfInstant, formatCents, shortId, timeOfInstant } from "./common.js";

export const GOAL_CATEGORY_LABELS = Object.freeze({ operation: "Operación", sales: "Ventas", project: "Proyecto", personal: "Personal" });
export const GOAL_PRIORITY_LABELS = Object.freeze({ normal: "Normal", high: "Alta" });
export const GOAL_STATUS_LABELS = Object.freeze({ open: "Abierta", done: "Completada", cancelled: "Cancelada" });
export const EVENT_TYPE_LABELS = Object.freeze({ call: "Llamada", meeting: "Reunión", follow_up: "Seguimiento", milestone: "Hito", focus: "Bloque de foco" });
export const EVENT_STATUS_LABELS = Object.freeze({ scheduled: "Agendado", done: "Completado", cancelled: "Cancelado" });
export const AGENDA_TYPE_LABELS = Object.freeze({
  lead_next_action: "Próxima acción", lead_review: "Revisar prospecto pausado", proposal_touch: "Toque de propuesta",
  batch_signal: "Señal de lote", batch_close: "Cierre de lote", goal_due: "Meta", calendar_event: "Evento",
});
export const LEAD_SOURCE_LABELS = Object.freeze({
  referral: "Referido", community: "Comunidad", in_person: "Presencial", outbound_batch: "Lote", inbound_form: "Formulario web",
  plan_builder: "Armador de planes", demo_request: "Pedido de demo", manual: "Carga manual", other: "Otro",
});
export const AUDIT_RESULT_LABELS = Object.freeze({ success: "Hecho", denied: "Rechazado", failed: "Falló" });

const pad = (n) => String(n).padStart(2, "0");
export const minutesOf = (time) => { const [h, m] = String(time || "").split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
export const timeOfMinutes = (total) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

// ---------- Metas ----------

export function goalProgress(steps, status) {
  const total = steps.length;
  const done = steps.filter((step) => step.done).length;
  const completed = status === "done";
  return { done, total, completed, pct: total ? Math.round((done / total) * 100) : completed ? 100 : 0 };
}

/** Meta de la API → fila/ficha. `me` es el id del administrador logueado (para distinguir lo propio de lo del equipo). */
export function adaptGoal(api, { me = null } = {}) {
  const steps = [...(api.steps || [])].sort((a, b) => a.position - b.position).map((step) => ({ id: step.id, title: step.title, position: step.position, done: Boolean(step.doneAt), doneAt: step.doneAt || null }));
  return {
    id: api.id,
    title: api.title,
    category: api.category,
    categoryLabel: GOAL_CATEGORY_LABELS[api.category] || api.category,
    priority: api.priority,
    high: api.priority === "high",
    due: api.dueOn || null,
    time: api.dueTime || null,
    notes: api.notes || "",
    status: api.status,
    statusLabel: GOAL_STATUS_LABELS[api.status] || api.status,
    refType: api.refType || null,
    refId: api.refId || null,
    ownerAdminId: api.ownerAdminId,
    mine: Boolean(me) && api.ownerAdminId === me,
    completedAt: api.completedAt || null,
    isExample: Boolean(api.isExample),
    version: api.version,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
    steps,
    progress: goalProgress(steps, api.status),
  };
}

/** Filtros de la lista de Mi plan. `today` es el día operativo. */
export const GOAL_VIEWS = [
  ["hoy", "Hoy y pendientes"],
  ["proximas", "Próximas"],
  ["completadas", "Completadas"],
  ["canceladas", "Canceladas"],
  ["todas", "Todas"],
];

export function goalMatches(goal, view, today) {
  if (view === "hoy") return goal.status === "open" && (!goal.due || goal.due <= today);
  if (view === "proximas") return goal.status === "open" && Boolean(goal.due) && goal.due > today;
  if (view === "completadas") return goal.status === "done";
  if (view === "canceladas") return goal.status === "cancelled";
  return true;
}

export const sortGoals = (list) => [...list].sort((a, b) => (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31") || (a.time || "23:59").localeCompare(b.time || "23:59") || a.title.localeCompare(b.title));

// ---------- Eventos ----------

export function adaptEvent(api, { me = null } = {}) {
  const start = api.startTime ? minutesOf(api.startTime) : null;
  const duration = Number.isInteger(api.durationMinutes) ? api.durationMinutes : null;
  return {
    id: api.id,
    title: api.title,
    type: api.type,
    typeLabel: EVENT_TYPE_LABELS[api.type] || api.type,
    date: api.onDate,
    time: api.startTime || null,
    duration,
    endTime: start !== null && duration ? timeOfMinutes(Math.min(1440, start + duration)) : null,
    notes: api.notes || "",
    refType: api.refType || null,
    refId: api.refId || null,
    status: api.status,
    statusLabel: EVENT_STATUS_LABELS[api.status] || api.status,
    done: api.status === "done",
    cancelled: api.status === "cancelled",
    completedAt: api.completedAt || null,
    ownerAdminId: api.ownerAdminId,
    mine: Boolean(me) && api.ownerAdminId === me,
    isExample: Boolean(api.isExample),
    version: api.version,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

/**
 * Eventos agendados que se pisan con `candidate` (mismo día, ambos con hora). Se calcula SOLO sobre lo que se pasa (lo cargado):
 * no es una garantía del servidor. Un evento sin duración cuenta como un punto de un minuto. Los cancelados no molestan, y se
 * comparan solo eventos del mismo responsable (la agenda de otra persona no es un choque).
 */
export function eventOverlaps(events, candidate) {
  if (!candidate?.date || !candidate.time) return [];
  const start = minutesOf(candidate.time);
  if (start === null) return [];
  const end = start + Math.max(Number(candidate.duration) || 0, 1);
  return events.filter((event) => {
    if (event.id === candidate.id || event.cancelled || event.date !== candidate.date || !event.time) return false;
    if (candidate.ownerAdminId && event.ownerAdminId && event.ownerAdminId !== candidate.ownerAdminId) return false;
    const from = minutesOf(event.time);
    if (from === null) return false;
    const to = from + Math.max(event.duration || 0, 1);
    return start < to && from < end;
  });
}

/** "10:00–10:30" / "10:00" / "Todo el día". */
export const timeRange = (event) => (event.time ? (event.endTime ? `${event.time}–${event.endTime}` : event.time) : "Todo el día");

// ---------- Rangos ----------

export const rangeKey = (from, to) => `${from}..${to}`;
export function parseRange(key) {
  const [from, to] = String(key).split("..");
  return { from, to };
}

/** Los 42 (o 35) días que dibuja el mes en la grilla: la API acepta hasta 120 días. */
export function monthGrid(month) {
  const list = monthCells(month);
  return { from: list[0].date, to: list[list.length - 1].date };
}

/** Período de los indicadores. `7` = últimos 7 días (hoy incluido), `30` = últimos 30, `mes` = del 1 a hoy. */
export function periodRange(period, today) {
  if (period === "30") return { from: addDays(today, -29), to: today };
  if (period === "mes") return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: addDays(today, -6), to: today };
}
export const PERIODS = [["7", "Últimos 7 días"], ["30", "Últimos 30 días"], ["mes", "Este mes"]];

// ---------- Agenda ----------

const AGENDA_ROUTE = { lead_next_action: "prospectos", lead_review: "prospectos", proposal_touch: "prospectos", batch_signal: "lotes", batch_close: "lotes", goal_due: "metas", calendar_event: "calendario" };

export function adaptAgendaItem(api, { me = null } = {}) {
  return {
    key: `${api.type}:${api.id}`,
    type: api.type,
    typeLabel: AGENDA_TYPE_LABELS[api.type] || api.type,
    id: api.id,
    title: api.title || "",
    // `detail` (el nombre del prospecto) llega en la respuesta aunque OpenAPI no lo documente; si falta, se cruza con la lista de prospectos.
    detail: typeof api.detail === "string" ? api.detail : "",
    date: api.on,
    time: api.time || null,
    overdue: Boolean(api.overdue),
    ownerAdminId: api.ownerAdminId || null,
    mine: Boolean(me) && api.ownerAdminId === me,
    route: AGENDA_ROUTE[api.type] || "hoy",
    href: `#${AGENDA_ROUTE[api.type] || "hoy"}/${encodeURIComponent(api.id)}`,
  };
}

/** Los ítems de operación (prospectos, lotes): metas y eventos se leen de sus propios endpoints, que traen más datos. */
export const isOperationItem = (item) => !["goal_due", "calendar_event"].includes(item.type);

// ---------- Indicadores ----------

export const INDICATORS = [
  { api: "newContacts", key: "new_contacts", label: "Contactos nuevos", unit: "prospectos con primer contacto" },
  { api: "conversationsOpened", key: "conversations", label: "Conversaciones abiertas", unit: "se abrieron en el período" },
  { api: "proposalsSent", key: "proposals", label: "Propuestas enviadas", unit: "registradas y no anuladas" },
  { api: "usdCollected", key: "collected", label: "USD cobrado", unit: "el número que decide" },
  { api: "warmShare", key: "warm_share", label: "Contactos tibios", unit: "referido · comunidad · presencial" },
];
export const INDICATOR_KEYS = INDICATORS.map((item) => item.key);

export function adaptIndicators(api) {
  const raw = api.indicators || {};
  const list = INDICATORS.map((meta) => {
    const item = raw[meta.api] || {};
    const restricted = Boolean(item.restricted);
    return {
      ...meta,
      restricted,
      requires: item.requires || null,
      value: restricted ? null : meta.key === "warm_share" ? (item.percent ?? null) : (Number.isFinite(item.value) ? item.value : null),
      definition: item.definition || "",
      source: item.source || "",
      // Datos propios de cada indicador (el servidor los trae junto al valor).
      openNow: Number.isFinite(item.openNow) ? item.openNow : null,
      leads: Number.isFinite(item.leads) ? item.leads : null,
      priceCents: Number.isFinite(item.priceCents) ? item.priceCents : null,
      maintenanceCents: Number.isFinite(item.maintenanceCents) ? item.maintenanceCents : null,
      warm: Number.isFinite(item.warm) ? item.warm : null,
      total: Number.isFinite(item.total) ? item.total : null,
    };
  });
  const pipeline = api.pipeline || {};
  return {
    period: api.period,
    timezone: api.timezone || "",
    asOf: api.asOf || null,
    includesExamples: Boolean(api.includesExamples),
    list,
    pipeline: pipeline.restricted ? { restricted: true, requires: pipeline.requires || "billing:read" } : { restricted: false, collectedCents: pipeline.collectedCents ?? null, promisedCents: pipeline.promisedCents ?? null, proposedOpenCents: pipeline.proposedOpenCents ?? null },
  };
}

/** Fila del desglose de un indicador → modelo común. Cada tipo trae lo suyo; lo que falte queda en null (nunca se inventa). */
export function adaptIndicatorItem(key, row) {
  if (key === "collected") {
    return { kind: "payment", id: row.paymentId, projectId: row.projectId, paymentKind: row.kind, amountCents: Number.isFinite(row.amountCents) ? row.amountCents : null, date: row.receivedOn || null, countsTowardBalance: row.countsTowardBalance !== false };
  }
  if (key === "proposals") {
    return { kind: "proposal", id: row.activityId, leadId: row.leadId, date: row.occurredOn || null, amountCents: Number.isFinite(row.amountCents) ? row.amountCents : null, batchId: row.batchId || null };
  }
  return {
    kind: "lead", id: row.leadId, leadId: row.leadId, name: row.contactName || "", source: row.source || "", sourceLabel: LEAD_SOURCE_LABELS[row.source] || row.source || "",
    warm: Boolean(row.warm), firstContactOn: row.firstContactOn || null, firstConversationOn: row.firstConversationOn || null,
  };
}

// ---------- Auditoría ----------

export const AUDIT_ACTION_LABELS = Object.freeze({
  "project.created": "Proyecto creado", "project.updated": "Proyecto editado", "project.stage_changed": "Cambio de etapa", "project.paused": "Proyecto pausado", "project.resumed": "Proyecto retomado", "project.closed": "Proyecto cerrado",
  "organization.created": "Organización creada", "member.added": "Acceso de cliente agregado", "member.removed": "Acceso de cliente quitado",
  "milestone.created": "Hito creado", "milestone.updated": "Hito editado", "milestone.completed": "Hito completado", "milestone.visibility_changed": "Visibilidad de un hito",
  "scope.versioned": "Alcance actualizado", "change_request.received": "Cambio solicitado", "change_request.priced": "Cambio evaluado", "change_request.accepted": "Cambio aceptado", "change_request.rejected": "Cambio rechazado",
  "payment.proposed": "Cobro propuesto", "payment.committed": "Cobro comprometido", "payment.collected": "Cobro registrado", "payment.voided": "Cobro anulado",
  "note.created": "Nota interna", "update.drafted": "Borrador de actualización", "update.created": "Actualización creada", "update.edited": "Actualización editada", "update.published": "Actualización publicada", "update.withdrawn": "Actualización retirada", "update.resolved": "Acción del cliente resuelta",
  "lead.created": "Prospecto creado", "lead.updated": "Prospecto editado", "lead.reassigned": "Responsable cambiado", "lead.stage_changed": "Cambio de etapa del prospecto", "lead.next_action_set": "Próxima acción definida",
  "lead.activity_added": "Contacto registrado", "lead.activity_voided": "Contacto anulado", "lead.proposal_amount": "Importe de propuesta", "lead.budget_set": "Presupuesto definido", "lead.consent_changed": "Consentimiento cambiado",
  "lead.marked_duplicate": "Marcado como duplicado", "lead.converted": "Convertido en proyecto", "lead.batch_assigned": "Sumado a un lote", "lead.batch_removed": "Sacado de un lote",
  "goal.created": "Meta creada", "goal.updated": "Meta editada", "goal.done": "Meta completada", "goal.open": "Meta reabierta", "goal.cancelled": "Meta cancelada", "goal.step_added": "Paso agregado", "goal.step_changed": "Paso actualizado",
  "event.created": "Evento creado", "event.updated": "Evento editado", "event.done": "Evento completado", "event.scheduled": "Evento reagendado", "event.cancelled": "Evento cancelado",
});
export const AUDIT_RESOURCE_LABELS = Object.freeze({ scope_version: "Alcance", project_member: "Acceso de cliente", project_issue: "Bloqueo o riesgo", project: "Proyecto", payment: "Cobro", milestone: "Hito", update: "Actualización", lead: "Prospecto", lead_budget: "Presupuesto", scope: "Alcance", change_request: "Cambio de alcance", member: "Acceso", organization: "Organización", goal: "Meta", calendar_event: "Evento", batch: "Lote" });

const AUDIT_FIELD_LABELS = { stage: "Etapa", status: "Estado", kind: "Tipo", state: "Estado", amountCents: "Monto", priceCents: "Precio", receivedOn: "Cobrado el", dueOn: "Vence", onDate: "Día", ownerAdminId: "Responsable", category: "Categoría", scopeVersion: "Alcance", steps: "Pasos", role: "Rol", origin: "Origen", reason: "Motivo" };
const AUDIT_VALUE_LABELS = {
  internal_note: "Nota interna", status_change: "Cambio de etapa", client_update: "Actualización", action_required: "Acción del cliente",
  deposit: "Seña", installment: "Cuota", final: "Saldo final", maintenance: "Mantenimiento",
  collected: "Cobrado", committed: "Comprometido", proposed: "Propuesto", voided: "Anulado",
  draft: "Borrador", published: "Publicada", internal: "Interna", withdrawn: "Retirada",
  active: "Activo", paused: "En pausa", closed: "Cerrado", new: "Nuevo", historical: "Histórico",
  preparation: "Preparación", build: "Construcción", eclipse_review: "Revisión de Eclipse", client_review: "Revisión del cliente", delivery: "Entrega", support: "Soporte",
  client_admin: "Responsable del cliente", client_collaborator: "Colaborador del cliente",
  open: "Abierta", done: "Completada", cancelled: "Cancelada", scheduled: "Agendado",
};
const HIDDEN_AUDIT_FIELDS = new Set(["version"]);

/** Un valor de auditoría como texto legible. El dinero llega en centavos (solo si la cuenta tiene billing:read: el servidor ya filtra lo demás). */
export function auditValue(key, value) {
  if (value === null || value === undefined || value === "") return "";
  if (/Cents$/.test(key) && Number.isFinite(value)) return formatCents(value);
  return typeof value === "string" ? (AUDIT_VALUE_LABELS[value] || value) : String(value);
}

/** Diferencias entre `before` y `after` para mostrar en una línea: solo valores simples, máximo 4. */
export function auditChanges(before, after) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((key) => !HIDDEN_AUDIT_FIELDS.has(key));
  const simple = (value) => value === null || ["string", "number", "boolean"].includes(typeof value);
  const rows = [];
  for (const key of keys) {
    const from = before?.[key] ?? null;
    const to = after?.[key] ?? null;
    if (JSON.stringify(from) === JSON.stringify(to) || (from === null && to === "") || (from === "" && to === null)) continue;
    if (!simple(from) || !simple(to)) continue;
    rows.push({ field: key, label: AUDIT_FIELD_LABELS[key] || key, from, to, fromText: auditValue(key, from), toText: auditValue(key, to) });
  }
  return rows.slice(0, 4);
}

/** Evento de auditoría de la API → fila de la bitácora. El instante es UTC; la hora local se deriva SOLO si el instante existe. */
export function adaptAuditEvent(api, source) {
  const at = api.occurredAt && !Number.isNaN(new Date(api.occurredAt).getTime()) ? api.occurredAt : null;
  return {
    id: api.id,
    at,
    date: dayOfInstant(at),
    time: timeOfInstant(at),
    actorKind: api.actorKind,
    actorId: api.actorId || null,
    action: api.action,
    actionLabel: AUDIT_ACTION_LABELS[api.action] || api.action,
    resourceType: api.resourceType,
    resourceLabel: AUDIT_RESOURCE_LABELS[api.resourceType] || api.resourceType,
    resourceId: api.resourceId,
    result: api.result,
    resultLabel: AUDIT_RESULT_LABELS[api.result] || api.result,
    changes: auditChanges(api.before, api.after),
    source: { kind: source.kind, id: source.id, name: source.name || "" },
  };
}

/** Quién hizo el cambio: la API da solo el id de la cuenta (no su email). */
export function actorLabel(event, me) {
  if (event.actorKind === "system") return "Sistema";
  if (event.actorKind === "client") return `Cliente · cuenta ${shortId(event.actorId)}`;
  if (me && event.actorId === me) return "Vos";
  return `Administrador · cuenta ${shortId(event.actorId)}`;
}

/** Une los eventos de todas las fuentes, del más nuevo al más viejo; sin instante, al final. */
export function mergeAudit(sources) {
  return sources.flatMap((source) => source.events).sort((a, b) => (b.at || "").localeCompare(a.at || "") || b.id.localeCompare(a.id));
}
