// Lotes de prospección en modo live: chicos y manuales. D0 envío (lo registra el operador) · D+señal · D+cierre con informe de tres líneas.
// Las métricas (asignados, contactados, respondieron, llamadas, propuestas, ganados, perdidos) las calcula el servidor con los prospectos
// y su historial. El sistema no envía nada ni agenda solo: solo calcula los recordatorios.
import { todayISO } from "../../rules.js";
import { adaptBatch, adaptLead, batchNextAction, keyQuery, queryKey } from "../adapters/crm.js";
import { ensureCrmStyles } from "./crm-styles.js";
import forms from "./lotes-forms.js";

ensureCrmStyles();

const PAGE = 20;
const membersKey = (id) => queryKey({ batchId: id });
const candidatesKey = () => queryKey({ converted: "false" });

export default {
  id: "lotes",
  label: "Lotes",
  nav: { order: 35, area: "main" },
  status: "live",
  permission: "leads:read",
  filters: { lotes: {} },
  ...forms,

  slices: {
    batches: {
      permission: "leads:read",
      forbiddenValue: { items: [], truncated: false },
      load: async ({ api, signal }) => {
        const { items, truncated } = await api.listAll("/admin/batches", { key: "batches", maxPages: 6, signal });
        return { items: items.map(adaptBatch), truncated };
      },
    },
    batch: {
      permission: "leads:read",
      load: async ({ api, signal }, id) => adaptBatch((await api.get(`/admin/batches/${id}`, { signal })).batch),
    },
  },

  prepare(ctx, route) {
    const { repo, can } = ctx;
    if (!route.id) { repo.ensure("batches").catch(() => {}); return; }
    repo.ensure("batch", route.id).catch(() => {});
    repo.ensure("leads", membersKey(route.id)).catch(() => {});
    // Los candidatos para sumar al lote: prospectos no convertidos (se filtran los que ya tienen lote).
    if (can("leads:write")) repo.ensure("leads", candidatesKey()).catch(() => {});
  },

  badge() { return null; },

  render(ctx, route) {
    return route.id ? detail(ctx, route.id) : list(ctx);
  },
};

// ---------- Piezas ----------

function rail(ctx, batch) {
  const { esc, phaseGlyph, fmtDate } = ctx;
  const planned = batch.status === "planned";
  const steps = [
    ["D0", "Envío", batch.sentOn || batch.plannedOn, Boolean(batch.sentOn), planned ? (batch.plannedOn ? `planificado ${fmtDate(batch.plannedOn)}` : "Sin fecha") : null],
    [`D+${batch.signalDays}`, "Señal", batch.signalDueOn, Boolean(batch.signalOn), planned ? "Se calcula con D0" : null],
    [`D+${batch.closeDays}`, "Cierre e informe", batch.closeDueOn, batch.status === "closed", planned ? "Se calcula con D0" : null],
  ];
  const current = steps.findIndex(([, , , done]) => !done);
  return `<ol class="pt-rail" style="--steps:3">${steps.map(([n, name, day, done, note], i) => {
    const status = done ? "done" : i === current ? "current" : "pending";
    return `<li class="pt-rail-step" data-status="${status}"><span class="pt-rail-mark">${phaseGlyph((i + 1) / 3, 24)}</span><span class="pt-rail-n">${n}</span><span class="pt-rail-name">${name}</span><span class="pt-rail-status">${status === "current" ? "<strong>Ahora</strong> · " : ""}${note || (day ? fmtDate(day) : "—")}</span></li>`;
  }).join("")}</ol>`;
}

function card(ctx, batch, full = false) {
  const { esc, icon, btn, fmtDate, dueTag } = ctx;
  const next = batchNextAction(batch);
  const today = todayISO();
  const m = batch.metrics;
  const a = `data-id="${esc(batch.id)}"`;
  const canWrite = ctx.can("leads:write");
  const stats = m
    ? `<p class="pt-stats" aria-label="Métricas del servidor"><span><b>${m.assigned}/${batch.target}</b> asignados</span><span><b>${m.contacted}</b> contactados</span><span><b>${m.replied}</b> respondieron</span><span><b>${m.calls}</b> llamadas</span><span><b>${m.proposals}</b> propuestas</span><span><b>${m.won}</b> ganados</span><span><b>${m.lost}</b> perdidos</span></p>`
    : `<p class="pt-stats"><span><b>—</b> métricas no disponibles</span></p>`;
  const primary = batch.status === "planned" ? btn("batch-sent", "Registrar envío D0", "btn-ink", a)
    : !batch.signalOn ? `${btn("batch-signal", "Registrar señal", "btn-ink", a)}${btn("batch-close", "Cerrar con informe", "btn-ghost", a)}`
    : btn("batch-close", "Cerrar con informe", "btn-ink", a);
  const actions = !canWrite || !batch.open ? "" : `<div class="pt-actions" style="margin-top:0">${primary}${btn("batch-assign", "Sumar prospectos", "btn-ghost", a)}${btn("new-prospect", "Prospecto nuevo", "btn-ghost", a)}${btn("batch-edit", "Editar", "btn-ghost", a)}</div>`;
  return `<li class="pt-card"${next?.due && next.due < today ? " data-late" : next?.due === today ? " data-turn" : ""}>
    <div class="pt-card-top"><span class="label">${esc(batch.vertical || "Sin vertical")}</span>${batch.status === "closed" ? `<span class="pt-tag pt-tag-ok">${icon("check")} Cerrado</span>` : next?.due ? dueTag(next.due) : `<span class="pt-tag">${esc(batch.statusLabel)}</span>`}</div>
    <div><h3 class="pt-card-title">${full ? esc(batch.name) : `<a class="pt-row-name" href="#lotes/${encodeURIComponent(batch.id)}">${esc(batch.name)}</a>`}</h3>${batch.demo ? `<p class="pt-meta">${esc(batch.demo)}</p>` : ""}</div>
    ${batch.hypothesis ? `<p class="pt-fine"><strong>Hipótesis:</strong> ${esc(batch.hypothesis)}</p>` : ""}
    ${next ? `<p class="pt-fine"><strong>Sigue:</strong> ${esc(next.title)}${next.due ? ` · ${fmtDate(next.due, true)}` : ""}</p>` : ""}
    ${rail(ctx, batch)}
    ${stats}
    ${batch.sentOn ? `<p class="pt-fine"><strong>Envío D0:</strong> ${fmtDate(batch.sentOn, true)}${batch.sentCount !== null ? ` · ${batch.sentCount} mensaje${batch.sentCount === 1 ? "" : "s"} mandados a mano` : ""}</p>` : ""}
    ${batch.signalOn ? `<p class="pt-fine"><strong>Señal D+${batch.signalDays}:</strong> ${esc(batch.signalNote)}<span class="log-time">${fmtDate(batch.signalOn, true)}</span></p>` : ""}
    ${batch.report ? `<ul class="pt-report"><li><b>Funcionó:</b> ${esc(batch.report.worked)}</li><li><b>No funcionó:</b> ${esc(batch.report.notWorked)}</li><li><b>Próxima vez:</b> ${esc(batch.report.change)}</li><li class="pt-fine">Cerrado el ${fmtDate(batch.closedOn, true)}</li></ul>` : ""}
    ${actions}
  </li>`;
}

// ---------- Lista ----------

function list(ctx) {
  const { shell, crumbs, esc, icon, btn, emptyState, entryView } = ctx;
  const entry = ctx.repo.get("batches");
  const canWrite = ctx.can("leads:write");
  const body = (data) => {
    const open = data.items.filter((batch) => batch.open);
    const closed = data.items.filter((batch) => !batch.open);
    return `
    ${data.truncated ? '<p class="pt-fine" role="status">Hay más lotes de los que se cargan acá (300).</p>' : ""}
    <section class="pt-list" aria-labelledby="open-title">
      <div class="pt-list-head"><div class="pt-list-title"><h2 id="open-title" class="pt-h2">Abiertos</h2><span class="pt-count">${open.length}</span></div></div>
      ${open.length ? `<ul class="pt-cards">${open.map((batch) => card(ctx, batch)).join("")}</ul>` : emptyState("Sin lotes abiertos", "Elegí una vertical, personalizá la demo base (30–45 min) y mandala a pocos contactos.", canWrite ? btn("new-batch", `${icon("plus")} Lote`, "btn-ink") : "")}
    </section>
    ${closed.length ? `<section class="pt-list" aria-labelledby="closed-title"><div class="pt-list-head"><div class="pt-list-title"><h2 id="closed-title" class="pt-h2">Informes cerrados</h2><span class="pt-count">${closed.length}</span></div><p class="pt-fine">Buscá patrones: tres informes coincidentes → playbook.</p></div><ul class="pt-cards">${closed.map((batch) => card(ctx, batch)).join("")}</ul></section>` : ""}`;
  };
  return shell(`${crumbs([["Operación", "#hoy"], ["Lotes"]])}
    <div class="pt-head-row"><div>
      <div class="pt-kicker"><span class="label">Prospección demo-first</span></div>
      <h1 class="display pt-title">Lotes chicos, <em>demo</em> primero.</h1>
      <p class="pt-company">D0 envío · D+2 señal · D+7 cierre con informe de 3 líneas. Cuando tres informes coinciden, se vuelven playbook. Toda demo lleva: su negocio reconocible, su problema cuantificado, la solución funcionando y un extra que no pidió.</p>
      <p class="pt-fine live-note">El sistema no envía nada: vos mandás los mensajes a mano y los registrás acá. Con D0 calcula los recordatorios de señal y cierre. La unidad (Agency, Media, Market) no la guarda el servidor.</p>
    </div><div class="pt-head-actions">${canWrite ? btn("new-batch", `${icon("plus")} Lote`, "btn-primary") : '<span class="pt-fine">Crear lotes requiere <span class="readout">leads:write</span>.</span>'}</div></div>
    ${entryView(entry, { slice: "batches", key: "", label: "No pudimos cargar los lotes", render: body })}`, "lotes");
}

// ---------- Ficha ----------

function detail(ctx, id) {
  const { shell, crumbs, esc, icon, btn, emptyState, entryView, openLink } = ctx;
  const entry = ctx.repo.get("batch", id);
  if (entry.status === "error" && entry.error?.status === 404) {
    return shell(`${crumbs([["Lotes", "#lotes"], ["No encontrado"]])}${emptyState("No existe ese lote", "", `<a class="pt-link" href="#lotes">${icon("back")} Volver a lotes</a>`)}`, "lotes");
  }
  const canWrite = ctx.can("leads:write");
  const body = (batch) => {
    const key = membersKey(id);
    const members = ctx.repo.get("leads", key);
    const cols = "minmax(0,1.5fr) minmax(0,1fr) auto";
    const rows = (data) => data.items.length
      ? `<ul class="pt-rows">${data.items.map((lead) => `<li class="pt-row" style="--cols:${cols}"><div><a class="pt-row-name" href="#prospectos/${encodeURIComponent(lead.id)}">${esc(lead.name)}</a><span class="pt-meta">${esc(lead.company || lead.email || lead.phone || lead.handle || "")}</span></div><div><span class="pt-tag${lead.stage === "won" ? " pt-tag-ok" : lead.stage === "lost" ? " pt-tag-late" : ""}">${esc(lead.stageLabel)}</span></div><div class="pt-row-end">${canWrite && batch.open ? btn("batch-unassign", "Sacar", "btn-ghost", `data-id="${esc(batch.id)}" data-kind="${esc(lead.id)}"`) : ""}${openLink(`#prospectos/${encodeURIComponent(lead.id)}`)}</div></li>`).join("")}</ul>${data.nextCursor ? `<nav class="pagination" aria-label="Más prospectos del lote"><span class="pt-fine">${data.items.length} cargados · hay más</span>${btn("live-more", members.refreshing ? "Cargando…" : "Cargar más", "btn-ghost", `data-id="leads" data-kind="${esc(key)}"`)}</nav>` : ""}`
      : '<p class="pt-fine">Todavía no sumaste prospectos.</p>';
    return `
      <div class="pt-kicker"><span class="label">Lote${batch.sentOn ? ` · D0 ${ctx.fmtDate(batch.sentOn, true)}` : " · sin enviar todavía"}</span></div>
      <h1 class="display pt-title">${esc(batch.name)}</h1>
      <ul class="pt-cards" style="margin-top:32px;grid-template-columns:1fr">${card(ctx, batch, true)}</ul>
      <section class="pt-list"><div class="pt-list-head"><div class="pt-list-title"><h2 class="pt-h2">Contactos del lote</h2><span class="pt-count">${members.data ? members.data.items.length : "…"}</span></div></div>
        <div aria-live="polite">${entryView(members, { slice: "leads", key, label: "No pudimos cargar los prospectos del lote", render: rows })}</div>
      </section>
      <p><a class="pt-link" href="#lotes">${icon("back")} Volver a lotes</a></p>`;
  };
  return shell(`${crumbs([["Operación", "#hoy"], ["Lotes", "#lotes"], [entry.data?.name || "Lote"]])}${entryView(entry, { slice: "batch", key: id, label: "No pudimos cargar el lote", render: body })}`, "lotes");
}
