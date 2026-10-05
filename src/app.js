import { load, newId, normalize, reset, save } from "./data/store.js";
import {
  OPEN_STAGES, PAYMENT_CONCEPTS, PROJECT_STAGES, PROSPECT_STAGES, SOURCES, UNITS,
  addDays, agenda, batchNextAction, batchStats, bimesterProgress, currentBimester, diffDays, fiveNumbers, formatNumber,
  inRange, isWarm, labelOf, mrr, pipelineValues, projectBalance, projectNextAction, projectPaid, proposalOf,
  prospectNextAction, split, todayISO,
} from "./rules.js";

const NAV = [
  { id: "hoy", label: "Hoy", icon: "today" },
  { id: "prospectos", label: "Prospectos", icon: "contacts" },
  { id: "lotes", label: "Lotes", icon: "batch" },
  { id: "proyectos", label: "Proyectos", icon: "projects" },
  { id: "cobros", label: "Cobros", icon: "money" },
];

const state = {
  data: load(),
  filters: {
    prospectos: { search: "", stage: "abiertos", unit: "", source: "" },
    proyectos: { unit: "", show: "activos" },
    cobros: { unit: "", period: "bimestre" },
  },
  modal: null,
};

function commit(message, tone = "success") {
  const saved = save(state.data);
  state.modal = null;
  render();
  if (message) toast(saved ? message : `${message} (no se pudo guardar en este navegador: exportá un respaldo)`, saved ? tone : "warning");
}

// ---------- Utilidades de presentación ----------

const iconPaths = {
  today: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M8 2.8v3.5M16 2.8v3.5M4 9h16M8 13h2m3 0h2m-7 3h2"/>',
  contacts: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.5-3.3 2.5-5.2 6-5.2s5.5 1.9 6 5.2M16 5.1a3.2 3.2 0 0 1 0 6.2M17.5 15c2.1.5 3.3 2.1 3.5 5"/>',
  batch: '<path d="M4 7.5 12 4l8 3.5-8 3.5-8-3.5Z"/><path d="m4 12 8 3.5 8-3.5M4 16.5 12 20l8-3.5"/>',
  projects: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4V2.8h8V4M7 9h10M7 13h5m-5 3h8"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
  check: '<path d="m5 12 4.2 4.2L19.5 6"/>',
  data: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
};

function icon(name, className = "") {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || ""}</svg>`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const usd = (value) => `USD ${formatNumber(value)}`;
const badge = (label, tone = "neutral") => `<span class="badge badge-${tone}">${esc(label)}</span>`;

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fmtDate(iso) {
  if (!iso) return "—";
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function longToday() {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
}

function dueText(due) {
  const delta = diffDays(todayISO(), due);
  if (delta < 0) return { text: `Vencido hace ${-delta} d`, tone: "overdue" };
  if (delta === 0) return { text: "Hoy", tone: "today" };
  if (delta === 1) return { text: "Mañana", tone: "upcoming" };
  return { text: `${fmtDate(due)} · en ${delta} d`, tone: "later" };
}

function dueBadge(due) {
  const { text, tone } = dueText(due);
  const map = { overdue: "red", today: "amber", upcoming: "blue", later: "neutral" };
  return badge(text, map[tone]);
}

const STAGE_TONES = { contactado: "neutral", respondio: "amber", llamada: "amber", propuesta: "blue", ganado: "green", perdido: "red", pausado: "neutral" };
const stageBadge = (stage) => badge(labelOf(PROSPECT_STAGES, stage), STAGE_TONES[stage]);

function options(list, selected, emptyLabel) {
  const items = list.map((item) => (Array.isArray(item) ? item : [item, item]));
  return `${emptyLabel !== undefined ? `<option value="">${esc(emptyLabel)}</option>` : ""}${items
    .map(([value, label]) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`)
    .join("")}`;
}

function progressBar(pct, markerPct) {
  const marker = markerPct === undefined ? "" : `<span class="progress-marker" style="left:${Math.min(100, markerPct)}%" title="Ritmo esperado a hoy"></span>`;
  return `<div class="progress" role="presentation"><span class="progress-fill" style="width:${Math.min(100, pct)}%"></span>${marker}</div>`;
}

const find = (list, id) => state.data[list].find((item) => item.id === id);

// ---------- Layout ----------

function routeInfo() {
  const raw = window.location.hash.replace(/^#\/?/, "") || "hoy";
  const [view, id] = raw.split("/");
  return { view: NAV.some((item) => item.id === view) ? view : "hoy", id: id ? decodeURIComponent(id) : "" };
}

function navCount(id) {
  const today = todayISO();
  if (id === "hoy") return agenda(state.data, today).filter((item) => item.due <= today).length;
  if (id === "prospectos") return state.data.prospects.filter((prospect) => OPEN_STAGES.includes(prospect.stage)).length;
  if (id === "lotes") return state.data.batches.filter((batch) => !batch.report).length;
  if (id === "proyectos") return state.data.projects.filter((project) => project.stage !== "cerrado").length;
  return 0;
}

function shell(inner, activeView, crumb) {
  const bimester = currentBimester(state.data.settings);
  const nav = NAV.map((item) => {
    const count = navCount(item.id);
    return `<a class="nav-item" href="#${item.id}"${item.id === activeView ? ' aria-current="page"' : ""}>${icon(item.icon, "nav-icon")}<span>${item.label}</span>${count ? `<span class="nav-count${item.id === "hoy" ? " nav-count-alert" : ""}">${count}</span>` : ""}</a>`;
  }).join("");
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand-lockup"><span class="brand-mark" aria-hidden="true"></span><div><p class="brand-name">Eclipse</p><p class="brand-caption">Operación</p></div></div>
      <nav class="primary-nav" aria-label="Secciones">${nav}</nav>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-foot">
        <p class="sidebar-rule">Venta demo-first · lotes chicos.<br>Prospección ≥ 20% de la capacidad.</p>
        <p class="sidebar-rule">Un proyecto existe cuando se cobró.</p>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <div class="crumb"><span class="optional-crumb">${esc(bimester.label)}</span><span class="crumb-sep optional-crumb">/</span><strong>${esc(crumb)}</strong></div>
        <div class="topbar-tools"><button class="quiet-button" type="button" data-action="open-data">${icon("data", "button-icon")}<span>Datos</span></button></div>
      </header>
      <main id="main-content" class="content-wrap" tabindex="-1">${inner}</main>
    </div>
  </div><div class="toast-region" aria-live="polite"></div>`;
}

function pageHeading(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ""}<h1>${esc(title)}</h1>${description ? `<p class="page-description">${description}</p>` : ""}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</div>`;
}

const primary = (action, label, extra = "") => `<button class="primary-button" type="button" data-action="${action}"${extra}>${icon("plus", "button-icon")}<span>${esc(label)}</span></button>`;

// ---------- Hoy ----------

function agendaAction(item) {
  const href = { prospect: "prospectos", batch: "lotes", project: "proyectos" }[item.entity];
  const button = (action, label, kind = "") => `<button class="quiet-button button-small" type="button" data-action="${action}" data-id="${esc(item.id)}"${kind ? ` data-kind="${kind}"` : ""}>${esc(label)}</button>`;
  switch (`${item.entity}:${item.kind}`) {
    case "prospect:llamada": return button("prospect-event", "Llamada hecha", "llamada");
    case "prospect:propuesta": return button("prospect-event", "Propuesta enviada", "propuesta");
    case "prospect:toque": return button("prospect-event", "Toque hecho", "toque");
    case "batch:señal": return button("batch-signal", "Registrar señal");
    case "batch:cierre": return button("batch-close", "Cerrar lote");
    case "project:cobro": return button("new-payment", "Registrar cobro");
    case "project:referido": return button("project-referral", "Referido pedido");
    default: return `<a class="quiet-button button-small" href="#${href}/${encodeURIComponent(item.id)}">Abrir</a>`;
  }
}

function agendaRow(item) {
  const href = { prospect: "prospectos", batch: "lotes", project: "proyectos" }[item.entity];
  const type = { prospect: "Prospecto", batch: "Lote", project: "Proyecto" }[item.entity];
  const tone = item.delta < 0 ? "urgent" : item.delta === 0 ? "upcoming" : "";
  return `<div class="action-row">
    <span class="action-mark ${tone}" aria-hidden="true">${item.delta < 0 ? "!" : item.delta === 0 ? "•" : fmtDate(item.due).split(" ")[0]}</span>
    <div><p class="action-title">${esc(item.title)}</p><p class="action-summary"><a class="inline-link" href="#${href}/${encodeURIComponent(item.id)}">${esc(item.name)}</a> · ${type} · ${esc(item.unit)}</p></div>
    <div class="action-side">${dueBadge(item.due)}${agendaAction(item)}</div>
  </div>`;
}

function renderHoy() {
  const today = todayISO();
  const items = agenda(state.data, today);
  const now = items.filter((item) => item.delta <= 0);
  const soon = items.filter((item) => item.delta > 0 && item.delta <= 7);
  const progress = bimesterProgress(state.data, today);
  const numbers = fiveNumbers(state.data, addDays(today, -6), today);
  const currentMrr = mrr(state.data);
  const mrrGoal = state.data.settings.mrrGoal;
  const pipeline = pipelineValues(state.data);
  const ahead = progress.collected >= progress.expected;

  const metrics = [
    ["Contactos nuevos", numbers.newContacts, "prospectos dados de alta"],
    ["Conversaciones abiertas", numbers.openConversations, "respondió · llamada · propuesta"],
    ["Propuestas enviadas", numbers.proposalsSent, "en los últimos 7 días"],
    ["USD cobrado", usd(numbers.collected), "el número que decide", true],
    ["% contactos tibios", numbers.warmPct === null ? "—" : `${numbers.warmPct}%`, "referido · comunidad · presencial"],
  ];

  return shell(`${pageHeading(progress.bimester.label, "Hoy", esc(longToday().replace(/^./, (c) => c.toUpperCase())))}
    <section class="goal-grid" aria-label="Metas">
      <div class="card goal-card">
        <div class="section-heading"><div><h2>Cobrado en el bimestre</h2><p>Meta ${usd(progress.goal)} · quedan ${progress.daysLeft} días</p></div>${badge(ahead ? "Arriba del ritmo" : "Debajo del ritmo", ahead ? "green" : "amber")}</div>
        <p class="goal-value">${usd(progress.collected)} <span>/ ${formatNumber(progress.goal)}</span></p>
        ${progressBar(progress.pct, (progress.expected / progress.goal) * 100)}
        <p class="tiny goal-foot">Ritmo lineal a hoy: ${usd(progress.expected)} · para llegar hacen falta <strong>${usd(progress.perWeekNeeded)} por semana</strong>.</p>
      </div>
      <div class="card goal-card">
        <div class="section-heading"><div><h2>MRR</h2><p>Hito para soltar TSOFT: ${usd(mrrGoal)}/mes</p></div><a class="link-button" href="#cobros">Abonos</a></div>
        <p class="goal-value">${usd(currentMrr)} <span>/ ${formatNumber(mrrGoal)}</span></p>
        ${progressBar((currentMrr / mrrGoal) * 100)}
        <p class="tiny goal-foot">Si el bimestral y el MRR se contradicen, gana el MRR.</p>
      </div>
      <div class="split-metrics goal-split">
        <div class="split-metric"><span class="label">Propuesto (abierto)</span><span class="value">${usd(pipeline.proposed)}</span><span class="source">No es ingreso</span></div>
        <div class="split-metric"><span class="label">Por cobrar (saldos)</span><span class="value">${usd(pipeline.receivable)}</span><span class="source">Proyectos con seña</span></div>
        <div class="split-metric"><span class="label">Cobrado (bimestre)</span><span class="value">${usd(progress.collected)}</span><span class="source">Lo único que cuenta</span></div>
      </div>
    </section>

    <section class="section-block" aria-labelledby="numbers-title">
      <div class="section-heading"><div><h2 id="numbers-title">Los 5 números · últimos 7 días</h2><p>${fmtDate(addDays(today, -6))} – ${fmtDate(today)}</p></div></div>
      <div class="grid metric-grid">${metrics.map(([label, value, hint, key]) => `<div class="metric-card${key ? " metric-key" : ""}"><p class="metric-label">${esc(label)}</p><p class="metric-value">${esc(value)}</p><p class="metric-unit">${esc(hint)}</p></div>`).join("")}</div>
    </section>

    <section class="section-block today-grid">
      <div class="card">
        <div class="section-heading"><div><h2>Qué toca hoy</h2><p>Vencido y del día, según las reglas de prospecto, lote y proyecto.</p></div>${badge(`${now.length}`, now.some((item) => item.delta < 0) ? "red" : "neutral")}</div>
        <div class="action-list">${now.length ? now.map(agendaRow).join("") : `<div class="empty-state"><strong>Nada pendiente para hoy</strong><p>Buen momento para prospectar: la prospección nunca baja del 20% de la capacidad.</p></div>`}</div>
      </div>
      <div class="card">
        <div class="section-heading"><div><h2>Próximos 7 días</h2></div></div>
        <div class="action-list">${soon.length ? soon.map(agendaRow).join("") : `<p class="tiny">Sin acciones programadas.</p>`}</div>
      </div>
    </section>`, "hoy", "Hoy");
}

// ---------- Prospectos ----------

const fold = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function filteredProspects() {
  const f = state.filters.prospectos;
  const q = fold(f.search.trim());
  return state.data.prospects
    .filter((prospect) => {
      if (f.stage === "abiertos" && ["ganado", "perdido"].includes(prospect.stage)) return false;
      if (f.stage && f.stage !== "abiertos" && prospect.stage !== f.stage) return false;
      if (f.unit && prospect.unit !== f.unit) return false;
      if (f.source && prospect.source !== f.source) return false;
      return !q || fold(`${prospect.name} ${prospect.contact} ${prospect.need}`).includes(q);
    })
    .map((prospect) => ({ prospect, next: prospectNextAction(prospect) }))
    .sort((a, b) => (a.next?.due || "9999").localeCompare(b.next?.due || "9999"));
}

function renderProspectos() {
  const f = state.filters.prospectos;
  const rows = filteredProspects();
  const counts = PROSPECT_STAGES.map(([id, label]) => ({ id, label, count: state.data.prospects.filter((prospect) => prospect.stage === id).length }));
  const table = rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Prospecto</th><th>Etapa</th><th>Fuente</th><th>Propuesta</th><th>Próxima acción</th></tr></thead><tbody>${rows.map(({ prospect, next }) => {
      const proposal = proposalOf(prospect);
      return `<tr>
        <td><a class="table-primary" href="#prospectos/${encodeURIComponent(prospect.id)}">${esc(prospect.name)}</a><span class="table-secondary">${esc(prospect.unit)} · ${esc(prospect.contact)}</span></td>
        <td>${stageBadge(prospect.stage)}</td>
        <td>${esc(prospect.source)}${isWarm(prospect) ? ` ${badge("tibio", "amber")}` : ""}</td>
        <td>${proposal?.amount ? usd(proposal.amount) : `<span class="subtle">${esc(prospect.offer || "—")}</span>`}</td>
        <td class="table-next">${next ? `<span class="table-next-title">${esc(next.title)}</span>${dueBadge(next.due)}` : `<span class="subtle">${prospect.stage === "contactado" ? "Esperando respuesta" : "—"}</span>`}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`
    : `<div class="empty-state"><strong>Sin prospectos con estos filtros</strong><p>Cambiá los filtros o cargá uno nuevo.</p></div>`;

  return shell(`${pageHeading("Pipeline", "Prospectos", "Responde → llamada el mismo día → propuesta en ≤24 h → toques a +2, +5 y +9 días. La próxima acción se calcula sola.", primary("new-prospect", "Prospecto"))}
    <div class="pipeline-row">${counts.map((stage) => `<button type="button" class="pipeline-card${f.stage === stage.id ? " active" : ""}" data-action="filter-stage" data-id="${stage.id}"><strong>${stage.count}</strong><span>${esc(stage.label)}</span></button>`).join("")}</div>
    <div class="filter-panel">
      <div class="field grow"><label for="f-search">Buscar</label><input id="f-search" type="search" placeholder="Nombre, contacto o necesidad" value="${esc(f.search)}" data-filter="prospectos.search"></div>
      <div class="field"><label for="f-stage">Etapa</label><select id="f-stage" data-filter="prospectos.stage">${options([["abiertos", "Activos (sin ganados/perdidos)"], ...PROSPECT_STAGES], f.stage, "Todas")}</select></div>
      <div class="field"><label for="f-unit">Unidad</label><select id="f-unit" data-filter="prospectos.unit">${options(UNITS, f.unit, "Todas")}</select></div>
      <div class="field"><label for="f-source">Fuente</label><select id="f-source" data-filter="prospectos.source">${options(SOURCES, f.source, "Todas")}</select></div>
    </div>
    ${table}`, "prospectos", "Prospectos");
}

const EVENT_LABELS = {
  alta: "Primer contacto", respuesta: "Respondió", llamada: "Llamada", propuesta: "Propuesta enviada", toque: "Toque",
  seña: "Seña cobrada", perdido: "Perdido", pausa: "Pausado", reactivado: "Reactivado", nota: "Nota",
};

function prospectActions(prospect) {
  const ev = (kind, label, cls = "quiet-button") => `<button class="${cls}" type="button" data-action="prospect-event" data-kind="${kind}" data-id="${esc(prospect.id)}">${esc(label)}</button>`;
  const project = state.data.projects.find((item) => item.prospectId === prospect.id);
  const byStage = {
    contactado: [ev("respuesta", "Respondió", "primary-button")],
    respondio: [ev("llamada", "Llamada hecha", "primary-button")],
    llamada: [ev("propuesta", "Propuesta enviada", "primary-button")],
    propuesta: [`<button class="primary-button" type="button" data-action="new-project" data-id="${esc(prospect.id)}">Cobrar seña → proyecto</button>`, ev("toque", "Toque hecho")],
    pausado: [ev("reactivado", "Reactivar", "primary-button")],
    perdido: [ev("reactivado", "Reactivar")],
    ganado: project ? [`<a class="primary-button" href="#proyectos/${encodeURIComponent(project.id)}">Ver proyecto</a>`] : [],
  };
  const closing = ["contactado", "respondio", "llamada", "propuesta"].includes(prospect.stage) ? [ev("pausa", "Pausar"), ev("perdido", "Perdido", "danger-button")] : [];
  return [...(byStage[prospect.stage] || []), ...closing, ev("nota", "Nota")].join("");
}

function renderProspectDetail(id) {
  const prospect = find("prospects", id);
  if (!prospect) return shell(`<a class="detail-back" href="#prospectos">${icon("back", "button-icon")}Prospectos</a><div class="empty-state"><strong>No existe ese prospecto</strong></div>`, "prospectos", "Prospectos");
  const next = prospectNextAction(prospect);
  const batch = prospect.batchId ? find("batches", prospect.batchId) : null;
  // Más reciente primero; dentro del mismo día, el último registrado arriba.
  const events = prospect.events.map((event, index) => ({ event, index })).sort((a, b) => b.event.date.localeCompare(a.event.date) || b.index - a.index).map(({ event }) => event);
  const info = [
    ["Necesidad", prospect.need], ["Contacto", prospect.contact], ["Fuente", `${prospect.source}${isWarm(prospect) ? " · tibio" : ""}`],
    ["Unidad", prospect.unit], ["Oferta sugerida", prospect.offer || "—"], ["Alta", fmtDate(prospect.createdAt)],
  ];
  return shell(`<a class="detail-back" href="#prospectos">${icon("back", "button-icon")}Prospectos</a>
    <div class="detail-title-row page-heading"><div><p class="eyebrow">Prospecto</p><h1>${esc(prospect.name)}</h1></div>${stageBadge(prospect.stage)}</div>
    <div class="detail-grid">
      <div class="detail-stack">
        <div class="card"><div class="info-grid">${info.map(([label, value]) => `<div class="info-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}
          ${batch ? `<div class="info-item"><span>Lote</span><strong><a class="inline-link" href="#lotes/${encodeURIComponent(batch.id)}">${esc(batch.name)}</a></strong></div>` : ""}</div></div>
        <div class="card"><div class="section-heading"><h2>Historial</h2></div><div class="timeline">${events.map((event) => `<div class="timeline-item"><span class="timeline-node"></span><div><p><strong>${esc(EVENT_LABELS[event.type] || event.type)}</strong>${event.amount ? ` · ${usd(event.amount)}` : ""}${event.note ? ` — ${esc(event.note)}` : ""}</p><p class="meta">${fmtDate(event.date)}${event.reviewDate ? ` · revisar ${fmtDate(event.reviewDate)}` : ""}</p></div></div>`).join("")}</div></div>
      </div>
      <div class="detail-stack">
        <div class="card"><div class="section-heading"><h2>Próxima acción</h2></div>
          ${next ? `<p class="next-title">${esc(next.title)}</p>${dueBadge(next.due)}` : `<p class="small subtle">${prospect.stage === "contactado" ? "Esperando respuesta." : "Sin acción pendiente."}</p>`}
          <div class="button-row stacked">${prospectActions(prospect)}</div>
        </div>
        <button class="link-button danger-link" type="button" data-action="delete-prospect" data-id="${esc(prospect.id)}">Eliminar prospecto</button>
      </div>
    </div>`, "prospectos", prospect.name);
}

// ---------- Lotes ----------

function batchSteps(batch) {
  const steps = [["D0 · envío", batch.sentAt, true], ["D+2 · señal", addDays(batch.sentAt, 2), !!batch.signal], ["D+7 · cierre", addDays(batch.sentAt, 7), !!batch.report]];
  return `<div class="stage-sequence">${steps.map(([label, date, done]) => `<span class="stage-step${done ? " done" : ""}">${done ? "✓ " : ""}${esc(label)} · ${fmtDate(date)}</span>`).join("")}</div>`;
}

function batchCard(batch, full = false) {
  const stats = batchStats(batch, state.data.prospects);
  const next = batchNextAction(batch);
  const button = (action, label, cls = "quiet-button button-small") => `<button class="${cls}" type="button" data-action="${action}" data-id="${esc(batch.id)}">${esc(label)}</button>`;
  return `<article class="card batch-card">
    <div class="list-card-head"><div><h3>${full ? esc(batch.name) : `<a class="inline-link" href="#lotes/${encodeURIComponent(batch.id)}">${esc(batch.name)}</a>`}</h3><p class="tiny">${esc(batch.unit)} · ${esc(batch.vertical)} · ${esc(batch.demo)}</p></div>${batch.report ? badge("Cerrado", "green") : next ? dueBadge(next.due) : ""}</div>
    ${batchSteps(batch)}
    <div class="batch-stats"><span><strong>${stats.size}</strong> contactos</span><span><strong>${stats.responded}</strong> respondieron</span><span><strong>${stats.proposals}</strong> propuestas</span><span><strong>${stats.won}</strong> ganados</span></div>
    ${batch.signal ? `<p class="small"><strong>Señal D+2:</strong> ${esc(batch.signal.note)}</p>` : ""}
    ${batch.report ? `<ul class="report-list"><li><strong>Funcionó:</strong> ${esc(batch.report.worked)}</li><li><strong>No funcionó:</strong> ${esc(batch.report.notWorked)}</li><li><strong>Próxima vez:</strong> ${esc(batch.report.change)}</li></ul>` : ""}
    ${batch.report ? "" : `<div class="button-row">${!batch.signal ? button("batch-signal", "Registrar señal", "primary-button button-small") : button("batch-close", "Cerrar con informe", "primary-button button-small")}${button("new-prospect", "Sumar contacto")}</div>`}
    ${full && stats.members.length ? `<div class="divider"></div><h3>Contactos del lote</h3><div class="stack-list">${stats.members.map((prospect) => `<div class="list-row"><a class="inline-link" href="#prospectos/${encodeURIComponent(prospect.id)}">${esc(prospect.name)}</a>${stageBadge(prospect.stage)}</div>`).join("")}</div>` : ""}
  </article>`;
}

function renderLotes(id) {
  if (id) {
    const batch = find("batches", id);
    return shell(`<a class="detail-back" href="#lotes">${icon("back", "button-icon")}Lotes</a>${batch ? `<div class="page-heading"><div><p class="eyebrow">Lote</p><h1>${esc(batch.name)}</h1></div></div>${batchCard(batch, true)}` : `<div class="empty-state"><strong>No existe ese lote</strong></div>`}`, "lotes", batch?.name || "Lote");
  }
  const open = state.data.batches.filter((batch) => !batch.report).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const closed = state.data.batches.filter((batch) => batch.report).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return shell(`${pageHeading("Prospección demo-first", "Lotes", "D0 envío · D+2 señal · D+7 cierre e informe de 3 líneas. Cuando tres informes coinciden, se vuelven playbook.", primary("new-batch", "Lote"))}
    <section class="batch-grid">${open.length ? open.map((batch) => batchCard(batch)).join("") : `<div class="empty-state"><strong>Sin lotes abiertos</strong><p>Toda demo lleva: su negocio reconocible, su problema cuantificado, la solución funcionando y un extra que no pidió.</p></div>`}</section>
    ${closed.length ? `<section class="section-block"><div class="section-heading"><div><h2>Informes cerrados</h2><p>Buscá patrones: tres informes coincidentes → playbook.</p></div></div><div class="batch-grid">${closed.map((batch) => batchCard(batch)).join("")}</div></section>` : ""}`, "lotes", "Lotes");
}

// ---------- Proyectos ----------

function projectStepper(project) {
  const index = PROJECT_STAGES.findIndex(([id]) => id === project.stage);
  return `<div class="stage-sequence">${PROJECT_STAGES.map(([id, label], i) => `<span class="stage-step${i < index ? " done" : ""}${i === index ? " active" : ""}">${i < index ? "✓ " : ""}${esc(label)}</span>`).join("")}</div>`;
}

const NEXT_STAGE_LABEL = { build: "Pasar a QA", qa: "Pasar a entrega", entrega: "Marcar entregado" };

function projectActions(project) {
  const button = (action, label, cls = "quiet-button") => `<button class="${cls}" type="button" data-action="${action}" data-id="${esc(project.id)}">${esc(label)}</button>`;
  const list = [];
  if (NEXT_STAGE_LABEL[project.stage]) list.push(button("project-advance", NEXT_STAGE_LABEL[project.stage], "primary-button"));
  if (project.stage === "cobro") list.push(button("new-payment", "Registrar cobro de saldo", "primary-button"));
  if (project.stage === "referido") list.push(button("project-referral", "Referido pedido", "primary-button"));
  if (["build", "qa", "entrega"].includes(project.stage)) list.push(button("project-date", "Cambiar fecha de entrega"));
  if (project.stage !== "cerrado" && project.stage !== "cobro") list.push(button("new-payment", "Registrar otro cobro"));
  return list.join("");
}

function renderProyectos(id) {
  if (id) return renderProjectDetail(id);
  const f = state.filters.proyectos;
  const projects = state.data.projects
    .filter((project) => (f.show === "activos" ? project.stage !== "cerrado" : true) && (!f.unit || project.unit === f.unit))
    .sort((a, b) => PROJECT_STAGES.findIndex(([s]) => s === b.stage) - PROJECT_STAGES.findIndex(([s]) => s === a.stage));
  return shell(`${pageHeading("Entrega", "Proyectos", "Un proyecto existe cuando se cobró la seña. Seña → build → QA → entrega → cobro → referido en 48 h.", primary("new-project", "Proyecto con seña"))}
    <div class="filter-panel">
      <div class="field"><label for="p-show">Mostrar</label><select id="p-show" data-filter="proyectos.show">${options([["activos", "Activos"], ["todos", "Todos"]], f.show)}</select></div>
      <div class="field"><label for="p-unit">Unidad</label><select id="p-unit" data-filter="proyectos.unit">${options(UNITS, f.unit, "Todas")}</select></div>
    </div>
    <div class="stack-list">${projects.length ? projects.map((project) => {
      const next = projectNextAction(project, state.data.payments);
      const paid = projectPaid(project, state.data.payments);
      return `<article class="card project-card">
        <div class="list-card-head"><div><h3><a class="inline-link" href="#proyectos/${encodeURIComponent(project.id)}">${esc(project.name)}</a></h3><p class="tiny">${esc(project.client)} · ${esc(project.unit)}</p></div>${next ? dueBadge(next.due) : badge(labelOf(PROJECT_STAGES, project.stage), project.stage === "cerrado" ? "green" : "neutral")}</div>
        ${projectStepper(project)}
        <div class="project-foot"><span>Total <strong>${usd(project.total)}</strong></span><span>Cobrado <strong>${usd(paid)}</strong></span><span>Saldo <strong>${usd(projectBalance(project, state.data.payments))}</strong></span>${next ? `<span class="project-next">${esc(next.title)}</span>` : ""}</div>
      </article>`;
    }).join("") : `<div class="empty-state"><strong>Sin proyectos</strong><p>Se crean al cobrar la seña de un prospecto.</p></div>`}</div>`, "proyectos", "Proyectos");
}

function renderProjectDetail(id) {
  const project = find("projects", id);
  if (!project) return shell(`<a class="detail-back" href="#proyectos">${icon("back", "button-icon")}Proyectos</a><div class="empty-state"><strong>No existe ese proyecto</strong></div>`, "proyectos", "Proyectos");
  const payments = state.data.payments.filter((payment) => payment.projectId === project.id).sort((a, b) => a.date.localeCompare(b.date));
  const next = projectNextAction(project, state.data.payments);
  const prospect = project.prospectId ? find("prospects", project.prospectId) : null;
  const info = [
    ["Cliente", project.client], ["Unidad", project.unit], ["Inicio (seña)", fmtDate(project.startedAt)],
    ["Entrega comprometida", fmtDate(project.deliveryDate)], ["Entregado", fmtDate(project.deliveredAt)], ["Cobrado completo", fmtDate(project.paidAt)],
  ];
  return shell(`<a class="detail-back" href="#proyectos">${icon("back", "button-icon")}Proyectos</a>
    <div class="page-heading"><div><p class="eyebrow">Proyecto</p><h1>${esc(project.name)}</h1></div></div>
    <div class="card">${projectStepper(project)}</div>
    <div class="detail-grid section-block">
      <div class="detail-stack">
        <div class="card"><div class="info-grid">${info.map(([label, value]) => `<div class="info-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}
          ${prospect ? `<div class="info-item"><span>Origen</span><strong><a class="inline-link" href="#prospectos/${encodeURIComponent(prospect.id)}">${esc(prospect.name)}</a> · ${esc(prospect.source)}</strong></div>` : ""}</div>
          ${project.notes ? `<div class="divider"></div><p class="small">${esc(project.notes)}</p>` : ""}</div>
        <div class="card"><div class="section-heading"><h2>Cobros</h2><p class="section-meta">${usd(projectPaid(project, state.data.payments))} de ${usd(project.total)}</p></div>
          ${payments.length ? `<div class="stack-list">${payments.map((payment) => `<div class="list-row"><span>${fmtDate(payment.date)} · ${esc(payment.concept)}${payment.note ? ` · <span class="subtle">${esc(payment.note)}</span>` : ""}</span><strong>${usd(payment.amount)}</strong></div>`).join("")}</div>` : `<p class="tiny">Sin cobros.</p>`}</div>
      </div>
      <div class="detail-stack">
        <div class="card"><div class="section-heading"><h2>Próxima acción</h2></div>
          ${next ? `<p class="next-title">${esc(next.title)}</p>${dueBadge(next.due)}` : `<p class="small subtle">Proyecto cerrado.</p>`}
          <div class="button-row stacked">${projectActions(project)}</div>
        </div>
      </div>
    </div>`, "proyectos", project.name);
}

// ---------- Cobros ----------

function renderCobros() {
  const f = state.filters.cobros;
  const progress = bimesterProgress(state.data);
  const { bimester } = progress;
  const payments = state.data.payments
    .filter((payment) => (f.period === "bimestre" ? inRange(payment.date, bimester.start, bimester.end) : true) && (!f.unit || payment.unit === f.unit))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const currentMrr = mrr(state.data);
  const subs = state.data.subscriptions;

  return shell(`${pageHeading(bimester.label, "Cobros", "USD cobrado es el número que decide. Cada cobro se reparte 40% colchón · 40% reinversión · 10% herramientas · 10% goce. El colchón nunca financia experimentos.", primary("new-payment", "Cobro"))}
    <section class="goal-grid">
      <div class="card">
        <div class="section-heading"><div><h2>Meta por unidad</h2><p>${esc(bimester.label)}</p></div></div>
        <div class="stack-list">${progress.byUnit.map((row) => `<div class="unit-row"><div class="unit-row-head"><strong>${esc(row.unit)}</strong><span>${usd(row.collected)}${row.goal ? ` / ${formatNumber(row.goal)}` : " · excedente sin meta"}</span></div>${row.goal ? progressBar((row.collected / row.goal) * 100) : ""}</div>`).join("")}</div>
      </div>
      <div class="card">
        <div class="section-heading"><div><h2>Reparto</h2><p>Sobre ${usd(total)} ${f.period === "bimestre" ? "del bimestre" : "histórico"}${f.unit ? ` · ${esc(f.unit)}` : ""}</p></div></div>
        <div class="split-list">${split(total).map((row) => `<div class="list-row"><span>${esc(row.label)} <span class="subtle">${Math.round(row.share * 100)}%</span></span><strong>${usd(row.amount)}</strong></div>`).join("")}</div>
      </div>
      <div class="card">
        <div class="section-heading"><div><h2>Abonos · MRR ${usd(currentMrr)}</h2><p>Hito ${usd(state.data.settings.mrrGoal)}/mes</p></div><button class="quiet-button button-small" type="button" data-action="new-subscription">${icon("plus", "button-icon")}Abono</button></div>
        ${progressBar((currentMrr / state.data.settings.mrrGoal) * 100)}
        <div class="stack-list section-gap">${subs.length ? subs.map((sub) => `<div class="list-row${sub.active ? "" : " muted-row"}"><span>${esc(sub.client)} <span class="subtle">· ${esc(sub.unit)} · desde ${fmtDate(sub.since)}</span></span><span class="row-end"><strong>${usd(sub.amount)}/mes</strong><button class="link-button" type="button" data-action="toggle-subscription" data-id="${esc(sub.id)}">${sub.active ? "Dar de baja" : "Reactivar"}</button></span></div>`).join("") : `<p class="tiny">Sin abonos mensuales.</p>`}</div>
      </div>
    </section>
    <section class="section-block">
      <div class="filter-panel">
        <div class="field"><label for="c-period">Período</label><select id="c-period" data-filter="cobros.period">${options([["bimestre", "Bimestre actual"], ["todo", "Todo"]], f.period)}</select></div>
        <div class="field"><label for="c-unit">Unidad</label><select id="c-unit" data-filter="cobros.unit">${options(UNITS, f.unit, "Todas")}</select></div>
        <p class="filter-total">Total <strong>${usd(total)}</strong></p>
      </div>
      ${payments.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Proyecto</th><th>Unidad</th><th class="num">USD</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>${payments.map((payment) => {
        const project = payment.projectId ? find("projects", payment.projectId) : null;
        return `<tr><td>${fmtDate(payment.date)}</td><td>${esc(payment.concept)}${payment.note ? `<span class="table-secondary">${esc(payment.note)}</span>` : ""}</td><td>${project ? `<a class="inline-link" href="#proyectos/${encodeURIComponent(project.id)}">${esc(project.name)}</a>` : "—"}</td><td>${esc(payment.unit)}</td><td class="num"><strong>${formatNumber(payment.amount)}</strong></td><td><button class="link-button danger-link" type="button" data-action="delete-payment" data-id="${esc(payment.id)}">Eliminar</button></td></tr>`;
      }).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>Sin cobros en este período</strong></div>`}
    </section>`, "cobros", "Cobros");
}

// ---------- Modales ----------

const field = (name, label, type = "text", value = "", attrs = "required") =>
  `<div class="field"><label for="m-${name}">${esc(label)}</label><input id="m-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
const area = (name, label, value = "", attrs = "") =>
  `<div class="field"><label for="m-${name}">${esc(label)}</label><textarea id="m-${name}" name="${name}" ${attrs}>${esc(value)}</textarea></div>`;
const select = (name, label, list, selected, empty) =>
  `<div class="field"><label for="m-${name}">${esc(label)}</label><select id="m-${name}" name="${name}">${options(list, selected, empty)}</select></div>`;
const row = (...fields) => `<div class="form-row">${fields.join("")}</div>`;

function modalShell(title, description, body, submit, footerExtra = "") {
  return `<dialog id="interaction-modal" class="modal" aria-labelledby="modal-title"><div class="modal-content">
    <div class="modal-header"><div><h2 id="modal-title">${esc(title)}</h2>${description ? `<p>${description}</p>` : ""}</div></div>
    <form class="modal-form" data-form="${esc(state.modal.type)}">${body}<div class="modal-footer">${footerExtra}<button class="quiet-button" type="button" data-action="close-modal">Cancelar</button>${submit ? `<button class="primary-button" type="submit">${esc(submit)}</button>` : ""}</div></form>
  </div></dialog>`;
}

const EVENT_MODALS = {
  respuesta: ["Respondió", "Regla: llamada el mismo día."],
  llamada: ["Llamada hecha", "Regla: propuesta en ≤24 h."],
  propuesta: ["Propuesta enviada", "Arrancan los toques a +2, +5 y +9 días."],
  toque: ["Toque de seguimiento", ""],
  pausa: ["Pausar", "Toda pausa lleva causa y fecha de revisión."],
  perdido: ["Marcar perdido", ""],
  reactivado: ["Reactivar", ""],
  nota: ["Nota", ""],
};

function modalMarkup() {
  const modal = state.modal;
  const today = todayISO();
  const units = (selected) => select("unit", "Unidad", UNITS, selected || "Agency");

  if (modal.type === "prospect-event") {
    const prospect = find("prospects", modal.id);
    const [title, hint] = EVENT_MODALS[modal.kind];
    let body = field("date", "Fecha", "date", today);
    if (modal.kind === "propuesta") body = row(body, field("amount", "Monto USD", "number", "", 'required min="1" step="1"'));
    if (modal.kind === "pausa") body = row(body, field("reviewDate", "Revisar el", "date", addDays(today, 14)));
    const noteRequired = ["perdido", "pausa", "nota"].includes(modal.kind) ? "required" : "";
    body += area("note", modal.kind === "perdido" ? "Motivo" : modal.kind === "pausa" ? "Causa" : "Nota", "", noteRequired);
    return modalShell(`${title} · ${prospect?.name || ""}`, hint, body, "Guardar");
  }

  if (modal.type === "new-prospect") {
    const batch = modal.id ? find("batches", modal.id) : null;
    const openBatches = state.data.batches.filter((item) => !item.report).map((item) => [item.id, item.name]);
    return modalShell("Nuevo prospecto", "Queda en Contactado. Cuando responda, registralo y arranca la regla.", [
      field("name", "Negocio o persona"),
      row(field("contact", "Contacto / canal", "text", "", 'placeholder="WhatsApp, email, Upwork…"'), select("source", "Fuente", SOURCES, batch ? "Lote" : "Upwork")),
      row(units(batch?.unit), select("batchId", "Lote", openBatches, batch?.id || "", "Sin lote")),
      area("need", "Necesidad", "", 'required placeholder="Problema concreto, si se puede cuantificado"'),
      row(field("offer", "Oferta sugerida", "text", "", 'placeholder="USD 600–900"'), field("createdAt", "Primer contacto", "date", today)),
    ].join(""), "Crear");
  }

  if (modal.type === "new-batch") {
    return modalShell("Nuevo lote", "Lote chico, demo personalizada. D0 es el día de envío.", [
      field("name", "Nombre", "text", "", 'required placeholder="Vertical · demo"'),
      row(field("vertical", "Vertical"), units()),
      field("demo", "Demo base", "text", "", 'required placeholder="Demo base — Agente de atención"'),
      field("sentAt", "D0 · envío", "date", today),
    ].join(""), "Crear lote");
  }

  if (modal.type === "batch-signal") {
    const batch = find("batches", modal.id);
    const stats = batch ? batchStats(batch, state.data.prospects) : { size: 0, responded: 0 };
    return modalShell(`Señal D+2 · ${batch?.name || ""}`, `${stats.responded} de ${stats.size} respondieron hasta ahora.`, area("note", "Qué señal hay", "", "required"), "Guardar");
  }

  if (modal.type === "batch-close") {
    const batch = find("batches", modal.id);
    return modalShell(`Cerrar lote · ${batch?.name || ""}`, "Informe de tres líneas. Tres informes coincidentes se vuelven playbook.", [
      area("worked", "Qué funcionó", "", "required"), area("notWorked", "Qué no", "", "required"), area("change", "Qué cambio la próxima", "", "required"),
    ].join(""), "Cerrar lote");
  }

  if (modal.type === "new-project") {
    const prospect = modal.id ? find("prospects", modal.id) : null;
    const proposal = prospect ? proposalOf(prospect) : null;
    const total = proposal?.amount || "";
    return modalShell(prospect ? `Cobrar seña · ${prospect.name}` : "Proyecto con seña", "Sin seña cobrada no hay proyecto. Se registra el cobro y el prospecto pasa a Ganado.", [
      row(field("name", "Proyecto", "text", prospect ? prospect.name : ""), field("client", "Cliente", "text", prospect?.name || "")),
      row(field("total", "Total acordado USD", "number", total, 'required min="1" step="1"'), field("deposit", "Seña cobrada USD", "number", total ? Math.round(total / 2) : "", 'required min="1" step="1"')),
      row(field("date", "Fecha de cobro", "date", today), field("deliveryDate", "Entrega comprometida", "date", addDays(today, 14))),
      prospect ? "" : units(),
      area("notes", "Alcance acordado", "", 'placeholder="Qué se vendió (y el extra que no pidió)"'),
    ].join(""), "Registrar seña y crear proyecto");
  }

  if (modal.type === "new-payment") {
    const project = modal.id ? find("projects", modal.id) : null;
    const balance = project ? projectBalance(project, state.data.payments) : "";
    const activeProjects = state.data.projects.filter((item) => item.stage !== "cerrado" || item.id === project?.id).map((item) => [item.id, item.name]);
    return modalShell(project ? `Cobro · ${project.name}` : "Registrar cobro", project ? `Saldo pendiente: ${usd(balance)}.` : "Solo lo que entró. Propuestas y promesas no son cobro.", [
      row(field("date", "Fecha", "date", today), field("amount", "Monto USD", "number", balance || "", 'required min="1" step="1"')),
      row(select("concept", "Concepto", PAYMENT_CONCEPTS, project ? (project.stage === "cobro" ? "Saldo" : "Otro") : "Otro"), units(project?.unit)),
      select("projectId", "Proyecto", activeProjects, project?.id || "", "Sin proyecto"),
      field("note", "Nota", "text", "", 'placeholder="Medio de pago, moneda original…"'),
    ].join(""), "Registrar cobro");
  }

  if (modal.type === "new-subscription") {
    return modalShell("Nuevo abono mensual", "Suma al MRR mientras esté activo.", [
      field("client", "Cliente · servicio"),
      row(field("amount", "USD por mes", "number", "", 'required min="1" step="1"'), units()),
      field("since", "Desde", "date", today),
    ].join(""), "Crear abono");
  }

  if (modal.type === "project-referral") {
    const project = find("projects", modal.id);
    return modalShell(`Referido · ${project?.name || ""}`, "Se pide dentro de las 48 h del cobro. Al guardar, el proyecto se cierra.", area("note", "A quién pediste / qué respondió", "", "required"), "Guardar y cerrar proyecto");
  }

  if (modal.type === "project-date") {
    const project = find("projects", modal.id);
    return modalShell(`Fecha de entrega · ${project?.name || ""}`, "", field("deliveryDate", "Entrega comprometida", "date", project?.deliveryDate || today), "Guardar");
  }

  if (modal.type === "data") {
    return modalShell("Datos", "Todo se guarda solo en este navegador. Exportá un respaldo seguido: si se borran los datos del sitio, se pierden.", `
      <div class="data-actions">
        <button class="quiet-button" type="button" data-action="export-data">Exportar respaldo (.json)</button>
        <label class="quiet-button file-button">Importar respaldo<input type="file" accept="application/json,.json" data-action-change="import-data"></label>
        <button class="danger-button" type="button" data-action="reset-data">Volver a los datos de ejemplo</button>
      </div>
      <p class="tiny">No cargues datos sensibles de clientes si este sitio se publica en un hosting público.</p>`, "");
  }
  return "";
}

// ---------- Acciones ----------

function prospectEvent(prospect, kind, values) {
  const event = { id: newId("e"), type: kind, date: values.date, note: values.note || "" };
  if (kind === "propuesta") event.amount = Number(values.amount);
  if (kind === "pausa") Object.assign(event, { reviewDate: values.reviewDate, prevStage: prospect.stage });
  prospect.events.push(event);
  const stageFor = { respuesta: "respondio", llamada: "llamada", propuesta: "propuesta", perdido: "perdido", pausa: "pausado" };
  if (stageFor[kind]) prospect.stage = stageFor[kind];
  if (kind === "reactivado") {
    const pause = [...prospect.events].reverse().find((item) => item.type === "pausa");
    prospect.stage = prospect.stage === "pausado" && pause?.prevStage ? pause.prevStage : "contactado";
  }
}

const SUBMITS = {
  "prospect-event"(values) {
    const prospect = find("prospects", state.modal.id);
    prospectEvent(prospect, state.modal.kind, values);
    return `${EVENT_MODALS[state.modal.kind][0]} registrado.`;
  },
  "new-prospect"(values) {
    const id = newId("p");
    state.data.prospects.push({
      id, name: values.name, contact: values.contact, unit: values.unit, source: values.source, batchId: values.batchId || null,
      need: values.need, offer: values.offer, stage: "contactado", createdAt: values.createdAt,
      events: [{ id: newId("e"), type: "alta", date: values.createdAt, note: "" }],
    });
    return "Prospecto creado.";
  },
  "new-batch"(values) {
    state.data.batches.push({ id: newId("lote"), name: values.name, vertical: values.vertical, unit: values.unit, demo: values.demo, sentAt: values.sentAt, signal: null, report: null });
    return "Lote creado. Sumale los contactos.";
  },
  "batch-signal"(values) {
    find("batches", state.modal.id).signal = { date: todayISO(), note: values.note };
    return "Señal registrada.";
  },
  "batch-close"(values) {
    find("batches", state.modal.id).report = { date: todayISO(), worked: values.worked, notWorked: values.notWorked, change: values.change };
    return "Lote cerrado con informe.";
  },
  "new-project"(values) {
    const prospect = state.modal.id ? find("prospects", state.modal.id) : null;
    const unit = prospect?.unit || values.unit;
    const id = newId("pr");
    state.data.projects.push({
      id, prospectId: prospect?.id || null, name: values.name, client: values.client, unit, stage: "build", total: Number(values.total),
      startedAt: values.date, deliveryDate: values.deliveryDate, deliveredAt: null, paidAt: null, notes: values.notes,
    });
    state.data.payments.push({ id: newId("c"), date: values.date, amount: Number(values.deposit), unit, projectId: id, concept: "Seña", note: "" });
    if (prospect) {
      prospect.stage = "ganado";
      prospect.events.push({ id: newId("e"), type: "seña", date: values.date, note: "", amount: Number(values.deposit) });
    }
    window.location.hash = `#proyectos/${encodeURIComponent(id)}`;
    return "Seña registrada. Proyecto en build.";
  },
  "new-payment"(values) {
    const project = values.projectId ? find("projects", values.projectId) : null;
    state.data.payments.push({ id: newId("c"), date: values.date, amount: Number(values.amount), unit: values.unit, projectId: project?.id || null, concept: values.concept, note: values.note });
    if (project && project.stage === "cobro" && projectBalance(project, state.data.payments) === 0) {
      project.stage = "referido";
      project.paidAt = values.date;
      return "Cobro registrado. Saldo en cero: pedí el referido en 48 h.";
    }
    return "Cobro registrado.";
  },
  "new-subscription"(values) {
    state.data.subscriptions.push({ id: newId("s"), client: values.client, unit: values.unit, amount: Number(values.amount), since: values.since, active: true });
    return "Abono creado.";
  },
  "project-referral"(values) {
    const project = find("projects", state.modal.id);
    project.stage = "cerrado";
    project.referral = { date: todayISO(), note: values.note };
    return "Referido registrado. Proyecto cerrado.";
  },
  "project-date"(values) {
    find("projects", state.modal.id).deliveryDate = values.deliveryDate;
    return "Fecha actualizada.";
  },
};

function advanceProject(project) {
  const today = todayISO();
  if (project.stage === "build") project.stage = "qa";
  else if (project.stage === "qa") project.stage = "entrega";
  else if (project.stage === "entrega") {
    project.deliveredAt = today;
    if (projectBalance(project, state.data.payments) === 0) {
      project.stage = "referido";
      project.paidAt = project.paidAt || today;
    } else project.stage = "cobro";
  }
  return `Proyecto en ${labelOf(PROJECT_STAGES, project.stage)}.`;
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `eclipse-ops-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importData(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    state.data = normalize(JSON.parse(await file.text()));
    commit("Respaldo importado.");
  } catch (error) {
    toast(error.message || "No se pudo leer el archivo.", "warning");
  }
}

function handleAction(button) {
  const { action, id, kind } = button.dataset;
  const modals = ["prospect-event", "new-prospect", "new-batch", "batch-signal", "batch-close", "new-project", "new-payment", "new-subscription", "project-referral", "project-date"];
  if (modals.includes(action)) {
    showModal({ type: action, id, kind });
    return;
  }
  switch (action) {
    case "close-modal": closeModal(); break;
    case "open-data": showModal({ type: "data" }); break;
    case "export-data": exportData(); break;
    case "reset-data":
      if (window.confirm("Se reemplazan tus datos por los de ejemplo. ¿Exportaste un respaldo?")) {
        state.data = reset();
        commit("Datos de ejemplo restaurados.");
      }
      break;
    case "filter-stage":
      state.filters.prospectos.stage = state.filters.prospectos.stage === id ? "abiertos" : id;
      render();
      break;
    case "project-advance": commit(advanceProject(find("projects", id))); break;
    case "toggle-subscription": {
      const sub = find("subscriptions", id);
      sub.active = !sub.active;
      commit(sub.active ? "Abono reactivado." : "Abono dado de baja.");
      break;
    }
    case "delete-payment":
      if (window.confirm("¿Eliminar este cobro?")) {
        state.data.payments = state.data.payments.filter((payment) => payment.id !== id);
        commit("Cobro eliminado.");
      }
      break;
    case "delete-prospect":
      if (window.confirm("¿Eliminar este prospecto y su historial?")) {
        state.data.prospects = state.data.prospects.filter((prospect) => prospect.id !== id);
        window.location.hash = "#prospectos";
        commit("Prospecto eliminado.");
      }
      break;
    default: break;
  }
}

// ---------- Render ----------

const root = document.getElementById("app");

function screenFor({ view, id }) {
  if (view === "prospectos") return id ? renderProspectDetail(id) : renderProspectos();
  if (view === "lotes") return renderLotes(id);
  if (view === "proyectos") return renderProyectos(id);
  if (view === "cobros") return renderCobros();
  return renderHoy();
}

function render() {
  const active = document.activeElement;
  const focusId = active?.id && root.contains(active) ? active.id : null;
  const caret = focusId && typeof active.selectionStart === "number" ? active.selectionStart : null;

  root.innerHTML = screenFor(routeInfo()) + (state.modal ? modalMarkup() : "");

  if (focusId) {
    const again = document.getElementById(focusId);
    again?.focus({ preventScroll: true });
    if (caret !== null && again?.setSelectionRange) again.setSelectionRange(caret, caret);
  }
  const dialog = root.querySelector("#interaction-modal");
  if (dialog) {
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeModal(); });
    dialog.addEventListener("click", (event) => { if (event.target === dialog) closeModal(); });
    dialog.showModal();
  }
}

function showModal(modal) {
  state.modal = modal;
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

function toast(message, tone = "success") {
  const region = root.querySelector(".toast-region");
  if (!region) return;
  const item = document.createElement("div");
  item.className = `toast${tone === "warning" ? " warning" : ""}`;
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), 4200);
}

root.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) handleAction(button);
});

function onFilter(event) {
  const input = event.target.closest("[data-filter]");
  if (!input) return;
  const [group, name] = input.dataset.filter.split(".");
  state.filters[group][name] = input.value;
  render();
}
root.addEventListener("input", onFilter);
root.addEventListener("change", (event) => {
  if (event.target.matches('[data-action-change="import-data"]')) { importData(event.target); return; }
  onFilter(event);
});

root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target.closest("[data-form]");
  if (!form || !form.reportValidity()) return;
  const handler = SUBMITS[form.dataset.form];
  if (!handler) return;
  const values = Object.fromEntries(new FormData(form).entries());
  commit(handler(values));
});

window.addEventListener("hashchange", () => {
  state.modal = null;
  render();
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  document.getElementById("main-content")?.focus({ preventScroll: true });
});

// Si otra pestaña guarda cambios, se recargan para no pisarlos.
window.addEventListener("storage", (event) => {
  if (event.key && event.key.startsWith("eclipse-ops")) {
    state.data = load();
    render();
  }
});

render();
