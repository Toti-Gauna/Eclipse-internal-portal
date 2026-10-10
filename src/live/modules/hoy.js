// Hoy en modo live: solo lo que el servidor sabe hoy (solicitudes por revisar y cobros comprometidos).
// Prospectos, lotes, metas y calendario aparecerán acá cuando esos módulos estén conectados; no se inventan.
import { diffDays, todayISO } from "../../rules.js";
import { formatCents as money } from "../adapters/common.js";
import { collectPayments } from "./cobros.js";

const LIMIT = 30;

export default {
  id: "hoy",
  label: "Hoy",
  nav: { order: 10, area: "main" },
  status: "live",
  filters: {},

  prepare(ctx) {
    const { repo, can } = ctx;
    if (can("requests:read")) repo.ensure("catalog").catch(() => null).then(() => repo.ensure("requests", "pending")).catch(() => {});
    if (can("projects:read")) {
      repo.ensure("projects").then((data) => {
        const ids = data.list.filter((project) => project.stage !== "closed").slice(0, LIMIT).map((project) => project.id);
        if (can("billing:read")) { repo.ensureAll("project.finance", ids); repo.ensureAll("project.payments", ids); }
      }).catch(() => {});
    }
  },

  badge(ctx) {
    const pending = ctx.repo.data("requests", "pending");
    return pending?.items.length ? { count: pending.items.length, label: `${pending.items.length} solicitudes por revisar` } : null;
  },

  render(ctx) {
    const { shell, crumbs, esc, btn, phaseGlyph, emptyState, fmtDate, dueTag } = ctx;
    const today = todayISO();
    const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
    const requests = ctx.can("requests:read") ? ctx.repo.get("requests", "pending") : null;
    const projectsEntry = ctx.can("projects:read") ? ctx.repo.get("projects") : null;
    const projects = projectsEntry?.data?.list || [];
    const active = projects.filter((project) => !["closed", "support"].includes(project.stage));
    const finances = ctx.can("billing:read") ? projects.map((project) => ctx.repo.data("project.finance", project.id)).filter(Boolean) : [];
    const receivable = finances.reduce((sum, finance) => sum + finance.balanceCents, 0);
    const { payments } = ctx.can("billing:read") ? collectPayments(ctx.repo, projects.filter((project) => project.stage !== "closed").slice(0, LIMIT)) : { payments: [] };

    const items = [];
    for (const request of (requests?.data?.items || []).filter((r) => ["submitted", "under_review"].includes(r.status))) {
      items.push({ title: request.status === "submitted" ? "Revisar solicitud nueva" : "Terminar de revisar la solicitud", name: request.contactName, where: "Solicitud", due: request.date, href: `#solicitudes/${encodeURIComponent(request.id)}`, action: `<a class="btn btn-sm btn-ink btn-open" href="#solicitudes/${encodeURIComponent(request.id)}">Abrir</a>` });
    }
    for (const payment of payments.filter((p) => p.status === "committed" && p.dueOn && diffDays(today, p.dueOn) <= 7)) {
      const project = projects.find((p) => p.id === payment.projectId);
      items.push({ title: `Cobrar ${payment.concept.toLowerCase()} (${money(payment.amountCents)})`, name: project?.name || payment.projectName, where: "Proyecto", due: payment.dueOn, href: `#proyectos/${encodeURIComponent(payment.projectId)}`, action: ctx.can("billing:write") ? btn("payment-transition", "Marcar cobrado", "btn-ink", `data-id="${esc(payment.projectId)}" data-kind="${esc(payment.id)}" data-to="collected"`) : "" });
    }
    items.sort((a, b) => a.due.localeCompare(b.due));
    const cols = "minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,.8fr) minmax(0,1fr)";
    const loading = [requests, projectsEntry].some((entry) => entry && entry.data === undefined && entry.status !== "error");

    return shell(`${crumbs([["Operación", "#hoy"], ["Hoy"]])}
      <div class="pt-kicker"><span class="label">En vivo</span><span class="label">${esc(weekday)}</span></div>
      <h1 class="display pt-hello">Hola.</h1>
      <p class="pt-company">${loading ? "Buscando qué hay en el servidor…" : items.length ? `Hoy tenés <strong>${items.length} ${items.length === 1 ? "cosa" : "cosas"}</strong> para mirar.` : "No hay nada pendiente en lo que ya está conectado."}</p>

      <dl class="pt-overview">
        <div><dt>Solicitudes por revisar</dt><dd><span class="pt-big">${requests?.data ? requests.data.items.length : "—"}${requests?.data?.nextCursor ? "+" : ""}</span><span class="pt-fine">${requests ? '<a href="#solicitudes">Abrir la bandeja</a>' : "Tu cuenta no tiene requests:read."}</span></dd></div>
        <div><dt>Proyectos activos</dt><dd><span class="pt-big">${projectsEntry?.data ? active.length : "—"}</span><span class="pt-fine">${projectsEntry ? '<a href="#proyectos">Ver proyectos</a>' : "Tu cuenta no tiene projects:read."}</span></dd></div>
        <div><dt>Por cobrar</dt><dd><span class="pt-big" data-key>${ctx.can("billing:read") ? money(receivable) : "—"}</span><span class="pt-fine">${ctx.can("billing:read") ? `Saldo del precio acordado en ${finances.length} proyecto${finances.length === 1 ? "" : "s"}. No es ingreso todavía.` : "Tu cuenta no tiene billing:read."}</span></dd></div>
      </dl>

      <section class="pt-list" aria-labelledby="today-title">
        <div class="pt-list-head"><div class="pt-list-title"><h2 id="today-title" class="pt-h2">Qué toca hoy</h2><span class="pt-count">${items.length}</span></div></div>
        ${items.length ? `<div class="pt-rows-head agenda-rows-head" style="--cols:${cols}"><span class="label">Qué hay que hacer</span><span class="label">Dónde</span><span class="label">Fecha</span><span class="label" style="text-align:right">Acción</span></div>
          <ul class="pt-rows agenda-rows">${items.map((item) => `<li class="pt-row" style="--cols:${cols}"${item.due < today ? " data-late" : item.due === today ? " data-turn" : ""}>
            <div><span class="pt-row-name">${esc(item.title)}</span></div>
            <div><a class="pt-link" style="min-height:0" href="${item.href}">${esc(item.name)}</a><span class="pt-meta">${item.where}</span></div>
            <div>${dueTag(item.due)}</div><div class="pt-row-end">${item.action}</div></li>`).join("")}</ul>`
          : loading ? ctx.loading("Cargando…") : emptyState("Nada pendiente", "Cuando llegue una solicitud o venza un cobro comprometido, aparece acá.", "")}
      </section>

      <section class="live-pending" aria-label="Qué falta conectar">${phaseGlyph(0.25, 32)}<div><p class="pt-h3">Prospectos, lotes, metas y calendario</p><p class="pt-fine">Todavía no están conectados al servidor, por eso no aparecen en esta pantalla. Los cinco números de la semana y la meta del bimestre se muestran cuando esas secciones existan en el servidor: acá no se calculan con datos locales.</p></div></section>`, "hoy");
  },
};
