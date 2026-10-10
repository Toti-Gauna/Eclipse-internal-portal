import test from "node:test";
import assert from "node:assert/strict";
import { centsToDollars, dayOfInstant, formatCents, parseDollars, projectCode, stageToApi, stageToView, timeOfInstant, viewStage } from "../src/live/adapters/common.js";
import { adaptFinance, adaptMilestone, adaptProject, adaptScope, adaptUpdate, stageHistoryFromAudit } from "../src/live/adapters/projects.js";
import { adaptPayment } from "../src/live/adapters/payments.js";
import { adaptRequest, indexCatalog } from "../src/live/adapters/requests.js";
import * as out from "../src/live/adapters/outbound.js";

process.env.TZ = "America/Argentina/Buenos_Aires";
const TODAY = "2026-10-10";
const ID = "3931ac6f-f567-48a5-8561-604f9b909108";

test("dinero: centavos enteros ⇄ dólares sin pasar por floats", () => {
  assert.equal(centsToDollars(150050), 1500.5);
  assert.equal(parseDollars("1500"), 150000);
  assert.equal(parseDollars("1500,5"), 150050);
  assert.equal(parseDollars("0.07"), 7);
  assert.equal(parseDollars("19.99"), 1999, "19.99 * 100 daría 1998.9999 con floats");
  for (const invalid of ["", "-5", "1.234", "abc", "1e3", "1,2,3"]) assert.ok(Number.isNaN(parseDollars(invalid)), invalid);
  assert.equal(formatCents(150000), "USD 1.500");
  assert.equal(formatCents(150050), "USD 1.500,50");
  assert.equal(formatCents(150050, { withCurrency: false }), "1.500,50");
});

test("fechas: el día local de un instante y la hora solo cuando hay instante", () => {
  assert.equal(dayOfInstant("2026-10-10T02:30:00.000Z"), "2026-10-09", "en Buenos Aires todavía es el 9");
  assert.equal(timeOfInstant("2026-10-10T16:27:00.000Z"), "13:27");
  assert.equal(dayOfInstant(null), null);
  assert.equal(timeOfInstant(undefined), null);
});

test("etapas: snake_case de la API ⇄ vocabulario del portal; pausa y cierre son estados", () => {
  assert.equal(stageToView("eclipse_review"), "eclipseReview");
  assert.equal(stageToApi("clientReview"), "client_review");
  assert.equal(viewStage({ status: "active", stage: "build" }), "build");
  assert.equal(viewStage({ status: "paused", stage: "build" }), "paused");
  assert.equal(viewStage({ status: "closed", stage: "delivery" }), "closed");
});

const summary = { id: ID, organizationId: "o1", name: "Clínica", service: "Landing", origin: "new", status: "active", stage: "client_review", version: 3, createdAt: "2026-10-10T16:26:21.325Z", updatedAt: "2026-10-10T16:26:21.325Z" };
const detail = { ...summary, organization: { id: "o1", name: "Clínica S.A." }, legacyReference: null, sourcePlanRequestId: "p1", stateReason: null, reviewOn: null, scopeVersion: 2, agreementReference: "ACU-7", agreementAcceptedOn: "2026-10-01", leadAdminId: null, startedOn: "2026-10-02", plannedEndOn: "2026-11-01", completedOn: null, finance: { currency: "USD", basePriceCents: 200000, agreedPriceCents: 250000 }, members: [{ id: "m1", clientId: "c1", role: "client_admin", addedAt: "2026-10-10T16:26:21Z", removedAt: null }, { id: "m2", clientId: "c2", role: "client_collaborator", addedAt: "2026-10-10T16:26:21Z", removedAt: "2026-10-11T00:00:00Z" }] };

test("proyecto: la lista no trae dinero y el detalle sí; los UUID se conservan", () => {
  const fromList = adaptProject(summary);
  assert.equal(fromList.id, ID);
  assert.equal(fromList.stage, "clientReview");
  assert.equal(fromList.total, null, "no se inventa un total que la lista no trae");
  assert.equal(fromList.code, "#3931ac6f");
  const full = adaptProject(detail);
  assert.equal(full.total, 2500);
  assert.equal(full.client, "Clínica S.A.");
  assert.equal(full.startedAt, "2026-10-02");
  assert.equal(full.live.members.length, 1, "los miembros dados de baja se separan");
  assert.equal(full.live.removedMembers.length, 1);
  assert.equal(projectCode({ id: ID, legacyReference: "ECL-004" }), "ECL-004");
});

test("proyecto pausado o cerrado conserva la etapa donde estaba", () => {
  const paused = adaptProject({ ...detail, status: "paused", stateReason: "Falta material", reviewOn: "2026-10-20" });
  assert.equal(paused.stage, "paused");
  assert.equal(paused.pausedIn, "clientReview");
  assert.equal(paused.pause.review, "2026-10-20");
  const closed = adaptProject({ ...detail, status: "closed", stateReason: "Entregado", completedOn: "2026-10-30" });
  assert.equal(closed.stage, "closed");
  assert.equal(closed.closedReason, "Entregado");
});

test("el historial de etapas se reconstruye de la auditoría, sin inventar fechas", () => {
  const project = adaptProject({ ...detail, stage: "build" });
  const spans = stageHistoryFromAudit(project, [
    { action: "project.stage_changed", result: "success", occurredAt: "2026-10-05T15:00:00Z", before: { stage: "preparation" }, after: { stage: "build" } },
    { action: "project.status_changed", result: "success", occurredAt: "2026-10-06T15:00:00Z", before: {}, after: {} },
    { action: "project.stage_changed", result: "denied", occurredAt: "2026-10-07T15:00:00Z", before: { stage: "build" }, after: { stage: "delivery" } },
  ]);
  assert.deepEqual(spans, [{ stage: "preparation", start: "2026-10-02", end: "2026-10-05" }, { stage: "build", start: "2026-10-05" }]);
});

test("pagos: dólares, etiquetas, y sin hora inventada", () => {
  const payment = adaptPayment({ id: "p1", kind: "deposit", status: "collected", amountCents: 50000, currency: "USD", dueOn: null, receivedOn: "2026-10-02", reference: null, note: "Transferencia", voidReason: null, voidedAt: null, reducesProjectBalance: true, version: 1, createdAt: "2026-10-02T18:00:00Z", updatedAt: "2026-10-02T18:00:00Z" }, { id: ID, name: "Clínica" });
  assert.equal(payment.amount, 500);
  assert.equal(payment.concept, "Seña");
  assert.equal(payment.statusLabel, "Cobrado");
  assert.equal(payment.date, "2026-10-02");
  assert.equal(payment.time, null);
  assert.equal(payment.projectName, "Clínica");
  const maintenance = adaptPayment({ id: "p2", kind: "maintenance", status: "committed", amountCents: 3000, dueOn: "2026-11-01", receivedOn: null, reducesProjectBalance: false, version: 2, createdAt: "2026-10-02T18:00:00Z" }, { id: ID, name: "x" });
  assert.equal(maintenance.date, "2026-11-01", "un compromiso se ubica en su vencimiento");
  assert.equal(maintenance.reducesBalance, false);
});

test("finanzas del servidor: cobrado, comprometido, saldo y mantenimiento por separado", () => {
  const finance = adaptFinance({ currency: "USD", basePriceCents: 200000, agreedPriceCents: 200000, price: { collectedCents: 100000, committedCents: 50000, proposedCents: 0, balanceCents: 100000, unscheduledCents: 50000 }, maintenance: { collectedCents: 3000, committedCents: 0, proposedCents: 0 }, incomeCollectedCents: 103000 });
  assert.equal(finance.balanceCents, 100000);
  assert.equal(finance.incomeCollectedCents, 103000);
  assert.equal(finance.maintenanceCollectedCents, 3000);
});

test("hitos, actualizaciones y alcance", () => {
  const milestone = adaptMilestone({ id: "h1", stage: "eclipse_review", title: "QA", description: null, status: "pending", ownerParty: "eclipse", ownerAdminId: null, plannedOn: "2026-10-20", actualOn: null, visibleToClient: false, internalNotes: null, evidence: null, version: 1 });
  assert.equal(milestone.stage, "eclipseReview");
  assert.equal(milestone.apiStage, "eclipse_review");
  assert.equal(milestone.visibleToClient, false);
  const update = adaptUpdate({ id: "u1", kind: "client_update", state: "draft", title: "Avance", body: "<b>x</b>", dueOn: null, resolvedAt: null, publishedAt: null, withdrawnAt: null, withdrawReason: null, version: 1, createdAt: "2026-10-10T16:27:00Z", clientPreview: { kind: "client_update", title: "Avance", body: "<b>x</b>" } });
  assert.equal(update.state, "draft");
  assert.equal(update.time, "13:27", "la hora es la del registro real del servidor");
  assert.equal(update.body, "<b>x</b>", "el texto llega crudo: se escapa al dibujar, no al adaptar");
  const scope = adaptScope({ versions: [{ version: 1, items: ["Landing"], priceCents: 200000, changeRequestId: null, acceptedOn: "2026-10-01" }], changeRequests: [{ id: "c1", number: 1, origin: "client", title: "Más", description: "d", hoursImpact: 4, priceImpactCents: -5000, scheduleImpactDays: 2, technicalAssessment: null, commercialDecision: null, status: "estimated", sharedWithClient: false, version: 2 }] });
  assert.equal(scope.versions[0].price, 2000);
  assert.equal(scope.changeRequests[0].priceImpact, -50);
});

test("solicitud: nombres del catálogo, estimación en centavos y mensaje sin interpretar", () => {
  const catalog = indexCatalog({ version: "v1-x", items: [{ id: "seo", name: { es: "SEO local" } }], plans: [{ id: "presencia", name: { es: "Presencia" } }], maintenance: [], verticals: [] });
  const request = adaptRequest({
    id: "r1", catalogVersion: "v1-x", status: "submitted", version: 1, clientId: "c1", createdAt: "2026-10-10T16:27:00Z", reviewedAt: null, publicResponse: null, internalNote: null,
    selection: { goals: ["encontrar", "vender"], planId: "presencia", items: ["seo"], maintenance: "esencial", billing: "annual", vertical: "clinicas", founder: true },
    estimate: { provisional: true, lines: [{ id: "presencia", kind: "plan", priceCents: 90000, listCents: 90000 }, { id: "seo", kind: "item", priceCents: 10000, listCents: 10000 }], subtotalCents: 100000, totalCents: 80000, rangeCents: { from: 70000, to: 90000 }, voiceCombo: false, founderDiscountCents: 20000, maintenance: { id: "esencial", billing: "annual", monthlyCents: 2500, periodCents: 25000, voiceUsageMonthlyCents: 0 } },
    contact: { name: "<img onerror=x>", phone: "+5491100000000" }, message: "Hola <script>",
  }, catalog);
  assert.equal(request.selection.planName, "Presencia");
  assert.equal(request.selection.items[0].name, "SEO local");
  assert.deepEqual(request.selection.goals, ["Que lo encuentren", "Vender online"]);
  assert.equal(request.selection.billing, "Anual");
  assert.equal(request.estimate.totalCents, 80000);
  assert.equal(request.estimate.lines[1].name, "SEO local");
  assert.equal(request.contactName, "<img onerror=x>");
  assert.equal(request.statusLabel, "Recibida");
  assert.equal(request.estimate.provisional, true);
});

// ---------- Cuerpos hacia la API ----------

const valid = { name: "Clínica Aurora", service: "Landing", organizationName: "Clínica Aurora", agreementReference: "ACU-1", acceptedOn: "2026-10-01", price: "2000", scopeItems: "Landing\n\nChatbot ", depositAmount: "500", receivedOn: "2026-10-02" };

test("crear proyecto: centavos enteros, sin campos vacíos y con alcance en ítems", () => {
  const { body, error } = out.projectCreateBody(valid, { today: TODAY });
  assert.equal(error, undefined);
  assert.deepEqual(body, {
    organization: { name: "Clínica Aurora" }, name: "Clínica Aurora", service: "Landing", currency: "USD",
    agreement: { reference: "ACU-1", acceptedOn: "2026-10-01", priceCents: 200000, scopeItems: ["Landing", "Chatbot"] },
    deposit: { amountCents: 50000, receivedOn: "2026-10-02" }, members: [],
  });
  const full = out.projectCreateBody({ ...valid, sourcePlanRequestId: "r1", memberClientIds: ["c1"], startedOn: "2026-10-03", plannedEndOn: "2026-11-03", depositReference: "T-1", depositNote: "ok" }, { today: TODAY }).body;
  assert.equal(full.sourcePlanRequestId, "r1");
  assert.deepEqual(full.members, [{ clientId: "c1", role: "client_admin" }]);
  assert.deepEqual(full.deposit, { amountCents: 50000, receivedOn: "2026-10-02", reference: "T-1", note: "ok" });
  assert.deepEqual(out.projectCreateBody({ ...valid, organizationId: "o9" }, { today: TODAY }).body.organization, { id: "o9" });
});

test("crear proyecto: valida lo que el servidor rechazaría con un 400 genérico", () => {
  const err = (patch) => out.projectCreateBody({ ...valid, ...patch }, { today: TODAY }).error;
  assert.match(err({ depositAmount: "2500" }), /seña no puede superar/);
  assert.match(err({ depositAmount: "0" }), /mayor a cero/);
  assert.match(err({ price: "12,345" }), /Precio acordado/);
  assert.match(err({ receivedOn: "2026-10-12" }), /futura/);
  assert.match(err({ acceptedOn: "2019-12-31" }), /2020/);
  assert.match(err({ acceptedOn: "2026-02-30" }), /no es válida/);
  assert.match(err({ scopeItems: "  \n " }), /al menos un entregable/);
  assert.match(err({ scopeItems: "x".repeat(201) }), /200 caracteres/);
  assert.match(err({ name: "" }), /Proyecto/);
  assert.match(err({ startedOn: "2026-10-05", plannedEndOn: "2026-10-01" }), /posterior al inicio/);
  assert.match(err({ agreementReference: "" }), /Referencia del acuerdo/);
  assert.match(err({ name: "a\u0007b" }), /caracteres/);
});

test("cobros: el estado decide qué fechas son obligatorias", () => {
  const base = { kind: "installment", status: "collected", amount: "500", receivedOn: "2026-10-09" };
  assert.deepEqual(out.paymentCreateBody(base, { today: TODAY }).body, { kind: "installment", status: "collected", amountCents: 50000, currency: "USD", receivedOn: "2026-10-09" });
  assert.match(out.paymentCreateBody({ ...base, receivedOn: "" }, { today: TODAY }).error, /Fecha de cobro/);
  assert.match(out.paymentCreateBody({ ...base, receivedOn: "2026-10-11" }, { today: TODAY }).error, /futura/);
  assert.match(out.paymentCreateBody({ ...base, status: "committed" }, { today: TODAY }).error, /Vencimiento/);
  const committed = out.paymentCreateBody({ ...base, status: "committed", dueOn: "2026-11-01", receivedOn: "2026-10-01" }, { today: TODAY }).body;
  assert.equal(committed.dueOn, "2026-11-01");
  assert.equal("receivedOn" in committed, false, "un compromiso no lleva fecha de cobro");
  assert.equal(out.paymentCreateBody({ ...base, kind: "maintenance", amount: "30" }, { today: TODAY }).body.kind, "maintenance");
});

test("transiciones de cobro y de proyecto", () => {
  const payment = { version: 2 };
  assert.deepEqual(out.paymentTransitionBody("collected", { receivedOn: "2026-10-09" }, payment, { today: TODAY }).body, { version: 2, status: "collected", receivedOn: "2026-10-09" });
  assert.match(out.paymentTransitionBody("voided", { reason: " " }, payment).error, /Motivo/);
  assert.deepEqual(out.paymentTransitionBody("voided", { reason: "Error de carga" }, payment).body, { version: 2, status: "voided", reason: "Error de carga" });
  const project = { version: 4 };
  assert.deepEqual(out.transitionBody("advance", { stage: "build" }, project).body, { version: 4, stage: "build" });
  assert.deepEqual(out.transitionBody("resume", {}, project).body, { version: 4, status: "active" });
  assert.match(out.transitionBody("pause", { reason: "x", reviewOn: "2026-10-01" }, project, { today: TODAY }).error, /hoy o una fecha posterior/);
  assert.deepEqual(out.transitionBody("pause", { reason: "x", reviewOn: "2026-10-20" }, project, { today: TODAY }).body, { version: 4, status: "paused", reason: "x", reviewOn: "2026-10-20" });
  assert.deepEqual(out.transitionBody("close", { reason: "Fin" }, project, { today: TODAY }).body, { version: 4, status: "closed", reason: "Fin" });
});

test("hitos: completar exige fecha real y evidencia; mostrar al cliente exige confirmación explícita", () => {
  const milestone = { version: 1, title: "QA", description: "", plannedOn: null, apiStage: "build", ownerParty: "eclipse", status: "pending" };
  assert.match(out.milestoneCompleteBody({ actualOn: "2026-10-09", evidence: "" }, milestone, { today: TODAY }).error, /Evidencia/);
  assert.deepEqual(out.milestoneCompleteBody({ actualOn: "2026-10-09", evidence: "PR #4" }, milestone, { today: TODAY }).body, { version: 1, status: "done", actualOn: "2026-10-09", evidence: "PR #4" });
  assert.deepEqual(out.milestoneVisibilityBody(milestone, true).body, { version: 1, visible: true, confirm: true });
  assert.deepEqual(out.milestoneCreateBody({ stage: "build", title: "QA", plannedOn: "2026-10-20", ownerParty: "client" }, { today: TODAY }).body, { stage: "build", title: "QA", ownerParty: "client", plannedOn: "2026-10-20" });
  assert.match(out.milestonePatchBody({ title: "QA" }, milestone).error, /No cambiaste/);
});

test("actualizaciones: publicar sin confirmar no genera cuerpo; las notas internas no llevan fecha ni vencimiento", () => {
  const update = { version: 3, kind: "client_update", title: "A", body: "b", dueOn: null };
  assert.match(out.updatePublishBody(update, false).error, /confirmación/);
  assert.deepEqual(out.updatePublishBody(update, true).body, { version: 3, confirm: true });
  assert.deepEqual(out.updateCreateBody({ kind: "internal_note", body: "solo nosotros" }).body, { kind: "internal_note", body: "solo nosotros" });
  assert.match(out.updateCreateBody({ kind: "client_update", body: "x" }).error, /Título/);
  assert.deepEqual(out.updateCreateBody({ kind: "action_required", title: "Aprobar", body: "mirá", dueOn: "2026-10-20" }, { today: TODAY }).body, { kind: "action_required", title: "Aprobar", body: "mirá", dueOn: "2026-10-20" });
  assert.match(out.updateWithdrawBody(update, "").error, /Motivo/);
});

test("revisión de solicitudes: solo viaja lo que cambió; vacío borra con null", () => {
  const request = { version: 2, publicResponse: "Hola", internalNote: "" };
  assert.deepEqual(out.reviewBody({ status: "reviewed", publicResponse: "Hola", internalNote: "" }, request).body, { version: 2, status: "reviewed" });
  assert.deepEqual(out.reviewBody({ status: "accepted", publicResponse: "", internalNote: "nota" }, request).body, { version: 2, status: "accepted", publicResponse: null, internalNote: "nota" });
  assert.match(out.reviewBody({ status: "cancelled" }, request).error, /Elegí/);
});

test("cambios de alcance: estimar exige horas, precio y plazo; aceptar exige referencia, fecha y alcance nuevo", () => {
  const change = { version: 1 };
  assert.match(out.changeEvaluateBody({ status: "estimated", hoursImpact: "4" }, change).error, /horas, precio y plazo/);
  assert.deepEqual(out.changeEvaluateBody({ status: "estimated", hoursImpact: "4", priceImpact: "-50.5", scheduleImpactDays: "2" }, change).body, { version: 1, status: "estimated", hoursImpact: 4, scheduleImpactDays: 2, priceImpactCents: -5050, technicalAssessment: null, commercialDecision: null });
  assert.match(out.changeDecisionBody({ decision: "accepted", reference: "R", acceptedOn: "2026-10-01", scopeItems: "" }, change, { today: TODAY }).error, /entre 1 y 30/);
  assert.deepEqual(out.changeDecisionBody({ decision: "accepted", reference: "R", acceptedOn: "2026-10-01", scopeItems: "A\nB" }, change, { today: TODAY }).body, { version: 1, decision: "accepted", acceptance: { reference: "R", acceptedOn: "2026-10-01", scopeItems: ["A", "B"] } });
  assert.deepEqual(out.changeDecisionBody({ decision: "rejected" }, change).body, { version: 1, decision: "rejected" });
  assert.deepEqual(out.memberBody("c1", "client_collaborator").body, { clientId: "c1", role: "client_collaborator" });
  assert.match(out.memberBody("", "x").error, /email/);
});
