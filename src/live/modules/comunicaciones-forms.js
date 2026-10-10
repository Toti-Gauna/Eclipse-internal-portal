// Diálogos, botones y envíos de Comunicaciones. Reglas que no se negocian:
//  - el éxito se muestra SOLO cuando el servidor lo confirma (correo: estado «queued»; WhatsApp: «opened» / «declared_sent»);
//  - antes de cada paso se vuelve a pedir el mensaje (GET) y se compara la huella que la persona vio;
//  - «aceptado por SMTP» y «declarado como enviado» nunca se muestran como entrega.
import { ApiError } from "../../api/errors.js";
import { adaptCommunication, commsErrorMessage, publishedUpdates, visibleMilestones } from "../adapters/comms.js";
import * as out from "../adapters/outbound-comms.js";
import { FormError, unwrap } from "../errors.js";
import { checkbox } from "./comms-support.js";

/** Estado del correo en este servidor: se aprende de un 503 al preparar o confirmar (la API no tiene un endpoint de estado). */
export const smtp = { off: false };

const FILTER_KEYS = ["projectId", "clientId", "channel", "status"];
export const listKey = (f) => JSON.stringify(Object.fromEntries(FILTER_KEYS.filter((key) => f[key]).map((key) => [key, f[key]])));

/** Valores del redactor tal como se van a enviar: lo que el usuario eligió, o lo único posible (un solo destinatario). */
export function effectiveCompose(ctx) {
  const f = ctx.state.filters.comunicaciones;
  const recipients = f.cProject ? ctx.repo.data("comms.recipients", f.cProject) || [] : [];
  const updates = publishedUpdates(f.cProject ? ctx.repo.data("project.updates", f.cProject) || [] : []);
  const milestones = visibleMilestones(f.cProject ? ctx.repo.data("project.milestones", f.cProject) || [] : []);
  return {
    recipients,
    clientId: recipients.some((recipient) => recipient.clientId === f.cClient) ? f.cClient : recipients.length === 1 ? recipients[0].clientId : "",
    channel: f.cChannel === "whatsapp" ? "whatsapp" : "email",
    purpose: ["update", "milestone", "custom"].includes(f.cPurpose) ? f.cPurpose : "update",
    updateId: updates.some((update) => update.id === f.cUpdate) ? f.cUpdate : "",
    milestoneId: milestones.some((milestone) => milestone.id === f.cMilestone) ? f.cMilestone : "",
    language: ["es", "en", "pt"].includes(f.cLanguage) ? f.cLanguage : "es",
  };
}

// ---------- Seguimiento de un correo en cola ----------

let timer = null;
export function clearPoll() {
  if (timer) clearInterval(timer);
  timer = null;
}
/** Mientras el correo está en cola se vuelve a pedir su estado (el worker lo envía en segundos). Se corta solo al terminar o al irse de la pantalla. */
export function startPolling(repo, id) {
  clearPoll();
  let ticks = 0;
  timer = setInterval(() => {
    if (!window.location.hash.startsWith(`#comunicaciones/${id}`)) return clearPoll();
    const status = repo.data("comms.item", id)?.status;
    if (status && status !== "queued") return clearPoll();
    if (++ticks > 60) return clearPoll();
    if (document.hidden) return undefined;
    repo.ensure("comms.item", id, { force: true }).catch(() => {});
    return undefined;
  }, 2500);
}

// ---------- Utilidades de los pasos ----------

const fetchFresh = async (api, id) => adaptCommunication((await api.get(`/admin/communications/${id}`)).communication);

/** Traduce una falla conocida a un mensaje claro (y recuerda si el correo está apagado). Lo desconocido se relanza tal cual. */
async function translate(error, step, repo, id) {
  if (!(error instanceof ApiError)) throw error;
  if (error.status === 503 && (step === "create" || step === "confirm")) smtp.off = true;
  const message = commsErrorMessage(error, step);
  if (!message) throw error;
  // 409/429: lo que se ve puede estar viejo; se vuelve a pedir y se explica.
  if (id && [409, 429].includes(error.status)) await repo.refresh([["comms.item", id]]).catch(() => {});
  throw new FormError(message);
}

export default {
  // ---------- Diálogos ----------
  modals: {
    "comm-confirm": { markup(ctx, modal) {
      const c = ctx.repo.data("comms.item", modal.id);
      if (!c) return ctx.modalShell("Correo", "Confirmar el envío", "", `<p class="pt-fine">No encontramos el mensaje. Cerrá y actualizá la pantalla.</p>`, "", { live: true });
      const { esc } = ctx;
      return ctx.modalShell("Correo · último paso", "Confirmar el envío", `Se va a enviar a <strong>${esc(c.email || "—")}</strong>. El servidor lo manda <strong>una sola vez</strong> y registra el resultado; no se reintenta a ciegas.`, `
        <div class="lc-mail"><span class="label">Asunto</span><p class="lc-mail-subject">${esc(c.subject || "—")}</p><span class="label">Texto exacto</span><pre class="lc-mail-text" tabindex="0">${esc(c.text)}</pre></div>
        <p class="lc-hash"><span class="label">Huella que vas a confirmar</span> ${esc(c.contentHash)}</p>
        <input type="hidden" name="seenHash" value="${esc(c.contentHash)}">
        ${checkbox(esc, "confirm", `Revisé el texto y el destinatario. Confirmo que se envíe este correo a ${esc(c.email || "")}.`, { required: true, hint: "Máximo 3 correos por cliente por día y 20 por administrador por hora. «Aceptado por el servidor de correo» no significa «entregado»." })}`, "Confirmar y enviar", { live: true });
    } },
    "comm-declare": { markup(ctx, modal) {
      const c = ctx.repo.data("comms.item", modal.id);
      const { esc } = ctx;
      return ctx.modalShell("WhatsApp · declaración manual", "Marcar como enviado", "Esto deja escrito, con tu nombre y la hora, que enviaste el mensaje a mano. El portal no puede comprobarlo.", `
        <div class="lc-mail"><span class="label">Para</span><p class="lc-mail-subject">${esc(c?.phone || "Sin teléfono conocido")}</p><span class="label">Texto</span><pre class="lc-mail-text" tabindex="0">${esc(c?.text || "")}</pre></div>
        ${checkbox(esc, "confirm", "Envié este mensaje por WhatsApp. Entiendo que esto es mi declaración y no un comprobante de entrega.", { required: true })}`, "Declarar como enviado", { live: true });
    } },
    "comm-cancel": { markup(ctx, modal) {
      const c = ctx.repo.data("comms.item", modal.id);
      const queued = c?.status === "queued";
      return ctx.modalShell(queued ? "Correo en cola" : "Borrador", queued ? "Cancelar el envío" : "Descartar el borrador", queued ? "Solo se puede cancelar mientras el servidor no tomó el correo; si ya lo tomó, el servidor lo rechaza." : "El borrador queda cancelado y no se envía. Para decir otra cosa se prepara otro mensaje.", `<p class="pt-fine">${ctx.esc(c?.subject || c?.text?.slice(0, 80) || "")}</p>`, queued ? "Cancelar el envío" : "Descartar", { live: true });
    } },
  },

  // ---------- Botones directos ----------
  actions: {
    /** Redactor → borrador en el servidor → pantalla de vista previa. No envía ni encola nada. */
    "comm-prepare": async (ctx) => {
      const f = ctx.state.filters.comunicaciones;
      const view = effectiveCompose(ctx);
      const values = { projectId: f.cProject, clientId: view.clientId, channel: view.channel, purpose: view.purpose, language: view.language, updateId: view.updateId, milestoneId: view.milestoneId, subject: f.cSubject, message: f.cMessage };
      const built = out.communicationCreateBody(values, { recipients: view.recipients });
      if (built.error) { f.composeError = built.error; throw new FormError(built.error); }
      f.composeError = "";
      let created;
      try {
        created = adaptCommunication((await ctx.api.post("/admin/communications", built.body)).communication);
      } catch (error) {
        try { await translate(error, "create", ctx.repo, null); } catch (mapped) { f.composeError = mapped.message || ""; throw mapped; }
      }
      ctx.repo.invalidate("comms.list");
      window.location.hash = `#comunicaciones/${created.id}`;
      return { message: created.isEmail ? "Borrador listo. Revisá la vista previa: todavía no se envió nada." : "Borrador listo. Todavía no se abrió WhatsApp ni se envió nada.", refresh: [] };
    },

    /** WhatsApp: el servidor registra que se abre el chat (y confirma que el contenido sigue vigente) y recién ahí se abre el enlace wa.me. */
    "comm-wa-open": async (ctx, { id }) => {
      const fresh = await fetchFresh(ctx.api, id);
      if (fresh.channel !== "whatsapp" || fresh.status !== "draft") return { message: "Este mensaje ya no está en borrador. Actualizamos la pantalla.", refresh: [["comms.item", id]] };
      const body = unwrap(out.communicationVersionBody(fresh));
      let opened;
      try {
        opened = adaptCommunication((await ctx.api.post(`/admin/communications/${id}/opened`, body)).communication);
      } catch (error) { await translate(error, "opened", ctx.repo, id); }
      if (opened.status !== "opened") throw new FormError("El servidor no registró la apertura. Actualizá la pantalla y probá de nuevo.");
      if (!opened.waUrl) return { message: "Registrado. Copiá el texto y enviálo por tu cuenta; después declaralo acá.", refresh: [["comms.item", id]] };
      const popup = window.open(opened.waUrl, "_blank");
      if (popup) popup.opener = null;
      return { message: popup ? "Registramos que abriste WhatsApp. Cuando lo envíes, declaralo acá." : "Registrado, pero el navegador bloqueó la ventana: usá «Abrir WhatsApp de nuevo».", refresh: [["comms.item", id]] };
    },

    "comm-refresh": async (ctx, { id }) => {
      ctx.repo.invalidate("comms.list");
      const item = await ctx.repo.ensure("comms.item", id, { force: true });
      if (item.status === "queued") startPolling(ctx.repo, id);
      return { message: "", refresh: [] };
    },

    "comm-copy": async (ctx, { id }) => {
      const text = ctx.repo.data("comms.item", id)?.text || "";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        throw new FormError("No pudimos copiar automáticamente. Seleccioná el texto de la vista previa y copialo.");
      }
      return { message: "Texto copiado." };
    },

    /** Filtro por cliente: búsqueda por email exacto (clients:read), igual que al autorizar un cliente. */
    "comm-client-lookup": async (ctx, { button }) => {
      const email = (button.closest(".lc-client-filter")?.querySelector("input")?.value || "").trim().toLowerCase();
      if (!email) throw new FormError("Escribí el email de la cuenta.");
      let found;
      try {
        found = (await ctx.api.post("/admin/clients/lookup", { email })).client;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) throw new FormError("No hay una cuenta de cliente verificada con ese email.");
        if (error instanceof ApiError && error.status === 403) throw new FormError("Tu cuenta no puede buscar clientes (falta clients:read).");
        throw error;
      }
      const f = ctx.state.filters.comunicaciones;
      Object.assign(f, { clientId: found.id, clientLabel: found.displayName || found.email });
      ctx.repo.ensure("comms.list", listKey(f)).catch(() => {});
      return { message: "" };
    },
    "comm-client-clear": async (ctx) => {
      const f = ctx.state.filters.comunicaciones;
      Object.assign(f, { clientId: "", clientLabel: "" });
      ctx.repo.ensure("comms.list", listKey(f)).catch(() => {});
      return { message: "" };
    },
  },

  // ---------- Envíos (diálogos) ----------
  mutations: {
    async "comm-confirm"(values, h) {
      const id = h.target.id;
      h.touch(["comms.item", id]);
      const fresh = await fetchFresh(h.api, id);
      const body = unwrap(out.communicationConfirmBody(fresh, { seenHash: values.seenHash, confirmed: Boolean(values.confirm) }));
      let queued;
      try {
        queued = adaptCommunication((await h.api.post(`/admin/communications/${id}/confirm`, body)).communication);
      } catch (error) { await translate(error, "confirm", h.repo, id); }
      // Éxito = el servidor devolvió «queued». Cualquier otra cosa no se presenta como enviada.
      if (queued.status !== "queued") throw new FormError(`El servidor respondió «${queued.status}» en lugar de «en cola». No lo damos por enviado: actualizá la pantalla.`);
      h.repo.invalidate("comms.list");
      startPolling(h.repo, id);
      return { message: "En cola. El servidor lo envía en segundos; seguí el resultado en esta pantalla. «Aceptado» no es «entregado»." };
    },

    async "comm-declare"(values, h) {
      const id = h.target.id;
      h.touch(["comms.item", id]);
      const fresh = await fetchFresh(h.api, id);
      const body = unwrap(out.communicationDeclareBody(fresh, Boolean(values.confirm)));
      let declared;
      try {
        declared = adaptCommunication((await h.api.post(`/admin/communications/${id}/declare-sent`, body)).communication);
      } catch (error) { await translate(error, "declare", h.repo, id); }
      if (declared.status !== "declared_sent") throw new FormError("El servidor no registró la declaración. Actualizá la pantalla y probá de nuevo.");
      h.repo.invalidate("comms.list");
      return { message: "Declarado como enviado. Queda tu nombre y la hora; no es un comprobante de entrega." };
    },

    async "comm-cancel"(values, h) {
      const id = h.target.id;
      h.touch(["comms.item", id]);
      const fresh = await fetchFresh(h.api, id);
      if (!["draft", "queued"].includes(fresh.status)) throw new FormError("Este mensaje ya no se puede cancelar. Actualizamos la pantalla.");
      const body = unwrap(out.communicationVersionBody(fresh));
      let cancelled;
      try {
        cancelled = adaptCommunication((await h.api.post(`/admin/communications/${id}/cancel`, body)).communication);
      } catch (error) { await translate(error, "cancel", h.repo, id); }
      if (cancelled.status !== "cancelled") throw new FormError("El servidor no registró la cancelación. Actualizá la pantalla.");
      h.repo.invalidate("comms.list");
      return { message: fresh.status === "queued" ? "Envío cancelado. El correo no salió." : "Borrador descartado." };
    },
  },
};
