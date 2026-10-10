// Cuerpos hacia la API para Comunicaciones, Documentos e Importaciones (etapa 2). Mismo contrato que outbound.js: cada constructor
// valida con mensajes en español (los 400 del servidor no dicen qué campo falló) y devuelve { body } | { error }.
// Vive en su propio archivo para que las ramas de las otras áreas puedan fusionarse sin tocar las mismas líneas.
import { todayISO } from "../../rules.js";
import { isDay } from "./common.js";
import { requiredDecisions } from "./imports.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === "string" && UUID.test(value);
const text = (value) => String(value ?? "").trim();
const bad = (error) => ({ error });
const hasControl = (value, multiline) => [...value].some((char) => { const code = char.charCodeAt(0); return code === 127 || (code < 32 && !(multiline && (code === 9 || code === 10 || code === 13))); });
const INVISIBLE_RE = new RegExp("[\\p{Cf}\\u2028\\u2029]", "u");
const hasInvisible = (value) => INVISIBLE_RE.test(value);

export const SUBJECT_MAX = 120;
export const MESSAGE_MAX = 1500;
export const BACKUP_MAX_BYTES = 4 * 1024 * 1024;

// ---------- Comunicaciones ----------

/**
 * Borrador de un mensaje: un destinatario, un canal, un propósito. El navegador NUNCA manda direcciones ni teléfonos:
 * el servidor resuelve al destinatario entre los miembros del proyecto y arma el texto con fuentes aprobadas.
 */
export function communicationCreateBody(values, { recipients = [] } = {}) {
  const channel = text(values.channel);
  const purpose = text(values.purpose);
  const language = text(values.language) || "es";
  if (!isUuid(values.projectId)) return bad("Elegí el proyecto.");
  if (!["email", "whatsapp"].includes(channel)) return bad("Elegí el canal: correo o WhatsApp.");
  if (!["update", "milestone", "custom"].includes(purpose)) return bad("Elegí qué querés comunicar.");
  if (!["es", "en", "pt"].includes(language)) return bad("Elegí el idioma del mensaje.");
  const clientId = text(values.clientId);
  if (!clientId && recipients.length !== 1) return bad(recipients.length ? "Elegí a quién va el mensaje: el proyecto tiene más de una persona." : "Este proyecto no tiene personas del cliente con acceso: autorizalas primero en la ficha del proyecto.");
  if (clientId && !isUuid(clientId)) return bad("El destinatario no es válido.");
  if (clientId && recipients.length && !recipients.some((recipient) => recipient.clientId === clientId)) return bad("Ese destinatario ya no está en el proyecto. Actualizá la pantalla.");
  const body = { projectId: values.projectId, channel, purpose, language };
  if (clientId) body.clientId = clientId;
  if (purpose === "update") {
    if (!isUuid(values.updateId)) return bad("Elegí la novedad publicada que querés comunicar.");
    body.updateId = values.updateId;
  }
  if (purpose === "milestone") {
    if (!isUuid(values.milestoneId)) return bad("Elegí el hito visible para el cliente.");
    body.milestoneId = values.milestoneId;
  }
  const message = text(values.message);
  if (message) {
    if ([...message].length > MESSAGE_MAX) return bad(`El mensaje admite hasta ${MESSAGE_MAX} caracteres.`);
    if (hasControl(message, true)) return bad("El mensaje tiene caracteres que no se pueden enviar.");
    body.message = message;
  } else if (purpose === "custom") return bad("Escribí el mensaje.");
  if (purpose === "custom" && channel === "email") {
    const subject = text(values.subject);
    if (!subject) return bad("Un correo propio necesita asunto.");
    if ([...subject].length > SUBJECT_MAX) return bad(`El asunto admite hasta ${SUBJECT_MAX} caracteres.`);
    if (hasControl(subject, false)) return bad("El asunto tiene caracteres que no se pueden enviar.");
    body.subject = subject;
  }
  return { body };
}

/** Confirmar un correo: la versión y el hash de la vista previa que la persona vio, y una casilla explícita. */
export function communicationConfirmBody(communication, { seenHash, confirmed }) {
  if (!communication) return bad("No encontramos el mensaje. Actualizá la pantalla.");
  if (communication.channel !== "email" || communication.status !== "draft") return bad("Solo se confirma un correo en borrador.");
  if (!confirmed) return bad("Marcá la casilla para confirmar el envío.");
  if (!seenHash || seenHash !== communication.contentHash) return bad("El texto cambió desde la vista previa. Actualizamos la pantalla: revisalo de nuevo.");
  return { body: { version: communication.version, contentHash: communication.contentHash, confirm: true } };
}

export function communicationVersionBody(communication) {
  if (!communication) return bad("No encontramos el mensaje. Actualizá la pantalla.");
  return { body: { version: communication.version } };
}

/** «Marcar como enviado»: una declaración humana; exige la casilla y que el chat ya se haya abierto. */
export function communicationDeclareBody(communication, confirmed) {
  if (!communication) return bad("No encontramos el mensaje. Actualizá la pantalla.");
  if (communication.channel !== "whatsapp" || communication.status !== "opened") return bad("Primero registrá que abriste WhatsApp.");
  if (!confirmed) return bad("Marcá la casilla para declarar el envío.");
  return { body: { version: communication.version, confirm: true } };
}

// ---------- Documentos ----------

export function documentCreateBody(values) {
  const title = text(values.title);
  if (!title) return bad("Título: completalo.");
  if ([...title].length > 160) return bad("Título: máximo 160 caracteres.");
  if (hasControl(title, false) || hasInvisible(title)) return bad("Título: tiene caracteres que no se pueden guardar.");
  if (!["contract", "quote", "invoice", "deliverable", "guide", "other"].includes(text(values.kind))) return bad("Elegí el tipo de documento.");
  return { body: { title, kind: text(values.kind), fileName: text(values.fileName), mediaType: text(values.mediaType) } };
}

export function documentRenameBody(values, document) {
  const title = text(values.title);
  if (!title) return bad("Título: completalo.");
  if ([...title].length > 160) return bad("Título: máximo 160 caracteres.");
  if (hasControl(title, false) || hasInvisible(title)) return bad("Título: tiene caracteres que no se pueden guardar.");
  if (title === document.title) return bad("El título es el mismo: no hay nada que guardar.");
  return { body: { version: document.version, title } };
}

/** Publicar (client) o ocultar (internal). Publicar es una publicación: exige updates:send y una casilla. */
export function documentVisibilityBody(document, visibility, { confirmed, canPublish = true }) {
  if (document.status === "archived") return bad("Un documento archivado no se modifica.");
  if (!["client", "internal"].includes(visibility)) return bad("Visibilidad no válida.");
  if (visibility === "client") {
    if (document.status !== "active") return bad("Primero subí el archivo: un registro sin archivo no se puede mostrar.");
    if (!canPublish) return bad("Mostrarle un archivo al cliente requiere el permiso updates:send.");
    if (!confirmed) return bad("Marcá la casilla para confirmar que el cliente va a ver este archivo.");
  }
  if (document.visibility === visibility) return bad(visibility === "client" ? "El cliente ya lo ve." : "Ya es interno.");
  return { body: { version: document.version, visibility } };
}

export function documentArchiveBody(values, document) {
  const reason = text(values.reason);
  if (!reason) return bad("Motivo: completalo.");
  if ([...reason].length > 500) return bad("Motivo: máximo 500 caracteres.");
  if (hasControl(reason, false)) return bad("Motivo: tiene caracteres que no se pueden guardar.");
  if (document.status === "archived") return bad("Ya está archivado.");
  if (!values.confirm) return bad("Marcá la casilla: archivar es definitivo.");
  return { body: { version: document.version, reason } };
}

// ---------- Importaciones ----------

/**
 * Texto del archivo elegido → { backup }. Es el `.json` que produce «Exportar respaldo» del portal en modo demostración.
 * El servidor valida de verdad (estructura, límites, profundidad): esto solo evita subir lo que claramente no es un respaldo.
 */
export function importFileBody(fileText, { name = "" } = {}) {
  let parsed;
  try { parsed = JSON.parse(fileText); } catch { return bad(`«${name || "El archivo"}» no es un JSON válido.`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("El archivo no es un respaldo del portal.");
  if (parsed.origen === "servidor") return bad("Ese archivo es una copia de lo que ve el servidor, no un respaldo del portal de demostración. Usá el que descarga «Exportar respaldo» en modo demostración.");
  for (const key of ["prospects", "batches", "projects", "payments", "subscriptions"]) {
    if (!Array.isArray(parsed[key])) return bad(`No parece un respaldo del portal: falta la lista «${key}».`);
  }
  if (parsed.version !== undefined && ![1, 2, 3].includes(parsed.version)) return bad(`La versión del respaldo (${String(parsed.version)}) no se reconoce.`);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed)).length;
  if (bytes > BACKUP_MAX_BYTES) return bad("El respaldo pesa más de 4 MB: es el máximo que acepta el servidor.");
  return { body: { backup: parsed }, bytes };
}

/**
 * Decisiones → cuerpo del commit. `decisions`:
 *   assignments { [projectId]: "internal" | clientId }, paymentKinds { [paymentId]: kind }, duplicates { ["kind:legacyId"]: "skip" | "import" },
 *   followUpOn, ownerAdminId, acknowledgeExample, confirmed.
 * Cada proyecto que se va a escribir necesita un dueño elegido a propósito; no hay valor por defecto.
 */
export function importCommitBody(preview, decisions, { today = todayISO(), knownClients = [] } = {}) {
  if (!preview?.previewHash) return bad("Falta la revisión del servidor. Volvé a abrir la importación.");
  const needed = requiredDecisions(preview, decisions);
  const clientIds = new Set(knownClients.map((client) => client.id));
  const assignments = [];
  for (const project of needed.projects) {
    const choice = decisions.assignments?.[project.projectId];
    if (!choice) return bad(`Elegí el cliente de «${project.label}» (o «solo interno»).`);
    if (choice === "internal") assignments.push({ projectId: project.projectId, clientId: null });
    else if (clientIds.has(choice)) assignments.push({ projectId: project.projectId, clientId: choice });
    else return bad(`El cliente elegido para «${project.label}» ya no está en la lista: buscalo de nuevo.`);
  }
  const paymentKinds = [];
  for (const payment of needed.paymentKinds) {
    const kind = decisions.paymentKinds?.[payment.paymentId];
    if (!["deposit", "installment", "final", "maintenance"].includes(kind)) return bad(`Elegí qué tipo de cobro es «${payment.label}».`);
    paymentKinds.push({ paymentId: payment.paymentId, kind });
  }
  const duplicates = needed.duplicates.map((entry) => ({ kind: entry.kind, legacyId: entry.legacyId, action: decisions.duplicates?.[`${entry.kind}:${entry.legacyId}`] === "import" ? "import" : "skip" }));
  const body = { confirm: true, previewHash: preview.previewHash, assignments, paymentKinds, duplicates, acknowledgeExample: Boolean(decisions.acknowledgeExample) };
  const followUpOn = text(decisions.followUpOn);
  if (needed.prospects > 0 && !followUpOn) return bad("Elegí la fecha de la próxima acción de los prospectos abiertos.");
  if (followUpOn) {
    if (!isDay(followUpOn) || followUpOn < today) return bad("La fecha de seguimiento tiene que ser hoy o una fecha futura.");
    if (followUpOn > "2100-12-31") return bad("La fecha de seguimiento es demasiado lejana.");
    body.followUpOn = followUpOn;
  }
  if (preview.example && !decisions.acknowledgeExample) return bad("Este respaldo es de EJEMPLO: tenés que reconocerlo para importarlo.");
  const owner = text(decisions.ownerAdminId);
  if (owner) {
    if (!isUuid(owner)) return bad("El responsable no es válido.");
    body.ownerAdminId = owner;
  }
  if (!decisions.confirmed) return bad("Marcá la confirmación final para importar.");
  return { body };
}
