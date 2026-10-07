import { addDays, bimesterProgress, mrr, split, todayISO } from "./rules.js";
import { calendarItems, goalProgress, monthCells, salesPlan } from "./planner.js";

export function workspaceUI({ state, esc, icon, phaseGlyph, shell, crumbs, btn, field, row, usd, fmtDate, meter, emptyState, pagination, pageSlice, dateTime }) {
  const refLink = (reference) => {
    if (!reference) return "";
    const [type, id] = reference.split(":");
    const tables = { project: ["projects", "proyectos"], prospect: ["prospects", "prospectos"], batch: ["batches", "lotes"] };
    const table = tables[type];
    const item = table && state.data[table[0]].find((item) => item.id === id);
    return item ? `<a class="pt-link reference-link" href="#${table[1]}/${encodeURIComponent(id)}">${icon("arrow")} ${esc(item.name)}</a>` : "";
  };
  const goalCard = (goal) => {
    const p = goalProgress(goal);
    return `<li class="goal-card" data-completed="${p.completed}">
      <span class="goal-phase">${phaseGlyph(p.pct / 100, 30)}</span>
      <div class="goal-card-body"><span class="label">${esc(goal.category)}${goal.priority === "alta" ? " · Prioridad alta" : ""}</span>
        <a class="goal-title" href="#metas/${encodeURIComponent(goal.id)}">${esc(goal.title)}</a>
        <span class="pt-fine">${fmtDate(goal.due, true)}${goal.time ? ` · ${esc(goal.time)}` : ""} · ${p.total ? `${p.done}/${p.total} pasos` : "Meta simple"}</span>
      </div><span class="goal-state">${p.completed ? `<span class="pt-tag pt-tag-ok">${icon("check")} Completada</span>` : `<span class="readout">${p.pct}%</span>`}</span>
      <a class="goal-open" href="#metas/${encodeURIComponent(goal.id)}" aria-label="Abrir ${esc(goal.title)}">${icon("arrow")}</a>
    </li>`;
  };

  function focusBand() {
    const today = todayISO();
    const goals = state.data.goals.filter((goal) => goal.due === today);
    const completed = goals.filter((goal) => goalProgress(goal).completed).length;
    const event = state.data.calendarEvents.filter((event) => event.date === today && !event.completedAt).sort((a, b) => a.time.localeCompare(b.time))[0];
    return `<div class="focus-band ticks">
      <div class="focus-band-intro"><span class="label">Tu órbita de hoy</span><p>Un día con <em>dirección.</em></p></div>
      <a class="focus-metric" href="#metas"><span class="label">Mi plan</span><span class="readout">${completed}<small> / ${goals.length}</small></span><span class="pt-fine">metas completadas ${icon("arrow")}</span></a>
      <a class="focus-metric" href="#calendario"><span class="label">${event ? "En tu calendario" : "Espacio para avanzar"}</span><strong>${event ? `${esc(event.time)} · ${esc(event.title)}` : "Diseñá tu jornada"}</strong><span class="pt-fine">${event ? `${event.duration} minutos · ${esc(event.type)}` : "Llamadas, hitos y bloques de foco"} ${icon("arrow")}</span></a>
      <div class="focus-action">${btn("new-goal", `${icon("plus")} Planificar mi día`, "btn-primary")}</div>
    </div>`;
  }

  function renderGoals(id) {
    if (id) {
      const goal = state.data.goals.find((goal) => goal.id === id);
      if (!goal) return shell(emptyState("Esta meta no está disponible", "Volvé a tu plan para elegir otra.", '<a class="pt-link" href="#metas">Volver a mi plan</a>'), "hoy");
      const p = goalProgress(goal);
      return shell(`${crumbs([["Operación", "#hoy"], ["Mi plan", "#metas"], [goal.title]])}
        <div class="pt-head-row"><div><div class="pt-kicker"><span class="label">${esc(goal.category)} · ${fmtDate(goal.due, true)}${goal.time ? ` · ${esc(goal.time)}` : ""}</span></div>
        <h1 class="display pt-title">${esc(goal.title)}</h1><p class="pt-company">${esc(goal.notes || "Cada paso que completás te acerca a la meta del día.")}</p></div>
        <div class="pt-head-actions">${btn("new-goal", "Editar meta", "btn-ghost", `data-id="${esc(id)}"`)}</div></div>
        <div class="goal-detail-grid"><section class="goal-checks" aria-labelledby="check-title">
          <div class="pt-section-head"><h2 class="pt-h2" id="check-title">Paso a paso</h2><span class="pt-count">${p.done}/${p.total}</span></div>
          ${goal.steps.length ? `<ul class="goal-checklist">${goal.steps.map((step) => `<li data-done="${step.done}"><label><input type="checkbox" id="check-${esc(id)}-${esc(step.id)}" data-goal="${esc(id)}" data-step="${esc(step.id)}" ${step.done ? "checked" : ""}><span class="check-mark">${icon("check")}</span><span class="check-title"><span class="step-name">${esc(step.title)}</span>${step.completedAt ? `<small>Completado ${esc(new Date(step.completedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }))}</small>` : ""}</span></label></li>`).join("")}</ul>` : `<p class="pt-fine">Esta meta no tiene subtareas.</p>${btn("goal-toggle", p.completed ? "Volver a abrir" : "Completar meta", "btn-primary", `data-id="${esc(id)}"`)}`}
          <a class="pt-link" href="#metas">${icon("back")} Volver a mi plan</a>
        </section><aside class="goal-progress ticks"><div class="goal-orbit">${phaseGlyph(p.pct / 100, 88)}<span class="readout">${p.pct}<small>%</small></span></div><span class="label">${p.completed ? "Meta completada" : "En movimiento"}</span>
          <p>${p.completed ? "Hecho. Un paso más cerca." : p.total ? `Te quedan ${p.total - p.done} pasos.` : "Tu próximo logro empieza acá."}</p>${meter(p.pct)}
          <span class="pt-fine">${goal.completedAt ? `Completada el ${new Date(goal.completedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : "Al terminar todos los pasos, la meta se completa automáticamente."}</span>
          ${refLink(goal.reference)}<p class="pt-fine">Creada ${new Date(goal.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</p>
          ${btn("goal-delete", "Eliminar meta", "btn-danger", `data-id="${esc(id)}"`)}
        </aside></div>`, "hoy");
    }
    const today = todayISO();
    const filter = state.goalFilter;
    const list = state.data.goals.filter((goal) => filter === "hoy" ? goal.due <= today && !goalProgress(goal).completed : filter === "proximas" ? goal.due > today && !goalProgress(goal).completed : filter === "completadas" ? goalProgress(goal).completed : true).sort((a, b) => a.due.localeCompare(b.due) || (a.time || "23:59").localeCompare(b.time || "23:59"));
    return shell(`${crumbs([["Operación", "#hoy"], ["Mi plan"]])}<div class="pt-head-row"><div><div class="pt-kicker"><span class="label">Intención → pasos → progreso</span></div><h1 class="display pt-title">Tu día, <em>a propósito.</em></h1><p class="pt-company">Convertí lo que querés lograr en pasos concretos. El resto es avanzar, uno a uno.</p></div><div class="pt-head-actions">${btn("new-goal", `${icon("plus")} Nueva meta`, "btn-primary")}</div></div>
      <section class="pt-list"><div class="pt-list-head"><div class="pt-seg">${[["hoy", "Hoy y pendientes"], ["proximas", "Próximas"], ["completadas", "Completadas"], ["todas", "Todas"]].map(([key, label]) => btn("goal-filter", label, "", `data-id="${key}" aria-pressed="${filter === key}"`)).join("")}</div><span class="label">${list.length} metas</span></div>
      ${list.length ? `<ul class="goal-cards">${pageSlice(list, "goals").map(goalCard).join("")}</ul>${pagination(list, "goals")}` : emptyState("Espacio para una nueva meta", "Podés empezar con ventas, un proyecto o algo para vos.", btn("new-goal", "Crear mi primera meta", "btn-ink"))}</section>`, "hoy");
  }

  function calendarEntry(item) {
    const routes = { prospect: "prospectos", project: "proyectos", batch: "lotes", goal: "metas" };
    if (item.entity !== "event") return `<li class="calendar-entry" data-type="${item.type}" data-done="${item.completed}"><span class="calendar-time">${esc(item.time || "Todo el día")}</span><div><a href="#${routes[item.entity]}/${encodeURIComponent(item.id)}" class="goal-title">${esc(item.title)}</a><span class="pt-fine">${esc(item.name)}${item.completed ? " · Completada" : ""}</span></div><a href="#${routes[item.entity]}/${encodeURIComponent(item.id)}" aria-label="Abrir ${esc(item.title)}">${icon("arrow")}</a></li>`;
    return `<li class="calendar-entry" data-type="eventos" data-done="${item.completed}"><span class="calendar-time">${esc(item.time)}<small>${item.duration} min</small></span><details ${state.calendar.eventId === item.id ? "open" : ""}><summary>${esc(item.title)}<span class="pt-fine">${esc(item.name)}${item.completed ? " · Completado" : ""}</span></summary><div class="event-details"><p class="pt-fine">${esc(item.notes || "Sin notas adicionales.")}</p>${refLink(item.reference)}<div class="pt-actions">${btn("event-toggle", item.completed ? "Reabrir" : "Completar", "btn-ink", `data-id="${esc(item.id)}"`)}${btn("new-event", "Editar", "btn-ghost", `data-id="${esc(item.id)}"`)}${btn("event-delete", "Eliminar", "btn-danger", `data-id="${esc(item.id)}"`)}</div></div></details></li>`;
  }

  function renderCalendar(id) {
    if (!id) state.calendar.routeId = "";
    if (id && state.calendar.routeId !== id) {
      state.calendar.routeId = id;
      const event = state.data.calendarEvents.find((event) => event.id === id);
      if (event) Object.assign(state.calendar, { date: event.date, month: event.date.slice(0, 7), eventId: id });
    }
    const { month, date: selected, filter } = state.calendar;
    const today = todayISO();
    const all = calendarItems(state.data).filter((item) => filter === "todo" || item.type === filter);
    const selectedItems = all.filter((item) => item.date === selected);
    const monthName = new Date(`${month}-15T12:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    return shell(`${crumbs([["Operación", "#hoy"], ["Calendario"]])}<div class="pt-head-row"><div><div class="pt-kicker"><span class="label">Agenda Eclipse</span></div><h1 class="display pt-title">Dale espacio a <em>lo importante.</em></h1><p class="pt-company">Ventas, proyectos y metas. Una vista de todo lo que mueve tu operación.</p></div><div class="pt-head-actions">${btn("new-event", `${icon("plus")} Agendar`, "btn-primary")}</div></div>
      <div class="calendar-toolbar"><div class="calendar-month-control">${btn("calendar-month", icon("back"), "btn-ghost icon-button", 'data-id="-1" aria-label="Mes anterior"')}<h2 class="pt-h2">${esc(monthName)}</h2>${btn("calendar-month", icon("arrow"), "btn-ghost icon-button", 'data-id="1" aria-label="Mes siguiente"')}${btn("calendar-today", "Hoy", "btn-ghost")}</div><div class="pt-seg">${[["todo", "Todo"], ["operación", "Operación"], ["metas", "Metas"], ["eventos", "Eventos"]].map(([key, label]) => btn("calendar-filter", label, "", `data-id="${key}" aria-pressed="${filter === key}"`)).join("")}</div></div>
      <div class="calendar-layout"><section class="calendar-board" aria-label="Calendario de ${esc(monthName)}"><div class="calendar-weekdays">${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => `<span>${day}</span>`).join("")}</div><div class="calendar-grid">${monthCells(month).map((cell) => {
        const items = all.filter((item) => item.date === cell.date);
        const label = `${fmtDate(cell.date, true)}, ${items.length} actividades`;
        return `<button type="button" class="calendar-cell" data-action="calendar-day" data-id="${cell.date}" data-current="${cell.current}" data-today="${cell.date === today}" aria-pressed="${cell.date === selected}" aria-label="${esc(label)}"><span class="calendar-day-n">${cell.day}</span><span class="calendar-dots">${[...new Set(items.map((item) => item.type))].map((type) => `<i data-type="${type}"></i>`).join("")}</span><span class="calendar-cell-events">${items.slice(0, 2).map((item) => `<span data-type="${item.type}" data-done="${item.completed}">${esc(item.time ? `${item.time} ` : "")}${esc(item.title)}</span>`).join("")}${items.length > 2 ? `<small>+${items.length - 2} más</small>` : ""}</span></button>`;
      }).join("")}</div><div class="calendar-legend"><span><i data-type="operación"></i> Operación</span><span><i data-type="metas"></i> Metas</span><span><i data-type="eventos"></i> Eventos</span></div></section>
      <aside class="calendar-day-panel ticks"><span class="label">En agenda</span><h2 class="calendar-selected-title">${fmtDate(selected)}</h2><input type="date" class="pt-input" aria-label="Ir a una fecha" data-calendar-date value="${selected}"><div class="pt-section-head"><span class="pt-fine">${selectedItems.length} actividades</span>${btn("new-event", icon("plus"), "btn-ghost icon-button", 'aria-label="Agendar en este día"')}</div>
        ${selectedItems.length ? `<ul class="calendar-entries">${pageSlice(selectedItems, "calendar").map(calendarEntry).join("")}</ul>${pagination(selectedItems, "calendar")}` : '<p class="pt-fine calendar-empty">Un día abierto.<br>Reservá tiempo para lo que querés lograr.</p>'}
        ${btn("new-goal", "Crear una meta para este día", "btn-ghost", `data-day="${selected}"`)}
      </aside></div>`, "calendario");
  }

  function renderTools() {
    const progress = bimesterProgress(state.data);
    const v = state.calculator;
    const plan = salesPlan({ gap: Number(v.gap), ticket: Number(v.ticket), conversion: Number(v.conversion) });
    const available = Math.max(0, Math.min(168, Number(v.hours) || 0));
    const prospecting = Math.round(available * 0.2 * 10) / 10;
    return shell(`${crumbs([["Operación", "#hoy"], ["Herramientas"]])}<div class="pt-kicker"><span class="label">Menos intuición · más claridad</span></div><h1 class="display pt-title">Los números de <em>tu próxima jugada.</em></h1><p class="pt-company">Simulá escenarios antes de comprometer tiempo. Ajustá los valores a tu operación.</p>
      <div class="tools-grid"><section class="tool-card ticks"><span class="label">01 / Plan de ventas</span><h2 class="pt-h2">De la meta a las propuestas.</h2><p class="pt-fine">Partimos de lo que falta cobrar en el bimestre. La conversión es una hipótesis que podés ajustar.</p><div class="pt-form">${field("gap", "Monto a cubrir · USD", "number", v.gap, 'min="0" step="1" data-calc="gap"')}${row(field("ticket", "Ticket promedio · USD", "number", v.ticket, 'min="1" step="1" data-calc="ticket"'), field("conversion", "Propuestas que cierran · %", "number", v.conversion, 'min="1" max="100" step="1" data-calc="conversion"'))}</div><div class="tool-result" aria-live="polite">${plan ? `<span><b class="readout">${plan.sales}</b> ventas</span><span><b class="readout">${plan.proposals}</b> propuestas</span>` : '<p class="pt-fine">Usá un ticket mayor a cero y una conversión entre 1 y 100%.</p>'}</div><p class="pt-fine">${progress.bimester.label} · faltan ${usd(Math.max(0, progress.goal - progress.collected))} · ${usd(progress.perWeekNeeded)}/semana.</p>${btn("new-goal", "Llevarlo a mi plan", "btn-ghost", 'data-template="ventas"')}</section>
      <section class="tool-card ticks"><span class="label">02 / Capacidad semanal</span><h2 class="pt-h2">Vendé sin saturar tu agenda.</h2><p class="pt-fine">Reservá un mínimo del 20% para prospectar y dejá un 10% de margen operativo.</p><div class="pt-form">${field("hours", "Horas disponibles / semana", "number", v.hours, 'min="0" max="168" step="0.5" data-calc="hours"')}</div><div class="capacity-bar"><span style="width:20%"></span><span style="width:70%"></span><span style="width:10%"></span></div><dl class="capacity-values"><div><dt>Prospección · 20%</dt><dd>${prospecting} h</dd></div><div><dt>Proyectos · 70%</dt><dd>${Math.round(available * 0.7 * 10) / 10} h</dd></div><div><dt>Margen · 10%</dt><dd>${Math.round(available * 0.1 * 10) / 10} h</dd></div></dl>${btn("new-event", "Reservar bloque de foco", "btn-ghost", 'data-template="foco"')}<p class="pt-fine">MRR actual ${usd(mrr(state.data))} de ${usd(state.data.settings.mrrGoal)}.</p></section>
      <section class="tool-card ticks"><span class="label">03 / Reparto de cobros</span><h2 class="pt-h2">Cada dólar, con destino.</h2><p class="pt-fine">Simulá el reparto 40 / 40 / 10 / 10 antes de registrar el cobro.</p><div class="pt-form">${field("amount", "Cobro a distribuir · USD", "number", v.amount, 'min="0" step="1" data-calc="amount"')}</div><dl class="capacity-values">${split(Number(v.amount) || 0).map((part) => `<div><dt>${part.label} · ${part.share * 100}%</dt><dd class="readout">${usd(part.amount)}</dd></div>`).join("")}</dl>${btn("new-payment", "Registrar un cobro", "btn-ghost")}</section>
      <section class="tool-card tools-note"><span class="label">Una rutina que sostiene el sistema</span><h2 class="display">Abrir. Priorizar.<br><em>Avanzar. Cerrar.</em></h2><ol><li>Elegí una meta de ventas y una de entrega.</li><li>Reservá sus bloques en el calendario.</li><li>Registrá cada contacto con fecha y hora.</li><li>Cerrá el día completando tus pasos.</li></ol><a class="pt-link" href="#metas">Abrir mi plan ${icon("arrow")}</a></section></div>`, "herramientas");
  }

  function renderAudit() {
    const list = [...state.data.audit].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    return shell(`${crumbs([["Operación", "#hoy"], ["Bitácora"]])}<div class="pt-kicker"><span class="label">Trazabilidad de la operación</span></div><h1 class="display pt-title">Cada movimiento, <em>registrado.</em></h1><p class="pt-company">La fecha y hora de la actividad y el momento en que la cargaste. Horas en tu zona local; el respaldo conserva el instante y la zona horaria.</p><section class="pt-list"><div class="pt-list-head"><h2 class="pt-h2">Actividad reciente</h2><span class="label">${list.length} registros</span></div>${list.length ? `<ol class="audit-list">${pageSlice(list, "audit").map((entry) => `<li><span class="pt-log-date pt-date">${dateTime(entry)}</span><div><p class="pt-log-title">${esc(entry.title)}</p><p class="pt-fine">${esc(entry.entityName || "Eclipse")} · ${esc(entry.timezone || "")}</p><span class="audit-recorded">Cargado ${new Date(entry.recordedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</span></div></li>`).join("")}</ol>${pagination(list, "audit")}` : emptyState("Tu bitácora empieza con el próximo cambio", "Los registros anteriores conservan sus fechas. La nueva bitácora registra los movimientos que hagas desde ahora.")}</section>`, "actividad");
  }

  return { focusBand, renderGoals, renderCalendar, renderTools, renderAudit, refLink };
}
