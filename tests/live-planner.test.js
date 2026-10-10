import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENDA_TYPE_LABELS, GOAL_VIEWS, adaptAgendaItem, adaptAuditEvent, adaptEvent, adaptGoal, adaptIndicatorItem, adaptIndicators, actorLabel,
  auditChanges, eventOverlaps, goalMatches, goalProgress, isOperationItem, mergeAudit, minutesOf, monthGrid, parseRange, periodRange, rangeKey, sortGoals, timeOfMinutes, timeRange,
} from "../src/live/adapters/planner.js";
import {
  eventCreateBody, eventPatchBody, eventStatusBody, goalCreateBody, goalPatchBody, goalStatusBody, parseReference, parseSteps, stepAddBody, stepSetBody,
} from "../src/live/adapters/outbound-planner.js";
import { stepMonth } from "../src/live/modules/calendario.js";

process.env.TZ = "America/Argentina/Buenos_Aires";
const ME = "0e2e0e2e-0e2e-4e2e-8e2e-0e2e0e2e0e2e";
const OTHER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "9dd720bf-7f5d-4059-a252-80d0ecf2dd58";
const LEAD = "3931ac6f-f567-48a5-8561-604f9b909108";

const apiGoal = { id: "g1", title: "Cerrar propuesta", category: "sales", priority: "high", dueOn: "2026-10-10", dueTime: "15:30", notes: null, status: "open", refType: "project", refId: PROJECT, ownerAdminId: ME, completedAt: null, isExample: false, version: 3, createdAt: "2026-10-10T18:58:50.048Z", updatedAt: "2026-10-10T18:58:50.048Z", steps: [{ id: "s2", title: "dos", position: 1, doneAt: "2026-10-10T19:00:00.000Z" }, { id: "s1", title: "uno", position: 0, doneAt: null }] };

test("meta: pasos ordenados, progreso del servidor y propia vs. del equipo", () => {
  const goal = adaptGoal(apiGoal, { me: ME });
  assert.deepEqual(goal.steps.map((step) => step.id), ["s1", "s2"], "ordenados por posición");
  assert.deepEqual(goal.progress, { done: 1, total: 2, completed: false, pct: 50 });
  assert.equal(goal.high, true);
  assert.equal(goal.categoryLabel, "Ventas");
  assert.equal(goal.due, "2026-10-10");
  assert.equal(goal.time, "15:30");
  assert.equal(goal.notes, "");
  assert.equal(goal.mine, true);
  assert.equal(adaptGoal({ ...apiGoal, ownerAdminId: OTHER }, { me: ME }).mine, false);
  assert.equal(adaptGoal(apiGoal).mine, false, "sin sesión nada es propio");
  assert.equal(goalProgress([], "done").pct, 100, "una meta simple completada está al 100%");
  assert.equal(goalProgress([], "open").pct, 0);
});

test("metas: las vistas de la lista separan pendientes, próximas, completadas y canceladas", () => {
  const today = "2026-10-10";
  const make = (patch) => adaptGoal({ ...apiGoal, steps: [], ...patch }, { me: ME });
  const overdue = make({ dueOn: "2026-10-01" });
  const sinFecha = make({ dueOn: null, dueTime: null });
  const next = make({ dueOn: "2026-10-12" });
  const done = make({ status: "done" });
  const cancelled = make({ status: "cancelled" });
  assert.ok(goalMatches(overdue, "hoy", today) && goalMatches(sinFecha, "hoy", today), "lo vencido y lo sin fecha están pendientes");
  assert.ok(!goalMatches(next, "hoy", today) && goalMatches(next, "proximas", today));
  assert.ok(!goalMatches(sinFecha, "proximas", today));
  assert.ok(goalMatches(done, "completadas", today) && !goalMatches(done, "hoy", today));
  assert.ok(goalMatches(cancelled, "canceladas", today) && goalMatches(cancelled, "todas", today) && !goalMatches(cancelled, "hoy", today));
  assert.deepEqual(sortGoals([next, sinFecha, overdue]).map((goal) => goal.due), ["2026-10-01", "2026-10-12", null], "sin fecha al final");
  assert.equal(GOAL_VIEWS.length, 5);
});

const apiEvent = { id: "e1", title: "Llamada", type: "call", onDate: "2026-10-10", startTime: "10:00", durationMinutes: 30, notes: null, refType: null, refId: null, status: "scheduled", ownerAdminId: ME, completedAt: null, isExample: false, version: 1, createdAt: "2026-10-10T18:58:50.088Z", updatedAt: "2026-10-10T18:58:50.088Z" };

test("evento: hora de fin derivada solo cuando hay hora y duración; nunca se inventa", () => {
  const event = adaptEvent(apiEvent, { me: ME });
  assert.equal(event.endTime, "10:30");
  assert.equal(timeRange(event), "10:00–10:30");
  const allDay = adaptEvent({ ...apiEvent, startTime: null, durationMinutes: null }, { me: ME });
  assert.equal(allDay.endTime, null);
  assert.equal(timeRange(allDay), "Todo el día");
  assert.equal(timeRange(adaptEvent({ ...apiEvent, durationMinutes: null })), "10:00");
  assert.equal(adaptEvent({ ...apiEvent, status: "cancelled" }).cancelled, true);
  assert.equal(adaptEvent({ ...apiEvent, status: "done" }).done, true);
  assert.equal(minutesOf("09:05"), 545);
  assert.equal(timeOfMinutes(545), "09:05");
});

test("choques de horario: solo agendados del mismo responsable, del mismo día y con hora", () => {
  const events = [
    adaptEvent({ ...apiEvent, id: "a", startTime: "10:00", durationMinutes: 30 }, { me: ME }),
    adaptEvent({ ...apiEvent, id: "b", startTime: "11:00", durationMinutes: 60 }, { me: ME }),
    adaptEvent({ ...apiEvent, id: "c", startTime: "10:15", durationMinutes: 30, status: "cancelled" }, { me: ME }),
    adaptEvent({ ...apiEvent, id: "d", startTime: "10:10", durationMinutes: 30, ownerAdminId: OTHER }, { me: ME }),
    adaptEvent({ ...apiEvent, id: "e", onDate: "2026-10-11", startTime: "10:10", durationMinutes: 30 }, { me: ME }),
    adaptEvent({ ...apiEvent, id: "f", startTime: null, durationMinutes: null }, { me: ME }),
  ];
  const overlaps = (candidate) => eventOverlaps(events, { date: "2026-10-10", ownerAdminId: ME, ...candidate }).map((event) => event.id);
  assert.deepEqual(overlaps({ time: "10:20", duration: 30 }), ["a"], "cancelados, otro día, otro responsable y sin hora no cuentan");
  assert.deepEqual(overlaps({ time: "10:30", duration: 30 }), [], "terminar a las 10:30 no pisa a quien empieza a las 10:30");
  assert.deepEqual(overlaps({ time: "09:30", duration: 90 }), ["a"], "09:30–11:00 pisa a 10:00 pero no a 11:00");
  assert.deepEqual(overlaps({ time: "10:59", duration: 2 }), ["b"]);
  assert.deepEqual(overlaps({ time: null, duration: 30 }), [], "sin hora no se compara");
  assert.deepEqual(overlaps({ id: "a", time: "10:00", duration: 30 }), [], "no se pisa consigo mismo al editar");
  assert.deepEqual(overlaps({ time: "10:00", duration: 0 }), ["a"], "sin duración cuenta como un punto de un minuto");
});

test("rangos: la grilla del mes, claves y períodos de los indicadores", () => {
  assert.deepEqual(monthGrid("2026-10"), { from: "2026-09-28", to: "2026-11-01" });
  assert.equal(rangeKey("2026-09-28", "2026-11-01"), "2026-09-28..2026-11-01");
  assert.deepEqual(parseRange("2026-09-28..2026-11-01"), { from: "2026-09-28", to: "2026-11-01" });
  assert.deepEqual(periodRange("7", "2026-10-10"), { from: "2026-10-04", to: "2026-10-10" });
  assert.deepEqual(periodRange("30", "2026-10-10"), { from: "2026-09-11", to: "2026-10-10" });
  assert.deepEqual(periodRange("mes", "2026-10-10"), { from: "2026-10-01", to: "2026-10-10" });
  const span = (grid) => (new Date(grid.to) - new Date(grid.from)) / 86400000;
  for (const month of ["2026-02", "2026-10", "2027-01"]) assert.ok(span(monthGrid(month)) <= 41, "la grilla cabe en el máximo de 120 días de la API");
  assert.equal(stepMonth("2026-10-15", 1, "2026-10-10"), "2026-11-01");
  assert.equal(stepMonth("2026-11-20", -1, "2026-10-10"), "2026-10-10", "al volver al mes actual cae en hoy");
  assert.equal(stepMonth("2026-12-05", 1, "2026-10-10"), "2027-01-01", "cruza el año");
});

test("agenda: cada tipo enlaza a su pantalla y metas/eventos se distinguen de la operación", () => {
  const item = (type) => adaptAgendaItem({ type, id: LEAD, title: "Algo", on: "2026-10-10", time: null, overdue: false, ownerAdminId: ME }, { me: ME });
  assert.equal(item("goal_due").href, `#metas/${LEAD}`);
  assert.equal(item("calendar_event").href, `#calendario/${LEAD}`);
  assert.equal(item("lead_next_action").href, `#prospectos/${LEAD}`);
  assert.equal(item("proposal_touch").href, `#prospectos/${LEAD}`);
  assert.equal(item("batch_close").href, `#lotes/${LEAD}`);
  assert.equal(item("lead_review").typeLabel, AGENDA_TYPE_LABELS.lead_review);
  assert.equal(isOperationItem(item("goal_due")), false);
  assert.equal(isOperationItem(item("calendar_event")), false);
  assert.equal(isOperationItem(item("batch_signal")), true);
  assert.equal(item("goal_due").mine, true);
  assert.equal(item("goal_due").detail, "", "sin detalle no se inventa uno");
  assert.equal(adaptAgendaItem({ type: "proposal_touch", id: LEAD, title: "Toque +2 de la propuesta", on: "2026-10-10", time: null, overdue: false, ownerAdminId: ME, detail: "Constructora" }).detail, "Constructora", "la respuesta trae el nombre del prospecto aunque OpenAPI no lo documente");
  assert.equal(adaptAgendaItem({ type: "goal_due", id: "x", title: "t", on: "2026-10-10", time: "08:00", overdue: true, ownerAdminId: null }).mine, false);
});

const indicators = {
  period: { from: "2026-10-04", to: "2026-10-10" }, timezone: "America/Argentina/Buenos_Aires", includesExamples: false, asOf: "2026-10-10T18:58:44.766Z",
  indicators: {
    newContacts: { value: 3, definition: "d1", source: "s1" },
    conversationsOpened: { value: 2, openNow: 5, definition: "d2", source: "s2" },
    proposalsSent: { value: 1, leads: 1, definition: "d3", source: "s3" },
    usdCollected: { value: 45000, priceCents: 40000, maintenanceCents: 5000, currency: "USD", definition: "d4", source: "s4" },
    warmShare: { warm: 1, total: 3, percent: 33.3, definition: "d5", source: "s5" },
  },
  pipeline: { collectedCents: 45000, promisedCents: 100, proposedOpenCents: 200 },
};

test("indicadores: valor, definición y fuente del servidor; openNow y desglose de dinero se conservan", () => {
  const data = adaptIndicators(indicators);
  assert.deepEqual(data.list.map((item) => item.key), ["new_contacts", "conversations", "proposals", "collected", "warm_share"]);
  const byKey = Object.fromEntries(data.list.map((item) => [item.key, item]));
  assert.equal(byKey.new_contacts.value, 3);
  assert.equal(byKey.conversations.openNow, 5);
  assert.equal(byKey.proposals.leads, 1);
  assert.equal(byKey.collected.value, 45000);
  assert.equal(byKey.collected.priceCents, 40000);
  assert.equal(byKey.collected.maintenanceCents, 5000);
  assert.equal(byKey.warm_share.value, 33.3);
  assert.equal(byKey.warm_share.definition, "d5");
  assert.equal(byKey.warm_share.source, "s5");
  assert.equal(data.timezone, "America/Argentina/Buenos_Aires");
  assert.equal(data.pipeline.promisedCents, 100);
  assert.equal(data.pipeline.restricted, false);
});

test("indicadores: sin billing:read el dinero llega restringido y no se inventa un número", () => {
  const data = adaptIndicators({ ...indicators, indicators: { ...indicators.indicators, usdCollected: { restricted: true, requires: "billing:read" } }, pipeline: { restricted: true, requires: "billing:read" } });
  const collected = data.list.find((item) => item.key === "collected");
  assert.equal(collected.restricted, true);
  assert.equal(collected.value, null);
  assert.equal(collected.requires, "billing:read");
  assert.equal(data.pipeline.restricted, true);
  const none = adaptIndicators({ ...indicators, indicators: { ...indicators.indicators, warmShare: { warm: 0, total: 0, percent: null, definition: "d", source: "s" } } });
  assert.equal(none.list.find((item) => item.key === "warm_share").value, null, "sin contactos el porcentaje es nulo, no 0");
});

test("desglose de un indicador: cada tipo de fila trae lo suyo y lo que falta queda en null", () => {
  const lead = adaptIndicatorItem("new_contacts", { leadId: LEAD, contactName: "Ana <b>", source: "referral", warm: true, firstContactOn: "2026-10-05", firstConversationOn: null });
  assert.deepEqual([lead.kind, lead.name, lead.sourceLabel, lead.warm, lead.firstConversationOn], ["lead", "Ana <b>", "Referido", true, null], "el texto no se toca: se escapa al dibujar");
  const proposal = adaptIndicatorItem("proposals", { activityId: "a1", leadId: LEAD, occurredOn: "2026-10-06", batchId: null });
  assert.equal(proposal.amountCents, null, "sin billing:read el servidor no manda el importe");
  assert.equal(adaptIndicatorItem("proposals", { activityId: "a1", leadId: LEAD, occurredOn: "2026-10-06", amountCents: 150050, batchId: null }).amountCents, 150050);
  const payment = adaptIndicatorItem("collected", { paymentId: "p1", projectId: PROJECT, kind: "maintenance", amountCents: 3000, currency: "USD", receivedOn: "2026-10-07", countsTowardBalance: false });
  assert.deepEqual([payment.kind, payment.paymentKind, payment.amountCents, payment.date, payment.countsTowardBalance], ["payment", "maintenance", 3000, "2026-10-07", false]);
  assert.equal(adaptIndicatorItem("conversations", { leadId: LEAD, contactName: "X", source: "mystery" }).sourceLabel, "mystery", "una fuente desconocida se muestra tal cual");
});

test("auditoría: instante UTC → día y hora locales; sin instante, ni día ni hora", () => {
  const source = { kind: "project", id: PROJECT, name: "Clínica" };
  const event = adaptAuditEvent({ id: "x", occurredAt: "2026-10-10T18:58:16.028Z", actorKind: "admin", actorId: ME, action: "payment.collected", resourceType: "payment", resourceId: "p", result: "success", before: null, after: { kind: "deposit", status: "collected", amountCents: 45000, receivedOn: "2026-10-10" } }, source);
  assert.equal(event.date, "2026-10-10");
  assert.equal(event.time, "15:58", "Buenos Aires es UTC-3");
  assert.equal(event.actionLabel, "Cobro registrado");
  assert.equal(event.resourceLabel, "Cobro");
  assert.ok(event.changes.some((row) => row.field === "amountCents" && row.toText === "USD 450"), "el dinero en centavos se muestra en dólares");
  assert.ok(event.changes.some((row) => row.field === "kind" && row.toText === "Seña" && row.fromText === ""), "los valores crudos se traducen y un alta no muestra un «antes»");
  const unknown = adaptAuditEvent({ id: "y", occurredAt: null, actorKind: "system", actorId: null, action: "something.new", resourceType: "thing", resourceId: "t", result: "failed" }, source);
  assert.equal(unknown.at, null);
  assert.equal(unknown.date, null);
  assert.equal(unknown.time, null, "Hora no registrada");
  assert.equal(unknown.actionLabel, "something.new", "una acción desconocida se muestra tal cual");
  assert.equal(adaptAuditEvent({ id: "z", occurredAt: "no es una fecha", actorKind: "admin", actorId: ME, action: "a", resourceType: "r", resourceId: "i", result: "success" }, source).time, null);
});

test("auditoría: quién, cambios resumidos y fusión ordenada de fuentes", () => {
  assert.equal(actorLabel({ actorKind: "admin", actorId: ME }, ME), "Vos");
  assert.equal(actorLabel({ actorKind: "admin", actorId: OTHER }, ME), "Administrador · cuenta 11111111");
  assert.equal(actorLabel({ actorKind: "system", actorId: null }, ME), "Sistema");
  assert.equal(actorLabel({ actorKind: "client", actorId: OTHER }, ME), "Cliente · cuenta 11111111");
  assert.deepEqual(auditChanges({ stage: "preparation", version: 1 }, { stage: "build", version: 2 }), [{ field: "stage", label: "Etapa", from: "preparation", to: "build", fromText: "Preparación", toText: "Construcción" }], "la versión no se muestra");
  assert.deepEqual(auditChanges(null, { nested: { a: 1 } }), [], "los objetos anidados no se vuelcan");
  assert.equal(auditChanges({}, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }).length, 4, "máximo cuatro");
  const mk = (id, at) => ({ id, at });
  const merged = mergeAudit([{ events: [mk("a", "2026-10-10T10:00:00Z"), mk("c", null)] }, { events: [mk("b", "2026-10-10T12:00:00Z")] }]);
  assert.deepEqual(merged.map((event) => event.id), ["b", "a", "c"], "del más nuevo al más viejo; sin instante, al final");
});

// ---------- Cuerpos hacia la API ----------

test("referencias y pasos", () => {
  assert.deepEqual(parseReference("project:" + PROJECT), { ref: { refType: "project", refId: PROJECT } });
  assert.deepEqual(parseReference("lead:" + LEAD), { ref: { refType: "lead", refId: LEAD } });
  assert.deepEqual(parseReference(""), { ref: null });
  assert.match(parseReference("batch:" + LEAD).error, /referencia/);
  assert.match(parseReference("lead:no-es-uuid").error, /referencia/);
  assert.deepEqual(parseSteps("  uno \n\n dos\nuno\n"), ["uno", "dos"], "sin vacíos ni repetidos");
});

const goalForm = { title: "  Cerrar propuesta ", category: "sales", priority: "high", due: "2026-10-12", time: "09:30", notes: " contexto ", steps: "uno\ndos", reference: `project:${PROJECT}` };

test("cuerpo de meta: solo lo que existe, sin cadenas vacías ni campos de más", () => {
  assert.deepEqual(goalCreateBody(goalForm).body, { title: "Cerrar propuesta", category: "sales", priority: "high", dueOn: "2026-10-12", dueTime: "09:30", notes: "contexto", refType: "project", refId: PROJECT, steps: ["uno", "dos"] });
  assert.deepEqual(goalCreateBody({ title: "Simple", category: "personal" }).body, { title: "Simple", category: "personal", priority: "normal" });
  assert.deepEqual(goalCreateBody({ title: "Sin hora", category: "sales", due: "2026-10-12", time: "" }).body, { title: "Sin hora", category: "sales", priority: "normal", dueOn: "2026-10-12" });
});

test("cuerpo de meta: validaciones en español", () => {
  const error = (patch) => goalCreateBody({ ...goalForm, ...patch }).error;
  assert.match(error({ title: "   " }), /Meta: completalo/);
  assert.match(error({ title: "x".repeat(161) }), /máximo 160/);
  assert.match(error({ category: "otra" }), /Área/);
  assert.match(error({ priority: "urgente" }), /Prioridad/);
  assert.match(error({ due: "2026-02-30" }), /fecha no es válida/);
  assert.match(error({ due: "2019-12-31" }), /entre 2020 y 2100/);
  assert.match(error({ time: "9:30" }), /HH:MM/);
  assert.match(error({ due: "", time: "09:30" }), /necesita un día/);
  assert.match(error({ notes: "a".repeat(2001) }), /Contexto: máximo 2000/);
  assert.match(error({ reference: "lead:123" }), /referencia/);
  assert.match(error({ steps: Array.from({ length: 51 }, (_, i) => `paso ${i}`).join("\n") }), /máximo 50/);
  assert.match(error({ steps: `ok\n${"x".repeat(161)}` }), /máximo 160/);
  assert.match(error({ title: "mal\u0007título" }), /caracteres que no se pueden guardar/);
});

test("edición de meta: manda solo lo que cambió, con la versión; vaciar manda null", () => {
  const goal = adaptGoal(apiGoal, { me: ME });
  const form = { title: goal.title, category: "sales", priority: "high", due: "2026-10-10", time: "15:30", notes: "" };
  assert.match(goalPatchBody(form, goal).error, /No cambiaste nada/);
  assert.deepEqual(goalPatchBody({ ...form, title: "Nuevo título" }, goal).body, { version: 3, title: "Nuevo título" });
  assert.deepEqual(goalPatchBody({ ...form, due: "", time: "" }, goal).body, { version: 3, dueOn: null, dueTime: null });
  assert.deepEqual(goalPatchBody({ ...form, due: "2026-10-11" }, goal).body, { version: 3, dueOn: "2026-10-11" });
  assert.deepEqual(goalPatchBody({ ...form, notes: "algo" }, goal).body, { version: 3, notes: "algo" });
  assert.deepEqual(goalPatchBody({ ...form, priority: "normal" }, goal).body, { version: 3, priority: "normal" });
  const teamGoal = adaptGoal({ ...apiGoal, ownerAdminId: OTHER }, { me: ME });
  assert.match(goalPatchBody({ ...form, category: "personal" }, teamGoal, { me: ME }).error, /responsable/);
  assert.ok(goalPatchBody({ ...form, category: "personal" }, goal, { me: ME }).body, "la dueña sí puede volverla personal");
});

test("estado de una meta: no se completa a mano con pasos pendientes (lo decide el servidor al terminar el último)", () => {
  const goal = adaptGoal(apiGoal, { me: ME });
  assert.match(goalStatusBody(goal, "done").error, /se completa sola/);
  assert.deepEqual(goalStatusBody(goal, "cancelled").body, { version: 3, status: "cancelled" });
  const simple = adaptGoal({ ...apiGoal, steps: [] }, { me: ME });
  assert.deepEqual(goalStatusBody(simple, "done").body, { version: 3, status: "done" });
  assert.match(goalStatusBody(simple, "archivada").error, /no válido/);
  assert.deepEqual(stepSetBody(true).body, { done: true });
  assert.deepEqual(stepSetBody(false).body, { done: false });
  assert.deepEqual(stepAddBody({ title: " Revisar " }).body, { title: "Revisar" });
  assert.match(stepAddBody({ title: " " }).error, /Paso: completalo/);
  assert.match(stepAddBody({ title: "x".repeat(161) }).error, /máximo 160/);
});

const eventForm = { title: " Llamada ", type: "call", date: "2026-10-12", time: "10:00", duration: "30", notes: "", reference: `lead:${LEAD}` };

test("cuerpo de evento: hora y duración opcionales; la duración exige hora y no cruza la medianoche", () => {
  assert.deepEqual(eventCreateBody(eventForm).body, { title: "Llamada", type: "call", onDate: "2026-10-12", startTime: "10:00", durationMinutes: 30, refType: "lead", refId: LEAD });
  assert.deepEqual(eventCreateBody({ ...eventForm, time: "", duration: "", reference: "" }).body, { title: "Llamada", type: "call", onDate: "2026-10-12" }, "todo el día");
  assert.match(eventCreateBody({ ...eventForm, time: "", duration: "30" }).error, /necesita una hora/);
  assert.match(eventCreateBody({ ...eventForm, time: "23:30", duration: "45" }).error, /medianoche/);
  assert.ok(eventCreateBody({ ...eventForm, time: "23:30", duration: "30" }).body, "justo hasta las 24:00 entra");
  assert.match(eventCreateBody({ ...eventForm, duration: "0" }).error, /entre 1 y 1440/);
  assert.match(eventCreateBody({ ...eventForm, duration: "1441" }).error, /entre 1 y 1440/);
  assert.match(eventCreateBody({ ...eventForm, duration: "12.5" }).error, /entre 1 y 1440/);
  assert.match(eventCreateBody({ ...eventForm, type: "fiesta" }).error, /Tipo/);
  assert.match(eventCreateBody({ ...eventForm, date: "" }).error, /elegí una fecha/);
  assert.match(eventCreateBody({ ...eventForm, title: "" }).error, /Actividad: completalo/);
});

test("edición y estado de un evento: solo lo que cambió; se cancela, no se borra", () => {
  const event = adaptEvent(apiEvent, { me: ME });
  const form = { title: "Llamada", type: "call", date: "2026-10-10", time: "10:00", duration: "30", notes: "" };
  assert.match(eventPatchBody(form, event).error, /No cambiaste nada/);
  assert.deepEqual(eventPatchBody({ ...form, time: "11:00" }, event).body, { version: 1, startTime: "11:00" });
  assert.deepEqual(eventPatchBody({ ...form, date: "2026-10-11" }, event).body, { version: 1, onDate: "2026-10-11" });
  assert.deepEqual(eventPatchBody({ ...form, time: "", duration: "" }, event).body, { version: 1, startTime: null, durationMinutes: null }, "pasar a todo el día");
  assert.deepEqual(eventPatchBody({ ...form, notes: "n" }, event).body, { version: 1, notes: "n" });
  assert.deepEqual(eventStatusBody(event, "done").body, { version: 1, status: "done" });
  assert.deepEqual(eventStatusBody(event, "cancelled").body, { version: 1, status: "cancelled" });
  assert.deepEqual(eventStatusBody(event, "scheduled").body, { version: 1, status: "scheduled" });
  assert.match(eventStatusBody(event, "deleted").error, /no válido/);
});
