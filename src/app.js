import { loadConfig } from "./config.js";
import { clear, load, newId, normalize, reset, save } from "./data/store.js";
import { emptyData } from "./data/seed.js";
import { auditStamp, chronological, dailyAgenda, goalProgress, localTime, salesPlan, toggleGoalStep } from "./planner.js";
import { GENERATORS, generatorConfig, renderGenerator } from "./generators.js";
import { workspaceUI } from "./workspace-ui.js";
import {
  MAIN_STAGES, OPEN_STAGES, PAYMENT_CONCEPTS, PROSPECT_PATH, PROSPECT_STAGES, SOURCES, STAGES, UNITS,
  addDays, agenda, batchNextAction, batchStats, bimesterProgress, closeout, currentBimester, diffDays, fiveNumbers,
  formatNumber, inRange, isWarm, mrr, nextStage, pipelineValues, projectBalance, projectNextAction, projectPaid,
  proposalOf, prospectNextAction, prospectPosition, prospectStageHint, prospectStageLabel, split, stagePosition, todayISO,
} from "./rules.js";

const NAV = [
  { id: "hoy", label: "Hoy" },
  { id: "calendario", label: "Calendario" },
  { id: "prospectos", label: "Prospectos" },
  { id: "lotes", label: "Lotes" },
  { id: "proyectos", label: "Proyectos" },
  { id: "cobros", label: "Cobros" },
];

// Modo: "demo" (datos de este navegador) | "live" (servidor, sin caer nunca a localStorage) | "invalid" (public-config.json roto).
const config = await loadConfig();
const state = {
  data: config.mode === "demo" ? load() : emptyData(),
  filters: {
    prospectos: { search: "", stage: "activos", unit: "" },
    proyectos: { show: "activos", unit: "" },
    cobros: { period: "bimestre", unit: "" },
  },
  tab: "updates",
  modal: null,
  wizard: null,
  pages: {},
  goalFilter: "hoy",
  calendar: { month: todayISO().slice(0, 7), date: todayISO(), filter: "todo", eventId: null },
  calculator: { gap: "", ticket: 1500, conversion: 25, hours: 20, amount: 1000 },
};
state.calculator.gap = Math.max(0, bimesterProgress(state.data).goal - bimesterProgress(state.data).collected);
/** Controlador del modo live (null en demo). Se crea más abajo, cuando las primitivas visuales ya existen. */
let live = null;

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
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  moon: '<path d="M20.5 13.3A8.7 8.7 0 0 1 10.7 3.5a8.7 8.7 0 1 0 9.8 9.8Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
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
const dateTime = (entry) => `${fmtDate(entry.date, true)}<small class="log-time">${entry.time ? esc(entry.time) : "Hora no registrada"}</small>`;

const PAGE_SIZE = 5;
function pageSlice(items, group) {
  const total = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  state.pages[group] = Math.max(1, Math.min(total, state.pages[group] || 1));
  return items.slice((state.pages[group] - 1) * PAGE_SIZE, state.pages[group] * PAGE_SIZE);
}
function pagination(items, group) {
  const total = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(total, state.pages[group] || 1));
  return `<nav class="pagination" aria-label="Páginas de ${esc(group)}"><span class="pt-fine">${items.length ? (page - 1) * PAGE_SIZE + 1 : 0}–${Math.min(items.length, page * PAGE_SIZE)} de ${items.length}</span><div>${btn("page", icon("back"), "btn-ghost icon-button", `data-id="${group}" data-kind="${page - 1}" aria-label="Página anterior" ${page === 1 ? "disabled" : ""}`)}<span class="readout">${page} / ${total}</span>${btn("page", icon("arrow"), "btn-ghost icon-button", `data-id="${group}" data-kind="${page + 1}" aria-label="Página siguiente" ${page === total ? "disabled" : ""}`)}</div></nav>`;
}

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
  const known = live ? [...live.views(), "crear"].includes(view) : NAV.some((item) => item.id === view) || ["metas", "herramientas", "actividad", "crear"].includes(view);
  return { view: known ? view : "hoy", id: id ? decodeURIComponent(id) : "" };
}

function liveNavLinks(active) {
  return `<ul>${live.navItems("main").map((item) => `<li><a class="hdr-link" href="#${item.id}"${item.id === active ? ' aria-current="page"' : ""}${item.status === "pending" ? ' data-pending title="Todavía no está conectada al servidor"' : ""}${!item.allowed ? ' data-denied title="Tu cuenta no tiene permiso para esta sección"' : ""}>${item.label}${item.badge ? `<span class="hdr-count" aria-label="${esc(item.badge.label)}">${item.badge.count}</span>` : ""}</a></li>`).join("")}</ul>`;
}

function navLinks(active) {
  if (live) return liveNavLinks(active);
  const due = dailyAgenda(state.data).filter((item) => item.delta <= 0).length;
  return `<ul>${NAV.map((item) => `<li><a class="hdr-link" href="#${item.id}"${item.id === active ? ' aria-current="page"' : ""}>${item.label}${item.id === "hoy" && due ? `<span class="hdr-count" aria-label="${due} pendientes">${due}</span>` : ""}</a></li>`).join("")}</ul>`;
}

function modeBar() {
  if (live) {
    return `<div class="pt-notice pt-mode" data-mode="live"><div class="container-x pt-notice-row"><span class="badge-live">En vivo</span><p class="pt-notice-text">Datos del servidor <span class="readout">${esc(new URL(config.apiBaseUrl).host)}</span> · sesión de <span class="readout">${esc(live.admin?.email || "")}</span></p><button class="pt-link" type="button" data-action="live-logout">Cerrar sesión</button></div></div>`;
  }
  return `<div class="pt-notice pt-mode" data-mode="demo"><div class="container-x pt-notice-row"><span class="badge-demo pt-mode-badge">Modo demostración · datos de este navegador</span></div></div>`;
}

function workspaceMenu() {
  if (live) {
    const items = live.navItems("menu");
    return `<nav aria-label="Mi operación">${items.map((item) => `<a href="#${item.id}"${item.status === "pending" ? " data-pending" : ""}>${esc(item.label)}<span>${esc(item.status === "pending" ? "Sin conectar todavía" : item.hint)}</span></a>`).join("")}<button type="button" data-action="open-data">Datos<span>Qué se guarda y dónde</span></button><button type="button" data-action="live-logout">Cerrar sesión<span>${esc(live.admin?.email || "")}</span></button></nav>`;
  }
  return `<nav aria-label="Mi operación"><a href="#metas">Mi plan<span>Metas y próximos pasos</span></a><a href="#herramientas">Herramientas<span>Ventas, capacidad y cobros</span></a><a href="#actividad">Bitácora<span>Actividad y auditoría</span></a><button type="button" data-action="open-data">Datos y respaldos<span>Exportar o importar</span></button></nav>`;
}

function shell(inner, active) {
  const dark = document.documentElement.dataset.theme !== "light";
  const notice = state.data.example && !live
    ? `<div class="pt-notice"><div class="container-x pt-notice-row"><span class="badge-demo">Ejemplo</span><p class="pt-notice-text">Estás viendo datos de ejemplo: negocios ficticios para probar el flujo. Se guardan solo en este navegador.</p><button class="pt-link" type="button" data-action="start-clean">Empezar con mis datos</button></div></div>`
    : "";
  const footerLinks = live ? live.navItems("menu").map((item) => `<a href="#${item.id}">${esc(item.label)}</a>`).join("") : '<a href="#metas">Mi plan</a><a href="#herramientas">Herramientas</a><a href="#actividad">Bitácora</a>';
  return `<header class="pt-header">
      <div class="container-x pt-header-row">
        <a class="pt-brand" href="#hoy" aria-label="Eclipse · Hoy">${phaseGlyph(1, 22)}<span class="pt-brand-name">ECLIPSE</span></a>
        <span class="pt-brand-label">Operación interna</span>
        <nav class="pt-nav pt-nav-desktop" aria-label="Secciones">${navLinks(active)}</nav>
        <div class="pt-tools"><span class="hdr-rule" aria-hidden="true"></span>${live ? "" : `<button class="hdr-plan" type="button" data-action="new-goal">${icon("plus")}<span>Planificar</span></button>`}<button class="hdr-link theme-toggle" type="button" data-action="theme-toggle" aria-label="${dark ? "Activar modo claro" : "Activar modo oscuro"}" title="${dark ? "Modo claro" : "Modo oscuro"}">${icon(dark ? "sun" : "moon")}</button><details class="workspace-menu"><summary class="hdr-link" aria-label="Herramientas de operación" title="Herramientas de operación">${icon("more")}</summary>${workspaceMenu()}</details></div>
      </div>
      <div class="pt-nav-row"><nav class="pt-nav" aria-label="Secciones">${navLinks(active)}</nav></div>
    </header>
    <main id="main-content" class="pt-main" tabindex="-1">
      <div class="pt-light" aria-hidden="true"></div>
      ${modeBar()}
      ${notice}
      <div class="container-x pt-page">${inner}</div>
    </main>
    <footer class="workspace-footer container-x"><span class="label">Eclipse · Tu operación en órbita</span><nav aria-label="Herramientas de operación">${footerLinks}</nav></footer>
    <div class="toast-region" aria-live="polite"></div>`;
}

function emptyState(title, body, action = "") {
  return `<div class="pt-empty">${phaseGlyph(0, 28)}<p class="pt-empty-title">${esc(title)}</p><p class="pt-empty-body">${body}</p>${action}</div>`;
}

// ---------- Hoy ----------

const ENTITY = { prospect: ["prospectos", "Prospecto"], batch: ["lotes", "Lote"], project: ["proyectos", "Proyecto"], goal: ["metas", "Meta"], event: ["calendario", "Evento"] };

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
    case "goal:meta": return openLink(`#metas/${encodeURIComponent(item.id)}`, "Ver pasos");
    case "event:evento": return openLink(`#calendario/${encodeURIComponent(item.id)}`, "Ver evento");
    default: return openLink(`#${ENTITY[item.entity][0]}/${encodeURIComponent(item.id)}`);
  }
}

function agendaRows(items) {
  const cols = "minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,.7fr) minmax(0,1fr)";
  return `<div class="pt-rows-head agenda-rows-head" style="--cols:${cols}"><span class="label">Qué hay que hacer</span><span class="label">Dónde</span><span class="label">Vence</span><span class="label" style="text-align:right">Acción</span></div>
  <ul class="pt-rows agenda-rows">${items.map((item) => {
    const [route, type] = ENTITY[item.entity];
    return `<li class="pt-row" style="--cols:${cols}"${item.delta < 0 ? " data-late" : item.delta === 0 ? " data-turn" : ""}>
      <div><span class="pt-row-name">${esc(item.title)}</span></div>
      <div><a class="pt-link" style="min-height:0" href="#${route}/${encodeURIComponent(item.id)}">${esc(item.name)}</a><span class="pt-meta">${type} · ${esc(item.unit)}</span></div>
      <div>${dueTag(item.due)}${item.time ? `<span class="pt-meta readout">${esc(item.time)}</span>` : ""}</div>
      <div class="pt-row-end">${agendaButton(item)}</div>
    </li>`;
  }).join("")}</ul>`;
}

function renderHoy() {
  const today = todayISO();
  const items = dailyAgenda(state.data, today);
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
    ${workspace.focusBand()}

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
      <div class="pt-list-head"><div class="pt-list-title"><h2 id="today-title" class="pt-h2">Qué toca hoy</h2><span class="pt-count">${now.length}</span></div><div class="pt-head-actions"><a class="pt-link" href="#metas">Mi plan ${icon("arrow")}</a>${btn("new-goal", `${icon("plus")} Meta`, "btn-ghost")}</div></div>
      <p class="pt-fine">Tus metas, eventos y acciones pendientes. Cinco por página para mantener el foco.</p>
      ${now.length ? `${agendaRows(pageSlice(now, "today"))}${pagination(now, "today")}` : emptyState("Nada pendiente para hoy", "Buen momento para prospectar: la prospección nunca baja del 20% de la capacidad.", `<a class="pt-link" href="#lotes">Armar un lote ${icon("arrow")}</a>`)}
    </section>

    <section class="pt-list" aria-labelledby="soon-title">
      <div class="pt-list-head"><div class="pt-list-title"><h2 id="soon-title" class="pt-h2">Próximos 7 días</h2><span class="pt-count">${soon.length}</span></div></div>
      ${soon.length ? `${agendaRows(pageSlice(soon, "soon"))}${pagination(soon, "soon")}` : `<p class="pt-fine">Sin acciones programadas.</p>`}
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
  const events = chronological(prospect.events);
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
        <p class="pt-fine">Del primer contacto al más reciente, con fecha y hora.</p>
        <ol class="pt-log" style="margin-top:24px">${events.map((event) => `<li class="pt-log-item"${STAGE_EVENTS[event.type] ? " data-change" : ""}><span class="pt-log-date pt-date">${dateTime(event)}</span><div class="pt-log-body"><p class="pt-log-title">${esc(EVENT_LABELS[event.type] || event.type)}${event.amount ? ` · <span class="readout">${usd(event.amount)}</span>` : ""}</p>${event.note ? `<p class="pt-log-text">${esc(event.note)}</p>` : ""}${event.reviewDate ? `<p class="pt-log-author">Revisar el ${fmtDate(event.reviewDate, true)}</p>` : ""}</div></li>`).join("")}</ol>
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
  const steps = [["D0", "Envío", batch.sentAt, true], [`D+${batch.signalDays || 2}`, "Señal", addDays(batch.sentAt, batch.signalDays || 2), !!batch.signal], [`D+${batch.closeDays || 7}`, "Cierre e informe", addDays(batch.sentAt, batch.closeDays || 7), !!batch.report]];
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
    ${batch.hypothesis ? `<p class="pt-fine"><strong>Hipótesis:</strong> ${esc(batch.hypothesis)}</p>` : ""}
    ${batchRail(batch)}
    <p class="pt-stats"><span><b>${stats.size}${batch.target ? `/${batch.target}` : ""}</b> contactos</span><span><b>${stats.responded}</b> respondieron</span><span><b>${stats.proposals}</b> propuestas</span><span><b>${stats.won}</b> señas</span></p>
    ${batch.signal ? `<p class="pt-fine"><strong>Señal D+${batch.signalDays || 2}:</strong> ${esc(batch.signal.note)}<span class="log-time">${dateTime(batch.signal)}</span></p>` : ""}
    ${batch.report ? `<ul class="pt-report"><li><b>Funcionó:</b> ${esc(batch.report.worked)}</li><li><b>No funcionó:</b> ${esc(batch.report.notWorked)}</li><li><b>Próxima vez:</b> ${esc(batch.report.change)}</li><li class="pt-fine">${dateTime(batch.report)}</li></ul>` : ""}
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
  const payments = chronological(state.data.payments.filter((payment) => payment.projectId === project.id));
  const paid = projectPaid(project, state.data.payments);
  const balance = projectBalance(project, state.data.payments);
  const done = closeout(project, state.data.payments);
  const next = projectNextAction(project, state.data.payments);
  const prospect = project.prospectId ? find("prospects", project.prospectId) : null;
  const updates = chronological(project.updates || []);
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
          <p class="pt-fine">${project.clientAction ? `Pedido el ${fmtDate(project.clientAction.requestedOn, true)}${project.clientAction.time ? ` · ${esc(project.clientAction.time)}` : ""}. Si no responde en 2 días, aparece en Hoy.` : "Si necesitás una aprobación, insumo o confirmación, pedila acá."}</p>
          <div class="pt-actions">${project.clientAction ? btn("client-action-done", "Resuelta", "btn-ink", a) : btn("client-action", "Pedir acción", "btn-ghost", a)}</div>
        </section>`}
      </aside>
    </div>

    <section class="pt-timeline" aria-labelledby="rail-title"><h2 id="rail-title" class="pt-h2">Cronograma</h2>${projectRail(project)}
      <p class="pt-fine">Las etapas 1 a 5 son las de todo proyecto. ${project.maintenance ? `Después pasa a Soporte con mantenimiento de ${usd(project.maintenance)}/mes.` : "Sin mantenimiento contratado: se cierra después del cobro y el referido."}</p></section>

    <div class="pt-bottom">
      <section aria-labelledby="track-title">
        <div class="pt-section-head"><h2 id="track-title" class="pt-h2">Seguimiento</h2>${tab === "updates" ? btn("project-update", `${icon("plus")} Actualización`, "btn-ghost", a) : btn("new-payment", `${icon("plus")} Cobro`, "btn-ghost", a)}</div>
        <p class="pt-fine">Del inicio al avance más reciente. Cada actividad conserva su fecha y hora.</p>
        <div class="pt-tablist" role="tablist" aria-label="Seguimiento">
          <button class="pt-tab" role="tab" type="button" aria-selected="${tab === "updates"}" data-action="tab" data-id="updates">Actualizaciones <span class="pt-tab-count">${updates.length}</span></button>
          <button class="pt-tab" role="tab" type="button" aria-selected="${tab === "payments"}" data-action="tab" data-id="payments">Cobros <span class="pt-tab-count">${payments.length}</span></button>
        </div>
        <div class="pt-tabpanel" role="tabpanel">
          ${tab === "updates"
            ? updates.length ? `<ol class="pt-log">${updates.map((u) => `<li class="pt-log-item"${u.stageChange ? " data-change" : ""}><span class="pt-log-date pt-date">${dateTime(u)}</span><div class="pt-log-body">${u.stageChange ? `<p class="pt-log-change">${u.stageChange.from ? `Cambio de etapa <b>${esc(STAGES[u.stageChange.from]?.name || "")}</b> → <b>${esc(STAGES[u.stageChange.to]?.name || "")}</b>` : `Inicio del proyecto <b>${esc(STAGES[u.stageChange.to]?.name || "")}</b>`}</p>` : ""}<p class="pt-log-title">${esc(u.title)}</p>${u.body ? `<p class="pt-log-text">${esc(u.body)}</p>` : ""}<p class="pt-log-author">Eclipse</p></div></li>`).join("")}</ol>` : `<p class="pt-fine">Sin actualizaciones.</p>`
            : payments.length ? `<ul class="pt-ledger">${payments.map((p) => `<li><span class="pt-date">${dateTime(p)}</span><span>${esc(p.concept)}${p.note ? ` · <span class="pt-meta" style="display:inline">${esc(p.note)}</span>` : ""}</span><span class="pt-leader"></span><span class="readout">${usd(p.amount)}</span></li>`).join("")}</ul>` : `<p class="pt-fine">Sin cobros.</p>`}
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
          <div class="pt-date">${dateTime(payment)}</div>
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

function modalShell(kicker, title, text, body, submit, opts = {}) {
  if (submit && !opts.live) {
    body += row(body.includes('name="date"') ? "" : field("date", "Fecha de actividad", "date", todayISO()), field("time", "Hora local", "time", localTime()));
  }
  return `<dialog id="interaction-modal" class="modal ticks" aria-labelledby="modal-title"><div class="modal-content">
    <span class="label">${esc(kicker)}</span>
    <h2 id="modal-title" class="modal-title">${esc(title)}</h2>
    ${text ? `<p class="modal-text">${text}</p>` : ""}
    <form class="pt-form" data-form="${esc(state.modal.type)}"${opts.live ? " data-live-form" : ""}>${body}${opts.live ? '<p class="form-error" role="alert" id="modal-error"></p>' : ""}
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
  if (live && live.hasModal(modal.type)) return live.modalMarkup(modal);
  if (live && modal.type === "data") {
    return modalShell("Datos", "Dónde viven tus datos", "En modo live todo se guarda en el servidor. Este portal no guarda copias de tu operación en el navegador: solo recuerda el tema claro u oscuro.", `
        <div class="pt-data-actions"><button class="btn btn-sm btn-ink" type="button" data-action="export-data">Descargar lo que se ve ahora (.json)</button></div>
        <p class="pt-fine">Es una copia de solo lectura de lo que el servidor devolvió y está cargado en pantalla. No es un respaldo del sistema: el respaldo vive en la base de datos.</p>
        <p class="pt-fine">Importar el respaldo del modo demostración al servidor se hace con la herramienta de importación, que se conecta en la próxima etapa.</p>`, "");
  }

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
    case "batch-signal": {
      const batch = find("batches", modal.id);
      const stats = batch ? batchStats(batch, state.data.prospects) : { size: 0, responded: 0 };
      return modalShell(batch?.name || "Lote", `Señal D+${batch?.signalDays || 2}`, `${stats.responded} de ${stats.size} respondieron hasta ahora.`, area("note", "Qué señal hay", "", "required"), "Guardar señal");
    }
    case "batch-close": {
      const batch = find("batches", modal.id);
      return modalShell(batch?.name || "Lote", "Cerrar el lote", "Informe de tres líneas. Tres informes coincidentes se vuelven playbook.", [
        area("worked", "Qué funcionó", "", "required"), area("notWorked", "Qué no", "", "required"), area("change", "Qué cambio la próxima", "", "required"),
      ].join(""), "Cerrar lote");
    }
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
    const id = newId("p");
    state.data.prospects.push({
      id, name: values.name, contact: values.contact, unit: values.unit, source: values.source, batchId: values.batchId || null,
      need: values.need, offer: values.offer, stage: "contactado", createdAt: values.createdAt,
      events: [{ id: newId("e"), type: "alta", date: values.createdAt, note: "" }],
    });
    window.location.hash = `#prospectos/${encodeURIComponent(id)}`;
    return "Prospecto creado.";
  },
  "new-batch"(values) {
    const id = newId("lote");
    state.data.batches.push({ id, name: values.name, vertical: values.vertical, unit: values.unit, demo: values.demo, hypothesis: values.hypothesis || "", target: Number(values.target) || 0, sentAt: values.sentAt, time: values.time, signalDays: Number(values.signalDays) || 2, closeDays: Number(values.closeDays) || 7, signal: null, report: null });
    window.location.hash = `#lotes/${encodeURIComponent(id)}`;
    return "Lote creado. Sumale los contactos.";
  },
  "batch-signal"(values) {
    find("batches", state.modal.id).signal = { date: values.date, note: values.note };
    return "Señal registrada.";
  },
  "batch-close"(values) {
    find("batches", state.modal.id).report = { date: values.date, worked: values.worked, notWorked: values.notWorked, change: values.change };
    return "Lote cerrado con informe.";
  },
  "new-project"(values) {
    const prospect = state.modal.id ? find("prospects", state.modal.id) : null;
    const unit = values.unit || prospect?.unit;
    const id = newId("pr");
    state.data.projects.push({
      id, code: nextCode(), prospectId: prospect?.id || null, name: values.name, client: values.client, unit, service: values.service,
      stage: "preparation", total: Number(values.total), maintenance: Number(values.maintenance) || 0, startedAt: values.date,
      history: [{ stage: "preparation", start: values.date }],
      milestone: { title: values.milestone || "Insumos y plan de trabajo listos", owner: "Eclipse y cliente", due: values.milestoneDue || addDays(values.date, 5) },
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
    project.pause = { since: values.date, reason: values.reason, next: values.next, review: values.review };
    moveStage(project, "paused", values.date, "Proyecto en pausa", values.reason);
    return "Proyecto en pausa.";
  },
  "project-milestone"(values) {
    const project = find("projects", state.modal.id);
    project.milestone = { title: values.title, owner: values.owner, due: values.due, time: values.time || "" };
    (project.updates ||= []).push({ id: newId("u"), date: values.recordDate, title: `Hito definido: ${values.title}`, body: values.body || `Estimado para ${fmtDate(values.due, true)}${values.time ? ` · ${values.time}` : ""}. Responsable: ${values.owner}.` });
    if (values.deliveryEstimate) project.deliveryEstimate = values.deliveryEstimate;
    return "Hito guardado.";
  },
  "client-action"(values) {
    const project = find("projects", state.modal.id);
    project.clientAction = { title: values.title, requestedOn: values.date, time: values.time };
    (project.updates ||= []).push({ id: newId("u"), date: values.date, title: `Acción pedida: ${values.title}`, body: "Requiere una respuesta del cliente." });
    return "Acción pedida al cliente.";
  },
  "project-update"(values) {
    (find("projects", state.modal.id).updates ||= []).push({ id: newId("u"), date: values.date, title: values.title, body: values.body });
    return "Actualización publicada.";
  },
  "project-referral"(values) {
    const project = find("projects", state.modal.id);
    project.referral = { date: values.date, note: values.note };
    finishProject(project, values.date);
    return project.stage === "support" ? "Referido pedido. El proyecto pasa a Soporte." : "Referido pedido. Proyecto cerrado.";
  },
  "new-goal"(values) {
    const existing = state.modal.id ? find("goals", state.modal.id) : null;
    const now = new Date().toISOString();
    const titles = values.steps.split("\n").map((line) => line.trim()).filter(Boolean);
    const steps = titles.map((title) => existing?.steps.find((step) => step.title === title) || { id: newId("step"), title, done: false, completedAt: null });
    const goal = { ...(existing || {}), id: existing?.id || newId("goal"), title: values.title.trim(), category: values.category, priority: values.priority, due: values.due, time: values.time, notes: values.notes, reference: values.reference, steps, createdAt: existing?.createdAt || now, updatedAt: now, completedAt: steps.length ? steps.every((step) => step.done) ? existing?.completedAt || now : null : existing?.completedAt || null };
    if (existing) Object.assign(existing, goal); else state.data.goals.push(goal);
    window.location.hash = `#metas/${encodeURIComponent(goal.id)}`;
    return existing ? "Meta actualizada." : "Meta creada. Un paso a la vez.";
  },
  "new-event"(values) {
    const existing = state.modal.id ? find("calendarEvents", state.modal.id) : null;
    const now = new Date().toISOString();
    const event = { ...(existing || {}), id: existing?.id || newId("event"), title: values.title.trim(), type: values.type, date: values.date, time: values.time, duration: Number(values.duration), notes: values.notes, reference: values.reference, completedAt: existing?.completedAt || null, createdAt: existing?.createdAt || now, updatedAt: now };
    if (existing) Object.assign(existing, event); else state.data.calendarEvents.push(event);
    Object.assign(state.calendar, { date: event.date, month: event.date.slice(0, 7), eventId: event.id });
    state.pages.calendar = 1;
    window.location.hash = `#calendario/${encodeURIComponent(event.id)}`;
    return existing ? "Evento actualizado." : "Evento agendado.";
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

const AUDIT_LABELS = {
  "new-goal": "Meta guardada", "goal-step": "Paso de una meta actualizado", "goal-toggle": "Estado de meta actualizado", "goal-delete": "Meta eliminada",
  "new-event": "Evento guardado", "event-toggle": "Estado de evento actualizado", "event-delete": "Evento eliminado",
  "new-prospect": "Prospecto creado", "prospect-event": "Actividad de prospecto registrada", "delete-prospect": "Prospecto eliminado",
  "new-batch": "Lote creado", "batch-signal": "Señal de lote registrada", "batch-close": "Lote cerrado",
  "new-project": "Proyecto creado y seña cobrada", "new-payment": "Cobro registrado", "delete-payment": "Cobro eliminado", "new-subscription": "Abono creado", "toggle-subscription": "Estado de abono actualizado",
  "project-advance": "Etapa de proyecto actualizada", "project-pause": "Proyecto pausado", "project-resume": "Proyecto retomado", "project-delivered": "Entrega registrada", "project-referral": "Referido registrado",
  "project-milestone": "Hito definido", "project-update": "Actualización registrada", "client-action": "Acción pedida al cliente", "client-action-done": "Acción del cliente resuelta",
};

function recordMutation(type, values, before, entityId) {
  const planning = ["new-goal", "new-event", "project-milestone", "new-subscription"].includes(type);
  const stamp = auditStamp(planning ? values.recordDate || todayISO() : values.date || values.createdAt || values.sentAt || todayISO(), planning ? values.recordTime || localTime() : values.time || localTime());
  const addStamp = (entry) => Object.assign(entry, auditStamp(entry.date || stamp.date, stamp.time));
  for (const table of ["prospects", "projects"]) {
    for (const entity of state.data[table]) {
      const old = before[table].find((item) => item.id === entity.id);
      const key = table === "prospects" ? "events" : "updates";
      for (const entry of entity[key] || []) if (!(old?.[key] || []).some((item) => item.id === entry.id)) addStamp(entry);
      if (!old) Object.assign(entity, { createdAtInstant: stamp.occurredAt, recordedAt: stamp.recordedAt, timezone: stamp.timezone });
      if (table === "projects") {
        for (const key of ["milestone", "clientAction", "pause", "referral"]) {
          if (entity[key] && JSON.stringify(entity[key]) !== JSON.stringify(old?.[key])) {
            Object.assign(entity[key], { recordedAt: stamp.recordedAt, createdAtInstant: stamp.occurredAt, timezone: stamp.timezone });
            if (key === "referral") addStamp(entity[key]);
            if (key === "clientAction") Object.assign(entity[key], { requestedAt: stamp.occurredAt, time: stamp.time });
          }
        }
        for (let i = 0; i < (entity.history || []).length; i++) {
          if (!old?.history?.[i]) entity.history[i].startAt = stamp.occurredAt;
          if (entity.history[i].end && entity.history[i].end !== old?.history?.[i]?.end) entity.history[i].endAt = stamp.occurredAt;
        }
      }
    }
  }
  for (const table of ["payments", "batches", "subscriptions", "goals", "calendarEvents"]) {
    for (const entity of state.data[table]) {
      const old = before[table].find((item) => item.id === entity.id);
      if (!old && table === "payments") addStamp(entity);
      if (!old) Object.assign(entity, { recordedAt: stamp.recordedAt, timezone: stamp.timezone });
      if (table === "batches") for (const key of ["signal", "report"]) if (entity[key] && JSON.stringify(old?.[key]) !== JSON.stringify(entity[key])) addStamp(entity[key]);
      if (table === "calendarEvents" && (!old || JSON.stringify(old) !== JSON.stringify(entity))) entity.startAt = auditStamp(entity.date, entity.time).occurredAt;
    }
  }
  const tables = ["goals", "calendarEvents", "projects", "prospects", "batches", "subscriptions", "payments"];
  const changed = tables.flatMap((table) => {
    const current = state.data[table];
    const oldList = before[table];
    const entities = current.filter((item) => JSON.stringify(item) !== JSON.stringify(oldList.find((old) => old.id === item.id)));
    return [...entities, ...oldList.filter((item) => !current.some((now) => now.id === item.id))];
  });
  const entity = changed.find((item) => item.id === entityId) || changed[0];
  state.data.audit.push({ id: newId("audit"), action: type, title: type === "prospect-event" ? `${EVENT_LABELS[state.modal?.kind] || "Actividad"} registrada` : AUDIT_LABELS[type] || "Operación actualizada", entityId: entity?.id || null, entityName: entity?.name || entity?.title || entity?.client || entity?.concept || "Eclipse", ...stamp });
}

function validateValues(type, values) {
  if (type === "new-project") {
    if (Number(values.deposit) > Number(values.total)) return "La seña no puede superar el total acordado.";
    if (values.milestoneDue < values.date) return "El primer hito debe ser igual o posterior al inicio.";
    if (values.deliveryEstimate < values.milestoneDue) return "La entrega estimada debe ser igual o posterior al primer hito.";
  }
  if (type === "new-batch" && Number(values.closeDays) <= Number(values.signalDays)) return "El cierre del lote tiene que ocurrir después de leer la señal.";
  if (type === "new-goal") {
    const steps = values.steps.split("\n").map((line) => line.trim()).filter(Boolean);
    if (new Set(steps).size !== steps.length) return "Cada paso debe tener un nombre distinto.";
    if (steps.length > 50) return "Usá hasta 50 pasos para esta meta.";
  }
  if (type === "new-payment" && values.projectId) {
    const project = find("projects", values.projectId);
    if (project && values.unit !== project.unit) return "El cobro debe usar la misma unidad que el proyecto.";
    if (project && ["Seña", "Saldo"].includes(values.concept) && Number(values.amount) > projectBalance(project, state.data.payments)) return "El cobro supera el saldo pendiente del proyecto.";
  }
  if (type === "new-event") {
    const [hour, minute] = values.time.split(":").map(Number);
    if (hour * 60 + minute + Number(values.duration) > 1440) return "La actividad debe terminar dentro del día elegido. Dividila en dos eventos si pasa la medianoche.";
  }
  return "";
}

function exportData() {
  const blob = new Blob([live ? live.exportSnapshot() : JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = live ? `eclipse-servidor-${todayISO()}.json` : `eclipse-ops-${todayISO()}.json`;
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

const MODALS = new Set(["prospect-event", "batch-signal", "batch-close", "project-advance", "project-delivered", "project-pause", "project-referral"]);

/** Acciones del portal que siguen valiendo en live: no escriben datos locales. */
const LIVE_LOCAL_ACTIONS = new Set(["theme-toggle", "page", "filter", "tab", "close-modal", "open-data", "export-data", "wizard-prev", "wizard-cancel"]);

/** Botones en modo live. Devuelve true si el modo live se hizo cargo (o lo bloqueó con una explicación). */
function handleLiveAction(button) {
  const { action, id, kind } = button.dataset;
  switch (action) {
    case "live-logout":
      live.logout().then(() => { window.location.hash = "#hoy"; state.modal = null; state.wizard = null; render(); });
      return true;
    case "live-retry": live.retry(id, kind); return true;
    case "live-auth-retry": live.start(); return true;
    case "live-auth-back": live.auth.backToLogin(); return true;
    case "live-more":
      live.more(id, kind).catch((error) => toast(error.describe?.() || error.message, "warning"));
      return true;
    default: break;
  }
  if (live.hasWizard(action)) {
    startGenerator({ type: action, id, kind, template: button.dataset.template, day: todayISO() });
    return true;
  }
  if (live.hasModal(action)) {
    showModal({ ...button.dataset, type: action });
    return true;
  }
  if (live.hasAction(action)) {
    runLiveAction(button, action);
    return true;
  }
  if (!LIVE_LOCAL_ACTIONS.has(action)) {
    toast("Esta acción todavía no está conectada al servidor.", "warning");
    return true;
  }
  return false;
}

async function runLiveAction(button, action) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const result = await live.runAction(action, { ...button.dataset, button });
    if (result.skipped) return;
    if (result.message) toast(result.refreshFailed ? `${result.message} No pudimos actualizar la pantalla: recargá.` : result.message, result.refreshFailed ? "warning" : "success");
  } catch (error) {
    toast(describeError(error), "warning");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    render();
  }
}

function describeError(error) {
  return typeof error?.describe === "function" ? error.describe() : error?.message || "Algo falló. Probá de nuevo.";
}

function handleAction(button) {
  const { action, id, kind } = button.dataset;
  if (state.wizard) captureWizard();
  if (live && handleLiveAction(button)) return;
  if (GENERATORS.has(action)) {
    startGenerator({ type: action, id, kind, template: button.dataset.template, day: button.dataset.day || (routeInfo().view === "calendario" ? state.calendar.date : todayISO()) });
    return;
  }
  if (MODALS.has(action)) {
    showModal({ type: action, id, kind });
    return;
  }
  const before = AUDIT_LABELS[action] ? structuredClone(state.data) : null;
  const finish = (message) => { recordMutation(action, {}, before, id); commit(message); };
  switch (action) {
    case "theme-toggle": {
      const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#05050a" : "#f4efe6";
      try { localStorage.setItem("eclipse-theme", theme); } catch { /* El tema funciona también sin storage. */ }
      render();
      break;
    }
    case "page": state.pages[id] = Number(kind); render(); break;
    case "goal-filter": state.goalFilter = id; state.pages.goals = 1; render(); break;
    case "goal-toggle": {
      const goal = find("goals", id);
      if (!goal || goal.steps.length) break;
      goal.completedAt = goal.completedAt ? null : new Date().toISOString();
      goal.updatedAt = new Date().toISOString();
      finish(goal.completedAt ? "Meta completada." : "Meta reabierta.");
      break;
    }
    case "goal-delete":
      if (window.confirm("¿Eliminar esta meta y sus pasos?")) {
        state.data.goals = state.data.goals.filter((goal) => goal.id !== id);
        window.location.hash = "#metas";
        finish("Meta eliminada.");
      }
      break;
    case "event-toggle": {
      const event = find("calendarEvents", id);
      if (!event) break;
      event.completedAt = event.completedAt ? null : new Date().toISOString();
      event.updatedAt = new Date().toISOString();
      finish(event.completedAt ? "Actividad completada." : "Actividad reabierta.");
      break;
    }
    case "event-delete":
      if (window.confirm("¿Eliminar este evento del calendario?")) {
        state.data.calendarEvents = state.data.calendarEvents.filter((event) => event.id !== id);
        window.location.hash = "#calendario";
        state.calendar.eventId = null;
        finish("Evento eliminado.");
      }
      break;
    case "calendar-day": state.calendar.date = id; state.calendar.eventId = null; state.pages.calendar = 1; render(); break;
    case "calendar-filter": state.calendar.filter = id; state.pages.calendar = 1; render(); break;
    case "calendar-month": {
      const [year, month] = state.calendar.month.split("-").map(Number);
      const next = new Date(Date.UTC(year, month - 1 + Number(id), 1)).toISOString().slice(0, 7);
      Object.assign(state.calendar, { month: next, date: `${next}-01`, eventId: null });
      state.pages.calendar = 1;
      render();
      break;
    }
    case "calendar-today": Object.assign(state.calendar, { date: todayISO(), month: todayISO().slice(0, 7), eventId: null }); state.pages.calendar = 1; render(); break;
    case "wizard-prev": state.wizard.step = Math.max(0, state.wizard.step - 1); render(); focusGenerator(); break;
    case "wizard-cancel": {
      const returnTo = state.wizard?.returnTo || "#hoy";
      state.wizard = null;
      window.location.hash = returnTo;
      render();
      break;
    }
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
      live?.prepare(routeInfo());
      break;
    }
    case "tab": state.tab = id; render(); break;
    case "project-resume": finish(resumeProject(find("projects", id))); break;
    case "client-action-done": {
      const project = find("projects", id);
      (project.updates ||= []).push({ id: newId("u"), date: todayISO(), title: `Resuelto: ${project.clientAction.title}`, body: "" });
      project.clientAction = null;
      finish("Acción del cliente resuelta.");
      break;
    }
    case "toggle-subscription": {
      const sub = find("subscriptions", id);
      sub.active = !sub.active;
      finish(sub.active ? "Abono reactivado." : "Abono dado de baja.");
      break;
    }
    case "delete-payment":
      if (window.confirm("¿Eliminar este cobro?")) {
        state.data.payments = state.data.payments.filter((payment) => payment.id !== id);
        const project = find("projects", before.payments.find((payment) => payment.id === id)?.projectId);
        if (project && projectBalance(project, state.data.payments) > 0) project.paidAt = null;
        finish("Cobro eliminado.");
      }
      break;
    case "delete-prospect":
      if (window.confirm("¿Eliminar este prospecto y su historial?")) {
        state.data.prospects = state.data.prospects.filter((prospect) => prospect.id !== id);
        window.location.hash = "#prospectos";
        finish("Prospecto eliminado.");
      }
      break;
    default: break;
  }
}

// ---------- Render ----------

const root = document.getElementById("app");
const uiHelpers = {
  state, esc, icon, phaseGlyph, shell, crumbs, btn, field, area, select, row, usd, fmtDate, meter, emptyState, pagination, pageSlice, dateTime,
  // Para los módulos del modo live (src/live): mismas primitivas visuales, sin duplicarlas.
  modalShell, options, dataAttrs, openLink, stageMark, dueTag, projectRail, toast: (...args) => toast(...args),
  liveWizard: (wizard) => (live && live.hasWizard(wizard.type) ? live.wizardConfig(wizard) : undefined),
};
const workspace = workspaceUI(uiHelpers);

function startGenerator(meta) {
  state.formError = "";
  const previous = state.wizard?.returnTo || window.location.hash || "#hoy";
  state.modal = null;
  state.wizard = { ...meta, step: 0, values: {}, returnTo: previous.startsWith("#crear") ? "#hoy" : previous };
  state.wizard.values = generatorConfig(state.wizard, state.data, uiHelpers)?.values || {};
  if (meta.type === "new-goal" && meta.template === "ventas") {
    const v = state.calculator;
    const plan = salesPlan({ gap: Number(v.gap), ticket: Number(v.ticket), conversion: Number(v.conversion) });
    if (plan) Object.assign(state.wizard.values, { title: `Definir mi plan para ${plan.proposals} propuestas`, notes: `Escenario: cubrir ${usd(Number(v.gap))} con ${plan.sales} ventas y ${plan.proposals} propuestas. Ticket ${usd(Number(v.ticket))}; conversión estimada ${v.conversion}%.` });
  }
  window.location.hash = `#crear/${meta.type}`;
  render();
  focusGenerator();
}

function captureWizard() {
  const form = root.querySelector('[data-form="wizard"]');
  if (!form || !state.wizard) return;
  Object.assign(state.wizard.values, Object.fromEntries(new FormData(form).entries()));
  // Una casilla sin marcar no viaja en FormData: se guarda vacía para no arrastrar un valor viejo.
  for (const box of form.querySelectorAll('input[type="checkbox"]')) if (!box.checked) state.wizard.values[box.name] = "";
}

function focusGenerator() {
  window.scrollTo({ top: 0, behavior: "instant" });
  const title = root.querySelector(".generator-section-head h2");
  if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
}

function screenFor({ view, id }) {
  if (live && view === "crear") {
    if (!live.hasWizard(id)) return live.screenFor({ view: "hoy", id: "" });
    if (!state.wizard || state.wizard.type !== id) {
      state.wizard = { type: id, values: {}, step: 0, returnTo: "#hoy", day: todayISO() };
      state.wizard.values = generatorConfig(state.wizard, state.data, uiHelpers)?.values || {};
    }
    return renderGenerator(state.wizard, state.data, uiHelpers);
  }
  if (live) return live.screenFor({ view, id });
  if (view === "crear") {
    if (!GENERATORS.has(id)) return renderHoy();
    if (!state.wizard || state.wizard.type !== id) {
      state.wizard = { type: id, values: {}, step: 0, returnTo: "#hoy", day: todayISO() };
      state.wizard.values = generatorConfig(state.wizard, state.data, uiHelpers)?.values || {};
    }
    if (["project-milestone", "project-update", "client-action"].includes(id) && !find("projects", state.wizard.id)) return shell(emptyState("Elegí un proyecto para continuar", "Abrí el proyecto y creá el registro desde su ficha.", '<a class="pt-link" href="#proyectos">Volver a proyectos</a>'), "proyectos");
    return renderGenerator(state.wizard, state.data, uiHelpers);
  }
  if (view === "metas") return workspace.renderGoals(id);
  if (view === "calendario") return workspace.renderCalendar(id);
  if (view === "herramientas") return workspace.renderTools();
  if (view === "actividad") return workspace.renderAudit();
  if (view === "prospectos") return id ? renderProspectDetail(id) : renderProspectos();
  if (view === "lotes") return renderLotes(id);
  if (view === "proyectos") return renderProyectos(id);
  if (view === "cobros") return renderCobros();
  return renderHoy();
}

function configErrorScreen() {
  const dark = document.documentElement.dataset.theme !== "light";
  return `<header class="pt-header"><div class="container-x pt-header-row"><a class="pt-brand" href="#hoy" aria-label="Eclipse">${phaseGlyph(1, 22)}<span class="pt-brand-name">ECLIPSE</span></a><div class="pt-tools" style="margin-left:auto"><button class="hdr-link theme-toggle" type="button" data-action="theme-toggle" aria-label="${dark ? "Activar modo claro" : "Activar modo oscuro"}">${icon(dark ? "sun" : "moon")}</button></div></div></header>
    <main id="main-content" class="pt-main" tabindex="-1"><div class="pt-light" aria-hidden="true"></div><div class="container-x pt-page live-auth"><section class="live-auth-card ticks" aria-labelledby="cfg-title">
      <span class="label">Configuración</span><h1 id="cfg-title" class="display live-auth-title">La configuración <em>no es válida</em>.</h1>
      <p class="pt-company">Se encontró public-config.json pero tiene errores. Por seguridad el portal no arranca en modo demostración en su lugar: corregí el archivo y recargá.</p>
      <ul class="live-config-errors" role="alert">${(config.errors || []).map((error) => `<li>${esc(error)}</li>`).join("")}</ul>
      <p class="pt-fine">Se genera con <span class="readout">node scripts/build-public-config.mjs</span>. Guía: docs/integration.md.</p></section></div></main>`;
}

/** Los cambios de datos del servidor llegan sueltos: se juntan en un solo dibujado y no pisan un diálogo abierto. */
let renderQueued = false;
function requestRender({ fromData = false } = {}) {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    if (fromData && state.modal) return;
    if (state.wizard) captureWizard();
    render();
  });
}

function render() {
  const active = document.activeElement;
  const focusId = active?.id && root.contains(active) ? active.id : null;
  const caret = focusId && typeof active.selectionStart === "number" ? active.selectionStart : null;

  if (config.mode === "invalid") { root.innerHTML = configErrorScreen(); return; }
  if (live && !live.ready) {
    root.innerHTML = live.authScreen({ dark: document.documentElement.dataset.theme !== "light" });
    root.querySelector("[data-autofocus]")?.focus({ preventScroll: true });
    return;
  }
  root.innerHTML = screenFor(routeInfo()) + (state.modal ? modalMarkup() : "");
  if (live) {
    // Un dibujado en medio de un envío no puede perder el error ni rehabilitar el botón.
    const errorEl = root.querySelector("#wizard-error, #modal-error");
    if (errorEl && state.formError) errorEl.textContent = state.formError;
    if (state.submitting) root.querySelectorAll('[data-form="wizard"] button[type="submit"], [data-live-form] button[type="submit"]').forEach((button) => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
  }

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
  paintToasts();
}

function showModal(modal) {
  state.formError = "";
  state.modal = modal;
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

/** Los módulos live actualizan el diálogo abierto (p. ej. el resultado de buscar una cuenta). */
function setModal(patch) {
  if (!state.modal) return;
  state.modal = { ...state.modal, ...patch };
  render();
}

// Los avisos viven fuera del DOM de cada pantalla: un dibujado posterior (p. ej. datos del servidor que llegan) no los borra.
const toasts = [];
function paintToasts() {
  const region = root.querySelector(".toast-region");
  if (!region) return;
  region.replaceChildren(...toasts.map((entry) => {
    const item = document.createElement("div");
    item.className = `toast${entry.tone === "warning" ? " warning" : ""}`;
    item.textContent = entry.message;
    if (entry.shown) item.style.animation = "none";
    entry.shown = true;
    return item;
  }));
}

function toast(message, tone = "success") {
  const entry = { message, tone, shown: false };
  toasts.push(entry);
  paintToasts();
  setTimeout(() => { toasts.splice(toasts.indexOf(entry), 1); paintToasts(); }, 4200);
}

/**
 * Envío en modo live: la interfaz espera al servidor. El éxito se muestra SOLO después de que el servidor confirma (y de volver a
 * pedir los datos); si falla, el formulario queda abierto con el motivo y se puede reintentar (misma clave de idempotencia).
 */
async function submitLive(form, type, values, { wizard = null, modal = null }) {
  if (state.submitting) return;
  const submit = form.querySelector('button[type="submit"]');
  const label = submit?.textContent;
  const errorEl = wizard ? document.getElementById("wizard-error") : document.getElementById("modal-error");
  state.submitting = true;
  state.formError = "";
  if (errorEl) errorEl.textContent = "";
  if (submit) { submit.disabled = true; submit.setAttribute("aria-busy", "true"); submit.textContent = "Guardando…"; }
  const guarded = form.querySelectorAll('[data-action="wizard-prev"], [data-action="wizard-cancel"], [data-action="close-modal"]');
  guarded.forEach((control) => { control.disabled = true; });
  try {
    const { type: _modalType, ...target } = modal || {};
    const scope = wizard ? `wizard:${wizard.type}:${wizard.id || ""}:${wizard.kind || ""}` : `modal:${type}:${target.id || ""}:${target.kind || ""}:${target.to || ""}`;
    const result = await live.submit(type, values, { target: wizard ? { id: wizard.id, kind: wizard.kind, returnTo: wizard.returnTo } : target, modal, scope });
    if (result.skipped) return;
    state.submitting = false;
    if (wizard) {
      state.wizard = null;
      if (window.location.hash.startsWith("#crear")) window.location.hash = result.goto || wizard.returnTo;
    } else {
      state.modal = null;
      if (result.goto) window.location.hash = result.goto;
    }
    render();
    toast(result.refreshFailed ? `${result.message} No pudimos actualizar la pantalla: recargá para ver todo.` : result.message, result.refreshFailed ? "warning" : "success");
  } catch (error) {
    state.formError = error?.name === "FormError" ? error.message : describeError(error);
    const target = document.getElementById(wizard ? "wizard-error" : "modal-error");
    if (target) target.textContent = state.formError;
    else if (!wizard && !state.modal) toast(state.formError, "warning");
  } finally {
    state.submitting = false;
    const again = form.isConnected ? form : root.querySelector(wizard ? '[data-form="wizard"]' : "[data-live-form]");
    const button = again?.querySelector('button[type="submit"]');
    if (button && (state.wizard || state.modal)) { button.disabled = false; button.removeAttribute("aria-busy"); button.textContent = label; }
    again?.querySelectorAll('[data-action="wizard-prev"], [data-action="wizard-cancel"], [data-action="close-modal"]').forEach((control) => { control.disabled = false; });
  }
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
  live?.prepare(routeInfo());
}
root.addEventListener("input", onFilter);
root.addEventListener("input", (event) => {
  if (event.target.id === "auth-code") event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
  if (event.target.matches("input, textarea") && event.target.validity.customError) event.target.setCustomValidity("");
  const input = event.target.closest("[data-calc]");
  if (!input) return;
  state.calculator[input.dataset.calc] = input.value;
  render();
});
root.addEventListener("change", (event) => {
  if (event.target.matches("[data-rerender]") && state.wizard) {
    captureWizard();
    render();
    return;
  }
  if (event.target.matches('[name="inspiration"]') && state.wizard?.type === "new-goal") {
    captureWizard();
    const inspiration = agenda(state.data).find((item) => `${item.entity}:${item.id}:${item.kind}` === event.target.value);
    if (inspiration) Object.assign(state.wizard.values, { title: inspiration.title, category: inspiration.entity === "project" ? "Proyecto" : "Ventas", reference: `${inspiration.entity}:${inspiration.id}`, notes: `Para ${inspiration.name}. Vencimiento operativo: ${fmtDate(inspiration.due, true)}.` });
    render();
    return;
  }
  if (event.target.matches("[data-goal][data-step]")) {
    const goal = find("goals", event.target.dataset.goal);
    if (!goal) return;
    const before = structuredClone(state.data);
    if (toggleGoalStep(goal, event.target.dataset.step)) {
      recordMutation("goal-step", {}, before, goal.id);
      commit(goal.completedAt ? "Todos los pasos listos. Meta completada." : "Paso actualizado.");
    }
    return;
  }
  if (event.target.matches("[data-calendar-date]") && event.target.value) {
    Object.assign(state.calendar, { date: event.target.value, month: event.target.value.slice(0, 7), eventId: null });
    state.pages.calendar = 1;
    render();
    return;
  }
  if (event.target.matches('[data-action-change="import-data"]')) { importData(event.target); return; }
  if (event.target.matches("select[data-filter]")) onFilter(event);
});

root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target.closest("[data-form]");
  if (!form) return;
  for (const input of form.querySelectorAll("input, textarea")) {
    input.setCustomValidity(input.required && !input.value.trim() ? "Completá este campo." : "");
  }
  if (!form.reportValidity()) return;
  if (live && ["live-login", "live-mfa"].includes(form.dataset.form)) {
    if (form.dataset.form === "live-login") live.auth.submitCredentials(form.elements.email.value, form.elements.password.value);
    else live.auth.submitCode(form.elements.code.value.trim());
    return;
  }
  if (form.dataset.form === "wizard") {
    captureWizard();
    const wizard = state.wizard;
    const config = generatorConfig(wizard, state.data, uiHelpers);
    if (wizard.step < config.steps.length - 1) {
      wizard.step++;
      render();
      focusGenerator();
      return;
    }
    const values = Object.fromEntries(Object.entries(wizard.values).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
    for (let i = 0; i < config.steps.length - 1; i++) {
      const checkForm = document.createElement("form");
      checkForm.innerHTML = config.steps[i][2];
      if (!checkForm.checkValidity()) {
        wizard.step = i;
        render();
        root.querySelector('[data-form="wizard"]')?.reportValidity();
        return;
      }
    }
    if (live) { submitLive(form, wizard.type, values, { wizard }); return; }
    const error = validateValues(wizard.type, values);
    if (error) { document.getElementById("wizard-error").textContent = error; return; }
    const before = structuredClone(state.data);
    state.modal = { type: wizard.type, id: wizard.id, kind: wizard.kind };
    const message = SUBMITS[wizard.type](values);
    recordMutation(wizard.type, values, before, wizard.id);
    state.wizard = null;
    if (window.location.hash.startsWith("#crear")) window.location.hash = wizard.returnTo;
    commit(message);
    return;
  }
  const values = Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
  if (live) {
    if (live.hasModal(form.dataset.form)) submitLive(form, form.dataset.form, values, { modal: state.modal });
    return;
  }
  const handler = SUBMITS[form.dataset.form];
  if (!handler) return;
  const error = validateValues(form.dataset.form, values);
  if (error) { toast(error, "warning"); return; }
  const before = structuredClone(state.data);
  const message = handler(values);
  recordMutation(form.dataset.form, values, before, state.modal.id);
  commit(message);
});

window.addEventListener("hashchange", () => {
  captureWizard();
  if (routeInfo().view !== "crear") state.wizard = null;
  state.modal = null;
  state.formError = "";
  state.tab = "updates";
  live?.prepare(routeInfo());
  render();
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  document.getElementById("main-content")?.focus({ preventScroll: true });
});

// Si otra pestaña guarda cambios, se recargan para no pisarlos.
window.addEventListener("storage", (event) => {
  if (event.key === "eclipse-theme") {
    captureWizard();
    document.documentElement.dataset.theme = event.newValue === "light" ? "light" : "dark";
    document.querySelector('meta[name="theme-color"]').content = event.newValue === "light" ? "#f4efe6" : "#05050a";
    render();
    return;
  }
  if (live) return;
  if (event.key && event.key.startsWith("eclipse-ops")) {
    captureWizard();
    state.data = load();
    render();
  }
});

// ---------- Arranque ----------

if (config.mode === "live") {
  const { createLive } = await import("./live/index.js");
  live = createLive({
    config,
    ui: uiHelpers,
    hooks: {
      state,
      requestRender,
      setModal,
      onReady() {
        state.modal = null;
        state.wizard = null;
        state.formError = "";
        if (!window.location.hash) window.location.hash = "#hoy";
        live.prepare(routeInfo());
        render();
      },
    },
  });
  // Cada módulo declara sus filtros por defecto; los del modo live pisan los de demo.
  for (const [group, defaults] of Object.entries(live.initialFilters())) state.filters[group] = { ...(state.filters[group] || {}), ...defaults };
  render();
  live.start();
} else {
  render();
}
