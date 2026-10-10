// Vocabulario y conversiones compartidas entre la API y el modelo de vista del portal.
// Regla: la API habla en centavos USD, días YYYY-MM-DD, UUID y etapas en snake_case; la interfaz, en dólares,
// etapas camelCase (las de rules.js) y textos en español. Se convierte SOLO en estos bordes.

// ---------- Dinero ----------

/** Centavos enteros → dólares (puede tener decimales: 1050.5). */
export const centsToDollars = (cents) => (Number.isFinite(cents) ? cents / 100 : 0);

/**
 * Texto de un campo de dólares → centavos enteros, sin pasar por floats.
 * Acepta "1500", "1500.5", "1500,50". Devuelve NaN si no es un monto válido (más de 2 decimales, negativo, vacío).
 */
export function parseDollars(text) {
  const value = String(text ?? "").trim().replace(",", ".");
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return Number.NaN;
  return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0") || 0);
}

/** "USD 1.234" o "USD 1.234,50": muestra los centavos solo si existen (nunca inventa precisión). */
export function formatCents(cents, { withCurrency = true } = {}) {
  const whole = Number.isInteger(cents / 100);
  const text = new Intl.NumberFormat("es-AR", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format((cents || 0) / 100);
  return withCurrency ? `USD ${text}` : text;
}

// ---------- Fechas ----------

export const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const pad = (n) => String(n).padStart(2, "0");

/** Instante ISO → día local YYYY-MM-DD (null si no hay instante). */
export function dayOfInstant(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Instante ISO → hora local HH:MM. Solo para instantes que el servidor registró de verdad. */
export function timeOfInstant(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------- Etapas ----------

const STAGE_TO_VIEW = { preparation: "preparation", build: "build", eclipse_review: "eclipseReview", client_review: "clientReview", delivery: "delivery", support: "support" };
const VIEW_TO_STAGE = Object.fromEntries(Object.entries(STAGE_TO_VIEW).map(([api, view]) => [view, api]));
export const stageToView = (stage) => STAGE_TO_VIEW[stage] || stage;
export const stageToApi = (stage) => VIEW_TO_STAGE[stage] || stage;
export const API_STAGES = Object.freeze(Object.keys(STAGE_TO_VIEW));

/** Etapa que ve la interfaz: pausa y cierre son estados del proyecto, no etapas de la API. */
export function viewStage({ status, stage }) {
  if (status === "paused") return "paused";
  if (status === "closed") return "closed";
  return stageToView(stage);
}

// ---------- Textos ----------

export const PAYMENT_KIND_LABELS = Object.freeze({ deposit: "Seña", installment: "Cuota", final: "Saldo final", maintenance: "Mantenimiento" });
export const PAYMENT_STATUS_LABELS = Object.freeze({ proposed: "Propuesto", committed: "Comprometido", collected: "Cobrado", voided: "Anulado" });
export const REQUEST_STATUS_LABELS = Object.freeze({ submitted: "Recibida", under_review: "En revisión", reviewed: "Revisada", accepted: "Aceptada", rejected: "Rechazada", cancelled: "Cancelada por el cliente" });
export const UPDATE_KIND_LABELS = Object.freeze({ internal_note: "Nota interna", client_update: "Actualización", action_required: "Acción del cliente", status_change: "Cambio de etapa" });
export const UPDATE_STATE_LABELS = Object.freeze({ internal: "Solo interna", draft: "Borrador · el cliente no la ve", published: "Publicada · la ve el cliente", withdrawn: "Retirada" });
export const MILESTONE_STATUS_LABELS = Object.freeze({ pending: "Pendiente", in_progress: "En curso", blocked: "Bloqueado", done: "Hecho", cancelled: "Cancelado" });
export const CHANGE_STATUS_LABELS = Object.freeze({ received: "Recibido", evaluating: "En evaluación", estimated: "Estimado", accepted: "Aceptado", rejected: "Rechazado", closed: "Cerrado" });
export const MEMBER_ROLE_LABELS = Object.freeze({ client_admin: "Responsable del cliente", client_collaborator: "Colaborador del cliente" });
export const GOAL_LABELS = Object.freeze({
  encontrar: "Que lo encuentren", atender: "Atender 24/7", ordenar: "Ordenar turnos y pedidos", vender: "Vender online",
  fidelizar: "Fidelizar clientes", app: "Una app propia", diagnostico: "Quiere un diagnóstico",
});
export const MAINTENANCE_LABELS = Object.freeze({ esencial: "Esencial", crecimiento: "Crecimiento", escala: "Escala" });
export const VERTICAL_LABELS = Object.freeze({ clinicas: "Clínicas", inmobiliarias: "Inmobiliarias", gimnasios: "Gimnasios", tiendas: "Tiendas", restaurantes: "Restaurantes", academias: "Academias", otro: "Otro rubro" });

export const shortId = (id) => String(id || "").slice(0, 8);

/** Código visible de un proyecto: el heredado (ECL-NNN) si existe; si no, el prefijo del UUID. */
export const projectCode = (project) => project.legacyReference || `#${shortId(project.id)}`;
