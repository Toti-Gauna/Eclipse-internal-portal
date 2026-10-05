import { clear, load, newId, normalize, reset, save } from "./data/store.js";
import {
  MAIN_STAGES, OPEN_STAGES, PAYMENT_CONCEPTS, PROSPECT_PATH, PROSPECT_STAGES, SOURCES, STAGES, UNITS,
  addDays, agenda, batchNextAction, batchStats, bimesterProgress, closeout, currentBimester, diffDays, fiveNumbers,
  formatNumber, inRange, isWarm, mrr, nextStage, pipelineValues, projectBalance, projectNextAction, projectPaid,
  proposalOf, prospectNextAction, prospectPosition, prospectStageHint, prospectStageLabel, split, stagePosition, todayISO,
} from "./rules.js";

const NAV = [
  { id: "hoy", label: "Hoy" },
  { id: "prospectos", label: "Prospectos" },
  { id: "lotes", label: "Lotes" },
  { id: "proyectos", label: "Proyectos" },
  { id: "cobros", label: "Cobros" },
];

const state = {
  data: load(),
  filters: {
    prospectos: { search: "", stage: "activos", unit: "" },
    proyectos: { show: "activos", unit: "" },
    cobros: { period: "bimestre", unit: "" },
  },
  tab: "updates",
  modal: null,
};

function commit(message, tone = "success") {
  const saved = save(state.data);
  state.modal = null;
  render();
  if (message) toast(saved ? message : `${message} No se pudo guardar en este navegador: exportá un respaldo.`, saved ? tone : "warning");
}

// ---------- Primitivas visuales (mismas que Eclipse-Web) ----------

const ICONS = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
  check: '<path d="m5 12.5 4.2 4.2L19.5 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  data: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  circle: '<circle cx="12" cy="12" r="7.5"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** El sistema de íconos de la marca: un eclipse en una fase dada (0 = sol, 1 = totalidad). Puerto de PhaseGlyph.tsx. */
function phaseGlyph(phase, size = 18, className = "") {
  const p = Math.min(1, Math.max(0, Number.isFinite(phase) ? phase : 0));
  const c = 12;
  const r = 8;
  const d = (1 - p) * 2 * r;
  const total = p > 0.985;
  let lit = "";
  if (d >= 2 * r - 0.01) {
    lit = `M ${c - r} ${c} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  } else if (!total) {
    const x = c + d / 2;
    const h = Math.sqrt(r * r - (d / 2) ** 2);
    const f = (n) => n.toFixed(3);
    lit = `M ${f(x)} ${f(c - h)} A ${r} ${r} 0 1 0 ${f(x)} ${f(c + h)} A ${r} ${r} 0 0 1 ${f(x)} ${f(c - h)} Z`;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" class="${className}" aria-hidden="true" focusable="false">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>
    ${lit ? `<path d="${lit}" fill="currentColor"/>` : ""}
    ${total ? `<circle cx="${c}" cy="${c}" r="${r + 2}" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="1"/><circle cx="${c + (r + 1) * 0.7071}" cy="${c - (r + 1) * 0.7071}" r="1.6" fill="currentColor"/>` : ""}
  </svg>`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const usd = (value) => `USD ${formatNumber(value)}`;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
function fmtDate(iso, withYear = false) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}
const date = (iso, withYear) => `<span class="pt-date">${fmtDate(iso, withYear)}</span>`;

function dueTag(due) {
  const delta = diffDays(todayISO(), due);
  if (delta < 0) return `<span class="pt-tag pt-tag-late">Vencido hace ${-delta} d</span>`;
  if (delta === 0) return `<span class="pt-tag pt-tag-attn">Hoy</span>`;
  if (delta === 1) return `<span class="pt-tag">Mañana</span>`;
  return `<span class="pt-tag pt-tag-out">${fmtDate(due)} · en ${delta} d</span>`;
}
const isLate = (due) => due && due < todayISO();
const isDue = (due) => due && due <= todayISO();

function crumbs(trail) {
  return `<nav class="pt-crumbs" aria-label="Ubicación"${trail.length > 2 ? ' data-trail="long"' : ""}><ol>${trail.map(([label, href], i) => `<li>${href && i < trail.length - 1 ? `<a class="pt-crumb" href="${href}">${esc(label)}</a>` : `<span class="pt-crumb pt-crumb-current" aria-current="page">${esc(label)}</span>`}</li>`).join("")}</ol></nav>`;
}

const btn = (action, label, cls = "btn-ghost", attrs = "") => `<button class="btn btn-sm ${cls}" type="button" data-action="${action}" ${attrs}>${label}</button>`;
const dataAttrs = (id, kind) => `data-id="${esc(id)}"${kind ? ` data-kind="${esc(kind)}"` : ""}`;
const openLink = (href, label = "Abrir") => `<a class="btn btn-sm btn-ghost btn-open" href="${href}">${esc(label)} ${icon("arrow")}</a>`;

function meter(pct, markPct, tone = "") {
  const mark = markPct === undefined ? "" : `<span class="pt-meter-mark" style="left:${Math.min(100, markPct).toFixed(1)}%" title="Ritmo esperado a hoy"></span>`;
  return `<div class="pt-meter"${tone ? ` data-tone="${tone}"` : ""} aria-hidden="true"><span class="pt-meter-fill" style="width:${Math.min(100, pct).toFixed(1)}%"></span>${mark}</div>`;
}

function options(list, selected, emptyLabel) {
  const items = list.map((item) => (Array.isArray(item) ? item : [item, item]));
  return `${emptyLabel !== undefined ? `<option value="">${esc(emptyLabel)}</option>` : ""}${items.map(([value, label]) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`).join("")}`;
}

const find = (list, id) => state.data[list].find((item) => item.id === id);
const fold = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------- Etapas ----------

function stageMark(project, { layout = "inline", meaning = false, size = 18 } = {}) {
  const position = stagePosition(project);
  const muted = project.stage === "paused" || project.stage === "closed";
  const showPos = position && project.stage !== "support" && project.stage !== "closed";
  const pos = showPos ? `${position} de 5` : project.stage === "support" ? "Después de la entrega" : "";
  return `<span class="pt-stage" data-stage="${project.stage}" data-layout="${layout}"${muted ? " data-muted" : ""}>
    ${phaseGlyph((position || 0) / 5, size, "pt-stage-glyph")}
    <span class="pt-stage-text">${pos ? `<span class="pt-stage-pos">${pos}</span><span class="pt-stage-sep"> · </span>` : ""}<span class="pt-stage-name">${esc(STAGES[project.stage].name)}</span>${meaning ? `<span class="pt-stage-meaning">${esc(STAGES[project.stage].short)}</span>` : ""}</span>
  </span>`;
}

function prospectMark(prospect, { layout = "inline", size = 18 } = {}) {
  const position = prospectPosition(prospect);
  const muted = ["perdido", "pausado"].includes(prospect.stage);
  return `<span class="pt-stage" data-layout="${layout}"${muted ? " data-muted" : ""}>
    ${phaseGlyph(prospect.stage === "perdido" ? 0 : (position || 0) / 5, size, "pt-stage-glyph")}
    <span class="pt-stage-text">${position && !muted ? `<span class="pt-stage-pos">${position} de 5</span><span class="pt-stage-sep"> · </span>` : ""}<span class="pt-stage-name">${esc(prospectStageLabel(prospect.stage))}</span></span>
  </span>`;
}

// ---------- Marco ----------

function routeInfo() {
  const raw = window.location.hash.replace(/^#\/?/, "") || "hoy";
  const [view, id] = raw.split("/");
  return { view: NAV.some((item) => item.id === view) ? view : "hoy", id: id ? decodeURIComponent(id) : "" };
}

function navLinks(active) {
  const due = agenda(state.data).filter((item) => item.delta <= 0).length;
  return `<ul>${NAV.map((item) => `<li><a class="hdr-link" href="#${item.id}"${item.id === active ? ' aria-current="page"' : ""}>${item.label}${item.id === "hoy" && due ? `<span class="hdr-count" aria-label="${due} pendientes">${due}</span>` : ""}</a></li>`).join("")}</ul>`;
}

function shell(inner, active) {
  const notice = state.data.example
    ? `<div class="pt-notice"><div class="container-x pt-notice-row"><span class="badge-demo">Ejemplo</span><p class="pt-notice-text">Estás viendo datos de ejemplo: negocios ficticios para probar el flujo. Se guardan solo en este navegador.</p><button class="pt-link" type="button" data-action="start-clean">Empezar con mis datos</button></div></div>`
    : "";
  return `<header class="pt-header">
      <div class="container-x pt-header-row">
        <a class="pt-brand" href="#hoy" aria-label="Eclipse · Hoy">${phaseGlyph(1, 22)}<span class="pt-brand-name">ECLIPSE</span></a>
        <span class="pt-brand-label">Operación interna</span>
        <nav class="pt-nav pt-nav-desktop" aria-label="Secciones">${navLinks(active)}</nav>
        <div class="pt-tools"><span class="hdr-rule" aria-hidden="true"></span><button class="hdr-link" type="button" data-action="open-data">${icon("data")}Datos</button></div>
      </div>
      <div class="pt-nav-row"><nav class="pt-nav" aria-label="Secciones">${navLinks(active)}</nav></div>
    </header>
    <main id="main-content" class="pt-main" tabindex="-1">
      <div class="pt-light" aria-hidden="true"></div>
      ${notice}
      <div class="container-x pt-page">${inner}</div>
    </main>
    <div class="toast-region" aria-live="polite"></div>`;
}

function emptyState(title, body, action = "") {
  return `<div class="pt-empty">${phaseGlyph(0, 28)}<p class="pt-empty-title">${esc(title)}</p><p class="pt-empty-body">${body}</p>${action}</div>`;
}

// ---------- Hoy ----------

const ENTITY = { prospect: ["prospectos", "Prospecto"], batch: ["lotes", "Lote"], project: ["proyectos", "Proyecto"] };

function agendaButton(item) {
  const a = dataAttrs(item.id);
  switch (`${item.entity}:${item.kind}`) {
    case "prospect:llamada": return btn("prospect-event", "Llamada hecha", "btn-ink", dataAttrs(item.id, "llamada"));
    case "prospect:propuesta": return btn("prospect-event", "Propuesta enviada", "btn-ink", dataAttrs(item.id, "propuesta"));
    case "prospect:toque": return btn("prospect-event", "Toque hecho", "btn-ink", dataAttrs(item.id, "toque"));
    case "batch:señal": return btn("batch-signal", "Registrar señal", "btn-ink", a);
    case "batch:cierre": return btn("batch-close", "Cerrar lote", "btn-ink", a);
    case "project:cobro": return btn("new-payment", "Registrar cobro", "btn-ink", a);
    case "project:referido": return btn("project-referral", "Referido pedido", "btn-ink", a);
    default: return openLink(`#${ENTITY[item.entity][0]}/${encodeURIComponent(item.id)}`);
  }
}

function agendaRows(items) {
  const cols = "minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,.7fr) minmax(0,1fr)";
  return `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Qué hay que hacer</span><span class="label">Dónde</span><span class="label">Vence</span><span class="label" style="text-align:right">Acción</span></div>
  <ul class="pt-rows">${items.map((item) => {
    const [route, type] = ENTITY[item.entity];
    return `<li class="pt-row" style="--cols:${cols}"${item.delta < 0 ? " data-late" : item.delta === 0 ? " data-turn" : ""}>
      <div><span class="pt-row-name">${esc(item.title)}</span></div>
      <div><a class="pt-link" style="min-height:0" href="#${route}/${encodeURIComponent(item.id)}">${esc(item.name)}</a><span class="pt-meta">${type} · ${esc(item.unit)}</span></div>
      <div>${dueTag(item.due)}</div>
      <div class="pt-row-end">${agendaButton(item)}</div>
    </li>`;
  }).join("")}</ul>`;
}

function renderHoy() {
  const today = todayISO();
  const items = agenda(state.data, today);
  const now = items.filter((item) => item.delta <= 0);
  const late = now.filter((item) => item.delta < 0).length;
  const soon = items.filter((item) => item.delta > 0 && item.delta <= 7);
  const progress = bimesterProgress(state.data, today);
  const numbers = fiveNumbers(state.data, addDays(today, -6), today);
  const currentMrr = mrr(state.data);
  const mrrGoal = state.data.settings.mrrGoal;
  const pipeline = pipelineValues(state.data);
  const ahead = progress.collected >= progress.expected;
  const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return shell(`${crumbs([["Operación", "#hoy"], ["Hoy"]])}
    <div class="pt-kicker"><span class="label">${esc(progress.bimester.label)}</span><span class="label">${esc(weekday)}</span></div>
    <h1 class="display pt-hello">Hola, ${esc(state.data.settings.owner)}.</h1>
    <p class="pt-company">${now.length ? `Hoy tenés <strong>${now.length} ${now.length === 1 ? "cosa" : "cosas"}</strong> para hacer${late ? `, <strong>${late} vencida${late === 1 ? "" : "s"}</strong>` : ""}.` : "No hay nada vencido ni para hoy."} El bimestre va <strong>${ahead ? "arriba" : "debajo"} del ritmo</strong>.</p>

    <dl class="pt-overview">
      <div><dt>Cobrado en el bimestre</dt><dd>
        <span class="pt-big" data-key>${usd(progress.collected)} <small>/ ${formatNumber(progress.goal)}</small></span>
        ${meter(progress.pct, (progress.expected / progress.goal) * 100, "accent")}
        <span class="pt-fine">Ritmo a hoy ${usd(progress.expected)} · faltan <strong>${usd(progress.perWeekNeeded)} por semana</strong> · ${progress.daysLeft} días</span>
      </dd></div>
      <div><dt>MRR · hito para soltar TSOFT</dt><dd>
        <span class="pt-big">${usd(currentMrr)} <small>/ ${formatNumber(mrrGoal)}</small></span>
        ${meter((currentMrr / mrrGoal) * 100)}
        <span class="pt-fine">Si el bimestral y el MRR se contradicen, gana el MRR.</span>
      </dd></div>
      <div><dt>En juego (no es ingreso)</dt><dd>
        <span class="pt-overview-strong">Propuesto ${usd(pipeline.proposed)}</span>
        <span class="pt-overview-strong">Por cobrar ${usd(pipeline.receivable)}</span>
        <span class="pt-fine">USD cobrado es el único número que decide.</span>
      </dd></div>
    </dl>

    <section class="pt-list" aria-labelledby="today-title">
      <div class="pt-list-head"><div class="pt-list-title"><h2 id="today-title" class="pt-h2">Qué toca hoy</h2><span class="pt-count">${now.length}</span></div><p class="pt-fine">Vencido y del día, según las reglas de prospecto, lote y proyecto.</p></div>
      ${now.length ? agendaRows(now) : emptyState("Nada pendiente para hoy", "Buen momento para prospectar: la prospección nunca baja del 20% de la capacidad.", `<a class="pt-link" href="#lotes">Armar un lote ${icon("arrow")}</a>`)}
    </section>

    <section class="pt-list" aria-labelledby="soon-title">
      <div class="pt-list-head"><div class="pt-list-title"><h2 id="soon-title" class="pt-h2">Próximos 7 días</h2><span class="pt-count">${soon.length}</span></div></div>
      ${soon.length ? agendaRows(soon) : `<p class="pt-fine">Sin acciones programadas.</p>`}
    </section>

    <section class="pt-list" aria-labelledby="numbers-title">
      <div class="pt-list-head"><div class="pt-list-title"><h2 id="numbers-title" class="pt-h2">Los 5 números</h2></div><p class="pt-fine">Últimos 7 días · ${fmtDate(addDays(today, -6))} – ${fmtDate(today)}</p></div>
      <dl class="pt-overview" style="--cols:5;margin-top:0" data-grid>
        <div><dt>Contactos nuevos</dt><dd><span class="pt-big">${numbers.newContacts}</span><span class="pt-fine">prospectos dados de alta</span></dd></div>
        <div><dt>Conversaciones abiertas</dt><dd><span class="pt-big">${numbers.openConversations}</span><span class="pt-fine">respondió · llamada · propuesta</span></dd></div>
        <div><dt>Propuestas enviadas</dt><dd><span class="pt-big">${numbers.proposalsSent}</span><span class="pt-fine">en los últimos 7 días</span></dd></div>
        <div><dt>USD cobrado</dt><dd><span class="pt-big" data-key>${formatNumber(numbers.collected)}</span><span class="pt-fine">el número que decide</span></dd></div>
        <div><dt>Contactos tibios</dt><dd><span class="pt-big">${numbers.warmPct === null ? "—" : `${numbers.warmPct}%`}</span><span class="pt-fine">referido · comunidad · presencial</span></dd></div>
      </dl>
    </section>`, "hoy");
}

// ---------- Prospectos ----------

const PROSPECT_FILTERS = [["activos", "Activos"], ...PROSPECT_STAGES.map(([id, label]) => [id, label])];

function prospectMatches(prospect, filter) {
  if (filter === "activos") return !["ganado", "perdido"].includes(prospect.stage);
  return prospect.stage === filter;
}

function renderProspectos() {
  const f = state.filters.prospectos;
  const q = fold(f.search.trim());
  const base = state.data.prospects.filter((prospect) => !f.unit || prospect.unit === f.unit);
  const rows = base
    .filter((prospect) => prospectMatches(prospect, f.stage))
    .filter((prospect) => !q || fold(`${prospect.name} ${prospect.contact} ${prospect.need}`).includes(q))
    .map((prospect) => ({ prospect, next: prospectNextAction(prospect) }))
    .sort((a, b) => (a.next?.due || "9999").localeCompare(b.next?.due || "9999"));
  const cols = "minmax(0,1.5fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr) minmax(0,1.4fr) auto";

  return shell(`${crumbs([["Operación", "#hoy"], ["Prospectos"]])}
    <div class="pt-head-row"><div>
      <div class="pt-kicker"><span class="label">Pipeline · ${state.data.prospects.filter((p) => OPEN_STAGES.includes(p.stage)).length} conversaciones abiertas</span></div>
      <h1 class="display pt-title">Del contacto a la <em>seña</em>.</h1>
      <p class="pt-company">Responde → llamada el mismo día → propuesta en ≤24 h → toques a +2, +5 y +9 días. La próxima acción se calcula sola.</p>
    </div><div class="pt-head-actions">${btn("new-prospect", `${icon("plus")} Prospecto`, "btn-primary")}</div></div>

    <div class="pt-filters">
      <div class="pt-seg" role="group" aria-label="Etapa">${PROSPECT_FILTERS.map(([id, label]) => `<button type="button" data-action="filter" data-id="prospectos.stage" data-kind="${id}" aria-pressed="${f.stage === id}">${esc(label)} <span class="pt-count">${base.filter((p) => prospectMatches(p, id)).length}</span></button>`).join("")}</div>
    </div>
    <div class="pt-filters" style="margin-top:12px">
      <label class="sr-only" for="f-search">Buscar prospecto</label><input id="f-search" class="pt-search" type="search" placeholder="Buscar por nombre, contacto o necesidad" value="${esc(f.search)}" data-filter="prospectos.search">
      <label class="sr-only" for="f-unit">Unidad</label><select id="f-unit" class="pt-select" data-filter="prospectos.unit">${options(UNITS, f.unit, "Todas las unidades")}</select>
    </div>

    <section class="pt-list" style="margin-top:28px" aria-label="Prospectos">
      ${rows.length ? `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Prospecto</span><span class="label">Etapa</span><span class="label">Fuente</span><span class="label">Propuesta</span><span class="label">Próxima acción</span><span></span></div>
      <ul class="pt-rows">${rows.map(({ prospect, next }) => {
        const proposal = proposalOf(prospect);
        return `<li class="pt-row" style="--cols:${cols}"${next && isLate(next.due) ? " data-late" : next && isDue(next.due) ? " data-turn" : ""}>
          <div><a class="pt-row-name" href="#prospectos/${encodeURIComponent(prospect.id)}">${esc(prospect.name)}</a><span class="pt-meta">${esc(prospect.contact)} · ${esc(prospect.unit)}</span></div>
          <div>${prospectMark(prospect, { layout: "stack" })}</div>
          <div><span class="pt-cell-label label">Fuente</span>${esc(prospect.source)}${isWarm(prospect) ? `<span class="pt-meta">Tibio</span>` : ""}</div>
          <div><span class="pt-cell-label label">Propuesta</span>${proposal?.amount ? `<span class="readout">${usd(proposal.amount)}</span>` : `<span class="pt-meta" style="margin:0">${esc(prospect.offer || "—")}</span>`}</div>
          <div><span class="pt-cell-label label">Próxima acción</span>${next ? `${esc(next.title)}<div style="margin-top:6px">${dueTag(next.due)}</div>` : `<span class="pt-meta" style="margin:0">${prospect.stage === "contactado" ? "Esperando respuesta" : "—"}</span>`}</div>
          <div class="pt-row-end">${openLink(`#prospectos/${encodeURIComponent(prospect.id)}`)}</div>
        </li>`;
      }).join("")}</ul>` : emptyState("Sin prospectos con estos filtros", "Cambiá el filtro o cargá uno nuevo.", btn("new-prospect", `${icon("plus")} Prospecto`, "btn-ink"))}
    </section>`, "prospectos");
}

const EVENT_LABELS = {
  alta: "Primer contacto", respuesta: "Respondió", llamada: "Llamada", propuesta: "Propuesta enviada", toque: "Toque de seguimiento",
  seña: "Seña cobrada", perdido: "Perdido", pausa: "En pausa", reactivado: "Reactivado", nota: "Nota",
};
const STAGE_EVENTS = { alta: "contactado", respuesta: "respondio", llamada: "llamada", propuesta: "propuesta", seña: "ganado" };

function prospectActions(prospect) {
  const ev = (kind, label, cls = "btn-ghost") => btn("prospect-event", label, cls, dataAttrs(prospect.id, kind));
  const project = state.data.projects.find((item) => item.prospectId === prospect.id);
  const byStage = {
    contactado: [ev("respuesta", "Respondió", "btn-ink")],
    respondio: [ev("llamada", "Llamada hecha", "btn-ink")],
    llamada: [ev("propuesta", "Propuesta enviada", "btn-ink")],
    propuesta: [btn("new-project", "Cobrar seña → proyecto", "btn-primary", dataAttrs(prospect.id)), ev("toque", "Toque hecho")],
    pausado: [ev("reactivado", "Reactivar", "btn-ink")],
    perdido: [ev("reactivado", "Reactivar")],
    ganado: project ? [openLink(`#proyectos/${encodeURIComponent(project.id)}`, "Ver proyecto")] : [],
  };
  const closing = ["contactado", "respondio", "llamada", "propuesta"].includes(prospect.stage) ? [ev("pausa", "Pausar"), ev("perdido", "Perdido", "btn-danger")] : [];
  return [...(byStage[prospect.stage] || []), ...closing].join("");
}

function prospectRail(prospect) {
  const reached = {};
  for (const event of prospect.events) if (STAGE_EVENTS[event.type] && !reached[STAGE_EVENTS[event.type]]) reached[STAGE_EVENTS[event.type]] = event.date;
  const position = prospectPosition(prospect) || 0;
  return `<ol class="pt-rail">${PROSPECT_PATH.map((id, i) => {
    const n = i + 1;
    const status = n < position || (n === position && prospect.stage === "ganado") ? "done" : n === position ? (prospect.stage === "pausado" ? "paused" : prospect.stage === "perdido" ? "pending" : "current") : "pending";
    const text = reached[id] ? `${status === "current" ? "<strong>Ahora</strong> · " : ""}desde ${fmtDate(reached[id])}` : status === "current" ? "<strong>Ahora</strong>" : "Pendiente";
    return `<li class="pt-rail-step" data-status="${status}"><span class="pt-rail-mark">${phaseGlyph(n / 5, 28)}</span><span class="pt-rail-n">${n} de 5</span><span class="pt-rail-name">${esc(prospectStageLabel(id))}</span><span class="pt-rail-status">${text}</span></li>`;
  }).join("")}</ol>`;
}

function renderProspectDetail(id) {
  const prospect = find("prospects", id);
  if (!prospect) return shell(`${crumbs([["Prospectos", "#prospectos"], ["No encontrado"]])}${emptyState("No existe ese prospecto", "Puede haberse eliminado.", `<a class="pt-link" href="#prospectos">${icon("back")} Volver a prospectos</a>`)}`, "prospectos");
  const next = prospectNextAction(prospect);
  const batch = prospect.batchId ? find("batches", prospect.batchId) : null;
  const proposal = proposalOf(prospect);
  const events = prospect.events.map((event, index) => ({ event, index })).sort((a, b) => b.event.date.localeCompare(a.event.date) || b.index - a.index).map(({ event }) => event);
  const position = prospectPosition(prospect);
  const muted = ["perdido", "pausado"].includes(prospect.stage);
  const pause = [...prospect.events].reverse().find((event) => event.type === "pausa");

  return shell(`${crumbs([["Operación", "#hoy"], ["Prospectos", "#prospectos"], [prospect.name]])}
    <p class="pt-detail-meta"><span class="pt-detail-code">${esc(prospect.unit.toUpperCase())}</span><span>${esc(prospect.source)}${isWarm(prospect) ? " · tibio" : ""}</span><span>Alta ${fmtDate(prospect.createdAt)}</span></p>
    <h1 class="display pt-title">${esc(prospect.name)}</h1>
    <p class="pt-company">${esc(prospect.need)}</p>

    <div class="pt-top">
      <section class="pt-current ticks"${muted ? " data-muted" : ""} aria-label="Etapa actual">
        <div class="pt-dial">${phaseGlyph(prospect.stage === "perdido" ? 0 : (position || 0) / 5, 44)}<p class="pt-dial-pos">${position && !muted ? `${position}<span>/5</span>` : "—"}</p></div>
        <div>
          <span class="label">Etapa actual</span>
          <p class="pt-current-name">${esc(prospectStageLabel(prospect.stage))}</p>
          <p class="pt-current-short">${esc(prospectStageHint(prospect.stage))}</p>
          ${prospect.stage === "pausado" && pause ? `<div class="pt-pause"><p class="pt-pause-title">En pausa desde ${fmtDate(pause.date)}</p><p>${esc(pause.note)}</p></div>` : ""}
          <dl class="pt-dl">
            <div><dt>Oferta sugerida</dt><dd>${esc(prospect.offer || "—")}</dd></div>
            <div><dt>Propuesta</dt><dd>${proposal ? `<span class="readout">${usd(proposal.amount)}</span> · ${fmtDate(proposal.date)}` : "Sin enviar"}</dd></div>
            <div><dt>Contacto</dt><dd>${esc(prospect.contact)}</dd></div>
          </dl>
          <div class="pt-actions">${prospectActions(prospect)}</div>
        </div>
      </section>
      <aside class="pt-side">
        <section class="pt-box"${next && isDue(next.due) ? " data-turn" : ""}${next && isLate(next.due) ? " data-late" : ""}>
          <div class="pt-box-head"><span class="label">Próxima acción</span>${next ? dueTag(next.due) : ""}</div>
          <p class="pt-box-title">${next ? esc(next.title) : prospect.stage === "contactado" ? "Esperando respuesta" : "Sin acción pendiente"}</p>
          <p class="pt-fine">${next ? `Vence ${fmtDate(next.due, true)}.` : "Cuando responda, registralo y arranca la regla."}</p>
        </section>
        <section class="pt-box">
          <span class="label">Nota rápida</span>
          <p class="pt-box-text">Objeciones, contexto de la llamada, lo que pidió.</p>
          <div class="pt-actions">${btn("prospect-event", "Agregar nota", "btn-ghost", dataAttrs(prospect.id, "nota"))}</div>
        </section>
      </aside>
    </div>

    <section class="pt-timeline" aria-labelledby="rail-title"><h2 id="rail-title" class="pt-h2">Camino a la seña</h2>${prospectRail(prospect)}<p class="pt-fine">Un prospecto pasa a proyecto solo cuando se cobra la seña.</p></section>

    <div class="pt-bottom">
      <section aria-labelledby="log-title">
        <div class="pt-section-head"><h2 id="log-title" class="pt-h2">Historial</h2><span class="pt-count">${events.length}</span></div>
        <p class="pt-fine">Cada contacto con fecha. Lo último arriba.</p>
        <ol class="pt-log" style="margin-top:24px">${events.map((event) => `<li class="pt-log-item"${STAGE_EVENTS[event.type] ? " data-change" : ""}><span class="pt-log-date pt-date">${fmtDate(event.date, true)}</span><div class="pt-log-body"><p class="pt-log-title">${esc(EVENT_LABELS[event.type] || event.type)}${event.amount ? ` · <span class="readout">${usd(event.amount)}</span>` : ""}</p>${event.note ? `<p class="pt-log-text">${esc(event.note)}</p>` : ""}${event.reviewDate ? `<p class="pt-log-author">Revisar el ${fmtDate(event.reviewDate, true)}</p>` : ""}</div></li>`).join("")}</ol>
      </section>
      <aside class="pt-facts" aria-label="Datos del prospecto">
        <span class="label">Datos del prospecto</span>
        <dl class="pt-dl">
          <div><dt>Contacto</dt><dd>${esc(prospect.contact)}</dd></div>
          <div><dt>Fuente</dt><dd>${esc(prospect.source)}${isWarm(prospect) ? " · tibio" : ""}</dd></div>
          <div><dt>Unidad</dt><dd>${esc(prospect.unit)}</dd></div>
          ${batch ? `<div><dt>Lote</dt><dd><a class="pt-link" style="min-height:0" href="#lotes/${encodeURIComponent(batch.id)}">${esc(batch.name)}</a></dd></div>` : ""}
          <div><dt>Primer contacto</dt><dd class="pt-date">${fmtDate(prospect.createdAt, true)}</dd></div>
        </dl>
        <a class="pt-link" href="#prospectos">${icon("back")} Volver a prospectos</a><br>
        <button class="pt-link pt-link-danger" type="button" data-action="delete-prospect" ${dataAttrs(prospect.id)}>Eliminar prospecto</button>
      </aside>
    </div>`, "prospectos");
}

// ---------- Lotes ----------

function batchRail(batch) {
  const steps = [["D0", "Envío", batch.sentAt, true], ["D+2", "Señal", addDays(batch.sentAt, 2), !!batch.signal], ["D+7", "Cierre e informe", addDays(batch.sentAt, 7), !!batch.report]];
  const currentIndex = steps.findIndex(([, , , done]) => !done);
  return `<ol class="pt-rail">${steps.map(([n, name, day, done], i) => {
    const status = done ? "done" : i === currentIndex ? "current" : "pending";
    return `<li class="pt-rail-step" data-status="${status}"><span class="pt-rail-mark">${phaseGlyph((i + 1) / 3, 24)}</span><span class="pt-rail-n">${n}</span><span class="pt-rail-name">${name}</span><span class="pt-rail-status">${status === "current" ? "<strong>Ahora</strong> · " : ""}${fmtDate(day)}</span></li>`;
  }).join("")}</ol>`;
}

function batchCard(batch, full = false) {
  const stats = batchStats(batch, state.data.prospects);
  const next = batchNextAction(batch);
  const a = dataAttrs(batch.id);
  return `<li class="pt-card"${next && isLate(next.due) ? " data-late" : next && isDue(next.due) ? " data-turn" : ""}>
    <div class="pt-card-top"><span class="label">${esc(batch.unit)} · ${esc(batch.vertical)}</span>${batch.report ? `<span class="pt-tag pt-tag-ok">${icon("check")} Cerrado</span>` : next ? dueTag(next.due) : ""}</div>
    <div><h3 class="pt-card-title">${full ? esc(batch.name) : `<a class="pt-row-name" href="#lotes/${encodeURIComponent(batch.id)}">${esc(batch.name)}</a>`}</h3><p class="pt-meta">${esc(batch.demo)}</p></div>
    ${batchRail(batch)}
    <p class="pt-stats"><span><b>${stats.size}</b> contactos</span><span><b>${stats.responded}</b> respondieron</span><span><b>${stats.proposals}</b> propuestas</span><span><b>${stats.won}</b> señas</span></p>
    ${batch.signal ? `<p class="pt-fine"><strong>Señal D+2:</strong> ${esc(batch.signal.note)}</p>` : ""}
    ${batch.report ? `<ul class="pt-report"><li><b>Funcionó:</b> ${esc(batch.report.worked)}</li><li><b>No funcionó:</b> ${esc(batch.report.notWorked)}</li><li><b>Próxima vez:</b> ${esc(batch.report.change)}</li></ul>` : ""}
    ${batch.report ? "" : `<div class="pt-actions" style="margin-top:0">${!batch.signal ? btn("batch-signal", "Registrar señal", "btn-ink", a) : btn("batch-close", "Cerrar con informe", "btn-ink", a)}${btn("new-prospect", "Sumar contacto", "btn-ghost", a)}</div>`}
  </li>`;
}

function renderLotes(id) {
  if (id) {
    const batch = find("batches", id);
    if (!batch) return shell(`${crumbs([["Lotes", "#lotes"], ["No encontrado"]])}${emptyState("No existe ese lote", "", "")}`, "lotes");
    const stats = batchStats(batch, state.data.prospects);
    return shell(`${crumbs([["Operación", "#hoy"], ["Lotes", "#lotes"], [batch.name]])}
      <div class="pt-kicker"><span class="label">Lote · D0 ${fmtDate(batch.sentAt, true)}</span></div>
      <h1 class="display pt-title">${esc(batch.name)}</h1>
      <ul class="pt-cards" style="margin-top:32px;grid-template-columns:1fr">${batchCard(batch, true)}</ul>
      <section class="pt-list"><div class="pt-list-head"><div class="pt-list-title"><h2 class="pt-h2">Contactos del lote</h2><span class="pt-count">${stats.size}</span></div></div>
        ${stats.members.length ? `<ul class="pt-rows">${stats.members.map((prospect) => `<li class="pt-row" style="--cols:minmax(0,1.5fr) minmax(0,1fr) auto"><div><a class="pt-row-name" href="#prospectos/${encodeURIComponent(prospect.id)}">${esc(prospect.name)}</a><span class="pt-meta">${esc(prospect.contact)}</span></div><div>${prospectMark(prospect)}</div><div class="pt-row-end">${openLink(`#prospectos/${encodeURIComponent(prospect.id)}`)}</div></li>`).join("")}</ul>` : `<p class="pt-fine">Todavía no sumaste contactos.</p>`}
      </section>`, "lotes");
  }
  const open = state.data.batches.filter((batch) => !batch.report).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const closed = state.data.batches.filter((batch) => batch.report).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return shell(`${crumbs([["Operación", "#hoy"], ["Lotes"]])}
    <div class="pt-head-row"><div>
      <div class="pt-kicker"><span class="label">Prospección demo-first</span></div>
      <h1 class="display pt-title">Lotes chicos, <em>demo</em> primero.</h1>
      <p class="pt-company">D0 envío · D+2 señal · D+7 cierre con informe de 3 líneas. Cuando tres informes coinciden, se vuelven playbook. Toda demo lleva: su negocio reconocible, su problema cuantificado, la solución funcionando y un extra que no pidió.</p>
    </div><div class="pt-head-actions">${btn("new-batch", `${icon("plus")} Lote`, "btn-primary")}</div></div>
    <section class="pt-list" aria-labelledby="open-title">
      <div class="pt-list-head"><div class="pt-list-title"><h2 id="open-title" class="pt-h2">Abiertos</h2><span class="pt-count">${open.length}</span></div></div>
      ${open.length ? `<ul class="pt-cards">${open.map((batch) => batchCard(batch)).join("")}</ul>` : emptyState("Sin lotes abiertos", "Elegí una vertical, personalizá la demo base (30–45 min) y mandala a pocos contactos.", btn("new-batch", `${icon("plus")} Lote`, "btn-ink"))}
    </section>
    ${closed.length ? `<section class="pt-list" aria-labelledby="closed-title"><div class="pt-list-head"><div class="pt-list-title"><h2 id="closed-title" class="pt-h2">Informes cerrados</h2><span class="pt-count">${closed.length}</span></div><p class="pt-fine">Buscá patrones: tres informes coincidentes → playbook.</p></div><ul class="pt-cards">${closed.map((batch) => batchCard(batch)).join("")}</ul></section>` : ""}`, "lotes");
}

// ---------- Proyectos ----------

const PROJECT_FILTERS = [
  ["activos", "Activos", (p) => !["closed", "support"].includes(p.stage)],
  ["cliente", "Esperan al cliente", (p) => !!p.clientAction && p.stage !== "closed"],
  ["cierre", "Cobro y referido", (p) => !!p.deliveredAt && !["closed", "support"].includes(p.stage)],
  ["paused", "En pausa", (p) => p.stage === "paused"],
  ["support", "Soporte", (p) => p.stage === "support"],
  ["closed", "Cerrados", (p) => p.stage === "closed"],
  ["todos", "Todos", () => true],
];

function clientTurn(project) {
  if (project.clientAction) {
    return `<div class="pt-turn" style="display:grid;gap:6px;justify-items:start"><span class="pt-tag pt-tag-attn">Espera al cliente</span><span>${esc(project.clientAction.title)}</span><span class="pt-meta" style="margin:0">Pedido el ${fmtDate(project.clientAction.requestedOn)}</span></div>`;
  }
  return `<span class="pt-meta" style="margin:0;display:inline-flex;gap:6px;align-items:center">${icon("check")} Nada pendiente del cliente</span>`;
}

function renderProyectos(id) {
  if (id) return renderProjectDetail(id);
  const f = state.filters.proyectos;
  const base = state.data.projects.filter((project) => !f.unit || project.unit === f.unit);
  const filter = PROJECT_FILTERS.find(([key]) => key === f.show) || PROJECT_FILTERS[0];
  const order = (project) => (project.stage === "paused" ? 2.5 : stagePosition(project) || 9);
  const projects = base.filter(filter[2]).sort((a, b) => order(b) - order(a));
  const active = state.data.projects.filter(PROJECT_FILTERS[0][2]);
  const waiting = active.filter((project) => project.clientAction).length;
  const { receivable } = pipelineValues(state.data);
  const cols = "minmax(0,1.35fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,.8fr) auto";

  return shell(`${crumbs([["Operación", "#hoy"], ["Proyectos"]])}
    <div class="pt-head-row"><div>
      <div class="pt-kicker"><span class="label">Entrega</span></div>
      <h1 class="display pt-title">Proyectos en <em>curso</em>.</h1>
      <p class="pt-company">Un proyecto existe cuando se cobró la seña. Usa las mismas cinco etapas que el cliente ve en su portal; después de la entrega: cobrar saldo y pedir referido en 48 h.</p>
    </div><div class="pt-head-actions">${btn("new-project", `${icon("plus")} Proyecto con seña`, "btn-primary")}</div></div>

    <dl class="pt-overview">
      <div><dt>Activos</dt><dd><span class="pt-big">${active.length}</span><span class="pt-fine">${MAIN_STAGES.map((stage) => `${active.filter((p) => p.stage === stage).length} ${STAGES[stage].name.toLowerCase()}`).filter((t) => !t.startsWith("0")).join(" · ") || "Sin proyectos activos"}</span></dd></div>
      <div><dt>Esperan al cliente</dt><dd><span class="pt-big">${waiting}</span><span class="pt-fine">Aprobaciones, insumos o confirmaciones pedidas.</span></dd></div>
      <div><dt>Por cobrar</dt><dd><span class="pt-big">${usd(receivable)}</span><span class="pt-fine">Saldos de proyectos con seña. No es ingreso todavía.</span></dd></div>
    </dl>

    <div class="pt-filters">
      <div class="pt-seg" role="group" aria-label="Mostrar">${PROJECT_FILTERS.map(([key, label, test]) => `<button type="button" data-action="filter" data-id="proyectos.show" data-kind="${key}" aria-pressed="${f.show === key}">${esc(label)} <span class="pt-count">${base.filter(test).length}</span></button>`).join("")}</div>
      <label class="sr-only" for="p-unit">Unidad</label><select id="p-unit" class="pt-select" data-filter="proyectos.unit">${options(UNITS, f.unit, "Todas las unidades")}</select>
    </div>

    <section class="pt-list" style="margin-top:28px" aria-label="Proyectos">
      ${projects.length ? `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Proyecto</span><span class="label">Etapa actual</span><span class="label">Próximo hito</span><span class="label">Cliente</span><span class="label">Cobrado</span><span></span></div>
      <ul class="pt-rows">${projects.map((project) => {
        const next = projectNextAction(project, state.data.payments);
        const paid = projectPaid(project, state.data.payments);
        const href = `#proyectos/${encodeURIComponent(project.id)}`;
        const milestone = next && ["cobro", "referido", "pausa"].includes(next.kind) ? { title: next.title, due: next.due, owner: "Eclipse" } : project.milestone;
        return `<li class="pt-row" style="--cols:${cols}"${project.clientAction ? " data-turn" : next && isLate(next.due) ? " data-late" : ""}>
          <div><a class="pt-row-name" href="${href}">${esc(project.name)}</a><span class="pt-meta">${esc(project.service || project.client)}</span><span class="pt-code">${esc(project.code || "")}</span></div>
          <div>${stageMark(project, { layout: "stack", meaning: true })}</div>
          <div><span class="pt-cell-label label">Próximo hito</span>${milestone ? `${esc(milestone.title)}<span class="pt-meta">${esc(milestone.owner)} · ${fmtDate(milestone.due, true)}</span><div style="margin-top:6px">${dueTag(milestone.due)}</div>` : `<span class="pt-meta" style="margin:0">—</span>`}</div>
          <div><span class="pt-cell-label label">Cliente</span>${clientTurn(project)}</div>
          <div><span class="pt-cell-label label">Cobrado</span><span class="readout">${formatNumber(paid)}</span><span class="pt-meta">de ${usd(project.total)}</span></div>
          <div class="pt-row-end"><a class="btn btn-sm ${project.clientAction || (next && isDue(next.due)) ? "btn-ink" : "btn-ghost"} btn-open" href="${href}">Ver proyecto ${icon("arrow")}</a></div>
        </li>`;
      }).join("")}</ul>` : emptyState("Sin proyectos en esta vista", "Los proyectos nacen al cobrar la seña de un prospecto.", btn("new-project", `${icon("plus")} Proyecto con seña`, "btn-ink"))}
    </section>`, "proyectos");
}

function projectRail(project) {
  const position = stagePosition(project) || 0;
  const spans = Object.fromEntries((project.history || []).map((span) => [span.stage, span]));
  return `<ol class="pt-rail">${MAIN_STAGES.map((stage, i) => {
    const n = i + 1;
    const span = spans[stage];
    let status = "pending";
    if (n < position || ["support", "closed"].includes(project.stage)) status = "done";
    else if (n === position) status = project.stage === "paused" ? "paused" : project.deliveredAt && stage === "delivery" ? "done" : "current";
    const text = status === "done" ? `Completada${span?.end ? ` ${fmtDate(span.end)}` : ""}` : status === "current" ? `<strong>Ahora</strong>${span ? ` · desde ${fmtDate(span.start)}` : ""}` : status === "paused" ? "<strong>En pausa</strong>" : stage === "delivery" && project.deliveryEstimate ? `Estimada ${fmtDate(project.deliveryEstimate)}` : "Pendiente";
    return `<li class="pt-rail-step" data-status="${status}"><span class="pt-rail-mark">${phaseGlyph(n / 5, 28)}</span><span class="pt-rail-n">${n} de 5</span><span class="pt-rail-name">${esc(STAGES[stage].name)}</span><span class="pt-rail-status">${text}</span></li>`;
  }).join("")}</ol>`;
}

function stageActions(project) {
  const a = dataAttrs(project.id);
  const list = [];
  if (project.stage === "paused") list.push(btn("project-resume", "Retomar", "btn-ink", a));
  else if (MAIN_STAGES.includes(project.stage)) {
    const next = nextStage(project.stage);
    if (next) list.push(btn("project-advance", `Pasar a ${STAGES[next].name}`, "btn-ink", a));
    else if (!project.deliveredAt) list.push(btn("project-delivered", "Entrega hecha", "btn-ink", a));
    if (!project.deliveredAt) list.push(btn("project-pause", "Pausar", "btn-ghost", a));
  }
  return list.join("");
}

function renderProjectDetail(id) {
  const project = find("projects", id);
  if (!project) return shell(`${crumbs([["Proyectos", "#proyectos"], ["No encontrado"]])}${emptyState("No existe ese proyecto", "", `<a class="pt-link" href="#proyectos">${icon("back")} Volver a proyectos</a>`)}`, "proyectos");
  const a = dataAttrs(project.id);
  const position = stagePosition(project);
  const muted = ["paused", "closed"].includes(project.stage);
  const stageInfo = STAGES[project.stage];
  const currentSpan = (project.history || []).at(-1);
  const payments = state.data.payments.filter((payment) => payment.projectId === project.id).sort((x, y) => y.date.localeCompare(x.date));
  const paid = projectPaid(project, state.data.payments);
  const balance = projectBalance(project, state.data.payments);
  const done = closeout(project, state.data.payments);
  const next = projectNextAction(project, state.data.payments);
  const prospect = project.prospectId ? find("prospects", project.prospectId) : null;
  const updates = [...(project.updates || [])].sort((x, y) => y.date.localeCompare(x.date));
  const tab = state.tab;

  const closeoutBox = project.stage === "delivery" || done.delivered
    ? `<section class="pt-box"${next && ["cobro", "referido"].includes(next.kind) ? " data-turn" : ""}>
        <div class="pt-box-head"><span class="label">Cierre interno</span>${next && ["cobro", "referido"].includes(next.kind) ? dueTag(next.due) : ""}</div>
        <p class="pt-box-title">Entrega → cobro → referido</p>
        <ul class="pt-checklist">
          <li data-done="${done.delivered}">${icon(done.delivered ? "check" : "circle")}<span>Entregado y capacitado${project.deliveredAt ? ` · ${fmtDate(project.deliveredAt)}` : ""}</span></li>
          <li data-done="${done.paid}">${icon(done.paid ? "check" : "circle")}<span>Saldo cobrado${done.paid ? ` · ${fmtDate(project.paidAt)}` : balance ? ` · faltan ${usd(balance)}` : ""}</span></li>
          <li data-done="${done.referral}">${icon(done.referral ? "check" : "circle")}<span>Referido pedido en 48 h${project.referral ? ` · ${fmtDate(project.referral.date)}` : ""}</span></li>
        </ul>
        <div class="pt-actions">${done.delivered && !done.paid ? btn("new-payment", "Registrar cobro de saldo", "btn-ink", a) : ""}${done.paid && !done.referral ? btn("project-referral", "Referido pedido", "btn-ink", a) : ""}</div>
      </section>`
    : "";

  return shell(`${crumbs([["Operación", "#hoy"], ["Proyectos", "#proyectos"], [project.name]])}
    <p class="pt-detail-meta"><span class="pt-detail-code">${esc(project.code || "")}</span><span>${esc(project.client)}</span><span>${esc(project.unit)}</span></p>
    <h1 class="display pt-title">${esc(project.name)}</h1>
    <p class="pt-company"><strong>${esc(project.service || "")}</strong>${project.notes ? ` — ${esc(project.notes)}` : ""}</p>

    <div class="pt-top">
      <section class="pt-current ticks"${muted ? " data-muted" : ""} aria-label="Etapa actual">
        <div class="pt-dial">${phaseGlyph((position || 0) / 5, 44)}<p class="pt-dial-pos">${position ? `${position}<span>/5</span>` : "—"}</p></div>
        <div>
          <span class="label">Etapa actual · lo que ve el cliente</span>
          <p class="pt-current-name">${esc(stageInfo.name)}</p>
          <p class="pt-current-short">${position && !["support", "closed"].includes(project.stage) ? `${position} de 5 · ` : ""}${esc(stageInfo.short)}${currentSpan && !["support", "closed", "paused"].includes(project.stage) ? ` · desde ${fmtDate(currentSpan.start, true)}` : ""}</p>
          ${project.stage === "paused" && project.pause ? `<div class="pt-pause"><p class="pt-pause-title">En pausa desde ${fmtDate(project.pause.since)} · ${esc(STAGES[project.pausedIn]?.name || "")}</p><p><strong>Motivo:</strong> ${esc(project.pause.reason)}</p><p><strong>Para seguir:</strong> ${esc(project.pause.next)} · revisar ${fmtDate(project.pause.review)}</p></div>` : ""}
          <dl class="pt-dl">
            <div><dt>Para pasar de etapa</dt><dd>${esc(stageInfo.exit)}</dd></div>
            <div><dt>Responsable</dt><dd>${esc(stageInfo.owner)}</dd></div>
            <div><dt>Entrega estimada</dt><dd>${project.deliveredAt ? `Entregado ${fmtDate(project.deliveredAt)}` : project.deliveryEstimate ? `<span class="pt-date">${fmtDate(project.deliveryEstimate, true)}</span>` : "—"}</dd></div>
          </dl>
          <div class="pt-actions">${stageActions(project)}</div>
        </div>
      </section>
      <aside class="pt-side">
        ${closeoutBox}
        ${project.deliveredAt ? "" : `<section class="pt-box"${project.milestone && isLate(project.milestone.due) ? " data-late" : ""}>
          <div class="pt-box-head"><span class="label">Próximo hito</span>${project.milestone ? dueTag(project.milestone.due) : ""}</div>
          <p class="pt-box-title">${project.milestone ? esc(project.milestone.title) : "Sin hito cargado"}</p>
          <p class="pt-fine">${project.milestone ? `${esc(project.milestone.owner)} · fecha estimada ${fmtDate(project.milestone.due, true)}` : "El cliente ve el próximo hito en su portal: cargalo."}</p>
          <div class="pt-actions">${btn("project-milestone", project.milestone ? "Editar hito" : "Cargar hito", "btn-ghost", a)}</div>
        </section>`}
        ${["closed"].includes(project.stage) ? "" : `<section class="pt-box"${project.clientAction ? " data-turn" : ""}>
          <div class="pt-box-head"><span class="label">Acción del cliente</span>${project.clientAction ? `<span class="pt-tag pt-tag-attn">Le toca al cliente</span>` : ""}</div>
          <p class="pt-box-title">${project.clientAction ? esc(project.clientAction.title) : "Nada pendiente de su lado"}</p>
          <p class="pt-fine">${project.clientAction ? `Pedido el ${fmtDate(project.clientAction.requestedOn, true)}. Si no responde en 2 días, aparece en Hoy.` : "Si necesitás una aprobación, insumo o confirmación, pedila acá."}</p>
          <div class="pt-actions">${project.clientAction ? btn("client-action-done", "Resuelta", "btn-ink", a) : btn("client-action", "Pedir acción", "btn-ghost", a)}</div>
        </section>`}
      </aside>
    </div>

    <section class="pt-timeline" aria-labelledby="rail-title"><h2 id="rail-title" class="pt-h2">Cronograma</h2>${projectRail(project)}
      <p class="pt-fine">Las etapas 1 a 5 son las de todo proyecto. ${project.maintenance ? `Después pasa a Soporte con mantenimiento de ${usd(project.maintenance)}/mes.` : "Sin mantenimiento contratado: se cierra después del cobro y el referido."}</p></section>

    <div class="pt-bottom">
      <section aria-labelledby="track-title">
        <div class="pt-section-head"><h2 id="track-title" class="pt-h2">Seguimiento</h2>${tab === "updates" ? btn("project-update", `${icon("plus")} Actualización`, "btn-ghost", a) : btn("new-payment", `${icon("plus")} Cobro`, "btn-ghost", a)}</div>
        <p class="pt-fine">Las actualizaciones son las que lee el cliente en su portal. Los cobros son internos.</p>
        <div class="pt-tablist" role="tablist" aria-label="Seguimiento">
          <button class="pt-tab" role="tab" type="button" aria-selected="${tab === "updates"}" data-action="tab" data-id="updates">Actualizaciones <span class="pt-tab-count">${updates.length}</span></button>
          <button class="pt-tab" role="tab" type="button" aria-selected="${tab === "payments"}" data-action="tab" data-id="payments">Cobros <span class="pt-tab-count">${payments.length}</span></button>
        </div>
        <div class="pt-tabpanel" role="tabpanel">
          ${tab === "updates"
            ? updates.length ? `<ol class="pt-log">${updates.map((u) => `<li class="pt-log-item"${u.stageChange ? " data-change" : ""}><span class="pt-log-date pt-date">${fmtDate(u.date, true)}</span><div class="pt-log-body">${u.stageChange ? `<p class="pt-log-change">${u.stageChange.from ? `Cambio de etapa <b>${esc(STAGES[u.stageChange.from]?.name || "")}</b> → <b>${esc(STAGES[u.stageChange.to]?.name || "")}</b>` : `Inicio del proyecto <b>${esc(STAGES[u.stageChange.to]?.name || "")}</b>`}</p>` : ""}<p class="pt-log-title">${esc(u.title)}</p>${u.body ? `<p class="pt-log-text">${esc(u.body)}</p>` : ""}<p class="pt-log-author">Eclipse</p></div></li>`).join("")}</ol>` : `<p class="pt-fine">Sin actualizaciones.</p>`
            : payments.length ? `<ul class="pt-ledger">${payments.map((p) => `<li><span class="pt-date">${fmtDate(p.date, true)}</span><span>${esc(p.concept)}${p.note ? ` · <span class="pt-meta" style="display:inline">${esc(p.note)}</span>` : ""}</span><span class="pt-leader"></span><span class="readout">${usd(p.amount)}</span></li>`).join("")}</ul>` : `<p class="pt-fine">Sin cobros.</p>`}
        </div>
      </section>
      <aside class="pt-facts" aria-label="Datos del proyecto">
        <span class="label">Datos del proyecto</span>
        <dl class="pt-dl">
          <div><dt>Código</dt><dd class="pt-date">${esc(project.code || "—")}</dd></div>
          <div><dt>Servicio</dt><dd>${esc(project.service || "—")}</dd></div>
          <div><dt>Inicio</dt><dd><span class="pt-date">${fmtDate(project.startedAt, true)}</span> · seña registrada</dd></div>
          <div><dt>Total acordado</dt><dd class="readout">${usd(project.total)}</dd></div>
          <div><dt>Cobrado · saldo</dt><dd><span class="readout">${usd(paid)}</span> · <span class="readout">${usd(balance)}</span></dd></div>
          <div><dt>Mantenimiento</dt><dd>${project.maintenance ? `${usd(project.maintenance)}/mes` : "Sin mantenimiento contratado"}</dd></div>
          ${prospect ? `<div><dt>Origen</dt><dd><a class="pt-link" style="min-height:0" href="#prospectos/${encodeURIComponent(prospect.id)}">${esc(prospect.name)}</a> · ${esc(prospect.source)}</dd></div>` : ""}
          ${project.referral ? `<div><dt>Referido</dt><dd>${esc(project.referral.note)}</dd></div>` : ""}
        </dl>
        <a class="pt-link" href="#proyectos">${icon("back")} Volver a proyectos</a>
      </aside>
    </div>`, "proyectos");
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
  const mrrGoal = state.data.settings.mrrGoal;
  const cols = "minmax(0,.6fr) minmax(0,.9fr) minmax(0,1.5fr) minmax(0,.6fr) minmax(0,.7fr) auto";

  return shell(`${crumbs([["Operación", "#hoy"], ["Cobros"]])}
    <div class="pt-head-row"><div>
      <div class="pt-kicker"><span class="label">${esc(bimester.label)}</span></div>
      <h1 class="display pt-title">USD <em>cobrado</em>.</h1>
      <p class="pt-company">El único número que decide. Cada cobro se reparte 40% colchón · 40% reinversión · 10% herramientas · 10% goce. El colchón nunca financia experimentos.</p>
    </div><div class="pt-head-actions">${btn("new-payment", `${icon("plus")} Cobro`, "btn-primary")}</div></div>

    <dl class="pt-overview">
      <div><dt>Meta por unidad · ${esc(bimester.id)}</dt><dd>
        ${progress.byUnit.map((row) => `<span><strong>${esc(row.unit)}</strong> <span class="readout">${usd(row.collected)}</span>${row.goal ? ` <span class="pt-fine" style="display:inline">/ ${formatNumber(row.goal)}</span>` : ` <span class="pt-fine" style="display:inline">· excedente sin meta</span>`}</span>${row.goal ? meter((row.collected / row.goal) * 100, undefined, "accent") : ""}`).join("") || `<span class="pt-fine">Sin cobros este bimestre.</span>`}
      </dd></div>
      <div><dt>Reparto · ${usd(total)}</dt><dd>
        <ul class="pt-ledger">${split(total).map((row) => `<li><span>${esc(row.label)}</span><span class="pt-code">${Math.round(row.share * 100)}%</span><span class="pt-leader"></span><span class="readout">${usd(row.amount)}</span></li>`).join("")}</ul>
      </dd></div>
      <div><dt>Abonos · MRR ${usd(currentMrr)} / ${formatNumber(mrrGoal)}</dt><dd>
        ${meter((currentMrr / mrrGoal) * 100)}
        <ul class="pt-ledger">${state.data.subscriptions.map((sub) => `<li${sub.active ? "" : " data-off"}><span>${esc(sub.client)}</span><span class="pt-leader"></span><span class="readout">${usd(sub.amount)}</span><button class="pt-link" style="min-height:32px;font-size:.8125rem" type="button" data-action="toggle-subscription" ${dataAttrs(sub.id)}>${sub.active ? "Baja" : "Reactivar"}</button></li>`).join("") || `<li><span class="pt-fine">Sin abonos mensuales.</span></li>`}</ul>
        ${btn("new-subscription", `${icon("plus")} Abono`, "btn-ghost", 'style="justify-self:start"')}
      </dd></div>
    </dl>

    <div class="pt-filters">
      <div class="pt-seg" role="group" aria-label="Período">${[["bimestre", "Bimestre actual"], ["todo", "Todo"]].map(([key, label]) => `<button type="button" data-action="filter" data-id="cobros.period" data-kind="${key}" aria-pressed="${f.period === key}">${label}</button>`).join("")}</div>
      <label class="sr-only" for="c-unit">Unidad</label><select id="c-unit" class="pt-select" data-filter="cobros.unit">${options(UNITS, f.unit, "Todas las unidades")}</select>
      <span class="pt-fine">Total <strong class="readout">${usd(total)}</strong></span>
    </div>

    <section class="pt-list" style="margin-top:28px" aria-label="Cobros">
      ${payments.length ? `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Fecha</span><span class="label">Concepto</span><span class="label">Proyecto</span><span class="label">Unidad</span><span class="label">USD</span><span></span></div>
      <ul class="pt-rows">${payments.map((payment) => {
        const project = payment.projectId ? find("projects", payment.projectId) : null;
        return `<li class="pt-row" style="--cols:${cols}">
          <div class="pt-date">${fmtDate(payment.date, true)}</div>
          <div>${esc(payment.concept)}${payment.note ? `<span class="pt-meta">${esc(payment.note)}</span>` : ""}</div>
          <div>${project ? `<a class="pt-link" style="min-height:0" href="#proyectos/${encodeURIComponent(project.id)}">${esc(project.name)}</a>` : `<span class="pt-meta" style="margin:0">Sin proyecto</span>`}</div>
          <div>${esc(payment.unit)}</div>
          <div class="readout"><strong>${formatNumber(payment.amount)}</strong></div>
          <div class="pt-row-end"><button class="pt-link pt-link-danger" type="button" data-action="delete-payment" ${dataAttrs(payment.id)}>Eliminar</button></div>
        </li>`;
      }).join("")}</ul>` : emptyState("Sin cobros en este período", "Solo lo que entró. Propuestas y promesas no son cobro.", "")}
    </section>`, "cobros");
}

// ---------- Diálogos ----------

const field = (name, label, type = "text", value = "", attrs = "required") =>
  `<div class="pt-field"><label for="m-${name}">${esc(label)}</label><input class="pt-input" id="m-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
const area = (name, label, value = "", attrs = "") =>
  `<div class="pt-field"><label for="m-${name}">${esc(label)}</label><textarea class="pt-input" id="m-${name}" name="${name}" ${attrs}>${esc(value)}</textarea></div>`;
const select = (name, label, list, selected, empty) =>
  `<div class="pt-field"><label for="m-${name}">${esc(label)}</label><select class="pt-input" id="m-${name}" name="${name}">${options(list, selected, empty)}</select></div>`;
const row = (...fields) => `<div class="pt-form-row">${fields.join("")}</div>`;

function modalShell(kicker, title, text, body, submit) {
  return `<dialog id="interaction-modal" class="modal ticks" aria-labelledby="modal-title"><div class="modal-content">
    <span class="label">${esc(kicker)}</span>
    <h2 id="modal-title" class="modal-title">${esc(title)}</h2>
    ${text ? `<p class="modal-text">${text}</p>` : ""}
    <form class="pt-form" data-form="${esc(state.modal.type)}">${body}
      <div class="modal-footer"><button class="btn btn-sm btn-ghost" type="button" data-action="close-modal">${submit ? "Cancelar" : "Cerrar"}</button>${submit ? `<button class="btn btn-sm btn-ink" type="submit">${esc(submit)}</button>` : ""}</div>
    </form>
  </div></dialog>`;
}

const EVENT_MODALS = {
  respuesta: ["Respondió", "Regla: llamada el mismo día."],
  llamada: ["Llamada hecha", "Regla: propuesta en ≤24 h."],
  propuesta: ["Propuesta enviada", "Arrancan los toques a +2, +5 y +9 días."],
  toque: ["Toque de seguimiento", ""],
  pausa: ["Pausar", "Toda pausa lleva causa y fecha de revisión."],
  perdido: ["Marcar perdido", "Queda en el historial con su motivo."],
  reactivado: ["Reactivar", "Vuelve a la etapa donde estaba."],
  nota: ["Nota", ""],
};

function modalMarkup() {
  const modal = state.modal;
  const today = todayISO();
  const units = (selected) => select("unit", "Unidad", UNITS, selected || "Agency");

  switch (modal.type) {
    case "prospect-event": {
      const prospect = find("prospects", modal.id);
      const [title, hint] = EVENT_MODALS[modal.kind];
      let body = field("date", "Fecha", "date", today);
      if (modal.kind === "propuesta") body = row(body, field("amount", "Monto USD", "number", "", 'required min="1" step="1"'));
      if (modal.kind === "pausa") body = row(body, field("reviewDate", "Revisar el", "date", addDays(today, 14)));
      const noteRequired = ["perdido", "pausa", "nota"].includes(modal.kind) ? "required" : "";
      body += area("note", modal.kind === "perdido" ? "Motivo" : modal.kind === "pausa" ? "Causa" : "Nota", "", noteRequired);
      return modalShell(prospect?.name || "Prospecto", title, hint, body, "Guardar");
    }
    case "new-prospect": {
      const batch = modal.id ? find("batches", modal.id) : null;
      const openBatches = state.data.batches.filter((item) => !item.report).map((item) => [item.id, item.name]);
      return modalShell("Prospectos", "Nuevo prospecto", "Queda en Contactado. Cuando responda, registralo y arranca la regla.", [
        field("name", "Negocio o persona"),
        row(field("contact", "Contacto / canal", "text", "", 'required placeholder="WhatsApp, email, Upwork…"'), select("source", "Fuente", SOURCES, batch ? "Lote" : "Upwork")),
        row(units(batch?.unit), select("batchId", "Lote", openBatches, batch?.id || "", "Sin lote")),
        area("need", "Necesidad", "", 'required placeholder="Problema concreto, si se puede cuantificado"'),
        row(field("offer", "Oferta sugerida", "text", "", 'placeholder="USD 600–900"'), field("createdAt", "Primer contacto", "date", today)),
      ].join(""), "Crear prospecto");
    }
    case "new-batch":
      return modalShell("Lotes", "Nuevo lote", "Lote chico, demo personalizada. D0 es el día de envío.", [
        field("name", "Nombre", "text", "", 'required placeholder="Vertical · demo"'),
        row(field("vertical", "Vertical"), units()),
        field("demo", "Demo base", "text", "", 'required placeholder="Demo base — Agente de atención"'),
        field("sentAt", "D0 · envío", "date", today),
      ].join(""), "Crear lote");
    case "batch-signal": {
      const batch = find("batches", modal.id);
      const stats = batch ? batchStats(batch, state.data.prospects) : { size: 0, responded: 0 };
      return modalShell(batch?.name || "Lote", "Señal D+2", `${stats.responded} de ${stats.size} respondieron hasta ahora.`, area("note", "Qué señal hay", "", "required"), "Guardar señal");
    }
    case "batch-close": {
      const batch = find("batches", modal.id);
      return modalShell(batch?.name || "Lote", "Cerrar el lote", "Informe de tres líneas. Tres informes coincidentes se vuelven playbook.", [
        area("worked", "Qué funcionó", "", "required"), area("notWorked", "Qué no", "", "required"), area("change", "Qué cambio la próxima", "", "required"),
      ].join(""), "Cerrar lote");
    }
    case "new-project": {
      const prospect = modal.id ? find("prospects", modal.id) : null;
      const total = proposalOf(prospect || { events: [] })?.amount || "";
      return modalShell(prospect ? prospect.name : "Proyectos", "Cobrar seña", "Sin seña cobrada no hay proyecto. Se registra el cobro, el proyecto arranca en Preparación (1 de 5) y el prospecto pasa a Seña cobrada.", [
        row(field("name", "Proyecto", "text", prospect ? prospect.name : ""), field("client", "Cliente", "text", prospect?.name || "")),
        field("service", "Servicio", "text", "", 'required placeholder="Agente de atención, web, automatización…"'),
        row(field("total", "Total acordado USD", "number", total, 'required min="1" step="1"'), field("deposit", "Seña cobrada USD", "number", total ? Math.round(total / 2) : "", 'required min="1" step="1"')),
        row(field("date", "Fecha de cobro", "date", today), field("deliveryEstimate", "Entrega estimada", "date", addDays(today, 21))),
        row(field("maintenance", "Mantenimiento USD/mes", "number", "0", 'min="0" step="1"'), prospect ? "" : units()),
        area("notes", "Alcance acordado", "", 'placeholder="Qué se vendió y el extra que no pidió"'),
      ].join(""), "Registrar seña y crear proyecto");
    }
    case "new-payment": {
      const project = modal.id ? find("projects", modal.id) : null;
      const balance = project ? projectBalance(project, state.data.payments) : "";
      const list = state.data.projects.filter((item) => item.stage !== "closed" || item.id === project?.id).map((item) => [item.id, item.name]);
      return modalShell(project ? project.name : "Cobros", "Registrar cobro", project ? `Saldo pendiente: ${usd(balance)}.` : "Solo lo que entró. Propuestas y promesas no son cobro.", [
        row(field("date", "Fecha", "date", today), field("amount", "Monto USD", "number", balance || "", 'required min="1" step="1"')),
        row(select("concept", "Concepto", PAYMENT_CONCEPTS, project?.deliveredAt ? "Saldo" : "Otro"), units(project?.unit)),
        select("projectId", "Proyecto", list, project?.id || "", "Sin proyecto"),
        field("note", "Nota", "text", "", 'placeholder="Medio de pago, moneda original…"'),
      ].join(""), "Registrar cobro");
    }
    case "new-subscription":
      return modalShell("Cobros", "Nuevo abono", "Suma al MRR mientras esté activo.", [
        field("client", "Cliente · servicio"), row(field("amount", "USD por mes", "number", "", 'required min="1" step="1"'), units()), field("since", "Desde", "date", today),
      ].join(""), "Crear abono");
    case "project-advance": {
      const project = find("projects", modal.id);
      const next = nextStage(project.stage);
      return modalShell(project.name, `Pasar a ${STAGES[next].name}`, `${esc(STAGES[project.stage].exit)} El cliente ve el cambio de etapa como actualización en su portal.`, [
        field("date", "Fecha", "date", today),
        field("title", "Título de la actualización", "text", `Arranca ${STAGES[next].name}`),
        area("body", "Qué le contás al cliente", "", 'placeholder="Qué se hizo y qué sigue, en una o dos frases"'),
        next === "clientReview" ? field("action", "Qué tiene que aprobar o decidir el cliente", "text", "", 'required placeholder="Aprobar las respuestas del agente o pedir ajustes"') : "",
        row(field("milestone", "Próximo hito", "text", "", 'placeholder="Opcional"'), field("milestoneDue", "Fecha estimada", "date", addDays(today, 7), "")),
      ].join(""), `Pasar a ${STAGES[next].name}`);
    }
    case "project-delivered": {
      const project = find("projects", modal.id);
      const balance = projectBalance(project, state.data.payments);
      return modalShell(project.name, "Entrega hecha", `Publicado, traspaso y capacitación. ${balance ? `Queda cobrar el saldo de ${usd(balance)} y` : "Ya está cobrado: queda"} pedir el referido en 48 h.`, [
        field("date", "Fecha de entrega", "date", today),
        area("body", "Qué le contás al cliente", "Publicado y capacitación hecha.", ""),
      ].join(""), "Marcar entregado");
    }
    case "project-pause": {
      const project = find("projects", modal.id);
      return modalShell(project.name, "Pausar proyecto", "El cliente ve el motivo y qué hace falta para seguir.", [
        area("reason", "Motivo", "", "required"), field("next", "Qué hace falta para seguir"), field("review", "Revisar el", "date", addDays(today, 7)),
      ].join(""), "Pausar");
    }
    case "project-milestone": {
      const project = find("projects", modal.id);
      return modalShell(project.name, "Próximo hito", "Es una estimación, no un compromiso. El cliente la ve en su portal.", [
        field("title", "Hito", "text", project.milestone?.title || ""),
        row(select("owner", "Responsable", ["Eclipse", "Cliente", "Eclipse y cliente"], project.milestone?.owner || "Eclipse"), field("due", "Fecha estimada", "date", project.milestone?.due || addDays(today, 7))),
        field("deliveryEstimate", "Entrega estimada del proyecto", "date", project.deliveryEstimate || "", ""),
      ].join(""), "Guardar hito");
    }
    case "client-action": {
      const project = find("projects", modal.id);
      return modalShell(project.name, "Pedir acción al cliente", "Aparece en su portal como «Requiere tu acción». Si no responde en 2 días, te lo recuerda Hoy.", field("title", "Qué tiene que hacer", "text", "", 'required placeholder="Aprobar, confirmar o enviar…"'), "Pedir acción");
    }
    case "project-update": {
      const project = find("projects", modal.id);
      return modalShell(project.name, "Publicar actualización", "Cada avance con fecha: es lo que el cliente lee en su portal.", [
        field("date", "Fecha", "date", today), field("title", "Título"), area("body", "Detalle", "", ""),
      ].join(""), "Publicar");
    }
    case "project-referral": {
      const project = find("projects", modal.id);
      return modalShell(project.name, "Referido pedido", `Se pide dentro de las 48 h del cobro. Después el proyecto pasa a ${project.maintenance ? "Soporte" : "Cerrado"}.`, area("note", "A quién pediste / qué respondió", "", "required"), "Guardar");
    }
    case "data":
      return modalShell("Datos", "Tus datos", "Todo se guarda solo en este navegador. Exportá un respaldo seguido: si se borran los datos del sitio, se pierden.", `
        <div class="pt-data-actions">
          <button class="btn btn-sm btn-ink" type="button" data-action="export-data">Exportar respaldo (.json)</button>
          <label class="btn btn-sm btn-ghost pt-file">Importar respaldo<input type="file" accept="application/json,.json" data-action-change="import-data"></label>
          <button class="btn btn-sm btn-ghost" type="button" data-action="reset-data">Cargar datos de ejemplo</button>
          <button class="btn btn-sm btn-danger" type="button" data-action="start-clean">Empezar en limpio</button>
        </div>
        <p class="pt-fine">No cargues datos sensibles de clientes si este sitio se publica en un hosting público.</p>`, "");
    default:
      return "";
  }
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

function moveStage(project, to, day, title, body) {
  const from = project.stage;
  const last = (project.history ||= []).at(-1);
  if (last && !last.end && MAIN_STAGES.includes(to)) last.end = day;
  if (MAIN_STAGES.includes(to) || to === "support") project.history.push({ stage: to, start: day });
  project.stage = to;
  (project.updates ||= []).push({ id: newId("u"), date: day, title, body: body || "", stageChange: { from, to } });
}

function nextCode() {
  const max = state.data.projects.reduce((top, project) => Math.max(top, Number(String(project.code || "").replace(/\D/g, "")) || 0), 0);
  return `ECL-${String(max + 1).padStart(3, "0")}`;
}

/** Después del referido: Soporte si hay mantenimiento (y su abono suma al MRR), si no Cerrado. */
function finishProject(project, day) {
  if (project.maintenance) {
    moveStage(project, "support", day, "Arranca Soporte", "Mantenimiento contratado activo.");
    if (!state.data.subscriptions.some((sub) => sub.projectId === project.id)) {
      state.data.subscriptions.push({ id: newId("s"), client: `${project.client} · mantenimiento`, unit: project.unit, amount: project.maintenance, since: day, active: true, projectId: project.id });
    }
  } else {
    moveStage(project, "closed", day, "Proyecto cerrado", "Entregado, cobrado y con referido pedido.");
  }
}

const SUBMITS = {
  "prospect-event"(values) {
    prospectEvent(find("prospects", state.modal.id), state.modal.kind, values);
    return `${EVENT_MODALS[state.modal.kind][0]}: registrado.`;
  },
  "new-prospect"(values) {
    state.data.prospects.push({
      id: newId("p"), name: values.name, contact: values.contact, unit: values.unit, source: values.source, batchId: values.batchId || null,
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
      id, code: nextCode(), prospectId: prospect?.id || null, name: values.name, client: values.client, unit, service: values.service,
      stage: "preparation", total: Number(values.total), maintenance: Number(values.maintenance) || 0, startedAt: values.date,
      history: [{ stage: "preparation", start: values.date }],
      milestone: { title: "Insumos y plan de trabajo listos", owner: "Eclipse y cliente", due: addDays(values.date, 5) },
      clientAction: null, deliveryEstimate: values.deliveryEstimate, deliveredAt: null, paidAt: null, referral: null, notes: values.notes,
      updates: [{ id: newId("u"), date: values.date, title: "Proyecto confirmado", body: "Seña registrada. Arrancamos con la preparación.", stageChange: { from: null, to: "preparation" } }],
    });
    state.data.payments.push({ id: newId("c"), date: values.date, amount: Number(values.deposit), unit, projectId: id, concept: "Seña", note: "" });
    if (prospect) {
      prospect.stage = "ganado";
      prospect.events.push({ id: newId("e"), type: "seña", date: values.date, note: "", amount: Number(values.deposit) });
    }
    window.location.hash = `#proyectos/${encodeURIComponent(id)}`;
    return "Seña registrada. Proyecto en Preparación (1 de 5).";
  },
  "new-payment"(values) {
    const project = values.projectId ? find("projects", values.projectId) : null;
    state.data.payments.push({ id: newId("c"), date: values.date, amount: Number(values.amount), unit: values.unit, projectId: project?.id || null, concept: values.concept, note: values.note });
    if (project?.deliveredAt && !project.paidAt && projectBalance(project, state.data.payments) === 0) {
      project.paidAt = values.date;
      return "Saldo cobrado. Pedí el referido en 48 h.";
    }
    return "Cobro registrado.";
  },
  "new-subscription"(values) {
    state.data.subscriptions.push({ id: newId("s"), client: values.client, unit: values.unit, amount: Number(values.amount), since: values.since, active: true, projectId: null });
    return "Abono creado.";
  },
  "project-advance"(values) {
    const project = find("projects", state.modal.id);
    const next = nextStage(project.stage);
    moveStage(project, next, values.date, values.title, values.body);
    project.clientAction = next === "clientReview" ? { title: values.action, requestedOn: values.date } : null;
    project.milestone = values.milestone ? { title: values.milestone, owner: next === "clientReview" ? "Cliente" : "Eclipse", due: values.milestoneDue || addDays(values.date, 7) } : null;
    return `Proyecto en ${STAGES[next].name}.`;
  },
  "project-delivered"(values) {
    const project = find("projects", state.modal.id);
    project.deliveredAt = values.date;
    project.milestone = null;
    project.clientAction = null;
    const last = (project.history ||= []).at(-1);
    if (last && !last.end) last.end = values.date;
    (project.updates ||= []).push({ id: newId("u"), date: values.date, title: "Entrega hecha", body: values.body });
    if (projectBalance(project, state.data.payments) === 0) project.paidAt = values.date;
    return project.paidAt ? "Entregado y cobrado. Pedí el referido en 48 h." : "Entregado. Ahora: cobrar el saldo.";
  },
  "project-pause"(values) {
    const project = find("projects", state.modal.id);
    project.pausedIn = project.stage;
    project.pause = { since: todayISO(), reason: values.reason, next: values.next, review: values.review };
    moveStage(project, "paused", todayISO(), "Proyecto en pausa", values.reason);
    return "Proyecto en pausa.";
  },
  "project-milestone"(values) {
    const project = find("projects", state.modal.id);
    project.milestone = { title: values.title, owner: values.owner, due: values.due };
    if (values.deliveryEstimate) project.deliveryEstimate = values.deliveryEstimate;
    return "Hito guardado.";
  },
  "client-action"(values) {
    find("projects", state.modal.id).clientAction = { title: values.title, requestedOn: todayISO() };
    return "Acción pedida al cliente.";
  },
  "project-update"(values) {
    (find("projects", state.modal.id).updates ||= []).push({ id: newId("u"), date: values.date, title: values.title, body: values.body });
    return "Actualización publicada.";
  },
  "project-referral"(values) {
    const project = find("projects", state.modal.id);
    project.referral = { date: todayISO(), note: values.note };
    finishProject(project, todayISO());
    return project.stage === "support" ? "Referido pedido. El proyecto pasa a Soporte." : "Referido pedido. Proyecto cerrado.";
  },
};

function resumeProject(project) {
  const to = project.pausedIn || "build";
  const day = todayISO();
  const from = project.stage;
  project.stage = to;
  // La pausa no cierra el tramo de la etapa: se retoma el mismo.
  const last = (project.history ||= []).at(-1);
  if (!last || last.stage !== to || last.end) project.history.push({ stage: to, start: day });
  (project.updates ||= []).push({ id: newId("u"), date: day, title: `Se retoma ${STAGES[to].name}`, body: project.pause?.next ? `Resuelto: ${project.pause.next}.` : "", stageChange: { from, to } });
  project.pause = null;
  project.pausedIn = null;
  return `Proyecto retomado en ${STAGES[to].name}.`;
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

const MODALS = new Set(["prospect-event", "new-prospect", "new-batch", "batch-signal", "batch-close", "new-project", "new-payment", "new-subscription",
  "project-advance", "project-delivered", "project-pause", "project-milestone", "client-action", "project-update", "project-referral"]);

function handleAction(button) {
  const { action, id, kind } = button.dataset;
  if (MODALS.has(action)) {
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
        commit("Datos de ejemplo cargados.");
      }
      break;
    case "start-clean":
      if (window.confirm("Se borran los datos actuales de este navegador y empezás en limpio. ¿Seguro?")) {
        state.data = clear();
        window.location.hash = "#hoy";
        commit("Listo: empezás en limpio.");
      }
      break;
    case "filter": {
      const [group, name] = id.split(".");
      state.filters[group][name] = kind;
      render();
      break;
    }
    case "tab": state.tab = id; render(); break;
    case "project-resume": commit(resumeProject(find("projects", id))); break;
    case "client-action-done": {
      const project = find("projects", id);
      (project.updates ||= []).push({ id: newId("u"), date: todayISO(), title: `Resuelto: ${project.clientAction.title}`, body: "" });
      project.clientAction = null;
      commit("Acción del cliente resuelta.");
      break;
    }
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
  if (event.target.matches("select[data-filter]")) onFilter(event);
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
  state.tab = "updates";
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
