// Hoy en modo live: lo que el servidor sabe. La agenda del sistema (próximas acciones, toques de propuesta, lotes, metas y eventos), tus
// metas y eventos de hoy, las solicitudes por revisar, los cobros comprometidos y los cinco números del servidor con su definición y
// el desglose de las filas que los componen. NO hay metas por bimestre, MRR ni "cobrado vs. meta": el servidor no los guarda y acá no
// se calculan con datos locales.
import { addDays, diffDays, todayISO } from "../../rules.js";
import { formatCents as money, shortId } from "../adapters/common.js";
import { INDICATORS, INDICATOR_KEYS, PERIODS, adaptIndicatorItem, adaptIndicators, parseRange, periodRange, rangeKey } from "../adapters/planner.js";
import { collectPayments } from "./cobros.js";
import { findEvent, goalsOf, loadedEvents, remember } from "./planner-shared.js";

const LIMIT = 15;
const ITEMS_PAGE = 20;
const SECTION = "pt-list";

const agendaKey = (today, scope) => `${rangeKey(today, addDays(today, 7))}|${scope}`;
const eventsKey = (today) => rangeKey(today, addDays(today, 7));
const itemsKey = (indicator, range) => `${indicator}|${range}`;
const stamp = (iso) => new Date(iso).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });

export default {
  id: "hoy",
  label: "Hoy",
  nav: { order: 10, area: "main" },
  status: "live",
  filters: { hoy: { period: "7", scope: "mine" } },

  slices: {
    /** Los cinco números del período, con definición y fuente. Lo de dinero llega vacío sin billing:read. */
    "reports.indicators": {
      permission: "reports:read",
      forbiddenValue: null,
      load: async ({ api, signal }, key) => {
        const { from, to } = parseRange(key);
        return adaptIndicators(await api.get("/admin/reports/indicators", { query: { from, to }, signal }));
      },
    },
    /** Filas detrás de un número. Clave: "indicador|desde..hasta". Pagina por cursor. */
    "reports.items": {
      permission: "reports:read",
      forbiddenValue: { items: [], nextCursor: null },
      load: async ({ api, signal }, key) => {
        const [indicator, range] = key.split("|");
        const { from, to } = parseRange(range);
        const page = await api.get(`/admin/reports/indicators/${indicator}/items`, { query: { from, to, limit: ITEMS_PAGE }, signal });
        return { items: page.items.map((row) => adaptIndicatorItem(indicator, row)), nextCursor: page.nextCursor || null };
      },
      more: async ({ api }, key, current) => {
        if (!current.nextCursor) return current;
        const [indicator, range] = key.split("|");
        const { from, to } = parseRange(range);
        const page = await api.get(`/admin/reports/indicators/${indicator}/items`, { query: { from, to, limit: ITEMS_PAGE, cursor: current.nextCursor } });
        const known = new Set(current.items.map((item) => item.id));
        return { items: [...current.items, ...page.items.map((row) => adaptIndicatorItem(indicator, row)).filter((item) => !known.has(item.id))], nextCursor: page.nextCursor || null };
      },
    },
  },

  prepare(ctx, route) {
    remember(ctx);
    const { repo, can } = ctx;
    const today = todayISO();
    const f = ctx.state.filters.hoy;
    // Los nombres de prospectos se refrescan seguido: la agenda trae solo su id.
    if (can("leads:read")) repo.ensure("planner.leads", "", { maxAge: 15_000 }).catch(() => {});
    if (can("projects:read")) repo.ensure("projects").catch(() => {});

    if (route.id) {
      // Desglose de un número.
      const range = periodRange(f.period, today);
      if (INDICATOR_KEYS.includes(route.id) && can("reports:read")) {
        repo.ensure("reports.indicators", rangeKey(range.from, range.to)).catch(() => {});
        repo.ensure("reports.items", itemsKey(route.id, rangeKey(range.from, range.to))).catch(() => {});
      }
      return;
    }

    if (can("requests:read")) repo.ensure("catalog").catch(() => null).then(() => repo.ensure("requests", "pending")).catch(() => {});
    if (can("projects:read")) {
      repo.ensure("projects").then((data) => {
        // Un pedido por proyecto: solo los abiertos más recientes y con caché larga (la API admite 120 pedidos por minuto).
        const ids = data.list.filter((project) => project.stage !== "closed").slice(0, LIMIT).map((project) => project.id);
        if (can("billing:read")) repo.ensureAll("project.payments", ids, { maxAge: 300_000 });
      }).catch(() => {});
    }
    if (can("planner:read") || can("leads:read")) repo.ensure("planner.agenda", agendaKey(today, f.scope)).catch(() => {});
    if (can("planner:read")) {
      repo.ensure("planner.goals").catch(() => {});
      repo.ensure("planner.events", eventsKey(today)).catch(() => {});
    }
    if (can("reports:read")) {
      const range = periodRange(f.period, today);
      repo.ensure("reports.indicators", rangeKey(range.from, range.to)).catch(() => {});
    }
  },

  badge(ctx) {
    const pending = ctx.repo.data("requests", "pending")?.items.length || 0;
    const today = todayISO();
    const agenda = ctx.repo.data("planner.agenda", agendaKey(today, ctx.state.filters.hoy.scope)) || [];
    const due = agenda.filter((item) => item.date <= today).length;
    const total = pending + due;
    return total ? { count: total, label: `${total} cosas para mirar (${pending} solicitudes por revisar, ${due} de la agenda)` } : null;
  },

  render(ctx, route) {
    remember(ctx);
    if (route.id && INDICATOR_KEYS.includes(route.id)) return drillDown(ctx, route.id);
    return overview(ctx);
  },
};

// ---------- Hoy ----------

function leadNameOf(ctx, id) {
  return (ctx.repo.data("planner.leads")?.list || []).find((lead) => lead.id === id)?.name || "";
}

function agendaRow(ctx, item, today) {
  const { esc, btn } = ctx;
  const who = leadNameOf(ctx, item.id);
  const write = ctx.can("planner:write");
  const goal = item.type === "goal_due" ? goalsOf(ctx).find((candidate) => candidate.id === item.id) : null;
  const event = item.type === "calendar_event" ? findEvent(ctx.repo, item.id) : null;
  const isLead = ["lead_next_action", "lead_review", "proposal_touch"].includes(item.type);
  const open = (label) => `<a class="btn btn-sm btn-ink btn-open" href="${item.href}">${label}</a>`;
  let action = open("Abrir");
  if (item.type === "goal_due") action = open("Ver pasos");
  if (item.type === "calendar_event") {
    action = event && write ? btn("event-status", "Completar", "btn-ink", `data-id="${esc(item.id)}" data-kind="done"`) : btn("calendar-open", "Ver evento", "btn-ink", `data-id="${esc(item.id)}" data-kind="${esc(item.date)}"`);
  }
  return {
    title: item.title || item.typeLabel,
    name: isLead ? (who || item.detail || `Prospecto #${shortId(item.id)}`) : goal ? goal.categoryLabel : event ? event.typeLabel : item.typeLabel,
    where: `${item.typeLabel}${item.mine ? "" : " · de otra persona"}`,
    due: item.date, time: item.time, href: item.href, action,
  };
}

function overview(ctx) {
  const { shell, crumbs, esc, btn, icon, emptyState, dueTag, fmtDate, pageSlice, pagination, loading, failure } = ctx;
  const today = todayISO();
  const f = ctx.state.filters.hoy;
  const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const write = ctx.can("planner:write");

  const requests = ctx.can("requests:read") ? ctx.repo.get("requests", "pending") : null;
  const projectsEntry = ctx.can("projects:read") ? ctx.repo.get("projects") : null;
  const projects = projectsEntry?.data?.list || [];
  const active = projects.filter((project) => !["closed", "support"].includes(project.stage));
  const shown = projects.filter((project) => project.stage !== "closed").slice(0, LIMIT);
  const { payments, loading: loadingPayments } = ctx.can("billing:read") ? collectPayments(ctx.repo, shown) : { payments: [], loading: 0 };
  const committed = payments.filter((payment) => payment.status === "committed");
  const committedCents = committed.reduce((sum, payment) => sum + payment.amountCents, 0);

  const agendaAllowed = ctx.can("planner:read") || ctx.can("leads:read");
  const agendaEntry = agendaAllowed ? ctx.repo.get("planner.agenda", agendaKey(today, f.scope)) : null;
  const agenda = agendaEntry?.data || [];
  const goals = ctx.can("planner:read") ? goalsOf(ctx) : [];
  const goalsToday = goals.filter((goal) => goal.mine && goal.status !== "cancelled" && goal.due === today);
  const goalsDone = goalsToday.filter((goal) => goal.status === "done").length;
  const nextEvent = loadedEvents(ctx.repo).filter((event) => event.date === today && event.status === "scheduled" && event.mine).sort((a, b) => (a.time || "23:59").localeCompare(b.time || "23:59"))[0];

  const items = [];
  for (const request of (requests?.data?.items || []).filter((r) => ["submitted", "under_review"].includes(r.status))) {
    items.push({ title: request.status === "submitted" ? "Revisar solicitud nueva" : "Terminar de revisar la solicitud", name: request.contactName, where: "Solicitud", due: request.date, href: `#solicitudes/${encodeURIComponent(request.id)}`, action: `<a class="btn btn-sm btn-ink btn-open" href="#solicitudes/${encodeURIComponent(request.id)}">Abrir</a>` });
  }
  for (const payment of payments.filter((p) => p.status === "committed" && p.dueOn && diffDays(today, p.dueOn) <= 7)) {
    const project = projects.find((p) => p.id === payment.projectId);
    items.push({ title: `Cobrar ${payment.concept.toLowerCase()} (${money(payment.amountCents)})`, name: project?.name || payment.projectName, where: "Proyecto", due: payment.dueOn, href: `#proyectos/${encodeURIComponent(payment.projectId)}`, action: ctx.can("billing:write") ? btn("payment-transition", "Marcar cobrado", "btn-ink", `data-id="${esc(payment.projectId)}" data-kind="${esc(payment.id)}" data-to="collected"`) : "" });
  }
  for (const item of agenda) items.push(agendaRow(ctx, item, today));
  items.sort((a, b) => a.due.localeCompare(b.due) || (a.time || "23:59").localeCompare(b.time || "23:59"));
  const now = items.filter((item) => item.due <= today);
  const late = now.filter((item) => item.due < today).length;
  const soon = items.filter((item) => item.due > today);
  const loadingAny = [requests, projectsEntry, agendaEntry].some((entry) => entry && entry.data === undefined && entry.status !== "error");

  const cols = "minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,.8fr) minmax(0,1fr)";
  const rows = (list, group) => `<div class="pt-rows-head agenda-rows-head" style="--cols:${cols}"><span class="label">Qué hay que hacer</span><span class="label">Dónde</span><span class="label">Fecha</span><span class="label" style="text-align:right">Acción</span></div>
    <ul class="pt-rows agenda-rows">${pageSlice(list, group).map((item) => `<li class="pt-row" style="--cols:${cols}"${item.due < today ? " data-late" : item.due === today ? " data-turn" : ""}>
      <div><span class="pt-row-name">${esc(item.title)}</span></div>
      <div><a class="pt-link" style="min-height:0" href="${item.href}">${esc(item.name)}</a><span class="pt-meta">${esc(item.where)}</span></div>
      <div>${dueTag(item.due)}${item.time ? `<span class="pt-meta readout">${esc(item.time)}</span>` : ""}</div><div class="pt-row-end">${item.action}</div></li>`).join("")}</ul>${pagination(list, group)}`;

  const agendaProblem = agendaEntry?.status === "error" ? failure(agendaEntry.error, { slice: "planner.agenda", key: agendaKey(today, f.scope), title: "No pudimos cargar la agenda" }) : "";
  const scopeToggle = agendaAllowed ? `<div class="pt-seg" role="group" aria-label="De quién es la agenda">${[["mine", "Mía"], ["all", "Del equipo"]].map(([key, label]) => `<button type="button" data-action="filter" data-id="hoy.scope" data-kind="${key}" aria-pressed="${f.scope === key}">${label}</button>`).join("")}</div>` : "";
  const connected = ["prospectos", "lotes"].filter((id) => ctx.registry.module(id)?.status === "pending").map((id) => ctx.registry.module(id).label.toLowerCase());

  return shell(`${crumbs([["Operación", "#hoy"], ["Hoy"]])}
    <div class="pt-kicker"><span class="label">En vivo</span><span class="label">${esc(weekday)}</span></div>
    <h1 class="display pt-hello">Hola.</h1>
    <p class="pt-company">${loadingAny ? "Buscando qué hay en el servidor…" : now.length ? `Hoy tenés <strong>${now.length} ${now.length === 1 ? "cosa" : "cosas"}</strong> para mirar${late ? `, <strong>${late} vencida${late === 1 ? "" : "s"}</strong>` : ""}.` : "No hay nada vencido ni para hoy."}</p>

    ${ctx.can("planner:read") ? `<div class="focus-band ticks">
      <div class="focus-band-intro"><span class="label">Tu órbita de hoy</span><p>Un día con <em>dirección.</em></p></div>
      <a class="focus-metric" href="#metas"><span class="label">Mi plan</span><span class="readout">${goalsDone}<small> / ${goalsToday.length}</small></span><span class="pt-fine">metas de hoy completadas ${icon("arrow")}</span></a>
      <a class="focus-metric" href="#calendario"><span class="label">${nextEvent ? "En tu calendario" : "Espacio para avanzar"}</span><strong>${nextEvent ? `${esc(nextEvent.time || "Todo el día")} · ${esc(nextEvent.title)}` : "Diseñá tu jornada"}</strong><span class="pt-fine">${nextEvent ? `${nextEvent.duration ? `${nextEvent.duration} minutos · ` : ""}${esc(nextEvent.typeLabel)}` : "Llamadas, hitos y bloques de foco"} ${icon("arrow")}</span></a>
      <div class="focus-action">${write ? btn("new-goal", `${icon("plus")} Planificar mi día`, "btn-ghost") : ""}</div>
    </div>` : ""}

    <dl class="pt-overview">
      <div><dt>Solicitudes por revisar</dt><dd><span class="pt-big">${requests?.data ? requests.data.items.length : "—"}${requests?.data?.nextCursor ? "+" : ""}</span><span class="pt-fine">${requests ? '<a href="#solicitudes">Abrir la bandeja</a>' : "Tu cuenta no tiene requests:read."}</span></dd></div>
      <div><dt>Proyectos activos</dt><dd><span class="pt-big">${projectsEntry?.data ? active.length : "—"}</span><span class="pt-fine">${projectsEntry ? '<a href="#proyectos">Ver proyectos</a>' : "Tu cuenta no tiene projects:read."}</span></dd></div>
      <div><dt>Cobros comprometidos</dt><dd><span class="pt-big" data-key>${ctx.can("billing:read") ? (loadingPayments ? "…" : money(committedCents)) : "—"}</span><span class="pt-fine">${ctx.can("billing:read") ? `${committed.length} cobro${committed.length === 1 ? "" : "s"} con fecha en ${shown.length} proyecto${shown.length === 1 ? "" : "s"} abiertos. No es ingreso todavía; el saldo está en <a href="#proyectos">Proyectos</a>.` : "Tu cuenta no tiene billing:read."}</span></dd></div>
    </dl>

    <section class="${SECTION}" aria-labelledby="today-title">
      <div class="pt-list-head"><div class="pt-list-title"><h2 id="today-title" class="pt-h2">Qué toca hoy</h2><span class="pt-count">${now.length}</span></div><div class="pt-head-actions">${scopeToggle}${ctx.can("planner:read") ? `<a class="pt-link" href="#metas">Mi plan ${icon("arrow")}</a>` : ""}</div></div>
      <p class="pt-fine">Lo vencido y lo de hoy, de la agenda del sistema (prospectos, lotes, metas y eventos), las solicitudes y los cobros. Cinco por página.</p>
      ${agendaProblem}
      ${now.length ? rows(now, "today") : loadingAny ? loading("Cargando…") : emptyState("Nada pendiente para hoy", "Cuando llegue una solicitud, venza un cobro o toque una próxima acción, aparece acá.", "")}
    </section>

    ${agendaAllowed || soon.length ? `<section class="${SECTION}" aria-labelledby="soon-title">
      <div class="pt-list-head"><div class="pt-list-title"><h2 id="soon-title" class="pt-h2">Próximos 7 días</h2><span class="pt-count">${soon.length}</span></div></div>
      ${soon.length ? rows(soon, "soon") : `<p class="pt-fine">${loadingAny ? "Cargando…" : "Sin nada programado hasta el " + fmtDate(addDays(today, 7), true) + "."}</p>`}
    </section>` : ""}

    ${numbers(ctx, today)}

    ${connected.length ? `<section class="live-pending" aria-label="Qué falta conectar">${ctx.phaseGlyph(0.25, 32)}<div><p class="pt-h3">Todavía sin conectar: ${esc(connected.join(" y "))}</p><p class="pt-fine">Hasta que esas secciones estén conectadas, sus pendientes no aparecen acá salvo los que trae la agenda del sistema. No se muestran datos locales.</p></div></section>` : ""}`, "hoy");
}

// ---------- Los cinco números ----------

function numbers(ctx, today) {
  const { esc, fmtDate, failure, loading } = ctx;
  const f = ctx.state.filters.hoy;
  const range = periodRange(f.period, today);
  const key = rangeKey(range.from, range.to);
  const head = `<div class="pt-list-head"><div class="pt-list-title"><h2 id="numbers-title" class="pt-h2">Los 5 números</h2></div>
      ${ctx.can("reports:read") ? `<div class="pt-seg" role="group" aria-label="Período de los números">${PERIODS.map(([id, label]) => `<button type="button" data-action="filter" data-id="hoy.period" data-kind="${id}" aria-pressed="${f.period === id}">${label}</button>`).join("")}</div>` : ""}</div>`;
  if (!ctx.can("reports:read")) {
    return `<section class="${SECTION}" aria-labelledby="numbers-title">${head}<p class="pt-fine">Tu cuenta no tiene <span class="readout">reports:read</span>: no se muestran los cinco números. Se calculan en el servidor, no en el portal.</p></section>`;
  }
  const entry = ctx.repo.get("reports.indicators", key);
  const body = (data) => `
    <p class="pt-fine">Del ${fmtDate(range.from, true)} al ${fmtDate(range.to, true)} · días operativos en ${esc(data.timezone || "la zona del servidor")}${data.asOf ? ` · calculado ${esc(stamp(data.asOf))}` : ""}.</p>
    <dl class="pt-overview" style="--cols:5;margin-top:0" data-grid>${data.list.map((item) => {
      const value = item.restricted ? "—" : item.value === null ? "—" : item.key === "warm_share" ? `${item.value}%` : item.key === "collected" ? money(item.value) : String(item.value);
      const fine = item.restricted ? `Requiere ${item.requires || "billing:read"}` : item.key === "conversations" && item.openNow !== null ? `${item.unit}. Abiertas ahora: ${item.openNow}` : item.key === "proposals" && item.leads !== null ? `${item.unit} · ${item.leads} prospecto${item.leads === 1 ? "" : "s"}` : item.key === "collected" && item.priceCents !== null ? `Precio ${money(item.priceCents)} + mantenimiento ${money(item.maintenanceCents || 0)}` : item.key === "warm_share" && item.total !== null ? (item.total ? `${item.warm} de ${item.total} contactos nuevos` : "Sin contactos nuevos en el período") : item.unit;
      return `<div><dt>${esc(item.label)}</dt><dd><span class="pt-big"${item.key === "collected" ? " data-key" : ""}>${esc(value)}</span><span class="pt-fine">${esc(fine)}</span>${item.restricted ? "" : `<a class="pt-link live-drill" href="#hoy/${item.key}" aria-label="Ver las filas de ${esc(item.label)}">Ver las filas</a>`}</dd></div>`;
    }).join("")}</dl>
    <details class="live-defs"><summary>Cómo se calcula cada número</summary>
      <dl>${data.list.map((item) => `<div><dt>${esc(item.label)}</dt><dd>${item.restricted ? `Tu cuenta no tiene <span class="readout">${esc(item.requires || "billing:read")}</span>: el servidor no devuelve este número.` : `${esc(item.definition)} <span class="pt-meta readout">Fuente: ${esc(item.source)}</span>`}</dd></div>`).join("")}</dl>
      ${data.includesExamples ? '<p class="pt-fine">Incluye datos de ejemplo.</p>' : ""}
    </details>
    ${data.pipeline.restricted ? `<p class="pt-fine live-note">Prometido, propuesto y cobrado se informan por separado, pero tu cuenta no tiene <span class="readout">${esc(data.pipeline.requires)}</span>.</p>`
      : `<dl class="live-pipeline" aria-label="Prometido, propuesto y cobrado, por separado">
        <div><dt>Cobrado en el período</dt><dd class="readout">${money(data.pipeline.collectedCents || 0)}</dd></div>
        <div><dt>Prometido (cobros comprometidos)</dt><dd class="readout">${money(data.pipeline.promisedCents || 0)}</dd></div>
        <div><dt>Propuesto abierto</dt><dd class="readout">${money(data.pipeline.proposedOpenCents || 0)}</dd></div>
      </dl><p class="pt-fine">Solo lo cobrado es ingreso. Lo prometido y lo propuesto son lo que está en juego, y nunca se suman.</p>`}`;
  const content = entry.status === "error" ? failure(entry.error, { slice: "reports.indicators", key, title: "No pudimos cargar los números" })
    : entry.data === undefined ? loading("Calculando los números en el servidor…") : body(entry.data);
  return `<section class="${SECTION}" aria-labelledby="numbers-title">${head}<div aria-live="polite">${content}</div></section>`;
}

// ---------- Desglose de un número ----------

function drillDown(ctx, indicatorKey) {
  const { shell, crumbs, esc, icon, btn, emptyState, entryView, fmtDate } = ctx;
  const today = todayISO();
  const f = ctx.state.filters.hoy;
  const range = periodRange(f.period, today);
  const rKey = rangeKey(range.from, range.to);
  const meta = INDICATORS.find((item) => item.key === indicatorKey);
  const indicators = ctx.can("reports:read") ? ctx.repo.get("reports.indicators", rKey).data : null;
  const info = indicators?.list.find((item) => item.key === indicatorKey);
  const period = PERIODS.find(([id]) => id === f.period)?.[1] || "";
  const needs = indicatorKey === "collected" ? "billing:read" : "leads:read";
  const crumbTrail = crumbs([["Operación", "#hoy"], ["Hoy", "#hoy"], [meta.label]]);

  const header = `${crumbTrail}
    <div class="pt-kicker"><span class="label">Los 5 números · ${esc(period)}</span><span class="label">${fmtDate(range.from, true)} – ${fmtDate(range.to, true)}</span></div>
    <h1 class="display pt-title">${esc(meta.label)}</h1>
    ${info ? `<p class="pt-company">${esc(info.definition)}</p><p class="pt-fine"><span class="readout">Fuente: ${esc(info.source)}</span></p>` : ""}
    <div class="pt-filters"><div class="pt-seg" role="group" aria-label="Período">${PERIODS.map(([id, label]) => `<button type="button" data-action="filter" data-id="hoy.period" data-kind="${id}" aria-pressed="${f.period === id}">${label}</button>`).join("")}</div><a class="pt-link" href="#hoy">${icon("back")} Volver a Hoy</a></div>`;

  if (!ctx.can("reports:read")) return shell(`${header}${ctx.forbidden("reports:read", "los números")}`, "hoy");
  if (!ctx.can(needs)) return shell(`${header}${ctx.forbidden(needs, "las filas de este número")}`, "hoy");

  const key = itemsKey(indicatorKey, rKey);
  const entry = ctx.repo.get("reports.items", key);
  const projects = ctx.repo.data("projects")?.list || [];
  const leads = ctx.repo.data("planner.leads")?.list || [];
  const leadLink = (id, name) => `<a class="pt-row-name" href="#prospectos/${encodeURIComponent(id)}">${esc(name || leads.find((lead) => lead.id === id)?.name || `Prospecto #${shortId(id)}`)}</a>`;

  const list = (data) => {
    if (!data.items.length) return emptyState("Sin filas en este período", "El servidor no encontró nada que cuente para este número. Probá con un período más largo.", "");
    const more = `<nav class="pagination" aria-label="Más filas"><span class="pt-fine">${data.items.length} fila${data.items.length === 1 ? "" : "s"} cargada${data.items.length === 1 ? "" : "s"}${data.nextCursor ? " · hay más" : ""}</span>${data.nextCursor ? btn("live-more", entry.refreshing ? "Cargando…" : "Cargar más", "btn-ghost", `data-id="reports.items" data-kind="${esc(key)}" ${entry.refreshing ? "disabled" : ""}`) : ""}</nav>`;
    if (indicatorKey === "collected") {
      const cols = "minmax(0,.8fr) minmax(0,1.4fr) minmax(0,.9fr) minmax(0,.8fr)";
      return `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Cobrado el</span><span class="label">Proyecto</span><span class="label">Tipo</span><span class="label">USD</span></div>
        <ul class="pt-rows">${data.items.map((row) => `<li class="pt-row" style="--cols:${cols}"><div class="pt-date">${fmtDate(row.date, true)}<small class="log-time">Hora no registrada</small></div>
          <div><a class="pt-row-name" href="#proyectos/${encodeURIComponent(row.projectId)}">${esc(projects.find((project) => project.id === row.projectId)?.name || `Proyecto #${shortId(row.projectId)}`)}</a></div>
          <div>${esc({ deposit: "Seña", installment: "Cuota", final: "Saldo final", maintenance: "Mantenimiento" }[row.paymentKind] || row.paymentKind)}${row.countsTowardBalance ? "" : '<span class="pt-meta">no baja el saldo</span>'}</div>
          <div class="readout">${row.amountCents === null ? "—" : money(row.amountCents)}</div></li>`).join("")}</ul>${more}`;
    }
    if (indicatorKey === "proposals") {
      const cols = "minmax(0,.8fr) minmax(0,1.6fr) minmax(0,.8fr)";
      return `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Enviada el</span><span class="label">Prospecto</span><span class="label">Monto</span></div>
        <ul class="pt-rows">${data.items.map((row) => `<li class="pt-row" style="--cols:${cols}"><div class="pt-date">${fmtDate(row.date, true)}<small class="log-time">Hora no registrada</small></div><div>${leadLink(row.leadId, "")}</div><div class="readout">${row.amountCents === null ? "Sin monto" : money(row.amountCents)}</div></li>`).join("")}</ul>${more}`;
    }
    const cols = "minmax(0,1.4fr) minmax(0,.9fr) minmax(0,.9fr) minmax(0,.9fr)";
    return `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Prospecto</span><span class="label">Fuente</span><span class="label">Primer contacto</span><span class="label">Conversación</span></div>
      <ul class="pt-rows">${data.items.map((row) => `<li class="pt-row" style="--cols:${cols}"><div>${leadLink(row.leadId, row.name)}</div><div>${esc(row.sourceLabel)}${row.warm ? '<span class="pt-meta">Tibio</span>' : ""}</div><div class="pt-date">${row.firstContactOn ? fmtDate(row.firstContactOn, true) : "—"}</div><div class="pt-date">${row.firstConversationOn ? fmtDate(row.firstConversationOn, true) : "—"}</div></li>`).join("")}</ul>${more}`;
  };
  return shell(`${header}<section class="${SECTION}" style="margin-top:28px" aria-label="Filas de ${esc(meta.label)}" aria-live="polite">${entryView(entry, { slice: "reports.items", key, label: "No pudimos cargar las filas", render: list })}</section>
    <p class="pt-fine live-note">Estas son las filas que el servidor contó para el número. ${indicatorKey === "collected" ? "El servidor guarda el día del cobro, no la hora." : "Los prospectos se abren en Prospectos cuando esa sección esté conectada."}</p>`, "hoy");
}
