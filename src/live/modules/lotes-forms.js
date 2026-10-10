// Formularios, diálogos y envíos de Lotes. El sistema NUNCA envía nada: el envío es manual y acá solo se registra
// (D0), se lee la señal (D+señal) y se cierra con el informe de tres líneas (D+cierre). Los plazos los calcula el servidor.
import { ApiError } from "../../api/errors.js";
import { addDays, todayISO } from "../../rules.js";
import { queryKey } from "../adapters/crm.js";
import * as out from "../adapters/crm-outbound.js";
import { FormError, unwrap } from "../errors.js";

const summaryList = (ctx, pairs) => `<dl class="generator-summary">${pairs.filter(([, value]) => value !== "" && value !== undefined && value !== null).map(([label, value]) => `<div><dt>${ctx.esc(label)}</dt><dd>${ctx.esc(value)}</dd></div>`).join("")}</dl>`;

const batchOf = (h, id) => h.repo.data("batch", id) || (h.repo.data("batches")?.items || []).find((batch) => batch.id === id) || null;

/** Tras tocar un lote: la lista, su ficha, sus miembros y toda lista de prospectos ya cargada (cambian etapa de lote y métricas). */
function touchBatch(h, id) {
  h.touch(["batches"]);
  h.touch(["batch", id]);
  h.touch(["leads", queryKey({ batchId: id })]);
  for (const key of h.repo.loadedKeys("leads")) h.touch(["leads", key]);
}

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

/** Prospectos que se pueden sumar a un lote: en etapa de trabajo, sin lote y con permiso de contacto. */
export function eligibleLeads(repo) {
  const known = new Map();
  for (const key of repo.loadedKeys("leads")) for (const lead of repo.data("leads", key)?.items || []) known.set(lead.id, lead);
  return [...known.values()].filter((lead) => lead.open && !lead.batchId && !lead.doNotContact && !lead.duplicateOfId).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export default {
  wizards: {
    "new-batch": (wizard, ctx) => {
      const { esc, field, area, row } = ctx;
      const today = todayISO();
      const v = { name: "", vertical: "", demo: "", hypothesis: "", target: "10", plannedOn: today, signalDays: "2", closeDays: "7", ...wizard.values };
      return {
        kicker: "Lotes", title: "La próxima conversación empieza acá.",
        intro: "Una vertical concreta, una demo que importa y un ciclo que podés ajustar. El lote nace planificado: el envío D0 lo registrás después de mandar los mensajes a mano.", submit: "Crear lote",
        values: v,
        steps: [
          ["Enfoque", "Elegí a quién querés llegar.", `${field("name", "Nombre del lote", "text", v.name, 'required maxlength="120" placeholder="Gastronomía · agente de reservas"')}${field("vertical", "Vertical · opcional", "text", v.vertical, 'maxlength="80" placeholder="Clínicas, gastronomía…"')}${field("target", "Objetivo de contactos", "number", v.target, 'required min="1" max="1000" step="1"')}<p class="pt-fine">La unidad (Agency, Media, Market) no la guarda el servidor.</p>`],
          ["Demo", "Una hipótesis que se puede probar.", `${field("demo", "Demo base · opcional", "text", v.demo, 'maxlength="300" placeholder="Demo base — Agente de atención"')}${area("hypothesis", "Qué querés validar · opcional", v.hypothesis, 'rows="3" maxlength="1000" placeholder="Problema, oferta y señal de interés que esperás"')}`],
          ["Cadencia", "Tu ciclo de seguimiento.", `${field("plannedOn", "Envío planificado · opcional", "date", v.plannedOn, `min="${today}"`)}${row(field("signalDays", "Leer la señal · días desde D0", "number", v.signalDays, 'required min="1" max="30" step="1"'), field("closeDays", "Cerrar el informe · días desde D0", "number", v.closeDays, 'required min="2" max="60" step="1"'))}<p class="pt-fine">Con el envío D0 el servidor calcula los recordatorios. No envía ni agenda nada solo.</p>`],
        ].concat([["Revisión", "Todo listo para confirmar.", summaryList(ctx, [["Lote", v.name], ["Vertical", v.vertical], ["Demo", v.demo], ["Objetivo", `${v.target} contactos`], ["Envío planificado", v.plannedOn], ["Cadencia", `Señal +${v.signalDays} días · cierre +${v.closeDays} días`]])]]),
      };
    },
  },

  modals: {
    "batch-edit": { markup(ctx, modal) {
      const { field, area, row } = ctx;
      const batch = ctx.repo.data("batch", modal.id) || (ctx.repo.data("batches")?.items || []).find((item) => item.id === modal.id);
      return ctx.modalShell(batch.name, "Editar lote", "Un lote cerrado no se edita. Los plazos D+señal y D+cierre se fijaron al crearlo.", [
        field("name", "Nombre del lote", "text", batch.name, 'required maxlength="120"'),
        row(field("vertical", "Vertical", "text", batch.vertical || "", 'maxlength="80"'), field("target", "Objetivo de contactos", "number", String(batch.target), 'required min="1" max="1000" step="1"')),
        field("demo", "Demo base", "text", batch.demo || "", 'maxlength="300"'),
        area("hypothesis", "Qué querés validar", batch.hypothesis || "", 'rows="3" maxlength="1000"'),
        batch.status === "planned" ? field("plannedOn", "Envío planificado", "date", batch.plannedOn || "", "") : "",
      ].join(""), "Guardar", { live: true });
    } },

    "batch-sent": { markup(ctx, modal) {
      const { esc, field } = ctx;
      const batch = batchOf({ repo: ctx.repo }, modal.id);
      const today = todayISO();
      return ctx.modalShell(batch.name, "Registrar el envío (D0)", esc(`Vos mandás los mensajes a mano y los registrás acá: el sistema no envía nada. Con D0 se calculan los recordatorios: señal a los ${batch.signalDays} días y cierre a los ${batch.closeDays}.`), [
        field("sentOn", "Día del envío (D0)", "date", today, `required max="${today}"`),
        field("sentCount", "Cuántos mensajes mandaste · opcional", "number", "", 'min="0" max="100000" step="1"'),
      ].join(""), "Registrar D0", { live: true });
    } },

    "batch-signal": { markup(ctx, modal) {
      const { field, area } = ctx;
      const batch = batchOf({ repo: ctx.repo }, modal.id);
      const today = todayISO();
      const m = batch.metrics;
      return ctx.modalShell(batch.name, `Señal D+${batch.signalDays}`, `${m ? `${m.replied} de ${m.assigned} respondieron hasta ahora.` : "Qué respondió la gente hasta ahora."} Se registra una sola vez.`, [
        field("on", "Fecha de la lectura", "date", today, `required max="${today}"`),
        area("note", "Qué señal hay", "", 'required rows="3" maxlength="500"'),
      ].join(""), "Guardar señal", { live: true });
    } },

    "batch-close": { markup(ctx, modal) {
      const { esc, field, area } = ctx;
      const batch = batchOf({ repo: ctx.repo }, modal.id);
      const today = todayISO();
      return ctx.modalShell(batch.name, "Cerrar el lote", esc("Informe de tres líneas. El cierre es definitivo: un lote cerrado no se edita ni recibe prospectos. Tres informes coincidentes se vuelven playbook."), [
        field("closedOn", "Fecha de cierre", "date", today, `required max="${today}"`),
        area("worked", "Qué funcionó", "", 'required rows="2" maxlength="500"'),
        area("notWorked", "Qué no", "", 'required rows="2" maxlength="500"'),
        area("change", "Qué cambio la próxima", "", 'required rows="2" maxlength="500"'),
      ].join(""), "Cerrar lote", { live: true });
    } },

    "batch-assign": { markup(ctx, modal) {
      const { esc } = ctx;
      const batch = batchOf({ repo: ctx.repo }, modal.id);
      const candidates = eligibleLeads(ctx.repo).slice(0, 100);
      const list = candidates.length
        ? `<fieldset class="live-pick"><legend class="label">Prospectos disponibles</legend>${candidates.map((lead) => `<div class="pt-field live-check"><label><input type="checkbox" name="lead_${esc(lead.id)}" value="1"> <span><strong>${esc(lead.name)}</strong> <span class="pt-meta" style="display:inline">${esc(lead.stageLabel)}${lead.company ? ` · ${esc(lead.company)}` : ""}</span></span></label></div>`).join("")}</fieldset>`
        : '<p class="pt-fine">No hay prospectos disponibles entre los cargados. Entran los que se están trabajando, sin lote abierto y sin consentimiento rechazado. Cargá uno nuevo desde Prospectos.</p>';
      return ctx.modalShell(batch.name, "Sumar prospectos", esc("Solo se suman prospectos en etapa de trabajo, sin consentimiento rechazado y que no estén en otro lote abierto. Hasta 100 por vez."), list, candidates.length ? "Sumar al lote" : "", { live: true });
    } },
  },

  actions: {
    "batch-unassign": async (ctx, { id, kind }) => {
      if (!window.confirm("¿Sacar este prospecto del lote? El historial conserva el lote en las actividades pasadas.")) return null;
      await ctx.api.post(`/admin/batches/${id}/leads/remove`, unwrap(out.batchLeadsBody([kind])));
      return { message: "Prospecto sacado del lote.", refresh: [["batches"], ["batch", id], ["leads", queryKey({ batchId: id })], ["lead", kind], ...ctx.repo.loadedKeys("leads").map((key) => ["leads", key])] };
    },
  },

  mutations: {
    async "new-batch"(values, h) {
      const body = unwrap(out.batchCreateBody(values));
      h.touch(["batches"]);
      const result = await h.api.post("/admin/batches", body);
      return { message: "Lote creado. Cuando mandes los mensajes, registrá el envío D0.", goto: `#lotes/${result.batch.id}` };
    },

    async "batch-edit"(values, h) {
      const batch = batchOf(h, h.target.id);
      const body = unwrap(out.batchPatchBody({ ...values, plannedOn: batch.status === "planned" ? values.plannedOn : batch.plannedOn || "" }, batch));
      touchBatch(h, batch.id);
      await explaining(h, [["batch", batch.id], ["batches"]], "El lote cambió o ya está cerrado: un lote cerrado no se edita. Actualizamos la ficha.", () => h.api.patch(`/admin/batches/${batch.id}`, body));
      return { message: "Lote guardado." };
    },

    async "batch-sent"(values, h) {
      const batch = batchOf(h, h.target.id);
      const body = unwrap(out.batchSentBody(values, batch));
      touchBatch(h, batch.id);
      await explaining(h, [["batch", batch.id], ["batches"]], "El envío D0 ya estaba registrado o el lote está cerrado. Actualizamos la ficha.", () => h.api.post(`/admin/batches/${batch.id}/sent`, body));
      return { message: `Envío D0 registrado. Señal el ${addDays(body.sentOn, batch.signalDays)} y cierre el ${addDays(body.sentOn, batch.closeDays)}.` };
    },

    async "batch-signal"(values, h) {
      const batch = batchOf(h, h.target.id);
      const body = unwrap(out.batchSignalBody(values, batch));
      touchBatch(h, batch.id);
      await explaining(h, [["batch", batch.id], ["batches"]], "La señal se registra una sola vez, después de D0 y con el lote abierto. Actualizamos la ficha.", () => h.api.post(`/admin/batches/${batch.id}/signal`, body));
      return { message: "Señal registrada." };
    },

    async "batch-close"(values, h) {
      const batch = batchOf(h, h.target.id);
      const body = unwrap(out.batchCloseBody(values, batch));
      touchBatch(h, batch.id);
      await explaining(h, [["batch", batch.id], ["batches"]], "El lote tiene que estar enviado (D0) y abierto para cerrarlo. Actualizamos la ficha.", () => h.api.post(`/admin/batches/${batch.id}/close`, body));
      return { message: "Lote cerrado con su informe." };
    },

    async "batch-assign"(values, h) {
      const batch = batchOf(h, h.target.id);
      const ids = Object.keys(values).filter((name) => name.startsWith("lead_") && values[name]).map((name) => name.slice(5));
      const body = unwrap(out.batchLeadsBody(ids));
      touchBatch(h, batch.id);
      const result = await explaining(h, [["batch", batch.id], ["batches"], ["leads", queryKey({ batchId: batch.id })]], "El servidor no sumó los prospectos: solo entran los que se están trabajando, sin consentimiento rechazado y que no estén en otro lote abierto. No se sumó ninguno; actualizamos la lista.", () => h.api.post(`/admin/batches/${batch.id}/leads`, body));
      return { message: `${result.assigned} prospecto${result.assigned === 1 ? "" : "s"} sumado${result.assigned === 1 ? "" : "s"} al lote.` };
    },
  },
};

