import test from "node:test";
import assert from "node:assert/strict";
import { auditStamp, calendarItems, chronological, dailyAgenda, goalProgress, monthCells, salesPlan, toggleGoalStep } from "../src/planner.js";
import { batchNextAction, projectBalance, prospectNextAction, todayISO } from "../src/rules.js";
import { buildSeed, emptyData } from "../src/data/seed.js";
import { normalize } from "../src/data/store.js";

test("la última subtarea completa la meta; reabrir un paso la vuelve a abrir", () => {
  const goal = structuredClone(buildSeed("2026-10-07").goals[0]);
  assert.deepEqual(goalProgress(goal), { done: 1, total: 3, completed: false, pct: 33 });
  toggleGoalStep(goal, goal.steps[1].id, "2026-10-07T12:00:00Z");
  assert.equal(goal.completedAt, null);
  toggleGoalStep(goal, goal.steps[2].id, "2026-10-07T12:01:00Z");
  assert.equal(goal.completedAt, "2026-10-07T12:01:00Z");
  assert.equal(goalProgress(goal).pct, 100);
  toggleGoalStep(goal, goal.steps[0].id);
  assert.equal(goal.completedAt, null);
  assert.equal(toggleGoalStep(goal, "no-existe"), false);
});

test("las metas simples tienen un estado explícito y cero pasos", () => {
  assert.equal(goalProgress({ steps: [], completedAt: null }).completed, false);
  assert.equal(goalProgress({ steps: [], completedAt: "2026-10-07T12:00:00Z" }).pct, 100);
});

test("la agenda integra metas y eventos pendientes, excluyendo los completados", () => {
  const data = normalize(buildSeed("2026-10-07"));
  const first = dailyAgenda(data, "2026-10-07");
  assert.equal(first.filter((item) => item.entity === "goal").length, 2);
  assert.equal(first.filter((item) => item.entity === "event").length, 2);
  assert.equal(first.find((item) => item.id === "calendar-call").time, "15:00");
  data.goals[0].steps.forEach((step) => { step.done = true; });
  data.calendarEvents[0].completedAt = "2026-10-07T15:30:00Z";
  assert.equal(dailyAgenda(data).filter((item) => item.entity === "goal").length, 1);
  assert.equal(dailyAgenda(data).filter((item) => item.entity === "event").length, 1);
  assert.ok(first.every((item, i) => i === 0 || first[i - 1].due <= item.due));
});

test("el calendario conserva los hitos aunque la próxima acción sea del cliente", () => {
  const data = normalize(buildSeed("2026-10-07"));
  const items = calendarItems(data);
  assert.ok(items.some((item) => item.id === "pr-ropa" && item.title === "Plan de trabajo y accesos listos"));
  assert.equal(items.filter((item) => item.id === "pr-turnos" && item.kind === "hito").length, 1);
  assert.equal(new Set(items.map((item) => item.key)).size, items.length);
});

test("el mes empieza en lunes y cruza meses y años sin errores", () => {
  const october = monthCells("2026-10");
  assert.equal(october.length, 35);
  assert.equal(october[0].date, "2026-09-28");
  assert.equal(october.filter((cell) => cell.current).length, 31);
  assert.equal(monthCells("2024-02").filter((cell) => cell.current).length, 29);
  assert.equal(monthCells("2026-12").at(-1).date, "2027-01-03");
});

test("la cronología usa el instante, la hora y las fechas antiguas sin inventar horas", () => {
  const records = [
    { id: "late", ...auditStamp("2026-10-07", "16:00") },
    { id: "old", date: "2026-10-06" },
    { id: "early", ...auditStamp("2026-10-07", "09:00") },
  ];
  assert.deepEqual(chronological(records).map((item) => item.id), ["old", "early", "late"]);
  assert.equal(records[1].time, undefined);
  assert.ok(records[0].occurredAt.endsWith("Z"));
  assert.ok(records[0].recordedAt.endsWith("Z"));
  assert.ok(records[0].timezone);
});

test("un respaldo v2 migra sin reemplazar los registros ni agregar datos de ejemplo", () => {
  const old = buildSeed("2026-10-07");
  delete old.goals; delete old.calendarEvents; delete old.audit;
  old.version = 2;
  const data = normalize(old);
  assert.equal(data.version, 3);
  assert.deepEqual(data.goals, []);
  assert.deepEqual(data.calendarEvents, []);
  assert.deepEqual(data.audit, []);
  assert.deepEqual(data.payments, old.payments);
  assert.deepEqual(data.projects, old.projects);
  assert.equal(data.payments[0].time, undefined);
});

test("exportar e importar conserva metas, checklist, calendario y horas", () => {
  const data = normalize(buildSeed("2026-10-07"));
  toggleGoalStep(data.goals[0], data.goals[0].steps[1].id);
  data.audit.push({ id: "audit-test", title: "Paso completado", ...auditStamp("2026-10-07", "11:32") });
  const imported = normalize(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(imported, data);
  assert.equal(normalize(emptyData()).goals.length, 0);
});

test("rechaza respaldos con listas, fechas, horas o pasos inválidos", () => {
  assert.throws(() => normalize({}), /Falta la lista/);
  const invalid = (change) => { const data = buildSeed("2026-10-07"); change(data); return data; };
  assert.throws(() => normalize(invalid((data) => { data.goals = {}; })), /lista/);
  assert.throws(() => normalize(invalid((data) => { data.goals[0].due = "2026-02-31"; })), /meta/);
  assert.throws(() => normalize(invalid((data) => { data.calendarEvents[0].time = "25:00"; })), /evento/);
  assert.throws(() => normalize(invalid((data) => { data.goals[0].steps[0].done = "true"; })), /meta/);
});

test("la cadencia personalizada se usa en los vencimientos de los lotes", () => {
  const batch = { sentAt: "2026-10-07", signalDays: 3, closeDays: 10, signal: null, report: null };
  assert.equal(batchNextAction(batch).due, "2026-10-10");
  batch.signal = { note: "Señal" };
  assert.equal(batchNextAction(batch).due, "2026-10-17");
  batch.report = { worked: "Demo" };
  assert.equal(batchNextAction(batch), null);
});

test("un toque anterior a una nueva propuesta del mismo día no adelanta su seguimiento", () => {
  const prospect = { stage: "propuesta", events: [
    { type: "propuesta", date: "2026-10-07", time: "09:00", amount: 1000 },
    { type: "toque", date: "2026-10-07", time: "10:00" },
    { type: "propuesta", date: "2026-10-07", time: "15:00", amount: 1500 },
  ] };
  assert.equal(prospectNextAction(prospect).due, "2026-10-09");
  assert.ok(prospectNextAction(prospect).title.includes("1 de 3"));
});

test("la calculadora redondea hacia arriba y rechaza hipótesis inválidas", () => {
  assert.deepEqual(salesPlan({ gap: 10000, ticket: 1500, conversion: 25 }), { sales: 7, proposals: 28 });
  assert.deepEqual(salesPlan({ gap: 0, ticket: 1500, conversion: 25 }), { sales: 0, proposals: 0 });
  for (const conversion of [0, -1, 101, NaN]) assert.equal(salesPlan({ gap: 100, ticket: 10, conversion }), null);
  assert.equal(salesPlan({ gap: 100, ticket: 0, conversion: 25 }), null);
});

test("las reglas financieras existentes conservan el saldo de los proyectos", () => {
  const data = normalize(buildSeed(todayISO()));
  assert.equal(projectBalance(data.projects.find((item) => item.id === "pr-turnos"), data.payments), 800);
});
