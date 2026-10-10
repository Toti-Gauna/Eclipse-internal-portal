// Formularios, diálogos y envíos del módulo Proyectos (y los cobros, que siempre cuelgan de un proyecto).
// Cada envío arma el cuerpo con adapters/outbound.js, usa la clave de idempotencia donde la API la exige y declara
// con h.touch() qué datos hay que volver a pedir al terminar (aunque falle con 409: se refresca y se avisa).
import { ApiError } from "../../api/errors.js";
import { MAIN_STAGES, STAGES, addDays, todayISO } from "../../rules.js";
import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS, REQUEST_STATUS_LABELS, UPDATE_KIND_LABELS, centsToDollars, formatCents as money, parseDollars, stageToApi } from "../adapters/common.js";
import * as out from "../adapters/outbound.js";
import { FormError, unwrap } from "../errors.js";

const LIVE_STAGES = [...MAIN_STAGES, "support"];
const stageOptions = () => LIVE_STAGES.map((stage) => [stageToApi(stage), STAGES[stage].name]);
const viewStageOptions = () => LIVE_STAGES.map((stage) => [stage, STAGES[stage].name]);
const checkbox = (name, label, { checked = false, required = false, hint = "" } = {}) => `<div class="pt-field live-check"><label><input type="checkbox" name="${name}" value="1"${checked ? " checked" : ""}${required ? " required" : ""}> <span>${label}</span></label>${hint ? `<p class="pt-fine">${hint}</p>` : ""}</div>`;
const summaryList = (ctx, pairs) => `<dl class="generator-summary">${pairs.filter(([, value]) => value !== "" && value !== undefined && value !== null).map(([label, value]) => `<div><dt>${ctx.esc(label)}</dt><dd>${ctx.esc(value)}</dd></div>`).join("")}</dl>`;

function projectOf(ctx, id) {
  return (ctx.repo.data("project", id)) || (ctx.repo.data("projects")?.list || []).find((project) => project.id === id) || null;
}

function touchProject(h, id, ...more) {
  h.touch(["projects"]);
  for (const slice of ["project", "project.audit", ...more]) h.touch([slice, id]);
}

export default {
  // ---------- Pantallas completas ----------
  wizards: {
    "new-project": (wizard, ctx) => {
      const { esc, field, area, select, row } = ctx;
      const today = todayISO();
      const request = wizard.kind === "request" ? ctx.repo.data("request", wizard.id) : null;
      const fromRequest = request ? {
        name: request.contactName, organizationName: request.contactName,
        service: (request.selection.planName || request.selection.items.map((item) => item.name).join(", ") || "").slice(0, 160),
        price: request.estimate.totalCents ? String(centsToDollars(request.estimate.totalCents)) : "",
        scopeItems: request.estimate.lines.map((line) => line.name).join("\n"),
        sourcePlanRequestId: request.id, authorizeRequest: "1",
      } : {};
      const defaults = { name: "", organizationName: "", service: "", agreementReference: "", acceptedOn: today, price: "", scopeItems: "", depositAmount: "", receivedOn: today, depositReference: "", depositNote: "", startedOn: "", plannedEndOn: "", clientEmail: "", memberRole: "client_admin", ...fromRequest };
      const v = { ...defaults, ...wizard.values };
      const origin = request ? `<p class="generator-warning" role="note">Origen: solicitud de <strong>${esc(request.contactName)}</strong> (${esc(REQUEST_STATUS_LABELS[request.status])}). Los datos de abajo son una sugerencia: confirmá lo que realmente se acordó.</p>` : "";
      return {
        kicker: "Proyectos", title: "Un buen comienzo cambia todo.",
        intro: "Un proyecto nace con un acuerdo y la seña ya cobrada. Se crea todo junto o no se crea nada.", submit: "Registrar seña y crear proyecto",
        values: v,
        steps: [
          ["Proyecto", "Qué se va a hacer y para quién.", `${origin}${row(field("name", "Proyecto", "text", v.name, 'required maxlength="120"'), field("organizationName", "Cliente u organización", "text", v.organizationName, 'required maxlength="120"'))}${field("service", "Servicio", "text", v.service, 'required maxlength="160" placeholder="Agente de atención, web, automatización…"')}`],
          ["Acuerdo", "Lo que quedó acordado, por escrito.", `${field("agreementReference", "Referencia del acuerdo", "text", v.agreementReference, 'required maxlength="160" placeholder="Presupuesto 12, mensaje de WhatsApp del 3/10…"')}${row(field("acceptedOn", "Fecha del acuerdo", "date", v.acceptedOn, `required max="${today}"`), field("price", "Precio acordado · USD", "text", v.price, 'required inputmode="decimal" placeholder="2000"'))}${request ? '<p class="pt-fine">El precio viene de la estimación provisoria de la solicitud. No es un presupuesto: poné el acordado.</p>' : ""}${area("scopeItems", "Alcance · un entregable por línea (hasta 30)", v.scopeItems, 'required rows="5" placeholder="Landing premium\nAgente de WhatsApp"')}`],
          ["Seña", "Solo empieza cuando se cobra.", `${row(field("depositAmount", "Seña cobrada · USD", "text", v.depositAmount, 'required inputmode="decimal" placeholder="1000"'), field("receivedOn", "Fecha de cobro", "date", v.receivedOn, `required max="${today}"`))}${row(field("depositReference", "Referencia del cobro · opcional", "text", v.depositReference, 'maxlength="160" placeholder="Transferencia, comprobante…"'), field("depositNote", "Nota · opcional", "text", v.depositNote, 'maxlength="500"'))}${row(field("startedOn", "Inicio · opcional", "date", v.startedOn, ""), field("plannedEndOn", "Entrega estimada · opcional", "date", v.plannedEndOn, ""))}`],
          ["Acceso", "Quién del cliente puede ver este proyecto.", `${request ? checkbox("authorizeRequest", "Autorizar la cuenta del cliente que envió la solicitud", { checked: Boolean(v.authorizeRequest), hint: "Es la cuenta verificada que armó el plan. Sin acceso, el cliente no ve el proyecto en su portal." }) : ""}${field("clientEmail", "Email de otra cuenta de cliente · opcional", "email", v.clientEmail, 'autocomplete="off" placeholder="cliente@ejemplo.com"')}${select("memberRole", "Rol", [["client_admin", "Responsable del cliente"], ["client_collaborator", "Colaborador del cliente"]], v.memberRole)}<p class="pt-fine">Se busca por email exacto al confirmar. Tiene que ser una cuenta verificada. Podés sumar o quitar personas después.</p>`],
        ].concat([["Revisión", "Todo listo para confirmar.", summaryList(ctx, [["Proyecto / cliente", `${v.name} · ${v.organizationName || v.name}`], ["Servicio", v.service], ["Acuerdo", `${v.agreementReference} · ${v.acceptedOn}`], ["Precio acordado", Number.isNaN(parseDollars(v.price)) ? v.price : money(parseDollars(v.price))], ["Seña cobrada", Number.isNaN(parseDollars(v.depositAmount)) ? v.depositAmount : money(parseDollars(v.depositAmount))], ["Cobrada el", v.receivedOn], ["Alcance", String(v.scopeItems).split("\n").filter((l) => l.trim()).join(" · ")], ["Acceso", [v.authorizeRequest && request ? "cuenta de la solicitud" : "", v.clientEmail].filter(Boolean).join(" + ") || "Ninguna cuenta por ahora"]])]]),
      };
    },

    "new-payment": (wizard, ctx) => {
      const { esc, field, area, select, row } = ctx;
      const today = todayISO();
      const projects = (ctx.repo.data("projects")?.list || []).filter((project) => project.stage !== "closed");
      const finance = wizard.values.projectId || wizard.id ? ctx.repo.data("project.finance", wizard.values.projectId || wizard.id) : null;
      const v = { projectId: wizard.id || "", kind: "installment", status: "collected", amount: "", receivedOn: today, dueOn: "", reference: "", note: "", ...wizard.values };
      if (!wizard.values.amount && finance && v.projectId === wizard.id && finance.balanceCents - finance.committedCents > 0 && v.kind !== "maintenance") v.amount = String(centsToDollars(finance.balanceCents - finance.committedCents));
      const f = v.projectId ? ctx.repo.data("project.finance", v.projectId) : null;
      const dates = v.status === "collected"
        ? field("receivedOn", "Fecha de cobro", "date", v.receivedOn, `required max="${today}"`)
        : field("dueOn", v.status === "committed" ? "Vencimiento" : "Vencimiento · opcional", "date", v.dueOn, v.status === "committed" ? "required" : "");
      return {
        kicker: "Cobros", title: "Lo que entró, bien registrado.",
        intro: "Cobrado, comprometido y propuesto se guardan por separado. Solo lo cobrado cuenta como ingreso.", submit: "Registrar cobro",
        values: v,
        steps: [
          ["Cobro", "El importe y cómo se clasifica.", `${select("projectId", "Proyecto", projects.map((project) => [project.id, `${project.name} · ${project.code}`]), v.projectId, "Elegí un proyecto").replace("<select", "<select required data-rerender")}${row(select("kind", "Tipo", Object.entries(PAYMENT_KIND_LABELS), v.kind).replace("<select", "<select data-rerender"), select("status", "Estado", [["collected", "Cobrado"], ["committed", "Comprometido (con vencimiento)"], ["proposed", "Propuesto"]], v.status).replace("<select", "<select data-rerender"))}${field("amount", "Monto · USD", "text", v.amount, 'required inputmode="decimal" placeholder="500"')}${f && v.kind !== "maintenance" ? `<p class="pt-fine" role="status">Falta cobrar ${money(f.balanceCents)} del precio acordado${f.committedCents ? `; ${money(f.committedCents)} ya están comprometidos` : ""}. El mantenimiento no cuenta contra el precio.</p>` : ""}`],
          ["Detalle", "Cuándo y con qué referencia.", `${dates}${row(field("reference", "Referencia · opcional", "text", v.reference, 'maxlength="160" placeholder="Transferencia, comprobante…"'), field("note", "Nota · opcional", "text", v.note, 'maxlength="500"'))}<p class="pt-fine">El servidor guarda el día del cobro, no la hora.</p>`],
          ["Revisión", "Todo listo para confirmar.", summaryList(ctx, [["Proyecto", projects.find((project) => project.id === v.projectId)?.name || ""], ["Tipo / estado", `${PAYMENT_KIND_LABELS[v.kind]} · ${PAYMENT_STATUS_LABELS[v.status]}`], ["Monto", Number.isNaN(parseDollars(v.amount)) ? v.amount : money(parseDollars(v.amount))], [v.status === "collected" ? "Cobrado el" : "Vence el", v.status === "collected" ? v.receivedOn : v.dueOn], ["Referencia", v.reference], ["Nota", v.note]])],
        ],
      };
    },
  },

  // ---------- Diálogos ----------
  modals: {
    "project-advance": { markup(ctx, modal) {
      const project = projectOf(ctx, modal.id);
      const current = project.stage === "paused" ? project.pausedIn : project.stage;
      const choices = viewStageOptions().filter(([stage]) => stage !== current);
      const target = modal.kind && choices.some(([stage]) => stage === modal.kind) ? modal.kind : choices.find(([stage]) => stage === LIVE_STAGES[LIVE_STAGES.indexOf(current) + 1])?.[0] || choices[0][0];
      return ctx.modalShell(project.name, "Cambiar de etapa", ctx.esc(`${STAGES[current].exit} El cliente ve la etapa en su portal.`), [
        ctx.select("stage", "Pasar a", choices, target),
        checkbox("draft", "Preparar un borrador de actualización para el cliente", { hint: "Queda como borrador: no se publica hasta que lo revises y confirmes." }),
        ctx.field("title", "Título del borrador", "text", `Arranca ${STAGES[target].name}`, 'maxlength="160"'),
        ctx.area("body", "Qué le contás al cliente", "", 'rows="3" maxlength="4000" placeholder="Qué se hizo y qué sigue, en una o dos frases"'),
      ].join(""), "Cambiar etapa", { live: true });
    } },
    "project-pause": { markup(ctx, modal) {
      const project = projectOf(ctx, modal.id);
      return ctx.modalShell(project.name, "Pausar proyecto", "El motivo y la fecha de revisión quedan registrados. Mientras está en pausa no se cambia la etapa.", [ctx.area("reason", "Motivo", "", 'required rows="3" maxlength="500"'), ctx.field("reviewOn", "Revisar el", "date", addDays(todayISO(), 7), `required min="${todayISO()}"`)].join(""), "Pausar", { live: true });
    } },
    "project-close": { markup(ctx, modal) {
      const project = projectOf(ctx, modal.id);
      return ctx.modalShell(project.name, "Cerrar proyecto", "<strong>El cierre es definitivo.</strong> Después solo se aceptan cobros de mantenimiento, anulaciones de cobros, retiro de actualizaciones y bajas de miembros.", [ctx.area("reason", "Motivo del cierre", "", 'required rows="3" maxlength="500" placeholder="Entregado y cobrado, cancelado por el cliente…"'), ctx.field("completedOn", "Fecha de cierre", "date", todayISO(), `max="${todayISO()}"`)].join(""), "Cerrar proyecto", { live: true });
    } },
    "project-edit": { markup(ctx, modal) {
      const project = projectOf(ctx, modal.id);
      return ctx.modalShell(project.name, "Editar datos", "El precio, el acuerdo y el origen no se editan: cambian solo con una solicitud de cambio aceptada.", [ctx.row(ctx.field("name", "Proyecto", "text", project.name, 'required maxlength="120"'), ctx.field("service", "Servicio", "text", project.service, 'required maxlength="160"')), ctx.row(ctx.field("startedOn", "Inicio", "date", project.live.startedOn || "", ""), ctx.field("plannedEndOn", "Entrega estimada", "date", project.live.plannedEndOn || "", ""))].join(""), "Guardar", { live: true });
    } },
    "milestone-edit": { markup(ctx, modal) {
      const project = projectOf(ctx, modal.id);
      const milestone = modal.kind ? (ctx.repo.data("project.milestones", modal.id) || []).find((m) => m.id === modal.kind) : null;
      const stage = milestone?.apiStage || stageToApi(project.stage === "paused" ? project.pausedIn : project.stage === "closed" ? "support" : project.stage);
      return ctx.modalShell(project.name, milestone ? "Editar hito" : "Nuevo hito", "Un hito nuevo es interno: el cliente no lo ve hasta que decidas mostrarlo.", [
        ctx.field("title", "Hito", "text", milestone?.title || "", 'required maxlength="160"'),
        ctx.row(ctx.select("stage", "Etapa", stageOptions(), stage), ctx.select("ownerParty", "Responsable", [["eclipse", "Eclipse"], ["client", "Cliente"]], milestone?.ownerParty || "eclipse")),
        ctx.field("plannedOn", "Fecha estimada", "date", milestone?.plannedOn || "", ""),
        milestone ? ctx.select("status", "Estado", [["pending", "Pendiente"], ["in_progress", "En curso"], ["blocked", "Bloqueado"], ["cancelled", "Cancelado"]], milestone.status) : "",
        ctx.area("description", "Descripción · opcional", milestone?.description || "", 'rows="3" maxlength="2000"'),
        milestone ? "" : ctx.area("internalNotes", "Notas internas · opcional", "", 'rows="2" maxlength="4000"'),
      ].join(""), milestone ? "Guardar hito" : "Crear hito", { live: true });
    } },
    "milestone-complete": { markup(ctx, modal) {
      const milestone = (ctx.repo.data("project.milestones", modal.id) || []).find((m) => m.id === modal.kind);
      return ctx.modalShell(milestone?.title || "Hito", "Completar hito", "Se registra el día real en que se cumplió y la evidencia. Nada se completa sin las dos cosas.", [ctx.field("actualOn", "Se cumplió el", "date", todayISO(), `required max="${todayISO()}"`), ctx.area("evidence", "Evidencia", "", 'required rows="3" maxlength="2000" placeholder="Enlace, commit, captura, mensaje de aprobación…"')].join(""), "Completar", { live: true });
    } },
    "milestone-visibility": { markup(ctx, modal) {
      const milestone = (ctx.repo.data("project.milestones", modal.id) || []).find((m) => m.id === modal.kind);
      const show = !milestone?.visibleToClient;
      return ctx.modalShell(milestone?.title || "Hito", show ? "Mostrar al cliente" : "Ocultar al cliente", ctx.esc(show ? "El cliente va a ver este hito en su portal: título, descripción, estado y fechas. Las notas internas y la evidencia no se muestran." : "El cliente deja de ver este hito."), checkbox("confirm", show ? "Confirmo que quiero mostrar este hito al cliente" : "Confirmo que quiero ocultar este hito", { required: true }), show ? "Mostrar al cliente" : "Ocultar", { live: true });
    } },
    "update-edit": { markup(ctx, modal) {
      const project = projectOf(ctx, modal.id);
      const update = modal.kind ? (ctx.repo.data("project.updates", modal.id) || []).find((u) => u.id === modal.kind) : null;
      const preset = !update && UPDATE_KIND_LABELS[modal.kind] ? modal.kind : "client_update";
      const kinds = Object.entries(UPDATE_KIND_LABELS).filter(([key]) => key !== "status_change" || preset === "status_change");
      return ctx.modalShell(project.name, update ? "Editar registro" : "Nuevo registro", "Las notas internas no se publican nunca. Lo demás queda como borrador hasta que lo publiques con una confirmación.", [
        update ? "" : ctx.select("updateKind", "Tipo", kinds, preset),
        ctx.field("title", "Título", "text", update?.title || "", 'maxlength="160"'),
        ctx.area("body", "Detalle", update?.body || "", 'required rows="4" maxlength="4000"'),
        !update || update.kind === "action_required" ? ctx.field("dueOn", "Para cuándo · solo acciones del cliente", "date", update?.dueOn || "", "") : "",
      ].join(""), update ? "Guardar" : "Guardar borrador", { live: true });
    } },
    "update-publish": { markup(ctx, modal) {
      const update = (ctx.repo.data("project.updates", modal.id) || []).find((u) => u.id === modal.kind);
      const preview = update?.clientPreview;
      return ctx.modalShell(UPDATE_KIND_LABELS[update?.kind] || "Actualización", "Publicar al cliente", "Esto es exactamente lo que va a ver el cliente. Una vez publicada no se edita: solo se puede retirar con un motivo.", `<div class="live-preview ticks" aria-label="Vista previa para el cliente"><span class="label">Vista previa · cliente</span>${preview?.title ? `<p class="pt-h3">${ctx.esc(preview.title)}</p>` : ""}<p class="live-prewrap">${ctx.esc(preview?.body ?? update?.body ?? "")}</p>${preview?.dueOn ? `<p class="pt-fine">Para el ${ctx.fmtDate(preview.dueOn, true)}</p>` : ""}</div>${checkbox("confirm", "Entiendo que el cliente lo va a ver en su portal", { required: true })}`, "Publicar", { live: true });
    } },
    "update-withdraw": { markup(ctx, modal) {
      const update = (ctx.repo.data("project.updates", modal.id) || []).find((u) => u.id === modal.kind);
      return ctx.modalShell(update?.title || UPDATE_KIND_LABELS[update?.kind] || "Actualización", "Retirar del portal del cliente", "El cliente deja de verla. La fila queda guardada con el motivo.", ctx.area("reason", "Motivo", "", 'required rows="3" maxlength="500"'), "Retirar", { live: true });
    } },
    "payment-transition": { markup(ctx, modal) {
      const payment = (ctx.repo.data("project.payments", modal.id) || []).find((p) => p.id === modal.kind);
      const to = modal.to;
      const fields = to === "committed" ? ctx.field("dueOn", "Vencimiento", "date", payment?.dueOn || addDays(todayISO(), 7), "required")
        : to === "collected" ? ctx.field("receivedOn", "Fecha de cobro", "date", todayISO(), `required max="${todayISO()}"`)
        : ctx.area("reason", "Motivo de la anulación", "", 'required rows="3" maxlength="500"');
      const title = { committed: "Comprometer cobro", collected: "Marcar como cobrado", voided: "Anular cobro" }[to];
      return ctx.modalShell(`${payment ? PAYMENT_KIND_LABELS[payment.kind] : "Cobro"} · ${payment ? money(payment.amountCents) : ""}`, title, to === "voided" ? "Anular conserva la fila con su motivo. Es definitivo y el importe nunca se edita." : "El importe no se puede cambiar: si está mal, anulalo y registrá otro.", fields, title, { live: true });
    } },
    "member-add": { markup(ctx, modal) {
      const project = projectOf(ctx, modal.id);
      const found = modal.lookup?.client;
      const result = found ? `<div class="live-lookup ticks" role="status"><span class="label">Cuenta encontrada</span><p class="pt-h3">${ctx.esc(found.displayName || found.email)}</p><p class="pt-fine">${ctx.esc(found.email)} · ${found.emailVerified ? "email verificado" : "email sin verificar"} · ${found.active ? "activa" : "suspendida"}</p></div>${ctx.select("role", "Rol en el proyecto", [["client_admin", "Responsable del cliente"], ["client_collaborator", "Colaborador del cliente"]], "client_admin")}` : modal.lookupError ? `<p class="form-error" role="alert">${ctx.esc(modal.lookupError)}</p>` : "";
      return ctx.modalShell(project.name, "Autorizar cliente", "Busca una cuenta de cliente verificada por su email exacto. Va a ver este proyecto en su portal.", `<div class="pt-field"><label for="m-email">Email del cliente</label><div class="live-inline"><input class="pt-input" id="m-email" name="email" type="email" value="${ctx.esc(modal.email || "")}" autocomplete="off" required><button class="btn btn-sm btn-ghost" type="button" data-action="member-lookup" data-id="${ctx.esc(modal.id)}">Buscar cuenta</button></div></div>${result}`, found && found.emailVerified && found.active ? "Autorizar" : "", { live: true });
    } },
    "change-create": { markup(ctx, modal) {
      const project = projectOf(ctx, modal.id);
      return ctx.modalShell(project.name, "Nueva solicitud de cambio", "Registrarla no cambia el alcance, el precio ni las fechas. Eso solo ocurre si la aceptás después.", [ctx.select("origin", "Quién lo pide", [["client", "El cliente"], ["eclipse", "Eclipse"]], "client"), ctx.field("title", "Título", "text", "", 'required maxlength="160"'), ctx.area("description", "Qué se pide", "", 'required rows="4" maxlength="4000"')].join(""), "Registrar cambio", { live: true });
    } },
    "change-evaluate": { markup(ctx, modal) {
      const change = (ctx.repo.data("project.scope", modal.id)?.changeRequests || []).find((c) => c.id === modal.kind);
      return ctx.modalShell(`Cambio #${change?.number ?? ""}`, "Evaluar y estimar", "Para marcarlo como estimado hacen falta horas, precio y plazo. El precio puede ser negativo.", [
        ctx.select("status", "Estado", [["evaluating", "En evaluación"], ["estimated", "Estimado"], ["closed", "Cerrado sin decisión"]], change?.status === "received" ? "evaluating" : change?.status),
        ctx.row(ctx.field("hoursImpact", "Horas", "text", change?.hoursImpact ?? "", 'inputmode="numeric"'), ctx.field("scheduleImpactDays", "Plazo · días", "text", change?.scheduleImpactDays ?? "", 'inputmode="numeric"')),
        ctx.field("priceImpact", "Impacto en el precio · USD", "text", change?.priceImpact ?? "", 'inputmode="decimal"'),
        ctx.area("technicalAssessment", "Evaluación técnica", change?.technicalAssessment || "", 'rows="3" maxlength="4000"'),
        ctx.area("commercialDecision", "Criterio comercial", change?.commercialDecision || "", 'rows="3" maxlength="4000"'),
      ].join(""), "Guardar", { live: true });
    } },
    "change-decide": { markup(ctx, modal) {
      const change = (ctx.repo.data("project.scope", modal.id)?.changeRequests || []).find((c) => c.id === modal.kind);
      const scope = ctx.repo.data("project.scope", modal.id);
      const current = scope?.versions.at(-1)?.items.join("\n") || "";
      return ctx.modalShell(`Cambio #${change?.number ?? ""} · ${change?.title ?? ""}`, "Aceptar o rechazar", ctx.esc(`Aceptar crea la próxima versión del alcance y ${change?.priceImpactCents ? `suma ${money(change.priceImpactCents)} al precio acordado` : "actualiza el precio acordado"}. Es definitivo.`), [
        ctx.select("decision", "Decisión", [["accepted", "Aceptar"], ["rejected", "Rechazar"]], "accepted"),
        ctx.field("reference", "Referencia de la aceptación · solo si aceptás", "text", "", 'maxlength="160" placeholder="Mensaje, presupuesto o firma que respalda el cambio"'),
        ctx.field("acceptedOn", "Fecha de la aceptación", "date", todayISO(), `max="${todayISO()}"`),
        ctx.area("scopeItems", "Alcance resultante · un entregable por línea", current, 'rows="5"'),
        ctx.area("commercialDecision", "Motivo o criterio", "", 'rows="2" maxlength="4000"'),
      ].join(""), "Confirmar decisión", { live: true });
    } },
  },

  // ---------- Botones directos ----------
  actions: {
    "project-resume": async (ctx, { id }) => {
      const project = projectOf(ctx, id);
      const body = unwrap(out.transitionBody("resume", {}, project));
      await ctx.api.post(`/admin/projects/${id}/transition`, body);
      return { message: "Proyecto retomado.", refresh: [["projects"], ["project", id], ["project.audit", id]] };
    },
    "update-resolve": async (ctx, { id, kind }) => {
      const update = (ctx.repo.data("project.updates", id) || []).find((u) => u.id === kind);
      await ctx.api.post(`/admin/projects/${id}/updates/${kind}/resolve`, { version: update.version });
      return { message: "Acción marcada como resuelta.", refresh: [["project.updates", id]] };
    },
    "member-remove": async (ctx, { id, kind }) => {
      if (!window.confirm("¿Quitar a esta persona del proyecto? Deja de verlo en su portal. El historial se conserva.")) return null;
      await ctx.api.post(`/admin/projects/${id}/members/${kind}/remove`);
      return { message: "Acceso quitado.", refresh: [["project", id]] };
    },
    "member-lookup": async (ctx, { id, button }) => {
      const email = button.closest("form")?.elements.email?.value.trim().toLowerCase() || "";
      if (!email) { ctx.setModal({ lookup: null, lookupError: "Escribí el email de la cuenta." }); return null; }
      try {
        const data = await ctx.api.post("/admin/clients/lookup", { email });
        ctx.setModal({ email, lookup: data, lookupError: "" });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) ctx.setModal({ email, lookup: null, lookupError: "No hay una cuenta de cliente verificada con ese email. El cliente tiene que registrarse y verificar su email primero." });
        else if (error instanceof ApiError && error.status === 403) ctx.setModal({ email, lookup: null, lookupError: "Tu cuenta no puede buscar clientes (falta clients:read)." });
        else throw error;
      }
      return null;
    },
  },

  // ---------- Envíos ----------
  mutations: {
    async "new-project"(values, h) {
      const request = h.target.kind === "request" ? h.repo.data("request", h.target.id) : null;
      const memberClientIds = [];
      if (request && values.authorizeRequest) memberClientIds.push(request.clientId);
      const email = (values.clientEmail || "").trim().toLowerCase();
      if (email) {
        try {
          const found = (await h.api.post("/admin/clients/lookup", { email })).client;
          if (!found.emailVerified || !found.active) throw new FormError("Esa cuenta no está verificada o está suspendida: no se puede autorizar.");
          if (!memberClientIds.includes(found.id)) memberClientIds.push(found.id);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) throw new FormError("No hay una cuenta de cliente verificada con ese email. Dejá el campo vacío para autorizar a alguien más tarde.");
          throw error;
        }
      }
      const body = unwrap(out.projectCreateBody({ ...values, sourcePlanRequestId: request?.id, memberClientIds, memberRole: values.memberRole }));
      h.touch(["projects"]);
      if (request) { h.touch(["request", request.id]); for (const key of h.repo.loadedKeys("requests")) h.touch(["requests", key]); }
      const result = await h.api.post("/admin/projects", body, { idempotencyKey: h.idem(body) });
      return { message: "Seña registrada. Proyecto en Preparación (1 de 5).", goto: `#proyectos/${result.project.id}` };
    },

    async "new-payment"(values, h) {
      const projectId = values.projectId;
      const project = projectOf(h, projectId);
      if (!project) throw new FormError("Elegí un proyecto.");
      if (project.stage === "closed" && values.kind !== "maintenance") throw new FormError("Un proyecto cerrado solo acepta cobros de mantenimiento.");
      const built = out.paymentCreateBody(values);
      const body = unwrap(built);
      const finance = h.repo.data("project.finance", projectId);
      if (finance && values.kind !== "maintenance" && values.status !== "proposed") {
        const available = finance.balanceCents - finance.committedCents;
        if (body.amountCents > available) throw new FormError(`El monto supera lo que falta cobrar del precio acordado (${money(Math.max(0, available))}). Si cambió el alcance, registrá antes el cambio de precio.`);
      }
      touchProject(h, projectId, "project.payments", "project.finance");
      await h.api.post(`/admin/projects/${projectId}/payments`, body, { idempotencyKey: h.idem(body) });
      return { message: values.status === "collected" ? "Cobro registrado." : values.status === "committed" ? "Cobro comprometido registrado." : "Cobro propuesto registrado.", goto: h.target.returnTo };
    },

    async "project-advance"(values, h) {
      const project = projectOf(h, h.target.id);
      const stage = values.stage;
      const body = unwrap(out.transitionBody("advance", { stage: stageToApi(stage) }, project));
      if (values.draft && (!values.title?.trim() || !values.body?.trim())) throw new FormError("Para preparar el borrador escribí título y detalle.");
      touchProject(h, project.id, "project.updates");
      await h.api.post(`/admin/projects/${project.id}/transition`, body);
      if (values.draft) {
        const draft = unwrap(out.updateCreateBody({ kind: "status_change", title: values.title, body: values.body }));
        try {
          await h.api.post(`/admin/projects/${project.id}/updates`, draft);
        } catch (error) {
          return { message: `Etapa cambiada a ${STAGES[stage].name}, pero el borrador no se pudo crear (${error.message}). Crealo desde Actualizaciones.` };
        }
        return { message: `Proyecto en ${STAGES[stage].name}. El borrador para el cliente espera tu revisión.` };
      }
      return { message: `Proyecto en ${STAGES[stage].name}.` };
    },
    async "project-pause"(values, h) {
      const project = projectOf(h, h.target.id);
      const body = unwrap(out.transitionBody("pause", values, project));
      touchProject(h, project.id);
      await h.api.post(`/admin/projects/${project.id}/transition`, body);
      return { message: "Proyecto en pausa." };
    },
    async "project-close"(values, h) {
      const project = projectOf(h, h.target.id);
      const body = unwrap(out.transitionBody("close", values, project));
      touchProject(h, project.id);
      await h.api.post(`/admin/projects/${project.id}/transition`, body);
      return { message: "Proyecto cerrado." };
    },
    async "project-edit"(values, h) {
      const project = projectOf(h, h.target.id);
      const body = unwrap(out.projectPatchBody(values, project));
      touchProject(h, project.id);
      await h.api.patch(`/admin/projects/${project.id}`, body);
      return { message: "Datos del proyecto guardados." };
    },

    async "milestone-edit"(values, h) {
      const id = h.target.id;
      h.touch(["project.milestones", id]);
      if (h.target.kind) {
        const milestone = (h.repo.data("project.milestones", id) || []).find((m) => m.id === h.target.kind);
        const body = unwrap(out.milestonePatchBody(values, milestone));
        await h.api.patch(`/admin/projects/${id}/milestones/${milestone.id}`, body);
        return { message: "Hito guardado." };
      }
      const body = unwrap(out.milestoneCreateBody(values));
      await h.api.post(`/admin/projects/${id}/milestones`, body);
      return { message: "Hito creado. Es interno: el cliente no lo ve." };
    },
    async "milestone-complete"(values, h) {
      const id = h.target.id;
      const milestone = (h.repo.data("project.milestones", id) || []).find((m) => m.id === h.target.kind);
      const body = unwrap(out.milestoneCompleteBody(values, milestone));
      h.touch(["project.milestones", id]);
      await h.api.patch(`/admin/projects/${id}/milestones/${milestone.id}`, body);
      return { message: "Hito completado." };
    },
    async "milestone-visibility"(values, h) {
      if (!values.confirm) throw new FormError("Marcá la confirmación para continuar.");
      const id = h.target.id;
      const milestone = (h.repo.data("project.milestones", id) || []).find((m) => m.id === h.target.kind);
      h.touch(["project.milestones", id]);
      await h.api.post(`/admin/projects/${id}/milestones/${milestone.id}/visibility`, unwrap(out.milestoneVisibilityBody(milestone, !milestone.visibleToClient)));
      return { message: milestone.visibleToClient ? "El hito dejó de ser visible para el cliente." : "El hito ahora lo ve el cliente." };
    },

    async "update-edit"(values, h) {
      const id = h.target.id;
      h.touch(["project.updates", id]);
      const existing = h.target.kind ? (h.repo.data("project.updates", id) || []).find((u) => u.id === h.target.kind) : null;
      if (existing) {
        const body = unwrap(out.updatePatchBody(values, existing));
        await h.api.patch(`/admin/projects/${id}/updates/${existing.id}`, body);
        return { message: "Registro guardado." };
      }
      const body = unwrap(out.updateCreateBody({ ...values, kind: values.updateKind }));
      await h.api.post(`/admin/projects/${id}/updates`, body);
      return { message: body.kind === "internal_note" ? "Nota interna guardada. El cliente no la ve." : "Borrador guardado. El cliente todavía no lo ve: publicalo cuando esté listo." };
    },
    async "update-publish"(values, h) {
      const id = h.target.id;
      const update = (h.repo.data("project.updates", id) || []).find((u) => u.id === h.target.kind);
      const body = unwrap(out.updatePublishBody(update, Boolean(values.confirm)));
      h.touch(["project.updates", id]);
      await h.api.post(`/admin/projects/${id}/updates/${update.id}/publish`, body);
      return { message: "Publicado. El cliente ya lo ve en su portal." };
    },
    async "update-withdraw"(values, h) {
      const id = h.target.id;
      const update = (h.repo.data("project.updates", id) || []).find((u) => u.id === h.target.kind);
      const body = unwrap(out.updateWithdrawBody(update, values.reason));
      h.touch(["project.updates", id]);
      await h.api.post(`/admin/projects/${id}/updates/${update.id}/withdraw`, body);
      return { message: "Retirada. El cliente ya no la ve." };
    },

    async "payment-transition"(values, h) {
      const id = h.target.id;
      const payment = (h.repo.data("project.payments", id) || []).find((p) => p.id === h.target.kind);
      const body = unwrap(out.paymentTransitionBody(h.target.to, values, payment));
      touchProject(h, id, "project.payments", "project.finance");
      await h.api.patch(`/admin/projects/${id}/payments/${payment.id}`, body);
      return { message: { committed: "Cobro comprometido.", collected: "Cobro marcado como cobrado.", voided: "Cobro anulado." }[h.target.to] };
    },

    async "member-add"(values, h) {
      const lookup = h.modal?.lookup?.client;
      const body = unwrap(out.memberBody(lookup?.id, values.role));
      h.touch(["project", h.target.id]);
      await h.api.post(`/admin/projects/${h.target.id}/members`, body);
      return { message: "Cliente autorizado. Ya ve el proyecto en su portal." };
    },

    async "change-create"(values, h) {
      const body = unwrap(out.changeRequestCreateBody(values));
      h.touch(["project.scope", h.target.id]);
      await h.api.post(`/admin/projects/${h.target.id}/change-requests`, body);
      return { message: "Solicitud de cambio registrada. No modifica nada hasta que se acepte." };
    },
    async "change-evaluate"(values, h) {
      const change = (h.repo.data("project.scope", h.target.id)?.changeRequests || []).find((c) => c.id === h.target.kind);
      const body = unwrap(out.changeEvaluateBody(values, change));
      h.touch(["project.scope", h.target.id]);
      await h.api.patch(`/admin/projects/${h.target.id}/change-requests/${change.id}`, body);
      return { message: "Evaluación guardada." };
    },
    async "change-decide"(values, h) {
      const change = (h.repo.data("project.scope", h.target.id)?.changeRequests || []).find((c) => c.id === h.target.kind);
      const body = unwrap(out.changeDecisionBody(values, change));
      touchProject(h, h.target.id, "project.scope", "project.finance");
      await h.api.post(`/admin/projects/${h.target.id}/change-requests/${change.id}/decision`, body);
      return { message: values.decision === "accepted" ? "Cambio aceptado: nueva versión del alcance y precio actualizado." : "Cambio rechazado." };
    },
  },
};
