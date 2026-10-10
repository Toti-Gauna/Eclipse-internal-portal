// Calendario: eventos del planificador (/admin/planner/events por rango) + metas con fecha + lo que la API puede dar con día
// (hitos de proyectos, cobros comprometidos y la agenda de prospectos y lotes). El mes pide su rango recién cuando se navega a él.
// Los eventos se cancelan, no se borran. Los choques de horario se calculan en el navegador sobre lo cargado (y se revisan al guardar).
import { monthCells } from "../../planner.js";
import { todayISO } from "../../rules.js";
import { formatCents as money, isDay } from "../adapters/common.js";
import { EVENT_TYPE_LABELS, adaptEvent, eventOverlaps, isOperationItem, minutesOf, monthGrid, parseRange, rangeKey, timeOfMinutes, timeRange } from "../adapters/planner.js";
import { dayRangeQuery, eventCreateBody, eventPatchBody, eventStatusBody } from "../adapters/outbound-planner.js";
import { FormError, unwrap } from "../errors.js";
import { uncertain } from "./metas.js";
import { currentCtx, ensureOnce, findEvent, goalsOf, loadedEvents, plannerTargets, refInfo, refOptions, remember, touchPlanner } from "./planner-shared.js";

const TYPES = [["todo", "Todo"], ["operación", "Operación"], ["metas", "Metas"], ["eventos", "Eventos"]];
const MILESTONE_PROJECTS = 15;
const monthLabel = (month) => new Date(`${month}-15T12:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });

/** Primer día del mes que está `delta` meses del de `day`; si es el mes de hoy, hoy. */
export function stepMonth(day, delta, today = todayISO()) {
  const [year, month] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
  return target === today.slice(0, 7) ? today : `${target}-01`;
}

/** Pide lo que dibuja el mes: eventos del rango, metas, agenda y (si hay permiso) hitos y cobros con fecha. */
export function loadMonth(ctx, month) {
  const { repo, can } = ctx;
  const { from, to } = monthGrid(month);
  const key = rangeKey(from, to);
  if (can("planner:read")) {
    repo.ensure("planner.events", key).catch(() => {});
    repo.ensure("planner.goals").catch(() => {});
  }
  if (can("planner:read") || can("leads:read")) repo.ensure("planner.agenda", `${key}|all`).catch(() => {});
  if (can("leads:read")) repo.ensure("planner.leads").catch(() => {});
  if (can("projects:read")) {
    repo.ensure("projects").then((data) => {
      const ids = data.list.filter((project) => project.stage !== "closed").slice(0, MILESTONE_PROJECTS).map((project) => project.id);
      repo.ensureAll("project.milestones", ids, { maxAge: 300_000 });
      if (can("billing:read")) repo.ensureAll("project.payments", ids, { maxAge: 300_000 });
    }).catch(() => {});
  }
}

/** Todo lo que cae en [from, to], con el mismo formato: { key, type, date, time, title, name, completed, href?, event? }. */
export function calendarItems(ctx, from, to) {
  const { repo } = ctx;
  const key = rangeKey(from, to);
  const inside = (date) => Boolean(date) && date >= from && date <= to;
  const items = [];
  for (const event of repo.data("planner.events", key) || []) {
    if (!inside(event.date)) continue;
    items.push({ key: `event:${event.id}`, type: "eventos", kind: "event", date: event.date, time: event.time, title: event.title, name: event.typeLabel, completed: event.done, cancelled: event.cancelled, event });
  }
  for (const goal of goalsOf(ctx)) {
    if (!inside(goal.due) || goal.status === "cancelled") continue;
    items.push({ key: `goal:${goal.id}`, type: "metas", kind: "goal", date: goal.due, time: goal.time, title: goal.title, name: `Meta · ${goal.categoryLabel}`, completed: goal.status === "done", href: `#metas/${encodeURIComponent(goal.id)}` });
  }
  const leads = repo.data("planner.leads")?.list || [];
  for (const item of repo.data("planner.agenda", `${key}|all`) || []) {
    if (!isOperationItem(item) || !inside(item.date)) continue;
    const who = leads.find((lead) => lead.id === item.id)?.name || item.detail;
    items.push({ key: `agenda:${item.key}`, type: "operación", kind: "agenda", date: item.date, time: item.time, title: item.title || item.typeLabel, name: who ? `${item.typeLabel} · ${who}` : item.typeLabel, completed: false, href: item.href });
  }
  for (const project of repo.data("projects")?.list || []) {
    for (const milestone of repo.data("project.milestones", project.id) || []) {
      if (!inside(milestone.plannedOn) || ["done", "cancelled"].includes(milestone.status)) continue;
      items.push({ key: `milestone:${milestone.id}`, type: "operación", kind: "milestone", date: milestone.plannedOn, time: null, title: `Hito · ${milestone.title}`, name: project.name, completed: false, href: `#proyectos/${encodeURIComponent(project.id)}` });
    }
    if (!ctx.can("billing:read")) continue;
    for (const payment of repo.data("project.payments", project.id) || []) {
      if (payment.status !== "committed" || !inside(payment.dueOn)) continue;
      items.push({ key: `payment:${payment.id}`, type: "operación", kind: "payment", date: payment.dueOn, time: null, title: `Vence ${payment.concept.toLowerCase()} · ${money(payment.amountCents)}`, name: project.name, completed: false, href: `#proyectos/${encodeURIComponent(project.id)}` });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "23:59").localeCompare(b.time || "23:59") || a.title.localeCompare(b.title));
}

const checkbox = (name, label, { required = false } = {}) => `<div class="pt-field live-check"><label><input type="checkbox" name="${name}" value="1"${required ? " required" : ""}> <span>${label}</span></label></div>`;
const summaryList = (ctx, pairs) => `<dl class="generator-summary">${pairs.filter(([, value]) => value !== "" && value !== undefined && value !== null).map(([label, value]) => `<div><dt>${ctx.esc(label)}</dt><dd>${ctx.esc(value)}</dd></div>`).join("")}</dl>`;
const clashText = (list) => list.map((event) => `«${event.title}» (${timeRange(event)})`).join(", ");

export default {
  id: "calendario",
  label: "Calendario",
  nav: { order: 20, area: "main" },
  status: "live",
  permission: ["planner:read", "projects:read", "leads:read"],
  filters: { calendario: { day: todayISO(), type: "todo" } },

  prepare(ctx) {
    remember(ctx);
    loadMonth(ctx, ctx.state.filters.calendario.day.slice(0, 7));
  },

  render(ctx, route) {
    remember(ctx);
    const { shell, crumbs, esc, icon, btn, fmtDate, loading, failure } = ctx;
    const f = ctx.state.filters.calendario;
    const today = todayISO();
    const selected = isDay(f.day) ? f.day : today;
    const month = selected.slice(0, 7);
    const { from, to } = monthGrid(month);
    const key = rangeKey(from, to);
    const write = ctx.can("planner:write");
    const eventsEntry = ctx.can("planner:read") ? ctx.repo.get("planner.events", key) : null;
    const all = calendarItems(ctx, from, to).filter((item) => f.type === "todo" || item.type === f.type);
    const gridItems = all.filter((item) => !item.cancelled);
    const dayItems = all.filter((item) => item.date === selected);
    const dayEvents = dayItems.filter((item) => item.kind === "event").map((item) => item.event);
    const status = eventsEntry?.status === "error" ? failure(eventsEntry.error, { slice: "planner.events", key, title: "No pudimos cargar los eventos del mes" })
      : eventsEntry && eventsEntry.data === undefined ? loading(`Cargando ${monthLabel(month)}…`) : "";

    const entry = (item) => {
      if (item.kind !== "event") {
        return `<li class="calendar-entry" data-type="${item.type}" data-done="${item.completed}"><span class="calendar-time">${esc(item.time || "Todo el día")}</span><div>${item.href ? `<a href="${item.href}" class="goal-title">${esc(item.title)}</a>` : `<span class="goal-title">${esc(item.title)}</span>`}<span class="pt-fine">${esc(item.name)}${item.completed ? " · Completada" : ""}</span></div>${item.href ? `<a href="${item.href}" aria-label="Abrir ${esc(item.title)}">${icon("arrow")}</a>` : ""}</li>`;
      }
      const event = item.event;
      const clashes = event.cancelled ? [] : eventOverlaps(dayEvents, event);
      const ref = refInfo(ctx.repo, event.refType, event.refId);
      const a = `data-id="${esc(event.id)}"`;
      const buttons = !write ? "" : event.cancelled ? btn("event-status", "Volver a agendar", "btn-ink", `${a} data-kind="scheduled"`)
        : [event.done ? btn("event-status", "Reabrir", "btn-ink", `${a} data-kind="scheduled"`) : btn("event-status", "Completar", "btn-ink", `${a} data-kind="done"`), btn("new-event", "Editar", "btn-ghost", a), btn("event-cancel", "Cancelar evento", "btn-danger", a)].join("");
      return `<li class="calendar-entry" data-type="eventos" data-done="${event.done}" data-cancelled="${event.cancelled}"><span class="calendar-time">${esc(event.time || "Todo el día")}${event.duration ? `<small>${event.duration} min</small>` : ""}</span>
        <details ${route.id === event.id ? "open" : ""}><summary>${esc(event.title)}<span class="pt-fine">${esc(event.typeLabel)}${event.done ? " · Completado" : ""}${event.cancelled ? " · Cancelado" : ""}${event.mine ? "" : " · De otra persona"}${clashes.length ? " · Coincide con otro evento" : ""}</span></summary>
          <div class="event-details">
            <p class="pt-fine">${esc(timeRange(event))}${event.time ? "" : " · sin hora"}</p>
            ${clashes.length ? `<p class="generator-warning" role="note">Coincide con ${esc(clashText(clashes))}.</p>` : ""}
            <p class="pt-fine live-prewrap">${esc(event.notes || "Sin notas adicionales.")}</p>
            ${ref ? `<a class="pt-link reference-link" href="${ref.href}">${icon("arrow")} ${esc(ref.kind)} · ${esc(ref.label)}</a>` : ""}
            <div class="pt-actions">${buttons}</div></div></details></li>`;
    };

    const cell = (day) => {
      const items = gridItems.filter((item) => item.date === day.date);
      const label = `${fmtDate(day.date, true)}, ${items.length} ${items.length === 1 ? "actividad" : "actividades"}`;
      return `<button type="button" class="calendar-cell" data-action="filter" data-id="calendario.day" data-kind="${day.date}" data-current="${day.current}" data-today="${day.date === today}" aria-pressed="${day.date === selected}" aria-label="${esc(label)}"><span class="calendar-day-n">${day.day}</span><span class="calendar-dots">${[...new Set(items.map((item) => item.type))].map((type) => `<i data-type="${type}"></i>`).join("")}</span><span class="calendar-cell-events">${items.slice(0, 2).map((item) => `<span data-type="${item.type}" data-done="${item.completed}">${esc(item.time ? `${item.time} ` : "")}${esc(item.title)}</span>`).join("")}${items.length > 2 ? `<small>+${items.length - 2} más</small>` : ""}</span></button>`;
    };

    const sources = [];
    if (!ctx.can("planner:read")) sources.push("eventos y metas (planner:read)");
    if (!ctx.can("leads:read")) sources.push("próximas acciones de prospectos y lotes (leads:read)");
    if (!ctx.can("projects:read")) sources.push("hitos de proyectos (projects:read)");
    if (!ctx.can("billing:read")) sources.push("vencimientos de cobros (billing:read)");

    return shell(`${crumbs([["Operación", "#hoy"], ["Calendario"]])}
      <div class="pt-head-row"><div><div class="pt-kicker"><span class="label">Agenda Eclipse</span></div><h1 class="display pt-title">Dale espacio a <em>lo importante.</em></h1><p class="pt-company">Eventos, metas con fecha, hitos de proyectos, cobros que vencen y próximas acciones. Cada mes se pide al servidor cuando llegás a él.</p></div>
        <div class="pt-head-actions">${write ? btn("new-event", `${icon("plus")} Agendar`, "btn-primary") : ""}</div></div>
      <div class="calendar-toolbar"><div class="calendar-month-control">
          <button type="button" class="btn btn-sm btn-ghost icon-button" data-action="filter" data-id="calendario.day" data-kind="${stepMonth(selected, -1, today)}" aria-label="Mes anterior">${icon("back")}</button>
          <h2 class="pt-h2" aria-live="polite">${esc(monthLabel(month))}</h2>
          <button type="button" class="btn btn-sm btn-ghost icon-button" data-action="filter" data-id="calendario.day" data-kind="${stepMonth(selected, 1, today)}" aria-label="Mes siguiente">${icon("arrow")}</button>
          <button type="button" class="btn btn-sm btn-ghost" data-action="filter" data-id="calendario.day" data-kind="${today}">Hoy</button></div>
        <div class="pt-seg" role="group" aria-label="Qué mostrar">${TYPES.map(([id, label]) => `<button type="button" data-action="filter" data-id="calendario.type" data-kind="${id}" aria-pressed="${f.type === id}">${label}</button>`).join("")}</div></div>
      ${status}
      <div class="calendar-layout"><section class="calendar-board" aria-label="Calendario de ${esc(monthLabel(month))}"><div class="calendar-weekdays">${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => `<span>${day}</span>`).join("")}</div><div class="calendar-grid">${monthCells(month).map(cell).join("")}</div>
        <div class="calendar-legend"><span><i data-type="operación"></i> Operación</span><span><i data-type="metas"></i> Metas</span><span><i data-type="eventos"></i> Eventos</span></div>
        ${sources.length ? `<p class="pt-fine live-note">Sin permiso para ver: ${esc(sources.join("; "))}. No se muestran en este calendario.</p>` : ""}</section>
      <aside class="calendar-day-panel ticks"><span class="label">En agenda</span><h2 class="calendar-selected-title">${fmtDate(selected)}</h2>
        <div class="live-inline"><label class="sr-only" for="cal-goto">Ir a una fecha</label><input type="date" id="cal-goto" class="pt-input" value="${esc(selected)}"><button type="button" class="btn btn-sm btn-ghost" data-action="calendar-goto">Ir</button></div>
        <div class="pt-section-head"><span class="pt-fine" aria-live="polite">${dayItems.length} ${dayItems.length === 1 ? "actividad" : "actividades"}</span>${write ? btn("new-event", icon("plus"), "btn-ghost icon-button", 'aria-label="Agendar en este día"') : ""}</div>
        ${dayItems.length ? `<ul class="calendar-entries">${dayItems.map(entry).join("")}</ul>` : '<p class="pt-fine calendar-empty">Un día abierto.<br>Reservá tiempo para lo que querés lograr.</p>'}
        ${ctx.can("planner:write") ? btn("new-goal", "Crear una meta para este día", "btn-ghost") : ""}
      </aside></div>`, "calendario");
  },

  // ---------- Formulario: agendar / editar ----------
  wizards: {
    "new-event": (wizard, ctx) => {
      remember(ctx);
      ensureOnce(ctx, "planner.leads", "", "leads:read");
      ensureOnce(ctx, "projects", "", "projects:read");
      const { esc, field, area, select, row, fmtDate } = ctx;
      const event = wizard.id ? findEvent(ctx.repo, wizard.id) : null;
      if (wizard.id && !event) return null;
      const calendarDay = wizard.returnTo?.startsWith("#calendario") ? ctx.state.filters.calendario?.day : null;
      const focus = wizard.template === "foco";
      const hours = Number(ctx.state.calculator?.hours) || 0;
      // Un bloque de foco sugiere el tiempo diario de prospección que salió de la calculadora de capacidad (20% de las horas, en 5 días).
      const focusMinutes = focus && hours > 0 ? String(Math.min(240, Math.max(15, Math.round((hours * 0.2 * 60) / 5 / 5) * 5))) : "30";
      const v = {
        title: event?.title || (focus ? "Bloque de foco · prospección" : ""),
        type: event?.type || (focus ? "focus" : "call"),
        date: event?.date || calendarDay || wizard.day || todayISO(),
        time: event ? event.time || "" : "09:00",
        duration: event ? String(event.duration ?? "") : focusMinutes,
        notes: event?.notes || "", reference: "", allowOverlap: "",
        ...wizard.values,
      };
      const me = ctx.api.admin?.id || null;
      const events = loadedEvents(ctx.repo);
      const candidate = { id: event?.id, date: v.date, time: v.time, duration: Number(v.duration) || 0, ownerAdminId: event?.ownerAdminId || me };
      const clashes = eventOverlaps(events, candidate);
      const covered = ctx.repo.loadedKeys("planner.events").some((key) => { const range = parseRange(key); return v.date >= range.from && v.date <= range.to && ctx.repo.get("planner.events", key).status === "ready"; });
      const references = refOptions(ctx);
      const ref = event ? refInfo(ctx.repo, event.refType, event.refId) : null;
      const hint = v.time && clashes.length ? `<p class="generator-warning" role="status">Coincide con ${esc(clashText(clashes))}. Podés ajustar la hora o agendarlo igual en el último paso.</p>` : "";
      return {
        kicker: "Calendario", title: event ? "Ajustá tu agenda." : "Reservá tiempo para avanzar.", intro: "Una llamada, un hito o un bloque de foco. Todo tiene su lugar.", submit: event ? "Guardar evento" : "Agendar evento",
        values: v,
        steps: [
          ["Actividad", "¿Para qué reservás este espacio?",
            field("title", "Actividad", "text", v.title, 'required maxlength="160" placeholder="Ej. Llamada de propuesta · Clínica"')
            + select("type", "Tipo de actividad", Object.entries(EVENT_TYPE_LABELS), v.type)
            + (event ? (ref ? `<p class="pt-fine">Vinculado a <a class="pt-link" style="min-height:0" href="${ref.href}">${esc(ref.kind)} · ${esc(ref.label)}</a>. El vínculo no se cambia después de agendar.</p>` : "")
              : (references.length ? select("reference", "Vincular a un prospecto o proyecto · opcional", references, v.reference, "Sin vínculo") : `<p class="pt-fine">${ctx.can("projects:read") || ctx.can("leads:read") ? "Cargando prospectos y proyectos para vincular…" : "Tu cuenta no puede leer prospectos ni proyectos, así que no se pueden vincular."}</p>`))
            + area("notes", "Notas / preparación · opcional", v.notes, 'maxlength="2000" rows="3"')],
          ["Horario", "Elegí el momento.",
            row(field("date", "Día", "date", v.date, "required data-rerender"), field("time", "Hora de inicio · opcional", "time", v.time, "data-rerender"))
            + field("duration", "Duración · minutos · opcional", "number", v.duration, 'min="1" max="1440" step="1"')
            + '<p class="pt-fine">Sin hora, el evento ocupa el día entero. La duración necesita una hora y el evento no puede cruzar la medianoche.</p>' + hint],
          ["Revisión", "Todo listo para confirmar.",
            summaryList(ctx, [["Actividad", v.title], ["Tipo", EVENT_TYPE_LABELS[v.type] || v.type], ["Cuándo", `${fmtDate(v.date, true)}${v.time ? ` · ${v.time}${Number(v.duration) ? `–${timeOfMinutes(Math.min(1440, minutesOf(v.time) + Number(v.duration)))}` : ""}` : " · todo el día"}`], ["Duración", v.duration ? `${v.duration} minutos` : ""], ["Vínculo", references.find(([value]) => value === v.reference)?.[1] || ""]])
            + (v.time ? (clashes.length ? `<p class="generator-warning" role="alert">Atención: coincide con ${esc(clashText(clashes))}.</p>` : covered ? '<p class="pt-fine" role="status">No coincide con ningún evento cargado de ese día.</p>' : '<p class="pt-fine" role="status">Los eventos de ese día todavía no están cargados. Al guardar, el servidor los revisa y te avisa si se pisan.</p>') : "")
            + checkbox("allowOverlap", "Agendar igual si coincide con otro evento")],
        ],
      };
    },
  },

  // ---------- Diálogos ----------
  modals: {
    "event-cancel": { markup(ctx, modal) {
      remember(ctx);
      const event = findEvent(ctx.repo, modal.id);
      return ctx.modalShell(event?.title || "Evento", "Cancelar este evento", "Los eventos no se borran: queda como Cancelado en el calendario y deja de contar para los choques de horario. Podés volver a agendarlo.", checkbox("confirm", "Confirmo que quiero cancelar este evento", { required: true }), "Cancelar evento", { live: true });
    } },
  },

  // ---------- Botones directos ----------
  actions: {
    /** Completar, reabrir o volver a agendar. `kind` es el estado destino. */
    "event-status": async (ctx, { id, kind }) => {
      const event = findEvent(ctx.repo, id);
      if (!event) throw new FormError("No encontramos el evento. Volvé al calendario.");
      await ctx.api.patch(`/admin/planner/events/${id}`, unwrap(eventStatusBody(event, kind)));
      return { message: kind === "done" ? "Evento completado." : event.cancelled ? "Evento vuelto a agendar." : "Evento reabierto.", refresh: plannerTargets(ctx.repo) };
    },
    "calendar-goto": async (ctx) => {
      const value = document.getElementById("cal-goto")?.value;
      if (!isDay(value)) throw new FormError("Elegí una fecha válida.");
      ctx.state.filters.calendario.day = value;
      loadMonth(ctx, value.slice(0, 7));
      return {};
    },
    /** Abre un evento desde otra pantalla (Hoy): fija el día del calendario y navega a la ficha. */
    "calendar-open": async (ctx, { id, kind }) => {
      if (isDay(kind)) ctx.state.filters.calendario.day = kind;
      window.location.hash = `#calendario/${encodeURIComponent(id)}`;
      return {};
    },
  },

  // ---------- Envíos ----------
  mutations: {
    "new-event": async (values, h) => {
      const me = h.api.admin?.id || null;
      const editing = h.target?.id ? findEvent(h.repo, h.target.id) : null;
      if (h.target?.id && !editing) throw new FormError("No encontramos el evento. Volvé al calendario y probá de nuevo.");
      const body = unwrap(editing ? eventPatchBody(values, editing) : eventCreateBody(values));
      // El choque que se ve en pantalla sale de lo cargado: antes de guardar se mira el día completo en el servidor.
      // (Editar solo el título o las notas no cambia el horario: un choque que ya existía no se vuelve a frenar.)
      const reschedules = !editing || ["onDate", "startTime", "durationMinutes"].some((field) => field in body);
      if (values.time && reschedules && !values.allowOverlap) {
        const day = (await h.api.get("/admin/planner/events", { query: dayRangeQuery(values.date) })).events.map((event) => adaptEvent(event, { me }));
        const clashes = eventOverlaps(day, { id: editing?.id, date: values.date, time: values.time, duration: Number(values.duration) || 0, ownerAdminId: editing?.ownerAdminId || me });
        if (clashes.length) throw new FormError(`Coincide con ${clashText(clashes)}. Cambiá la hora, o volvé al último paso y marcá «Agendar igual si coincide con otro evento».`);
      }
      touchPlanner(h);
      const lastCtx = currentCtx();
      if (editing) {
        await h.api.patch(`/admin/planner/events/${editing.id}`, body);
        if (lastCtx) lastCtx.state.filters.calendario.day = values.date;
        return { message: "Evento guardado.", goto: `#calendario/${encodeURIComponent(editing.id)}` };
      }
      let created;
      try { created = await h.api.post("/admin/planner/events", body); } catch (error) { await uncertain(h, error, "el evento"); }
      if (lastCtx) lastCtx.state.filters.calendario.day = values.date;
      return { message: "Evento agendado.", goto: `#calendario/${encodeURIComponent(created.event.id)}` };
    },
    "event-cancel": async (values, h) => {
      if (!values.confirm) throw new FormError("Marcá la casilla para confirmar.");
      const event = findEvent(h.repo, h.modal.id);
      if (!event) throw new FormError("No encontramos el evento. Volvé al calendario.");
      touchPlanner(h);
      await h.api.patch(`/admin/planner/events/${event.id}`, unwrap(eventStatusBody(event, "cancelled")));
      return { message: "Evento cancelado. Queda en el calendario como Cancelado; no se borró." };
    },
  },
};
