import { activities, artifacts, demoPeriod, getLead, getProject, getProjectArtifacts, leads, metrics, projects } from "./mock/adapter.js";

const NAV = [
  { id: "today", label: "Hoy", icon: "today" },
  { id: "contacts", label: "Contactos", icon: "contacts" },
  { id: "projects", label: "Proyectos", icon: "projects" },
  { id: "activity", label: "Actividad", icon: "activity" },
  { id: "documents", label: "Documentos", icon: "documents" },
  { id: "help", label: "Ayuda", icon: "help" },
];

const LEAD_STATUSES = [
  ["new", "Nuevo"], ["contacted", "Contactado"], ["qualified", "Calificado"],
  ["demo_presale", "Demo / preventa"], ["proposal_sent", "Propuesta enviada"],
  ["won", "Ganado"], ["lost", "Perdido"], ["paused", "Pausado"],
];

const PROJECT_STAGES = [
  ["confirmed_preparation", "Confirmado / Preparación"], ["build", "Build"], ["qa", "QA"],
  ["client_review", "Revisión cliente"], ["delivery_training", "Entrega / Capacitación"],
  ["support", "Soporte (si fue contratado)"], ["closed", "Cerrado"],
];

const ARTIFACT_CATEGORIES = ["Comercial", "Acuerdo", "Insumo", "Decisión", "Técnico interno", "QA", "Entrega", "Soporte"];

const state = {
  filters: {
    contacts: { search: "", status: "", source: "", industry: "", owner: "", due: "" },
    projects: { search: "", client: "", stage: "", owner: "", action: "", blocked: "", milestone: "" },
    documents: { search: "", project: "", category: "", audience: "" },
    activity: { search: "", type: "", owner: "" },
  },
  projectTab: "summary",
  modal: null,
};

function getStorage(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function setStorage(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* Onboarding can still be closed for this session. */ }
}

if (getStorage("eclipse-portal-onboarding-dismissed") !== "true") {
  state.modal = { type: "onboarding", step: 0 };
}

const iconPaths = {
  today: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M8 2.8v3.5M16 2.8v3.5M4 9h16M8 13h2m3 0h2m-7 3h2"/>',
  contacts: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.5-3.3 2.5-5.2 6-5.2s5.5 1.9 6 5.2M16 5.1a3.2 3.2 0 0 1 0 6.2M17.5 15c2.1.5 3.3 2.1 3.5 5"/>',
  projects: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4V2.8h8V4M7 9h10M7 13h5m-5 3h8"/>',
  activity: '<path d="M3 12h4l2.2-6 4.2 12 2.1-6H21"/>',
  documents: '<path d="M6 3.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.5Z"/><path d="M14 3.8V8h4M8 12h8m-8 3h8m-8 3h5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 4.2 1.6c-.9 1-1.9 1.2-1.9 2.7M12 17.3h.01"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M7.5 3v4M16.5 3v4M4 9h16"/>',
  alert: '<path d="M12 3 2.7 20h18.6L12 3Z"/><path d="M12 9v4.2m0 3.2h.01"/>',
  check: '<path d="m5 12 4.2 4.2L19.5 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  external: '<path d="M14 4h6v6m-.4-5.6L11 13M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
};

function icon(name, className = "") {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.help}</svg>`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function routeInfo() {
  const raw = window.location.hash.replace(/^#\/?/, "") || "today";
  const [view, id] = raw.split("/");
  const known = NAV.some((item) => item.id === view);
  return { view: known ? view : "today", id: id ? decodeURIComponent(id) : "" };
}

function statusLabel(status) {
  return new Map(LEAD_STATUSES).get(status) || status;
}

function statusTone(status) {
  if (["won", "done", "closed"].includes(status)) return "green";
  if (["lost", "blocked", "paused"].includes(status)) return "red";
  if (["proposal_sent", "qualified", "qa", "client_review", "in_progress"].includes(status)) return "blue";
  if (["new", "demo_presale", "upcoming"].includes(status)) return "amber";
  return "neutral";
}

function badge(label, tone = "neutral") {
  return `<span class="badge badge-${tone}">${escapeHTML(label)}</span>`;
}

function navHref(id) { return `#${id}`; }

function shell(inner, activeView, currentTitle) {
  const nav = NAV.map((item) => `
    <a class="nav-item" href="${navHref(item.id)}" ${activeView === item.id ? 'aria-current="page"' : ""}>
      ${icon(item.icon, "nav-icon")}<span>${item.label}</span>
    </a>`).join("");
  return `
    <div class="app-shell">
      <aside class="sidebar" aria-label="Navegación del portal interno">
        <a class="brand-lockup" href="#today" aria-label="Eclipse Operaciones, ir a Hoy">
          <span class="brand-mark" aria-hidden="true"></span>
          <span><span class="brand-name">eclipse</span><span class="brand-caption">operaciones</span></span>
        </a>
        <p class="nav-label">Espacio interno</p>
        <nav class="primary-nav" aria-label="Principal">${nav}</nav>
        <div class="sidebar-spacer"></div>
        <div class="demo-card"><strong><span class="demo-dot"></span>Entorno de demostración</strong><p>Solo fixtures sintéticos. Ninguna acción envía mensajes ni publica contenido.</p></div>
        <div class="profile-row"><span class="avatar" aria-hidden="true">SR</span><span><span class="profile-name">Sofía R.</span><span class="profile-role">Operaciones · perfil ficticio</span></span></div>
      </aside>
      <div class="main-column">
        <header class="topbar">
          <div class="crumb"><span class="optional-crumb">Eclipse</span><span class="crumb-sep">/</span><strong>${escapeHTML(currentTitle)}</strong></div>
          <div class="topbar-tools"><span class="mode-pill"><span class="demo-dot"></span><span class="mode-long">Datos sintéticos</span><span class="mode-short">Demo</span></span><button class="icon-button" type="button" data-action="open-help" aria-label="Abrir ayuda" title="Ayuda">${icon("help")}</button></div>
        </header>
        <main id="main-content" class="content-wrap" tabindex="-1">${inner}</main>
      </div>
      <div id="toast-region" class="toast-region" aria-live="polite" aria-atomic="true"></div>
      ${state.modal ? modalMarkup(state.modal) : ""}
    </div>`;
}

function pageHeading(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${escapeHTML(eyebrow)}</p><h1>${escapeHTML(title)}</h1><p class="page-description">${escapeHTML(description)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</div>`;
}

function metricCard(metric) {
  const metricIcons = { new: "contacts", open: "activity", proposals: "documents", collected: "check", warm: "projects" };
  return `<article class="metric-card"><div class="metric-label"><span>${escapeHTML(metric.label)}</span><span class="metric-icon">${icon(metricIcons[metric.id])}</span></div><div class="metric-value" aria-label="Sin dato">—</div><span class="metric-unit">${escapeHTML(metric.unit)}</span><p class="metric-source"><span class="metric-period">${escapeHTML(metric.period)}</span>Fuente: ${escapeHTML(metric.source)}</p></article>`;
}

const todayQueue = [
  { mark: "!", tone: "urgent", title: "Llamar hoy · respuesta recibida", summary: "Lumen Taller (demo) · una respuesta requiere llamada humana el mismo día.", owner: "Sofía R.", due: "Hoy · 14:00", href: "#contacts/lead-102" },
  { mark: "!", tone: "urgent", title: "Aprobación pendiente · proyecto bloqueado", summary: "Surco · catálogo de muestra · falta confirmación explícita de contenido.", owner: "Leo P.", due: "Vencido · est. 2 oct", href: "#projects/project-202" },
  { mark: "24", tone: "upcoming", title: "Confirmar recepción de propuesta", summary: "Estudio Río (demo) · propuesta v1 sin importe en el fixture.", owner: "Sofía R.", due: "Est. 6 oct · 12:00", href: "#contacts/lead-105" },
  { mark: "!", tone: "urgent", title: "Revisar causa de bloqueo", summary: "Brisa · automatización de muestra · no hay integración real seleccionada.", owner: "Sofía R.", due: "Est. 6 oct", href: "#projects/project-203" },
  { mark: "QA", tone: "upcoming", title: "Revisar evidencia de QA", summary: "Trama · sitio de muestra · evidencia de salida pendiente.", owner: "Leo P.", due: "Est. 8 oct", href: "#projects/project-201" },
];

function activityRow(item, compact = false) {
  return `<div class="activity-row ${compact ? "compact" : ""}"><span class="activity-dot" aria-hidden="true"></span><div><p class="activity-title">${escapeHTML(item.title)}</p><p class="activity-detail">${escapeHTML(item.detail)}</p><p class="tiny">Responsable: ${escapeHTML(item.owner)}</p></div><span class="activity-date">${escapeHTML(item.date)}</span></div>`;
}

function renderToday() {
  return `
    ${pageHeading("Operación · lunes 5 oct 2026", "Hoy", "Lo urgente primero: seguimientos, bloqueos, aprobaciones y próximos hitos.", `<a class="quiet-button" href="#activity">Ver actividad ${icon("arrow")}</a>`)}
    <section aria-labelledby="metrics-title"><div class="section-heading"><div><h2 id="metrics-title">Indicadores de Contexto Eclipse</h2><p>${escapeHTML(demoPeriod)} · no se importaron datos comerciales.</p></div><span class="demo-label">Sin cifras reales</span></div><div class="grid metric-grid">${metrics.map(metricCard).join("")}</div></section>
    <section class="section-block" aria-labelledby="money-title"><div class="section-heading"><div><h2 id="money-title">Estados de dinero separados</h2><p>Una propuesta o promesa no es dinero recibido.</p></div></div><div class="split-metrics">
      <div class="split-metric"><span class="label">Prometido</span><span class="value">—</span><span class="source">Sin registro en el mock</span></div>
      <div class="split-metric"><span class="label">Propuesto / facturado</span><span class="value">—</span><span class="source">Sin registro en el mock</span></div>
      <div class="split-metric"><span class="label">Cobrado · dinero recibido</span><span class="value">— USD</span><span class="source">Sin PaymentRecord recibido</span></div>
    </div></section>
    <div class="today-grid section-block">
      <section class="card" aria-labelledby="queue-title"><div class="section-heading"><div><h2 id="queue-title">Próximos pasos prioritarios</h2><p>Ordenados por vencimiento y bloqueo. Cada acción tiene un responsable y un registro.</p></div><span class="section-meta">5 en la muestra</span></div><div class="action-list">${todayQueue.map((item) => `<article class="action-row"><span class="action-mark ${item.tone}">${escapeHTML(item.mark)}</span><div><p class="action-title"><a class="table-primary" href="${item.href}">${escapeHTML(item.title)}</a></p><p class="action-summary">${escapeHTML(item.summary)}</p><p class="action-owner">Responsable: ${escapeHTML(item.owner)}</p></div><span class="action-due"><strong>${escapeHTML(item.due.split(" · ")[0])}</strong>${escapeHTML(item.due.split(" · ").slice(1).join(" · "))}</span></article>`).join("")}</div></section>
      <div class="detail-stack">
        <section class="card" aria-labelledby="blocked-title"><div class="section-heading"><div><h2 id="blocked-title">Proyectos bloqueados</h2><p>La causa y la próxima revisión quedan visibles.</p></div>${badge("2", "red")}</div><div class="stack-list">${projects.filter((project) => project.blocked).map((project) => `<article class="list-card"><div class="list-card-head"><h3><a class="table-primary" href="#projects/${project.id}">${escapeHTML(project.name)}</a></h3>${badge("Bloqueado", "red")}</div><p>${escapeHTML(project.blockers[0]?.cause || "Causa pendiente de registrar.")}</p><div class="list-meta"><span>Dueño: ${escapeHTML(project.owner)}</span><span>Revisión: ${escapeHTML(project.blockers[0]?.review || "Sin fecha")}</span></div></article>`).join("")}</div></section>
        <section class="card" aria-labelledby="milestones-title"><div class="section-heading"><div><h2 id="milestones-title">Hitos próximos</h2><p>Fechas estimadas hasta que exista una fuente real.</p></div></div><div class="stack-list">${projects.flatMap((project) => project.milestones.filter((milestone) => milestone.status !== "done").map((milestone) => ({ project, milestone }))).slice(0, 3).map(({ project, milestone }) => `<article class="list-card"><div class="list-card-head"><h3>${escapeHTML(milestone.title)}</h3>${badge(milestone.status === "blocked" ? "Bloqueado" : "Próximo", milestone.status === "blocked" ? "red" : "amber")}</div><p><a class="link-button" href="#projects/${project.id}">${escapeHTML(project.name)}</a> · ${escapeHTML(milestone.due)}</p><div class="list-meta"><span>Responsable: ${escapeHTML(milestone.owner)}</span><span>Salida: ${escapeHTML(milestone.exit)}</span></div></article>`).join("")}</div></section>
        <section class="card" aria-labelledby="recent-title"><div class="section-heading"><div><h2 id="recent-title">Actividad reciente</h2><p>Eventos sintéticos de esta muestra.</p></div><a class="link-button" href="#activity">Ver todo ${icon("arrow")}</a></div><div class="activity-compact">${activities.slice(0, 3).map((item) => activityRow(item, true)).join("")}</div></section>
      </div>
    </div>`;
}

function selectOptions(values, selected, allLabel) {
  return `<option value="">${escapeHTML(allLabel)}</option>${values.map((entry) => {
    const value = typeof entry === "string" ? entry : entry.value;
    const label = typeof entry === "string" ? entry : entry.label;
    return `<option value="${escapeHTML(value)}" ${selected === value ? "selected" : ""}>${escapeHTML(label)}</option>`;
  }).join("")}`;
}

function renderContacts() {
  const filters = state.filters.contacts;
  const search = filters.search.trim().toLocaleLowerCase("es");
  const list = leads.filter((lead) => {
    const text = [lead.person, lead.company, lead.need, lead.source, lead.owner].join(" ").toLocaleLowerCase("es");
    if (search && !text.includes(search)) return false;
    if (filters.status && lead.status !== filters.status) return false;
    if (filters.source && lead.source !== filters.source) return false;
    if (filters.industry && lead.industry !== filters.industry) return false;
    if (filters.owner && lead.owner !== filters.owner) return false;
    if (filters.due === "overdue" && !(lead.nextDue && lead.nextDue.slice(0, 10) < "2026-10-05")) return false;
    if (filters.due === "today" && !(lead.nextDue && lead.nextDue.slice(0, 10) === "2026-10-05")) return false;
    if (filters.due === "upcoming" && !(lead.nextDue && lead.nextDue.slice(0, 10) > "2026-10-05")) return false;
    return true;
  });
  const pipeline = LEAD_STATUSES.map(([id, label]) => `<div class="pipeline-card"><strong>${leads.filter((lead) => lead.status === id).length}</strong><span>${escapeHTML(label)}</span></div>`).join("");
  const rows = list.map((lead) => {
    const overdue = lead.nextDue && lead.nextDue.slice(0, 10) < "2026-10-05";
    const due = lead.nextDue ? `${lead.nextDue.slice(8, 10)} oct · ${lead.nextDue.slice(11, 16)}${overdue ? " · vencida" : ""}` : "Sin próximo paso";
    return `<tr>
      <td><a class="table-primary" href="#contacts/${lead.id}">${escapeHTML(lead.company)}</a><span class="table-secondary">${escapeHTML(lead.person)}</span>${lead.duplicateOf ? `<span class="table-secondary">Posible duplicado</span>` : ""}</td>
      <td>${badge(statusLabel(lead.status), statusTone(lead.status))}</td>
      <td>${escapeHTML(lead.source)}<span class="table-secondary">${escapeHTML(lead.channel)} · ${escapeHTML(lead.industry)}</span></td>
      <td>${escapeHTML(lead.owner)}</td>
      <td class="table-next ${overdue ? "table-overdue" : "table-upcoming"}">${escapeHTML(lead.nextAction || "Sin acción") }<span class="table-secondary">${escapeHTML(due)}</span></td>
      <td><a class="link-button" href="#contacts/${lead.id}" aria-label="Abrir ${escapeHTML(lead.company)}">Abrir ${icon("arrow")}</a></td>
    </tr>`;
  }).join("");
  return `
    ${pageHeading("CRM liviano · datos ficticios", "Contactos", "Leads, origen, responsable y próxima acción. Los recordatorios son humanos; no se envían mensajes.", `<button class="quiet-button" type="button" data-action="new-lead-note">${icon("contacts")} Nota interna demo</button>`)}
    <div class="pipeline-row" aria-label="Cantidad de leads por estado en los fixtures">${pipeline}</div>
    <form class="filter-panel" id="contact-filters" aria-label="Filtros de contactos">
      <div class="field grow"><label for="lead-search">Buscar persona, empresa o necesidad</label><input id="lead-search" type="search" placeholder="Ej. Lumen, reservas…" value="${escapeHTML(filters.search)}" data-filter="contacts.search" data-focus-key="contacts.search" /></div>
      <div class="field"><label for="lead-status">Estado</label><select id="lead-status" data-filter="contacts.status">${selectOptions(LEAD_STATUSES.map(([id, label]) => ({ value: id, label })), filters.status, "Todos")}</select></div>
      <div class="field"><label for="lead-source">Fuente / canal</label><select id="lead-source" data-filter="contacts.source">${selectOptions([...new Set(leads.map((lead) => lead.source))], filters.source, "Todas")}</select></div>
      <div class="field"><label for="lead-industry">Rubro</label><select id="lead-industry" data-filter="contacts.industry">${selectOptions([...new Set(leads.map((lead) => lead.industry))], filters.industry, "Todos")}</select></div>
      <div class="field"><label for="lead-owner">Responsable</label><select id="lead-owner" data-filter="contacts.owner">${selectOptions([...new Set(leads.map((lead) => lead.owner))], filters.owner, "Todos")}</select></div>
      <div class="field"><label for="lead-due">Próxima acción</label><select id="lead-due" data-filter="contacts.due">${selectOptions([{ value: "today", label: "Vence hoy" }, { value: "overdue", label: "Vencida" }, { value: "upcoming", label: "Próximamente" }], filters.due, "Cualquiera")}</select></div>
    </form>
    <div class="section-heading"><div><h2>Pipeline de contactos</h2><p>${list.length} resultado${list.length === 1 ? "" : "s"} en fixtures sintéticos · estado ganado no crea un proyecto.</p></div><span class="demo-label">Muestra local</span></div>
    ${list.length ? `<div class="table-wrap"><table><caption class="tiny" style="position:absolute;left:-9999px">Contactos ficticios con estado, fuente, dueño y próximo paso</caption><thead><tr><th scope="col">Empresa / persona</th><th scope="col">Estado</th><th scope="col">Fuente · rubro</th><th scope="col">Responsable</th><th scope="col">Próxima acción · vencimiento</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty-state"><strong>No hay contactos con esos filtros</strong><p>Quitá algún filtro o cambiá la búsqueda. Los datos de la demo no se alteraron.</p></div>`}`;
}

function renderLeadDetail(id) {
  const lead = getLead(id);
  if (!lead) return `<div class="empty-state"><strong>No encontramos ese contacto</strong><p>Volvé a la lista de contactos.</p><a class="link-button" href="#contacts">Ir a Contactos ${icon("arrow")}</a></div>`;
  const duplicate = lead.duplicateOf ? getLead(lead.duplicateOf) : null;
  const due = lead.nextDue ? `${lead.nextDue.slice(8, 10)} oct 2026 · ${lead.nextDue.slice(11, 16)} (estimado)` : "Sin fecha";
  const proposal = lead.proposal ? `<div class="list-card"><div class="list-card-head"><h3>Propuesta ${escapeHTML(lead.proposal.version)}</h3>${badge(lead.proposal.status, "blue")}</div><p>Estado comercial separado de cualquier pago. No hay importe disponible en el fixture.</p><div class="list-meta"><span>Moneda preferida: ${escapeHTML(lead.proposal.currency)}</span><span>Valor: no disponible</span></div></div>` : `<div class="empty-state"><strong>No hay propuesta en esta muestra</strong><p>Una hipótesis de alcance no equivale a una oferta enviada.</p></div>`;
  return `
    <a class="detail-back" href="#contacts">${icon("back")} Volver a Contactos</a>
    ${pageHeading("Ficha de contacto · demo", lead.company, lead.need, `<button class="quiet-button" type="button" data-action="record-next-step" data-id="${lead.id}">${icon("calendar")} Registrar próximo paso</button><button class="primary-button" type="button" data-action="convert-lead" data-id="${lead.id}">Revisar gate de proyecto</button>`)}
    <div class="detail-grid">
      <div class="detail-stack">
        <section class="card"><div class="detail-title-row"><div><h2>${escapeHTML(lead.person)}</h2><p class="small subtle">${escapeHTML(lead.company)} · contacto de muestra</p></div>${badge(statusLabel(lead.status), statusTone(lead.status))}</div><div class="divider"></div><div class="info-grid">
          <div class="info-item"><span>Necesidad</span><strong>${escapeHTML(lead.need)}</strong></div><div class="info-item"><span>Fuente / canal</span><strong>${escapeHTML(lead.source)} · ${escapeHTML(lead.channel)}</strong></div>
          <div class="info-item"><span>Rubro</span><strong>${escapeHTML(lead.industry)}</strong></div><div class="info-item"><span>Consentimiento</span><strong>${escapeHTML(lead.consent)}</strong></div>
          <div class="info-item"><span>Idioma / moneda</span><strong>${escapeHTML(lead.language)} · ${escapeHTML(lead.currency)}</strong></div><div class="info-item"><span>Responsable</span><strong>${escapeHTML(lead.owner)}</strong></div>
          <div class="info-item"><span>Estimación / alcance hipotético</span><strong>${escapeHTML(lead.hypotheticalScope)}</strong></div><div class="info-item"><span>Ingresos registrados</span><strong>Sin PaymentRecord recibido</strong></div>
        </div></section>
        ${duplicate ? `<section class="warning-box" aria-label="Posible duplicado"><strong>Posible duplicado · requiere revisión humana</strong><p class="no-margin">Coincidencia sintética con <a class="link-button" href="#contacts/${duplicate.id}">${escapeHTML(duplicate.company)}</a>. No se fusiona ni se borra desde esta demo.</p><div class="button-row" style="margin-top:10px"><button class="quiet-button button-small" type="button" data-action="compare-duplicates" data-id="${lead.id}">Comparar registros</button></div></section>` : ""}
        <section class="card"><div class="section-heading"><div><h2>Actividad cronológica</h2><p>Notas, llamadas y recordatorios con responsable.</p></div></div><div class="timeline">${lead.activity.map((item) => `<div class="timeline-item"><span class="timeline-node"></span><div><p><strong>${escapeHTML(item.kind)}</strong> · ${escapeHTML(item.text)}</p><p class="meta">${escapeHTML(item.date)} · ${escapeHTML(item.owner)}</p></div></div>`).join("")}</div></section>
        <section class="card"><div class="section-heading"><div><h2>Propuesta y preventa</h2><p>Prometido, propuesto/facturado y cobrado tienen registros separados.</p></div></div>${proposal}</section>
      </div>
      <aside class="detail-stack" aria-label="Próximos pasos y reglas">
        <section class="card"><div class="section-heading"><div><h2>Próximo paso</h2><p>Dueño y vencimiento del recordatorio humano.</p></div>${icon("calendar")}</div><div class="list-card"><h3>${escapeHTML(lead.nextAction || "Sin acción definida")}</h3><p>${escapeHTML(due)}</p><div class="list-meta"><span>Responsable: ${escapeHTML(lead.owner)}</span><span>No se envía mensaje</span></div></div><div class="divider"></div><p class="tiny"><strong>Recordatorios:</strong> respuesta → llamada el mismo día; propuesta en 24 h; seguimientos +2 / +5 / +9 según configuración.</p></section>
        <section class="card"><div class="section-heading"><div><h2>Gate de conversión</h2><p>Un estado “ganado” por sí solo no crea un proyecto.</p></div></div><div class="warning-box">Se requiere acuerdo aceptado y registro explícito de seña. El fixture no afirma que haya un cobro.</div><button class="quiet-button button-small" type="button" data-action="convert-lead" data-id="${lead.id}" style="margin-top:12px">Probar validación en modo demo</button></section>
        <section class="info-box"><strong>Modo mock</strong><p class="no-margin">Las acciones solo muestran una confirmación temporal. No envían correo, WhatsApp ni crean un registro comercial.</p></section>
      </aside>
    </div>`;
}

function renderProjects() {
  const filters = state.filters.projects;
  const search = filters.search.trim().toLocaleLowerCase("es");
  const list = projects.filter((project) => {
    const text = [project.name, project.client, project.owner, project.nextAction, project.milestone].join(" ").toLocaleLowerCase("es");
    if (search && !text.includes(search)) return false;
    if (filters.client && project.client !== filters.client) return false;
    if (filters.stage && project.stage !== filters.stage) return false;
    if (filters.owner && project.owner !== filters.owner) return false;
    if (filters.blocked === "yes" && !project.blocked) return false;
    if (filters.blocked === "no" && project.blocked) return false;
    if (filters.action === "overdue" && !(project.nextDue && project.nextDue < "2026-10-05")) return false;
    if (filters.action === "upcoming" && !(project.nextDue && project.nextDue >= "2026-10-05")) return false;
    if (filters.milestone && project.milestone !== filters.milestone) return false;
    return true;
  });
  const rows = list.map((project) => `<tr>
    <td><a class="table-primary" href="#projects/${project.id}">${escapeHTML(project.name)}</a><span class="table-secondary">${escapeHTML(project.client)}</span></td>
    <td>${badge(project.stageLabel, project.blocked ? "red" : statusTone(project.stage))}<span class="table-secondary">Cliente: ${escapeHTML(project.clientStage)}</span></td>
    <td>${escapeHTML(project.owner)}</td>
    <td class="table-next ${project.nextDue < "2026-10-05" ? "table-overdue" : "table-upcoming"}">${escapeHTML(project.nextAction)}<span class="table-secondary">Est. ${escapeHTML(project.nextDue.slice(8, 10))} oct · ${escapeHTML(project.milestone)}</span></td>
    <td>${project.blocked ? badge("Bloqueado", "red") : badge("Sin bloqueo", "green")}</td>
    <td><a class="link-button" href="#projects/${project.id}" aria-label="Abrir ${escapeHTML(project.name)}">Abrir ${icon("arrow")}</a></td>
  </tr>`).join("");
  return `
    ${pageHeading("Entrega · alcance y estado", "Proyectos", "Supervisión operativa con estado interno separado de lo que se proyecta al cliente.", `<span class="demo-label">${projects.length} fixtures sintéticos</span>`)}
    <form class="filter-panel" aria-label="Filtros de proyectos">
      <div class="field grow"><label for="project-search">Buscar cliente o proyecto</label><input id="project-search" type="search" placeholder="Nombre, responsable, próxima acción…" value="${escapeHTML(filters.search)}" data-filter="projects.search" data-focus-key="projects.search" /></div>
      <div class="field"><label for="project-client">Cliente</label><select id="project-client" data-filter="projects.client">${selectOptions([...new Set(projects.map((project) => project.client))], filters.client, "Todos")}</select></div>
      <div class="field"><label for="project-stage">Estado interno</label><select id="project-stage" data-filter="projects.stage">${selectOptions(PROJECT_STAGES.map(([value, label]) => ({ value, label })), filters.stage, "Todos")}</select></div>
      <div class="field"><label for="project-owner">Responsable</label><select id="project-owner" data-filter="projects.owner">${selectOptions([...new Set(projects.map((project) => project.owner))], filters.owner, "Todos")}</select></div>
      <div class="field"><label for="project-action">Próxima acción</label><select id="project-action" data-filter="projects.action">${selectOptions([{ value: "overdue", label: "Vencida" }, { value: "upcoming", label: "Próxima" }], filters.action, "Cualquiera")}</select></div>
      <div class="field"><label for="project-blocked">Bloqueo</label><select id="project-blocked" data-filter="projects.blocked">${selectOptions([{ value: "yes", label: "Con bloqueo" }, { value: "no", label: "Sin bloqueo" }], filters.blocked, "Todos")}</select></div>
      <div class="field"><label for="project-milestone">Hito</label><select id="project-milestone" data-filter="projects.milestone">${selectOptions([...new Set(projects.map((project) => project.milestone))], filters.milestone, "Todos")}</select></div>
    </form>
    <div class="section-heading"><div><h2>Lista operativa</h2><p>${list.length} resultado${list.length === 1 ? "" : "s"}. Las fechas están marcadas como estimadas.</p></div></div>
    ${list.length ? `<div class="table-wrap"><table><caption class="tiny" style="position:absolute;left:-9999px">Proyectos de demostración, con estado, próximo paso y bloqueo</caption><thead><tr><th scope="col">Proyecto / cliente</th><th scope="col">Estado interno · proyección</th><th scope="col">Responsable</th><th scope="col">Próxima acción · hito</th><th scope="col">Bloqueo</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty-state"><strong>No hay proyectos con esos filtros</strong><p>Probá otra combinación. Los fixtures no se modificaron.</p></div>`}
    <section class="info-box section-block"><strong>Conversión comercial:</strong> estos proyectos son fixtures aislados, no conversiones de leads. En el flujo real se requiere acuerdo aceptado y registro explícito de seña antes de crear un proyecto.</section>`;
}

const PROJECT_TABS = [
  ["summary", "Resumen"], ["scope", "Alcance / versiones"], ["timeline", "Hitos"],
  ["changes", "Decisiones / cambios"], ["risks", "Riesgos / bloqueos"],
  ["activity", "Actividad"], ["documents", "Documentos"], ["publish", "Publicación al cliente"],
];

function renderProjectDetail(id) {
  const project = getProject(id);
  if (!project) return `<div class="empty-state"><strong>No encontramos ese proyecto</strong><p>Volvé a la lista de proyectos.</p><a class="link-button" href="#projects">Ir a Proyectos ${icon("arrow")}</a></div>`;
  const selectedTab = PROJECT_TABS.some(([tab]) => tab === state.projectTab) ? state.projectTab : "summary";
  const tabs = PROJECT_TABS.map(([tab, label]) => `<button class="tab-button" type="button" role="tab" aria-selected="${selectedTab === tab}" aria-controls="project-tab-panel" id="tab-${tab}" data-action="project-tab" data-tab="${tab}">${label}</button>`).join("");
  let tabContent = "";
  switch (selectedTab) {
    case "scope": tabContent = projectScope(project); break;
    case "timeline": tabContent = projectTimeline(project); break;
    case "changes": tabContent = projectChanges(project); break;
    case "risks": tabContent = projectRisks(project); break;
    case "activity": tabContent = projectActivity(project); break;
    case "documents": tabContent = projectDocuments(project); break;
    case "publish": tabContent = projectPublish(project); break;
    default: tabContent = projectSummary(project);
  }
  return `
    <a class="detail-back" href="#projects">${icon("back")} Volver a Proyectos</a>
    ${pageHeading("Ficha operativa · fixture sintético", project.name, project.summary, `<button class="quiet-button" type="button" data-action="pause-project" data-id="${project.id}">Pausar en demo</button><button class="primary-button" type="button" data-action="new-change" data-id="${project.id}">Solicitar cambio de alcance</button>`)}
    <section class="card" style="margin-bottom:14px"><div class="detail-title-row"><div><p class="eyebrow">${escapeHTML(project.client)}</p><h2>${escapeHTML(project.stageLabel)} ${project.blocked ? badge("Bloqueado", "red") : ""}</h2><p class="small subtle">Responsable: ${escapeHTML(project.owner)} · Próxima acción: ${escapeHTML(project.nextAction)}</p></div><div class="audience-row"><span class="demo-label">Modo mock</span></div></div><div class="divider"></div>
      <div class="stage-sequence" aria-label="Flujo del proyecto">${PROJECT_STAGES.map(([idValue, label]) => `<span class="stage-step ${project.stage === idValue ? "active" : ""}">${escapeHTML(label)}</span>`).join(`<span class="stage-arrow" aria-hidden="true">→</span>`)}</div>
      <div class="info-grid" style="margin-top:14px"><div class="info-item"><span>Estado interno</span><strong>${escapeHTML(project.stageLabel)}${project.blocked ? " · con bloqueo" : ""}</strong></div><div class="info-item"><span>Proyección visible al cliente</span><strong>${escapeHTML(project.clientStage)} · nunca se expone por defecto</strong></div><div class="info-item"><span>Próximo hito</span><strong>${escapeHTML(project.milestone)} · Est. ${escapeHTML(project.nextDue.slice(8, 10))} oct</strong></div><div class="info-item"><span>Fechas de proyecto</span><strong>${escapeHTML(project.estimatedStart)} — ${escapeHTML(project.estimatedDue)}</strong></div></div>
      ${project.blocked ? `<div class="warning-box" style="margin-top:14px"><strong>Bloqueo:</strong> ${escapeHTML(project.blockers[0]?.cause || "Causa pendiente.")} <span class="tiny">Revisión: ${escapeHTML(project.blockers[0]?.review || "sin fecha")}</span></div>` : ""}
    </section>
    <div class="tabs" role="tablist" aria-label="Secciones del proyecto">${tabs}</div>
    <section id="project-tab-panel" role="tabpanel" aria-labelledby="tab-${selectedTab}" tabindex="0" style="margin-top:14px">${tabContent}</section>`;
}

function projectSummary(project) {
  const nextMilestone = project.milestones.find((milestone) => milestone.status !== "done");
  return `<div class="detail-grid"><div class="detail-stack">
    <section class="card"><div class="section-heading"><div><h2>Resumen de entrega</h2><p>Etapa interna, criterio actual y próxima acción.</p></div>${badge(project.stageLabel, statusTone(project.stage))}</div><p class="small">${escapeHTML(project.summary)}</p><div class="info-grid"><div class="info-item"><span>Entrada de etapa</span><strong>${escapeHTML(nextMilestone?.entry || "Alcance y condiciones revisados")}</strong></div><div class="info-item"><span>Salida esperada</span><strong>${escapeHTML(nextMilestone?.exit || "Criterio de cierre pendiente")}</strong></div><div class="info-item"><span>Responsable de etapa</span><strong>${escapeHTML(nextMilestone?.owner || project.owner)}</strong></div><div class="info-item"><span>Evidencia</span><strong>${escapeHTML(nextMilestone?.evidence || "Sin evidencia registrada")}</strong></div></div></section>
    <section class="card"><div class="section-heading"><div><h2>Alcance vigente</h2><p>${escapeHTML(project.scopeVersion)} · no habilita trabajo adicional.</p></div><button class="link-button" type="button" data-action="project-tab" data-tab="scope">Ver versiones ${icon("arrow")}</button></div><div class="stack-list">${project.scope.map((item) => `<div class="list-card"><p class="no-margin">${escapeHTML(item)}</p></div>`).join("")}</div></section>
    <section class="card"><div class="section-heading"><div><h2>Próxima acción</h2><p>Fecha estimada; dueño explícito.</p></div></div><div class="list-card"><h3>${escapeHTML(project.nextAction)}</h3><div class="list-meta"><span>Responsable: ${escapeHTML(project.owner)}</span><span>Vence: Est. ${escapeHTML(project.nextDue.slice(8, 10))} oct 2026</span></div></div></section>
  </div><aside class="detail-stack">
    <section class="card"><div class="section-heading"><div><h2>Estado comercial</h2><p>Datos ficticios; no implica cobro real.</p></div></div><div class="info-box">${escapeHTML(project.depositGate)}</div><p class="tiny" style="margin-top:10px">Las métricas de dinero permanecen vacías hasta tener registros de pago con estado y fuente.</p></section>
    <section class="card"><div class="section-heading"><div><h2>Decisiones</h2><p>Acuerdos operativos de la muestra.</p></div></div>${project.decisions.length ? project.decisions.map((decision) => `<div class="list-card"><h3>${escapeHTML(decision.title)}</h3><p>${escapeHTML(decision.outcome)}</p><div class="list-meta"><span>${escapeHTML(decision.date)}</span><span>${escapeHTML(decision.owner)}</span></div></div>`).join("") : `<div class="empty-state"><strong>Sin decisiones registradas</strong><p>No se inventan acuerdos.</p></div>`}</section>
  </aside></div>`;
}

function projectScope(project) {
  return `<div class="detail-grid"><section class="card"><div class="section-heading"><div><h2>Versiones de alcance</h2><p>La versión aceptada limita el trabajo comprometido.</p></div>${badge(project.scopeVersion.split(" · ")[0], "green")}</div><div class="list-card"><div class="list-card-head"><h3>${escapeHTML(project.scopeVersion)}</h3>${badge("Aceptada · fixture", "green")}</div><p>Resumen: ${escapeHTML(project.summary)}</p><p><strong>Incluye</strong></p><ul class="check-list">${project.scope.map((item) => `<li><span class="check-mark">✓</span>${escapeHTML(item)}</li>`).join("")}</ul><p><strong>Excluye</strong></p><ul class="check-list">${project.excluded.map((item) => `<li><span class="check-mark check-pending">–</span>${escapeHTML(item)}</li>`).join("")}</ul></div><div class="warning-box" style="margin-top:12px">Los cambios siguen solicitud → evaluación de costo/plazo → oferta → aceptación explícita → nueva versión. No se habilita trabajo extra automáticamente.</div></section><aside class="card"><h2>Historial de versiones</h2><div class="timeline" style="margin-top:14px"><div class="timeline-item"><span class="timeline-node"></span><div><p><strong>${escapeHTML(project.scopeVersion)}</strong></p><p class="meta">Fixture sintético · no hay documento real enlazado.</p></div></div><div class="timeline-item"><span class="timeline-node"></span><div><p><strong>Versión anterior</strong></p><p class="meta">Sin evidencia de una versión anterior en esta muestra.</p></div></div></div></aside></div>`;
}

function projectTimeline(project) {
  return `<section class="card"><div class="section-heading"><div><h2>Hitos y cronograma</h2><p>Criterios de entrada/salida, responsable y evidencia. Todas las fechas son estimadas.</p></div></div><div class="stack-list">${project.milestones.map((milestone) => `<article class="list-card"><div class="list-card-head"><h3>${escapeHTML(milestone.title)}</h3>${badge(milestone.status === "done" ? "Completado" : milestone.status === "blocked" ? "Bloqueado" : milestone.status === "in_progress" ? "En curso" : "Próximo", statusTone(milestone.status))}</div><div class="info-grid" style="margin-top:12px"><div class="info-item"><span>Fecha</span><strong>${escapeHTML(milestone.due)}</strong></div><div class="info-item"><span>Responsable</span><strong>${escapeHTML(milestone.owner)}</strong></div><div class="info-item"><span>Criterio de entrada</span><strong>${escapeHTML(milestone.entry)}</strong></div><div class="info-item"><span>Criterio de salida</span><strong>${escapeHTML(milestone.exit)}</strong></div><div class="info-item"><span>Evidencia</span><strong>${escapeHTML(milestone.evidence)}</strong></div></div></article>`).join("")}</div></section>`;
}

function projectChanges(project) {
  return `<div class="detail-grid"><div class="detail-stack"><section class="card"><div class="section-heading"><div><h2>Decisiones registradas</h2><p>Solo decisiones explícitas en el fixture.</p></div></div>${project.decisions.length ? `<div class="stack-list">${project.decisions.map((decision) => `<article class="list-card"><div class="list-card-head"><h3>${escapeHTML(decision.title)}</h3>${badge("Registrada", "blue")}</div><p>${escapeHTML(decision.outcome)}</p><div class="list-meta"><span>${escapeHTML(decision.date)}</span><span>Responsable: ${escapeHTML(decision.owner)}</span></div></article>`).join("")}</div>` : `<div class="empty-state"><strong>Sin decisiones registradas</strong><p>No se infiere aceptación de una conversación o una propuesta.</p></div>`}</section>
    <section class="card"><div class="section-heading"><div><h2>Solicitudes de cambio</h2><p>Una solicitud no equivale a oferta aceptada.</p></div><button class="quiet-button button-small" type="button" data-action="new-change" data-id="${project.id}">Nueva solicitud</button></div>${project.changes.length ? `<div class="stack-list">${project.changes.map((change) => `<article class="list-card"><div class="list-card-head"><h3>${escapeHTML(change.title)}</h3>${badge(change.status, "amber")}</div><p>${escapeHTML(change.detail)}</p><div class="list-meta"><span>Trabajo extra: no aprobado</span><span>Impacto costo/plazo: pendiente</span></div><div class="button-row" style="margin-top:10px"><button class="quiet-button button-small" type="button" data-action="evaluate-change" data-id="${project.id}">Evaluar impacto</button><button class="quiet-button button-small" type="button" disabled title="Requiere una oferta explícita previa">Aceptar cambio · requiere oferta previa</button></div></article>`).join("")}</div>` : `<div class="empty-state"><strong>No hay solicitudes de cambio</strong><p>Si aparece una, requiere evaluación de costo y plazo antes de ofertarla.</p></div>`}</section></div>
    <aside class="warning-box"><strong>Flujo obligatorio</strong><ol><li>Solicitud</li><li>Evaluación de costo y plazo</li><li>Oferta</li><li>Aceptación explícita</li><li>Nueva versión de alcance</li></ol><p class="no-margin">En esta demo ninguna etapa autoriza trabajo adicional.</p></aside></div>`;
}

function projectRisks(project) {
  const blockers = project.blockers.length ? `<div class="stack-list">${project.blockers.map((blocker) => `<article class="list-card"><div class="list-card-head"><h3>${escapeHTML(blocker.title)}</h3>${badge(blocker.status, "red")}</div><p>${escapeHTML(blocker.cause)}</p><div class="list-meta"><span>Responsable: ${escapeHTML(blocker.owner)}</span><span>Revisión: ${escapeHTML(blocker.review)}</span></div></article>`).join("")}</div>` : `<div class="empty-state"><strong>Sin bloqueos abiertos</strong><p>Si se pausa un proyecto, se exige causa y fecha de revisión.</p></div>`;
  return `<div class="detail-grid"><section class="card"><div class="section-heading"><div><h2>Bloqueos</h2><p>La causa, responsable y fecha de revisión deben quedar explícitos.</p></div><button class="quiet-button button-small" type="button" data-action="pause-project" data-id="${project.id}">Registrar pausa demo</button></div>${blockers}</section><section class="card"><div class="section-heading"><div><h2>Riesgos</h2><p>Sin predicciones ni datos fuera del fixture.</p></div></div>${project.risks.length ? `<div class="stack-list">${project.risks.map((risk) => `<article class="list-card"><div class="list-card-head"><h3>${escapeHTML(risk.title)}</h3>${badge(risk.status, "amber")}</div><p>${escapeHTML(risk.mitigation)}</p><div class="list-meta"><span>Impacto: ${escapeHTML(risk.impact)}</span><span>Responsable: ${escapeHTML(risk.owner)}</span></div></article>`).join("")}</div>` : `<div class="empty-state"><strong>Sin riesgos registrados</strong><p>No hay elementos para mostrar.</p></div>`}</section></div>`;
}

function projectActivity(project) {
  const items = [...project.activity, ...activities.filter((item) => item.href === `#projects/${project.id}`).map((item) => ({ kind: item.type, text: item.title, date: item.date, owner: item.owner }))];
  return `<section class="card"><div class="section-heading"><div><h2>Actividad del proyecto</h2><p>Registro de muestra; auditoría real requiere backend.</p></div></div>${items.length ? `<div class="timeline">${items.map((item) => `<div class="timeline-item"><span class="timeline-node"></span><div><p><strong>${escapeHTML(item.kind)}</strong> · ${escapeHTML(item.text)}</p><p class="meta">${escapeHTML(item.date)} · ${escapeHTML(item.owner)}</p></div></div>`).join("")}</div>` : `<div class="empty-state"><strong>Sin actividad registrada</strong><p>Los eventos reales se conectan a AuditEvent más adelante.</p></div>`}</section>`;
}

function documentCard(artifact, showActions = true) {
  return `<article class="document-card"><div class="list-card-head"><div><h3>${escapeHTML(artifact.title)}</h3><p class="tiny">${escapeHTML(artifact.project)}</p></div>${badge(artifact.audience, artifact.audience === "Interna" ? "neutral" : "green")}</div><div class="document-meta"><span>${escapeHTML(artifact.category)}</span><span>${escapeHTML(artifact.version)}</span><span>${escapeHTML(artifact.author)}</span><span>${escapeHTML(artifact.date)}</span><span>${escapeHTML(artifact.related)}</span></div><p class="document-note">${escapeHTML(artifact.note)}</p><p class="tiny">${escapeHTML(artifact.history)}</p>${showActions ? `<div class="document-actions"><button class="quiet-button button-small" type="button" data-action="artifact-action" data-kind="preview" data-id="${artifact.id}">Vista previa</button><button class="quiet-button button-small" type="button" data-action="artifact-action" data-kind="update" data-id="${artifact.id}">Preparar actualización</button><button class="quiet-button button-small" type="button" data-action="artifact-action" data-kind="file" data-id="${artifact.id}">Archivo publicable</button></div>` : ""}</article>`;
}

function projectDocuments(project) {
  const list = getProjectArtifacts(project.id);
  return `<section class="card"><div class="section-heading"><div><h2>Documentos del proyecto</h2><p>Audiencia interna por defecto; no se abren archivos reales.</p></div><div class="button-row"><button class="quiet-button button-small" type="button" data-action="artifact-action" data-kind="note" data-id="${project.id}">Nota interna</button><button class="quiet-button button-small" type="button" data-action="artifact-action" data-kind="response" data-id="${project.id}">Solicitar respuesta</button></div></div><div class="document-grid">${list.map((artifact) => documentCard(artifact)).join("")}</div></section>`;
}

function projectPublish(project) {
  const visible = getProjectArtifacts(project.id).filter((artifact) => artifact.audience === "Cliente");
  return `<div class="detail-grid"><section class="card"><div class="section-heading"><div><h2>Vista previa de cliente</h2><p>Solo aparecería contenido aprobado explícitamente para esta audiencia.</p></div>${badge("Vista previa", "blue")}</div><div class="client-preview"><div class="client-preview-header"><strong>${escapeHTML(project.name)}</strong><span class="tiny">Última actualización: sin publicar</span></div><div class="client-preview-body">${visible.length ? visible.map((artifact) => `<article class="list-card"><h3>${escapeHTML(artifact.title)}</h3><p>${escapeHTML(artifact.note)}</p></article>`).join("") : `<div class="empty-state"><strong>No hay contenido visible</strong><p>Las notas internas y archivos de este proyecto no aparecen en la perspectiva del cliente.</p></div>`}</div></div><div class="warning-box" style="margin-top:12px"><strong>Antes de publicar:</strong> revisar audiencia, contenido y proyecto; confirmar de forma explícita. En el modo mock, la confirmación no publica ni crea enlaces.</div></section>
    <aside class="card"><div class="section-heading"><div><h2>Acciones separadas</h2><p>Ninguna acción real está conectada.</p></div></div><div class="stack-list"><button class="quiet-button" type="button" data-action="artifact-action" data-kind="note" data-id="${project.id}">Guardar nota interna</button><button class="quiet-button" type="button" data-action="artifact-action" data-kind="update" data-id="${project.id}">Preparar actualización publicable</button><button class="quiet-button" type="button" data-action="artifact-action" data-kind="file" data-id="${project.id}">Preparar archivo publicable</button><button class="quiet-button" type="button" data-action="artifact-action" data-kind="response" data-id="${project.id}">Preparar solicitud de respuesta</button><button class="quiet-button" type="button" data-action="artifact-action" data-kind="stage" data-id="${project.id}">Preparar visibilidad de etapa</button></div><p class="tiny" style="margin-top:12px">Historial de demo: correcciones y retiros quedan visibles en los metadatos. Ningún recurso de esta muestra se hizo visible a clientes.</p></aside></div>`;
}

function renderActivity() {
  const filters = state.filters.activity;
  const query = filters.search.trim().toLocaleLowerCase("es");
  const list = activities.filter((item) => {
    const text = [item.title, item.detail, item.owner, item.type].join(" ").toLocaleLowerCase("es");
    return (!query || text.includes(query)) && (!filters.type || item.type === filters.type) && (!filters.owner || item.owner === filters.owner);
  });
  return `
    ${pageHeading("Eventos y próximos pasos · mock", "Actividad", "Cronología de llamadas, propuestas, hitos, bloqueos y decisiones. Los recordatorios no envían mensajes.")}
    <form class="filter-panel" aria-label="Filtros de actividad">
      <div class="field grow"><label for="activity-search">Buscar en actividad</label><input id="activity-search" type="search" value="${escapeHTML(filters.search)}" placeholder="Evento, registro o responsable…" data-filter="activity.search" data-focus-key="activity.search" /></div>
      <div class="field"><label for="activity-type">Tipo de evento</label><select id="activity-type" data-filter="activity.type">${selectOptions([...new Set(activities.map((item) => item.type))], filters.type, "Todos")}</select></div>
      <div class="field"><label for="activity-owner">Responsable</label><select id="activity-owner" data-filter="activity.owner">${selectOptions([...new Set(activities.map((item) => item.owner))], filters.owner, "Todos")}</select></div>
    </form>
    <section class="card"><div class="section-heading"><div><h2>Registro cronológico</h2><p>${list.length} eventos sintéticos. La auditoría de producción requiere backend.</p></div><span class="demo-label">Solo lectura</span></div>${list.length ? `<div class="timeline">${list.map((item) => `<div class="timeline-item"><span class="timeline-node"></span><div><p><strong>${escapeHTML(item.type)}</strong> · ${escapeHTML(item.title)}</p><p class="small subtle">${escapeHTML(item.detail)}</p><p class="meta">${escapeHTML(item.date)} · Responsable: ${escapeHTML(item.owner)} · <a class="link-button" href="${item.href}">Abrir registro ${icon("arrow")}</a></p></div></div>`).join("")}</div>` : `<div class="empty-state"><strong>No hay actividad con esos filtros</strong><p>Quitá filtros o buscá otro término.</p></div>`}</section>
    <section class="info-box section-block"><strong>Regla de seguimiento:</strong> respuesta → llamada el mismo día; propuesta en 24 h; seguimientos +2/+5/+9 según configuración. Es un recordatorio humano; no hay envío automático.</section>`;
}

function renderDocuments() {
  const filters = state.filters.documents;
  const query = filters.search.trim().toLocaleLowerCase("es");
  const list = artifacts.filter((artifact) => {
    const text = [artifact.title, artifact.project, artifact.category, artifact.author, artifact.related].join(" ").toLocaleLowerCase("es");
    return (!query || text.includes(query)) && (!filters.project || artifact.projectId === filters.project) && (!filters.category || artifact.category === filters.category) && (!filters.audience || artifact.audience === filters.audience);
  });
  return `
    ${pageHeading("Búsqueda contextual · audiencia interna por defecto", "Documentos", "Metadatos por proyecto, categoría, versión y hito. La demo no abre archivos reales ni publica enlaces.", `<button class="quiet-button" type="button" data-action="artifact-action" data-kind="note" data-id="none">${icon("documents")} Nota interna</button><button class="primary-button" type="button" data-action="artifact-action" data-kind="update" data-id="none">Preparar actualización</button>`)}
    <form class="filter-panel" aria-label="Filtros de documentos">
      <div class="field grow"><label for="document-search">Buscar documento</label><input id="document-search" type="search" value="${escapeHTML(filters.search)}" placeholder="Nombre, proyecto, hito, autor…" data-filter="documents.search" data-focus-key="documents.search" /></div>
      <div class="field"><label for="document-project">Proyecto</label><select id="document-project" data-filter="documents.project">${selectOptions(projects.map((project) => ({ value: project.id, label: project.name })), filters.project, "Todos")}</select></div>
      <div class="field"><label for="document-category">Categoría</label><select id="document-category" data-filter="documents.category">${selectOptions(ARTIFACT_CATEGORIES, filters.category, "Todas")}</select></div>
      <div class="field"><label for="document-audience">Audiencia</label><select id="document-audience" data-filter="documents.audience">${selectOptions(["Interna", "Cliente"], filters.audience, "Todas")}</select></div>
    </form>
    <div class="section-heading"><div><h2>Documentos de muestra</h2><p>${list.length} resultados · audiencia interna inicial · sin URLs públicas.</p></div><span class="demo-label">Sin archivos reales</span></div>
    ${list.length ? `<div class="document-grid">${list.map((artifact) => documentCard(artifact)).join("")}</div>` : `<div class="empty-state"><strong>No hay documentos con esos filtros</strong><p>Probá otra búsqueda. No se consultó ningún almacenamiento.</p></div>`}
    <section class="card section-block"><div class="section-heading"><div><h2>Perspectiva del cliente</h2><p>Solo lo que esté marcado como publicable aparece acá.</p></div><button class="quiet-button button-small" type="button" data-action="client-preview">Abrir vista previa</button></div><div class="client-preview"><div class="client-preview-header"><strong>Proyecto de muestra</strong>${badge("Sin contenido visible", "neutral")}</div><div class="client-preview-body"><div class="empty-state"><strong>No se publicó contenido</strong><p>Los fixtures son internos; una acción de publicación solo muestra un aviso y no cambia esta vista.</p></div></div></div></section>`;
}

function renderHelp() {
  return `
    ${pageHeading("Ayuda interna · sin configuración real", "Ayuda", "Guía breve para operar esta muestra. Los ajustes aparecerán cuando exista una fuente real de permisos y configuración.", `<button class="quiet-button" type="button" data-action="restart-tour">${icon("help")} Reiniciar onboarding</button>`)}
    <div class="detail-grid">
      <section class="card"><div class="section-heading"><div><h2>Cómo usar la demo</h2><p>Recorrido corto; se puede cerrar y volver a abrir.</p></div></div><div class="onboarding-steps">
        <div class="onboarding-step"><div><strong>Priorizar desde Hoy</strong><p>Revisá vencimientos, responsable, bloqueos, aprobaciones e hitos. Abrí el registro para ver el contexto.</p></div></div>
        <div class="onboarding-step"><div><strong>Seguir contactos sin enviar mensajes</strong><p>Filtrá por estado y próxima acción. Posibles duplicados se revisan; la demo no fusiona ni borra.</p></div></div>
        <div class="onboarding-step"><div><strong>Separar estado interno y cliente</strong><p>El contenido comienza interno. Revisá la vista previa y advertencia antes de preparar una acción de publicación.</p></div></div>
        <div class="onboarding-step"><div><strong>Tratar fechas y cifras como desconocidas</strong><p>Las fechas son estimadas y los cinco indicadores muestran “—”: no se inventan ventas, cobros ni proyecciones.</p></div></div>
      </div><div class="divider"></div><p class="tiny">El progreso de cierre del onboarding se guarda en el navegador. No se guarda ningún dato comercial.</p></section>
      <section class="card"><div class="section-heading"><div><h2>Estados de interfaz</h2><p>Ejemplos visuales para la futura conexión con API.</p></div></div><div class="stack-list"><div class="info-box"><strong>Cargando</strong><p class="no-margin">Preparando registros autorizados…</p></div><div class="empty-state"><strong>Vacío</strong><p>No hay próximos pasos para este filtro. Podés ajustar la búsqueda.</p></div><div class="error-box"><strong>Error al cargar</strong><p class="no-margin">No se pudieron traer los datos. La futura UI debe mostrar reintento y request ID.</p></div><div class="warning-box"><strong>Permiso insuficiente</strong><p class="no-margin">No se muestran campos ni conteos sin autorización del servidor.</p></div><div class="success-box"><strong>Acción confirmada</strong><p class="no-margin">Solo cuando el backend confirme la transacción; el toast de esta demo no es confirmación comercial.</p></div></div></section>
    </div>
    <section class="card section-block"><div class="section-heading"><div><h2>Permisos previstos</h2><p>Matriz conceptual. Los roles y usuarios reales quedan pendientes de scoping.</p></div></div><div class="table-wrap"><table class="permission-matrix"><thead><tr><th>Rol</th><th>Contactos / propuestas</th><th>Proyectos</th><th>Publicación</th><th>Cobros / auditoría</th></tr></thead><tbody><tr><td>Owner / Admin</td><td>Configuración y acceso total</td><td>Todos</td><td>Confirmación explícita</td><td>Según autorización</td></tr><tr><td>Sales</td><td>Operación comercial</td><td>Lectura asignada</td><td>Sin publicación por defecto</td><td>Sin acceso por defecto</td></tr><tr><td>Project Lead</td><td>Contexto asignado</td><td>Proyecto asignado</td><td>Prepara y solicita confirmar</td><td>Sin acceso por defecto</td></tr><tr><td>Tech / Delivery</td><td>Contexto mínimo</td><td>Hitos, bloqueos y QA asignados</td><td>Sin publicación por defecto</td><td>Sin acceso por defecto</td></tr><tr><td>Finance / Viewer</td><td>Lectura restringida</td><td>Lectura autorizada</td><td>Sin publicación</td><td>Lectura si se necesita</td></tr></tbody></table></div></section>
    <section class="info-box section-block"><strong>Sin ajustes todavía:</strong> no hay backend, roles reales, hosting ni fuente de datos conectados. No ingreses información real en este prototipo.</section>`;
}

function modalHeader(title, description) {
  return `<div class="modal-header"><div><h2 id="modal-title">${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Cerrar">${icon("close")}</button></div>`;
}

function modalField(id, label, type = "text", placeholder = "", required = true) {
  return `<div class="field"><label for="${id}">${escapeHTML(label)}${required ? " · requerido" : ""}</label><input id="${id}" name="${id}" type="${type}" ${placeholder ? `placeholder="${escapeHTML(placeholder)}"` : ""} ${required ? "required" : ""} /><p class="error-text">Completá este campo para continuar.</p></div>`;
}

function modalTextarea(id, label, placeholder = "") {
  return `<div class="field"><label for="${id}">${escapeHTML(label)} · requerido</label><textarea id="${id}" name="${id}" required placeholder="${escapeHTML(placeholder)}"></textarea><p class="error-text">Completá este campo para continuar.</p></div>`;
}

function modalCheckbox(id, label, required = true) {
  return `<div class="field checkbox-field"><label class="checkbox-row"><input type="checkbox" id="${id}" name="${id}" value="yes" ${required ? "required" : ""} /><span>${escapeHTML(label)}${required ? " · requerido" : ""}</span></label><p class="error-text">Confirmá esta opción para continuar.</p></div>`;
}

function modalForm(modal, title, description, body, submitLabel, submitTone = "primary-button") {
  return `<dialog id="interaction-modal" class="modal" aria-labelledby="modal-title"><div class="modal-content">${modalHeader(title, description)}<form class="modal-form" data-form="${escapeHTML(modal.type)}">${body}<div class="modal-footer"><button class="quiet-button" type="button" data-action="close-modal">Cancelar</button><button class="${submitTone}" type="submit">${escapeHTML(submitLabel)}</button></div></form></div></dialog>`;
}

const onboardingSteps = [
  { title: "Empezá por Hoy", text: "Vas a ver seguimientos, vencidos, bloqueos, aprobaciones e hitos con responsable y acceso al registro." },
  { title: "Respetá los gates comerciales", text: "Un proyecto requiere acuerdo aceptado y registro explícito de seña. En esta demo no se crea ni se afirma un cobro." },
  { title: "Revisá antes de compartir", text: "La audiencia inicial es interna. La vista previa no incluye notas internas; las confirmaciones de esta demo nunca publican contenido." },
];

function modalMarkup(modal) {
  if (modal.type === "onboarding") {
    const step = onboardingSteps[Math.min(modal.step || 0, onboardingSteps.length - 1)];
    const final = (modal.step || 0) >= onboardingSteps.length - 1;
    return `<dialog id="interaction-modal" class="modal" aria-labelledby="modal-title"><div class="modal-content">${modalHeader(`Bienvenida · ${step.title}`, step.text)}<div class="onboarding-steps"><div class="onboarding-step"><div><strong>Datos sintéticos, solo esta sesión</strong><p>No se conecta a clientes, documentos, correo, WhatsApp ni sistemas comerciales.</p></div></div><div class="onboarding-step"><div><strong>La acción no publica</strong><p>Las vistas previas y formularios preparan una demo; no producen efectos fuera de esta pantalla.</p></div></div></div><div class="modal-footer"><button class="quiet-button" type="button" data-action="dismiss-onboarding">Saltar recorrido</button><button class="primary-button" type="button" data-action="next-tour">${final ? "Entrar al portal" : "Continuar"}</button></div><p class="tiny">Paso ${(modal.step || 0) + 1} de ${onboardingSteps.length}</p></div></dialog>`;
  }
  if (modal.type === "next-step") {
    return modalForm(modal, "Registrar próximo paso", "Recordatorio humano para la ficha seleccionada. No se envía ningún mensaje.", `${modalField("step-label", "Acción", "text", "Ej. llamar para validar necesidad")}${modalField("step-due", "Vencimiento estimado", "date")}${modalCheckbox("no-send", "Entiendo que no se enviará correo, WhatsApp ni otro mensaje.")}`, "Validar en modo demo");
  }
  if (modal.type === "convert") {
    const lead = getLead(modal.id);
    return modalForm(modal, "Validar gate de conversión", `${lead ? lead.company : "Este contacto"} · el estado “ganado” no alcanza para crear proyecto.`, `${modalField("agreement-reference", "Referencia de acuerdo aceptado", "text", "Referencia ficticia")}${modalCheckbox("agreement-accepted", "Simular que existe una aceptación explícita de acuerdo.")}${modalCheckbox("deposit-record", "Simular que existe un registro explícito de seña; no afirmar que se cobró.") }<div class="warning-box">Al confirmar solo se valida el flujo de interfaz. No se crea proyecto, no se genera un PaymentRecord y no se registra dinero.</div>`, "Validar gate (sin crear proyecto)");
  }
  if (modal.type === "pause") {
    return modalForm(modal, "Simular pausa de proyecto", "El flujo real exige causa y fecha de revisión. Esta confirmación no cambia el estado.", `${modalTextarea("pause-cause", "Causa de la pausa", "Describe el bloqueo sin datos personales")}${modalField("pause-review", "Fecha de revisión", "date")}${modalCheckbox("pause-confirm", "Entiendo que solo es una simulación temporal; no se persiste la pausa.")}`, "Validar pausa demo");
  }
  if (modal.type === "change-request") {
    return modalForm(modal, "Solicitar cambio de alcance", "Una solicitud todavía no es una oferta aceptada ni habilita trabajo adicional.", `${modalTextarea("change-description", "Solicitud del cambio", "Qué se solicita y por qué")}${modalCheckbox("change-understood", "Entiendo que falta evaluación de costo y plazo, oferta y aceptación explícita.")}`, "Preparar solicitud demo");
  }
  if (modal.type === "evaluate-change") {
    return modalForm(modal, "Evaluar impacto", "Documentá costo y plazo antes de ofrecer el cambio. Aún no se acepta ni se inicia trabajo.", `${modalTextarea("change-cost", "Impacto en costo", "Pendiente de estimar; no uses importes reales")}${modalTextarea("change-schedule", "Impacto en plazo", "Días/semanas estimados")}${modalCheckbox("evaluation-understood", "La evaluación no aprueba el cambio ni genera una versión aceptada.")}`, "Validar evaluación demo");
  }
  if (modal.type === "accept-change") {
    return modalForm(modal, "Registrar aceptación explícita", "En el flujo real se requiere una oferta previa y evidencia de aceptación.", `${modalField("acceptance-evidence", "Referencia de evidencia", "text", "ID de aceptación sintético")}${modalCheckbox("explicit-acceptance", "Confirmo explícitamente la oferta de cambio (solo escenario demo).") }<div class="warning-box">La demo nunca marca trabajo adicional como aprobado ni crea una nueva versión.</div>`, "Validar aceptación demo");
  }
  if (modal.type === "artifact-action") {
    const labels = { note: "Guardar nota interna", update: "Preparar actualización publicable", file: "Preparar archivo publicable", response: "Solicitar respuesta", stage: "Hacer visible una etapa" };
    const label = labels[modal.kind] || "Preparar acción";
    const internal = modal.kind === "note";
    return modalForm(modal, label, internal ? "La nota es interna y nunca aparece en la vista del cliente." : "Revisá la perspectiva del cliente y confirma de forma explícita antes de publicar.", `${modalTextarea("artifact-summary", internal ? "Nota interna" : "Contenido de muestra", "No incluyas datos reales")}${internal ? "" : `<div class="client-preview"><div class="client-preview-header"><strong>Vista previa cliente</strong>${badge("Borrador · interno", "neutral")}</div><div class="client-preview-body"><p class="small">El cliente solo vería el texto de muestra después de una publicación real autorizada.</p></div></div>`}${modalCheckbox("artifact-confirm", internal ? "Confirmo que esta nota permanece interna en la demo." : "Confirmo que revisé audiencia y contenido; entiendo que esta demo no publica ni crea un archivo.")}${!internal && modal.kind === "file" ? `<div class="warning-box">No hay archivo real en el mock; no se adjuntará ni abrirá ningún recurso.</div>` : ""}`, internal ? "Validar nota interna" : "Confirmar solo en demo", internal ? "quiet-button" : "primary-button");
  }
  if (modal.type === "lead-note") {
    return modalForm(modal, "Nota interna demo", "La nota no se comparte ni se guarda en un sistema comercial.", `${modalTextarea("internal-note", "Contenido de la nota", "Escribí texto ficticio")}${modalCheckbox("note-internal", "Confirmo que la audiencia es interna y que no hay persistencia.")}`, "Validar nota");
  }
  if (modal.type === "preview") {
    const project = getProject(modal.id);
    const visible = project ? getProjectArtifacts(project.id).filter((artifact) => artifact.audience === "Cliente") : [];
    return `<dialog id="interaction-modal" class="modal" aria-labelledby="modal-title"><div class="modal-content">${modalHeader("Vista previa de cliente", "La vista muestra únicamente contenido con audiencia Cliente. Los fixtures actuales son internos.")}<div class="client-preview"><div class="client-preview-header"><strong>${escapeHTML(project?.name || "Área del cliente · demo")}</strong>${badge("Sin contenido visible", "neutral")}</div><div class="client-preview-body">${visible.length ? visible.map((artifact) => `<p>${escapeHTML(artifact.title)}</p>`).join("") : `<div class="empty-state"><strong>No hay contenido visible</strong><p>Ninguna nota interna ni documento de esta muestra aparece al cliente.</p></div>`}</div></div><div class="modal-footer"><button class="quiet-button" type="button" data-action="close-modal">Cerrar vista previa</button></div></div></dialog>`;
  }
  if (modal.type === "duplicate") {
    const lead = getLead(modal.id);
    const match = lead?.duplicateOf ? getLead(lead.duplicateOf) : null;
    return `<dialog id="interaction-modal" class="modal" aria-labelledby="modal-title"><div class="modal-content">${modalHeader("Revisar posible duplicado", "La sugerencia no fusiona ni borra registros. La decisión debe ser humana y auditable.")}<div class="info-grid"><div class="list-card"><h3>${escapeHTML(lead?.company || "Contacto")}</h3><p>${escapeHTML(lead?.person || "")}</p><p>Fuente: ${escapeHTML(lead?.source || "")}</p></div><div class="list-card"><h3>${escapeHTML(match?.company || "Coincidencia")}</h3><p>${escapeHTML(match?.person || "")}</p><p>Fuente: ${escapeHTML(match?.source || "")}</p></div></div><div class="warning-box" style="margin-top:13px">No hay acción de fusión ni borrado disponible en este modo.</div><div class="modal-footer"><button class="quiet-button" type="button" data-action="close-modal">Cerrar</button></div></div></dialog>`;
  }
  return "";
}

function screenFor(route) {
  if (route.view === "today") return ["Hoy", renderToday()];
  if (route.view === "contacts") return route.id ? ["Contactos", renderLeadDetail(route.id)] : ["Contactos", renderContacts()];
  if (route.view === "projects") return route.id ? ["Proyectos", renderProjectDetail(route.id)] : ["Proyectos", renderProjects()];
  if (route.view === "activity") return ["Actividad", renderActivity()];
  if (route.view === "documents") return ["Documentos", renderDocuments()];
  return ["Ayuda", renderHelp()];
}

const root = document.getElementById("app");

function render() {
  if (!root) return;
  const active = document.activeElement;
  const focusKey = active?.dataset?.focusKey || active?.dataset?.filter;
  const selectionStart = typeof active?.selectionStart === "number" ? active.selectionStart : null;
  const route = routeInfo();
  const [title, content] = screenFor(route);
  root.innerHTML = shell(content, route.view, title);
  document.title = `Eclipse · ${title}`;
  if (focusKey) {
    const safeKey = CSS.escape(focusKey);
    const next = root.querySelector(`[data-focus-key="${safeKey}"], [data-filter="${safeKey}"]`);
    if (next) {
      next.focus({ preventScroll: true });
      if (selectionStart !== null && typeof next.setSelectionRange === "function") next.setSelectionRange(selectionStart, selectionStart);
    }
  }
  const dialog = root.querySelector("#interaction-modal");
  if (dialog) {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeModal();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeModal();
    });
    dialog.showModal();
  }
}

function closeModal() {
  if (state.modal?.type === "onboarding") setStorage("eclipse-portal-onboarding-dismissed", "true");
  state.modal = null;
  render();
}

function toast(message, tone = "success") {
  const region = document.getElementById("toast-region");
  if (!region) return;
  const item = document.createElement("div");
  item.className = `toast ${tone === "warning" ? "warning" : ""}`;
  item.setAttribute("role", tone === "warning" ? "status" : "status");
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

function showModal(modal) {
  state.modal = modal;
  render();
}

function setFilter(key, value) {
  const [group, name] = key.split(".");
  if (state.filters[group] && name in state.filters[group]) state.filters[group][name] = value;
}

function handleAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === "open-help") {
    if (routeInfo().view === "help") return;
    window.location.hash = "#help";
    return;
  }
  if (action === "close-modal") { closeModal(); return; }
  if (action === "dismiss-onboarding") { closeModal(); return; }
  if (action === "next-tour") {
    const next = (state.modal?.step || 0) + 1;
    if (next >= onboardingSteps.length) {
      setStorage("eclipse-portal-onboarding-dismissed", "true");
      state.modal = null;
    } else state.modal = { type: "onboarding", step: next };
    render();
    return;
  }
  if (action === "restart-tour") {
    try { window.localStorage.removeItem("eclipse-portal-onboarding-dismissed"); } catch { /* No persistent data is needed. */ }
    showModal({ type: "onboarding", step: 0 });
    return;
  }
  if (action === "project-tab") {
    state.projectTab = button.dataset.tab || "summary";
    render();
    const selected = root.querySelector(`[data-action="project-tab"][data-tab="${CSS.escape(state.projectTab)}"]`);
    selected?.focus({ preventScroll: true });
    return;
  }
  if (action === "record-next-step") { showModal({ type: "next-step", id }); return; }
  if (action === "convert-lead") { showModal({ type: "convert", id }); return; }
  if (action === "pause-project") { showModal({ type: "pause", id }); return; }
  if (action === "new-change") { showModal({ type: "change-request", id }); return; }
  if (action === "evaluate-change") { showModal({ type: "evaluate-change", id }); return; }
  if (action === "accept-change") { showModal({ type: "accept-change", id }); return; }
  if (action === "new-lead-note") { showModal({ type: "lead-note" }); return; }
  if (action === "artifact-action") {
    const kind = button.dataset.kind || "update";
    if (kind === "preview") showModal({ type: "preview", id: artifacts.find((artifact) => artifact.id === id)?.projectId });
    else showModal({ type: "artifact-action", kind, id });
    return;
  }
  if (action === "client-preview") { showModal({ type: "preview", id: "" }); return; }
  if (action === "compare-duplicates") { showModal({ type: "duplicate", id }); return; }
}

function submitMessage(form, values) {
  const type = form.dataset.form;
  const messages = {
    "next-step": "Validación de recordatorio completada. No se guardó actividad ni se envió un mensaje.",
    convert: "Gate revisado en modo demo. No se creó proyecto ni se registró un cobro.",
    pause: "Pausa validada en modo demo. El proyecto conserva su estado.",
    "change-request": "Solicitud preparada en modo demo. No es una oferta ni habilita trabajo adicional.",
    "evaluate-change": "Evaluación de muestra validada. Aún requiere oferta y aceptación explícita.",
    "accept-change": "Aceptación comprobada en modo demo. No se creó una versión ni se habilitó trabajo extra.",
    "artifact-action": state.modal?.kind === "note" ? "Nota interna preparada; no se guardó ni se compartió." : "Acción preparada. No se publicó contenido ni se abrió un archivo.",
    "lead-note": "Nota revisada en la demo. No se guardó ni se compartió.",
  };
  const message = messages[type] || "Acción revisada en modo demo. No se modificaron registros.";
  const tone = type === "artifact-action" && state.modal?.kind !== "note" ? "warning" : "success";
  state.modal = null;
  render();
  toast(message, tone);
  void values;
}

root?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) handleAction(button);
});

root?.addEventListener("input", (event) => {
  const input = event.target.closest("[data-filter]");
  if (!input) return;
  setFilter(input.dataset.filter, input.value);
  render();
});

root?.addEventListener("change", (event) => {
  const input = event.target.closest("[data-filter]");
  if (!input) return;
  setFilter(input.dataset.filter, input.value);
  render();
});

root?.addEventListener("invalid", (event) => {
  const field = event.target.closest(".field");
  if (field) field.classList.add("invalid");
}, true);

root?.addEventListener("input", (event) => {
  const field = event.target.closest(".field");
  if (field && event.target.checkValidity()) field.classList.remove("invalid");
});

root?.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  if (!form.reportValidity()) return;
  submitMessage(form, new FormData(form));
});

window.addEventListener("hashchange", () => {
  state.modal = null;
  state.projectTab = "summary";
  render();
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  document.getElementById("main-content")?.focus({ preventScroll: true });
});

render();
