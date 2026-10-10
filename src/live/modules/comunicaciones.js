// Comunicaciones: un mensaje a UN destinatario de un proyecto, con vista previa exacta del servidor y confirmación explícita.
// El correo viaja por la cola del servidor (se envía una sola vez; «aceptado por SMTP» NO es entrega). WhatsApp es manual: el portal
// arma el texto y el enlace wa.me, registra que se abrió y guarda la DECLARACIÓN humana de que se envió. Docs: docs/communications.md del backend.
import { shortId } from "../adapters/common.js";
import { CHANNEL_LABELS, COMM_STATUS_LABELS, COMM_STATUS_TONE, COMM_STATUSES, EVIDENCE_NOTES, LANGUAGE_LABELS, PURPOSE_LABELS, actorLabel, adaptCommunication, adaptRecipient, publishedUpdates, shortHash, visibleMilestones } from "../adapters/comms.js";
import { isUuid, MESSAGE_MAX } from "../adapters/outbound-comms.js";
import { bindRoot, currentRoute, ensureStyles, selectField, tag } from "./comms-support.js";
import forms, { clearPoll, effectiveCompose, listKey, smtp, startPolling } from "./comunicaciones-forms.js";

const PAGE = 20;
const COLS = "minmax(0,.8fr) minmax(0,1.8fr) minmax(0,1.2fr) minmax(0,.7fr) minmax(0,1.2fr)";

/** #comunicaciones · #comunicaciones/nueva · #comunicaciones/p-<proyecto> (redactar) · #comunicaciones/h-<proyecto> (historial) · #comunicaciones/<id> (detalle). */
export function parseRoute(id) {
  if (!id) return { kind: "list", projectId: "" };
  if (id === "nueva") return { kind: "compose", projectId: "" };
  const compose = /^p-(.+)$/.exec(id);
  if (compose && isUuid(compose[1])) return { kind: "compose", projectId: compose[1] };
  const history = /^h-(.+)$/.exec(id);
  if (history && isUuid(history[1])) return { kind: "list", projectId: history[1] };
  if (isUuid(id)) return { kind: "detail", id };
  return { kind: "list", projectId: "" };
}

const DEFAULT_FILTERS = {
  projectId: "", clientId: "", clientLabel: "", channel: "", status: "",
  cProject: "", cClient: "", cChannel: "email", cPurpose: "update", cUpdate: "", cMilestone: "", cSubject: "", cMessage: "", cLanguage: "es", composeError: "", composeKey: "",
};

let lastRouteKey = "";

export default {
  id: "comunicaciones",
  label: "Comunicaciones",
  nav: { order: 55, area: "main" },
  status: "live",
  permission: "communications:read",
  filters: { comunicaciones: { ...DEFAULT_FILTERS } },
  ...forms,

  slices: {
    "comms.recipients": {
      permission: "communications:read",
      forbiddenValue: [],
      load: async ({ api, signal }, projectId) => (await api.get(`/admin/projects/${projectId}/communication-recipients`, { signal })).recipients.map(adaptRecipient),
    },
    "comms.list": {
      permission: "communications:read",
      forbiddenValue: { items: [], nextCursor: null },
      load: async ({ api, signal }, key) => {
        const page = await api.get("/admin/communications", { query: { ...JSON.parse(key || "{}"), limit: PAGE }, signal });
        return { items: page.communications.map(adaptCommunication), nextCursor: page.nextCursor || null };
      },
      more: async ({ api }, key, current) => {
        if (!current.nextCursor) return current;
        const page = await api.get("/admin/communications", { query: { ...JSON.parse(key || "{}"), limit: PAGE, cursor: current.nextCursor } });
        const known = new Set(current.items.map((item) => item.id));
        return { items: [...current.items, ...page.communications.filter((item) => !known.has(item.id)).map(adaptCommunication)], nextCursor: page.nextCursor || null };
      },
    },
    "comms.item": {
      permission: "communications:read",
      load: async ({ api, signal }, id) => adaptCommunication((await api.get(`/admin/communications/${id}`, { signal })).communication),
    },
  },

  prepare(ctx, route) {
    ensureStyles();
    // Los selectores de filtro redibujan por su cuenta (app.js, en `input`: el `change` posterior llega a un elemento ya reemplazado);
    // acá se piden los datos que el nuevo valor necesita.
    bindRoot("input", '[data-filter^="comunicaciones."]', () => { const now = currentRoute(); if (now.view === "comunicaciones") this.prepare(ctx, now); });
    bindRoot("input", "[data-lc-count]", (event, input) => {
      ctx.state.filters.comunicaciones[input.dataset.lcCount] = input.value;
      const counter = document.getElementById(`${input.id}-count`);
      if (counter) { const length = [...input.value].length; counter.textContent = `${length} / ${MESSAGE_MAX}`; counter.toggleAttribute("data-over", length > MESSAGE_MAX); }
    });
    const f = ctx.state.filters.comunicaciones;
    const parsed = parseRoute(route.id);
    const key = `${parsed.kind}:${parsed.projectId || parsed.id || ""}`;
    const entering = key !== lastRouteKey;
    lastRouteKey = key;
    clearPoll();
    ctx.repo.ensure("projects").catch(() => {});
    if (parsed.kind === "list") {
      if (entering && parsed.projectId) Object.assign(f, { projectId: parsed.projectId, clientId: "", clientLabel: "" });
      ctx.repo.ensure("comms.list", listKey(f)).catch(() => {});
    } else if (parsed.kind === "compose") {
      if (entering) Object.assign(f, { cProject: parsed.projectId, cClient: "", cChannel: "email", cPurpose: "update", cUpdate: "", cMilestone: "", cSubject: "", cMessage: "", cLanguage: "es", composeError: "" });
      if (f.cProject) {
        // Al abrir el redactor se vuelve a pedir todo: la novedad que acabás de publicar tiene que aparecer, no la de hace un minuto.
        for (const slice of ["comms.recipients", "project.updates", "project.milestones"]) ctx.repo.ensure(slice, f.cProject, { force: entering }).catch(() => {});
      }
    } else {
      ctx.repo.ensure("comms.item", parsed.id, { force: true }).then((item) => { if (item.status === "queued") startPolling(ctx.repo, item.id); }).catch(() => {});
    }
  },

  render(ctx, route) {
    const parsed = parseRoute(route.id);
    if (parsed.kind === "detail") return detail(ctx, parsed.id);
    if (parsed.kind === "compose") return compose(ctx);
    return list(ctx);
  },

  /** Enlaces que la ficha de un proyecto muestra (ver proyectos.js: ctx.registry.modules → projectLinks). */
  projectLinks(ctx, project) {
    const id = encodeURIComponent(project.id);
    if (!ctx.can("communications:read")) return "";
    return `${ctx.can("communications:send") && project.live.members.length ? `<a class="pt-link" href="#comunicaciones/p-${id}">${ctx.icon("arrow")} Comunicar al cliente</a>` : ""}<a class="pt-link" href="#comunicaciones/h-${id}">${ctx.icon("arrow")} Mensajes de este proyecto</a>`;
  },
};

// ---------- Piezas ----------

const statusTag = (ctx, status) => tag(ctx.esc, COMM_STATUS_LABELS[status] || status, COMM_STATUS_TONE[status]);

function smtpBanner(ctx) {
  return smtp.off ? `<div class="lc-banner" data-tone="late" role="status"><p><strong>El correo está apagado en este servidor.</strong> El servidor respondió que el envío por SMTP no está configurado. WhatsApp sigue disponible: es manual y no depende de eso.</p></div>` : "";
}

function projectName(ctx, id) {
  return (ctx.repo.data("projects")?.list || []).find((project) => project.id === id)?.name || `Proyecto #${shortId(id)}`;
}

const headline = (c) => c.subject || (c.text.split("\n").find((line) => line.trim() && !/^(hola|hi|olá)\b/i.test(line.trim())) || c.text).slice(0, 90);

// ---------- Historial ----------

function list(ctx) {
  const { shell, crumbs, esc, icon, btn, emptyState, entryView, fmtDate } = ctx;
  const f = ctx.state.filters.comunicaciones;
  const key = listKey(f);
  const projects = ctx.repo.data("projects")?.list || [];
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const entry = ctx.repo.get("comms.list", key);
  const canSend = ctx.can("communications:send");
  const clientFilter = f.clientId
    ? `<div class="pt-field"><span class="label">Cliente</span><div class="lc-client-filter"><span class="pt-tag">${esc(f.clientLabel || `#${shortId(f.clientId)}`)}</span>${btn("comm-client-clear", "Quitar", "btn-ghost")}</div></div>`
    : ctx.can("clients:read")
      ? `<div class="pt-field"><label for="lc-client-email">Cliente (email exacto)</label><div class="lc-client-filter"><input class="pt-input" id="lc-client-email" type="email" autocomplete="off" placeholder="cliente@empresa.com">${btn("comm-client-lookup", "Filtrar", "btn-ghost")}</div></div>`
      : "";
  const body = (data) => {
    const rows = data.items;
    return `${rows.length ? `<div class="pt-rows-head" style="--cols:${COLS}"><span class="label">Fecha</span><span class="label">Mensaje</span><span class="label">Proyecto</span><span class="label">Canal</span><span class="label">Estado</span></div>
      <ul class="pt-rows">${rows.map((c) => `<li class="pt-row" style="--cols:${COLS}"${["failed", "unknown"].includes(c.status) ? " data-late" : ["draft", "opened", "queued"].includes(c.status) ? " data-turn" : ""}>
        <div class="pt-date">${fmtDate(c.date, true)}<small class="log-time">${esc(c.time || "")}</small></div>
        <div><a class="pt-row-name" href="#comunicaciones/${encodeURIComponent(c.id)}">${esc(headline(c))}</a><span class="pt-meta">${esc(PURPOSE_LABELS[c.purpose] || c.purpose)} · ${esc(c.email || c.phone || "sin dato de contacto")}</span></div>
        <div><span class="pt-cell-label label">Proyecto</span><a class="pt-link" style="min-height:0" href="#proyectos/${encodeURIComponent(c.projectId)}">${esc(projectName(ctx, c.projectId))}</a></div>
        <div><span class="pt-cell-label label">Canal</span>${esc(CHANNEL_LABELS[c.channel] || c.channel)}</div>
        <div><span class="pt-cell-label label">Estado</span>${statusTag(ctx, c.status)}</div>
      </li>`).join("")}</ul>
      ${data.nextCursor ? `<div class="lc-more">${btn("live-more", "Cargar más", "btn-ghost", `data-id="comms.list" data-kind="${esc(key)}"`)}</div>` : ""}`
      : emptyState("Sin mensajes en esta vista", "Un mensaje nace como borrador con vista previa. Nada sale sin tu confirmación.", canSend ? `<a class="btn btn-sm btn-ink" href="#comunicaciones/nueva">${icon("plus")} Nuevo mensaje</a>` : "")}`;
  };
  return shell(`${crumbs([["Operación", "#hoy"], ["Comunicaciones"]])}
    <div class="pt-head-row"><div>
      <div class="pt-kicker"><span class="label">Mensajes al cliente</span></div>
      <h1 class="display pt-title">Lo que le <em>dijimos</em>.</h1>
      <p class="pt-company">Un mensaje, un destinatario, con vista previa exacta y tu confirmación. El correo lo envía el servidor una sola vez y registra el resultado; WhatsApp lo enviás vos a mano y lo declarás acá. Ninguno de los dos prueba que el cliente lo leyó.</p>
    </div><div class="pt-head-actions">${canSend ? `<a class="btn btn-sm btn-primary" href="#comunicaciones/nueva">${icon("plus")} Nuevo mensaje</a>` : `<span class="pt-fine">Redactar requiere <span class="readout">communications:send</span>.</span>`}</div></div>
    ${smtpBanner(ctx)}
    <div class="lc-filter-row" role="search" aria-label="Filtrar mensajes">
      ${selectField(ctx, { id: "lc-project", label: "Proyecto", list: sorted.map((project) => [project.id, project.name]), selected: f.projectId, empty: "Todos los proyectos", filter: "comunicaciones.projectId" })}
      ${selectField(ctx, { id: "lc-channel", label: "Canal", list: Object.entries(CHANNEL_LABELS), selected: f.channel, empty: "Todos los canales", filter: "comunicaciones.channel" })}
      ${selectField(ctx, { id: "lc-status", label: "Estado", list: COMM_STATUSES.map((status) => [status, COMM_STATUS_LABELS[status]]), selected: f.status, empty: "Todos los estados", filter: "comunicaciones.status" })}
      ${clientFilter}
    </div>
    <section class="pt-list" style="margin-top:24px" aria-label="Mensajes">
    ${entryView(entry, { slice: "comms.list", key, label: "No pudimos cargar los mensajes", render: body })}
    </section>`, "comunicaciones");
}

// ---------- Redactar ----------

function compose(ctx) {
  const { shell, crumbs, esc, icon, btn, forbidden, entryView } = ctx;
  if (!ctx.can("communications:send")) return shell(`${crumbs([["Operación", "#hoy"], ["Comunicaciones", "#comunicaciones"], ["Nuevo mensaje"]])}${forbidden("communications:send", "redactar mensajes")}`, "comunicaciones");
  const f = ctx.state.filters.comunicaciones;
  const projects = [...(ctx.repo.data("projects")?.list || [])].sort((a, b) => a.name.localeCompare(b.name));
  const view = effectiveCompose(ctx);
  const radio = (name, value, checked, title, hint = "", disabled = false, flags = "") => `<label class="lc-choice"><input type="radio" name="lc-${name}" value="${esc(value)}" data-filter="comunicaciones.${name}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}><span class="lc-choice-body"><strong>${esc(title)}</strong>${hint ? `<span class="pt-fine">${esc(hint)}</span>` : ""}${flags ? `<span class="lc-flags">${flags}</span>` : ""}</span></label>`;

  const recipients = view.recipients;
  const recipientsHtml = !f.cProject ? `<p class="pt-fine">Elegí el proyecto para ver a quién se le puede escribir.</p>`
    : entryView(ctx.repo.get("comms.recipients", f.cProject), { slice: "comms.recipients", key: f.cProject, label: "No pudimos cargar los destinatarios", render: (list) => list.length
      ? `<div class="lc-choices" role="radiogroup" aria-label="Destinatario">${list.map((recipient) => radio("cClient", recipient.clientId, view.clientId === recipient.clientId, recipient.name || recipient.email, recipient.name ? recipient.email : "", false, `${tag(esc, recipient.verified ? "Email verificado" : "Email sin verificar", recipient.verified ? "ok" : "late")}${tag(esc, recipient.phoneAvailable ? "Teléfono conocido" : "Sin teléfono", recipient.phoneAvailable ? "ok" : "out")}`)).join("")}</div>
        <p class="pt-fine">El navegador nunca manda una dirección: el servidor resuelve al destinatario entre las personas con acceso al proyecto. El teléfono sale de su última solicitud de plan.</p>`
      : `<p class="pt-fine" role="status">Este proyecto no tiene personas del cliente con acceso. <a class="pt-link" style="min-height:0" href="#proyectos/${encodeURIComponent(f.cProject)}">Autorizalas en la ficha del proyecto</a> antes de escribirles.</p>` });

  const channelHtml = `<div class="lc-choices" data-cols="2" role="radiogroup" aria-label="Canal">
      ${radio("cChannel", "email", view.channel === "email", "Correo", "Lo envía el servidor una sola vez. Máx. 3 por cliente por día y 20 por hora.")}
      ${radio("cChannel", "whatsapp", view.channel === "whatsapp", "WhatsApp (manual)", "Te armamos el texto y el enlace. Lo enviás vos y lo declarás.")}
    </div>`;

  const updates = publishedUpdates(ctx.repo.data("project.updates", f.cProject) || []);
  const milestones = visibleMilestones(ctx.repo.data("project.milestones", f.cProject) || []);
  const chosenUpdate = updates.find((update) => update.id === view.updateId);
  const chosenMilestone = milestones.find((milestone) => milestone.id === view.milestoneId);
  const purposeHtml = `<div class="lc-choices" role="radiogroup" aria-label="Qué comunicar">
      ${radio("cPurpose", "update", view.purpose === "update", PURPOSE_LABELS.update, "Una actualización que ya publicaste. Nunca una nota interna ni un borrador.")}
      ${radio("cPurpose", "milestone", view.purpose === "milestone", PURPOSE_LABELS.milestone, "Un hito que el cliente ya ve en su portal.")}
      ${radio("cPurpose", "custom", view.purpose === "custom", PURPOSE_LABELS.custom, "Un texto que escribís vos.")}
    </div>`;
  const sourceHtml = view.purpose === "update"
    ? (!f.cProject ? "" : `${selectField(ctx, { id: "lc-update", label: "Novedad publicada", list: updates.map((update) => [update.id, `${ctx.fmtDate(update.date, true)} · ${update.title || update.body.slice(0, 60)}`]), selected: view.updateId, empty: updates.length ? "Elegí una novedad…" : "No hay novedades publicadas", filter: "comunicaciones.cUpdate" })}
        ${chosenUpdate ? `<div class="lc-source" aria-label="Contenido de la novedad">${esc([chosenUpdate.title, chosenUpdate.body].filter(Boolean).join("\n"))}</div>` : `<p class="pt-fine">Solo aparecen las novedades publicadas y no retiradas: es lo que el servidor acepta.</p>`}`)
    : view.purpose === "milestone"
      ? (!f.cProject ? "" : `${selectField(ctx, { id: "lc-milestone", label: "Hito visible", list: milestones.map((milestone) => [milestone.id, `${milestone.title}${milestone.plannedOn ? ` · ${ctx.fmtDate(milestone.plannedOn, true)}` : ""}`]), selected: view.milestoneId, empty: milestones.length ? "Elegí un hito…" : "No hay hitos visibles para el cliente", filter: "comunicaciones.cMilestone" })}
        ${chosenMilestone ? `<div class="lc-source">${esc(chosenMilestone.title)}${chosenMilestone.plannedOn ? `\nFecha prevista: ${chosenMilestone.plannedOn}` : ""}</div>` : `<p class="pt-fine">Un hito interno no se puede comunicar: mostralo al cliente desde la ficha del proyecto.</p>`}`)
      : `${view.channel === "email" ? `<div class="pt-field"><label for="lc-subject">Asunto</label><input class="pt-input" id="lc-subject" data-lc-count="cSubject" maxlength="120" value="${esc(f.cSubject)}" autocomplete="off"></div>` : ""}`;
  const messageLabel = view.purpose === "custom" ? "Mensaje" : "Nota propia (opcional)";
  const messageHtml = `<div class="pt-field"><label for="lc-message">${messageLabel}</label><textarea class="pt-input" id="lc-message" data-lc-count="cMessage" rows="${view.purpose === "custom" ? 6 : 3}" maxlength="${MESSAGE_MAX}">${esc(f.cMessage)}</textarea><span class="lc-count" id="lc-message-count" aria-live="off"${[...f.cMessage].length > MESSAGE_MAX ? " data-over" : ""}>${[...f.cMessage].length} / ${MESSAGE_MAX}</span></div>`;

  const languageHtml = selectField(ctx, { id: "lc-language", label: "Idioma del saludo y los rótulos", list: Object.entries(LANGUAGE_LABELS), selected: view.language, filter: "comunicaciones.cLanguage" });

  const form = `<form class="lc-steps" aria-label="Nuevo mensaje">
      <fieldset class="lc-step"><legend class="pt-step-title"><span class="lc-step-head"><span class="label">01</span><span class="pt-h2">Proyecto</span></span></legend>
        ${selectField(ctx, { id: "lc-cproject", label: "Proyecto", list: projects.map((project) => [project.id, `${project.name} · ${project.code}`]), selected: f.cProject, empty: "Elegí un proyecto…", filter: "comunicaciones.cProject" })}</fieldset>
      <fieldset class="lc-step"><legend><span class="lc-step-head"><span class="label">02</span><span class="pt-h2">Destinatario</span></span></legend>${recipientsHtml}</fieldset>
      <fieldset class="lc-step"><legend><span class="lc-step-head"><span class="label">03</span><span class="pt-h2">Canal</span></span></legend>${channelHtml}</fieldset>
      <fieldset class="lc-step"><legend><span class="lc-step-head"><span class="label">04</span><span class="pt-h2">Contenido</span></span></legend>${purposeHtml}${sourceHtml}${messageHtml}${languageHtml}</fieldset>
      <div class="lc-step"><p class="form-error" role="alert" id="lc-compose-error">${esc(f.composeError)}</p>
        <div class="lc-actions">${btn("comm-prepare", "Preparar vista previa", "btn-ink", "")}<a class="btn btn-sm btn-ghost" href="#comunicaciones">Cancelar</a></div>
        <p class="pt-fine">Prepara un borrador en el servidor y te muestra el texto exacto. No envía ni encola nada.</p></div>
    </form>`;

  const recipient = recipients.find((entry) => entry.clientId === view.clientId);
  const aside = `<aside class="lc-aside" aria-label="Qué pasa al preparar">
      <section class="pt-box"><div class="pt-box-head"><span class="label">Cómo funciona</span></div>
        <ol class="lc-timeline"><li><span class="pt-date">1 · Borrador</span><span>El servidor arma el texto con el saludo, la novedad o el hito y tu nota. Lo ves tal cual.</span></li>
        <li><span class="pt-date">2 · Confirmación</span><span>Correo: confirmás con una casilla y se encola. WhatsApp: abrís el chat y lo enviás vos.</span></li>
        <li><span class="pt-date">3 · Resultado</span><span>Correo: «aceptado por SMTP» o falló. WhatsApp: tu declaración. Ninguno prueba entrega.</span></li></ol></section>
      ${recipient ? `<section class="pt-box"><div class="pt-box-head"><span class="label">Va a</span></div><p class="pt-box-title">${esc(recipient.name || recipient.email)}</p><p class="pt-fine">${esc(recipient.email)}${view.channel === "whatsapp" ? (recipient.phoneAvailable ? " · hay teléfono: habrá enlace de WhatsApp" : " · sin teléfono: no habrá enlace, solo el texto para copiar") : ""}</p></section>` : ""}
    </aside>`;

  return shell(`${crumbs([["Operación", "#hoy"], ["Comunicaciones", "#comunicaciones"], ["Nuevo mensaje"]])}
    <div class="pt-kicker"><span class="label">Paso previo al envío</span></div>
    <h1 class="display pt-title">Nuevo <em>mensaje</em>.</h1>
    <p class="pt-company">Elegí a quién, por dónde y qué. Antes de que salga nada vas a ver el texto exacto y vas a tener que confirmarlo.</p>
    ${smtpBanner(ctx)}
    <div class="lc-grid">${form}${aside}</div>`, "comunicaciones");
}

// ---------- Detalle ----------

function detail(ctx, id) {
  const { shell, crumbs, esc, entryView, emptyState, icon } = ctx;
  const entry = ctx.repo.get("comms.item", id);
  if (entry.status === "error" && entry.error?.status === 404) return shell(`${crumbs([["Operación", "#hoy"], ["Comunicaciones", "#comunicaciones"], ["No encontrado"]])}${emptyState("No existe ese mensaje", "", `<a class="pt-link" href="#comunicaciones">${icon("back")} Volver a comunicaciones</a>`)}`, "comunicaciones");
  const title = entry.data ? headline(entry.data) : "Mensaje";
  return shell(`${crumbs([["Operación", "#hoy"], ["Comunicaciones", "#comunicaciones"], [title.slice(0, 48)]])}${entryView(entry, { slice: "comms.item", key: id, label: "No pudimos cargar el mensaje", render: (c) => card(ctx, c) })}`, "comunicaciones");
}

function card(ctx, c) {
  const { esc, btn, icon, fmtDate } = ctx;
  const me = ctx.admin?.id;
  const a = `data-id="${esc(c.id)}"`;
  const canSend = ctx.can("communications:send");
  const tone = COMM_STATUS_TONE[c.status];
  const polling = c.status === "queued";

  let actions = "";
  if (!canSend) actions = `<p class="pt-fine">Tu cuenta puede ver los mensajes pero no enviarlos (falta <span class="readout">communications:send</span>).</p>`;
  else if (c.isEmail && c.status === "draft") {
    actions = `${smtp.off ? `<p class="pt-fine" role="status">El servidor dijo que el correo está apagado: si confirmás, lo más probable es que lo rechace.</p>` : ""}
      <div class="lc-actions">${btn("comm-confirm", "Revisar y confirmar el envío…", "btn-ink", a)}${btn("comm-cancel", "Descartar el borrador", "btn-ghost", a)}</div>`;
  } else if (c.isEmail && c.status === "queued") {
    actions = `<div class="lc-actions">${btn("comm-refresh", `${icon("arrow")} Actualizar estado`, "btn-ghost", a)}${btn("comm-cancel", "Cancelar el envío", "btn-danger", a)}</div><p class="pt-fine" aria-live="polite">Se actualiza solo cada pocos segundos mientras esté en cola. Podés cancelarlo mientras el servidor no lo haya tomado.</p>`;
  } else if (!c.isEmail && c.status === "draft") {
    actions = `<div class="lc-actions">${btn("comm-wa-open", c.waUrl ? "Registrar y abrir WhatsApp" : "Lo voy a enviar por mi cuenta", "btn-ink", a)}${btn("comm-copy", "Copiar el texto", "btn-ghost", a)}${btn("comm-cancel", "Descartar el borrador", "btn-ghost", a)}</div>
      <p class="pt-fine">${c.waUrl ? "Abrir el enlace solo prepara el chat: el mensaje sale cuando lo enviás vos desde WhatsApp." : "No hay teléfono conocido para este cliente, así que no hay enlace. Copiá el texto y enviálo por tu cuenta."}</p>`;
  } else if (!c.isEmail && c.status === "opened") {
    actions = `<div class="lc-actions">${c.waUrl ? `<a class="btn btn-sm btn-ghost" href="${esc(c.waUrl)}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp de nuevo</a>` : ""}${btn("comm-copy", "Copiar el texto", "btn-ghost", a)}${btn("comm-declare", "Marcar como enviado…", "btn-ink", a)}</div>
      <p class="pt-fine">Cuando lo hayas enviado desde WhatsApp, dejalo declarado. Es tu palabra: el portal no puede comprobar el envío.</p>`;
  } else if (c.status === "unknown" || c.status === "failed") {
    actions = `<div class="lc-actions"><a class="btn btn-sm btn-ghost" href="#comunicaciones/p-${encodeURIComponent(c.projectId)}">Preparar otro mensaje</a></div>`;
  }

  const timeline = [
    [c.createdAt, `Borrador creado por ${actorLabel(c.createdBy, me)}.`],
    c.confirmedAt ? [c.confirmedAt, c.isEmail ? `Envío confirmado por ${actorLabel(c.confirmedBy, me)}.` : `Chat abierto por ${actorLabel(c.confirmedBy, me)}.`] : null,
    c.resultAt ? [c.resultAt, ({ accepted_by_smtp: "El servidor de correo aceptó el mensaje.", failed: "El envío falló.", unknown: "El servidor de correo no confirmó el resultado.", cancelled: "Se canceló.", declared_sent: "Declarado como enviado a mano." })[c.status] || "Resultado registrado."] : null,
  ].filter(Boolean);
  const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${fmtDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, true)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  return `
    <p class="pt-detail-meta"><span class="pt-detail-code">${esc(CHANNEL_LABELS[c.channel])}</span><span>${esc(PURPOSE_LABELS[c.purpose])}</span><span>${esc(LANGUAGE_LABELS[c.language])}</span></p>
    <h1 class="display pt-title lc-title">${esc(c.isEmail ? c.subject || "Correo" : "Mensaje de WhatsApp")}</h1>
    <p class="pt-company">${statusTag(ctx, c.status)} <span class="pt-fine">Versión ${c.version}</span></p>
    <p class="lc-evidence" data-tone="${tone === "late" ? "late" : tone === "ok" ? "ok" : ""}" role="status" aria-live="polite">${esc(EVIDENCE_NOTES[c.status] || "")}${polling ? " Actualizando…" : ""}</p>
    <div class="lc-grid">
      <section aria-labelledby="lc-preview-title">
        <h2 id="lc-preview-title" class="pt-h2">Vista previa exacta</h2>
        <p class="pt-fine" style="margin-bottom:12px">Es el texto que armó el servidor y el que se confirma. No se puede editar: para cambiarlo, descartá el borrador y preparás otro.</p>
        <div class="lc-mail ticks" aria-label="Texto del mensaje">
          <dl class="lc-mail-head">
            <div><dt>Para</dt><dd>${esc(c.isEmail ? c.email || "—" : c.phone || "Sin teléfono conocido")}</dd></div>
            ${c.isEmail ? `<div><dt>Asunto</dt><dd>${esc(c.subject || "—")}</dd></div>` : ""}
            <div><dt>Canal</dt><dd>${esc(CHANNEL_LABELS[c.channel])} · ${esc(LANGUAGE_LABELS[c.language])}</dd></div>
          </dl>
          <pre class="lc-mail-text" tabindex="0">${esc(c.text)}</pre>
        </div>
        <p class="lc-hash" style="margin-top:12px"><span class="label">Huella del contenido</span> <span title="${esc(c.contentHash)}">${esc(shortHash(c.contentHash))}</span> — liga canal, destinatario, asunto y texto: confirmar la huella confirma todo eso.</p>
      </section>
      <aside class="lc-aside" aria-label="Acciones y datos">
        <section class="pt-box"${["draft", "opened"].includes(c.status) ? " data-turn" : ""}><div class="pt-box-head"><span class="label">Qué sigue</span></div>${actions || `<p class="pt-fine">Este mensaje ya terminó su recorrido. No hay nada más para hacer.</p>`}</section>
        <section class="pt-box"><div class="pt-box-head"><span class="label">Recorrido</span></div>
          <ul class="lc-timeline">${timeline.map(([iso, text]) => `<li><span class="pt-date">${esc(when(iso))}</span><span>${esc(text)}</span></li>`).join("")}</ul></section>
        <section class="pt-box"><div class="pt-box-head"><span class="label">Datos</span></div>
          <dl class="pt-dl"><div><dt>Proyecto</dt><dd><a class="pt-link" style="min-height:0" href="#proyectos/${encodeURIComponent(c.projectId)}">${esc(projectName(ctx, c.projectId))}</a></dd></div>
          <div><dt>Cuenta del cliente</dt><dd class="readout">#${esc(shortId(c.clientId))}</dd></div>
          ${c.updateId ? `<div><dt>Novedad de origen</dt><dd class="readout">#${esc(shortId(c.updateId))}</dd></div>` : ""}
          ${c.milestoneId ? `<div><dt>Hito de origen</dt><dd class="readout">#${esc(shortId(c.milestoneId))}</dd></div>` : ""}
          <div><dt>Prueba</dt><dd>${esc({ none: "Ninguna todavía", smtp_accepted: "Aceptado por SMTP (no es entrega)", manual_declaration: "Declaración manual (no es comprobante)" }[c.evidence] || c.evidence)}</dd></div></dl>
        </section>
        <a class="pt-link" href="#comunicaciones">${icon("back")} Volver a comunicaciones</a>
      </aside>
    </div>`;
}
