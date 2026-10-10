// Cobros: el libro de pagos de todos los proyectos. La API los guarda por proyecto, así que esta pantalla los junta
// leyendo los slices "project.payments" (con concurrencia acotada). Lo que el servidor no modela (unidad Agency/Media/Market,
// abonos/MRR, metas por bimestre) NO se calcula ni se muestra: ver docs/integration.md.
import { SPLIT, addDays, todayISO } from "../../rules.js";
import { formatCents as money } from "../adapters/common.js";

const PROJECT_LIMIT = 60;
const PERIODS = [["mes", "Este mes"], ["30", "Últimos 30 días"], ["todo", "Todo"]];
const STATUSES = [["collected", "Cobrados"], ["committed", "Comprometidos"], ["proposed", "Propuestos"], ["voided", "Anulados"], ["todos", "Todos"]];

function range(period, today) {
  if (period === "mes") return [`${today.slice(0, 7)}-01`, `${today.slice(0, 7)}-31`];
  if (period === "30") return [addDays(today, -29), today];
  return ["0000-00-00", "9999-99-99"];
}

/** Todos los pagos conocidos + cuántos proyectos faltan por cargar. */
export function collectPayments(repo, projects) {
  const payments = [];
  let loading = 0;
  let failed = 0;
  for (const project of projects) {
    const entry = repo.get("project.payments", project.id);
    if (entry.status === "error") failed++;
    else if (entry.data === undefined) loading++;
    else payments.push(...entry.data);
  }
  return { payments, loading, failed };
}

export default {
  id: "cobros",
  label: "Cobros",
  nav: { order: 50, area: "main" },
  status: "live",
  permission: "billing:read",
  filters: { cobros: { period: "mes", status: "collected" } },

  prepare(ctx) {
    const { repo } = ctx;
    repo.ensure("projects").then((data) => {
      const ids = data.list.slice(0, PROJECT_LIMIT).map((project) => project.id);
      repo.ensureAll("project.payments", ids);
    }).catch(() => {});
  },

  render(ctx) {
    const { shell, crumbs, esc, icon, btn, emptyState, entryView, fmtDate, forbidden } = ctx;
    if (!ctx.can("billing:read")) return shell(`${crumbs([["Operación", "#hoy"], ["Cobros"]])}${forbidden("billing:read", "los cobros")}`, "cobros");
    const f = ctx.state.filters.cobros;
    const today = todayISO();
    const entry = ctx.repo.get("projects");
    const body = (data) => {
      const shown = data.list.slice(0, PROJECT_LIMIT);
      const { payments, loading, failed } = collectPayments(ctx.repo, shown);
      const [from, to] = range(f.period, today);
      const inPeriod = payments.filter((payment) => payment.date && payment.date >= from && payment.date <= to);
      const rows = inPeriod.filter((payment) => f.status === "todos" || payment.status === f.status).sort((a, b) => b.date.localeCompare(a.date));
      const collected = inPeriod.filter((payment) => payment.status === "collected");
      const income = collected.reduce((sum, payment) => sum + payment.amountCents, 0);
      const maintenance = collected.filter((payment) => payment.kind === "maintenance").reduce((sum, payment) => sum + payment.amountCents, 0);
      const committed = payments.filter((payment) => payment.status === "committed").reduce((sum, payment) => sum + payment.amountCents, 0);
      const overdue = payments.filter((payment) => payment.status === "committed" && payment.dueOn && payment.dueOn < today);
      const cols = "minmax(0,.7fr) minmax(0,1.3fr) minmax(0,1.4fr) minmax(0,.8fr) auto";
      const project = (id) => data.list.find((p) => p.id === id);
      return `
      <dl class="pt-overview">
        <div><dt>Cobrado en el período</dt><dd><span class="pt-big" data-key aria-live="polite">${money(income)}</span><span class="pt-fine">${collected.length} cobro${collected.length === 1 ? "" : "s"} · incluye mantenimiento ${money(maintenance)}${loading ? ` · cargando ${loading} proyecto${loading === 1 ? "" : "s"}…` : ""}</span></dd></div>
        <div><dt>Comprometido, sin cobrar</dt><dd><span class="pt-overview-strong">${money(committed)}</span><span class="pt-fine">${overdue.length ? `<strong>${overdue.length} vencido${overdue.length === 1 ? "" : "s"}</strong> · ` : ""}No es ingreso hasta que se cobra.</span></dd></div>
        <div><dt>Reparto · ${money(income)}</dt><dd><ul class="pt-ledger">${SPLIT.map(([label, share]) => `<li><span>${esc(label)}</span><span class="pt-code">${Math.round(share * 100)}%</span><span class="pt-leader"></span><span class="readout">${money(Math.round(income * share))}</span></li>`).join("")}</ul><span class="pt-fine">Regla 40/40/10/10 aplicada a lo cobrado del período.</span></dd></div>
      </dl>
      <p class="pt-fine live-note">Abonos mensuales (MRR), metas por bimestre y la unidad Agency/Media/Market no los guarda el servidor: no se muestran números inventados. El mantenimiento sí: se registra como cobro de tipo mantenimiento y nunca baja el saldo del proyecto.</p>
      ${data.list.length > PROJECT_LIMIT ? `<p class="pt-fine" role="status">Se muestran los cobros de los primeros ${PROJECT_LIMIT} proyectos de ${data.list.length}.</p>` : ""}
      ${failed ? `<p class="pt-fine" role="alert">No pudimos cargar los cobros de ${failed} proyecto${failed === 1 ? "" : "s"}. ${btn("live-retry", "Reintentar", "btn-ghost", 'data-id="cobros" data-kind=""')}</p>` : ""}
      <div class="pt-filters">
        <div class="pt-seg" role="group" aria-label="Período">${PERIODS.map(([key, label]) => `<button type="button" data-action="filter" data-id="cobros.period" data-kind="${key}" aria-pressed="${f.period === key}">${label}</button>`).join("")}</div>
        <div class="pt-seg" role="group" aria-label="Estado">${STATUSES.map(([key, label]) => `<button type="button" data-action="filter" data-id="cobros.status" data-kind="${key}" aria-pressed="${f.status === key}">${label}</button>`).join("")}</div>
      </div>
      <section class="pt-list" style="margin-top:28px" aria-label="Cobros">
      ${rows.length ? `<div class="pt-rows-head" style="--cols:${cols}"><span class="label">Fecha</span><span class="label">Concepto</span><span class="label">Proyecto</span><span class="label">USD</span><span></span></div>
        <ul class="pt-rows">${rows.map((payment) => `<li class="pt-row" style="--cols:${cols}"${payment.status === "committed" && payment.dueOn < today ? " data-late" : ""}>
          <div class="pt-date">${fmtDate(payment.date, true)}<small class="log-time">${{ collected: "cobrado", committed: "vence", proposed: "vencimiento", voided: "anulado" }[payment.status]}</small></div>
          <div>${esc(payment.concept)} <span class="pt-tag${{ collected: " pt-tag-ok", committed: " pt-tag-attn", voided: " pt-tag-late", proposed: " pt-tag-out" }[payment.status]}">${esc(payment.statusLabel)}</span>${payment.note ? `<span class="pt-meta">${esc(payment.note)}</span>` : ""}</div>
          <div><a class="pt-link" style="min-height:0" href="#proyectos/${encodeURIComponent(payment.projectId)}">${esc(project(payment.projectId)?.name || payment.projectName || "Proyecto")}</a></div>
          <div class="readout"><strong${payment.status === "voided" ? ' style="text-decoration:line-through"' : ""}>${money(payment.amountCents, { withCurrency: false })}</strong></div>
          <div class="pt-row-end">${["proposed", "committed"].includes(payment.status) && ctx.can("billing:write") ? btn("payment-transition", "Marcar cobrado", "btn-ink", `data-id="${esc(payment.projectId)}" data-kind="${esc(payment.id)}" data-to="collected"`) : ""}</div>
        </li>`).join("")}</ul>` : loading ? ctx.loading("Cargando cobros…") : emptyState("Sin cobros en esta vista", "Solo lo que se registró en el servidor. Propuestas y promesas no son ingreso.", "")}
      </section>`;
    };
    return shell(`${crumbs([["Operación", "#hoy"], ["Cobros"]])}
      <div class="pt-head-row"><div>
        <div class="pt-kicker"><span class="label">Libro de cobros</span></div>
        <h1 class="display pt-title">USD <em>cobrado</em>.</h1>
        <p class="pt-company">El único número que decide es lo que ya entró. Comprometido y propuesto se ven aparte. El saldo de cada proyecto lo calcula el servidor.</p>
      </div><div class="pt-head-actions">${ctx.can("billing:write") ? btn("new-payment", `${icon("plus")} Cobro`, "btn-primary", 'data-return="#cobros"') : ""}</div></div>
      ${entryView(entry, { slice: "projects", key: "", label: "No pudimos cargar los proyectos", render: body })}`, "cobros");
  },
};
