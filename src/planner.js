import { agenda, todayISO } from "./rules.js";

export const GOAL_CATEGORIES = ["Operación", "Ventas", "Proyecto", "Personal"];
export const EVENT_TYPES = ["Llamada", "Reunión", "Seguimiento", "Hito", "Bloque de foco"];

export function localTime(now = new Date()) {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function auditStamp(date = todayISO(), time = localTime(), now = new Date()) {
  const occurred = new Date(`${date}T${time}:00`);
  if (!Number.isFinite(occurred.getTime())) throw new Error("Revisá la fecha y la hora del registro.");
  return { date, time, occurredAt: occurred.toISOString(), recordedAt: now.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/** Las fechas sin hora se conservan: un respaldo antiguo no inventa precisión. */
export function chronological(items) {
  return [...items].sort((a, b) => {
    const instant = (item) => new Date(item.occurredAt || `${item.date}T${item.time || "00:00"}:00`).getTime();
    return instant(a) - instant(b) || (a.recordedAt || "").localeCompare(b.recordedAt || "");
  });
}

export function goalProgress(goal) {
  const total = goal.steps.length;
  const done = goal.steps.filter((step) => step.done).length;
  const completed = total ? done === total : !!goal.completedAt;
  return { done, total, completed, pct: total ? Math.round(done / total * 100) : completed ? 100 : 0 };
}

export function toggleGoalStep(goal, stepId, now = new Date().toISOString()) {
  const step = goal.steps.find((item) => item.id === stepId);
  if (!step) return false;
  step.done = !step.done;
  step.completedAt = step.done ? now : null;
  goal.completedAt = goal.steps.every((item) => item.done) ? now : null;
  goal.updatedAt = now;
  return true;
}

export function dailyAgenda(data, today = todayISO()) {
  return [...agenda(data, today),
    ...data.goals.filter((goal) => !goalProgress(goal).completed).map((goal) => ({
      entity: "goal", id: goal.id, name: goal.category, title: goal.title, kind: "meta", due: goal.due,
      time: goal.time, unit: goal.priority === "alta" ? "Prioridad alta" : "Meta personal", delta: dayDelta(today, goal.due),
    })),
    ...data.calendarEvents.filter((event) => !event.completedAt).map((event) => ({
      entity: "event", id: event.id, name: event.type, title: event.title, kind: "evento", due: event.date,
      time: event.time, unit: `${event.duration} min`, delta: dayDelta(today, event.date),
    })),
  ].sort((a, b) => a.due.localeCompare(b.due) || (a.time || "23:59").localeCompare(b.time || "23:59") || a.title.localeCompare(b.title));
}

function dayDelta(start, end) {
  return Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000);
}

export function calendarItems(data) {
  const result = agenda(data).map((item) => ({ ...item, date: item.due, key: `${item.entity}:${item.id}:${item.kind}`, type: "operación", completed: false }));
  for (const project of data.projects) {
    if (project.milestone && !["closed", "support"].includes(project.stage) && !result.some((item) => item.id === project.id && item.kind === "hito")) {
      result.push({ ...project.milestone, entity: "project", id: project.id, name: project.name, date: project.milestone.due, key: `project:${project.id}:hito`, type: "operación", completed: false });
    }
  }
  for (const goal of data.goals) result.push({ ...goal, entity: "goal", date: goal.due, name: goal.category, key: `goal:${goal.id}`, type: "metas", completed: goalProgress(goal).completed });
  for (const event of data.calendarEvents) result.push({ ...event, entity: "event", name: event.type, key: `event:${event.id}`, type: "eventos", completed: !!event.completedAt });
  return result.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "23:59").localeCompare(b.time || "23:59"));
}

export function monthCells(month) {
  const [year, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const length = Math.ceil((offset + days) / 7) * 7;
  return Array.from({ length }, (_, index) => {
    const day = new Date(Date.UTC(year, m - 1, index - offset + 1));
    return { date: day.toISOString().slice(0, 10), current: day.getUTCMonth() === m - 1, day: day.getUTCDate() };
  });
}

export function salesPlan({ gap, ticket, conversion }) {
  if (![gap, ticket, conversion].every(Number.isFinite) || ticket <= 0 || conversion <= 0 || conversion > 100 || gap < 0) return null;
  const sales = Math.ceil(gap / ticket);
  return { sales, proposals: Math.ceil(sales / (conversion / 100)) };
}
