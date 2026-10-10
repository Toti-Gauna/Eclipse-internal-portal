// Cuerpos hacia la API de prospectos (leads) y lotes: esquemas estrictos del servidor (sin campos extra ni cadenas vacías).
// Cada constructor valida con mensajes en español —el servidor responde 400 genéricos— y devuelve { body } o { error }.
// Los montos del formulario son dólares; en el cuerpo van centavos enteros. Viven aparte de outbound.js para no mezclarse con
// los de proyectos y cobros (y para que las ramas de las otras secciones no choquen al unirse).
import { todayISO } from "../../rules.js";
import { isDay, parseDollars } from "./common.js";
import { CHANNELS, LANGUAGES, SOURCES, WARM_SOURCES } from "./crm.js";
import { projectCreateBody } from "./outbound.js";

const MAX_CENTS = 2_000_000_000;
const PHONE = /^\+[1-9][0-9]{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (value) => String(value ?? "").trim();
const present = (value) => text(value) !== "";
const bad = (error) => ({ error });

const hasControl = (value, multiline) => [...value].some((char) => { const code = char.charCodeAt(0); return code === 127 || (code < 32 && !(multiline && (code === 9 || code === 10 || code === 13))); });

function checkText(value, label, max, { required = false, multiline = false } = {}) {
  const v = text(value);
  if (!v) return required ? `${label}: completalo.` : "";
  if ([...v].length > max) return `${label}: máximo ${max} caracteres.`;
  if (hasControl(v, multiline)) return `${label}: tiene caracteres que no se pueden guardar.`;
  return "";
}

function checkDay(value, label, { required = false, notFuture = false, notPast = false, today = todayISO() } = {}) {
  const v = text(value);
  if (!v) return required ? `${label}: elegí una fecha.` : "";
  if (!isDay(v) || new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) !== v) return `${label}: la fecha no es válida.`;
  if (v < "2020-01-01" || v > "2100-12-31") return `${label}: tiene que estar entre 2020 y 2100.`;
  if (notFuture && v > today) return `${label}: no puede ser una fecha futura.`;
  if (notPast && v < today) return `${label}: elegí hoy o una fecha posterior.`;
  return "";
}

const firstError = (...errors) => errors.find(Boolean) || "";

function checkMoney(value, label) {
  const cents = parseDollars(value);
  if (!Number.isFinite(cents) || cents < 1) return { error: `${label}: ingresá un monto mayor a cero (hasta 2 decimales).` };
  if (cents > MAX_CENTS) return { error: `${label}: el monto es demasiado grande.` };
  return { cents };
}

/** Teléfono en formato internacional. Se aceptan espacios, guiones y paréntesis al tipear: se quitan antes de validar. */
export function normalizePhone(value) {
  const raw = text(value);
  if (!raw) return "";
  return raw.replace(/[\s().-]/g, "");
}

function checkContact(values) {
  const email = text(values.email).toLowerCase();
  const phone = normalizePhone(values.phone);
  if (email && (email.length > 254 || !EMAIL.test(email))) return { error: "Email: el formato no es válido." };
  if (phone && !PHONE.test(phone)) return { error: "Teléfono: usá formato internacional con +, por ejemplo +5491122334455." };
  return { email, phone };
}

// ---------- Prospectos ----------

/** ¿La misma persona ya está cargada? Email, teléfono exactos o nombre + empresa. Devuelve { body } o { error } (nada que buscar). */
export function duplicateCheckBody(values) {
  const contact = checkContact(values);
  if (contact.error) return bad(contact.error);
  const body = {};
  if (contact.email) body.email = contact.email;
  if (contact.phone) body.phone = contact.phone;
  if (present(values.contactName) && present(values.company)) {
    body.contactName = text(values.contactName);
    body.company = text(values.company);
  }
  if (!Object.keys(body).length) return bad("Para buscar duplicados escribí un email, un teléfono, o el nombre junto con la empresa.");
  return { body };
}

/** Firma del contacto: si cambia después de buscar duplicados, el resultado ya no vale. */
export const contactSignature = (values) => {
  const contact = checkContact(values);
  return JSON.stringify([contact.email || "", contact.phone || "", text(values.contactName).toLowerCase(), text(values.company).toLowerCase()]);
};

export function leadCreateBody(values, { today = todayISO(), canBudget = false } = {}) {
  const contact = checkContact(values);
  if (contact.error) return bad(contact.error);
  const error = firstError(
    checkText(values.contactName, "Nombre", 120, { required: true }),
    checkText(values.company, "Empresa", 160),
    checkText(values.handle, "Usuario o enlace", 120),
    CHANNELS[values.channel] ? "" : "Canal: elegí uno.",
    SOURCES[values.source] ? "" : "Fuente: elegí una.",
    checkText(values.sourceDetail, "Detalle de la fuente", 160),
    checkText(values.need, "Necesidad", 2000, { required: true, multiline: true }),
    checkText(values.vertical, "Rubro", 80),
    checkText(values.commercialNotes, "Notas comerciales", 4000, { multiline: true }),
    checkText(values.nextAction, "Próxima acción", 300, { required: true }),
    checkDay(values.nextActionOn, "Fecha de la próxima acción", { required: true, notPast: true, today }),
    checkDay(values.firstContactOn, "Primer contacto", { notFuture: true, today }),
  );
  if (error) return bad(error);
  if (!contact.email && !contact.phone && !present(values.handle)) return bad("Contacto: cargá al menos un email, un teléfono o un usuario.");
  if (WARM_SOURCES.includes(values.source) && !present(values.sourceDetail)) return bad("Detalle de la fuente: contá quién o dónde (referido, comunidad o presencial).");
  const body = {
    contactName: text(values.contactName),
    channel: values.channel,
    source: values.source,
    need: text(values.need),
    stage: values.stage === "conversation" ? "conversation" : "prospect",
    nextAction: text(values.nextAction),
    nextActionOn: text(values.nextActionOn),
    language: LANGUAGES[values.language] ? values.language : "es",
  };
  if (present(values.company)) body.company = text(values.company);
  if (contact.email) body.email = contact.email;
  if (contact.phone) body.phone = contact.phone;
  if (present(values.handle)) body.handle = text(values.handle);
  if (present(values.sourceDetail)) body.sourceDetail = text(values.sourceDetail);
  if (present(values.vertical)) body.vertical = text(values.vertical);
  if (present(values.commercialNotes)) body.commercialNotes = text(values.commercialNotes);
  if (present(values.firstContactOn)) body.firstContactOn = text(values.firstContactOn);
  if (present(values.budget)) {
    if (!canBudget) return bad("Presupuesto: tu cuenta no puede cargar importes (falta billing:write).");
    const budget = checkMoney(values.budget, "Presupuesto");
    if (budget.error) return bad(budget.error);
    body.budgetCents = budget.cents;
  }
  if (values.acknowledgeDuplicates) body.acknowledgeDuplicates = true;
  if (present(values.ownerAdminId)) body.ownerAdminId = text(values.ownerAdminId);
  return { body };
}

/** Edición: solo viaja lo que cambió (el servidor rechaza campos vacíos; null borra un dato opcional). */
export function leadPatchBody(values, lead, { today = todayISO(), canBudget = false } = {}) {
  const contact = checkContact(values);
  if (contact.error) return bad(contact.error);
  const error = firstError(
    checkText(values.contactName, "Nombre", 120, { required: true }),
    checkText(values.company, "Empresa", 160),
    checkText(values.handle, "Usuario o enlace", 120),
    CHANNELS[values.channel] ? "" : "Canal: elegí uno.",
    checkText(values.sourceDetail, "Detalle de la fuente", 160),
    checkText(values.need, "Necesidad", 2000, { required: true, multiline: true }),
    checkText(values.vertical, "Rubro", 80),
    checkText(values.commercialNotes, "Notas comerciales", 4000, { multiline: true }),
    lead.open ? checkText(values.nextAction, "Próxima acción", 300, { required: true }) : "",
    lead.open ? checkDay(values.nextActionOn, "Fecha de la próxima acción", { required: true, today }) : "",
  );
  if (error) return bad(error);
  if (!contact.email && !contact.phone && !present(values.handle)) return bad("Contacto: tiene que quedar al menos un email, un teléfono o un usuario.");
  if (WARM_SOURCES.includes(lead.source) && !present(values.sourceDetail)) return bad("Detalle de la fuente: contá quién o dónde (referido, comunidad o presencial).");
  const body = { version: lead.version };
  const set = (key, next, previous) => { if (next !== previous) body[key] = next; };
  set("contactName", text(values.contactName), lead.name);
  set("company", present(values.company) ? text(values.company) : null, lead.company);
  set("email", contact.email || null, lead.email);
  set("phone", contact.phone || null, lead.phone);
  set("handle", present(values.handle) ? text(values.handle) : null, lead.handle);
  set("channel", values.channel, lead.channel);
  set("sourceDetail", present(values.sourceDetail) ? text(values.sourceDetail) : null, lead.sourceDetail);
  set("need", text(values.need), lead.need);
  set("vertical", present(values.vertical) ? text(values.vertical) : null, lead.vertical);
  if (LANGUAGES[values.language]) set("language", values.language, lead.language);
  set("commercialNotes", present(values.commercialNotes) ? text(values.commercialNotes) : null, lead.commercialNotes);
  if (canBudget && "budget" in values) {
    if (present(values.budget)) {
      const budget = checkMoney(values.budget, "Presupuesto");
      if (budget.error) return bad(budget.error);
      set("budgetCents", budget.cents, lead.budgetCents);
    } else set("budgetCents", null, lead.budgetCents);
  }
  if (present(values.ownerAdminId)) set("ownerAdminId", text(values.ownerAdminId), lead.ownerAdminId);
  if (lead.open) {
    set("nextAction", text(values.nextAction), lead.nextAction);
    set("nextActionOn", text(values.nextActionOn), lead.nextActionOn);
  }
  if (Object.keys(body).length === 1) return bad("No cambiaste nada.");
  return { body };
}

/** Cambio de etapa. `won` jamás sale de acá: solo la conversión crea una venta. */
export function stageBody(values, lead, { today = todayISO() } = {}) {
  const stage = values.stage;
  if (stage === "won") return bad("«Ganado» solo se logra convirtiendo el prospecto en proyecto, con acuerdo y seña cobrada.");
  if (!["prospect", "conversation", "demo", "proposal", "negotiation", "paused", "lost"].includes(stage)) return bad("Elegí la etapa.");
  if (stage === lead.stage) return bad("El prospecto ya está en esa etapa.");
  const body = { version: lead.version, stage };
  if (stage === "paused") {
    if (!lead.open) return bad("Solo se pausa un prospecto que se está trabajando.");
    const error = firstError(checkText(values.reason, "Motivo de la pausa", 500, { required: true }), checkDay(values.reviewOn, "Revisar el", { required: true, notPast: true, today }));
    if (error) return bad(error);
    body.reason = text(values.reason);
    body.reviewOn = text(values.reviewOn);
    return { body };
  }
  if (stage === "lost") {
    const error = checkText(values.reason, "Motivo", 500);
    if (error) return bad(error);
    if (present(values.reason)) body.reason = text(values.reason);
    return { body };
  }
  // Etapas de trabajo: el servidor exige responsable y próxima acción con fecha.
  const error = firstError(checkText(values.nextAction, "Próxima acción", 300, { required: !lead.nextAction }), checkDay(values.nextActionOn, "Fecha de la próxima acción", { required: !lead.nextActionOn, notPast: true, today }), checkText(values.reason, "Nota del cambio", 500));
  if (error) return bad(error);
  if (present(values.nextAction) !== present(values.nextActionOn) && !(lead.nextAction && lead.nextActionOn)) return bad("La próxima acción necesita texto y fecha.");
  if (present(values.nextAction)) body.nextAction = text(values.nextAction);
  if (present(values.nextActionOn)) body.nextActionOn = text(values.nextActionOn);
  if (present(values.reason)) body.reason = text(values.reason);
  return { body };
}

export function consentBody(values, lead, { today = todayISO() } = {}) {
  if (!Object.keys({ unknown: 1, granted: 1, denied: 1, withdrawn: 1 }).includes(values.status)) return bad("Elegí el estado del consentimiento.");
  const error = firstError(checkText(values.basis, "Base o motivo", 300), checkDay(values.on, "Fecha", { notFuture: true, today }));
  if (error) return bad(error);
  const leaving = ["denied", "withdrawn"].includes(lead.consent.status) && ["granted", "unknown"].includes(values.status);
  if (leaving && !present(values.basis)) return bad("Para salir de un rechazo o una retirada hace falta registrar la base: cómo y cuándo volvió a aceptar.");
  const body = { version: lead.version, status: values.status };
  if (present(values.on)) body.on = text(values.on);
  if (present(values.basis)) body.basis = text(values.basis);
  return { body };
}

export function duplicateOfBody(values, lead) {
  const canonicalId = text(values.canonicalId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(canonicalId)) return bad("Elegí el prospecto principal (o pegá su ID completo).");
  if (canonicalId === lead.id) return bad("Un prospecto no puede ser duplicado de sí mismo.");
  return { body: { version: lead.version, canonicalId } };
}

/** Hora real opcional (HH:MM del día informado) → instante ISO. Sin hora no se manda nada: «Hora no registrada». */
export function occurredAtOf(day, time) {
  if (!present(time)) return null;
  const instant = new Date(`${day}T${text(time)}:00`);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/** Registro de una actividad. Nota = interna; propuesta = saliente; el resto necesita dirección. */
export function activityBody(values, lead, { today = todayISO(), now = new Date(), canMoney = false } = {}) {
  const kinds = ["note", "call", "message", "meeting", "demo", "proposal_sent", "follow_up"];
  const kind = values.kind;
  if (!kinds.includes(kind)) return bad("Elegí qué pasó.");
  const error = firstError(
    checkDay(values.occurredOn, "Fecha", { required: true, notFuture: true, today }),
    checkText(values.summary, "Qué pasó", 2000, { required: true, multiline: true }),
    checkText(values.outcome, "Resultado", 500),
    checkText(values.nextAction, "Próxima acción", 300),
    checkDay(values.nextActionOn, "Fecha de la próxima acción", { today }),
  );
  if (error) return bad(error);
  if (lead.firstContactOn && values.occurredOn < lead.firstContactOn) return bad(`Fecha: no puede ser anterior al primer contacto (${lead.firstContactOn}).`);
  if (present(values.nextAction) !== present(values.nextActionOn)) return bad("La próxima acción necesita texto y fecha, o dejá las dos vacías.");
  const direction = kind === "note" ? "internal" : kind === "proposal_sent" ? "outbound" : values.direction;
  if (kind !== "note" && !["inbound", "outbound"].includes(direction)) return bad("Elegí si fue entrante o saliente.");
  if (direction === "outbound" && lead.doNotContact) return bad("El consentimiento está rechazado o retirado: no se registran contactos salientes. Cambiá el consentimiento antes, con su base.");
  const body = { kind, occurredOn: text(values.occurredOn), summary: text(values.summary) };
  if (kind !== "note" && kind !== "proposal_sent") body.direction = direction;
  if (CHANNELS[values.channel]) body.channel = values.channel;
  if (present(values.occurredAt)) {
    const at = occurredAtOf(body.occurredOn, values.occurredAt);
    if (!at) return bad("Hora: no es válida.");
    if (new Date(at).getTime() > now.getTime() + 60_000) return bad("Hora: no puede estar en el futuro.");
    body.occurredAt = at;
  }
  if (present(values.outcome)) body.outcome = text(values.outcome);
  if (present(values.amount)) {
    if (kind !== "proposal_sent") return bad("El monto solo se registra en una propuesta enviada.");
    if (!canMoney) return bad("Monto: tu cuenta no puede cargar importes (falta billing:write).");
    const amount = checkMoney(values.amount, "Monto de la propuesta");
    if (amount.error) return bad(amount.error);
    body.amountCents = amount.cents;
  }
  if (present(values.nextAction)) {
    body.nextAction = text(values.nextAction);
    body.nextActionOn = text(values.nextActionOn);
  }
  return { body };
}

export function voidBody(values) {
  const error = checkText(values.reason, "Motivo", 500, { required: true });
  return error ? bad(error) : { body: { reason: text(values.reason) } };
}

export function fromPlanRequestBody(values, request, { today = todayISO() } = {}) {
  const error = firstError(checkText(values.nextAction, "Próxima acción", 300, { required: true }), checkDay(values.nextActionOn, "Fecha de la próxima acción", { required: true, notPast: true, today }));
  if (error) return bad(error);
  if (!request?.id) return bad("La solicitud ya no está cargada.");
  const body = { planRequestId: request.id, nextAction: text(values.nextAction), nextActionOn: text(values.nextActionOn) };
  if (present(values.ownerAdminId)) body.ownerAdminId = text(values.ownerAdminId);
  return { body };
}

/** Conversión en proyecto: la versión del lead + el mismo cuerpo de «proyecto con seña» de la etapa 1. */
export function convertBody(values, lead, options = {}) {
  if (!lead?.open) return bad("Solo se convierte un prospecto que se está trabajando (no pausado, perdido, duplicado ni ganado).");
  const project = projectCreateBody(values, options);
  if (project.error) return project;
  return { body: { version: lead.version, project: project.body } };
}

// ---------- Lotes ----------

const batchFields = (values, today, { creating }) => firstError(
  checkText(values.name, "Nombre del lote", 120, { required: true }),
  checkText(values.vertical, "Vertical", 80),
  checkText(values.hypothesis, "Hipótesis", 1000, { multiline: true }),
  checkText(values.demo, "Demo base", 300),
  checkDay(values.plannedOn, "Envío planificado", { today, notPast: creating }),
);

export function batchCreateBody(values, { today = todayISO() } = {}) {
  const error = batchFields(values, today, { creating: true });
  if (error) return bad(error);
  const target = Number(text(values.target));
  if (!Number.isInteger(target) || target < 1 || target > 1000) return bad("Objetivo de contactos: un entero entre 1 y 1000.");
  const signalDays = Number(text(values.signalDays) || 2);
  const closeDays = Number(text(values.closeDays) || 7);
  if (!Number.isInteger(signalDays) || signalDays < 1 || signalDays > 30) return bad("Leer la señal: entre 1 y 30 días desde D0.");
  if (!Number.isInteger(closeDays) || closeDays < 2 || closeDays > 60) return bad("Cerrar el informe: entre 2 y 60 días desde D0.");
  if (closeDays <= signalDays) return bad("El cierre del lote tiene que ocurrir después de leer la señal.");
  const body = { name: text(values.name), target, signalDays, closeDays };
  for (const key of ["vertical", "hypothesis", "demo", "plannedOn"]) if (present(values[key])) body[key] = text(values[key]);
  return { body };
}

export function batchPatchBody(values, batch, { today = todayISO() } = {}) {
  if (!batch.open) return bad("Un lote cerrado no se edita.");
  const error = batchFields(values, today, { creating: false });
  if (error) return bad(error);
  const target = Number(text(values.target));
  if (!Number.isInteger(target) || target < 1 || target > 1000) return bad("Objetivo de contactos: un entero entre 1 y 1000.");
  const body = { version: batch.version };
  const set = (key, next, previous) => { if (next !== previous) body[key] = next; };
  set("name", text(values.name), batch.name);
  for (const key of ["vertical", "hypothesis", "demo", "plannedOn"]) set(key, present(values[key]) ? text(values[key]) : null, batch[key]);
  set("target", target, batch.target);
  if (Object.keys(body).length === 1) return bad("No cambiaste nada.");
  return { body };
}

export function batchSentBody(values, batch, { today = todayISO() } = {}) {
  if (batch.status !== "planned") return bad("El envío D0 ya está registrado.");
  const error = checkDay(values.sentOn, "Fecha de envío (D0)", { required: true, notFuture: true, today });
  if (error) return bad(error);
  const body = { version: batch.version, sentOn: text(values.sentOn) };
  if (present(values.sentCount)) {
    const count = Number(text(values.sentCount));
    if (!Number.isInteger(count) || count < 0 || count > 100000) return bad("Mensajes enviados: un entero de 0 en adelante.");
    body.sentCount = count;
  }
  return { body };
}

export function batchSignalBody(values, batch, { today = todayISO() } = {}) {
  if (batch.status !== "sent" || batch.signalOn) return bad("La señal se registra una sola vez, después de D0.");
  const error = firstError(checkDay(values.on, "Fecha de la lectura", { required: true, notFuture: true, today }), checkText(values.note, "Qué señal hay", 500, { required: true }));
  if (error) return bad(error);
  if (batch.sentOn && values.on < batch.sentOn) return bad("La señal no puede ser anterior al envío D0.");
  return { body: { version: batch.version, on: text(values.on), note: text(values.note) } };
}

export function batchCloseBody(values, batch, { today = todayISO() } = {}) {
  if (batch.status !== "sent") return bad("Para cerrar el lote primero registrá el envío D0.");
  const error = firstError(
    checkDay(values.closedOn, "Fecha de cierre", { required: true, notFuture: true, today }),
    checkText(values.worked, "Qué funcionó", 500, { required: true, multiline: true }),
    checkText(values.notWorked, "Qué no funcionó", 500, { required: true, multiline: true }),
    checkText(values.change, "Qué cambio la próxima", 500, { required: true, multiline: true }),
  );
  if (error) return bad(error);
  if (batch.sentOn && values.closedOn < batch.sentOn) return bad("El cierre no puede ser anterior al envío D0.");
  return { body: { version: batch.version, closedOn: text(values.closedOn), worked: text(values.worked), notWorked: text(values.notWorked), change: text(values.change) } };
}

/** Sumar o sacar prospectos de un lote abierto. Se manda solo la lista de ids (1–100, sin repetir). */
export function batchLeadsBody(leadIds) {
  const ids = [...new Set((leadIds || []).filter(Boolean))];
  if (!ids.length) return bad("Elegí al menos un prospecto.");
  if (ids.length > 100) return bad("Hasta 100 prospectos por vez.");
  return { body: { leadIds: ids } };
}
