// Bitácora en modo live. El backend NO tiene una bitácora global: solo la auditoría de cada proyecto (GET /admin/projects/:id/audit) y de
// cada prospecto (GET /admin/leads/:id/audit). Esta pantalla junta las de los proyectos y prospectos más recientes y lo dice en pantalla:
// no hay registros de metas, eventos, solicitudes, comunicaciones ni documentos, y los de cobros faltan sin billing:read.
import { actorLabel, adaptAuditEvent, mergeAudit } from "../adapters/planner.js";
import { remember } from "./planner-shared.js";

const PER_KIND = 6;
const PAGE = 20;
const SHOW = 40;
const CONCURRENCY = 3;

const pathOf = (source) => (source.kind === "project" ? `/admin/projects/${source.id}/audit` : `/admin/leads/${source.id}/audit`);

async function inBatches(list, work) {
  const queue = [...list];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await work(queue.shift());
  }));
}

/** Una página de auditoría de una fuente; un error de una no tira a las demás. */
async function readPage(api, source, cursor, signal) {
  try {
    const page = await api.get(pathOf(source), { query: { limit: PAGE, ...(cursor ? { cursor } : {}) }, signal });
    return { events: (page.events || []).map((event) => adaptAuditEvent(event, source)), cursor: page.nextCursor || null, failed: null };
  } catch (error) {
    if (error?.code === "ABORTED") throw error;
    return { events: [], cursor: null, failed: error };
  }
}

const zoneName = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "tu zona";
const zoneOffset = (iso) => new Intl.DateTimeFormat("es-AR", { timeZoneName: "short", hour: "2-digit" }).formatToParts(new Date(iso)).find((part) => part.type === "timeZoneName")?.value || "";
const utcClock = (iso) => new Date(iso).toISOString().slice(11, 16);

export default {
  id: "actividad",
  label: "Bitácora",
  nav: { order: 80, area: "menu", hint: "Actividad y auditoría" },
  status: "live",
  permission: ["projects:read", "leads:read"],
  filters: { actividad: { source: "todo", limit: String(SHOW) } },

  slices: {
    "audit.feed": {
      forbiddenValue: { sources: [], totals: { projects: 0, leads: 0 }, truncatedLeads: false },
      load: async ({ api, repo, can, signal }) => {
        const sources = [];
        const totals = { projects: 0, leads: 0 };
        let truncatedLeads = false;
        if (can("projects:read")) {
          const projects = (await repo.ensure("projects")).list;
          totals.projects = projects.length;
          for (const project of projects.slice(0, PER_KIND)) sources.push({ kind: "project", id: project.id, name: project.name, events: [], cursor: null, failed: null });
        }
        if (can("leads:read")) {
          const leads = await repo.ensure("planner.leads");
          totals.leads = leads.list.length;
          truncatedLeads = leads.truncated;
          for (const lead of leads.list.slice(0, PER_KIND)) sources.push({ kind: "lead", id: lead.id, name: lead.name, events: [], cursor: null, failed: null });
        }
        await inBatches(sources, async (source) => Object.assign(source, await readPage(api, source, null, signal)));
        return { sources, totals, truncatedLeads };
      },
      more: async ({ api }, _key, current) => {
        const sources = current.sources.map((source) => ({ ...source }));
        await inBatches(sources.filter((source) => source.cursor), async (source) => {
          const page = await readPage(api, source, source.cursor);
          source.events = [...source.events, ...page.events];
          source.cursor = page.cursor;
          source.failed = page.failed;
        });
        return { ...current, sources };
      },
    },
  },

  prepare(ctx) {
    remember(ctx);
    if (ctx.can("leads:read")) ctx.repo.ensure("planner.leads").catch(() => {});
    ctx.repo.ensure("audit.feed").catch(() => {});
  },

  render(ctx) {
    remember(ctx);
    const { shell, crumbs, esc, btn, emptyState, entryView } = ctx;
    const f = ctx.state.filters.actividad;
    const entry = ctx.repo.get("audit.feed");
    const me = ctx.api.admin?.id || null;

    const body = (data) => {
      const all = mergeAudit(data.sources);
      const list = all.filter((event) => f.source === "todo" || event.source.kind === f.source);
      const limit = Math.max(SHOW, Number(f.limit) || SHOW);
      const shown = list.slice(0, limit);
      const more = data.sources.some((source) => source.cursor);
      const failed = data.sources.filter((source) => source.failed);
      const projectsIn = data.sources.filter((source) => source.kind === "project").length;
      const leadsIn = data.sources.filter((source) => source.kind === "lead").length;
      const link = (event) => (event.source.kind === "project" ? `#proyectos/${encodeURIComponent(event.source.id)}` : `#prospectos/${encodeURIComponent(event.source.id)}`);
      const change = (row) => (row.fromText ? `${esc(row.label)}: ${esc(row.fromText)} → ${esc(row.toText || "—")}` : `${esc(row.label)}: ${esc(row.toText || "—")}`);
      const item = (event) => `<li>
        <span class="pt-log-date pt-date">${event.at ? `<time datetime="${esc(event.at)}" title="Instante registrado por el servidor (UTC): ${esc(event.at)}">${esc(ctx.fmtDate(event.date, true))}<small class="log-time">${esc(event.time)} <span class="audit-zone">${esc(zoneOffset(event.at))}</span> · ${esc(utcClock(event.at))} UTC</small></time>` : `—<small class="log-time">Hora no registrada</small>`}</span>
        <div><p class="pt-log-title">${esc(event.actionLabel)}${event.result !== "success" ? ` <span class="pt-tag pt-tag-late">${esc(event.resultLabel)}</span>` : ""}</p>
          <p class="pt-fine">${esc(event.resourceLabel)} · <a class="pt-link" style="min-height:0" href="${link(event)}">${esc(event.source.kind === "project" ? "Proyecto" : "Prospecto")} ${esc(event.source.name)}</a> · ${esc(actorLabel(event, me))}</p>
          ${event.changes.length ? `<span class="audit-recorded">${event.changes.map(change).join(" · ")}</span>` : ""}</div></li>`;

      return `<section class="pt-box audit-scope" aria-labelledby="scope-title"><div class="pt-box-head"><span class="label" id="scope-title">Qué incluye esta bitácora</span></div>
          <p class="pt-box-text">La API no tiene una bitácora global: la auditoría vive en cada proyecto y en cada prospecto. Acá se juntan los <strong>${projectsIn}</strong> proyecto${projectsIn === 1 ? "" : "s"} (de ${data.totals.projects}) y los <strong>${leadsIn}</strong> prospecto${leadsIn === 1 ? "" : "s"} (de ${data.totals.leads}${data.truncatedLeads ? " o más" : ""}) más recientes de la lista, con sus últimos ${PAGE} registros cada uno. Lo que no aparece acá sigue estando en la ficha de cada uno.</p>
          <details class="live-defs"><summary>Qué no incluye</summary><ul class="audit-gaps">
            <li>Metas y eventos del planificador, solicitudes de plan, comunicaciones y documentos: el servidor no expone su auditoría.</li>
            <li>Los cobros ${ctx.can("billing:read") ? "se incluyen (tu cuenta tiene billing:read)" : "no se incluyen: el servidor los omite sin billing:read"}, y el presupuesto de un prospecto también.</li>
            <li>Proyectos y prospectos más viejos que los de la lista de arriba.</li></ul></details>
          ${failed.length ? `<p class="pt-fine live-note" role="status">No pudimos leer la auditoría de ${failed.length} de ${data.sources.length} fuentes (${esc(failed.map((source) => source.name).join(", "))}).</p>` : ""}</section>
        <div class="pt-filters"><div class="pt-seg" role="group" aria-label="Qué registros ver">${[["todo", "Todo"], ["project", "Proyectos"], ["lead", "Prospectos"]].map(([key, label]) => `<button type="button" data-action="filter" data-id="actividad.source" data-kind="${key}" aria-pressed="${f.source === key}">${label}</button>`).join("")}</div></div>
        <section class="pt-list" aria-label="Actividad reciente"><div class="pt-list-head"><h2 class="pt-h2">Actividad reciente</h2><span class="label">${list.length} registro${list.length === 1 ? "" : "s"} cargado${list.length === 1 ? "" : "s"}</span></div>
          <p class="pt-fine">Cada registro muestra el instante que guardó el servidor (en UTC), convertido a ${esc(zoneName())}. Quien hizo el cambio aparece por su cuenta: la API no devuelve su email.</p>
          ${shown.length ? `<ol class="audit-list">${shown.map(item).join("")}</ol>` : emptyState("Todavía no hay registros para mostrar", "Cuando se cree o cambie un proyecto o un prospecto, queda acá.", "")}
          <nav class="pagination audit-more" aria-label="Más registros"><span class="pt-fine">${shown.length} de ${list.length} cargados${more ? " · hay más en el servidor" : ""}</span><div>
            ${list.length > shown.length ? btn("filter", "Ver más", "btn-ghost", `data-id="actividad.limit" data-kind="${limit + SHOW}"`) : ""}
            ${more ? btn("live-more", entry.refreshing ? "Cargando…" : "Pedir registros más antiguos", "btn-ghost", `data-id="audit.feed" data-kind="" ${entry.refreshing ? "disabled" : ""}`) : ""}</div></nav></section>`;
    };

    return shell(`${crumbs([["Operación", "#hoy"], ["Bitácora"]])}<div class="pt-kicker"><span class="label">Trazabilidad de la operación</span></div><h1 class="display pt-title">Cada movimiento, <em>registrado.</em></h1><p class="pt-company">Quién cambió qué y cuándo, según la auditoría del servidor. Las horas son las que el servidor registró, no las que se cargaron a mano.</p>
      ${entryView(entry, { slice: "audit.feed", key: "", label: "No pudimos armar la bitácora", render: body })}`, "actividad");
  },
};
