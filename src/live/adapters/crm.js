// Prospectos y lotes: de la API (leads, actividades, lotes, auditoría) al modelo de vista del portal, y las reglas de la
// casa que se pueden calcular con datos del servidor (próxima acción sugerida, camino a la seña). Funciones puras, sin DOM.
//
// La API habla en etapas `prospect|conversation|demo|proposal|negotiation|won|lost|paused`; el vocabulario viejo del modo
// demostración (contactado, respondió, llamada, propuesta, ganado, perdido, pausado) se resume en docs/integration.md.
// Lo que el servidor no modela (unidad Agency/Media/Market, texto de oferta por prospecto) no se inventa.
import { addDays, diffDays } from "../../rules.js";
import { dayOfInstant, shortId, timeOfInstant } from "./common.js";

// ---------- Vocabulario ----------

export const LEAD_STAGES = Object.freeze(["prospect", "conversation", "demo", "proposal", "negotiation", "paused", "lost", "won"]);
export const OPEN_STAGES = Object.freeze(["prospect", "conversation", "demo", "proposal", "negotiation"]);
export const LEAD_STAGE_LABELS = Object.freeze({ prospect: "Prospecto", conversation: "Conversación", demo: "Demo", proposal: "Propuesta", negotiation: "Negociación", paused: "En pausa", lost: "Perdido", won: "Ganado" });
export const LEAD_STAGE_HINTS = Object.freeze({
  prospect: "Primer contacto registrado. Esperando respuesta.",
  conversation: "Respondió. Llamada el mismo día.",
  demo: "Demo hecha. Propuesta en ≤24 h.",
  proposal: "Propuesta enviada. Toques a +2, +5 y +9 días.",
  negotiation: "En negociación. Con acuerdo y seña cobrada se convierte en proyecto.",
  paused: "Con causa y fecha de revisión.",
  lost: "Cerrado con motivo.",
  won: "Es proyecto.",
});
/** Posición en el camino a la seña (1 de 5 … 5 de 5), el mismo lenguaje de fases del portal. */
export const STAGE_POSITION = Object.freeze({ prospect: 1, conversation: 2, demo: 3, proposal: 4, negotiation: 4, won: 5 });

export const SOURCES = Object.freeze({ referral: "Referido", community: "Comunidad", in_person: "Presencial", outbound_batch: "Lote (envío en frío)", inbound_form: "Formulario web", plan_builder: "Armador de planes", demo_request: "Pedido de demo", manual: "Carga manual", other: "Otro (por ejemplo Upwork)" });
export const WARM_SOURCES = Object.freeze(["referral", "community", "in_person"]);
export const CHANNELS = Object.freeze({ whatsapp: "WhatsApp", phone: "Teléfono", email: "Email", instagram: "Instagram", in_person: "En persona", other: "Otro" });
export const LANGUAGES = Object.freeze({ es: "Español", en: "Inglés", pt: "Portugués" });
export const CONSENT_LABELS = Object.freeze({ unknown: "Sin registrar", granted: "Dio su consentimiento", denied: "Lo rechazó", withdrawn: "Lo retiró" });
export const ACTIVITY_KINDS = Object.freeze({ note: "Nota", call: "Llamada", message: "Mensaje", meeting: "Reunión", demo: "Demo", proposal_sent: "Propuesta enviada", follow_up: "Seguimiento" });
export const SYSTEM_KINDS = Object.freeze(["stage_change", "consent_change", "conversion"]);
export const DIRECTIONS = Object.freeze({ inbound: "Entrante", outbound: "Saliente", internal: "Interno" });
export const BATCH_STATUS_LABELS = Object.freeze({ planned: "Planificado", sent: "Enviado", closed: "Cerrado" });
export const AUDIT_LABELS = Object.freeze({
  "lead.created": "Prospecto creado", "lead.stage_changed": "Cambio de etapa", "lead.consent_changed": "Cambio de consentimiento", "lead.activity_added": "Actividad registrada",
  "lead.activity_voided": "Actividad anulada", "lead.next_action_set": "Próxima acción actualizada", "lead.marked_duplicate": "Marcado como duplicado", "lead.converted": "Convertido en proyecto",
  "lead.budget_set": "Presupuesto actualizado", "lead.proposal_amount": "Monto de propuesta", "lead.batch_assigned": "Sumado a un lote", "lead.batch_removed": "Sacado de un lote",
  "batch.created": "Lote creado", "batch.updated": "Lote editado", "batch.sent_recorded": "Envío D0 registrado", "batch.signal_recorded": "Señal registrada", "batch.closed": "Lote cerrado",
  "batch.leads_assigned": "Prospectos sumados al lote", "batch.leads_removed": "Prospectos sacados del lote", "export.leads": "Exportación CSV",
});

export const isOpenStage = (stage) => OPEN_STAGES.includes(stage);
export const isWarmSource = (source) => WARM_SOURCES.includes(source);

/** «Vos» si es el administrador actual; si no, el prefijo del UUID (la API no expone nombres de administradores). */
export const ownerLabel = (ownerAdminId, currentAdminId) => (ownerAdminId && ownerAdminId === currentAdminId ? "Vos" : ownerAdminId ? `Admin #${shortId(ownerAdminId)}` : "—");

// ---------- Adaptadores ----------

const orNull = (value) => (value === undefined || value === "" ? null : value);

/** Lead (DTO admin) → modelo de vista. El presupuesto solo llega con billing:read: si falta, queda null (no se inventa). */
export function adaptLead(api) {
  return {
    id: api.id,
    name: api.contactName,
    company: orNull(api.company),
    email: orNull(api.email),
    phone: orNull(api.phone),
    handle: orNull(api.handle),
    channel: api.channel,
    channelLabel: CHANNELS[api.channel] || api.channel,
    source: api.source,
    sourceLabel: SOURCES[api.source] || api.source,
    sourceDetail: orNull(api.sourceDetail),
    warm: Boolean(api.warm),
    planRequestId: orNull(api.planRequestId),
    need: api.need || "",
    vertical: orNull(api.vertical),
    language: api.language || "es",
    budgetCents: typeof api.budgetCents === "number" ? api.budgetCents : null,
    commercialNotes: orNull(api.commercialNotes),
    stage: api.stage,
    stageLabel: LEAD_STAGE_LABELS[api.stage] || api.stage,
    stageReason: orNull(api.stageReason),
    reviewOn: orNull(api.reviewOn),
    ownerAdminId: api.ownerAdminId,
    nextAction: orNull(api.nextAction),
    nextActionOn: orNull(api.nextActionOn),
    overdue: Boolean(api.overdue),
    consent: { status: api.consent?.status || "unknown", on: orNull(api.consent?.on), basis: orNull(api.consent?.basis) },
    consentLabel: CONSENT_LABELS[api.consent?.status || "unknown"],
    doNotContact: Boolean(api.doNotContact),
    firstContactOn: orNull(api.firstContactOn),
    firstConversationOn: orNull(api.firstConversationOn),
    batchId: orNull(api.batchId),
    duplicateOfId: orNull(api.duplicateOfId),
    projectId: orNull(api.projectId),
    convertedAt: orNull(api.convertedAt),
    convertedOn: dayOfInstant(api.convertedAt),
    isExample: Boolean(api.isExample),
    version: api.version,
    createdAt: orNull(api.createdAt),
    createdOn: dayOfInstant(api.createdAt),
    possibleDuplicates: (api.possibleDuplicates || []).map((item) => ({ id: item.id, matchedOn: item.matchedOn || [] })),
    /** Un lead está "abierto" si se está trabajando: tiene responsable y próxima acción obligatorios. */
    open: isOpenStage(api.stage),
  };
}

/** Línea de contacto para listas: el medio que haya (email, teléfono o usuario). */
export const contactLine = (lead) => lead.email || lead.phone || lead.handle || "";

export function activityTitle(activity) {
  const { kind, direction } = activity;
  switch (kind) {
    case "note": return "Nota";
    case "call": return direction === "inbound" ? "Llamada recibida" : "Llamada hecha";
    case "message": return direction === "inbound" ? "Respondió" : "Mensaje enviado";
    case "meeting": return "Reunión";
    case "demo": return "Demo";
    case "proposal_sent": return "Propuesta enviada";
    case "follow_up": return direction === "inbound" ? "Seguimiento (entrante)" : "Toque de seguimiento";
    case "stage_change": return "Cambio de etapa";
    case "consent_change": return "Cambio de consentimiento";
    case "conversion": return "Convertido en proyecto";
    default: return kind;
  }
}

export function adaptActivity(api) {
  return {
    id: api.id,
    leadId: api.leadId,
    kind: api.kind,
    direction: api.direction,
    directionLabel: DIRECTIONS[api.direction] || api.direction,
    channel: orNull(api.channel),
    channelLabel: api.channel ? CHANNELS[api.channel] || api.channel : null,
    date: api.occurredOn,
    occurredAt: orNull(api.occurredAt),
    // Sin instante registrado no hay hora: «Hora no registrada». Nunca se completa.
    time: timeOfInstant(api.occurredAt),
    summary: api.summary || "",
    outcome: orNull(api.outcome),
    amountCents: typeof api.amountCents === "number" ? api.amountCents : null,
    batchId: orNull(api.batchId),
    actorAdminId: api.actorAdminId,
    recordedAt: api.recordedAt,
    voided: Boolean(api.voided),
    voidReason: orNull(api.voidReason),
    voidedOn: dayOfInstant(api.voidedAt),
    system: SYSTEM_KINDS.includes(api.kind),
    title: activityTitle(api),
  };
}

export function adaptAuditEvent(api) {
  return {
    id: api.id,
    at: api.occurredAt,
    date: dayOfInstant(api.occurredAt),
    time: timeOfInstant(api.occurredAt),
    actorKind: api.actorKind,
    actorId: api.actorId,
    action: api.action,
    title: AUDIT_LABELS[api.action] || api.action,
    result: api.result,
    before: api.before || null,
    after: api.after || null,
  };
}

/** Una línea legible de lo que cambió en un evento de auditoría (solo claves conocidas; nunca vuelca JSON crudo). */
export function auditChange(event) {
  const { before, after } = event;
  if (!after) return "";
  const parts = [];
  const changed = (key) => (before ? before[key] !== after[key] : after[key] !== undefined && after[key] !== null);
  if (changed("stage")) parts.push(`etapa ${before?.stage ? `${LEAD_STAGE_LABELS[before.stage] || before.stage} → ` : ""}${LEAD_STAGE_LABELS[after.stage] || after.stage}`);
  if (changed("consentStatus")) parts.push(`consentimiento ${CONSENT_LABELS[after.consentStatus] || after.consentStatus}`);
  if (changed("nextActionOn") && after.nextActionOn) parts.push(`próxima acción ${after.nextActionOn}`);
  if (changed("ownerAdminId")) parts.push("responsable");
  if (changed("projectId") && after.projectId) parts.push("proyecto creado");
  if (changed("status") && after.status) parts.push(`estado ${BATCH_STATUS_LABELS[after.status] || after.status}`);
  if (typeof after.rows === "number") parts.push(`${after.rows} fila${after.rows === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function adaptBatch(api) {
  const metrics = api.metrics || null;
  return {
    id: api.id,
    name: api.name,
    vertical: orNull(api.vertical),
    hypothesis: orNull(api.hypothesis),
    demo: orNull(api.demo),
    target: api.target,
    status: api.status,
    statusLabel: BATCH_STATUS_LABELS[api.status] || api.status,
    plannedOn: orNull(api.plannedOn),
    sentOn: orNull(api.sentOn),
    sentCount: typeof api.sentCount === "number" ? api.sentCount : null,
    signalDays: api.signalDays,
    closeDays: api.closeDays,
    signalDueOn: orNull(api.signalDueOn),
    closeDueOn: orNull(api.closeDueOn),
    signalOn: orNull(api.signalOn),
    signalNote: orNull(api.signalNote),
    closedOn: orNull(api.closedOn),
    report: api.report ? { worked: api.report.worked, notWorked: api.report.notWorked, change: api.report.change } : null,
    ownerAdminId: api.ownerAdminId,
    isExample: Boolean(api.isExample),
    version: api.version,
    createdAt: orNull(api.createdAt),
    metrics: metrics ? { assigned: metrics.assigned, contacted: metrics.contacted, replied: metrics.replied, calls: metrics.calls, proposals: metrics.proposals, won: metrics.won, lost: metrics.lost } : null,
    open: api.status !== "closed",
  };
}

/** Próximo paso del lote: D0 (registrar el envío manual) → señal → cierre con informe. Los plazos los calcula el servidor. */
export function batchNextAction(batch) {
  if (batch.status === "closed") return null;
  if (batch.status === "planned") return { kind: "envio", title: "Registrar el envío D0 (lo mandás vos, a mano)", due: batch.plannedOn };
  if (!batch.signalOn) return { kind: "señal", title: `Leer la señal del lote (D+${batch.signalDays})`, due: batch.signalDueOn };
  return { kind: "cierre", title: `Cerrar el lote con informe de 3 líneas (D+${batch.closeDays})`, due: batch.closeDueOn };
}

// ---------- Reglas de la casa, calculadas con datos del servidor ----------

const TOUCH_OFFSETS = [2, 5, 9];
const live = (activities) => activities.filter((activity) => !activity.voided);

/** La etapa donde estaba antes de pausar, leída del historial de sistema («Etapa: X → paused»). La API no la expone como campo. */
export function stageBeforePause(activities) {
  const entry = live(activities).filter((activity) => activity.kind === "stage_change").map((activity) => /^Etapa: (\w+) → paused/.exec(activity.summary)).filter(Boolean).at(-1);
  return entry && isOpenStage(entry[1]) ? entry[1] : null;
}

/**
 * Próxima acción sugerida por la regla «responde → llamada el mismo día → propuesta ≤24 h → toques +2/+5/+9».
 * Es una sugerencia calculada con el historial; la próxima acción oficial (con responsable y fecha) es la que guarda el servidor.
 */
export function ruleNextAction(lead, activities = []) {
  const items = live(activities);
  const last = (kind, direction) => items.filter((a) => a.kind === kind && (!direction || a.direction === direction)).sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt)).at(-1);
  switch (lead.stage) {
    case "conversation":
      return { kind: "llamada", title: "Llamar (mismo día que respondió)", due: lead.firstConversationOn || lead.nextActionOn };
    case "demo": {
      const demo = last("demo") || last("call") || last("meeting");
      return { kind: "propuesta", title: "Enviar propuesta (≤24 h de la demo)", due: addDays(demo?.date || lead.nextActionOn || lead.firstContactOn, 1) };
    }
    case "proposal":
    case "negotiation": {
      const proposal = last("proposal_sent");
      if (!proposal) return null;
      const touches = items.filter((a) => a.kind === "follow_up" && a.direction === "outbound" && a.date >= proposal.date).length;
      if (touches < TOUCH_OFFSETS.length) return { kind: "toque", title: `Toque ${touches + 1} de 3 (+${TOUCH_OFFSETS[touches]} días de la propuesta)`, due: addDays(proposal.date, TOUCH_OFFSETS[touches]) };
      return { kind: "cerrar", title: "Sin respuesta tras 3 toques: cerrar o pausar", due: addDays(proposal.date, TOUCH_OFFSETS.at(-1) + 1) };
    }
    case "paused":
      return lead.reviewOn ? { kind: "revisar", title: "Revisar la pausa", due: lead.reviewOn } : null;
    default:
      return null;
  }
}

/** Fechas en que el lead llegó a cada paso del camino (1 de 5 … 5 de 5). Solo lo que el historial prueba. */
export function railDates(lead, activities = []) {
  const items = live(activities);
  const first = (test) => items.filter(test).map((a) => a.date).sort()[0] || null;
  const toDemo = first((a) => a.kind === "stage_change" && /→ demo\b/.test(a.summary)) || first((a) => a.kind === "demo");
  return {
    prospect: lead.firstContactOn,
    conversation: lead.firstConversationOn,
    demo: toDemo,
    proposal: first((a) => a.kind === "proposal_sent"),
    won: lead.convertedOn,
  };
}

/** La última propuesta viva (no anulada) del historial. */
export function lastProposal(activities = []) {
  return live(activities).filter((a) => a.kind === "proposal_sent").sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt)).at(-1) || null;
}

/** Etapas a las que se puede mover un lead desde la actual con POST /stage (won nunca: solo la conversión). */
export function stageTargets(stage) {
  if (stage === "won") return [];
  if (isOpenStage(stage)) return OPEN_STAGES.filter((item) => item !== stage);
  if (stage === "paused" || stage === "lost") return [...OPEN_STAGES];
  return [];
}

export const daysFromToday = (iso, today) => (iso ? diffDays(today, iso) : null);

// ---------- Filtros → consulta del servidor ----------

export const STAGE_CHIPS = Object.freeze([["activos", "Activos"], ["prospect", "Prospecto"], ["conversation", "Conversación"], ["demo", "Demo"], ["proposal", "Propuesta"], ["negotiation", "Negociación"], ["paused", "En pausa"], ["won", "Ganado"], ["lost", "Perdido"]]);

/**
 * Filtros de pantalla → parámetros de GET /admin/leads. «Activos» pide todo lo no convertido y la pantalla oculta los perdidos
 * (el servidor filtra por una sola etapa). Devuelve un objeto plano y ordenado: sirve de clave de caché.
 */
export function leadQuery(filters, { adminId = "" } = {}) {
  const query = {};
  const text = String(filters.q || "").trim();
  if (text) query.q = text.slice(0, 100);
  if (filters.stage === "activos") query.converted = "false";
  else if (LEAD_STAGES.includes(filters.stage)) query.stage = filters.stage;
  if (filters.owner === "me" && adminId) query.ownerAdminId = adminId;
  if (filters.source && SOURCES[filters.source]) query.source = filters.source;
  if (filters.warm === "1") query.warm = "true";
  if (filters.overdue === "1") query.overdue = "true";
  if (/^\d{4}-\d{2}-\d{2}$/.test(filters.createdFrom || "")) query.createdFrom = filters.createdFrom;
  if (/^\d{4}-\d{2}-\d{2}$/.test(filters.createdTo || "")) query.createdTo = filters.createdTo;
  if (filters.dup === "1") query.includeDuplicates = "true";
  if (filters.batchId) query.batchId = filters.batchId;
  return Object.fromEntries(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)));
}

export const queryKey = (query) => new URLSearchParams(query).toString();
export const keyQuery = (key) => Object.fromEntries(new URLSearchParams(key || ""));

/**
 * Lo que la pantalla muestra con «Activos»: sin perdidos (el servidor no filtra por varias etapas a la vez). Los duplicados marcados
 * quedan «perdidos» por diseño y solo llegan si se pidió verlos: esos sí se muestran.
 */
export const visibleInChip = (lead, chip) => (chip === "activos" ? lead.stage !== "lost" || Boolean(lead.duplicateOfId) : true);
