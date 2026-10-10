// Bandeja de solicitudes: lo que los clientes arman en el constructor de planes de Eclipse-Web.
// Aceptar una solicitud registra una decisión y NADA más: no crea proyecto, no cobra, no escribe por WhatsApp.
// Crear el proyecto es un paso explícito que abre el alta de proyectos con esta solicitud como origen.
import { adaptRequest } from "../adapters/requests.js";
import { REQUEST_STATUS_LABELS, formatCents as money, shortId } from "../adapters/common.js";
import * as out from "../adapters/outbound.js";
import { FormError, unwrap } from "../errors.js";

const PAGE = 20;
export const REQUEST_FILTERS = [
  ["pending", "Pendientes", { review: "pending" }],
  ["reviewed", "Revisadas", { review: "reviewed" }],
  ["accepted", "Aceptadas", { status: "accepted" }],
  ["rejected", "Rechazadas", { status: "rejected" }],
  ["cancelled", "Canceladas", { status: "cancelled" }],
  ["all", "Todas", {}],
];
const query = (filter) => REQUEST_FILTERS.find(([key]) => key === filter)?.[2] || {};

/** Estados a los que puede pasar una solicitud (docs/plan-requests.md). Repetir el actual solo edita la respuesta y la nota. */
export const NEXT_STATUSES = {
  submitted: ["under_review", "reviewed", "accepted", "rejected"],
  under_review: ["under_review", "reviewed", "accepted", "rejected"],
  reviewed: ["reviewed", "accepted", "rejected"],
  accepted: ["accepted"],
  rejected: ["rejected"],
  cancelled: [],
};
const STATUS_TONE = { submitted: "attn", under_review: "attn", reviewed: "", accepted: "ok", rejected: "late", cancelled: "out" };
const STATUS_HINT = {
  submitted: "Llegó y nadie la miró todavía.",
  under_review: "La estás revisando. El cliente todavía no recibe respuesta.",
  reviewed: "Revisada. Falta decidir si se acepta o se rechaza.",
  accepted: "Aceptada. Esto no creó ningún proyecto: eso lo decidís vos.",
  rejected: "Rechazada. El cliente ve tu respuesta pública, si la escribiste.",
  cancelled: "La canceló el cliente. No se puede modificar.",
};
const ACTION_LABEL = { under_review: "Iniciar revisión", reviewed: "Marcar como revisada", accepted: "Aceptar", rejected: "Rechazar" };

const tag = (request) => `<span class="pt-tag${STATUS_TONE[request.status] ? ` pt-tag-${STATUS_TONE[request.status]}` : ""}">${request.statusLabel}</span>`;

export default {
  id: "solicitudes",
  label: "Solicitudes",
  nav: { order: 15, area: "main" },
  status: "live",
  permission: "requests:read",
  filters: { solicitudes: { status: "pending" } },

  slices: {
    requests: {
      permission: "requests:read",
      forbiddenValue: { items: [], nextCursor: null },
      load: async ({ api, repo, signal }, filter) => {
        const page = await api.get("/admin/plan-requests", { query: { ...query(filter), limit: PAGE }, signal });
        const catalog = repo.data("catalog");
        return { items: page.requests.map((request) => adaptRequest(request, catalog)), nextCursor: page.nextCursor || null, catalogVersion: catalog?.version || null };
      },
      more: async ({ api, repo }, filter, current) => {
        if (!current.nextCursor) return current;
        const page = await api.get("/admin/plan-requests", { query: { ...query(filter), limit: PAGE, cursor: current.nextCursor } });
        const catalog = repo.data("catalog");
        const known = new Set(current.items.map((request) => request.id));
        return { ...current, items: [...current.items, ...page.requests.filter((request) => !known.has(request.id)).map((request) => adaptRequest(request, catalog))], nextCursor: page.nextCursor || null };
      },
    },
    request: {
      permission: "requests:read",
      load: async ({ api, repo, signal }, id) => adaptRequest((await api.get(`/admin/plan-requests/${id}`, { signal })).request, repo.data("catalog")),
    },
  },

  prepare(ctx, route) {
    // El catálogo pone nombre a piezas y paquetes; si falla, se muestran los ids (no bloquea la bandeja).
    const catalog = ctx.repo.ensure("catalog").catch(() => null);
    if (route.id) catalog.then(() => ctx.repo.ensure("request", route.id)).catch(() => {});
    else catalog.then(() => ctx.repo.ensure("requests", ctx.state.filters.solicitudes.status)).catch(() => {});
  },

  badge(ctx) {
    const pending = ctx.repo.data("requests", "pending");
    return pending && pending.items.length ? { count: pending.items.length, label: `${pending.items.length}${pending.nextCursor ? " o más" : ""} solicitudes pendientes` } : null;
  },

  render(ctx, route) {
    const { shell, crumbs, esc, icon, phaseGlyph, btn, openLink, emptyState, entryView, fmtDate } = ctx;

    if (route.id) {
      const entry = ctx.repo.get("request", route.id);
      if (entry.status === "error" && entry.error?.status === 404) {
        return shell(`${crumbs([["Solicitudes", "#solicitudes"], ["No encontrada"]])}${emptyState("No existe esa solicitud", "", `<a class="pt-link" href="#solicitudes">${icon("back")} Volver a solicitudes</a>`)}`, "solicitudes");
      }
      return shell(`${crumbs([["Operación", "#hoy"], ["Solicitudes", "#solicitudes"], [entry.data?.contactName || "Solicitud"]])}${entryView(entry, { slice: "request", key: route.id, label: "No pudimos cargar la solicitud", render: (request) => detail(ctx, request) })}`, "solicitudes");
    }

    const filter = ctx.state.filters.solicitudes.status;
    const entry = ctx.repo.get("requests", filter);
    const cols = "minmax(0,1.3fr) minmax(0,1.5fr) minmax(0,.8fr) minmax(0,.9fr) minmax(0,.7fr) auto";
    const list = (data) => data.items.length
      ? `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Cliente</span><span class="label">Lo que armó</span><span class="label">Estimación</span><span class="label">Estado</span><span class="label">Recibida</span><span></span></div>
        <ul class="pt-rows">${data.items.map((request) => `<li class="pt-row" style="--cols:${cols}"${["submitted", "under_review"].includes(request.status) ? " data-turn" : ""}>
          <div><a class="pt-row-name" href="#solicitudes/${encodeURIComponent(request.id)}">${esc(request.contactName)}</a><span class="pt-meta readout">${esc(request.contactPhone)}</span></div>
          <div><span class="pt-cell-label label">Lo que armó</span>${esc(request.summary)}<span class="pt-meta">${request.selection.items.length} pieza${request.selection.items.length === 1 ? "" : "s"}${request.selection.founder ? " · precio fundador" : ""}</span></div>
          <div><span class="pt-cell-label label">Estimación</span><span class="readout">${money(request.estimate.totalCents)}</span><span class="pt-meta">${request.estimate.provisional ? "provisoria" : ""}</span></div>
          <div><span class="pt-cell-label label">Estado</span>${tag(request)}</div>
          <div><span class="pt-cell-label label">Recibida</span><span class="pt-date">${fmtDate(request.date, true)}</span></div>
          <div class="pt-row-end">${openLink(`#solicitudes/${encodeURIComponent(request.id)}`)}</div>
        </li>`).join("")}</ul>
        <nav class="pagination" aria-label="Más solicitudes"><span class="pt-fine">${data.items.length} cargada${data.items.length === 1 ? "" : "s"}${data.nextCursor ? " · hay más" : ""}</span>${data.nextCursor ? btn("live-more", entry.refreshing ? "Cargando…" : "Cargar más", "btn-ghost", `data-id="requests" data-kind="${esc(filter)}" ${entry.refreshing ? "disabled" : ""}`) : ""}</nav>`
      : emptyState("Sin solicitudes con este filtro", filter === "pending" ? "Cuando un cliente envíe su plan desde la web, aparece acá." : "Probá otro filtro.", "");

    return shell(`${crumbs([["Operación", "#hoy"], ["Solicitudes"]])}
      <div class="pt-head-row"><div>
        <div class="pt-kicker"><span class="label">Bandeja · lo que piden los clientes</span></div>
        <h1 class="display pt-title">Planes que <em>llegan</em> solos.</h1>
        <p class="pt-company">Cada solicitud trae lo que el cliente eligió y una estimación provisoria. Aceptar es una decisión: no crea proyecto ni cobra. Eso lo hacés vos, cuando hay acuerdo y seña.</p>
      </div></div>
      <div class="pt-filters"><div class="pt-seg" role="group" aria-label="Filtrar solicitudes">${REQUEST_FILTERS.map(([key, label]) => `<button type="button" data-action="filter" data-id="solicitudes.status" data-kind="${key}" aria-pressed="${filter === key}">${esc(label)}</button>`).join("")}</div></div>
      <section class="pt-list" style="margin-top:28px" aria-label="Solicitudes" aria-live="polite">${entryView(entry, { slice: "requests", key: filter, label: "No pudimos cargar las solicitudes", render: list })}</section>`, "solicitudes");
  },

  modals: {
    "request-review": {
      markup(ctx, modal) {
        const { esc, field, area, select, row } = ctx;
        const request = ctx.repo.data("request", modal.id);
        if (!request) return ctx.modalShell("Solicitud", "Solicitud no disponible", "Volvé a abrirla desde la bandeja.", "", "");
        const target = modal.kind || NEXT_STATUSES[request.status][0];
        const options = NEXT_STATUSES[request.status].map((status) => [status, status === request.status ? `${REQUEST_STATUS_LABELS[status]} (solo editar texto)` : ACTION_LABEL[status]]);
        const warning = target === "accepted"
          ? "Aceptar registra una decisión. No crea el proyecto, no cobra y no envía nada. El cliente verá tu respuesta pública."
          : target === "rejected" ? "El cliente verá tu respuesta pública, si la escribís. Después no se puede reabrir." : "Los cambios quedan registrados con tu usuario.";
        return ctx.modalShell(`${request.contactName}`, ACTION_LABEL[target] || "Editar respuesta", esc(warning), [
          select("status", "Cómo queda la solicitud", options, target),
          area("publicResponse", "Respuesta para el cliente · la ve en su portal", request.publicResponse, 'rows="4" maxlength="4000" placeholder="Opcional. Texto simple, sin datos internos."'),
          area("internalNote", "Nota interna · no la ve el cliente", request.internalNote, 'rows="3" maxlength="4000"'),
        ].join(""), "Guardar", { live: true });
      },
    },
  },

  mutations: {
    async "request-review"(values, h) {
      const id = h.target.id;
      const request = h.repo.data("request", id);
      if (!request) throw new FormError("La solicitud ya no está cargada. Cerrá este diálogo y volvé a abrirla.");
      const body = unwrap(out.reviewBody(values, request));
      h.touch(["request", id]);
      for (const key of h.repo.loadedKeys("requests")) h.touch(["requests", key]);
      await h.api.patch(`/admin/plan-requests/${id}/review`, body);
      return { message: { under_review: "Revisión iniciada.", reviewed: "Solicitud marcada como revisada.", accepted: "Solicitud aceptada. No se creó ningún proyecto.", rejected: "Solicitud rechazada." }[values.status] || "Solicitud actualizada." };
    },
  },
};

function detail(ctx, request) {
  const { esc, icon, btn, phaseGlyph, fmtDate, dateTime } = ctx;
  const canReview = ctx.can("requests:review");
  const nexts = NEXT_STATUSES[request.status].filter((status) => status !== request.status);
  const canCreate = request.status === "accepted" && ctx.can("projects:write") && ctx.can("billing:write");
  const actions = canReview
    ? [...nexts.map((status) => btn("request-review", ACTION_LABEL[status], status === "accepted" ? "btn-ink" : status === "rejected" ? "btn-danger" : "btn-ghost", `data-id="${esc(request.id)}" data-kind="${status}"`)),
      NEXT_STATUSES[request.status].includes(request.status) ? btn("request-review", "Editar respuesta y nota", "btn-ghost", `data-id="${esc(request.id)}" data-kind="${request.status}"`) : ""].join("")
    : `<p class="pt-fine">Tu cuenta puede leer solicitudes pero no revisarlas (falta <span class="readout">requests:review</span>).</p>`;
  const sel = request.selection;
  const est = request.estimate;
  return `
    <p class="pt-detail-meta"><span class="pt-detail-code">${esc(shortId(request.id))}</span><span>Recibida ${fmtDate(request.date, true)} · ${request.time ? esc(request.time) : "hora no registrada"}</span><span>Versión ${request.version}</span></p>
    <h1 class="display pt-title">${esc(request.contactName)}</h1>
    <p class="pt-company"><strong>${esc(request.summary)}</strong> · <span class="readout">${esc(request.contactPhone)}</span></p>
    <div class="pt-top">
      <section class="pt-current ticks" aria-label="Estado de la solicitud">
        <div class="pt-dial">${phaseGlyph(["accepted"].includes(request.status) ? 1 : ["reviewed"].includes(request.status) ? 0.6 : ["under_review"].includes(request.status) ? 0.35 : 0.1, 44)}</div>
        <div>
          <span class="label">Estado actual</span>
          <p class="pt-current-name">${esc(request.statusLabel)}</p>
          <p class="pt-current-short">${esc(STATUS_HINT[request.status] || "")}</p>
          <dl class="pt-dl">
            <div><dt>Estimación provisoria</dt><dd><span class="readout">${money(est.totalCents)}</span>${est.range ? ` · rango ${money(est.range.fromCents)} – ${money(est.range.toCents)}` : ""}</dd></div>
            <div><dt>Revisada</dt><dd>${request.reviewedAt ? `${fmtDate(request.reviewedAt.slice(0, 10), true)}` : "Todavía no"}</dd></div>
          </dl>
          <div class="pt-actions">${actions}</div>
        </div>
      </section>
      <aside class="pt-side">
        ${request.status === "accepted" ? `<section class="pt-box" data-turn><div class="pt-box-head"><span class="label">Siguiente paso</span></div><p class="pt-box-title">Crear el proyecto</p><p class="pt-fine">Hace falta un acuerdo y la seña cobrada. El proyecto nace con esta solicitud como origen y la cuenta del cliente autorizada.</p>${canCreate ? `<div class="pt-actions">${btn("new-project", `${icon("plus")} Crear proyecto desde esta solicitud`, "btn-ink", `data-id="${esc(request.id)}" data-kind="request"`)}</div>` : `<p class="pt-fine">Tu cuenta no tiene <span class="readout">projects:write</span> y <span class="readout">billing:write</span>.</p>`}</section>` : ""}
        <section class="pt-box"><div class="pt-box-head"><span class="label">Respuesta para el cliente</span><span class="pt-tag pt-tag-out">La ve en su portal</span></div>
          <p class="pt-box-text live-prewrap">${request.publicResponse ? esc(request.publicResponse) : "Todavía no hay respuesta."}</p></section>
        <section class="pt-box"><div class="pt-box-head"><span class="label">Nota interna</span><span class="pt-tag">Solo vos</span></div>
          <p class="pt-box-text live-prewrap">${request.internalNote ? esc(request.internalNote) : "Sin nota."}</p></section>
      </aside>
    </div>

    <div class="pt-bottom">
      <section aria-labelledby="sel-title">
        <div class="pt-section-head"><h2 id="sel-title" class="pt-h2">Lo que eligió el cliente</h2></div>
        <dl class="pt-dl live-dl">
          <div><dt>Objetivos</dt><dd>${sel.goals.length ? sel.goals.map(esc).join(" · ") : "Sin elegir"}</dd></div>
          <div><dt>Paquete</dt><dd>${sel.planName ? esc(sel.planName) : "Piezas sueltas"}</dd></div>
          <div><dt>Piezas</dt><dd>${sel.items.length ? sel.items.map((item) => esc(item.name)).join(" · ") : "—"}</dd></div>
          <div><dt>Mantenimiento</dt><dd>${sel.maintenance ? `${esc(sel.maintenance)} · cobro ${esc(sel.billing.toLowerCase())}` : "Sin mantenimiento"}</dd></div>
          <div><dt>Rubro</dt><dd>${sel.vertical ? esc(sel.vertical) : "Sin especificar"}</dd></div>
          <div><dt>Precio fundador</dt><dd>${sel.founder ? "Lo pidió (sujeto a plazas y condiciones)" : "No"}</dd></div>
        </dl>
        <h3 class="pt-h3" style="margin-top:28px">Estimación del servidor</h3>
        <p class="pt-fine">${est.provisional ? "Provisoria: no reemplaza un presupuesto ni un acuerdo. " : ""}Calculada con el catálogo ${esc(request.catalogVersion.slice(0, 11))}.</p>
        <ul class="pt-ledger">${est.lines.map((line) => `<li><span>${esc(line.name)}</span><span class="pt-leader"></span><span class="readout">${money(line.priceCents)}</span></li>`).join("")}
          ${est.founderDiscountCents ? `<li><span>Descuento fundador</span><span class="pt-leader"></span><span class="readout">− ${money(est.founderDiscountCents)}</span></li>` : ""}
          ${est.voiceCombo ? `<li><span>Combo de voz aplicado</span><span class="pt-leader"></span><span class="readout">sí</span></li>` : ""}
          <li><span><strong>Pago inicial estimado</strong></span><span class="pt-leader"></span><span class="readout"><strong>${money(est.totalCents)}</strong></span></li>
          ${est.maintenanceMonthlyCents ? `<li><span>Mantenimiento por mes</span><span class="pt-leader"></span><span class="readout">${money(est.maintenanceMonthlyCents)}</span></li>` : ""}
          ${est.voiceUsageMonthlyCents ? `<li><span>Agente de voz fijo por mes</span><span class="pt-leader"></span><span class="readout">${money(est.voiceUsageMonthlyCents)}</span></li>` : ""}</ul>
        <h3 class="pt-h3" style="margin-top:28px">Mensaje del cliente</h3>
        <p class="pt-box-text live-prewrap live-quote">${request.message ? esc(request.message) : "No dejó mensaje."}</p>
      </section>
      <aside class="pt-facts" aria-label="Datos de la solicitud">
        <span class="label">Datos</span>
        <dl class="pt-dl">
          <div><dt>Teléfono</dt><dd class="readout">${esc(request.contactPhone)}</dd></div>
          <div><dt>Cuenta del cliente</dt><dd class="readout">${esc(shortId(request.clientId))}</dd></div>
          <div><dt>Recibida</dt><dd>${dateTime(request)}</dd></div>
          <div><dt>Catálogo</dt><dd class="readout">${esc(request.catalogVersion.slice(0, 11))}</dd></div>
        </dl>
        <a class="pt-link" href="#solicitudes">${icon("back")} Volver a solicitudes</a>
      </aside>
    </div>`;
}
