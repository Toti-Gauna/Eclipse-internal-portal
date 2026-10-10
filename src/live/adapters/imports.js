// Importación del respaldo del portal (docs/imports.md del backend). La revisión y el informe llegan con `additionalProperties: true`
// en el OpenAPI: este adaptador fija la forma que el servidor realmente devuelve (src/imports/dto.ts, report.ts) y la tolera incompleta.
import { dayOfInstant, shortId } from "./common.js";

export const KIND_ORDER = Object.freeze(["batch", "prospect", "project", "payment", "goal", "event", "subscription"]);
export const KIND_LABELS = Object.freeze({ batch: "Lotes", prospect: "Prospectos", project: "Proyectos", payment: "Cobros", goal: "Metas", event: "Eventos del calendario", subscription: "Abonos mensuales" });
export const KIND_SINGULAR = Object.freeze({ batch: "Lote", prospect: "Prospecto", project: "Proyecto", payment: "Cobro", goal: "Meta", event: "Evento", subscription: "Abono" });
export const STATUS_ORDER = Object.freeze(["new", "already_imported", "possible_duplicate", "needs_input", "blocked", "invalid", "not_importable", "not_modeled"]);
export const STATUS_LABELS = Object.freeze({
  new: "Nuevo", already_imported: "Ya importado", possible_duplicate: "Parecido a uno existente", invalid: "Inválido", blocked: "Bloqueado",
  needs_input: "Falta decidir", not_importable: "No se importa", not_modeled: "No se modela",
});
export const STATUS_TONE = Object.freeze({ new: "ok", already_imported: "out", possible_duplicate: "attn", invalid: "late", blocked: "late", needs_input: "attn", not_importable: "out", not_modeled: "out" });
export const CREATED_LABELS = Object.freeze({
  batches: "Lotes", leads: "Prospectos", activities: "Actividades de prospectos", organizations: "Organizaciones", projects: "Proyectos",
  projectMembers: "Accesos de clientes", payments: "Cobros", goals: "Metas", events: "Eventos del calendario",
});
export const PAYMENT_KIND_CHOICES = Object.freeze([["deposit", "Seña"], ["installment", "Cuota"], ["final", "Saldo final"], ["maintenance", "Mantenimiento (no baja el saldo)"]]);
export const PAGE_SIZE = 20;

/** Motivos en español del servidor. El informe final los devuelve como códigos: se traducen acá con el mismo texto (src/imports/dto.ts). */
const REASONS = {
  invalid_id: "El identificador no es válido.", missing_name: "Falta el nombre.", name_too_long: "El nombre supera el máximo permitido.",
  contact_too_long: "El dato de contacto supera el máximo permitido.", missing_contact: "Falta el dato de contacto.", invalid_date: "Una fecha no es válida.",
  invalid_event_date: "Un evento tiene una fecha inválida.", invalid_events: "La lista de eventos no es válida.", invalid_updates: "La lista de actualizaciones no es válida.",
  invalid_total: "El total del proyecto no es un importe válido.", invalid_start_date: "Falta una fecha de inicio real.", invalid_amount: "El importe no es válido.",
  invalid_time: "La hora no es válida.", invalid_duration: "La duración no es válida.", invalid_completed_at: "La fecha de cierre no es válida.",
  event_crosses_midnight: "El evento termina después de medianoche.", future_payment: "El cobro tiene fecha futura.", unknown_stage: "La etapa no se reconoce.",
  incomplete_pause: "La pausa no tiene motivo, fecha de revisión o etapa previa.", closed_without_date: "El proyecto cerrado no tiene fecha de entrega ni de cobro.",
  won_without_project: "Figura como ganado pero no hay un proyecto asociado en el respaldo.", incomplete_report: "El informe del lote está incompleto.",
  signal_before_sent: "La señal es anterior al envío.", report_before_sent: "El informe es anterior al envío.", missing_step_title: "Un paso no tiene título.",
  too_many_steps: "La meta tiene demasiados pasos.", step_done_without_date: "Un paso figura hecho sin fecha de cierre: no se inventa una.",
  id_too_long: "El identificador es demasiado largo para guardarse como referencia.", text_too_long: "Un texto supera el máximo permitido.",
  too_many_payments: "El proyecto tiene más de 1.000 cobros, el máximo que admite el sistema.", payments_exceed_total: "Los cobros superan el total acordado del proyecto.",
  duplicate_id_in_file: "El identificador está repetido dentro del archivo.", already_imported: "Ya se importó antes: no se sobrescribe.",
  payment_without_project: "El cobro no está asociado a un proyecto: no hay dónde registrarlo.", project_not_in_backup: "El proyecto del cobro no está en el respaldo.",
  project_already_imported: "El proyecto ya existe: los cobros nuevos se cargan desde el portal.", project_not_imported: "Depende de un proyecto que no se importa.",
  project_already_linked: "El proyecto ya está vinculado a otro prospecto ganado.", payment_kind_required: "Hay que elegir qué tipo de cobro es.",
  subscriptions_not_modeled: "Los abonos mensuales todavía no se modelan: quedan solo en el respaldo.", truncated_report: "Un texto del informe se acortó al límite permitido.",
  truncated_event: "Un evento se acortó al límite permitido.", truncated_need: "La necesidad se acortó al límite permitido.", truncated_update: "Una actualización se acortó al límite permitido.",
  truncated_notes: "Las notas se acortaron al límite permitido.", truncated_note: "La nota se acortó al límite permitido.", truncated_demo: "El texto de la demo se acortó al límite permitido.",
  truncated_signal: "La nota de la señal se acortó al límite permitido.", truncated_reason: "El motivo se acortó al límite permitido.",
  event_before_creation: "Hay eventos anteriores a la fecha de alta: se usó la más antigua.", invalid_amount_dropped: "Un importe de propuesta no era válido y se omitió.",
  unknown_event_type: "Un tipo de evento no se reconoce: se guardó como nota.", unknown_category_defaulted: "La categoría no se reconoce: se usó «Operación».",
  unknown_type_defaulted: "El tipo de actividad no se reconoce: se usó «Reunión».", invalid_planned_end_dropped: "La entrega estimada no era una fecha válida y se omitió.",
  planned_end_before_start_dropped: "La entrega estimada era anterior al inicio y se omitió.", invalid_milestone_date_dropped: "La fecha del hito no era válida y se omitió.",
  update_without_valid_date_skipped: "Una actualización sin fecha válida no se importó (queda en el respaldo).", referral_not_modeled: "El referido registrado no se modela: queda en el respaldo.",
  maintenance_not_modeled: "El abono de mantenimiento no se modela: queda en el respaldo.", batch_not_imported: "Su lote no se importó: queda sin lote.",
  reference_dropped: "Apuntaba a algo que no se importa: se quitó el vínculo.", imported_despite_similar: "Se importa aunque hay uno parecido, por decisión explícita.",
};

/** Un motivo (código o { code, message }) → { code, message } en español. */
export function explainReason(reason) {
  const code = typeof reason === "string" ? reason : reason?.code || "";
  const given = typeof reason === "object" ? reason?.message : "";
  if (code.startsWith("similar_existing:")) return { code, message: "Hay un registro parecido en el sistema. Por defecto se omite; podés importarlo igual." };
  return { code, message: REASONS[code] || given || "Revisar este registro." };
}

const asArray = (value) => (Array.isArray(value) ? value : []);
const adaptItem = (item) => ({
  kind: item.kind,
  legacyId: String(item.legacyId ?? ""),
  label: String(item.label ?? item.legacyId ?? ""),
  status: item.status,
  outcome: item.outcome || null,
  createdId: item.id || null,
  reasons: asArray(item.reasons).map(explainReason),
  warnings: asArray(item.warnings).map(explainReason),
});

export function adaptPreview(api) {
  if (!api) return null;
  const needs = api.needs || {};
  return {
    sourceVersion: api.sourceVersion ?? null,
    example: Boolean(api.example),
    summary: api.summary || {},
    items: asArray(api.items).map(adaptItem),
    needs: {
      projectAssignments: asArray(needs.projectAssignments).map((entry) => ({ projectId: String(entry.projectId), label: String(entry.label ?? entry.projectId) })),
      paymentKinds: asArray(needs.paymentKinds).map((entry) => ({ paymentId: String(entry.paymentId), label: String(entry.label ?? entry.paymentId) })),
      duplicates: asArray(needs.duplicates).map((entry) => ({ kind: entry.kind, legacyId: String(entry.legacyId), label: String(entry.label ?? entry.legacyId) })),
    },
    notModeled: { auditEntries: api.notModeled?.auditEntries ?? 0, subscriptions: api.notModeled?.subscriptions ?? 0 },
    previewHash: api.previewHash || "",
  };
}

export function adaptReport(api) {
  if (!api) return null;
  return {
    committedAt: api.committedAt || null,
    sourceVersion: api.sourceVersion ?? null,
    example: Boolean(api.example),
    payloadSha256: api.payloadSha256 || "",
    created: api.created || {},
    notImported: api.notImported ?? 0,
    items: asArray(api.items).map(adaptItem),
    notModeled: { auditEntries: api.notModeled?.auditEntries ?? 0, subscriptions: api.notModeled?.subscriptions ?? 0, stageHistory: Boolean(api.notModeled?.stageHistory) },
    notes: asArray(api.notes).map(String),
  };
}

export function adaptImport(api) {
  return {
    id: api.id,
    status: api.status,
    sourceVersion: api.sourceVersion ?? null,
    example: Boolean(api.example),
    payloadSha256: api.payloadSha256 || "",
    payloadBytes: api.payloadBytes ?? 0,
    createdAt: api.createdAt || null,
    createdBy: api.createdBy || null,
    committedAt: api.committedAt || null,
    committedBy: api.committedBy || null,
    preview: adaptPreview(api.preview),
    report: adaptReport(api.report),
    date: dayOfInstant(api.createdAt),
  };
}

export const importLabel = (item) => `#${shortId(item.id)}`;

/** Conteo por tipo y estado, en el orden de la pantalla. Solo los tipos con registros. */
export function summaryRows(summary = {}) {
  return KIND_ORDER.map((kind) => {
    const counts = summary[kind] || {};
    const total = STATUS_ORDER.reduce((sum, status) => sum + (counts[status] || 0), 0);
    return { kind, counts, total };
  }).filter((row) => row.total > 0);
}

export function filterItems(items, { kind = "", status = "" } = {}) {
  return items.filter((item) => (!kind || item.kind === kind) && (!status || item.status === status));
}

/** Página `page` (desde 1) de una lista; la pantalla pagina sola porque el servidor devuelve todo junto. */
export function paginate(items, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(pages, Math.max(1, Number(page) || 1));
  return { items: items.slice((current - 1) * size, current * size), page: current, pages, total: items.length, from: items.length ? (current - 1) * size + 1 : 0, to: Math.min(items.length, current * size) };
}

/**
 * Decisiones que el commit exige, según la revisión y lo ya elegido.
 * - Proyectos a asignar: los nuevos MÁS los parecidos que se decidió importar (el servidor exige un dueño por cada proyecto que va a escribir).
 * - Cobros con tipo a elegir, parecidos a resolver (por defecto se omiten).
 * - Prospectos que se van a importar: si hay alguno, el servidor pide la fecha de la próxima acción de los abiertos.
 */
export function requiredDecisions(preview, decisions = {}) {
  const duplicateKey = (entry) => `${entry.kind}:${entry.legacyId}`;
  const importing = (entry) => (decisions.duplicates || {})[duplicateKey(entry)] === "import";
  const dupProjects = preview.needs.duplicates.filter((entry) => entry.kind === "project" && importing(entry)).map((entry) => ({ projectId: entry.legacyId, label: entry.label }));
  const projects = [...preview.needs.projectAssignments, ...dupProjects];
  const prospects = preview.items.filter((item) => item.kind === "prospect" && item.status === "new").length
    + preview.needs.duplicates.filter((entry) => entry.kind === "prospect" && importing(entry)).length;
  return { projects, paymentKinds: preview.needs.paymentKinds, duplicates: preview.needs.duplicates, prospects };
}

/** Cuánto se escribiría (según la revisión): lo nuevo + lo parecido que se decidió importar. No incluye lo que el servidor derive después. */
export function expectedCounts(preview, decisions = {}) {
  const counts = {};
  for (const item of preview.items) if (item.status === "new") counts[item.kind] = (counts[item.kind] || 0) + 1;
  for (const entry of preview.needs.duplicates) if ((decisions.duplicates || {})[`${entry.kind}:${entry.legacyId}`] === "import") counts[entry.kind] = (counts[entry.kind] || 0) + 1;
  // Un cobro ambiguo se escribe una vez que se le elige tipo.
  for (const entry of preview.needs.paymentKinds) if ((decisions.paymentKinds || {})[entry.paymentId]) counts.payment = (counts.payment || 0) + 1;
  return counts;
}

/** Mensajes para los fallos conocidos de cada paso (los 400/409 del servidor no dicen el motivo). */
export function importErrorMessage(error, step) {
  const status = error?.status;
  if (status === 503) return "El servidor no pudo revisar el respaldo ahora (demasiados registros en la base para detectar parecidos con seguridad). Probá más tarde.";
  if (status === 413) return "El archivo supera los 4 MB que acepta el servidor.";
  if (status === 403) return step === "commit"
    ? "Tu cuenta no puede confirmar la importación: hace falta imports:run más leads:write, projects:write, billing:write y planner:write."
    : "Tu cuenta no puede revisar importaciones: hace falta imports:run más leads:read, projects:read, billing:read y planner:read.";
  if (status === 400 && step === "preview") return "El servidor no reconoce el archivo como un respaldo del portal (o supera los límites: 2.000 prospectos, 500 proyectos, 5.000 cobros, 1.000 metas, 3.000 eventos).";
  if (status === 400 && step === "commit") return "El servidor rechazó las decisiones. Revisá que cada proyecto tenga su cliente (o «solo interno»), que cada cobro tenga su tipo, que la fecha de seguimiento no sea pasada y que el cliente elegido siga activo.";
  if (status === 409 && step === "commit") return "La revisión ya no coincide con lo que hay: el respaldo o la base cambiaron, o es un respaldo de ejemplo y este servidor no los admite. Volvimos a pedir la revisión: miralo de nuevo antes de confirmar.";
  if (status === 404) return "No encontramos esa importación.";
  return null;
}

// ---------- Decisiones guardadas en campos planos ----------
// La pantalla guarda cada decisión en un campo plano del estado de filtros de app.js (a0, k3, d1…) porque ese mecanismo solo maneja
// pares nombre → texto. El índice es la posición en una lista que NO cambia con las decisiones, así que no se desfasa.

/** Proyectos que podrían necesitar dueño: los nuevos + los parecidos (estos solo cuentan si se decidió importarlos). */
export function projectSlots(preview) {
  return [
    ...preview.needs.projectAssignments.map((entry) => ({ projectId: entry.projectId, label: entry.label, duplicateKey: null })),
    ...preview.needs.duplicates.filter((entry) => entry.kind === "project").map((entry) => ({ projectId: entry.legacyId, label: entry.label, duplicateKey: `project:${entry.legacyId}` })),
  ];
}

/** Decisiones en la forma que espera importCommitBody, a partir de los campos planos. */
export function decisionsFromFlat(preview, flat = {}) {
  const duplicates = {};
  preview.needs.duplicates.forEach((entry, index) => { duplicates[`${entry.kind}:${entry.legacyId}`] = flat[`d${index}`] === "import" ? "import" : "skip"; });
  const assignments = {};
  projectSlots(preview).forEach((slot, index) => {
    if (slot.duplicateKey && duplicates[slot.duplicateKey] !== "import") return;
    if (flat[`a${index}`]) assignments[slot.projectId] = flat[`a${index}`];
  });
  const paymentKinds = {};
  preview.needs.paymentKinds.forEach((entry, index) => { if (flat[`k${index}`]) paymentKinds[entry.paymentId] = flat[`k${index}`]; });
  return { assignments, paymentKinds, duplicates, followUpOn: flat.followUpOn || "", acknowledgeExample: flat.ack === "1" };
}
