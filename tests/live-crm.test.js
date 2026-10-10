import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_CHIPS, activityTitle, adaptActivity, adaptAuditEvent, adaptBatch, adaptLead, auditChange, batchNextAction, contactLine, keyQuery, lastProposal, leadQuery, ownerLabel, queryKey, railDates,
  ruleNextAction, stageBeforePause, stageTargets, visibleInChip,
} from "../src/live/adapters/crm.js";
import * as out from "../src/live/adapters/crm-outbound.js";

process.env.TZ = "America/Argentina/Buenos_Aires";
const TODAY = "2026-10-10";
const ID = "3931ac6f-f567-48a5-8561-604f9b909108";
const OTHER = "0d6c4f47-92b5-4b4d-a1a1-5c0c1b3c2d10";
const ME = "6f1c8a52-b1c3-4e0f-8f6a-0f7d55c9f111";

const apiLead = {
  id: ID, contactName: "Clínica <b>Aurora</b>", company: "Aurora S.A.", email: "hola@aurora.test", phone: null, handle: null, channel: "whatsapp", source: "referral", sourceDetail: "Dra. Pérez", warm: true,
  planRequestId: null, need: "Turnos online", vertical: "Clínicas", language: "es", budgetCents: 150000, commercialNotes: null, stage: "conversation", stageReason: null, reviewOn: null,
  ownerAdminId: ME, nextAction: "Llamar", nextActionOn: "2026-10-11", overdue: false, consent: { status: "granted", on: "2026-10-01", basis: "WhatsApp del 1/10" }, doNotContact: false,
  firstContactOn: "2026-10-01", firstConversationOn: "2026-10-03", batchId: null, duplicateOfId: null, projectId: null, convertedAt: null, isExample: false, version: 4,
  createdAt: "2026-10-01T15:00:00.000Z", updatedAt: "2026-10-03T15:00:00.000Z", possibleDuplicates: [{ id: OTHER, matchedOn: ["email"] }],
};
const lead = (patch = {}) => adaptLead({ ...apiLead, ...patch });

const act = (patch) => adaptActivity({ id: patch.id || "a1", leadId: ID, kind: "note", direction: "internal", channel: null, occurredOn: "2026-10-03", occurredAt: null, summary: "x", outcome: null, batchId: null, actorAdminId: ME, recordedAt: "2026-10-03T15:00:00.000Z", voided: false, voidReason: null, voidedAt: null, ...patch });

test("lead: se conserva el UUID, el texto crudo (se escapa al dibujar) y el presupuesto solo si el servidor lo mandó", () => {
  const model = lead();
  assert.equal(model.id, ID);
  assert.equal(model.name, "Clínica <b>Aurora</b>");
  assert.equal(model.stageLabel, "Conversación");
  assert.equal(model.budgetCents, 150000);
  assert.equal(model.open, true);
  assert.equal(model.sourceLabel, "Referido");
  assert.equal(model.possibleDuplicates[0].id, OTHER);
  const { budgetCents, ...withoutMoney } = apiLead;
  void budgetCents;
  assert.equal(adaptLead(withoutMoney).budgetCents, null, "sin billing:read no se inventa un presupuesto");
  assert.equal(lead({ stage: "won", projectId: OTHER, convertedAt: "2026-10-09T02:30:00.000Z" }).convertedOn, "2026-10-08", "el día local del instante de conversión");
  assert.equal(lead({ stage: "paused" }).open, false);
  assert.equal(contactLine(lead({ email: null, phone: "+5491122334455" })), "+5491122334455");
});

test("responsable: «Vos» para la cuenta actual, prefijo del UUID para el resto (la API no expone nombres)", () => {
  assert.equal(ownerLabel(ME, ME), "Vos");
  assert.equal(ownerLabel(OTHER, ME), "Admin #0d6c4f47");
  assert.equal(ownerLabel(null, ME), "—");
});

test("actividad: sin instante no hay hora, lo del sistema se marca y el monto solo existe con billing:read", () => {
  const plain = act({ kind: "call", direction: "outbound", channel: "phone", summary: "Llamé", occurredAt: null });
  assert.equal(plain.time, null, "«Hora no registrada»: nunca se inventa");
  assert.equal(plain.title, "Llamada hecha");
  assert.equal(plain.amountCents, null);
  const timed = act({ kind: "message", direction: "inbound", occurredAt: "2026-10-03T16:27:00.000Z", summary: "Hola" });
  assert.equal(timed.time, "13:27");
  assert.equal(timed.title, "Respondió");
  assert.equal(act({ kind: "stage_change", direction: "internal" }).system, true);
  assert.equal(act({ kind: "proposal_sent", direction: "outbound", amountCents: 90000 }).amountCents, 90000);
  assert.equal(act({ kind: "follow_up", direction: "outbound" }).title, "Toque de seguimiento");
  assert.equal(activityTitle({ kind: "conversion", direction: "internal" }), "Convertido en proyecto");
  assert.equal(act({ voided: true, voidReason: "duplicada", voidedAt: "2026-10-04T01:00:00.000Z" }).voidedOn, "2026-10-03");
});

test("regla de la casa: llamada el mismo día, propuesta ≤24 h y toques +2/+5/+9 con el historial real", () => {
  assert.deepEqual(ruleNextAction(lead({ stage: "conversation" }), []).kind, "llamada");
  assert.equal(ruleNextAction(lead({ stage: "conversation" }), []).due, "2026-10-03", "el día que respondió");
  const demo = [act({ id: "d", kind: "demo", direction: "outbound", occurredOn: "2026-10-05" })];
  assert.deepEqual(ruleNextAction(lead({ stage: "demo" }), demo), { kind: "propuesta", title: "Enviar propuesta (≤24 h de la demo)", due: "2026-10-06" });
  const proposal = act({ id: "p", kind: "proposal_sent", direction: "outbound", occurredOn: "2026-10-06" });
  assert.equal(ruleNextAction(lead({ stage: "proposal" }), [proposal]).title, "Toque 1 de 3 (+2 días de la propuesta)");
  assert.equal(ruleNextAction(lead({ stage: "proposal" }), [proposal]).due, "2026-10-08");
  const touch = (id, day) => act({ id, kind: "follow_up", direction: "outbound", occurredOn: day });
  assert.equal(ruleNextAction(lead({ stage: "proposal" }), [proposal, touch("t1", "2026-10-08")]).due, "2026-10-11");
  assert.equal(ruleNextAction(lead({ stage: "proposal" }), [proposal, touch("t1", "2026-10-08"), touch("t2", "2026-10-11")]).due, "2026-10-15");
  const three = [proposal, touch("t1", "2026-10-08"), touch("t2", "2026-10-11"), touch("t3", "2026-10-15")];
  assert.equal(ruleNextAction(lead({ stage: "negotiation" }), three).kind, "cerrar");
  const voided = act({ id: "t1", kind: "follow_up", direction: "outbound", occurredOn: "2026-10-08", voided: true });
  assert.equal(ruleNextAction(lead({ stage: "proposal" }), [proposal, voided]).title, "Toque 1 de 3 (+2 días de la propuesta)", "un toque anulado no cuenta");
  assert.equal(ruleNextAction(lead({ stage: "proposal" }), []), null, "sin propuesta registrada no hay regla");
  assert.equal(ruleNextAction(lead({ stage: "paused", reviewOn: "2026-10-20" }), []).due, "2026-10-20");
  assert.equal(ruleNextAction(lead({ stage: "won" }), []), null);
});

test("camino a la seña y pausa: fechas solo si el historial las prueba; la etapa previa sale del historial del sistema", () => {
  const items = [
    act({ id: "s1", kind: "stage_change", occurredOn: "2026-10-04", summary: "Etapa: conversation → demo" }),
    act({ id: "p1", kind: "proposal_sent", direction: "outbound", occurredOn: "2026-10-06" }),
    act({ id: "s2", kind: "stage_change", occurredOn: "2026-10-07", summary: "Etapa: proposal → paused (esperando presupuesto)" }),
  ];
  const dates = railDates(lead(), items);
  assert.deepEqual(dates, { prospect: "2026-10-01", conversation: "2026-10-03", demo: "2026-10-04", proposal: "2026-10-06", won: null });
  assert.equal(lastProposal(items).id, "p1");
  assert.equal(stageBeforePause(items), "proposal");
  assert.equal(stageBeforePause([]), null);
  assert.equal(railDates(lead(), [act({ kind: "proposal_sent", direction: "outbound", voided: true })]).proposal, null);
});

test("etapas a las que se puede mover: nunca «ganado»; reactivar vuelve a cualquier etapa de trabajo", () => {
  assert.deepEqual(stageTargets("prospect"), ["conversation", "demo", "proposal", "negotiation"]);
  assert.deepEqual(stageTargets("paused"), ["prospect", "conversation", "demo", "proposal", "negotiation"]);
  assert.deepEqual(stageTargets("lost"), ["prospect", "conversation", "demo", "proposal", "negotiation"]);
  assert.deepEqual(stageTargets("won"), []);
  assert.ok(!stageTargets("negotiation").includes("won"));
  assert.ok(!STAGE_CHIPS.some(([id]) => id === "todos"));
});

test("filtros → consulta del servidor: una sola etapa por pedido, «activos» = no convertidos y sin perdidos en pantalla", () => {
  const base = { q: "", stage: "activos", owner: "", source: "", warm: "", overdue: "", createdFrom: "", createdTo: "", dup: "" };
  assert.deepEqual(leadQuery(base), { converted: "false" });
  assert.deepEqual(leadQuery({ ...base, stage: "proposal", q: "  aurora  ", owner: "me", source: "referral", warm: "1", overdue: "1", createdFrom: "2026-10-01", createdTo: "bad", dup: "1" }, { adminId: ME }),
    { createdFrom: "2026-10-01", includeDuplicates: "true", overdue: "true", ownerAdminId: ME, q: "aurora", source: "referral", stage: "proposal", warm: "true" });
  assert.deepEqual(leadQuery({ ...base, owner: "me" }), { converted: "false" }, "sin id de administrador no se filtra por responsable");
  assert.equal(leadQuery({ ...base, q: "x".repeat(300) }).q.length, 100);
  assert.deepEqual(leadQuery({ ...base, source: "inventada" }), { converted: "false" }, "una fuente desconocida no viaja");
  const key = queryKey(leadQuery({ ...base, stage: "won" }));
  assert.equal(key, "stage=won");
  assert.deepEqual(keyQuery(key), { stage: "won" });
  assert.equal(visibleInChip(lead({ stage: "lost" }), "activos"), false);
  assert.equal(visibleInChip(lead({ stage: "paused" }), "activos"), true);
  assert.equal(visibleInChip(lead({ stage: "lost" }), "lost"), true);
  assert.equal(visibleInChip(lead({ stage: "lost", duplicateOfId: OTHER }), "activos"), true, "un duplicado marcado solo llega si se pidió verlo");
});

test("auditoría: título en español y una línea de lo que cambió, sin volcar JSON", () => {
  const event = adaptAuditEvent({ id: "e1", occurredAt: "2026-10-09T02:30:00.000Z", actorKind: "admin", actorId: ME, action: "lead.stage_changed", resourceType: "lead", resourceId: ID, result: "success", before: { stage: "demo", nextActionOn: "2026-10-09" }, after: { stage: "proposal", nextActionOn: "2026-10-11" } });
  assert.equal(event.title, "Cambio de etapa");
  assert.equal(event.date, "2026-10-08");
  assert.equal(auditChange(event), "etapa Demo → Propuesta · próxima acción 2026-10-11");
  assert.equal(auditChange({ before: null, after: { rows: 1 } }), "1 fila");
  assert.equal(adaptAuditEvent({ id: "e2", occurredAt: "2026-10-09T12:00:00.000Z", actorKind: "system", actorId: ME, action: "otra.cosa", result: "success", before: null, after: null }).title, "otra.cosa");
});

const apiBatch = { id: ID, name: "Gastronomía", vertical: "Restaurantes", hypothesis: "H", demo: "Demo base", target: 10, status: "planned", plannedOn: "2026-10-12", sentOn: null, sentCount: null, signalDays: 2, closeDays: 7, signalDueOn: null, closeDueOn: null, signalOn: null, signalNote: null, closedOn: null, report: null, ownerAdminId: ME, isExample: false, version: 1, createdAt: "2026-10-10T12:00:00.000Z", metrics: { assigned: 3, contacted: 2, replied: 1, calls: 0, proposals: 0, won: 0, lost: 1 } };

test("lote: métricas del servidor, recordatorios D+señal/D+cierre y próximo paso manual", () => {
  const planned = adaptBatch(apiBatch);
  assert.equal(planned.open, true);
  assert.equal(planned.metrics.replied, 1);
  assert.equal(batchNextAction(planned).kind, "envio");
  assert.equal(batchNextAction(planned).due, "2026-10-12");
  const sent = adaptBatch({ ...apiBatch, status: "sent", sentOn: "2026-10-12", sentCount: 20, signalDueOn: "2026-10-14", closeDueOn: "2026-10-19" });
  assert.deepEqual(batchNextAction(sent), { kind: "señal", title: "Leer la señal del lote (D+2)", due: "2026-10-14" });
  assert.equal(batchNextAction({ ...sent, signalOn: "2026-10-14" }).kind, "cierre");
  const closed = adaptBatch({ ...apiBatch, status: "closed", report: { worked: "a", notWorked: "b", change: "c" } });
  assert.equal(closed.open, false);
  assert.equal(batchNextAction(closed), null);
  assert.equal(closed.report.change, "c");
  assert.equal(adaptBatch({ ...apiBatch, metrics: undefined }).metrics, null, "sin métricas no se inventan ceros");
});

// ---------- Cuerpos hacia la API ----------

const newLead = { contactName: " Clínica Aurora ", company: "", channel: "whatsapp", source: "manual", need: " Turnos ", nextAction: "Esperar respuesta", nextActionOn: "2026-10-12", email: "Hola@Aurora.test", phone: "+54 9 11 2233-4455", handle: "", language: "es", stage: "prospect" };

test("alta: recorta, pasa el email a minúsculas, normaliza el teléfono y no manda cadenas vacías", () => {
  const { body } = out.leadCreateBody(newLead, { today: TODAY });
  assert.deepEqual(body, { contactName: "Clínica Aurora", channel: "whatsapp", source: "manual", need: "Turnos", stage: "prospect", nextAction: "Esperar respuesta", nextActionOn: "2026-10-12", language: "es", email: "hola@aurora.test", phone: "+5491122334455" });
  assert.ok(!("company" in body) && !("handle" in body) && !("acknowledgeDuplicates" in body));
  assert.equal(out.normalizePhone("(+54) 9 11-2233.4455"), "+5491122334455");
});

test("alta: validaciones en español antes de ir al servidor", () => {
  const err = (patch, options) => out.leadCreateBody({ ...newLead, ...patch }, { today: TODAY, ...options }).error;
  assert.match(err({ contactName: " " }), /Nombre/);
  assert.match(err({ email: "", phone: "", handle: "" }), /al menos un email, un teléfono o un usuario/);
  assert.match(err({ phone: "1122334455" }), /internacional/);
  assert.match(err({ email: "no-es-email" }), /Email/);
  assert.match(err({ source: "referral" }), /quién o dónde/, "los orígenes tibios exigen detalle");
  assert.equal(err({ source: "referral", sourceDetail: "Dra. Pérez" }), undefined);
  assert.match(err({ nextActionOn: "2026-10-09" }), /hoy o una fecha posterior/);
  assert.match(err({ nextAction: "" }), /Próxima acción/);
  assert.match(err({ firstContactOn: "2026-10-11" }), /futura/);
  assert.match(err({ channel: "paloma" }), /Canal/);
  assert.match(err({ budget: "1500" }), /billing:write/, "sin permiso de importes no se manda presupuesto");
  assert.equal(out.leadCreateBody({ ...newLead, budget: "1500,5" }, { today: TODAY, canBudget: true }).body.budgetCents, 150050);
  assert.match(err({ budget: "0" }, { canBudget: true }), /mayor a cero/);
  assert.equal(out.leadCreateBody({ ...newLead, acknowledgeDuplicates: "1", ownerAdminId: ME }, { today: TODAY }).body.acknowledgeDuplicates, true);
  assert.match(err({ need: "a\u0000b" }), /caracteres/);
});

test("duplicados: busca por email/teléfono exactos o por nombre + empresa; la firma cambia con el contacto", () => {
  assert.deepEqual(out.duplicateCheckBody({ email: "A@b.co", phone: "", contactName: "Ana", company: "" }).body, { email: "a@b.co" });
  assert.deepEqual(out.duplicateCheckBody({ contactName: "Ana", company: "Acme" }).body, { contactName: "Ana", company: "Acme" });
  assert.match(out.duplicateCheckBody({ contactName: "Ana" }).error, /nombre junto con la empresa/);
  assert.match(out.duplicateCheckBody({ phone: "123" }).error, /Teléfono/);
  assert.equal(out.contactSignature({ email: "A@b.co", contactName: "Ana" }), out.contactSignature({ email: "a@b.co", contactName: " ana " }));
  assert.notEqual(out.contactSignature({ email: "a@b.co" }), out.contactSignature({ email: "otro@b.co" }));
});

test("edición: solo viaja lo que cambió, null borra un dato opcional y se envía la versión", () => {
  const current = lead();
  const base = { contactName: current.name, company: "Aurora S.A.", email: "hola@aurora.test", phone: "", handle: "", channel: "whatsapp", sourceDetail: "Dra. Pérez", need: "Turnos online", vertical: "Clínicas", language: "es", commercialNotes: "", nextAction: "Llamar", nextActionOn: "2026-10-11" };
  assert.match(out.leadPatchBody(base, current, { today: TODAY }).error, /No cambiaste nada/);
  assert.deepEqual(out.leadPatchBody({ ...base, company: "", nextActionOn: "2026-10-15", need: "Turnos y recordatorios" }, current, { today: TODAY }).body, { version: 4, company: null, need: "Turnos y recordatorios", nextActionOn: "2026-10-15" });
  assert.match(out.leadPatchBody({ ...base, email: "" }, current, { today: TODAY }).error, /al menos un email/);
  assert.deepEqual(out.leadPatchBody({ ...base, budget: "2000" }, current, { today: TODAY, canBudget: true }).body, { version: 4, budgetCents: 200000 });
  assert.match(out.leadPatchBody({ ...base, budget: "2000" }, current, { today: TODAY, canBudget: false }).error, /No cambiaste nada/, "sin billing:write el presupuesto ni se toca");
  assert.deepEqual(out.leadPatchBody({ ...base, budget: "" }, current, { today: TODAY, canBudget: true }).body, { version: 4, budgetCents: null });
  assert.match(out.leadPatchBody({ ...base, sourceDetail: "" }, current, { today: TODAY }).error, /quién o dónde/);
});

test("etapa: «ganado» nunca; pausa pide motivo y fecha; propuesta y negociación llevan próxima acción; perdido admite motivo opcional", () => {
  const current = lead({ stage: "demo" });
  assert.match(out.stageBody({ stage: "won" }, current, { today: TODAY }).error, /convirtiendo el prospecto en proyecto/);
  assert.match(out.stageBody({ stage: "demo" }, current, { today: TODAY }).error, /ya está/);
  assert.match(out.stageBody({ stage: "paused", reason: "", reviewOn: "2026-10-20" }, current, { today: TODAY }).error, /Motivo/);
  assert.match(out.stageBody({ stage: "paused", reason: "x", reviewOn: "2026-10-01" }, current, { today: TODAY }).error, /hoy o una fecha posterior/);
  assert.deepEqual(out.stageBody({ stage: "paused", reason: " Sin presupuesto ", reviewOn: "2026-10-20" }, current, { today: TODAY }).body, { version: 4, stage: "paused", reason: "Sin presupuesto", reviewOn: "2026-10-20" });
  assert.deepEqual(out.stageBody({ stage: "lost", reason: "" }, current, { today: TODAY }).body, { version: 4, stage: "lost" });
  assert.deepEqual(out.stageBody({ stage: "lost", reason: "Eligió a otro" }, current, { today: TODAY }).body, { version: 4, stage: "lost", reason: "Eligió a otro" });
  assert.deepEqual(out.stageBody({ stage: "proposal", nextAction: "Toque 1", nextActionOn: "2026-10-12", reason: "" }, current, { today: TODAY }).body, { version: 4, stage: "proposal", nextAction: "Toque 1", nextActionOn: "2026-10-12" });
  assert.match(out.stageBody({ stage: "paused", reason: "x", reviewOn: "2026-10-20" }, lead({ stage: "lost" }), { today: TODAY }).error, /se está trabajando/);
  const paused = lead({ stage: "paused", nextAction: null, nextActionOn: null });
  assert.match(out.stageBody({ stage: "prospect", nextAction: "", nextActionOn: "" }, paused, { today: TODAY }).error, /Próxima acción/);
  assert.match(out.stageBody({ stage: "inventada" }, current, { today: TODAY }).error, /Elegí la etapa/);
});

test("consentimiento: salir de un rechazo exige la base; la fecha no puede ser futura", () => {
  const denied = lead({ consent: { status: "denied", on: "2026-10-05", basis: "Pidió que no lo contactemos" }, doNotContact: true });
  assert.match(out.consentBody({ status: "granted" }, denied, { today: TODAY }).error, /registrar la base/);
  assert.deepEqual(out.consentBody({ status: "granted", basis: "Volvió a escribir el 9/10", on: "2026-10-09" }, denied, { today: TODAY }).body, { version: 4, status: "granted", on: "2026-10-09", basis: "Volvió a escribir el 9/10" });
  assert.deepEqual(out.consentBody({ status: "withdrawn", basis: "" }, lead(), { today: TODAY }).body, { version: 4, status: "withdrawn" });
  assert.match(out.consentBody({ status: "granted", on: "2026-10-11" }, lead(), { today: TODAY }).error, /futura/);
  assert.match(out.consentBody({ status: "quizás" }, lead(), { today: TODAY }).error, /Elegí/);
});

test("actividad: nota interna, propuesta saliente con monto, hora real opcional y el bloqueo por consentimiento", () => {
  const current = lead();
  const base = { kind: "call", direction: "outbound", channel: "phone", occurredOn: "2026-10-09", summary: " Hablamos 10 min ", outcome: "", nextAction: "", nextActionOn: "" };
  const options = { today: TODAY, now: new Date("2026-10-10T18:00:00.000Z"), canMoney: true };
  assert.deepEqual(out.activityBody(base, current, options).body, { kind: "call", occurredOn: "2026-10-09", summary: "Hablamos 10 min", direction: "outbound", channel: "phone" });
  assert.deepEqual(out.activityBody({ ...base, kind: "note", direction: "inbound" }, current, options).body, { kind: "note", occurredOn: "2026-10-09", summary: "Hablamos 10 min", channel: "phone" }, "una nota es interna: no lleva dirección");
  const proposal = out.activityBody({ ...base, kind: "proposal_sent", direction: "", amount: "900", nextAction: "Toque 1", nextActionOn: "2026-10-11" }, current, options).body;
  assert.equal(proposal.amountCents, 90000);
  assert.ok(!("direction" in proposal), "la propuesta es siempre saliente: el servidor la deduce");
  assert.equal(proposal.nextActionOn, "2026-10-11");
  assert.match(out.activityBody({ ...base, kind: "proposal_sent", amount: "900" }, current, { ...options, canMoney: false }).error, /billing:write/);
  assert.match(out.activityBody({ ...base, amount: "900" }, current, options).error, /solo se registra en una propuesta/);
  assert.match(out.activityBody({ ...base, direction: "" }, current, options).error, /entrante o saliente/);
  assert.match(out.activityBody({ ...base, summary: "" }, current, options).error, /Qué pasó/);
  assert.match(out.activityBody({ ...base, occurredOn: "2026-10-11" }, current, options).error, /futura/);
  assert.match(out.activityBody({ ...base, occurredOn: "2026-09-30" }, current, options).error, /primer contacto/);
  assert.match(out.activityBody({ ...base, nextAction: "x" }, current, options).error, /texto y fecha/);
  const timed = out.activityBody({ ...base, occurredAt: "13:30" }, current, options).body;
  assert.equal(timed.occurredAt, new Date("2026-10-09T13:30:00").toISOString());
  assert.match(out.activityBody({ ...base, occurredOn: TODAY, occurredAt: "23:59" }, current, options).error, /futuro/);
  assert.equal(out.occurredAtOf("2026-10-09", ""), null, "sin hora no se manda ninguna");
  const blocked = lead({ consent: { status: "denied", on: null, basis: null }, doNotContact: true });
  assert.match(out.activityBody(base, blocked, options).error, /consentimiento está rechazado o retirado/);
  assert.equal(out.activityBody({ ...base, direction: "inbound" }, blocked, options).body.direction, "inbound", "lo entrante sigue permitido");
  assert.ok(out.activityBody({ ...base, kind: "note" }, blocked, options).body, "las notas también");
});

test("anular, duplicado, desde solicitud y conversión", () => {
  assert.deepEqual(out.voidBody({ reason: " Era otro cliente " }), { body: { reason: "Era otro cliente" } });
  assert.match(out.voidBody({ reason: "" }).error, /Motivo/);
  const current = lead();
  assert.deepEqual(out.duplicateOfBody({ canonicalId: OTHER }, current), { body: { version: 4, canonicalId: OTHER } });
  assert.match(out.duplicateOfBody({ canonicalId: "abc" }, current).error, /ID completo/);
  assert.match(out.duplicateOfBody({ canonicalId: ID }, current).error, /de sí mismo/);
  assert.deepEqual(out.fromPlanRequestBody({ nextAction: "Contestar", nextActionOn: "2026-10-11" }, { id: OTHER }, { today: TODAY }), { body: { planRequestId: OTHER, nextAction: "Contestar", nextActionOn: "2026-10-11" } });
  assert.match(out.fromPlanRequestBody({ nextAction: "", nextActionOn: "2026-10-11" }, { id: OTHER }, { today: TODAY }).error, /Próxima acción/);
  assert.match(out.fromPlanRequestBody({ nextAction: "x", nextActionOn: "2026-10-11" }, null, { today: TODAY }).error, /ya no está cargada/);

  const project = { name: "Aurora", organizationName: "Aurora S.A.", service: "Landing + turnos", agreementReference: "Presupuesto 12", acceptedOn: "2026-10-09", price: "2000", scopeItems: "Landing\nTurnos", depositAmount: "500,50", receivedOn: "2026-10-09", memberClientIds: [OTHER], memberRole: "client_admin" };
  const converted = out.convertBody(project, current, { today: TODAY });
  assert.equal(converted.body.version, 4, "la conversión viaja con la versión del prospecto");
  assert.equal(converted.body.project.agreement.priceCents, 200000);
  assert.equal(converted.body.project.deposit.amountCents, 50050);
  assert.deepEqual(converted.body.project.members, [{ clientId: OTHER, role: "client_admin" }]);
  assert.equal(converted.body.project.currency, "USD");
  assert.match(out.convertBody({ ...project, depositAmount: "9000" }, current, { today: TODAY }).error, /seña no puede superar/, "las reglas del alta de proyectos se reutilizan");
  for (const stage of ["paused", "lost", "won"]) assert.match(out.convertBody(project, lead({ stage }), { today: TODAY }).error, /se está trabajando/);
});

test("lotes: alta, edición, D0, señal, cierre con informe de tres líneas y asignación", () => {
  const create = out.batchCreateBody({ name: " Gastronomía ", vertical: "Restaurantes", demo: "", hypothesis: "", target: "10", plannedOn: "2026-10-12", signalDays: "2", closeDays: "7" }, { today: TODAY });
  assert.deepEqual(create.body, { name: "Gastronomía", target: 10, signalDays: 2, closeDays: 7, vertical: "Restaurantes", plannedOn: "2026-10-12" });
  assert.match(out.batchCreateBody({ name: "x", target: "0" }, { today: TODAY }).error, /entre 1 y 1000/);
  assert.match(out.batchCreateBody({ name: "x", target: "5", signalDays: "7", closeDays: "7" }, { today: TODAY }).error, /después de leer la señal/);
  assert.match(out.batchCreateBody({ name: "x", target: "5", signalDays: "0" }, { today: TODAY }).error, /señal/);
  assert.match(out.batchCreateBody({ name: "x", target: "5", plannedOn: "2026-10-01" }, { today: TODAY }).error, /hoy o una fecha posterior/);
  assert.match(out.batchCreateBody({ name: "", target: "5" }, { today: TODAY }).error, /Nombre del lote/);

  const planned = adaptBatch(apiBatch);
  assert.deepEqual(out.batchPatchBody({ name: "Gastronomía", vertical: "", hypothesis: "Nueva", demo: "Demo base", target: "10", plannedOn: "2026-10-12" }, planned, { today: TODAY }).body, { version: 1, vertical: null, hypothesis: "Nueva" });
  assert.match(out.batchPatchBody({ name: "Gastronomía", vertical: "Restaurantes", hypothesis: "H", demo: "Demo base", target: "10", plannedOn: "2026-10-12" }, planned, { today: TODAY }).error, /No cambiaste nada/);
  assert.match(out.batchPatchBody({ name: "x", target: "3" }, adaptBatch({ ...apiBatch, status: "closed" }), { today: TODAY }).error, /cerrado no se edita/);

  assert.deepEqual(out.batchSentBody({ sentOn: "2026-10-10", sentCount: "20" }, planned, { today: TODAY }).body, { version: 1, sentOn: "2026-10-10", sentCount: 20 });
  assert.deepEqual(out.batchSentBody({ sentOn: "2026-10-10", sentCount: "" }, planned, { today: TODAY }).body, { version: 1, sentOn: "2026-10-10" });
  assert.match(out.batchSentBody({ sentOn: "2026-10-11" }, planned, { today: TODAY }).error, /futura/);
  assert.match(out.batchSentBody({ sentOn: "2026-10-10" }, adaptBatch({ ...apiBatch, status: "sent" }), { today: TODAY }).error, /ya está registrado/);

  const sent = adaptBatch({ ...apiBatch, status: "sent", sentOn: "2026-10-08", signalDueOn: "2026-10-10", closeDueOn: "2026-10-15" });
  assert.deepEqual(out.batchSignalBody({ on: "2026-10-10", note: " 2 de 10 respondieron " }, sent, { today: TODAY }).body, { version: 1, on: "2026-10-10", note: "2 de 10 respondieron" });
  assert.match(out.batchSignalBody({ on: "2026-10-07", note: "x" }, sent, { today: TODAY }).error, /anterior al envío/);
  assert.match(out.batchSignalBody({ on: "2026-10-10", note: "x" }, planned, { today: TODAY }).error, /una sola vez/);
  assert.match(out.batchSignalBody({ on: "2026-10-10", note: "x" }, adaptBatch({ ...apiBatch, status: "sent", signalOn: "2026-10-09" }), { today: TODAY }).error, /una sola vez/);

  const report = { closedOn: "2026-10-10", worked: "Demo corta", notWorked: "Mensaje largo", change: "Mandar solo el video" };
  assert.deepEqual(out.batchCloseBody(report, sent, { today: TODAY }).body, { version: 1, ...report });
  for (const field of ["worked", "notWorked", "change"]) assert.match(out.batchCloseBody({ ...report, [field]: "" }, sent, { today: TODAY }).error, /completalo/);
  assert.match(out.batchCloseBody(report, planned, { today: TODAY }).error, /registrá el envío D0/);
  assert.match(out.batchCloseBody({ ...report, worked: "x".repeat(501) }, sent, { today: TODAY }).error, /máximo 500/);

  assert.deepEqual(out.batchLeadsBody([ID, ID, OTHER, ""]), { body: { leadIds: [ID, OTHER] } });
  assert.match(out.batchLeadsBody([]).error, /al menos un prospecto/);
  assert.match(out.batchLeadsBody(Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)).error, /Hasta 100/);
});
