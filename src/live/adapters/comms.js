// Comunicaciones (docs/communications.md del backend): API ⇄ modelo de vista. El texto del servidor (asunto, mensaje, destinatario)
// se guarda tal cual y se escapa SOLO al dibujar. El estado «aceptado por SMTP» nunca se presenta como entrega.
import { ApiError } from "../../api/errors.js";
import { dayOfInstant, shortId, timeOfInstant } from "./common.js";

export const CHANNEL_LABELS = Object.freeze({ email: "Correo", whatsapp: "WhatsApp" });
export const PURPOSE_LABELS = Object.freeze({ update: "Novedad publicada", milestone: "Hito visible para el cliente", custom: "Mensaje propio" });
export const LANGUAGE_LABELS = Object.freeze({ es: "Español", en: "English", pt: "Português" });
export const COMM_STATUS_LABELS = Object.freeze({
  draft: "Borrador · todavía no se envió",
  queued: "En cola de envío",
  accepted_by_smtp: "Aceptado por el servidor de correo",
  failed: "El envío falló",
  unknown: "Resultado desconocido",
  cancelled: "Cancelado",
  opened: "WhatsApp abierto · falta declarar",
  declared_sent: "Declarado como enviado",
});
export const COMM_STATUS_TONE = Object.freeze({ draft: "attn", queued: "attn", accepted_by_smtp: "ok", failed: "late", unknown: "late", cancelled: "out", opened: "attn", declared_sent: "ok" });
export const COMM_STATUSES = Object.freeze(Object.keys(COMM_STATUS_LABELS));
export const FINAL_STATUSES = Object.freeze(["accepted_by_smtp", "failed", "unknown", "cancelled", "declared_sent"]);

/** Lo que cada estado prueba (y lo que NO). Es el texto que ve la persona: nada de «entregado». */
export const EVIDENCE_NOTES = Object.freeze({
  draft: "Es una vista previa. No se envió ni se puso en cola nada.",
  queued: "El correo está en la cola del servidor. Todavía no salió: un worker lo envía una sola vez y registra el resultado.",
  accepted_by_smtp: "El servidor de correo (SMTP) aceptó el mensaje. Eso NO prueba que haya llegado a la bandeja ni que lo hayan leído.",
  failed: "El servidor de correo rechazó o no pudo enviar el mensaje. No se reintenta solo: preparalo de nuevo si querés volver a intentar.",
  unknown: "No sabemos qué pasó: el servidor de correo no confirmó. Puede haber salido o no. No lo reenvíes sin verificar con el cliente.",
  cancelled: "Se canceló antes de enviarse (o venció en la cola). No salió.",
  opened: "Registramos que abriste el chat. Falta que lo envíes vos desde WhatsApp y lo declares acá.",
  declared_sent: "Lo declaró una persona a mano. No hay comprobante de entrega ni de lectura.",
});

/** Solo se dibujan enlaces https://wa.me/…: un dato del servidor nunca se convierte en cualquier otro destino. */
export function safeWhatsappUrl(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "wa.me" || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function adaptRecipient(api) {
  return {
    clientId: api.clientId,
    email: api.email,
    name: api.displayName || "",
    verified: Boolean(api.verified),
    phoneAvailable: Boolean(api.phoneAvailable),
  };
}

export function adaptCommunication(api) {
  const status = api.status;
  return {
    id: api.id,
    projectId: api.projectId,
    clientId: api.clientId,
    channel: api.channel,
    purpose: api.purpose,
    language: api.language,
    updateId: api.updateId || null,
    milestoneId: api.milestoneId || null,
    subject: api.subject ?? null,
    text: api.text,
    contentHash: api.contentHash,
    email: api.recipient?.email ?? null,
    phone: api.recipient?.phone ?? null,
    status,
    version: api.version,
    confirmedAt: api.confirmedAt || null,
    confirmedBy: api.confirmedBy || null,
    resultAt: api.resultAt || null,
    evidence: api.evidence || "none",
    createdAt: api.createdAt,
    createdBy: api.createdBy,
    waUrl: safeWhatsappUrl(api.whatsappUrl),
    // Derivados de la vista (la autoridad sigue siendo el servidor: cada acción vuelve a validar).
    isEmail: api.channel === "email",
    final: FINAL_STATUSES.includes(status),
    date: dayOfInstant(api.createdAt),
    time: timeOfInstant(api.createdAt),
  };
}

export const shortHash = (hash) => (typeof hash === "string" && hash.length >= 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash || "");

/** Quién hizo algo: el UUID del administrador, resumido; «vos» si es la cuenta de esta sesión. */
export const actorLabel = (adminId, me) => (!adminId ? "—" : adminId === me ? "vos" : `administrador #${shortId(adminId)}`);

/** Fuentes aprobadas para el contenido: lo mismo que el servidor acepta (publicadas y no internas / visibles y no canceladas). */
export const publishedUpdates = (updates = []) => updates.filter((update) => update.state === "published" && update.kind !== "internal_note");
export const visibleMilestones = (milestones = []) => milestones.filter((milestone) => milestone.visibleToClient && milestone.status !== "cancelled");

/** El destinatario sirve para el canal elegido? Devuelve el motivo si no (el servidor decide igual). */
export function recipientProblem(recipient, channel) {
  if (!recipient) return "Elegí a quién va.";
  if (channel === "email" && !recipient.verified) return "Su email no está verificado: el servidor no deja prepararle un correo.";
  return "";
}

const RATE_LIMIT = "Se alcanzó el tope de envíos: máximo 3 correos por cliente por día y 20 por administrador por hora. Esperá o usá WhatsApp (manual).";
const SMTP_OFF = "El envío de correo no está activado en este servidor (SMTP sin configurar). Podés preparar el mensaje por WhatsApp: ese canal es manual y sigue disponible.";

/**
 * Mensaje claro para cada falla conocida de cada paso. El 400 de la API no dice qué campo falló: se explican las causas posibles.
 * `step`: create | confirm | opened | declare | cancel | recipients
 */
export function commsErrorMessage(error, step) {
  if (!(error instanceof ApiError)) return null;
  const { status } = error;
  if (status === 503) return step === "create" || step === "confirm" ? SMTP_OFF : null;
  if (status === 429) return `${RATE_LIMIT}${error.retryAfter ? ` Reintentá en ${Math.ceil(error.retryAfter / 60)} min.` : ""}`;
  if (status === 409) {
    return {
      create: "El destinatario no se puede contactar: su cuenta está inactiva o su email no está verificado.",
      confirm: "No se pudo confirmar: el texto cambió desde la vista previa, el contenido ya no está publicado, el destinatario salió del proyecto, ya se confirmó antes o el correo cambió. Actualizamos la pantalla: revisá y volvé a preparar si hace falta.",
      opened: "Ya no se puede abrir: el contenido se retiró, el destinatario salió del proyecto o el mensaje cambió de estado. Preparalo de nuevo.",
      declare: "Solo se puede declarar un mensaje que ya abriste y que todavía no declaraste.",
      cancel: "No se puede cancelar: el servidor ya tomó este correo o cambió de estado. Actualizamos la pantalla.",
    }[step] || null;
  }
  if (status === 400 && step === "create") return "El servidor no aceptó el mensaje. Revisá que el proyecto tenga un destinatario elegido, que la novedad siga publicada o el hito siga visible, y que el texto no supere el máximo.";
  return null;
}
