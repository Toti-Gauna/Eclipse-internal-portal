// Mi plan: las metas y sus pasos del planificador del servidor (/admin/planner/goals).
// Una meta con pasos se completa SOLA cuando termina el último y se reabre si se reabre uno (lo hace el servidor, no el portal).
// Se cancela, no se borra. Las metas personales las ve solo su dueño.
import { todayISO } from "../../rules.js";
import { GOAL_CATEGORY_LABELS, GOAL_PRIORITY_LABELS, GOAL_VIEWS, goalMatches, isOperationItem, sortGoals } from "../adapters/planner.js";
import { goalCreateBody, goalPatchBody, goalStatusBody, stepAddBody, stepSetBody } from "../adapters/outbound-planner.js";
import { FormError, unwrap } from "../errors.js";
import { PLANNER_SLICES, ensureOnce, findGoal, goalsOf, loadedAgenda, plannerTargets, refInfo, refOptions, remember, touchPlanner } from "./planner-shared.js";

const stamp = (iso) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
const checkbox = (name, label, { required = false } = {}) => `<div class="pt-field live-check"><label><input type="checkbox" name="${name}" value="1"${required ? " required" : ""}> <span>${label}</span></label></div>`;
const summaryList = (ctx, pairs) => `<dl class="generator-summary">${pairs.filter(([, value]) => value !== "" && value !== undefined && value !== null).map(([label, value]) => `<div><dt>${ctx.esc(label)}</dt><dd>${ctx.esc(value)}</dd></div>`).join("")}</dl>`;

/** Una escritura sin Idempotency-Key que se cortó a mitad de camino: no se sabe si quedó guardada. Se dice, no se reintenta sola. */
export async function uncertain(h, error, what) {
  if (error?.unknownOutcome) {
    await h.repo.refresh(plannerTargets(h.repo)).catch(() => {});
    throw new FormError(`Se cortó la conexión y no pudimos confirmar si ${what} se guardó. Mirá la lista antes de volver a intentar, así no queda duplicado.`);
  }
  throw error;
}

function leadName(ctx, id) {
  return (ctx.repo.data("planner.leads")?.list || []).find((lead) => lead.id === id)?.name || "";
}

export default {
  id: "metas",
  label: "Mi plan",
  nav: { order: 60, area: "menu", hint: "Metas y próximos pasos" },
  status: "live",
  permission: "planner:read",
  filters: { metas: { view: "hoy", owner: "mine" } },
  slices: PLANNER_SLICES,

  prepare(ctx) {
    remember(ctx);
    ctx.repo.ensure("planner.goals").catch(() => {});
    if (ctx.can("leads:read")) ctx.repo.ensure("planner.leads").catch(() => {});
    if (ctx.can("projects:read")) ctx.repo.ensure("projects").catch(() => {});
  },

  // ---------- Pantalla ----------
  render(ctx, route) {
    remember(ctx);
    const { shell, crumbs, esc, icon, phaseGlyph, btn, fmtDate, meter, emptyState, entryView, pagination, pageSlice } = ctx;
    const write = ctx.can("planner:write");
    const entry = ctx.repo.get("planner.goals");

    const goalCard = (goal) => {
      const p = goal.progress;
      return `<li class="goal-card" data-completed="${goal.status === "done"}" data-cancelled="${goal.status === "cancelled"}">
        <span class="goal-phase">${phaseGlyph(p.pct / 100, 30)}</span>
        <div class="goal-card-body"><span class="label">${esc(goal.categoryLabel)}${goal.high ? " · Prioridad alta" : ""}${goal.mine ? "" : " · De otra persona"}${goal.category === "personal" ? " · Privada" : ""}</span>
          <a class="goal-title" href="#metas/${encodeURIComponent(goal.id)}">${esc(goal.title)}</a>
          <span class="pt-fine">${goal.due ? `${fmtDate(goal.due, true)}${goal.time ? ` · ${esc(goal.time)}` : ""}` : "Sin fecha"} · ${p.total ? `${p.done}/${p.total} pasos` : "Meta simple"}</span>
        </div><span class="goal-state">${goal.status === "done" ? `<span class="pt-tag pt-tag-ok">${icon("check")} Completada</span>` : goal.status === "cancelled" ? '<span class="pt-tag pt-tag-out">Cancelada</span>' : `<span class="readout">${p.pct}%</span>`}</span>
        <a class="goal-open" href="#metas/${encodeURIComponent(goal.id)}" aria-label="Abrir ${esc(goal.title)}">${icon("arrow")}</a>
      </li>`;
    };

    if (route.id) {
      return shell(`${crumbs([["Operación", "#hoy"], ["Mi plan", "#metas"], [findGoal(ctx, route.id)?.title || "Meta"]])}${entryView(entry, { slice: "planner.goals", key: "", label: "No pudimos cargar tus metas", render: () => detail(ctx, route.id, write) })}`, "metas");
    }

    const f = ctx.state.filters.metas;
    const today = todayISO();
    const visible = (goalsOf(ctx)).filter((goal) => f.owner === "all" || goal.mine);
    const list = sortGoals(visible.filter((goal) => goalMatches(goal, f.view, today)));
    const countFor = (view) => visible.filter((goal) => goalMatches(goal, view, today)).length;
    const body = (goals) => `<section class="pt-list" aria-label="Metas" aria-live="polite">
        <div class="pt-list-head"><div class="pt-seg" role="group" aria-label="Qué metas ver">${GOAL_VIEWS.map(([key, label]) => `<button type="button" data-action="filter" data-id="metas.view" data-kind="${key}" aria-pressed="${f.view === key}">${esc(label)} <span class="pt-count">${countFor(key)}</span></button>`).join("")}</div>
          <div class="pt-seg" role="group" aria-label="De quién">${[["mine", "Mías"], ["all", "Del equipo"]].map(([key, label]) => `<button type="button" data-action="filter" data-id="metas.owner" data-kind="${key}" aria-pressed="${f.owner === key}">${label}</button>`).join("")}</div></div>
        ${list.length ? `<ul class="goal-cards">${pageSlice(list, "goals").map(goalCard).join("")}</ul>${pagination(list, "goals")}`
          : emptyState(goals.length ? "Nada en esta vista" : "Espacio para una nueva meta", goals.length ? "Probá con otra vista de arriba." : "Podés empezar con ventas, un proyecto o algo para vos.", write && !goals.length ? btn("new-goal", "Crear mi primera meta", "btn-ink") : "")}
      </section>
      <p class="pt-fine live-note">Las metas personales las ve solo quien las creó. «Del equipo» suma las metas compartidas de otras personas; no incluye las personales de nadie más.</p>`;

    return shell(`${crumbs([["Operación", "#hoy"], ["Mi plan"]])}
      <div class="pt-head-row"><div><div class="pt-kicker"><span class="label">Intención → pasos → progreso</span></div><h1 class="display pt-title">Tu día, <em>a propósito.</em></h1><p class="pt-company">Convertí lo que querés lograr en pasos concretos. Cuando terminás el último paso, la meta se completa sola.</p></div>
        <div class="pt-head-actions">${write ? btn("new-goal", `${icon("plus")} Nueva meta`, "btn-primary") : '<span class="pt-fine">Tu cuenta puede ver las metas, pero no crearlas (<span class="readout">planner:write</span>).</span>'}</div></div>
      ${entryView(entry, { slice: "planner.goals", key: "", label: "No pudimos cargar tus metas", render: body })}`, "metas");
  },

  // ---------- Formulario: crear / editar ----------
  wizards: {
    "new-goal": (wizard, ctx) => {
      remember(ctx);
      ensureOnce(ctx, "planner.leads", "", "leads:read");
      ensureOnce(ctx, "projects", "", "projects:read");
      const { esc, field, area, select, row, fmtDate } = ctx;
      const goal = wizard.id ? findGoal(ctx, wizard.id) : null;
      if (wizard.id && !goal) return null;
      const calendarDay = wizard.returnTo?.startsWith("#calendario") ? ctx.state.filters.calendario?.day : null;
      const sales = wizard.template === "ventas";
      const defaults = {
        title: goal?.title || (sales ? "Avanzar mi plan de ventas" : ""),
        category: goal?.category || (sales ? "sales" : "operation"),
        priority: goal?.priority || "normal",
        due: goal ? goal.due || "" : calendarDay || wizard.day || todayISO(),
        time: goal?.time || "",
        notes: goal?.notes || "",
        steps: sales ? "Elegir los prospectos prioritarios\nEnviar las propuestas\nProgramar los seguimientos" : "",
        reference: "", inspiration: "",
      };
      // Elegir una acción pendiente de la agenda rellena título, área y vínculo (solo al crear).
      const inspirations = goal ? [] : loadedAgenda(ctx.repo).filter(isOperationItem).filter((item) => item.date <= todayISO() || item.overdue).slice(0, 30);
      const picked = wizard.values?.inspiration && wizard.values.inspirationApplied !== wizard.values.inspiration ? inspirations.find((item) => `${item.type}:${item.id}` === wizard.values.inspiration) : null;
      if (picked) {
        const who = leadName(ctx, picked.id);
        const isLead = ["lead_next_action", "lead_review", "proposal_touch"].includes(picked.type);
        Object.assign(wizard.values, { title: (who ? `${picked.title} · ${who}` : picked.title).slice(0, 160), category: "sales", reference: isLead ? `lead:${picked.id}` : "", notes: `Viene de la agenda (${picked.typeLabel}). Vencimiento: ${fmtDate(picked.date, true)}.`, inspirationApplied: wizard.values.inspiration });
      }
      const v = { ...defaults, ...wizard.values };
      const references = refOptions(ctx);
      const ref = goal ? refInfo(ctx.repo, goal.refType, goal.refId) : null;
      const categories = Object.entries(GOAL_CATEGORY_LABELS);
      const priorities = Object.entries(GOAL_PRIORITY_LABELS);
      const stepsList = String(v.steps).split("\n").map((line) => line.trim()).filter(Boolean);
      return {
        kicker: "Mi plan", title: goal ? "Afiná tu meta." : "Dale forma a tu próximo logro.", intro: "Una intención clara. Pasos que podés completar. Un día con dirección.", submit: goal ? "Guardar cambios" : "Crear meta",
        values: v,
        steps: [
          ["Intención", "¿Qué querés lograr?",
            (inspirations.length ? select("inspiration", "Elegir una acción pendiente de la agenda · opcional", inspirations.map((item) => [`${item.type}:${item.id}`, `${item.title}${leadName(ctx, item.id) ? ` · ${leadName(ctx, item.id)}` : ""} (${item.typeLabel})`]), v.inspiration, "Escribir mi propia meta").replace("<select", "<select data-rerender") : "")
            + field("title", "Meta", "text", v.title, 'required maxlength="160" placeholder="Ej. Dejar lista la propuesta de la clínica"')
            + row(select("category", "Área", categories, v.category), select("priority", "Prioridad", priorities, v.priority))
            + area("notes", "Contexto o resultado esperado · opcional", v.notes, 'maxlength="2000" rows="3"')
            + (v.category === "personal" ? '<p class="pt-fine">Una meta personal la ves solo vos: no aparece en la agenda ni en la lista de nadie más.</p>' : "")],
          ["Plan", "Los pasos que te llevan ahí.",
            row(field("due", "Día de la meta · opcional", "date", v.due, ""), field("time", "Hora · opcional", "time", v.time, ""))
            + '<p class="pt-fine">La hora necesita un día. No se inventa ninguna: si no la sabés, dejala vacía.</p>'
            + (goal ? '<p class="pt-fine">Los pasos se agregan y se marcan desde la ficha de la meta.</p>' : area("steps", "Un paso por línea · opcional (hasta 50)", v.steps, 'rows="6" placeholder="Revisar el alcance\nArmar la propuesta\nEnviar al cliente"'))
            + (goal ? (ref ? `<p class="pt-fine">Vinculada a <a class="pt-link" style="min-height:0" href="${ref.href}">${esc(ref.kind)} · ${esc(ref.label)}</a>. El vínculo no se cambia después de crear la meta.</p>` : "")
              : (references.length ? select("reference", "Vincular a un prospecto o proyecto · opcional", references, v.reference, "Sin vínculo") : `<p class="pt-fine">${ctx.can("projects:read") || ctx.can("leads:read") ? "Cargando prospectos y proyectos para vincular…" : "Tu cuenta no puede leer prospectos ni proyectos, así que no se pueden vincular."}</p>`))],
          ["Revisión", "Todo listo para confirmar.", summaryList(ctx, [["Meta", v.title], ["Área / prioridad", `${GOAL_CATEGORY_LABELS[v.category] || v.category} · ${GOAL_PRIORITY_LABELS[v.priority] || v.priority}`], ["Día", v.due ? `${fmtDate(v.due, true)}${v.time ? ` · ${v.time}` : ""}` : "Sin fecha"], ["Pasos", goal ? `${goal.steps.length} (se editan en la ficha)` : stepsList.join(" · ") || "Meta simple"], ["Vínculo", references.find(([value]) => value === v.reference)?.[1] || ""], ["Contexto", v.notes]])],
        ],
      };
    },
  },

  // ---------- Diálogos ----------
  modals: {
    "goal-step-add": { markup(ctx, modal) {
      remember(ctx);
      const goal = findGoal(ctx, modal.id);
      return ctx.modalShell(goal?.title || "Meta", "Agregar un paso", "El paso queda al final de la lista. Si la meta ya estaba completa, no admite pasos nuevos: reabrila primero.", ctx.field("title", "Paso", "text", "", 'required maxlength="160" autocomplete="off"'), "Agregar paso", { live: true });
    } },
    "goal-cancel": { markup(ctx, modal) {
      remember(ctx);
      const goal = findGoal(ctx, modal.id);
      return ctx.modalShell(goal?.title || "Meta", "Cancelar esta meta", "La meta no se borra: queda como Cancelada y sale de las pendientes y de la agenda. Podés reabrirla desde su ficha.", checkbox("confirm", "Confirmo que quiero cancelar esta meta", { required: true }), "Cancelar meta", { live: true });
    } },
  },

  // ---------- Botones directos ----------
  actions: {
    /** El checkbox de un paso: el servidor decide si la meta se completa o se reabre. */
    "goal-step": async (ctx, { id, kind, button }) => {
      const done = Boolean(button?.checked);
      const before = findGoal(ctx, id);
      const response = await ctx.api.patch(`/admin/planner/goals/${id}/steps/${kind}`, stepSetBody(done).body);
      const status = response?.goal?.status;
      let message = done ? "Paso completado." : "Paso reabierto.";
      if (done && status === "done") message = "Último paso listo: la meta se completó.";
      if (!done && before?.status === "done" && status === "open") message = "Paso reabierto: la meta volvió a estar abierta.";
      return { message, refresh: plannerTargets(ctx.repo) };
    },
    /** Completar (solo metas sin pasos), reabrir o reactivar una cancelada. `kind` es el estado destino. */
    "goal-status": async (ctx, { id, kind }) => {
      const goal = findGoal(ctx, id);
      if (!goal) throw new FormError("No encontramos la meta. Volvé a Mi plan.");
      const body = unwrap(goalStatusBody(goal, kind));
      await ctx.api.patch(`/admin/planner/goals/${id}`, body);
      return { message: kind === "done" ? "Meta completada." : "Meta reabierta.", refresh: plannerTargets(ctx.repo) };
    },
  },

  // ---------- Envíos ----------
  mutations: {
    "new-goal": async (values, h) => {
      const me = h.api.admin?.id || null;
      if (h.target?.id) {
        const goal = (h.repo.data("planner.goals") || []).find((item) => item.id === h.target.id);
        if (!goal) throw new FormError("No encontramos la meta. Volvé a Mi plan y probá de nuevo.");
        const body = unwrap(goalPatchBody(values, goal, { me }));
        touchPlanner(h);
        await h.api.patch(`/admin/planner/goals/${goal.id}`, body);
        return { message: "Meta guardada.", goto: `#metas/${encodeURIComponent(goal.id)}` };
      }
      const body = unwrap(goalCreateBody(values));
      touchPlanner(h);
      let created;
      try { created = await h.api.post("/admin/planner/goals", body); } catch (error) { await uncertain(h, error, "la meta"); }
      return { message: body.steps?.length ? `Meta creada con ${body.steps.length} paso${body.steps.length === 1 ? "" : "s"}.` : "Meta creada.", goto: `#metas/${encodeURIComponent(created.goal.id)}` };
    },
    "goal-step-add": async (values, h) => {
      const body = unwrap(stepAddBody(values));
      touchPlanner(h);
      try { await h.api.post(`/admin/planner/goals/${h.modal.id}/steps`, body); } catch (error) { await uncertain(h, error, "el paso"); }
      return { message: "Paso agregado." };
    },
    "goal-cancel": async (values, h) => {
      if (!values.confirm) throw new FormError("Marcá la casilla para confirmar.");
      const goal = (h.repo.data("planner.goals") || []).find((item) => item.id === h.modal.id);
      if (!goal) throw new FormError("No encontramos la meta. Volvé a Mi plan.");
      touchPlanner(h);
      await h.api.patch(`/admin/planner/goals/${goal.id}`, unwrap(goalStatusBody(goal, "cancelled")));
      return { message: "Meta cancelada. Queda en «Canceladas»; no se borró." };
    },
  },
};

// ---------- Ficha de una meta ----------
function detail(ctx, id, write) {
  const { esc, icon, phaseGlyph, btn, fmtDate, meter, emptyState } = ctx;
  const goal = findGoal(ctx, id);
  if (!goal) return emptyState("Esta meta no está disponible", "Puede haberse cancelado, o es una meta personal de otra persona. Volvé a tu plan para elegir otra.", '<a class="pt-link" href="#metas">Volver a mi plan</a>');
  const p = goal.progress;
  const ref = refInfo(ctx.repo, goal.refType, goal.refId);
  const open = goal.status === "open";
  const editable = write && goal.status !== "cancelled";
  const a = `data-id="${esc(goal.id)}"`;
  const stepBlock = goal.steps.length
    ? `<ul class="goal-checklist">${goal.steps.map((step) => `<li data-done="${step.done}"><label><input type="checkbox" id="step-${esc(step.id)}" data-action="goal-step" ${a} data-kind="${esc(step.id)}" ${step.done ? "checked" : ""} ${write && goal.status !== "cancelled" ? "" : "disabled"}><span class="check-mark">${icon("check")}</span><span class="check-title"><span class="step-name">${esc(step.title)}</span>${step.doneAt ? `<small>Completado ${esc(stamp(step.doneAt))}</small>` : ""}</span></label></li>`).join("")}</ul>`
    : `<p class="pt-fine">Esta meta no tiene pasos.</p>`;
  const stateActions = [];
  if (write && goal.steps.length === 0 && goal.status === "open") stateActions.push(btn("goal-status", "Completar meta", "btn-primary", `${a} data-kind="done"`));
  if (write && goal.steps.length === 0 && goal.status === "done") stateActions.push(btn("goal-status", "Volver a abrir", "btn-ghost", `${a} data-kind="open"`));
  if (write && goal.status === "cancelled" && !(goal.steps.length && goal.steps.every((step) => step.done))) stateActions.push(btn("goal-status", "Reabrir meta", "btn-ghost", `${a} data-kind="open"`));
  return `
    <div class="pt-head-row"><div><div class="pt-kicker"><span class="label">${esc(goal.categoryLabel)} · ${goal.due ? `${fmtDate(goal.due, true)}${goal.time ? ` · ${esc(goal.time)}` : ""}` : "Sin fecha"}</span><span class="label">${esc(goal.statusLabel)}</span></div>
      <h1 class="display pt-title">${esc(goal.title)}</h1><p class="pt-company live-prewrap">${esc(goal.notes || "Cada paso que completás te acerca a la meta.")}</p></div>
      <div class="pt-head-actions">${editable ? btn("new-goal", "Editar meta", "btn-ghost", a) : ""}</div></div>
    <div class="goal-detail-grid"><section class="goal-checks" aria-labelledby="check-title">
      <div class="pt-section-head"><h2 class="pt-h2" id="check-title">Paso a paso</h2><span class="pt-count">${p.done}/${p.total}</span>${open && write ? btn("goal-step-add", `${icon("plus")} Paso`, "btn-ghost", a) : ""}</div>
      <div aria-live="polite">${stepBlock}</div>
      ${goal.steps.length && goal.status !== "cancelled" ? `<p class="pt-fine">${p.completed ? "Para reabrir la meta, desmarcá un paso." : "Cuando marques el último paso, la meta se completa sola."}</p>` : ""}
      <div class="pt-actions">${stateActions.join("")}</div>
      <a class="pt-link" href="#metas">${icon("back")} Volver a mi plan</a>
    </section>
    <aside class="goal-progress ticks"><div class="goal-orbit">${phaseGlyph(p.pct / 100, 88)}<span class="readout">${p.pct}<small>%</small></span></div>
      <span class="label">${goal.status === "done" ? "Meta completada" : goal.status === "cancelled" ? "Meta cancelada" : "En movimiento"}</span>
      <p>${goal.status === "done" ? "Hecho. Un paso más cerca." : goal.status === "cancelled" ? "Esta meta se canceló; no se borró." : p.total ? `Te quedan ${p.total - p.done} paso${p.total - p.done === 1 ? "" : "s"}.` : "Tu próximo logro empieza acá."}</p>${meter(p.pct)}
      <span class="pt-fine">${goal.completedAt ? `Completada el ${esc(stamp(goal.completedAt))}` : goal.steps.length ? "Al terminar todos los pasos, el servidor la completa." : "Sin pasos: la completás vos."}</span>
      ${ref ? `<a class="pt-link reference-link" href="${ref.href}">${icon("arrow")} ${esc(ref.kind)} · ${esc(ref.label)}</a>` : ""}
      <p class="pt-fine">${goal.mine ? "Es tuya." : "De otra persona del equipo."}${goal.category === "personal" ? " Personal: solo la ve su dueño." : ""} Creada ${esc(stamp(goal.createdAt))} · versión <span class="readout">${goal.version}</span></p>
      ${open && write ? btn("goal-cancel", "Cancelar meta", "btn-danger", a) : ""}
    </aside></div>`;
}
