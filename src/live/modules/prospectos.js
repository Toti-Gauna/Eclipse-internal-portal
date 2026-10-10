// Prospectos (leads) en modo live: lista con filtros del servidor y paginación por cursor, ficha con historial, camino a la seña,
// auditoría y las acciones de estado. La pantalla solo lee del repositorio; los envíos viven en prospectos-forms.js.
// El pipeline es del servidor: etapas, responsable, próxima acción con fecha, consentimiento y duplicados se hacen cumplir allá.
import { todayISO } from "../../rules.js";
import { formatCents as money, shortId } from "../adapters/common.js";
import {
  AUDIT_LABELS, LEAD_STAGE_HINTS, SOURCES, STAGE_CHIPS, STAGE_POSITION, adaptActivity, adaptAuditEvent, adaptLead, auditChange, contactLine, lastProposal,
  leadQuery, keyQuery, ownerLabel, queryKey, railDates, ruleNextAction, stageBeforePause, visibleInChip,
} from "../adapters/crm.js";
import forms from "./prospectos-forms.js";
import { ensureCrmStyles } from "./crm-styles.js";

const PAGE = 20;
const MATCH_LABELS = { email: "mismo email", phone: "mismo teléfono", name_company: "mismo nombre y empresa" };
const PATH = [["prospect", "Prospecto"], ["conversation", "Conversación"], ["demo", "Demo"], ["proposal", "Propuesta"], ["won", "Ganado · proyecto"]];

ensureCrmStyles();

// Última lista que se mostró con sus filtros (menos la búsqueda): mientras llega la de una búsqueda nueva se sigue mostrando esa, atenuada.
let shown = { key: "", rest: "" };
let searchTimer = null;
let lastSearch = null;

const restOf = (query) => queryKey(Object.fromEntries(Object.entries(query).filter(([name]) => name !== "q")));
export const listQuery = (ctx) => leadQuery(ctx.state.filters.prospectos, { adminId: ctx.admin?.id || "" });
export const listKey = (ctx) => queryKey(listQuery(ctx));

export default {
  id: "prospectos",
  label: "Prospectos",
  nav: { order: 30, area: "main" },
  status: "live",
  permission: "leads:read",
  filters: { prospectos: { q: "", stage: "activos", owner: "", source: "", warm: "", overdue: "", createdFrom: "", createdTo: "", dup: "", order: "asc" } },
  ...forms,

  slices: {
    leads: {
      permission: "leads:read",
      forbiddenValue: { items: [], nextCursor: null },
      load: async ({ api, signal }, key) => {
        const page = await api.get("/admin/leads", { query: { ...keyQuery(key), limit: PAGE }, signal });
        return { items: page.leads.map(adaptLead), nextCursor: page.nextCursor || null };
      },
      more: async ({ api }, key, current) => {
        if (!current.nextCursor) return current;
        const page = await api.get("/admin/leads", { query: { ...keyQuery(key), limit: PAGE, cursor: current.nextCursor } });
        const known = new Set(current.items.map((lead) => lead.id));
        return { items: [...current.items, ...page.leads.filter((lead) => !known.has(lead.id)).map(adaptLead)], nextCursor: page.nextCursor || null };
      },
    },
    lead: {
      permission: "leads:read",
      load: async ({ api, signal }, id) => adaptLead((await api.get(`/admin/leads/${id}`, { signal })).lead),
    },
    "lead.activities": {
      permission: "leads:read",
      forbiddenValue: { items: [], truncated: false },
      load: async ({ api, signal }, id) => {
        const { items, truncated } = await api.listAll(`/admin/leads/${id}/activities`, { key: "activities", maxPages: 6, signal });
        // La API entrega lo más nuevo primero; el modelo del portal es cronológico (del primer contacto al más reciente).
        return { items: items.map(adaptActivity).reverse(), truncated };
      },
    },
    "lead.audit": {
      permission: "leads:read",
      forbiddenValue: { items: [], truncated: false },
      load: async ({ api, signal }, id) => {
        const { items, truncated } = await api.listAll(`/admin/leads/${id}/audit`, { key: "events", maxPages: 4, signal });
        return { items: items.map(adaptAuditEvent), truncated };
      },
    },
  },

  prepare(ctx, route) {
    clearTimeout(searchTimer);
    const { repo, can } = ctx;
    if (can("leads:write")) repo.ensure("batches").catch(() => {});
    if (route.id) {
      repo.ensure("lead", route.id).then((lead) => {
        // Los candidatos a duplicado se muestran con nombre: se piden de a uno (son pocos).
        for (const candidate of lead.possibleDuplicates.slice(0, 5)) repo.ensure("lead", candidate.id).catch(() => {});
        if (lead.batchId) repo.ensure("batch", lead.batchId).catch(() => {});
      }).catch(() => {});
      repo.ensure("lead.activities", route.id).catch(() => {});
      return;
    }
    const key = listKey(ctx);
    const search = (ctx.state.filters.prospectos.q || "").trim();
    const load = () => repo.ensure("leads", key).catch(() => {});
    // Escribir en el buscador no dispara un pedido por tecla.
    if (search && search !== lastSearch) searchTimer = setTimeout(load, 350);
    else load();
    lastSearch = search;
  },

  badge() { return null; },

  render(ctx, route) {
    return route.id ? detail(ctx, route.id) : list(ctx);
  },
};

// ---------- Piezas ----------

/** El mismo marcador de etapa del modo demostración (vidrio de fase + «n de 5»), con las etapas del servidor. */
function stageMark(ctx, lead, { layout = "inline", size = 18, position } = {}) {
  const pos = position === undefined ? STAGE_POSITION[lead.stage] : position;
  const muted = ["lost", "paused"].includes(lead.stage);
  const { esc, phaseGlyph } = ctx;
  return `<span class="pt-stage" data-layout="${layout}"${muted ? " data-muted" : ""}>
    ${phaseGlyph(lead.stage === "lost" ? 0 : (pos || 0) / 5, size, "pt-stage-glyph")}
    <span class="pt-stage-text">${pos && !muted ? `<span class="pt-stage-pos">${pos} de 5</span><span class="pt-stage-sep"> · </span>` : ""}<span class="pt-stage-name">${esc(lead.stageLabel)}</span></span>
  </span>`;
}

const ownerText = (ctx, id) => ownerLabel(id, ctx.admin?.id);

function nextOf(lead) {
  if (lead.open && lead.nextAction) return { title: lead.nextAction, due: lead.nextActionOn };
  if (lead.stage === "paused") return { title: "Revisar la pausa", due: lead.reviewOn };
  return null;
}

// ---------- Lista ----------

function list(ctx) {
  const { shell, crumbs, esc, icon, btn, openLink, emptyState, entryView, dueTag, loading } = ctx;
  const f = ctx.state.filters.prospectos;
  const query = listQuery(ctx);
  const key = queryKey(query);
  const entry = ctx.repo.get("leads", key);
  const canWrite = ctx.can("leads:write");
  const canExport = ctx.can("leads:export");
  const today = todayISO();

  // Mientras llega una búsqueda nueva se sigue mostrando la anterior (mismos filtros, otro texto).
  let view = entry;
  let stale = false;
  if (entry.data !== undefined) shown = { key, rest: restOf(query) };
  else if (shown.key && shown.rest === restOf(query) && ctx.repo.get("leads", shown.key).data !== undefined) { view = ctx.repo.get("leads", shown.key); stale = true; }

  const cols = "minmax(0,1.5fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr) minmax(0,1.4fr) auto";
  const body = (data) => {
    const rows = data.items.filter((lead) => visibleInChip(lead, f.stage));
    const hidden = data.items.length - rows.length;
    return `${rows.length ? `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Prospecto</span><span class="label">Etapa</span><span class="label">Fuente</span><span class="label">${ctx.can("billing:read") ? "Presupuesto" : "Responsable"}</span><span class="label">Próxima acción</span><span></span></div>
      <ul class="pt-rows">${rows.map((lead) => {
        const next = nextOf(lead);
        const href = `#prospectos/${encodeURIComponent(lead.id)}`;
        return `<li class="pt-row" style="--cols:${cols}"${next?.due && next.due < today ? " data-late" : next?.due === today ? " data-turn" : ""}>
          <div><a class="pt-row-name" href="${href}">${esc(lead.name)}</a><span class="pt-meta">${esc(lead.company || contactLine(lead))} · ${esc(lead.channelLabel)}</span>${lead.doNotContact ? '<span class="pt-tag pt-tag-late live-tag">No contactar</span>' : ""}</div>
          <div>${stageMark(ctx, lead, { layout: "stack" })}</div>
          <div><span class="pt-cell-label label">Fuente</span>${esc(lead.sourceLabel)}${lead.warm ? '<span class="pt-meta">Tibio</span>' : ""}</div>
          <div><span class="pt-cell-label label">${ctx.can("billing:read") ? "Presupuesto" : "Responsable"}</span>${ctx.can("billing:read") ? (lead.budgetCents ? `<span class="readout">${money(lead.budgetCents)}</span>` : '<span class="pt-meta" style="margin:0">—</span>') : esc(ownerText(ctx, lead.ownerAdminId))}</div>
          <div><span class="pt-cell-label label">Próxima acción</span>${next ? `${esc(next.title)}${next.due ? `<div style="margin-top:6px">${dueTag(next.due)}</div>` : ""}` : `<span class="pt-meta" style="margin:0">${lead.stage === "won" ? "Es proyecto" : lead.stage === "lost" ? "Cerrado" : "—"}</span>`}</div>
          <div class="pt-row-end">${openLink(href)}</div>
        </li>`;
      }).join("")}</ul>` : emptyState(data.items.length ? "Ninguno de los cargados coincide" : "Sin prospectos con estos filtros", data.items.length ? "Los perdidos no se muestran en «Activos». Cargá más o cambiá el filtro." : "Cambiá el filtro o cargá uno nuevo.", canWrite && !data.items.length ? btn("new-prospect", `${icon("plus")} Prospecto`, "btn-ink") : "")}
      <nav class="pagination" aria-label="Más prospectos"><span class="pt-fine">${data.items.length} cargado${data.items.length === 1 ? "" : "s"}${hidden ? ` · ${hidden} perdido${hidden === 1 ? "" : "s"} oculto${hidden === 1 ? "" : "s"}` : ""}${data.nextCursor ? " · hay más" : ""} · más nuevos primero</span>${data.nextCursor ? btn("live-more", entry.refreshing ? "Cargando…" : "Cargar más", "btn-ghost", `data-id="leads" data-kind="${esc(key)}" ${entry.refreshing ? "disabled" : ""}`) : ""}</nav>`;
  };

  const options = (pairs, selected, empty) => `<option value="">${esc(empty)}</option>${pairs.map(([value, label]) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`).join("")}`;
  const toggle = (name, label, on) => `<button type="button" class="btn btn-sm btn-ghost live-toggle" data-action="filter" data-id="prospectos.${name}" data-kind="${on ? "" : "1"}" aria-pressed="${on}">${esc(label)}</button>`;

  return shell(`${crumbs([["Operación", "#hoy"], ["Prospectos"]])}
    <div class="pt-head-row"><div>
      <div class="pt-kicker"><span class="label">Pipeline · servidor</span></div>
      <h1 class="display pt-title">Del contacto a la <em>seña</em>.</h1>
      <p class="pt-company">Responde → llamada el mismo día → propuesta en ≤24 h → toques a +2, +5 y +9 días. Cada prospecto tiene responsable y una próxima acción con fecha. «Ganado» solo existe al convertirlo en proyecto.</p>
    </div><div class="pt-head-actions">${canExport ? btn("leads-export", "Exportar CSV", "btn-ghost", `data-kind="${esc(key)}"`) : ""}${canWrite ? btn("new-prospect", `${icon("plus")} Prospecto`, "btn-primary") : '<span class="pt-fine">Cargar prospectos requiere <span class="readout">leads:write</span>.</span>'}</div></div>

    <div class="pt-filters">
      <div class="pt-seg" role="group" aria-label="Etapa">${STAGE_CHIPS.map(([id, label]) => `<button type="button" data-action="filter" data-id="prospectos.stage" data-kind="${id}" aria-pressed="${f.stage === id}">${esc(label)}</button>`).join("")}</div>
    </div>
    <div class="pt-filters" style="margin-top:12px">
      <label class="sr-only" for="f-search">Buscar prospecto</label><input id="f-search" class="pt-search" type="search" maxlength="100" placeholder="Buscar por nombre, empresa, email, teléfono o usuario" value="${esc(f.q)}" data-filter="prospectos.q" autocomplete="off">
      <label class="sr-only" for="f-owner">Responsable</label><select id="f-owner" class="pt-select" data-filter="prospectos.owner">${options([["me", "Mis prospectos"]], f.owner, "Todos los responsables")}</select>
      <label class="sr-only" for="f-source">Fuente</label><select id="f-source" class="pt-select" data-filter="prospectos.source">${options(Object.entries(SOURCES), f.source, "Todas las fuentes")}</select>
      ${toggle("warm", "Solo tibios", f.warm === "1")}${toggle("overdue", "Acción vencida", f.overdue === "1")}
    </div>
    <details class="live-more-filters"${f.createdFrom || f.createdTo || f.dup ? " open" : ""}><summary>Más filtros</summary>
      <div class="pt-filters" style="margin-top:12px">
        <label class="live-inline-label" for="f-from">Alta desde</label><input id="f-from" class="pt-select" type="date" data-filter="prospectos.createdFrom" value="${esc(f.createdFrom)}">
        <label class="live-inline-label" for="f-to">hasta</label><input id="f-to" class="pt-select" type="date" data-filter="prospectos.createdTo" value="${esc(f.createdTo)}">
        ${toggle("dup", "Mostrar duplicados marcados", f.dup === "1")}
      </div>
    </details>
    <p class="pt-fine live-note">La unidad (Agency, Media, Market) y la oferta sugerida por prospecto no las guarda el servidor, por eso no hay filtro ni columna. Las propuestas se registran como actividad, con su monto.</p>

    <section class="pt-list${stale ? " live-stale-list" : ""}" style="margin-top:28px" aria-label="Prospectos" aria-live="polite" aria-busy="${stale || entry.refreshing}">
      ${stale ? '<p class="pt-fine" role="status">Buscando…</p>' : ""}
      ${entryView(view, { slice: "leads", key, label: "No pudimos cargar los prospectos", render: body })}
    </section>`, "prospectos");
}

// ---------- Ficha ----------

function detail(ctx, id) {
  const { shell, crumbs, emptyState, icon, entryView } = ctx;
  const entry = ctx.repo.get("lead", id);
  if (entry.status === "error" && entry.error?.status === 404) {
    return shell(`${crumbs([["Prospectos", "#prospectos"], ["No encontrado"]])}${emptyState("No existe ese prospecto", "", `<a class="pt-link" href="#prospectos">${icon("back")} Volver a prospectos</a>`)}`, "prospectos");
  }
  return shell(`${crumbs([["Operación", "#hoy"], ["Prospectos", "#prospectos"], [entry.data?.name || "Prospecto"]])}${entryView(entry, { slice: "lead", key: id, label: "No pudimos cargar el prospecto", render: (lead) => ficha(ctx, lead) })}`, "prospectos");
}

function ficha(ctx, lead) {
  const { esc, icon, btn, phaseGlyph, fmtDate, dateTime, dueTag, openLink } = ctx;
  const activitiesEntry = ctx.repo.get("lead.activities", lead.id);
  const activities = activitiesEntry.data?.items || [];
  const f = ctx.state.filters.prospectos;
  const batch = lead.batchId ? ctx.repo.data("batch", lead.batchId) : null;
  const canWrite = ctx.can("leads:write");
  const canConvert = canWrite && ctx.can("projects:write") && ctx.can("billing:write");
  const proposal = lastProposal(activities);
  const rule = activitiesEntry.data ? ruleNextAction(lead, activities) : null;
  const before = lead.stage === "paused" ? stageBeforePause(activities) : null;
  const position = lead.stage === "paused" ? STAGE_POSITION[before || "prospect"] : STAGE_POSITION[lead.stage];
  const muted = ["lost", "paused"].includes(lead.stage);
  const a = `data-id="${esc(lead.id)}"`;
  const act = (kind, label, cls = "btn-ghost") => btn("lead-activity", label, cls, `${a} data-kind="${kind}"`);
  const stage = (kind, label, cls = "btn-ghost") => btn("lead-stage", label, cls, `${a} data-kind="${kind}"`);
  const next = nextOf(lead);

  const primary = !canWrite ? [] : ({
    prospect: [act("reply", "Respondió", "btn-ink")],
    conversation: [act("call", "Llamada hecha", "btn-ink"), act("demo", "Demo hecha"), act("proposal", "Propuesta enviada")],
    demo: [act("proposal", "Propuesta enviada", "btn-ink"), act("call", "Llamada hecha")],
    proposal: [canConvert ? btn("convert-lead", "Convertir en proyecto", "btn-primary", a) : "", act("touch", "Toque hecho")],
    negotiation: [canConvert ? btn("convert-lead", "Convertir en proyecto", "btn-primary", a) : "", act("touch", "Toque hecho")],
    paused: [stage("move", "Reactivar", "btn-ink")],
    lost: [stage("move", "Reactivar")],
    won: [],
  }[lead.stage] || []);
  const closing = canWrite && lead.open ? [stage("paused", "Pausar"), stage("lost", "Perdido", "btn-danger")] : [];
  const wonLink = lead.stage === "won" && lead.projectId ? [openLink(`#proyectos/${encodeURIComponent(lead.projectId)}`, "Ver proyecto")] : [];

  const contactRows = [lead.email && ["Email", lead.email], lead.phone && ["Teléfono", lead.phone], lead.handle && ["Usuario o enlace", lead.handle]].filter(Boolean);
  const duplicates = lead.possibleDuplicates.map((candidate) => ({ ...candidate, lead: ctx.repo.data("lead", candidate.id) }));

  const rail = `<ol class="pt-rail">${PATH.map(([id, name], i) => {
    const n = i + 1;
    const dates = railDates(lead, activities);
    const done = lead.stage === "won" ? true : position ? n < position : false;
    const status = done ? "done" : n === position ? (lead.stage === "paused" ? "paused" : "current") : "pending";
    const label = id === "proposal" && lead.stage === "negotiation" ? "Negociación" : name;
    const text = dates[id] ? `${status === "current" ? "<strong>Ahora</strong> · " : ""}desde ${fmtDate(dates[id])}` : status === "current" ? "<strong>Ahora</strong>" : status === "paused" ? "<strong>En pausa</strong>" : "Pendiente";
    return `<li class="pt-rail-step" data-status="${status}"><span class="pt-rail-mark">${phaseGlyph(n / 5, 28)}</span><span class="pt-rail-n">${n} de 5</span><span class="pt-rail-name">${esc(label)}</span><span class="pt-rail-status">${text}</span></li>`;
  }).join("")}</ol>`;

  const ordered = (f.order === "desc" ? [...activities].reverse() : activities);
  const history = activitiesEntry.status === "error" ? ctx.failure(activitiesEntry.error, { slice: "lead.activities", key: lead.id, title: "No pudimos cargar el historial" })
    : activitiesEntry.data === undefined ? ctx.loading("Cargando el historial…")
    : ordered.length ? `<ol class="pt-log" style="margin-top:24px">${ordered.map((activity) => logItem(ctx, lead, activity, canWrite)).join("")}</ol>${activitiesEntry.data.truncated ? '<p class="pt-fine" role="status">El historial es más largo de lo que se carga acá (se muestran los 300 más recientes).</p>' : ""}`
    : '<p class="pt-fine">Todavía no hay actividad registrada.</p>';

  const audit = ctx.repo.get("lead.audit", lead.id);
  const auditBlock = audit.status === "error" ? ctx.failure(audit.error, { slice: "lead.audit", key: lead.id, title: "No pudimos cargar la auditoría" })
    : audit.data !== undefined ? `<ol class="live-audit">${audit.data.items.map((event) => `<li><span class="pt-date">${fmtDate(event.date, true)}<small class="log-time">${esc(event.time || "")}</small></span><span><strong>${esc(AUDIT_LABELS[event.action] || event.action)}</strong>${auditChange(event) ? ` · ${esc(auditChange(event))}` : ""}<span class="pt-meta">${event.actorKind === "admin" ? esc(ownerText(ctx, event.actorId)) : esc(event.actorKind === "system" ? "Sistema" : "Cliente")}${event.result !== "success" ? ` · ${esc(event.result)}` : ""}</span></span></li>`).join("")}</ol>${audit.data.truncated ? '<p class="pt-fine">Se muestran los eventos más recientes.</p>' : ""}`
    : audit.status === "loading" ? ctx.loading("Cargando la auditoría…")
    : `<p class="pt-fine">Registro de cada cambio con quién y cuándo. No se puede editar.</p>${btn("lead-audit-load", "Ver auditoría", "btn-ghost", a)}`;

  const batches = ctx.repo.data("batches")?.items || [];
  const batchName = batch?.name || batches.find((item) => item.id === lead.batchId)?.name || (lead.batchId ? `Lote #${shortId(lead.batchId)}` : "");
  const batchOpen = (batch || batches.find((item) => item.id === lead.batchId))?.open !== false;

  return `
    <p class="pt-detail-meta"><span class="pt-detail-code">#${esc(shortId(lead.id))}</span><span>${esc(lead.sourceLabel)}${lead.sourceDetail ? ` · ${esc(lead.sourceDetail)}` : ""}${lead.warm ? " · tibio" : ""}</span><span>Alta ${fmtDate(lead.firstContactOn, true)}</span>${lead.isExample ? '<span class="badge-demo">Ejemplo</span>' : ""}</p>
    <h1 class="display pt-title">${esc(lead.name)}</h1>
    <p class="pt-company">${esc(lead.need)}</p>
    ${lead.duplicateOfId ? `<p class="generator-warning" role="note">Marcado como duplicado de <a class="pt-link" style="min-height:0" href="#prospectos/${encodeURIComponent(lead.duplicateOfId)}">otro prospecto</a>. No se mezcló ni se borró nada: el historial queda acá.</p>` : ""}
    ${lead.doNotContact ? `<p class="generator-warning" role="note"><strong>No contactar.</strong> El consentimiento está ${lead.consent.status === "denied" ? "rechazado" : "retirado"}: el servidor no deja registrar contactos salientes ni sumarlo a un lote. Lo entrante y las notas siguen.</p>` : ""}

    <div class="pt-top">
      <section class="pt-current ticks"${muted ? " data-muted" : ""} aria-label="Etapa actual">
        <div class="pt-dial">${phaseGlyph(lead.stage === "lost" ? 0 : (position || 0) / 5, 44)}<p class="pt-dial-pos">${position && lead.stage !== "lost" && lead.stage !== "paused" ? `${position}<span>/5</span>` : "—"}</p></div>
        <div>
          <span class="label">Etapa actual</span>
          <p class="pt-current-name">${esc(lead.stageLabel)}</p>
          <p class="pt-current-short">${esc(LEAD_STAGE_HINTS[lead.stage] || "")}</p>
          ${lead.stage === "paused" ? `<div class="pt-pause"><p class="pt-pause-title">En pausa${lead.reviewOn ? ` · revisar el ${fmtDate(lead.reviewOn, true)}` : ""}</p><p>${esc(lead.stageReason || "Sin motivo registrado.")}</p></div>` : ""}
          ${lead.stage === "lost" && lead.stageReason ? `<div class="pt-pause"><p class="pt-pause-title">Motivo</p><p>${esc(lead.stageReason)}</p></div>` : ""}
          <dl class="pt-dl">
            <div><dt>Propuesta</dt><dd>${proposal ? `${proposal.amountCents ? `<span class="readout">${money(proposal.amountCents)}</span> · ` : ""}${fmtDate(proposal.date)}` : activitiesEntry.data ? "Sin enviar" : "…"}</dd></div>
            <div><dt>Presupuesto del cliente</dt><dd>${ctx.can("billing:read") ? (lead.budgetCents ? `<span class="readout">${money(lead.budgetCents)}</span>` : "Sin cargar") : "Tu cuenta no ve importes (billing:read)"}</dd></div>
            <div><dt>Contacto</dt><dd>${contactRows.length ? contactRows.map(([, value]) => esc(value)).join(" · ") : "—"} <span class="pt-meta" style="display:inline">${esc(lead.channelLabel)}</span></dd></div>
          </dl>
          <div class="pt-actions">${[...primary, ...wonLink, ...closing].join("")}</div>
          ${canWrite ? "" : '<p class="pt-fine">Tu cuenta puede leer prospectos pero no modificarlos (falta <span class="readout">leads:write</span>).</p>'}
        </div>
      </section>
      <aside class="pt-side">
        <section class="pt-box"${next?.due && next.due < todayISO() ? " data-late" : next?.due === todayISO() ? " data-turn" : ""}>
          <div class="pt-box-head"><span class="label">Próxima acción</span>${next?.due ? dueTag(next.due) : ""}</div>
          <p class="pt-box-title">${next ? esc(next.title) : lead.stage === "won" ? "Es proyecto" : "Sin acción pendiente"}</p>
          <p class="pt-fine">${next?.due ? `Vence ${fmtDate(next.due, true)} · responsable: ${esc(ownerText(ctx, lead.ownerAdminId))}.` : `Responsable: ${esc(ownerText(ctx, lead.ownerAdminId))}.`}</p>
          ${rule && rule.title !== next?.title ? `<p class="pt-fine live-rule"><strong>Regla de la casa:</strong> ${esc(rule.title)}${rule.due ? ` · ${fmtDate(rule.due, true)}` : ""}</p>` : ""}
          ${canWrite && lead.open ? `<div class="pt-actions">${btn("lead-edit", "Editar acción", "btn-ghost", `${a} data-kind="next"`)}</div>` : ""}
        </section>
        <section class="pt-box">
          <span class="label">Nota rápida</span>
          <p class="pt-box-text">Objeciones, contexto de la llamada, lo que pidió.</p>
          ${canWrite ? `<div class="pt-actions">${act("note", "Agregar nota")}${act("other", "Registrar actividad")}</div>` : ""}
        </section>
      </aside>
    </div>

    <section class="pt-timeline" aria-labelledby="rail-title"><h2 id="rail-title" class="pt-h2">Camino a la seña</h2>${rail}<p class="pt-fine">Un prospecto pasa a proyecto solo al convertirlo, con acuerdo y seña cobrada. Las fechas salen del historial.</p></section>

    <div class="pt-bottom">
      <section aria-labelledby="log-title">
        <div class="pt-section-head"><h2 id="log-title" class="pt-h2">Historial</h2><span class="pt-count">${activities.length}</span></div>
        <p class="pt-fine">El historial no se edita: una corrección es una entrada nueva, y lo anulado queda con su motivo. La hora solo aparece si se registró.</p>
        <div class="pt-filters" style="margin-top:12px"><div class="pt-seg" role="group" aria-label="Orden del historial">${[["asc", "Más antiguo primero"], ["desc", "Más nuevo primero"]].map(([key, label]) => `<button type="button" data-action="filter" data-id="prospectos.order" data-kind="${key}" aria-pressed="${f.order === key}">${label}</button>`).join("")}</div></div>
        <div aria-live="polite">${history}</div>
        <div class="pt-section-head" style="margin-top:40px"><h2 class="pt-h2">Auditoría</h2></div>
        <div aria-live="polite">${auditBlock}</div>
      </section>
      <aside class="pt-facts" aria-label="Datos del prospecto">
        <span class="label">Datos del prospecto</span>
        <dl class="pt-dl">
          ${contactRows.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}
          <div><dt>Canal</dt><dd>${esc(lead.channelLabel)}</dd></div>
          <div><dt>Fuente</dt><dd>${esc(lead.sourceLabel)}${lead.sourceDetail ? ` · ${esc(lead.sourceDetail)}` : ""}${lead.warm ? " · tibio" : ""}</dd></div>
          ${lead.company ? `<div><dt>Empresa</dt><dd>${esc(lead.company)}</dd></div>` : ""}
          ${lead.vertical ? `<div><dt>Rubro</dt><dd>${esc(lead.vertical)}</dd></div>` : ""}
          <div><dt>Idioma</dt><dd>${esc({ es: "Español", en: "Inglés", pt: "Portugués" }[lead.language] || lead.language)}</dd></div>
          <div><dt>Responsable</dt><dd>${esc(ownerText(ctx, lead.ownerAdminId))}</dd></div>
          <div><dt>Consentimiento</dt><dd>${esc(lead.consentLabel)}${lead.consent.on ? ` · ${fmtDate(lead.consent.on, true)}` : ""}${lead.consent.basis ? `<span class="pt-meta">${esc(lead.consent.basis)}</span>` : ""}</dd></div>
          ${lead.batchId ? `<div><dt>Lote</dt><dd><a class="pt-link" style="min-height:0" href="#lotes/${encodeURIComponent(lead.batchId)}">${esc(batchName)}</a></dd></div>` : ""}
          ${lead.planRequestId ? `<div><dt>Origen</dt><dd><a class="pt-link" style="min-height:0" href="#solicitudes/${encodeURIComponent(lead.planRequestId)}">Solicitud de plan</a></dd></div>` : ""}
          <div><dt>Primer contacto</dt><dd class="pt-date">${fmtDate(lead.firstContactOn, true)}</dd></div>
          ${lead.firstConversationOn ? `<div><dt>Primera respuesta</dt><dd class="pt-date">${fmtDate(lead.firstConversationOn, true)}</dd></div>` : ""}
          ${lead.commercialNotes ? `<div><dt>Notas comerciales</dt><dd class="live-prewrap">${esc(lead.commercialNotes)}</dd></div>` : ""}
        </dl>
        ${duplicates.length && !lead.duplicateOfId ? `<section class="pt-box live-dups" aria-label="Posibles duplicados"><span class="label">Posibles duplicados</span><p class="pt-fine">Mismo contacto en otro prospecto. Nunca se mezclan solos: decidís vos.</p><ul>${duplicates.map((candidate) => `<li><a class="pt-link" style="min-height:0" href="#prospectos/${encodeURIComponent(candidate.id)}">${esc(candidate.lead?.name || `#${shortId(candidate.id)}`)}</a><span class="pt-meta">${esc(candidate.matchedOn.map((m) => MATCH_LABELS[m] || m).join(" · "))}${candidate.lead ? ` · ${esc(candidate.lead.stageLabel)}` : ""}</span>${canWrite && lead.stage !== "won" ? btn("lead-duplicate", "Es duplicado de este", "btn-ghost", `${a} data-kind="${esc(candidate.id)}"`) : ""}</li>`).join("")}</ul></section>` : ""}
        ${canWrite ? `<div class="live-side-actions"><span class="label">Acciones</span>
          ${lead.stage !== "won" ? btn("lead-edit", "Editar datos", "btn-ghost", `${a} data-kind="data"`) : ""}
          ${lead.stage !== "won" ? btn("lead-consent", "Consentimiento", "btn-ghost", a) : ""}
          ${lead.open && !["proposal", "negotiation"].includes(lead.stage) && canConvert ? btn("convert-lead", "Convertir en proyecto", "btn-ghost", a) : ""}
          ${lead.open && lead.stage !== "negotiation" ? stage("move", "Cambiar de etapa") : ""}
          ${lead.open && !lead.doNotContact && !lead.batchId ? btn("lead-batch", "Sumar a un lote", "btn-ghost", a) : ""}
          ${lead.batchId && batchOpen ? btn("lead-batch-remove", "Sacar del lote", "btn-ghost", `${a} data-kind="${esc(lead.batchId)}"`) : ""}
          ${lead.open && !lead.duplicateOfId ? btn("lead-duplicate", "Marcar como duplicado", "btn-ghost", `${a} data-kind=""`) : ""}
        </div>${lead.open && !canConvert ? '<p class="pt-fine">Convertir en proyecto requiere <span class="readout">leads:write</span>, <span class="readout">projects:write</span> y <span class="readout">billing:write</span>.</p>' : ""}` : ""}
        <p class="pt-fine live-note">Los prospectos no se borran: un cierre queda como «Perdido» con su motivo, y un duplicado queda apuntando al principal.</p>
        <a class="pt-link" href="#prospectos">${icon("back")} Volver a prospectos</a>
      </aside>
    </div>`;
}

function logItem(ctx, lead, activity, canWrite) {
  const { esc, btn, dateTime } = ctx;
  const meta = [activity.system ? "Sistema" : "", activity.system ? "" : activity.directionLabel, activity.channelLabel].filter(Boolean).join(" · ");
  return `<li class="pt-log-item"${activity.system ? " data-change" : ""}${activity.voided ? " data-voided" : ""}>
    <span class="pt-log-date pt-date">${dateTime(activity)}</span>
    <div class="pt-log-body"><p class="pt-log-title">${esc(activity.title)}${activity.amountCents ? ` · <span class="readout">${money(activity.amountCents)}</span>` : ""}${activity.voided ? ' <span class="pt-tag pt-tag-late">Anulada</span>' : ""}</p>
      ${meta ? `<p class="pt-log-author">${esc(meta)}</p>` : ""}
      ${activity.summary ? `<p class="pt-log-text live-prewrap">${esc(activity.summary)}</p>` : ""}
      ${activity.outcome ? `<p class="pt-log-text"><strong>Resultado:</strong> ${esc(activity.outcome)}</p>` : ""}
      ${activity.voided ? `<p class="pt-log-author">Anulada${activity.voidedOn ? ` el ${ctx.fmtDate(activity.voidedOn, true)}` : ""}: ${esc(activity.voidReason || "sin motivo")}</p>` : ""}
      ${canWrite && !activity.system && !activity.voided ? `<button class="pt-link pt-link-danger" type="button" data-action="lead-void" data-id="${esc(lead.id)}" data-kind="${esc(activity.id)}">Anular</button>` : ""}
    </div></li>`;
}
