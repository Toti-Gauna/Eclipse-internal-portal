// Documentos (docs/documents.md del backend). Los bytes viven en PostgreSQL; el portal solo ve metadatos y descarga por la API
// autenticada (nunca un enlace público). La validación del navegador es una ayuda: el servidor verifica firma, tipo y tamaño.
import { dayOfInstant, shortId, timeOfInstant } from "./common.js";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const DOC_KIND_LABELS = Object.freeze({ contract: "Contrato", quote: "Presupuesto", invoice: "Factura", deliverable: "Entregable", guide: "Guía", other: "Otro" });
export const DOC_STATUS_LABELS = Object.freeze({ pending: "Falta subir el archivo", active: "Activo", archived: "Archivado" });
export const VISIBILITY_LABELS = Object.freeze({ internal: "Interno · el cliente no lo ve", client: "Compartido con el cliente" });
export const MEDIA = Object.freeze({
  "application/pdf": { label: "PDF", extensions: ["pdf"] },
  "image/png": { label: "PNG", extensions: ["png"] },
  "image/jpeg": { label: "JPEG", extensions: ["jpg", "jpeg"] },
  "image/webp": { label: "WebP", extensions: ["webp"] },
});
export const ACCEPT = Object.keys(MEDIA).join(",");
export const DOCUMENT_LIMIT_PER_PROJECT = 100;

export function adaptDocument(api) {
  return {
    id: api.id,
    projectId: api.projectId,
    title: api.title,
    kind: api.kind,
    visibility: api.visibility,
    status: api.status,
    fileName: api.fileName,
    mediaType: api.mediaType,
    sizeBytes: api.sizeBytes ?? null,
    sha256: api.sha256 || null,
    version: api.version,
    uploadedAt: api.uploadedAt || null,
    archivedAt: api.archivedAt || null,
    archiveReason: api.archiveReason || "",
    createdAt: api.createdAt,
    createdBy: api.createdBy,
    date: dayOfInstant(api.uploadedAt || api.createdAt),
    time: timeOfInstant(api.uploadedAt || api.createdAt),
    // Lo que el cliente puede ver HOY: solo activo + compartido (el servidor responde 404 a todo lo demás).
    clientVisible: api.status === "active" && api.visibility === "client",
  };
}

/** 1.234 B · 12,3 KB · 4,2 MB (base 1024, como el límite del servidor). */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

const INVISIBLE_RE = new RegExp("[\\p{Cf}\\u2028\\u2029]", "u");
const hasInvisible = (value) => INVISIBLE_RE.test(value);

/** Mismas reglas que el servidor para el nombre del archivo (sin separadores, comodines, controles ni punto inicial). */
export function checkFileName(name) {
  const value = String(name ?? "").trim();
  if (value.length < 3) return "El nombre del archivo es muy corto.";
  if ([...value].length > 160) return "El nombre del archivo supera los 160 caracteres.";
  if (value.startsWith(".") || hasInvisible(value)) return "El nombre del archivo no es válido.";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127 || '\\/:*?"<>|'.includes(character)) return "El nombre del archivo no puede llevar / \\ : * ? \" < > | ni caracteres de control.";
  }
  return "";
}

/** La extensión tiene que coincidir con el tipo (el servidor lo exige). */
export function extensionMatches(mediaType, name) {
  const dot = String(name).lastIndexOf(".");
  if (dot < 1 || !MEDIA[mediaType]) return false;
  return MEDIA[mediaType].extensions.includes(String(name).slice(dot + 1).toLowerCase());
}

/**
 * Revisa un archivo elegido ANTES de pedirle nada al servidor. `file` = { name, type, size }.
 * Devuelve { error } o { fileName, mediaType }. Si se pasa `expectedType`, el archivo tiene que ser de ese tipo (subida a un registro ya creado).
 */
export function checkFile(file, { expectedType = null } = {}) {
  if (!file) return { error: "Elegí un archivo." };
  if (!MEDIA[file.type]) return { error: "Solo se admiten PDF, PNG, JPEG o WebP." };
  if (expectedType && file.type !== expectedType) return { error: `Este registro es ${MEDIA[expectedType]?.label || expectedType}: elegí un archivo del mismo tipo.` };
  if (file.size < 1) return { error: "El archivo está vacío." };
  if (file.size > MAX_DOCUMENT_BYTES) return { error: `El archivo pesa ${formatBytes(file.size)}: el máximo es 5 MB.` };
  const nameError = checkFileName(file.name);
  if (nameError) return { error: nameError };
  if (!extensionMatches(file.type, file.name)) return { error: `La extensión no coincide con el tipo (${MEDIA[file.type].label}).` };
  return { fileName: String(file.name).trim(), mediaType: file.type };
}

export const authorLabel = (adminId, me) => (!adminId ? "—" : adminId === me ? "vos" : `administrador #${shortId(adminId)}`);

/** Nombre seguro para guardar la descarga: el que registró el servidor, sin rutas. */
export const saveName = (document) => String(document.fileName || "documento").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");

/** Mensajes por paso (el 400/409 del servidor no dice el motivo). */
export function documentErrorMessage(error, step) {
  const status = error?.status;
  if (status === 413) return "El archivo supera lo que acepta el servidor (5 MB).";
  if (status === 409) {
    return {
      create: "Este proyecto ya llegó al máximo de 100 documentos, o el almacenamiento total del servidor está lleno.",
      upload: "Este registro ya tiene su archivo (se sube una sola vez) o el almacenamiento está lleno. Actualizamos la lista.",
      patch: "El documento cambió o está archivado (un archivado no se modifica). Actualizamos la lista.",
      archive: "El documento cambió o ya estaba archivado. Actualizamos la lista.",
    }[step] || null;
  }
  if (status === 400 && step === "upload") return "El servidor no aceptó el archivo: el contenido no coincide con el tipo declarado, está vacío o supera 5 MB.";
  if (status === 400 && step === "create") return "El servidor no aceptó el registro. Revisá el título y que el nombre y la extensión coincidan con el tipo.";
  if (status === 403 && step === "patch") return "Mostrarle un archivo al cliente es una publicación: hace falta el permiso updates:send además de documents:write.";
  return null;
}
