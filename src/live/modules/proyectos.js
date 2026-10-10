// Proyectos: lista y ficha con hitos, actualizaciones (borrador → publicación explícita), cobros, alcance y miembros.
// La pantalla solo lee del repositorio; los envíos viven en proyectos-forms.js.
import { MAIN_STAGES, STAGES, stagePosition, todayISO } from "../../rules.js";
import { CHANGE_STATUS_LABELS, MEMBER_ROLE_LABELS, MILESTONE_STATUS_LABELS, PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS, UPDATE_KIND_LABELS, UPDATE_STATE_LABELS, formatCents as money, shortId } from "../adapters/common.js";
import { stageHistoryFromAudit } from "../adapters/projects.js";
import forms from "./proyectos-forms.js";

const FINANCE_LIMIT = 40;
const FINANCE_TTL = 5 * 60_000;
export const LIVE_STAGES = [...MAIN_STAGES, "support"];
const FILTERS = [
  ["activos", "Activos", (p) => !["closed", "support"].includes(p.stage)],
  ["paused", "En pausa", (p) => p.stage === "paused"],
  ["support", "Soporte", (p) => p.stage === "support"],
  ["closed", "Cerrados", (p) => p.stage === "closed"],
  ["todos", "Todos", () => true],
];
const nextLiveStage = (stage) => LIVE_STAGES[LIVE_STAGES.indexOf(stage) + 1] || null;
const PAYMENT_TONE = { proposed: "out", committed: "attn", collected: "ok", voided: "late" };
const UPDATE_TONE = { internal: "", draft: "attn", published: "ok", withdrawn: "late" };

export default {
  id: "proyectos",
  label: "Proyectos",
  nav: { order: 40, area: "main" },
  status: "live",
  permission: "projects:read",
  filters: { proyectos: { show: "activos" } },
  ...forms,

  prepare(ctx, route) {
    const { repo, can } = ctx;
    if (!route.id) {
      // La API no trae dinero en la lista: se pide el saldo de los proyectos abiertos (tope y caché largos para no saturar los 120 req/min).
      repo.ensure("projects").then((data) => { if (can("billing:read")) repo.ensureAll("project.finance", data.list.filter((p) => p.stage !== "closed").slice(0, FINANCE_LIMIT).map((p) => p.id), { maxAge: FINANCE_TTL }); }).catch(() => {});
      return;
    }
    const id = route.id;
    for (const slice of ["project", "project.milestones", "project.updates", "project.scope", "project.finance", "project.payments", "project.audit"]) repo.ensure(slice, id).catch(() => {});
    repo.ensure("projects").catch(() => {});
  },

  badge() { return null; },

  render(ctx, route) {
    return route.id ? detail(ctx, route.id) : list(ctx);
  },
};

// ---------- Lista ----------

function list(ctx) {
  const { shell, crumbs, esc, icon, btn, openLink, emptyState, entryView, stageMark, meter } = ctx;
  const f = ctx.state.filters.proyectos;
  const entry = ctx.repo.get("projects");
  const canCreate = ctx.can("projects:write") && ctx.can("billing:write");
  const body = (data) => {
    const filter = FILTERS.find(([key]) => key === f.show) || FILTERS[0];
    const projects = data.list.filter(filter[2]).sort((a, b) => (stagePosition(b) || 0) - (stagePosition(a) || 0) || a.name.localeCompare(b.name));
    const active = data.list.filter(FILTERS[0][2]);
    const finances = data.list.map((project) => ({ project, finance: ctx.repo.data("project.finance", project.id) }));
    const known = finances.filter(({ project, finance }) => finance && project.stage !== "closed");
    const receivable = known.reduce((sum, { finance }) => sum + finance.balanceCents, 0);
    const pendingFinance = ctx.can("billing:read") && data.list.some((p) => p.stage !== "closed" && ctx.repo.get("project.finance", p.id).data === undefined);
    const cols = "minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) auto";
    return `<dl class="pt-overview">
        <div><dt>Activos</dt><dd><span class="pt-big">${active.length}</span><span class="pt-fine">${MAIN_STAGES.map((stage) => `${active.filter((p) => p.stage === stage).length} ${STAGES[stage].name.toLowerCase()}`).filter((t) => !t.startsWith("0")).join(" · ") || "Sin proyectos activos"}</span></dd></div>
        <div><dt>En pausa</dt><dd><span class="pt-big">${data.list.filter((p) => p.stage === "paused").length}</span><span class="pt-fine">Con motivo y fecha de revisión.</span></dd></div>
        <div><dt>Por cobrar</dt><dd>${ctx.can("billing:read") ? `<span class="pt-big">${money(receivable)}</span><span class="pt-fine">Saldo del precio acordado en ${known.length} proyecto${known.length === 1 ? "" : "s"}${pendingFinance ? " · calculando el resto…" : ""}. No es ingreso todavía.</span>` : `<span class="pt-fine">Tu cuenta no tiene <span class="readout">billing:read</span>: no ves importes.</span>`}</dd></div>
      </dl>
      ${data.truncated ? `<p class="pt-fine" role="status">Hay más proyectos de los que se cargan acá (tope de 500). Cerrá los que terminaron para verlos todos.</p>` : ""}
      <div class="pt-filters"><div class="pt-seg" role="group" aria-label="Mostrar">${FILTERS.map(([key, label, test]) => `<button type="button" data-action="filter" data-id="proyectos.show" data-kind="${key}" aria-pressed="${f.show === key}">${esc(label)} <span class="pt-count">${data.list.filter(test).length}</span></button>`).join("")}</div></div>
      <section class="pt-list" style="margin-top:28px" aria-label="Proyectos">
      ${projects.length ? `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Proyecto</span><span class="label">Etapa actual</span><span class="label">Cobrado</span><span class="label">Saldo</span><span></span></div>
        <ul class="pt-rows">${projects.map((project) => {
          const finance = ctx.repo.data("project.finance", project.id);
          const href = `#proyectos/${encodeURIComponent(project.id)}`;
          return `<li class="pt-row" style="--cols:${cols}"${project.stage === "paused" ? " data-late" : ""}>
            <div><a class="pt-row-name" href="${href}">${esc(project.name)}</a><span class="pt-meta">${esc(project.service)}</span><span class="pt-code">${esc(project.code)}</span></div>
            <div>${stageMark(project, { layout: "stack", meaning: true })}</div>
            <div><span class="pt-cell-label label">Cobrado</span>${finance ? `<span class="readout">${money(finance.collectedCents, { withCurrency: false })}</span><span class="pt-meta">de ${money(finance.agreedCents)}</span>` : `<span class="pt-meta" style="margin:0">${!ctx.can("billing:read") ? "Sin permiso" : project.stage === "closed" ? "Ver ficha" : ctx.repo.get("project.finance", project.id).status === "error" ? "No disponible" : "Cargando…"}</span>`}</div>
            <div><span class="pt-cell-label label">Saldo</span>${finance ? `<span class="readout">${money(finance.balanceCents)}</span>` : `<span class="pt-meta" style="margin:0">—</span>`}</div>
            <div class="pt-row-end"><a class="btn btn-sm btn-ghost btn-open" href="${href}">Ver proyecto ${icon("arrow")}</a></div>
          </li>`;
        }).join("")}</ul>` : emptyState("Sin proyectos en esta vista", "Un proyecto nace con un acuerdo y la seña cobrada.", canCreate ? btn("new-project", `${icon("plus")} Proyecto con seña`, "btn-ink") : "")}
      </section>`;
  };
  return shell(`${crumbs([["Operación", "#hoy"], ["Proyectos"]])}
    <div class="pt-head-row"><div>
      <div class="pt-kicker"><span class="label">Entrega</span></div>
      <h1 class="display pt-title">Proyectos en <em>curso</em>.</h1>
      <p class="pt-company">Un proyecto existe cuando hay un acuerdo y la seña está cobrada. Las cinco etapas son las que ve el cliente; lo interno (notas, bloqueos, importes) no se publica solo.</p>
    </div><div class="pt-head-actions">${canCreate ? btn("new-project", `${icon("plus")} Proyecto con seña`, "btn-primary") : `<span class="pt-fine">Crear proyectos requiere <span class="readout">projects:write</span> y <span class="readout">billing:write</span>.</span>`}</div></div>
    ${entryView(entry, { slice: "projects", key: "", label: "No pudimos cargar los proyectos", render: body })}`, "proyectos");
}

// ---------- Ficha ----------

function detail(ctx, id) {
  const { shell, crumbs, esc, icon, emptyState, entryView } = ctx;
  const entry = ctx.repo.get("project", id);
  if (entry.status === "error" && entry.error?.status === 404) return shell(`${crumbs([["Proyectos", "#proyectos"], ["No encontrado"]])}${emptyState("No existe ese proyecto", "", `<a class="pt-link" href="#proyectos">${icon("back")} Volver a proyectos</a>`)}`, "proyectos");
  const name = entry.data?.name || "Proyecto";
  return shell(`${crumbs([["Operación", "#hoy"], ["Proyectos", "#proyectos"], [name]])}${entryView(entry, { slice: "project", key: id, label: "No pudimos cargar el proyecto", render: (project) => ficha(ctx, project) })}`, "proyectos");
}

function ficha(ctx, project) {
  const { esc, icon, btn, phaseGlyph, fmtDate, projectRail } = ctx;
  const id = project.id;
  const a = `data-id="${esc(id)}"`;
  const writable = ctx.can("projects:write") && project.stage !== "closed";
  const finance = ctx.repo.data("project.finance", id);
  const updates = ctx.repo.data("project.updates", id) || [];
  const milestones = ctx.repo.data("project.milestones", id) || [];
  const audit = ctx.repo.data("project.audit", id);
  const history = audit ? stageHistoryFromAudit(project, audit) : [];
  const withHistory = { ...project, history };
  const position = stagePosition(project);
  const stageInfo = STAGES[project.stage];
  const span = history.at(-1);
  const muted = ["paused", "closed"].includes(project.stage);
  const next = nextLiveStage(project.stage === "paused" ? project.pausedIn : project.stage);
  const openActions = updates.filter((u) => u.kind === "action_required" && u.state === "published" && !u.resolved);
  const nextMilestone = milestones.filter((m) => !["done", "cancelled"].includes(m.status)).sort((x, y) => (x.plannedOn || "9999").localeCompare(y.plannedOn || "9999"))[0];
  const tab = ["updates", "milestones", "payments", "scope"].includes(ctx.state.tab) ? ctx.state.tab : "updates";

  const actions = [];
  if (writable) {
    if (project.stage === "paused") actions.push(btn("project-resume", "Retomar", "btn-ink", a));
    else {
      actions.push(btn("project-advance", next ? `Pasar a ${STAGES[next].name}` : "Cambiar etapa", "btn-ink", `${a} data-kind="${next || ""}"`));
      actions.push(btn("project-pause", "Pausar", "btn-ghost", a));
    }
    actions.push(btn("project-edit", "Editar datos", "btn-ghost", a));
    actions.push(btn("project-close", "Cerrar proyecto", "btn-danger", a));
  } else if (project.stage === "closed") actions.push(`<p class="pt-fine">Proyecto cerrado: queda en solo lectura. Siguen permitidos los cobros de mantenimiento, anular cobros y retirar actualizaciones.</p>`);
  else actions.push(`<p class="pt-fine">Tu cuenta no puede modificar proyectos (falta <span class="readout">projects:write</span>).</p>`);

  const financeBox = !ctx.can("billing:read")
    ? `<section class="pt-box"><div class="pt-box-head"><span class="label">Finanzas</span></div><p class="pt-fine">Tu cuenta no tiene <span class="readout">billing:read</span>: no ves importes.</p></section>`
    : ctx.entryView(ctx.repo.get("project.finance", id), { slice: "project.finance", key: id, label: "No pudimos cargar las finanzas", render: (f) => `<section class="pt-box"><div class="pt-box-head"><span class="label">Finanzas · calculadas por el servidor</span></div>
        <ul class="pt-ledger" aria-live="polite">
          <li><span>Precio acordado</span><span class="pt-leader"></span><span class="readout">${money(f.agreedCents)}</span></li>
          <li><span>Cobrado</span><span class="pt-leader"></span><span class="readout">${money(f.collectedCents)}</span></li>
          <li><span>Comprometido</span><span class="pt-leader"></span><span class="readout">${money(f.committedCents)}</span></li>
          <li><span>Propuesto</span><span class="pt-leader"></span><span class="readout">${money(f.proposedCents)}</span></li>
          <li><span><strong>Saldo por cobrar</strong></span><span class="pt-leader"></span><span class="readout"><strong>${money(f.balanceCents)}</strong></span></li>
          <li><span>Sin fecha de cobro</span><span class="pt-leader"></span><span class="readout">${money(f.unscheduledCents)}</span></li>
        </ul>
        <p class="pt-fine">Mantenimiento cobrado ${money(f.maintenanceCollectedCents)} · aparte: nunca baja el saldo. Ingreso total cobrado ${money(f.incomeCollectedCents)}.</p></section>` });

  const clientBox = `<section class="pt-box"${openActions.length ? " data-turn" : ""}>
      <div class="pt-box-head"><span class="label">Acción del cliente</span>${openActions.length ? `<span class="pt-tag pt-tag-attn">Le toca al cliente</span>` : ""}</div>
      <p class="pt-box-title">${openActions.length ? esc(openActions[0].title || openActions[0].body.slice(0, 80)) : "Nada pendiente de su lado"}</p>
      <p class="pt-fine">${openActions.length ? `${openActions.length} acción${openActions.length === 1 ? "" : "es"} publicada${openActions.length === 1 ? "" : "s"} sin resolver.` : "Para pedir una aprobación o un insumo, creá una acción: queda en borrador hasta que la publiques."}</p>
      ${writable ? `<div class="pt-actions">${btn("update-edit", "Pedir acción", "btn-ghost", `${a} data-kind="action_required"`)}</div>` : ""}</section>`;
  const milestoneBox = `<section class="pt-box"><div class="pt-box-head"><span class="label">Próximo hito</span>${nextMilestone?.plannedOn ? ctx.dueTag(nextMilestone.plannedOn) : ""}</div>
      <p class="pt-box-title">${nextMilestone ? esc(nextMilestone.title) : "Sin hitos pendientes"}</p>
      <p class="pt-fine">${nextMilestone ? `${esc(STAGES[nextMilestone.stage]?.name || "")} · ${nextMilestone.ownerParty === "client" ? "Cliente" : "Eclipse"}${nextMilestone.plannedOn ? ` · estimado ${fmtDate(nextMilestone.plannedOn, true)}` : ""}` : "Los hitos nuevos son internos hasta que decidas mostrarlos al cliente."}</p></section>`;

  return `
    <p class="pt-detail-meta"><span class="pt-detail-code">${esc(project.code)}</span><span>${esc(project.client)}</span><span>${project.live.origin === "historical" ? "Histórico" : "Proyecto nuevo"}</span></p>
    <h1 class="display pt-title">${esc(project.name)}</h1>
    <p class="pt-company"><strong>${esc(project.service)}</strong></p>

    <div class="pt-top">
      <section class="pt-current ticks"${muted ? " data-muted" : ""} aria-label="Etapa actual">
        <div class="pt-dial">${phaseGlyph((position || 0) / 5, 44)}<p class="pt-dial-pos">${position ? `${position}<span>/5</span>` : "—"}</p></div>
        <div>
          <span class="label">Etapa actual · lo que ve el cliente</span>
          <p class="pt-current-name">${esc(stageInfo.name)}</p>
          <p class="pt-current-short">${position && !["support", "closed"].includes(project.stage) ? `${position} de 5 · ` : ""}${esc(stageInfo.short)}${span && !muted && project.stage !== "support" ? ` · desde ${fmtDate(span.start, true)}` : ""}</p>
          ${project.stage === "paused" ? `<div class="pt-pause"><p class="pt-pause-title">En pausa · ${esc(STAGES[project.pausedIn]?.name || "")}</p><p><strong>Motivo:</strong> ${esc(project.live.stateReason || "—")}</p><p><strong>Revisar:</strong> ${project.live.reviewOn ? fmtDate(project.live.reviewOn, true) : "—"}</p></div>` : ""}
          ${project.stage === "closed" ? `<div class="pt-pause"><p class="pt-pause-title">Cerrado${project.completedOn ? ` el ${fmtDate(project.completedOn, true)}` : ""}</p><p><strong>Motivo:</strong> ${esc(project.live.stateReason || "—")}</p></div>` : ""}
          <dl class="pt-dl">
            <div><dt>Para pasar de etapa</dt><dd>${esc(stageInfo.exit)}</dd></div>
            <div><dt>Responsable</dt><dd>${esc(stageInfo.owner)}</dd></div>
            <div><dt>Entrega estimada</dt><dd>${project.live.plannedEndOn ? `<span class="pt-date">${fmtDate(project.live.plannedEndOn, true)}</span>` : "—"}</dd></div>
          </dl>
          <div class="pt-actions" aria-live="polite">${actions.join("")}</div>
        </div>
      </section>
      <aside class="pt-side">${financeBox}${milestoneBox}${clientBox}</aside>
    </div>

    <section class="pt-timeline" aria-labelledby="rail-title"><h2 id="rail-title" class="pt-h2">Cronograma</h2>${projectRail(withHistory)}
      <p class="pt-fine">Las etapas 1 a 5 son las de todo proyecto; Soporte viene después. Las fechas salen del historial del servidor.</p></section>

    <div class="pt-bottom">
      <section aria-labelledby="track-title">
        <div class="pt-section-head"><h2 id="track-title" class="pt-h2">Seguimiento</h2>${tabAction(ctx, tab, id, writable)}</div>
        <div class="pt-tablist" role="tablist" aria-label="Seguimiento">
          ${[["updates", "Actualizaciones", updates.length], ["milestones", "Hitos", milestones.length], ["payments", "Cobros", (ctx.repo.data("project.payments", id) || []).length], ["scope", "Alcance", (ctx.repo.data("project.scope", id)?.changeRequests || []).length]].map(([key, label, count]) => `<button class="pt-tab" role="tab" type="button" aria-selected="${tab === key}" data-action="tab" data-id="${key}">${label} <span class="pt-tab-count">${count}</span></button>`).join("")}
        </div>
        <div class="pt-tabpanel" role="tabpanel">${panel(ctx, tab, project, writable)}</div>
      </section>
      <aside class="pt-facts" aria-label="Datos del proyecto">
        <span class="label">Datos del proyecto</span>
        <dl class="pt-dl">
          <div><dt>Código</dt><dd class="pt-date">${esc(project.code)}</dd></div>
          <div><dt>Cliente</dt><dd>${esc(project.client || "—")}</dd></div>
          <div><dt>Acuerdo</dt><dd>${esc(project.live.agreementReference || "—")}${project.live.agreementAcceptedOn ? ` · ${fmtDate(project.live.agreementAcceptedOn, true)}` : ""}</dd></div>
          <div><dt>Alcance vigente</dt><dd>Versión ${project.live.scopeVersion ?? "—"}</dd></div>
          <div><dt>Inicio</dt><dd>${project.live.startedOn ? `<span class="pt-date">${fmtDate(project.live.startedOn, true)}</span>` : "Sin fecha"}</dd></div>
          <div><dt>Total acordado</dt><dd class="readout">${finance ? money(finance.agreedCents) : project.total !== null ? money(Math.round(project.total * 100)) : "—"}</dd></div>
          ${project.live.sourcePlanRequestId ? `<div><dt>Origen</dt><dd><a class="pt-link" style="min-height:0" href="#solicitudes/${encodeURIComponent(project.live.sourcePlanRequestId)}">Solicitud del cliente</a></dd></div>` : ""}
          <div><dt>Versión del registro</dt><dd class="readout">${project.version}</dd></div>
        </dl>
        ${members(ctx, project, writable)}
        ${projectLinks(ctx, project)}
        <a class="pt-link" href="#proyectos">${icon("back")} Volver a proyectos</a>
      </aside>
    </div>`;
}

/** Enlaces de otros módulos a este proyecto (Comunicaciones, Documentos…): cada módulo declara projectLinks(ctx, project). */
function projectLinks(ctx, project) {
  const links = ctx.registry.modules.map((module) => module.projectLinks?.(ctx, project) || "").join("");
  return links ? `<div class="live-members"><span class="label">Comunicar y documentar</span>${links}</div>` : "";
}

function tabAction(ctx, tab, id, writable) {
  const { btn, icon, esc } = ctx;
  const a = `data-id="${esc(id)}"`;
  if (tab === "updates" && writable) return btn("update-edit", `${icon("plus")} Registro`, "btn-ghost", a);
  if (tab === "milestones" && writable) return btn("milestone-edit", `${icon("plus")} Hito`, "btn-ghost", a);
  if (tab === "payments" && ctx.can("billing:write")) return btn("new-payment", `${icon("plus")} Cobro`, "btn-ghost", a);
  if (tab === "scope" && writable) return btn("change-create", `${icon("plus")} Cambio`, "btn-ghost", a);
  return "";
}

function members(ctx, project, writable) {
  const { esc, btn, fmtDate } = ctx;
  const list = project.live.members;
  return `<div class="live-members"><span class="label">Personas del cliente con acceso</span>
    ${list.length ? `<ul class="pt-ledger">${list.map((member) => `<li><span>Cuenta <span class="readout">${esc(shortId(member.clientId))}</span><small class="pt-meta">${esc(MEMBER_ROLE_LABELS[member.role] || member.role)} · desde ${fmtDate(member.addedAt.slice(0, 10), true)}</small></span><span class="pt-leader"></span>${writable ? `<button class="pt-link pt-link-danger" type="button" data-action="member-remove" data-id="${esc(project.id)}" data-kind="${esc(member.id)}">Quitar</button>` : ""}</li>`).join("")}</ul>` : `<p class="pt-fine">Ninguna cuenta de cliente puede ver este proyecto todavía.</p>`}
    ${writable ? btn("member-add", "Autorizar cliente", "btn-ghost", `data-id="${esc(project.id)}"`) : ""}</div>`;
}

function panel(ctx, tab, project, writable) {
  const { esc, btn, fmtDate, dateTime, entryView } = ctx;
  const id = project.id;
  const a = (extra = "") => `data-id="${esc(id)}" ${extra}`;
  const tag = (label, tone) => `<span class="pt-tag${tone ? ` pt-tag-${tone}` : ""}">${esc(label)}</span>`;

  if (tab === "updates") {
    return entryView(ctx.repo.get("project.updates", id), { slice: "project.updates", key: id, label: "No pudimos cargar las actualizaciones", render: (updates) => {
      if (!updates.length) return `<p class="pt-fine">Sin actualizaciones. Las notas internas nunca se publican; el resto nace como borrador.</p>`;
      return `<ol class="pt-log">${updates.map((u) => `<li class="pt-log-item"><span class="pt-log-date pt-date">${dateTime(u)}</span><div class="pt-log-body">
          <p class="pt-log-title">${esc(UPDATE_KIND_LABELS[u.kind])} ${tag(UPDATE_STATE_LABELS[u.state], UPDATE_TONE[u.state])}${u.kind === "action_required" && u.state === "published" ? (u.resolved ? " " + tag("Resuelta", "ok") : " " + tag("Sin resolver", "attn")) : ""}</p>
          ${u.title ? `<p class="pt-log-title">${esc(u.title)}</p>` : ""}
          <p class="pt-log-text live-prewrap">${esc(u.body)}</p>
          ${u.dueOn ? `<p class="pt-log-author">Para el ${fmtDate(u.dueOn, true)}</p>` : ""}
          ${u.state === "withdrawn" ? `<p class="pt-log-author">Retirada: ${esc(u.withdrawReason)}</p>` : ""}
          <div class="pt-actions">${updateButtons(ctx, id, u, writable)}</div></div></li>`).join("")}</ol>`;
    } });
  }

  if (tab === "milestones") {
    return entryView(ctx.repo.get("project.milestones", id), { slice: "project.milestones", key: id, label: "No pudimos cargar los hitos", render: (milestones) => {
      if (!milestones.length) return `<p class="pt-fine">Sin hitos. Un hito nuevo es interno: el cliente no lo ve hasta que lo muestres.</p>`;
      return `<ul class="pt-ledger live-milestones">${milestones.map((m) => `<li><span><strong>${esc(m.title)}</strong>
          <small class="pt-meta">${esc(STAGES[m.stage]?.name || m.stage)} · ${m.ownerParty === "client" ? "Cliente" : "Eclipse"} · ${m.actualOn ? `cumplido ${fmtDate(m.actualOn, true)}` : m.plannedOn ? `estimado ${fmtDate(m.plannedOn, true)}` : "sin fecha"}</small>
          ${m.description ? `<small class="pt-meta live-prewrap">${esc(m.description)}</small>` : ""}${m.evidence ? `<small class="pt-meta live-prewrap">Evidencia: ${esc(m.evidence)}</small>` : ""}</span>
          <span class="pt-leader"></span>
          <span class="live-tags">${tag(MILESTONE_STATUS_LABELS[m.status], m.status === "done" ? "ok" : m.status === "blocked" ? "late" : "")} ${tag(m.visibleToClient ? "Lo ve el cliente" : "Interno", m.visibleToClient ? "attn" : "out")}</span>
          ${writable ? `<span class="pt-actions">${m.status !== "done" ? btn("milestone-edit", "Editar", "btn-ghost", a(`data-kind="${esc(m.id)}"`)) + btn("milestone-complete", "Completar", "btn-ghost", a(`data-kind="${esc(m.id)}"`)) : ""}${ctx.can("updates:send") ? btn("milestone-visibility", m.visibleToClient ? "Ocultar al cliente" : "Mostrar al cliente", "btn-ghost", a(`data-kind="${esc(m.id)}"`)) : ""}</span>` : ""}</li>`).join("")}</ul>`;
    } });
  }

  if (tab === "payments") {
    if (!ctx.can("billing:read")) return `<p class="pt-fine">Tu cuenta no tiene <span class="readout">billing:read</span>: no ves los cobros.</p>`;
    return entryView(ctx.repo.get("project.payments", id), { slice: "project.payments", key: id, label: "No pudimos cargar los cobros", render: (payments) => {
      if (!payments.length) return `<p class="pt-fine">Sin cobros registrados.</p>`;
      return `<ul class="pt-ledger live-payments">${[...payments].sort((x, y) => (y.date || "").localeCompare(x.date || "")).map((p) => `<li><span class="pt-date">${p.date ? fmtDate(p.date, true) : "—"}<small class="log-time">${p.status === "collected" ? "cobrado" : p.status === "committed" ? "vence" : p.status === "voided" ? "anulado" : "propuesto"}</small></span>
          <span>${esc(p.concept)} ${tag(p.statusLabel, PAYMENT_TONE[p.status])}${p.kind === "maintenance" ? ` <small class="pt-meta" style="display:inline">no baja el saldo</small>` : ""}${p.note ? `<small class="pt-meta">${esc(p.note)}</small>` : ""}${p.reference ? `<small class="pt-meta">Ref. ${esc(p.reference)}</small>` : ""}${p.voidReason ? `<small class="pt-meta">Motivo de la anulación: ${esc(p.voidReason)}</small>` : ""}</span>
          <span class="pt-leader"></span><span class="readout"${p.status === "voided" ? ' style="text-decoration:line-through"' : ""}>${money(p.amountCents)}</span>
          ${ctx.can("billing:write") ? `<span class="pt-actions">${paymentButtons(ctx, id, p)}</span>` : ""}</li>`).join("")}</ul>`;
    } });
  }

  // Alcance
  return entryView(ctx.repo.get("project.scope", id), { slice: "project.scope", key: id, label: "No pudimos cargar el alcance", render: (scope) => `
    <h3 class="pt-h3">Versiones del alcance</h3>
    <ul class="pt-ledger">${scope.versions.map((v) => `<li><span><strong>Versión ${v.version}</strong>${v.version === project.live.scopeVersion ? " · vigente" : ""}<small class="pt-meta live-prewrap">${v.items.map((item) => `• ${esc(item)}`).join("\n")}</small><small class="pt-meta">Aceptado ${fmtDate(v.acceptedOn, true)}</small></span><span class="pt-leader"></span><span class="readout">${v.priceCents === null ? "—" : money(v.priceCents)}</span></li>`).join("") || `<li><span class="pt-fine">Sin versiones.</span></li>`}</ul>
    <h3 class="pt-h3" style="margin-top:28px">Solicitudes de cambio</h3>
    ${scope.changeRequests.length ? `<ul class="pt-ledger">${scope.changeRequests.map((c) => `<li><span><strong>#${c.number} ${esc(c.title)}</strong> ${tag(CHANGE_STATUS_LABELS[c.status], c.status === "accepted" ? "ok" : c.status === "rejected" ? "late" : "attn")}
        <small class="pt-meta live-prewrap">${esc(c.description)}</small>
        <small class="pt-meta">${c.origin === "client" ? "Pedido por el cliente" : "Propuesto por Eclipse"}${c.hoursImpact !== null ? ` · ${c.hoursImpact} h` : ""}${c.priceImpactCents !== null ? ` · ${money(c.priceImpactCents)}` : ""}${c.scheduleImpactDays !== null ? ` · ${c.scheduleImpactDays > 0 ? "+" : ""}${c.scheduleImpactDays} días` : ""}</small></span>
        <span class="pt-leader"></span>${writable && !["accepted", "rejected", "closed"].includes(c.status) ? `<span class="pt-actions">${btn("change-evaluate", "Evaluar", "btn-ghost", a(`data-kind="${esc(c.id)}"`))}${c.status === "estimated" && ctx.can("billing:write") ? btn("change-decide", "Decidir", "btn-ink", a(`data-kind="${esc(c.id)}"`)) : ""}</span>` : ""}</li>`).join("")}</ul>` : `<p class="pt-fine">Sin solicitudes de cambio. Un cambio no modifica nada hasta que se acepta con referencia y fecha.</p>`}` });
}

function updateButtons(ctx, id, u, writable) {
  const { btn, esc } = ctx;
  const a = `data-id="${esc(id)}" data-kind="${esc(u.id)}"`;
  const out = [];
  if (u.state === "internal" || u.state === "draft") {
    if (writable) out.push(btn("update-edit", "Editar", "btn-ghost", a));
    if (u.state === "draft" && ctx.can("updates:send") && writable) out.push(btn("update-publish", "Publicar al cliente", "btn-ink", a));
    if (u.state === "draft" && !ctx.can("updates:send")) out.push(`<span class="pt-fine">Publicar requiere <span class="readout">updates:send</span>.</span>`);
  }
  if (u.state === "published") {
    if (u.kind === "action_required" && !u.resolved && writable) out.push(btn("update-resolve", "Marcar resuelta", "btn-ghost", a));
    if (ctx.can("updates:send")) out.push(btn("update-withdraw", "Retirar", "btn-danger", a));
  }
  return out.join("");
}

function paymentButtons(ctx, id, p) {
  const { btn, esc } = ctx;
  const a = (to) => `data-id="${esc(id)}" data-kind="${esc(p.id)}" data-to="${to}"`;
  const out = [];
  if (p.status === "proposed") out.push(btn("payment-transition", "Comprometer", "btn-ghost", a("committed")));
  if (["proposed", "committed"].includes(p.status)) out.push(btn("payment-transition", "Marcar cobrado", "btn-ink", a("collected")));
  if (p.status !== "voided") out.push(btn("payment-transition", "Anular", "btn-danger", a("voided")));
  return out.join("");
}
