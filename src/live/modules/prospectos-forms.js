// Formularios, diálogos y envíos de Prospectos: alta con búsqueda de duplicados, actividades, etapa, consentimiento, edición,
// duplicado, lote y conversión en proyecto. Cada envío arma el cuerpo con adapters/crm-outbound.js, espera al servidor y declara
// con h.touch() qué volver a pedir. Los 409 del servidor llegan con un mensaje genérico: acá se actualiza la ficha y se explica.
import { ApiError, errorFromResponse } from "../../api/errors.js";
import { addDays, todayISO } from "../../rules.js";
import { centsToDollars } from "../adapters/common.js";
import { CHANNELS, CONSENT_LABELS, LANGUAGES, LEAD_STAGE_LABELS, SOURCES, adaptLead, keyQuery, lastProposal, ownerLabel, stageBeforePause, stageTargets } from "../adapters/crm.js";
import * as out from "../adapters/crm-outbound.js";
import { FormError, unwrap } from "../errors.js";
import projectForms from "./proyectos-forms.js";

const checkbox = (name, label, { checked = false, required = false, hint = "" } = {}) => `<div class="pt-field live-check"><label><input type="checkbox" name="${name}" value="1"${checked ? " checked" : ""}${required ? " required" : ""}> <span>${label}</span></label>${hint ? `<p class="pt-fine">${hint}</p>` : ""}</div>`;
const summaryList = (ctx, pairs) => `<dl class="generator-summary">${pairs.filter(([, value]) => value !== "" && value !== undefined && value !== null).map(([label, value]) => `<div><dt>${ctx.esc(label)}</dt><dd>${ctx.esc(value)}</dd></div>`).join("")}</dl>`;
const pairs = (object) => Object.entries(object);

/** Último resultado de «Buscar duplicados» del formulario de alta (solo en memoria; vale mientras el contacto no cambie). */
let lastCheck = { signature: "", candidates: [] };
const MATCH_LABELS = { email: "mismo email", phone: "mismo teléfono", name_company: "mismo nombre y empresa" };

const leadOf = (h, id) => h.repo.data("lead", id) || null;

/** Todo lo que se vuelve a pedir tras tocar un prospecto: su ficha, su historial, su auditoría y toda lista ya cargada. */
function touchLead(h, id, ...more) {
  for (const slice of ["lead", "lead.activities", "lead.audit"]) h.touch([slice, id]);
  for (const key of h.repo.loadedKeys("leads")) h.touch(["leads", key]);
  for (const slice of more) h.touch(slice);
}

/** Un 409 del servidor es genérico: se actualiza lo que se ve y se explica qué suele significar acá. */
async function explaining(h, slices, message, run) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      await h.repo.refresh(slices).catch(() => {});
      throw new FormError(message);
    }
    throw error;
  }
}

function leadValues(lead) {
  return {
    contactName: lead.name, company: lead.company || "", email: lead.email || "", phone: lead.phone || "", handle: lead.handle || "", channel: lead.channel,
    sourceDetail: lead.sourceDetail || "", need: lead.need, vertical: lead.vertical || "", language: lead.language, commercialNotes: lead.commercialNotes || "",
    ownerAdminId: lead.ownerAdminId, nextAction: lead.nextAction || "", nextActionOn: lead.nextActionOn || "",
  };
}

const OFFSETS = [2, 5, 9];
/** Después de un toque, el siguiente según la regla +2/+5/+9 desde la propuesta (o el cierre tras el tercero). */
function afterTouch(activities, today) {
  const proposal = lastProposal(activities);
  if (!proposal) return null;
  const done = activities.filter((a) => !a.voided && a.kind === "follow_up" && a.direction === "outbound" && a.date >= proposal.date).length + 1;
  if (done < OFFSETS.length) return [`Toque ${done + 1} de 3 (+${OFFSETS[done]} días de la propuesta)`, addDays(proposal.date, OFFSETS[done]) < today ? today : addDays(proposal.date, OFFSETS[done])];
  return ["Sin respuesta tras 3 toques: cerrar o pausar", addDays(today, 1)];
}

const PRESETS = {
  reply: { kind: "message", direction: "inbound", title: "Respondió", hint: "Registrar la respuesta mueve el prospecto a Conversación. Regla: llamada el mismo día.", next: ["Llamar (mismo día que respondió)", 0] },
  call: { kind: "call", direction: "outbound", title: "Llamada hecha", hint: "Regla: propuesta en ≤24 h.", next: ["Enviar propuesta (≤24 h de la llamada)", 1] },
  demo: { kind: "demo", direction: "outbound", title: "Demo hecha", hint: "Una demo mueve el prospecto a Demo. Regla: propuesta en ≤24 h.", next: ["Enviar propuesta (≤24 h de la demo)", 1] },
  proposal: { kind: "proposal_sent", direction: "outbound", title: "Propuesta enviada", hint: "Una propuesta mueve el prospecto a Propuesta. Arrancan los toques a +2, +5 y +9 días.", next: ["Toque 1 de 3 (+2 días de la propuesta)", 2], amount: true },
  touch: { kind: "follow_up", direction: "outbound", title: "Toque de seguimiento", hint: "" },
  note: { kind: "note", direction: "internal", title: "Nota", hint: "Queda en el historial. No se manda a nadie." },
  other: { kind: "message", direction: "outbound", title: "Registrar actividad", hint: "Lo que pasó, con su fecha. El historial no se edita: corregir es agregar otra entrada.", generic: true, amount: true },
};
const DONE_MESSAGE = { reply: "Respuesta registrada. Regla: llamada el mismo día.", call: "Llamada registrada.", demo: "Demo registrada.", proposal: "Propuesta registrada. Arrancan los toques a +2, +5 y +9 días.", touch: "Toque registrado.", note: "Nota guardada.", other: "Actividad registrada." };

export default {
  // ---------- Pantallas completas ----------
  wizards: {
    "new-prospect": (wizard, ctx) => {
      const { esc, field, area, select, row } = ctx;
      const today = todayISO();
      const batches = (ctx.repo.data("batches")?.items || []).filter((batch) => batch.open);
      const v = {
        contactName: "", company: "", channel: "whatsapp", language: "es", email: "", phone: "", handle: "", source: "manual", sourceDetail: "", need: "", vertical: "",
        batchId: wizard.id || "", budget: "", commercialNotes: "", stage: "prospect", nextAction: "Dar seguimiento: esperar respuesta", nextActionOn: addDays(today, 2),
        firstContactOn: today, acknowledgeDuplicates: "", ...wizard.values,
      };
      const signature = out.contactSignature(v);
      const checked = lastCheck.signature === signature ? lastCheck.candidates : null;
      const dupList = (candidates) => `<ul>${candidates.map((candidate) => `<li><a class="pt-link" style="min-height:0" href="#prospectos/${encodeURIComponent(candidate.id)}" target="_blank" rel="noopener">${esc(candidate.contactName)}${candidate.company ? ` · ${esc(candidate.company)}` : ""}</a><span class="pt-meta">${esc(candidate.matchedOn.map((m) => MATCH_LABELS[m] || m).join(" · "))} · ${esc(LEAD_STAGE_LABELS[candidate.stage] || candidate.stage)}${candidate.duplicateOfId ? " · ya marcado como duplicado" : ""}</span></li>`).join("")}</ul>`;
      const dupFound = (candidates) => `<p class="pt-fine"><strong>${candidates.length} posible${candidates.length === 1 ? "" : "s"} duplicado${candidates.length === 1 ? "" : "s"}.</strong> Abrilos antes de seguir.</p>${dupList(candidates)}`;
      const dupPanel = `<section class="live-dups" aria-label="Duplicados" aria-live="polite"><span class="label">Duplicados</span>
        ${checked === null ? '<p class="pt-fine">Antes de crear, buscá si ya está cargado: por email o teléfono exactos, o por nombre y empresa. Nunca se mezcla nada solo.</p>'
          : checked.length ? dupFound(checked) : '<p class="pt-fine">No encontramos coincidencias con estos datos.</p>'}
        <div class="pt-actions">${ctx.btn("lead-duplicate-check", checked === null ? "Buscar duplicados" : "Buscar de nuevo", "btn-ghost")}</div></section>`;
      return {
        kicker: "Prospectos", title: "Una nueva oportunidad en órbita.",
        intro: "El contacto queda en el pipeline con responsable y una próxima acción con fecha. Cuando responda, el sistema te recuerda el próximo paso.", submit: "Crear prospecto",
        values: v,
        steps: [
          ["Contacto", "¿Con quién vas a conversar?", `${field("contactName", "Nombre", "text", v.contactName, 'required maxlength="120"')}${field("company", "Empresa · opcional", "text", v.company, 'maxlength="160"')}${row(select("channel", "Canal principal", pairs(CHANNELS), v.channel), select("language", "Idioma", pairs(LANGUAGES), v.language))}${field("email", "Email · opcional", "email", v.email, 'maxlength="254" autocomplete="off"')}${field("phone", "Teléfono · opcional, con +", "tel", v.phone, 'maxlength="24" autocomplete="off" placeholder="+5491122334455"')}${field("handle", "Usuario o enlace · opcional", "text", v.handle, 'maxlength="120" placeholder="@usuario, perfil, enlace"')}<p class="pt-fine">Cargá al menos un email, un teléfono o un usuario.</p>${dupPanel}`],
          ["Oportunidad", "Qué necesita y cómo llegó.", `${area("need", "Necesidad concreta", v.need, 'required rows="3" maxlength="2000"')}${row(select("source", "Fuente", pairs(SOURCES), v.source), field("sourceDetail", "Detalle de la fuente", "text", v.sourceDetail, 'maxlength="160" placeholder="Quién lo refirió, qué comunidad, qué evento…"'))}<p class="pt-fine">Referido, comunidad y presencial piden el detalle: sin eso el indicador de tibios no prueba nada. Plataformas como Upwork: elegí «Otro» y escribí el nombre en el detalle.</p>${field("vertical", "Rubro · opcional", "text", v.vertical, 'maxlength="80" placeholder="Clínicas, gastronomía…"')}${ctx.can("billing:write") ? field("budget", "Presupuesto del cliente · USD, opcional", "text", v.budget, 'inputmode="decimal" placeholder="1500"') : '<p class="pt-fine">Tu cuenta no carga importes (falta <span class="readout">billing:write</span>).</p>'}${batches.length ? select("batchId", "Sumar a un lote abierto · opcional", batches.map((batch) => [batch.id, batch.name]), v.batchId, "Sin lote") : ""}${area("commercialNotes", "Notas comerciales · opcional (sin importes)", v.commercialNotes, 'rows="2" maxlength="4000"')}<p class="pt-fine">El servidor no guarda una oferta sugerida por prospecto ni la unidad (Agency, Media, Market): las propuestas se registran después, con su monto.</p>`],
          ["Próxima acción", "Todo prospecto tiene responsable y una próxima acción con fecha.", `${select("stage", "Etapa de partida", [["prospect", "Prospecto · sin respuesta todavía"], ["conversation", "Conversación · ya respondió"]], v.stage)}${field("nextAction", "Próxima acción", "text", v.nextAction, 'required maxlength="300"')}${row(field("nextActionOn", "Para el", "date", v.nextActionOn, `required min="${today}"`), field("firstContactOn", "Primer contacto", "date", v.firstContactOn, `required max="${today}"`))}<p class="pt-fine">Responsable: vos (${esc(ctx.admin?.email || "tu cuenta")}). Se puede reasignar después.</p>`],
        ].concat([["Revisión", "Todo listo para confirmar.", `${summaryList(ctx, [["Prospecto", `${v.contactName}${v.company ? ` · ${v.company}` : ""}`], ["Contacto", [v.email, v.phone, v.handle].filter(Boolean).join(" · ")], ["Canal / idioma", `${CHANNELS[v.channel] || ""} · ${LANGUAGES[v.language] || ""}`], ["Fuente", `${SOURCES[v.source] || ""}${v.sourceDetail ? ` · ${v.sourceDetail}` : ""}`], ["Necesidad", v.need], ["Etapa", v.stage === "conversation" ? "Conversación" : "Prospecto"], ["Próxima acción", `${v.nextAction} · ${v.nextActionOn}`], ["Lote", batches.find((batch) => batch.id === v.batchId)?.name || ""]])}${checked && checked.length ? `<section class="live-dups" aria-label="Duplicados" aria-live="polite"><span class="label">Duplicados</span>${dupFound(checked)}</section>${checkbox("acknowledgeDuplicates", "Ya revisé los posibles duplicados y quiero crearlo igual", { checked: Boolean(v.acknowledgeDuplicates), required: true, hint: "Es una decisión tuya: el prospecto nuevo y el que ya existía quedan separados." })}` : checked === null ? `<p class="pt-fine">Todavía no buscaste duplicados. Se buscan igual al crear; si hay coincidencias vas a tener que confirmarlas.</p><div class="pt-actions">${ctx.btn("lead-duplicate-check", "Buscar duplicados ahora", "btn-ghost")}</div>` : ""}`]]),
      };
    },

    /** Convertir un prospecto en proyecto: el mismo formulario de «proyecto con seña» de la etapa 1, con el prospecto como origen. */
    "convert-lead": (wizard, ctx) => {
      const { esc } = ctx;
      const lead = ctx.repo.data("lead", wizard.id);
      if (!lead) {
        return { kicker: "Prospectos", title: "Volvé al prospecto.", intro: "Para convertir hace falta abrirlo primero desde la lista.", submit: "Entendido", values: wizard.values || {}, steps: [["Prospecto", "No está cargado.", `<p class="pt-fine">El prospecto ya no está en pantalla. Abrilo desde <a class="pt-link" href="#prospectos">Prospectos</a> y elegí «Convertir en proyecto».</p>`]] };
      }
      const company = lead.company || lead.name;
      const base = projectForms.wizards["new-project"]({ ...wizard, kind: "lead", values: { name: company, organizationName: company, ...wizard.values } }, ctx);
      const origin = `<p class="generator-warning" role="note">Origen: prospecto <strong>${esc(lead.name)}</strong> (${esc(lead.stageLabel)}). Convertir registra la venta: nace el proyecto con acuerdo y seña cobrada, y el prospecto pasa a Ganado. Todo se confirma junto o no se crea nada. Los datos de abajo son una sugerencia: confirmá lo que realmente se acordó.</p>`;
      return {
        ...base,
        kicker: "Prospectos", title: "De prospecto a proyecto.",
        intro: "Un proyecto nace con un acuerdo y la seña ya cobrada. El prospecto queda Ganado, enlazado a su proyecto.", submit: "Convertir en proyecto",
        steps: base.steps.map((step, index) => (index === 0 ? [step[0], step[1], origin + step[2]] : step)),
      };
    },
  },

  // ---------- Diálogos ----------
  modals: {
    "lead-activity": { markup(ctx, modal) {
      const { esc, field, area, select, row } = ctx;
      const lead = ctx.repo.data("lead", modal.id);
      const preset = PRESETS[modal.kind] || PRESETS.other;
      const activities = ctx.repo.data("lead.activities", modal.id)?.items || [];
      const today = todayISO();
      const blocked = lead.doNotContact && preset.direction === "outbound" && !preset.generic;
      if (blocked) {
        return ctx.modalShell(lead.name, preset.title, esc("El consentimiento está rechazado o retirado: no se pueden registrar contactos salientes. Registrá lo entrante o una nota, o cambiá el consentimiento con su base."), "", "", { live: true });
      }
      const suggestion = modal.kind === "touch" ? afterTouch(activities, today) : preset.next ? [preset.next[0], addDays(today, preset.next[1])] : null;
      const kindField = preset.generic ? select("kind", "Qué pasó", [["message", "Mensaje"], ["call", "Llamada"], ["meeting", "Reunión"], ["demo", "Demo"], ["proposal_sent", "Propuesta enviada"], ["follow_up", "Seguimiento"], ["note", "Nota"]], "message") : "";
      const directionField = preset.direction === "internal" || preset.kind === "proposal_sent" ? "" : select("direction", "Quién", [["inbound", "Entrante · te escribió o llamó"], ["outbound", "Saliente · vos"]], preset.direction);
      return ctx.modalShell(lead.name, preset.title, esc(preset.hint), [
        kindField, directionField,
        select("channel", "Canal", pairs(CHANNELS), lead.channel),
        row(field("occurredOn", "Fecha", "date", today, `required max="${today}"`), field("occurredAt", "Hora real · opcional", "time", "", "")),
        '<p class="pt-fine">Si no sabés la hora, dejala vacía: queda «hora no registrada». Nunca se completa sola.</p>',
        area("summary", modal.kind === "note" ? "Nota" : "Qué pasó", "", 'required rows="3" maxlength="2000"'),
        modal.kind === "note" ? "" : field("outcome", "Resultado · opcional", "text", "", 'maxlength="500"'),
        preset.amount && ctx.can("billing:write") ? field("amount", "Monto de la propuesta · USD, opcional", "text", "", 'inputmode="decimal" placeholder="900"') : "",
        preset.amount && !ctx.can("billing:write") ? '<p class="pt-fine">Tu cuenta no carga importes (falta <span class="readout">billing:write</span>).</p>' : "",
        modal.kind === "note" ? "" : `${row(field("nextAction", "Próxima acción · opcional", "text", suggestion?.[0] || "", 'maxlength="300"'), field("nextActionOn", "Para el", "date", suggestion?.[1] || "", ""))}<p class="pt-fine">Texto y fecha juntos, o las dos vacías para dejar la que ya tiene.</p>`,
      ].join(""), "Guardar", { live: true });
    } },

    "lead-stage": { markup(ctx, modal) {
      const { esc, field, area, select, row } = ctx;
      const lead = ctx.repo.data("lead", modal.id);
      const today = todayISO();
      if (modal.kind === "paused") {
        return ctx.modalShell(lead.name, "Pausar", "Toda pausa lleva motivo y fecha de revisión. Queda en el historial.", [area("reason", "Motivo", "", 'required rows="3" maxlength="500"'), field("reviewOn", "Revisar el", "date", addDays(today, 14), `required min="${today}"`)].join(""), "Pausar", { live: true });
      }
      if (modal.kind === "lost") {
        return ctx.modalShell(lead.name, "Marcar perdido", "Queda en el historial con su motivo. Se puede reactivar después.", area("reason", "Motivo · opcional, pero ayuda a aprender", "", 'rows="3" maxlength="500"'), "Marcar perdido", { live: true });
      }
      const activities = ctx.repo.data("lead.activities", modal.id)?.items || [];
      const targets = stageTargets(lead.stage);
      const before = lead.stage === "paused" ? stageBeforePause(activities) : null;
      const selected = before || (lead.stage === "paused" || lead.stage === "lost" ? "prospect" : targets[0]);
      return ctx.modalShell(lead.name, lead.stage === "paused" || lead.stage === "lost" ? "Reactivar" : "Cambiar de etapa", esc("Pasar a Propuesta o Negociación exige una propuesta enviada registrada. «Ganado» solo se logra convirtiendo en proyecto."), [
        select("stage", "Pasar a", targets.map((stage) => [stage, LEAD_STAGE_LABELS[stage]]), targets.includes(selected) ? selected : targets[0]),
        row(field("nextAction", "Próxima acción", "text", lead.nextAction || "Retomar el contacto", 'maxlength="300" required'), field("nextActionOn", "Para el", "date", lead.nextActionOn && lead.nextActionOn >= today ? lead.nextActionOn : addDays(today, 1), `min="${today}" required`)),
        area("reason", "Nota del cambio · opcional", "", 'rows="2" maxlength="500"'),
      ].join(""), "Cambiar etapa", { live: true });
    } },

    "lead-consent": { markup(ctx, modal) {
      const { esc, field, area, select } = ctx;
      const lead = ctx.repo.data("lead", modal.id);
      const today = todayISO();
      return ctx.modalShell(lead.name, "Consentimiento", esc("Con consentimiento rechazado o retirado el sistema no deja registrar contactos salientes, no permite sumarlo a un lote y no genera recordatorios de toques. Salir de ese estado exige registrar la base."), [
        select("status", "Estado", pairs(CONSENT_LABELS), lead.consent.status),
        field("on", "Fecha", "date", today, `max="${today}"`),
        area("basis", "Base o motivo", "", 'rows="2" maxlength="300" placeholder="Cómo y cuándo lo dijo: mensaje del 3/10, llamada…"'),
      ].join(""), "Guardar", { live: true });
    } },

    "lead-edit": { markup(ctx, modal) {
      const { esc, field, area, select, row } = ctx;
      const lead = ctx.repo.data("lead", modal.id);
      if (modal.kind === "next") {
        return ctx.modalShell(lead.name, "Editar próxima acción", "Todo prospecto en trabajo tiene una próxima acción con fecha.", row(field("nextAction", "Próxima acción", "text", lead.nextAction || "", 'required maxlength="300"'), field("nextActionOn", "Para el", "date", lead.nextActionOn || todayISO(), "required")), "Guardar", { live: true });
      }
      const owners = [[ctx.admin?.id, `Yo (${ctx.admin?.email || "esta cuenta"})`]];
      if (lead.ownerAdminId !== ctx.admin?.id) owners.unshift([lead.ownerAdminId, `Mantener ${ownerLabel(lead.ownerAdminId, ctx.admin?.id)}`]);
      return ctx.modalShell(lead.name, "Editar datos", "Etapa y consentimiento se cambian con sus propios botones. La API no lista administradores: se puede asignar a esta cuenta o mantener al actual.", [
        field("contactName", "Nombre", "text", lead.name, 'required maxlength="120"'),
        row(field("company", "Empresa", "text", lead.company || "", 'maxlength="160"'), field("vertical", "Rubro", "text", lead.vertical || "", 'maxlength="80"')),
        row(field("email", "Email", "email", lead.email || "", 'maxlength="254" autocomplete="off"'), field("phone", "Teléfono con +", "tel", lead.phone || "", 'maxlength="24" autocomplete="off"')),
        field("handle", "Usuario o enlace", "text", lead.handle || "", 'maxlength="120"'),
        row(select("channel", "Canal principal", pairs(CHANNELS), lead.channel), select("language", "Idioma", pairs(LANGUAGES), lead.language)),
        field("sourceDetail", `Detalle de la fuente (${esc(lead.sourceLabel)})`, "text", lead.sourceDetail || "", 'maxlength="160"'),
        area("need", "Necesidad", lead.need, 'required rows="3" maxlength="2000"'),
        ctx.can("billing:write") ? field("budget", "Presupuesto del cliente · USD", "text", lead.budgetCents ? String(centsToDollars(lead.budgetCents)) : "", 'inputmode="decimal"') : "",
        area("commercialNotes", "Notas comerciales (sin importes)", lead.commercialNotes || "", 'rows="2" maxlength="4000"'),
        select("ownerAdminId", "Responsable", owners, lead.ownerAdminId),
        lead.open ? row(field("nextAction", "Próxima acción", "text", lead.nextAction || "", 'required maxlength="300"'), field("nextActionOn", "Para el", "date", lead.nextActionOn || todayISO(), "required")) : "",
      ].join(""), "Guardar", { live: true });
    } },

    "lead-void": { markup(ctx, modal) {
      const lead = ctx.repo.data("lead", modal.id);
      const activity = (ctx.repo.data("lead.activities", modal.id)?.items || []).find((item) => item.id === modal.kind);
      return ctx.modalShell(lead.name, "Anular actividad", ctx.esc(`${activity ? `«${activity.title}» del ${activity.date}. ` : ""}La fila se conserva con tu motivo y tu usuario; deja de contar en los indicadores. Las entradas del sistema no se anulan.`), ctx.area("reason", "Motivo", "", 'required rows="3" maxlength="500"'), "Anular", { live: true });
    } },

    "lead-duplicate": { markup(ctx, modal) {
      const { esc, field, select } = ctx;
      const lead = ctx.repo.data("lead", modal.id);
      const options = lead.possibleDuplicates.map((candidate) => [candidate.id, `${ctx.repo.data("lead", candidate.id)?.name || `#${candidate.id.slice(0, 8)}`} · ${candidate.matchedOn.map((m) => MATCH_LABELS[m] || m).join(" y ")}`]);
      return ctx.modalShell(lead.name, "Marcar como duplicado", esc("Es una decisión tuya: este prospecto queda Perdido apuntando al principal. No se mezcla ni se borra nada y no se puede deshacer desde acá. No se puede marcar uno con propuestas enviadas."), [
        options.length ? select("canonicalId", "Duplicado de", options, modal.kind || options[0][0]) : "",
        field("canonicalText", options.length ? "O pegá el ID del principal" : "ID del prospecto principal", "text", options.length ? "" : (modal.kind || ""), options.length ? 'autocomplete="off" placeholder="00000000-0000-4000-8000-000000000000"' : 'required autocomplete="off" placeholder="00000000-0000-4000-8000-000000000000"'),
      ].join(""), "Marcar duplicado", { live: true });
    } },

    "lead-batch": { markup(ctx, modal) {
      const lead = ctx.repo.data("lead", modal.id);
      const batches = (ctx.repo.data("batches")?.items || []).filter((batch) => batch.open);
      return ctx.modalShell(lead.name, "Sumar a un lote", "Un prospecto pertenece a un solo lote abierto a la vez, solo si se está trabajando y no rechazó el contacto.", batches.length ? ctx.select("batchId", "Lote", batches.map((batch) => [batch.id, `${batch.name} · ${batch.statusLabel}`]), batches[0].id) : '<p class="pt-fine">No hay lotes abiertos. Creá uno en <a class="pt-link" href="#lotes">Lotes</a>.</p>', batches.length ? "Sumar" : "", { live: true });
    } },

    /** Desde el detalle de una solicitud de plan: el prospecto nace con el nombre, el teléfono y el email de la cuenta. */
    "lead-from-request": { markup(ctx, modal) {
      const { esc, field, row } = ctx;
      const request = ctx.repo.data("request", modal.id);
      const today = todayISO();
      return ctx.modalShell(request?.contactName || "Solicitud", "Crear prospecto desde esta solicitud", esc("Copia el nombre, el teléfono y el email de la cuenta del cliente. No crea proyecto ni cobro. Hay un solo prospecto por solicitud: si ya existía, te lleva a él."), [
        row(field("nextAction", "Próxima acción", "text", "Contestar la solicitud y proponer una llamada", 'required maxlength="300"'), field("nextActionOn", "Para el", "date", addDays(today, 1), `required min="${today}"`)),
        `<p class="pt-fine">Responsable: vos (${esc(ctx.admin?.email || "esta cuenta")}).</p>`,
      ].join(""), "Crear prospecto", { live: true });
    } },
  },

  // ---------- Botones directos ----------
  actions: {
    "lead-duplicate-check": async (ctx) => {
      const values = ctx.state.wizard?.values || {};
      const body = unwrap(out.duplicateCheckBody(values));
      const data = await ctx.api.post("/admin/leads/duplicate-check", body);
      lastCheck = { signature: out.contactSignature(values), candidates: data.candidates || [] };
      return { message: lastCheck.candidates.length ? `Encontramos ${lastCheck.candidates.length} posible${lastCheck.candidates.length === 1 ? "" : "s"} duplicado${lastCheck.candidates.length === 1 ? "" : "s"}. Revisalos antes de crear.` : "No encontramos duplicados con estos datos.", refresh: [] };
    },

    "lead-audit-load": async (ctx, { id }) => {
      await ctx.repo.ensure("lead.audit", id, { force: true });
      return null;
    },

    "lead-batch-remove": async (ctx, { id, kind }) => {
      if (!window.confirm("¿Sacar este prospecto del lote? El historial conserva el lote en las actividades pasadas.")) return null;
      await ctx.api.post(`/admin/batches/${kind}/leads/remove`, unwrap(out.batchLeadsBody([id])));
      return { message: "Prospecto sacado del lote.", refresh: [["lead", id], ["lead.audit", id], ["batches"], ["batch", kind], ...ctx.repo.loadedKeys("leads").map((key) => ["leads", key])] };
    },

    /** CSV del servidor con los filtros de la pantalla. La exportación queda registrada en la auditoría del servidor. */
    "leads-export": async (ctx, { kind }) => {
      await ctx.api.get("/auth/admin/me"); // renueva la sesión si hace falta: esta descarga no pasa por el cliente JSON
      const query = new URLSearchParams(keyQuery(kind));
      const response = await fetch(`${ctx.config.apiBaseUrl.replace(/\/+$/, "")}/admin/leads/export${query.size ? `?${query}` : ""}`, { credentials: "include", cache: "no-store", headers: { Accept: "text/csv" } });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw errorFromResponse(response, body);
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `prospectos-${todayISO()}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      return { message: "CSV descargado con los filtros de la pantalla. La exportación queda registrada en la auditoría.", refresh: [] };
    },
  },

  // ---------- Envíos ----------
  mutations: {
    async "new-prospect"(values, h) {
      const body = unwrap(out.leadCreateBody(values, { canBudget: h.can("billing:write") }));
      // La búsqueda de duplicados se repite acá: es la que vale, aunque no se haya apretado el botón.
      const check = out.duplicateCheckBody(values);
      if (check.body && !values.acknowledgeDuplicates) {
        const found = (await h.api.post("/admin/leads/duplicate-check", check.body)).candidates || [];
        lastCheck = { signature: out.contactSignature(values), candidates: found };
        if (found.length) throw new FormError(`Encontramos ${found.length} posible${found.length === 1 ? "" : "s"} duplicado${found.length === 1 ? "" : "s"} (${found.slice(0, 3).map((c) => c.contactName).join(", ")}). Tocá «Buscar duplicados» para verlos y, si igual querés crearlo, confirmalo en la revisión.`);
      }
      for (const key of h.repo.loadedKeys("leads")) h.touch(["leads", key]);
      h.touch(["batches"]);
      let result;
      try {
        result = await h.api.post("/admin/leads", body);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) throw new FormError("Ya hay un prospecto con ese email o teléfono. Tocá «Buscar duplicados», revisalo y, si igual querés crearlo, confirmalo en la revisión.");
        throw error;
      }
      const lead = adaptLead(result.lead);
      lastCheck = { signature: "", candidates: [] };
      if (values.batchId) {
        h.touch(["batch", values.batchId]);
        try {
          await h.api.post(`/admin/batches/${values.batchId}/leads`, { leadIds: [lead.id] });
        } catch (error) {
          return { message: `Prospecto creado, pero no se pudo sumar al lote (${error.message}). Sumalo desde su ficha.`, goto: `#prospectos/${lead.id}` };
        }
      }
      return { message: values.acknowledgeDuplicates ? "Prospecto creado. Quedó separado de los posibles duplicados." : "Prospecto creado. Próxima acción cargada.", goto: `#prospectos/${lead.id}` };
    },

    async "lead-activity"(values, h) {
      const lead = leadOf(h, h.target.id);
      const preset = PRESETS[h.target.kind] || PRESETS.other;
      const kind = preset.generic ? values.kind : preset.kind;
      const body = unwrap(out.activityBody({ ...values, kind, direction: values.direction || preset.direction }, lead, { canMoney: h.can("billing:write") }));
      touchLead(h, lead.id, ["batches"]);
      if (lead.batchId) h.touch(["batch", lead.batchId]);
      await explaining(h, [["lead", lead.id], ["lead.activities", lead.id]], "El servidor no aceptó este registro. Suele ser porque ya cargaste la misma actividad hace menos de un minuto, porque el consentimiento no permite contactos salientes o porque la etapa cambió. Actualizamos la ficha: revisá el historial.", () => h.api.post(`/admin/leads/${lead.id}/activities`, body));
      return { message: DONE_MESSAGE[h.target.kind] || DONE_MESSAGE.other };
    },

    async "lead-stage"(values, h) {
      const lead = leadOf(h, h.target.id);
      const stage = h.target.kind === "paused" ? "paused" : h.target.kind === "lost" ? "lost" : values.stage;
      const body = unwrap(out.stageBody({ ...values, stage }, lead));
      touchLead(h, lead.id, ["batches"]);
      if (lead.batchId) h.touch(["batch", lead.batchId]);
      await explaining(h, [["lead", lead.id], ["lead.activities", lead.id]], "El servidor no permitió el cambio. Para pasar a Propuesta o Negociación tiene que haber una propuesta enviada registrada; un prospecto ganado o duplicado ya no cambia de etapa. Actualizamos la ficha.", () => h.api.post(`/admin/leads/${lead.id}/stage`, body));
      return { message: stage === "paused" ? `Prospecto en pausa. Se revisa el ${body.reviewOn}.` : stage === "lost" ? "Prospecto marcado como perdido." : `Ahora está en ${LEAD_STAGE_LABELS[stage]}.` };
    },

    async "lead-consent"(values, h) {
      const lead = leadOf(h, h.target.id);
      const body = unwrap(out.consentBody(values, lead));
      touchLead(h, lead.id);
      await h.api.post(`/admin/leads/${lead.id}/consent`, body);
      return { message: ["denied", "withdrawn"].includes(values.status) ? "Consentimiento registrado. Quedó como «No contactar»: no se registran contactos salientes." : "Consentimiento registrado." };
    },

    async "lead-edit"(values, h) {
      const lead = leadOf(h, h.target.id);
      const next = h.target.kind === "next";
      const input = next ? { ...leadValues(lead), nextAction: values.nextAction, nextActionOn: values.nextActionOn } : values;
      const body = unwrap(out.leadPatchBody(input, lead, { canBudget: !next && h.can("billing:write") }));
      touchLead(h, lead.id);
      await h.api.patch(`/admin/leads/${lead.id}`, body);
      return { message: next ? "Próxima acción actualizada." : "Datos del prospecto guardados." };
    },

    async "lead-void"(values, h) {
      const lead = leadOf(h, h.target.id);
      const body = unwrap(out.voidBody(values));
      touchLead(h, lead.id, ["batches"]);
      if (lead.batchId) h.touch(["batch", lead.batchId]);
      await explaining(h, [["lead", lead.id], ["lead.activities", lead.id]], "No se puede anular: ya estaba anulada, es una entrada del sistema, o es la última propuesta mientras el prospecto está en Propuesta o Negociación. Actualizamos el historial.", () => h.api.post(`/admin/leads/${lead.id}/activities/${h.target.kind}/void`, body));
      return { message: "Actividad anulada. Queda en el historial con tu motivo." };
    },

    async "lead-duplicate"(values, h) {
      const lead = leadOf(h, h.target.id);
      const body = unwrap(out.duplicateOfBody({ canonicalId: (values.canonicalText || "").trim() || values.canonicalId }, lead));
      touchLead(h, lead.id, ["batches"]);
      if (lead.batchId) h.touch(["batch", lead.batchId]);
      await explaining(h, [["lead", lead.id]], "El servidor no permitió marcarlo: tiene propuestas enviadas, ya está ganado o ya es un duplicado, o el principal no es válido. Actualizamos la ficha.", () => h.api.post(`/admin/leads/${lead.id}/duplicate-of`, body));
      return { message: "Marcado como duplicado. Quedó Perdido apuntando al principal; no se borró ni se mezcló nada." };
    },

    async "lead-batch"(values, h) {
      const lead = leadOf(h, h.target.id);
      if (!values.batchId) throw new FormError("Elegí un lote.");
      const body = unwrap(out.batchLeadsBody([lead.id]));
      touchLead(h, lead.id, ["batches"], ["batch", values.batchId]);
      for (const key of h.repo.loadedKeys("leads")) h.touch(["leads", key]);
      await explaining(h, [["lead", lead.id], ["batches"]], "El servidor no sumó el prospecto: solo entran los que se están trabajando, sin consentimiento rechazado y que no estén en otro lote abierto. Actualizamos la ficha.", () => h.api.post(`/admin/batches/${values.batchId}/leads`, body));
      return { message: "Prospecto sumado al lote." };
    },

    async "lead-from-request"(values, h) {
      const request = h.repo.data("request", h.target.id);
      const body = unwrap(out.fromPlanRequestBody(values, request));
      for (const key of h.repo.loadedKeys("leads")) h.touch(["leads", key]);
      const result = await explaining(h, [["request", h.target.id]], "No se pudo crear el prospecto: la solicitud está cancelada o rechazada. Actualizamos la solicitud.", () => h.api.post("/admin/leads/from-plan-request", body));
      const lead = adaptLead(result.lead);
      // El servidor crea uno solo por solicitud y repite el mismo si ya existía; la respuesta no distingue los dos casos, así que no se afirma ninguno.
      return { message: "Prospecto listo desde la solicitud (hay uno solo por solicitud). No se creó ningún proyecto.", goto: `#prospectos/${lead.id}` };
    },

    /** Convertir en proyecto: una sola transacción en el servidor (proyecto, alcance, seña, miembros y el prospecto en Ganado). */
    async "convert-lead"(values, h) {
      const lead = leadOf(h, h.target.id);
      if (!lead) throw new FormError("El prospecto ya no está cargado. Abrilo desde la lista y probá de nuevo.");
      if (!(h.can("leads:write") && h.can("projects:write") && h.can("billing:write"))) throw new FormError("Convertir requiere leads:write, projects:write y billing:write.");
      const memberClientIds = [];
      const email = (values.clientEmail || "").trim().toLowerCase();
      if (email) {
        try {
          const found = (await h.api.post("/admin/clients/lookup", { email })).client;
          if (!found.emailVerified || !found.active) throw new FormError("Esa cuenta no está verificada o está suspendida: no se puede autorizar.");
          memberClientIds.push(found.id);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) throw new FormError("No hay una cuenta de cliente verificada con ese email. Dejá el campo vacío para autorizar a alguien más tarde.");
          throw error;
        }
      }
      const body = unwrap(out.convertBody({ ...values, memberClientIds, memberRole: values.memberRole }, lead));
      touchLead(h, lead.id, ["projects"], ["batches"]);
      if (lead.batchId) h.touch(["batch", lead.batchId]);
      const result = await explaining(h, [["lead", lead.id], ["lead.activities", lead.id]], "No se pudo convertir: el prospecto ya se convirtió, no está en una etapa de trabajo, es un duplicado, o cambió desde que lo abriste. Actualizamos la ficha.", () => h.api.post(`/admin/leads/${lead.id}/convert`, body, { idempotencyKey: h.idem(body) }));
      return { message: "Prospecto convertido: seña registrada. Proyecto en Preparación (1 de 5).", goto: `#proyectos/${result.project.id}` };
    },
  },
};

