// Reglas del sistema Eclipse (Contexto Eclipse en Notion). Funciones puras: sin DOM ni storage.

export const UNITS = ["Agency", "Media", "Market"];
export const WARM_SOURCES = ["Referido", "Comunidad", "Presencial"];
export const SOURCES = ["Upwork", "Lote", "Web", ...WARM_SOURCES, "Otro"];

export const PROSPECT_STAGES = [
  ["contactado", "Contactado"],
  ["respondio", "Respondió"],
  ["llamada", "Llamada hecha"],
  ["propuesta", "Propuesta enviada"],
  ["ganado", "Ganado · seña cobrada"],
  ["perdido", "Perdido"],
  ["pausado", "Pausado"],
];
export const OPEN_STAGES = ["respondio", "llamada", "propuesta"];
export const TOUCH_OFFSETS = [2, 5, 9];

export const PROJECT_STAGES = [
  ["build", "Build"],
  ["qa", "QA"],
  ["entrega", "Entrega"],
  ["cobro", "Cobro de saldo"],
  ["referido", "Pedir referido"],
  ["cerrado", "Cerrado"],
];

export const PAYMENT_CONCEPTS = ["Seña", "Saldo", "Abono mensual", "Otro"];
export const SPLIT = [
  ["Colchón", 0.4],
  ["Reinversión", 0.4],
  ["Herramientas", 0.1],
  ["Goce", 0.1],
];

export const labelOf = (pairs, key) => pairs.find(([id]) => id === key)?.[1] || key;

// ---------- Fechas (días locales, formato YYYY-MM-DD) ----------

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayISO() {
  return toISODate(new Date());
}

function parse(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const date = parse(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function diffDays(from, to) {
  return Math.round((parse(to) - parse(from)) / 86400000);
}

export const inRange = (iso, start, end) => iso >= start && iso <= end;

// ---------- Prospectos ----------

const lastEvent = (prospect, type) =>
  [...(prospect.events || [])].filter((event) => event.type === type).sort((a, b) => a.date.localeCompare(b.date)).at(-1);

export function proposalOf(prospect) {
  return lastEvent(prospect, "propuesta");
}

export function hasResponded(prospect) {
  return (prospect.events || []).some((event) => event.type === "respuesta");
}

export const isWarm = (prospect) => WARM_SOURCES.includes(prospect.source);

/** Próxima acción de un prospecto según la regla: responde → llamada el mismo día → propuesta ≤24 h → toques +2/+5/+9. */
export function prospectNextAction(prospect) {
  switch (prospect.stage) {
    case "respondio": {
      const response = lastEvent(prospect, "respuesta");
      return { kind: "llamada", title: "Llamada (mismo día que respondió)", due: response?.date || prospect.createdAt };
    }
    case "llamada": {
      const call = lastEvent(prospect, "llamada");
      return { kind: "propuesta", title: "Enviar propuesta (≤24 h de la llamada)", due: addDays(call?.date || prospect.createdAt, 1) };
    }
    case "propuesta": {
      const proposal = proposalOf(prospect);
      if (!proposal) return null;
      const touches = prospect.events.filter((event) => event.type === "toque" && event.date >= proposal.date).length;
      if (touches < TOUCH_OFFSETS.length) {
        const offset = TOUCH_OFFSETS[touches];
        return { kind: "toque", title: `Toque ${touches + 1} de 3 (+${offset} días de la propuesta)`, due: addDays(proposal.date, offset) };
      }
      return { kind: "cerrar", title: "Sin respuesta tras 3 toques: cerrar o pausar", due: addDays(proposal.date, TOUCH_OFFSETS.at(-1) + 1) };
    }
    case "pausado": {
      const pause = lastEvent(prospect, "pausa");
      return pause?.reviewDate ? { kind: "revisar", title: "Revisar pausa", due: pause.reviewDate } : null;
    }
    default:
      return null;
  }
}

// ---------- Lotes ----------

/** Lote: D0 envío · D+2 señal · D+7 cierre e informe. */
export function batchNextAction(batch) {
  if (batch.report) return null;
  if (!batch.signal) return { kind: "señal", title: "Leer señal del lote (D+2)", due: addDays(batch.sentAt, 2) };
  return { kind: "cierre", title: "Cerrar lote e informe de 3 líneas (D+7)", due: addDays(batch.sentAt, 7) };
}

export function batchStats(batch, prospects) {
  const members = prospects.filter((prospect) => prospect.batchId === batch.id);
  const responded = members.filter(hasResponded).length;
  const proposals = members.filter((prospect) => proposalOf(prospect)).length;
  const won = members.filter((prospect) => prospect.stage === "ganado").length;
  return { size: members.length, responded, proposals, won, members };
}

// ---------- Proyectos y cobros ----------

export function projectPaid(project, payments) {
  return payments.filter((payment) => payment.projectId === project.id).reduce((sum, payment) => sum + payment.amount, 0);
}

export function projectBalance(project, payments) {
  return Math.max(0, project.total - projectPaid(project, payments));
}

/** Proyecto: seña → build → QA → entrega → cobro → referido en 48 h. */
export function projectNextAction(project, payments) {
  switch (project.stage) {
    case "build":
    case "qa":
    case "entrega":
      return project.deliveryDate
        ? { kind: "avanzar", title: `${labelOf(PROJECT_STAGES, project.stage)} · entrega comprometida`, due: project.deliveryDate }
        : null;
    case "cobro":
      return { kind: "cobro", title: `Cobrar saldo (USD ${formatNumber(projectBalance(project, payments))})`, due: project.deliveredAt || todayISO() };
    case "referido":
      return { kind: "referido", title: "Pedir referido (48 h desde el cobro)", due: addDays(project.paidAt || todayISO(), 2) };
    default:
      return null;
  }
}

// ---------- Agenda de hoy ----------

export function agenda(data, today = todayISO()) {
  const items = [];
  for (const prospect of data.prospects) {
    const next = prospectNextAction(prospect);
    if (next) items.push({ ...next, entity: "prospect", id: prospect.id, name: prospect.name, unit: prospect.unit });
  }
  for (const batch of data.batches) {
    const next = batchNextAction(batch);
    if (next) items.push({ ...next, entity: "batch", id: batch.id, name: batch.name, unit: batch.unit });
  }
  for (const project of data.projects) {
    const next = projectNextAction(project, data.payments);
    if (next) items.push({ ...next, entity: "project", id: project.id, name: project.name, unit: project.unit });
  }
  return items
    .map((item) => ({ ...item, delta: diffDays(today, item.due) }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
}

// ---------- Los 5 números ----------

export function fiveNumbers(data, start, end) {
  const created = data.prospects.filter((prospect) => inRange(prospect.createdAt, start, end));
  const proposals = data.prospects.flatMap((prospect) => prospect.events || []).filter((event) => event.type === "propuesta" && inRange(event.date, start, end));
  const collected = data.payments.filter((payment) => inRange(payment.date, start, end)).reduce((sum, payment) => sum + payment.amount, 0);
  const warm = created.filter(isWarm).length;
  return {
    newContacts: created.length,
    openConversations: data.prospects.filter((prospect) => OPEN_STAGES.includes(prospect.stage)).length,
    proposalsSent: proposals.length,
    collected,
    warmPct: created.length ? Math.round((warm / created.length) * 100) : null,
    warm,
  };
}

// ---------- Bimestre y MRR ----------

export function currentBimester(settings, today = todayISO()) {
  const list = settings.bimesters;
  return list.find((bimester) => inRange(today, bimester.start, bimester.end))
    || (today < list[0].start ? list[0] : list.at(-1));
}

export function bimesterProgress(data, today = todayISO()) {
  const bimester = currentBimester(data.settings, today);
  const payments = data.payments.filter((payment) => inRange(payment.date, bimester.start, bimester.end));
  const collected = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const goal = Object.values(bimester.goals).reduce((sum, value) => sum + value, 0);
  const totalDays = diffDays(bimester.start, bimester.end) + 1;
  const elapsed = Math.min(totalDays, Math.max(0, diffDays(bimester.start, today) + 1));
  const daysLeft = totalDays - elapsed;
  const expected = Math.round((goal * elapsed) / totalDays);
  const weeksLeft = Math.max(1, daysLeft / 7);
  // Una unidad sin meta en el bimestre igual puede cobrar (p. ej. Media en B1): se muestra como excedente.
  const byUnit = UNITS.map((unit) => ({
    unit,
    goal: bimester.goals[unit] || 0,
    collected: payments.filter((payment) => payment.unit === unit).reduce((sum, payment) => sum + payment.amount, 0),
  })).filter((row) => row.goal || row.collected);
  return {
    bimester, collected, goal, expected, daysLeft, elapsed, totalDays, byUnit,
    pct: goal ? Math.min(100, Math.round((collected / goal) * 100)) : 0,
    perWeekNeeded: Math.max(0, Math.ceil((goal - collected) / weeksLeft)),
  };
}

export function mrr(data) {
  return data.subscriptions.filter((subscription) => subscription.active).reduce((sum, subscription) => sum + subscription.amount, 0);
}

export function split(amount) {
  return SPLIT.map(([label, share]) => ({ label, share, amount: Math.round(amount * share) }));
}

/** Propuesto (propuestas abiertas) y por cobrar (saldos de proyectos activos): nunca se suman al cobrado. */
export function pipelineValues(data) {
  const proposed = data.prospects
    .filter((prospect) => prospect.stage === "propuesta")
    .reduce((sum, prospect) => sum + (proposalOf(prospect)?.amount || 0), 0);
  const receivable = data.projects
    .filter((project) => project.stage !== "cerrado")
    .reduce((sum, project) => sum + projectBalance(project, data.payments), 0);
  return { proposed, receivable };
}

export function formatNumber(value) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value || 0);
}
