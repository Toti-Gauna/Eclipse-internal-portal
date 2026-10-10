// De los valores de un formulario del portal al cuerpo EXACTO que espera la API (esquemas estrictos: no se aceptan
// campos extra ni cadenas vacías). Cada constructor valida con mensajes en español, porque el servidor responde 400
// genéricos. Devuelven { body } o { error }. Los montos del formulario son dólares; en el cuerpo van centavos enteros.
import { todayISO } from "../../rules.js";
import { isDay, parseDollars } from "./common.js";

const MAX_CENTS = 2_000_000_000;
const text = (value) => String(value ?? "").trim();
const present = (value) => text(value) !== "";
const bad = (error) => ({ error });

/** Texto sin caracteres de control (salvo saltos de línea y tabulaciones en textos largos), como exige el servidor. */
const hasControl = (value, multiline) => [...value].some((char) => { const code = char.charCodeAt(0); return code === 127 || (code < 32 && !(multiline && (code === 9 || code === 10 || code === 13))); });

function checkText(value, label, max, { required = false, multiline = false } = {}) {
  const v = text(value);
  if (!v) return required ? `${label}: completalo.` : "";
  if ([...v].length > max) return `${label}: máximo ${max} caracteres.`;
  if (hasControl(v, multiline)) return `${label}: tiene caracteres que no se pueden guardar.`;
  return "";
}

function checkDay(value, label, { required = false, notFuture = false, today = todayISO() } = {}) {
  const v = text(value);
  if (!v) return required ? `${label}: elegí una fecha.` : "";
  if (!isDay(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`)) || new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) !== v) return `${label}: la fecha no es válida.`;
  if (v < "2020-01-01" || v > "2100-12-31") return `${label}: tiene que estar entre 2020 y 2100.`;
  if (notFuture && v > today) return `${label}: no puede ser una fecha futura.`;
  return "";
}

const firstError = (...errors) => errors.find(Boolean) || "";

function checkMoney(value, label) {
  const cents = parseDollars(value);
  if (!Number.isFinite(cents) || cents < 1) return { error: `${label}: ingresá un monto mayor a cero (hasta 2 decimales).` };
  if (cents > MAX_CENTS) return { error: `${label}: el monto es demasiado grande.` };
  return { cents };
}

/** Un ítem por línea, 1–30 ítems de hasta 200 caracteres. */
export function parseScopeItems(value) {
  return String(value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

// ---------- Proyecto ----------

export function projectCreateBody(values, { today = todayISO() } = {}) {
  const error = firstError(
    checkText(values.name, "Proyecto", 120, { required: true }),
    checkText(values.service, "Servicio", 160, { required: true }),
    values.organizationId ? "" : checkText(values.organizationName || values.name, "Cliente u organización", 120, { required: true }),
    checkText(values.agreementReference, "Referencia del acuerdo", 160, { required: true }),
    checkDay(values.acceptedOn, "Fecha del acuerdo", { required: true, notFuture: true, today }),
    checkDay(values.receivedOn, "Fecha de cobro de la seña", { required: true, notFuture: true, today }),
    checkDay(values.startedOn, "Inicio", { today }),
    checkDay(values.plannedEndOn, "Entrega estimada", { today }),
    checkText(values.depositReference, "Referencia del cobro", 160),
    checkText(values.depositNote, "Nota del cobro", 500),
  );
  if (error) return bad(error);
  const price = checkMoney(values.price, "Precio acordado");
  if (price.error) return bad(price.error);
  const deposit = checkMoney(values.depositAmount, "Seña cobrada");
  if (deposit.error) return bad(deposit.error);
  if (deposit.cents > price.cents) return bad("La seña no puede superar el precio acordado.");
  if (present(values.startedOn) && present(values.plannedEndOn) && values.plannedEndOn < values.startedOn) return bad("La entrega estimada tiene que ser igual o posterior al inicio.");
  const items = parseScopeItems(values.scopeItems);
  if (!items.length) return bad("Alcance: escribí al menos un entregable (uno por línea).");
  if (items.length > 30) return bad("Alcance: hasta 30 entregables.");
  if (items.some((item) => [...item].length > 200)) return bad("Alcance: cada entregable admite hasta 200 caracteres.");
  if (items.some((item) => hasControl(item, false))) return bad("Alcance: hay caracteres que no se pueden guardar.");
  const members = (values.memberClientIds || []).filter(Boolean).map((clientId) => ({ clientId, role: values.memberRole || "client_admin" }));
  if (members.length > 10) return bad("Hasta 10 personas del cliente por proyecto.");
  const body = {
    organization: values.organizationId ? { id: values.organizationId } : { name: text(values.organizationName || values.name) },
    name: text(values.name),
    service: text(values.service),
    currency: "USD",
    agreement: { reference: text(values.agreementReference), acceptedOn: text(values.acceptedOn), priceCents: price.cents, scopeItems: items },
    deposit: { amountCents: deposit.cents, receivedOn: text(values.receivedOn) },
    members,
  };
  if (present(values.sourcePlanRequestId)) body.sourcePlanRequestId = text(values.sourcePlanRequestId);
  if (present(values.startedOn)) body.startedOn = text(values.startedOn);
  if (present(values.plannedEndOn)) body.plannedEndOn = text(values.plannedEndOn);
  if (present(values.depositReference)) body.deposit.reference = text(values.depositReference);
  if (present(values.depositNote)) body.deposit.note = text(values.depositNote);
  return { body };
}

export function projectPatchBody(values, project) {
  const error = firstError(
    checkText(values.name, "Proyecto", 120, { required: true }),
    checkText(values.service, "Servicio", 160, { required: true }),
    checkDay(values.startedOn, "Inicio"),
    checkDay(values.plannedEndOn, "Entrega estimada"),
  );
  if (error) return bad(error);
  if (present(values.startedOn) && present(values.plannedEndOn) && values.plannedEndOn < values.startedOn) return bad("La entrega estimada tiene que ser igual o posterior al inicio.");
  const body = { version: project.version };
  if (text(values.name) !== project.name) body.name = text(values.name);
  if (text(values.service) !== project.service) body.service = text(values.service);
  const started = present(values.startedOn) ? text(values.startedOn) : null;
  const planned = present(values.plannedEndOn) ? text(values.plannedEndOn) : null;
  if (started !== (project.live?.startedOn ?? null)) body.startedOn = started;
  if (planned !== (project.live?.plannedEndOn ?? null)) body.plannedEndOn = planned;
  if (Object.keys(body).length === 1) return bad("No cambiaste nada.");
  return { body };
}

export function transitionBody(kind, values, project, { today = todayISO() } = {}) {
  const base = { version: project.version };
  switch (kind) {
    case "advance": {
      if (!values.stage) return bad("Elegí la etapa.");
      return { body: { ...base, stage: values.stage } };
    }
    case "pause": {
      const error = firstError(checkText(values.reason, "Motivo", 500, { required: true }), checkDay(values.reviewOn, "Revisar el", { required: true, today }));
      if (error) return bad(error);
      if (values.reviewOn < today) return bad("Revisar el: elegí hoy o una fecha posterior.");
      return { body: { ...base, status: "paused", reason: text(values.reason), reviewOn: text(values.reviewOn) } };
    }
    case "resume":
      return { body: { ...base, status: "active" } };
    case "close": {
      const error = firstError(checkText(values.reason, "Motivo del cierre", 500, { required: true }), checkDay(values.completedOn, "Fecha de cierre", { notFuture: true, today }));
      if (error) return bad(error);
      const body = { ...base, status: "closed", reason: text(values.reason) };
      if (present(values.completedOn)) body.completedOn = text(values.completedOn);
      return { body };
    }
    default: return bad("Acción de proyecto desconocida.");
  }
}

// ---------- Hitos ----------

export function milestoneCreateBody(values, { today = todayISO() } = {}) {
  const error = firstError(
    checkText(values.title, "Hito", 160, { required: true }),
    checkText(values.description, "Descripción", 2000, { multiline: true }),
    checkDay(values.plannedOn, "Fecha estimada", { today }),
    checkText(values.internalNotes, "Notas internas", 4000, { multiline: true }),
  );
  if (error) return bad(error);
  if (!values.stage) return bad("Elegí la etapa del hito.");
  const body = { stage: values.stage, title: text(values.title), ownerParty: values.ownerParty === "client" ? "client" : "eclipse" };
  if (present(values.description)) body.description = text(values.description);
  if (present(values.plannedOn)) body.plannedOn = text(values.plannedOn);
  if (present(values.internalNotes)) body.internalNotes = text(values.internalNotes);
  return { body };
}

export function milestonePatchBody(values, milestone, { today = todayISO() } = {}) {
  const error = firstError(
    checkText(values.title, "Hito", 160, { required: true }),
    checkText(values.description, "Descripción", 2000, { multiline: true }),
    checkDay(values.plannedOn, "Fecha estimada", { today }),
  );
  if (error) return bad(error);
  const body = { version: milestone.version };
  if (text(values.title) !== milestone.title) body.title = text(values.title);
  if (text(values.description) !== milestone.description) body.description = present(values.description) ? text(values.description) : null;
  if ((text(values.plannedOn) || null) !== milestone.plannedOn) body.plannedOn = present(values.plannedOn) ? text(values.plannedOn) : null;
  if (values.stage && values.stage !== milestone.apiStage) body.stage = values.stage;
  if (values.status && values.status !== milestone.status && values.status !== "done") body.status = values.status;
  const ownerParty = values.ownerParty === "client" ? "client" : "eclipse";
  if (ownerParty !== milestone.ownerParty) body.ownerParty = ownerParty;
  if (Object.keys(body).length === 1) return bad("No cambiaste nada.");
  return { body };
}

/** Completar exige fecha real (no futura) y evidencia: nada se inventa. */
export function milestoneCompleteBody(values, milestone, { today = todayISO() } = {}) {
  const error = firstError(checkDay(values.actualOn, "Fecha en que se cumplió", { required: true, notFuture: true, today }), checkText(values.evidence, "Evidencia", 2000, { required: true, multiline: true }));
  if (error) return bad(error);
  return { body: { version: milestone.version, status: "done", actualOn: text(values.actualOn), evidence: text(values.evidence) } };
}

export function milestoneVisibilityBody(milestone, visible) {
  return { body: { version: milestone.version, visible: Boolean(visible), confirm: true } };
}

// ---------- Actualizaciones ----------

export function updateCreateBody(values, { today = todayISO() } = {}) {
  const kinds = ["internal_note", "client_update", "action_required", "status_change"];
  if (!kinds.includes(values.kind)) return bad("Elegí qué tipo de registro es.");
  const error = firstError(
    checkText(values.title, "Título", 160, { required: values.kind !== "internal_note" }),
    checkText(values.body, "Detalle", 4000, { required: true, multiline: true }),
    checkDay(values.dueOn, "Para cuándo", { today }),
  );
  if (error) return bad(error);
  const body = { kind: values.kind, body: text(values.body) };
  if (present(values.title)) body.title = text(values.title);
  if (present(values.dueOn) && values.kind === "action_required") body.dueOn = text(values.dueOn);
  return { body };
}

export function updatePatchBody(values, update, { today = todayISO() } = {}) {
  const error = firstError(checkText(values.title, "Título", 160), checkText(values.body, "Detalle", 4000, { required: true, multiline: true }), checkDay(values.dueOn, "Para cuándo", { today }));
  if (error) return bad(error);
  const body = { version: update.version };
  if (text(values.title) !== update.title) body.title = present(values.title) ? text(values.title) : null;
  if (text(values.body) !== update.body) body.body = text(values.body);
  if (update.kind === "action_required" && (text(values.dueOn) || null) !== update.dueOn) body.dueOn = present(values.dueOn) ? text(values.dueOn) : null;
  if (Object.keys(body).length === 1) return bad("No cambiaste nada.");
  return { body };
}

/** Publicar exige confirmación explícita del operador: sin `confirm` no sale ni un borrador. */
export function updatePublishBody(update, confirmed) {
  if (!confirmed) return bad("Marcá la confirmación: el cliente va a ver este texto.");
  return { body: { version: update.version, confirm: true } };
}

export function updateWithdrawBody(update, reason) {
  const error = checkText(reason, "Motivo", 500, { required: true });
  return error ? bad(error) : { body: { version: update.version, reason: text(reason) } };
}

// ---------- Cobros ----------

export function paymentCreateBody(values, { today = todayISO() } = {}) {
  if (!["deposit", "installment", "final", "maintenance"].includes(values.kind)) return bad("Elegí el tipo de cobro.");
  if (!["proposed", "committed", "collected"].includes(values.status)) return bad("Elegí el estado del cobro.");
  const error = firstError(
    checkDay(values.dueOn, "Vencimiento", { required: values.status === "committed", today }),
    checkDay(values.receivedOn, "Fecha de cobro", { required: values.status === "collected", notFuture: true, today }),
    checkText(values.reference, "Referencia", 160),
    checkText(values.note, "Nota", 500),
  );
  if (error) return bad(error);
  const amount = checkMoney(values.amount, "Monto");
  if (amount.error) return bad(amount.error);
  const body = { kind: values.kind, status: values.status, amountCents: amount.cents, currency: "USD" };
  if (present(values.dueOn)) body.dueOn = text(values.dueOn);
  if (values.status === "collected" && present(values.receivedOn)) body.receivedOn = text(values.receivedOn);
  if (present(values.reference)) body.reference = text(values.reference);
  if (present(values.note)) body.note = text(values.note);
  return { body };
}

export function paymentTransitionBody(to, values, payment, { today = todayISO() } = {}) {
  const base = { version: payment.version };
  if (to === "committed") {
    const error = checkDay(values.dueOn, "Vencimiento", { required: true, today });
    return error ? bad(error) : { body: { ...base, status: "committed", dueOn: text(values.dueOn) } };
  }
  if (to === "collected") {
    const error = checkDay(values.receivedOn, "Fecha de cobro", { required: true, notFuture: true, today });
    return error ? bad(error) : { body: { ...base, status: "collected", receivedOn: text(values.receivedOn) } };
  }
  if (to === "voided") {
    const error = checkText(values.reason, "Motivo de la anulación", 500, { required: true });
    return error ? bad(error) : { body: { ...base, status: "voided", reason: text(values.reason) } };
  }
  return bad("Transición de cobro desconocida.");
}

// ---------- Solicitudes ----------

export function reviewBody(values, request) {
  if (!["under_review", "reviewed", "accepted", "rejected"].includes(values.status)) return bad("Elegí cómo queda la solicitud.");
  const error = firstError(checkText(values.publicResponse, "Respuesta para el cliente", 4000, { multiline: true }), checkText(values.internalNote, "Nota interna", 4000, { multiline: true }));
  if (error) return bad(error);
  const body = { version: request.version, status: values.status };
  // Omitir conserva; vacío borra (null). Solo se envía lo que cambió.
  if (text(values.publicResponse) !== text(request.publicResponse)) body.publicResponse = present(values.publicResponse) ? text(values.publicResponse) : null;
  if (text(values.internalNote) !== text(request.internalNote)) body.internalNote = present(values.internalNote) ? text(values.internalNote) : null;
  return { body };
}

// ---------- Miembros y cambios de alcance ----------

export function memberBody(clientId, role) {
  if (!clientId) return bad("Buscá primero la cuenta del cliente por su email.");
  return { body: { clientId, role: role === "client_collaborator" ? "client_collaborator" : "client_admin" } };
}

export function changeRequestCreateBody(values) {
  const error = firstError(checkText(values.title, "Título", 160, { required: true }), checkText(values.description, "Descripción", 4000, { required: true, multiline: true }));
  if (error) return bad(error);
  return { body: { origin: values.origin === "client" ? "client" : "eclipse", title: text(values.title), description: text(values.description) } };
}

export function changeEvaluateBody(values, change) {
  const error = firstError(checkText(values.technicalAssessment, "Evaluación técnica", 4000, { multiline: true }), checkText(values.commercialDecision, "Criterio comercial", 4000, { multiline: true }));
  if (error) return bad(error);
  const body = { version: change.version, status: values.status };
  if (!["evaluating", "estimated", "closed"].includes(values.status)) return bad("Elegí el estado.");
  const int = (value, label, min, max) => {
    if (!present(value)) return { value: null };
    const n = Number(String(value).trim());
    if (!Number.isInteger(n) || n < min || n > max) return { error: `${label}: ingresá un número entero entre ${min} y ${max}.` };
    return { value: n };
  };
  const hours = int(values.hoursImpact, "Horas", 0, 100000);
  const days = int(values.scheduleImpactDays, "Días de plazo", -3650, 3650);
  if (hours.error || days.error) return bad(hours.error || days.error);
  let priceCents = null;
  if (present(values.priceImpact)) {
    const negative = text(values.priceImpact).startsWith("-");
    const cents = parseDollars(text(values.priceImpact).replace(/^-/, ""));
    if (!Number.isFinite(cents)) return bad("Impacto en precio: ingresá un monto válido (puede ser negativo).");
    priceCents = negative ? -cents : cents;
  }
  if (values.status === "estimated" && (hours.value === null || days.value === null || priceCents === null)) return bad("Para marcarlo como estimado hacen falta horas, precio y plazo.");
  body.hoursImpact = hours.value;
  body.scheduleImpactDays = days.value;
  body.priceImpactCents = priceCents;
  body.technicalAssessment = present(values.technicalAssessment) ? text(values.technicalAssessment) : null;
  body.commercialDecision = present(values.commercialDecision) ? text(values.commercialDecision) : null;
  return { body };
}

export function changeDecisionBody(values, change, { today = todayISO() } = {}) {
  if (values.decision === "rejected") {
    const error = checkText(values.commercialDecision, "Motivo", 4000, { multiline: true });
    if (error) return bad(error);
    const body = { version: change.version, decision: "rejected" };
    if (present(values.commercialDecision)) body.commercialDecision = text(values.commercialDecision);
    return { body };
  }
  const items = parseScopeItems(values.scopeItems);
  const error = firstError(checkText(values.reference, "Referencia de la aceptación", 160, { required: true }), checkDay(values.acceptedOn, "Fecha de la aceptación", { required: true, notFuture: true, today }));
  if (error) return bad(error);
  if (!items.length || items.length > 30) return bad("Alcance nuevo: entre 1 y 30 entregables, uno por línea.");
  if (items.some((item) => [...item].length > 200)) return bad("Alcance nuevo: cada entregable admite hasta 200 caracteres.");
  return { body: { version: change.version, decision: "accepted", acceptance: { reference: text(values.reference), acceptedOn: text(values.acceptedOn), scopeItems: items } } };
}
