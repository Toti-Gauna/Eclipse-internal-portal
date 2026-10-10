import { addDays, agenda, SOURCES, UNITS, PAYMENT_CONCEPTS, proposalOf, projectBalance, todayISO } from "./rules.js";
import { EVENT_TYPES, GOAL_CATEGORIES, localTime } from "./planner.js";

export const GENERATORS = new Set(["new-goal", "new-event", "new-prospect", "new-batch", "new-project", "new-payment", "new-subscription", "project-milestone", "project-update", "client-action"]);

export function generatorConfig(wizard, data, { field, area, select, row, esc, usd, fmtDate, liveWizard }) {
  // En modo live cada módulo aporta sus propios formularios (src/live/modules): no se usan los de demostración.
  const live = liveWizard?.(wizard);
  if (live !== undefined) return live;
  const today = todayISO();
  const time = localTime();
  const project = data.projects.find((item) => item.id === wizard.id);
  const prospect = data.prospects.find((item) => item.id === wizard.id);
  const batch = data.batches.find((item) => item.id === wizard.id);
  const goal = data.goals.find((item) => item.id === wizard.id);
  const event = data.calendarEvents.find((item) => item.id === wizard.id);
  const references = [...data.projects.map((item) => [`project:${item.id}`, `Proyecto · ${item.name}`]), ...data.prospects.filter((item) => !["perdido", "ganado"].includes(item.stage)).map((item) => [`prospect:${item.id}`, `Prospecto · ${item.name}`]), ...data.batches.filter((item) => !item.report).map((item) => [`batch:${item.id}`, `Lote · ${item.name}`])];
  let defaults = { recordDate: today, recordTime: time };
  switch (wizard.type) {
    case "new-goal": defaults = { ...defaults, title: goal?.title || (wizard.template === "ventas" ? "Avanzar mi plan de ventas" : ""), category: goal?.category || (wizard.template === "ventas" ? "Ventas" : "Operación"), priority: goal?.priority || "normal", due: goal?.due || wizard.day || today, time: goal?.time || "", notes: goal?.notes || "", steps: goal?.steps.map((step) => step.title).join("\n") || (wizard.template === "ventas" ? "Elegir los prospectos prioritarios\nEnviar las propuestas\nProgramar los seguimientos" : ""), reference: goal?.reference || "" }; break;
    case "new-event": defaults = { ...defaults, title: event?.title || (wizard.template === "foco" ? "Bloque de foco · prospección" : ""), type: event?.type || (wizard.template === "foco" ? "Bloque de foco" : "Llamada"), date: event?.date || wizard.day || today, time: event?.time || "09:00", duration: event?.duration || "30", notes: event?.notes || "", reference: event?.reference || "" }; break;
    case "new-prospect": defaults = { ...defaults, name: "", contact: "", source: batch ? "Lote" : "Upwork", unit: batch?.unit || "Agency", batchId: batch?.id || "", need: "", offer: "", createdAt: today, time }; break;
    case "new-batch": defaults = { ...defaults, name: "", vertical: "", unit: "Agency", demo: "", hypothesis: "", target: "10", sentAt: today, time: "09:00", signalDays: "2", closeDays: "7" }; break;
    case "new-project": {
      const total = prospect ? proposalOf(prospect)?.amount || "" : "";
      defaults = { ...defaults, name: prospect?.name || "", client: prospect?.name || "", service: "", unit: prospect?.unit || "Agency", total, deposit: total ? Math.round(total / 2) : "", date: today, time, deliveryEstimate: addDays(today, 21), maintenance: "0", notes: "", milestone: "Insumos y plan de trabajo listos", milestoneDue: addDays(today, 5) }; break;
    }
    case "new-payment": defaults = { ...defaults, amount: project ? projectBalance(project, data.payments) || "" : "", date: today, time, concept: project?.deliveredAt ? "Saldo" : "Otro", unit: project?.unit || "Agency", projectId: project?.id || "", note: "" }; break;
    case "new-subscription": defaults = { ...defaults, client: "", amount: "", unit: "Agency", since: today }; break;
    case "project-milestone": defaults = { ...defaults, title: project?.milestone?.title || "", owner: project?.milestone?.owner || "Eclipse", due: project?.milestone?.due || addDays(today, 7), time: project?.milestone?.time || "", deliveryEstimate: project?.deliveryEstimate || "", body: "" }; break;
    case "project-update": defaults = { ...defaults, title: "", body: "", date: today, time }; break;
    case "client-action": defaults = { ...defaults, title: "", date: today, time }; break;
  }
  const v = { ...defaults, ...wizard.values };
  const money = (name, label, min = 1) => field(name, label, "number", v[name], `required min="${min}" step="1"`);
  const units = () => select("unit", "Unidad Eclipse", UNITS, v.unit);
  const timestamps = (dateName = "date", timeName = "time", label = "Fecha de actividad") => row(field(dateName, label, "date", v[dateName]), field(timeName, "Hora local", "time", v[timeName]));
  const auditFields = () => timestamps("recordDate", "recordTime", "Fecha de registro");
  const referenceField = () => select("reference", "Vincular a la operación", references, v.reference, "Sin vínculo · personal");
  const summary = (...pairs) => `<dl class="generator-summary">${pairs.filter(([, value]) => value !== "" && value !== undefined).map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`;
  let config;
  switch (wizard.type) {
    case "new-goal": config = {
      kicker: "Mi plan", title: goal ? "Afiná tu meta." : "Dale forma a tu próximo logro.", intro: "Una intención clara. Pasos que podés completar. Un día con dirección.", submit: goal ? "Guardar cambios" : "Crear meta",
      steps: [
        ["Intención", "¿Qué querés lograr?", (goal ? "" : select("inspiration", "Elegir una acción pendiente · opcional", agenda(data).map((item) => [`${item.entity}:${item.id}:${item.kind}`, `${item.title} · ${item.name}`]), v.inspiration || "", "Escribir mi propia meta")) + field("title", "Meta del día", "text", v.title, 'required maxlength="180" placeholder="Ej. Dejar lista la propuesta de la clínica"') + row(select("category", "Área", GOAL_CATEGORIES, v.category), select("priority", "Prioridad", [["normal", "Normal"], ["alta", "Alta"]], v.priority)) + area("notes", "Contexto o resultado esperado", v.notes)],
        ["Plan", "Los pasos que te llevan ahí.", row(field("due", "Día de la meta", "date", v.due), field("time", "Hora · opcional", "time", v.time, "")) + area("steps", "Un paso por línea · opcional", v.steps, 'rows="6" placeholder="Revisar el alcance\nArmar la propuesta\nEnviar al cliente"') + referenceField()],
      ], review: summary(["Meta", v.title], ["Área / prioridad", `${v.category} · ${v.priority}`], ["Día", `${fmtDate(v.due, true)}${v.time ? ` · ${v.time}` : ""}`], ["Pasos", v.steps.split("\n").filter((line) => line.trim()).join(" · ") || "Meta simple"]),
    }; break;
    case "new-event": {
      const start = Number(v.time.split(":")[0]) * 60 + Number(v.time.split(":")[1]);
      const conflicts = data.calendarEvents.filter((item) => item.id !== event?.id && item.date === v.date && !item.completedAt && start < Number(item.time.split(":")[0]) * 60 + Number(item.time.split(":")[1]) + item.duration && start + Number(v.duration) > Number(item.time.split(":")[0]) * 60 + Number(item.time.split(":")[1]));
      config = { kicker: "Calendario", title: event ? "Ajustá tu agenda." : "Reservá tiempo para avanzar.", intro: "Una llamada, un hito o un bloque de foco. Todo tiene su lugar.", submit: event ? "Guardar evento" : "Agendar evento",
        steps: [
          ["Actividad", "¿Para qué reservás este espacio?", field("title", "Actividad", "text", v.title, 'required maxlength="180" placeholder="Ej. Llamada de propuesta · Clínica"') + select("type", "Tipo de actividad", EVENT_TYPES, v.type) + referenceField() + area("notes", "Notas / preparación", v.notes)],
          ["Horario", "Elegí el momento.", timestamps() + field("duration", "Duración · minutos", "number", v.duration, 'required min="5" max="1440" step="5"')],
        ], review: summary(["Actividad", v.title], ["Tipo", v.type], ["Cuándo", `${fmtDate(v.date, true)} · ${v.time}`], ["Duración", `${v.duration} minutos`]) + (conflicts.length ? `<p class="generator-warning">Este horario coincide con ${conflicts.map((item) => esc(item.title)).join(", ")}. Podés volver y ajustar la hora o mantener ambos eventos.</p>` : ""),
      }; break;
    }
    case "new-batch": config = { kicker: "Lotes", title: "La próxima conversación empieza acá.", intro: "Una vertical concreta, una demo que importa y un ciclo que podés ajustar.", submit: "Crear lote",
      steps: [
        ["Enfoque", "Elegí a quién querés llegar.", field("name", "Nombre del lote", "text", v.name, 'required placeholder="Gastronomía · agente de reservas"') + row(field("vertical", "Vertical", "text", v.vertical), units()) + field("target", "Objetivo de contactos", "number", v.target, 'required min="1" max="10000" step="1"')],
        ["Demo", "Una hipótesis que se puede probar.", field("demo", "Demo base", "text", v.demo, 'required placeholder="Demo base — Agente de atención"') + area("hypothesis", "Qué querés validar", v.hypothesis, 'placeholder="Problema, oferta y señal de interés que esperás"')],
        ["Cadencia", "Tu ciclo de seguimiento.", timestamps("sentAt", "time", "D0 · fecha de envío") + row(field("signalDays", "Leer señal · días desde D0", "number", v.signalDays, 'required min="1" max="89" step="1"'), field("closeDays", "Cerrar informe · días desde D0", "number", v.closeDays, 'required min="2" max="90" step="1"'))],
      ], review: summary(["Lote", v.name], ["Vertical / unidad", `${v.vertical} · ${v.unit}`], ["Demo", v.demo], ["Objetivo", `${v.target} contactos`], ["Envío", `${fmtDate(v.sentAt, true)} · ${v.time}`], ["Cadencia", `Señal +${v.signalDays} días · cierre +${v.closeDays} días`]),
    }; break;
    case "new-project": config = { kicker: "Proyectos", title: "Un buen comienzo cambia todo.", intro: "Registrá la seña y el alcance. El proyecto arranca en Preparación, con su primer hito definido.", submit: "Registrar seña y crear proyecto",
      steps: [
        ["Alcance", "Lo que acordaste entregar.", row(field("name", "Proyecto", "text", v.name), field("client", "Cliente", "text", v.client)) + field("service", "Servicio", "text", v.service, 'required placeholder="Agente de atención, web, automatización…"') + units() + area("notes", "Alcance acordado", v.notes, 'placeholder="Entregables y extra que no pidió"')],
        ["Seña", "Solo empieza cuando se cobra.", row(money("total", "Total acordado · USD"), money("deposit", "Seña cobrada · USD")) + timestamps("date", "time", "Fecha de cobro") + money("maintenance", "Mantenimiento · USD/mes", 0)],
        ["Primer hito", "Dale un punto de partida.", field("milestone", "Primer hito", "text", v.milestone) + row(field("milestoneDue", "Fecha del hito", "date", v.milestoneDue), field("deliveryEstimate", "Entrega estimada", "date", v.deliveryEstimate))],
      ], review: summary(["Proyecto / cliente", `${v.name} · ${v.client}`], ["Servicio", v.service], ["Acuerdo", `${usd(Number(v.total))} · seña ${usd(Number(v.deposit))}`], ["Cobro", `${fmtDate(v.date, true)} · ${v.time}`], ["Hito", `${v.milestone} · ${fmtDate(v.milestoneDue, true)}`], ["Entrega estimada", fmtDate(v.deliveryEstimate, true)]),
    }; break;
    case "new-prospect": config = { kicker: "Prospectos", title: "Una nueva oportunidad en órbita.", intro: "El contacto queda en el pipeline. Cuando responda, el sistema te recuerda el próximo paso.", submit: "Crear prospecto",
      steps: [
        ["Contacto", "¿Con quién vas a conversar?", field("name", "Negocio o persona", "text", v.name) + field("contact", "Contacto / canal", "text", v.contact, 'required placeholder="WhatsApp, email, Upwork…"') + row(select("source", "Fuente", SOURCES, v.source), units())],
        ["Oportunidad", "Qué necesita y qué podés ofrecer.", area("need", "Necesidad concreta", v.need, "required") + field("offer", "Oferta sugerida", "text", v.offer, 'placeholder="USD 600–900"') + select("batchId", "Lote", data.batches.filter((item) => !item.report).map((item) => [item.id, item.name]), v.batchId, "Sin lote") + timestamps("createdAt", "time", "Primer contacto")],
      ], review: summary(["Contacto", v.name], ["Canal", v.contact], ["Fuente / unidad", `${v.source} · ${v.unit}`], ["Necesidad", v.need], ["Primer contacto", `${fmtDate(v.createdAt, true)} · ${v.time}`]),
    }; break;
    case "new-payment": config = { kicker: "Cobros", title: "Lo que entró, bien registrado.", intro: "Fecha, hora y concepto. Un registro claro para tu operación.", submit: "Registrar cobro",
      steps: [
        ["Cobro", "El ingreso real.", row(money("amount", "Monto · USD"), select("concept", "Concepto", PAYMENT_CONCEPTS, v.concept)) + timestamps() + units()],
        ["Contexto", "Dónde se aplica.", select("projectId", "Proyecto", data.projects.map((item) => [item.id, item.name]), v.projectId, "Sin proyecto") + field("note", "Nota / medio de pago", "text", v.note, 'placeholder="Transferencia, moneda original…"')],
      ], review: summary(["Monto", usd(Number(v.amount))], ["Concepto / unidad", `${v.concept} · ${v.unit}`], ["Cuándo", `${fmtDate(v.date, true)} · ${v.time}`], ["Nota", v.note]),
    }; break;
    case "new-subscription": config = { kicker: "MRR", title: "Un ingreso que vuelve.", intro: "El abono suma al MRR mientras esté activo.", submit: "Crear abono",
      steps: [["Abono", "Una relación a largo plazo.", field("client", "Cliente · servicio", "text", v.client) + row(money("amount", "USD / mes"), units()) + field("since", "Activo desde", "date", v.since)], ["Registro", "Dejá constancia del alta.", auditFields()]], review: summary(["Cliente", v.client], ["Abono", `${usd(Number(v.amount))}/mes · ${v.unit}`], ["Desde", fmtDate(v.since, true)]),
    }; break;
    case "project-milestone": config = { kicker: project?.name || "Proyecto", title: "El próximo avance, con fecha.", intro: "Definí un hito concreto. Se suma a la agenda y al calendario.", submit: "Guardar hito",
      steps: [["Hito", "Qué sigue en el proyecto.", field("title", "Hito", "text", v.title) + select("owner", "Responsable", ["Eclipse", "Cliente", "Eclipse y cliente"], v.owner) + row(field("due", "Fecha estimada", "date", v.due), field("time", "Hora · opcional", "time", v.time, "")) + field("deliveryEstimate", "Entrega estimada del proyecto", "date", v.deliveryEstimate, "")], ["Registro", "Dejá el contexto en la bitácora.", area("body", "Detalle del hito", v.body) + auditFields()]], review: summary(["Hito", v.title], ["Responsable", v.owner], ["Fecha", `${fmtDate(v.due, true)}${v.time ? ` · ${v.time}` : ""}`]),
    }; break;
    case "project-update": config = { kicker: project?.name || "Proyecto", title: "Un avance que merece quedar escrito.", intro: "Registrá qué pasó y cuándo. El historial conserva el orden del proyecto.", submit: "Guardar actualización",
      steps: [["Avance", "Qué querés contar.", field("title", "Título", "text", v.title) + area("body", "Detalle", v.body)], ["Momento", "Cuándo ocurrió.", timestamps()]], review: summary(["Actualización", v.title], ["Detalle", v.body], ["Actividad", `${fmtDate(v.date, true)} · ${v.time}`]),
    }; break;
    case "client-action": config = { kicker: project?.name || "Proyecto", title: "Una acción clara para el cliente.", intro: "Si no responde en dos días, el sistema lo suma a Hoy.", submit: "Registrar acción",
      steps: [["Acción", "Qué necesitás para seguir.", field("title", "Qué tiene que hacer", "text", v.title, 'required placeholder="Aprobar, confirmar o enviar…"') + timestamps("date", "time", "Fecha del pedido")]], review: summary(["Acción", v.title], ["Pedido", `${fmtDate(v.date, true)} · ${v.time}`]),
    }; break;
  }
  if (!config) return null;
  return { ...config, values: v, steps: [...config.steps, ["Revisión", "Todo listo para confirmar.", config.review]] };
}

export function renderGenerator(wizard, data, helpers) {
  const { shell, esc, icon, phaseGlyph, btn } = helpers;
  const config = generatorConfig(wizard, data, helpers);
  if (!config) return shell('<a class="pt-link" href="#hoy">Volver al inicio</a>', "hoy");
  const step = Math.min(wizard.step, config.steps.length - 1);
  const last = step === config.steps.length - 1;
  const active = wizard.type === "new-batch" ? "lotes" : wizard.type === "new-project" || wizard.type.startsWith("project-") || wizard.type === "client-action" ? "proyectos" : wizard.type === "new-prospect" ? "prospectos" : wizard.type === "new-event" ? "calendario" : wizard.type === "new-payment" || wizard.type === "new-subscription" ? "cobros" : "hoy";
  return shell(`<div class="generator-back">${btn("wizard-cancel", `${icon("back")} Volver`, "btn-ghost") }<span class="label">${esc(config.kicker)}</span><span class="label">${step + 1} / ${config.steps.length}</span></div>
    <div class="generator-heading"><h1 class="display">${esc(config.title)}</h1><p class="pt-company">${esc(config.intro)}</p></div>
    <ol class="generator-steps" aria-label="Pasos del generador">${config.steps.map(([label], index) => `<li data-status="${index < step ? "done" : index === step ? "current" : "pending"}" ${index === step ? 'aria-current="step"' : ""}><span>${index < step ? icon("check") : String(index + 1).padStart(2, "0")}</span><b>${label}</b></li>`).join("")}</ol>
    <div class="generator-layout"><form class="pt-form generator-form" data-form="wizard"><div class="generator-section-head"><span class="label">${last ? "Revisión final" : `Paso ${step + 1} · ${esc(config.steps[step][0])}`}</span><h2>${esc(config.steps[step][1])}</h2></div>
      ${config.steps[step][2]}<p class="form-error" role="alert" id="wizard-error"></p>
      <div class="generator-footer">${step > 0 ? btn("wizard-prev", `${icon("back")} Paso anterior`, "btn-ghost") : btn("wizard-cancel", "Cancelar", "btn-ghost")}<button class="btn btn-primary" type="submit">${esc(last ? config.submit : "Continuar")}${icon(last ? "check" : "arrow")}</button></div>
    </form><aside class="generator-aside ticks"><span class="label">Eclipse · Operación</span><div class="generator-phase">${phaseGlyph((step + 1) / config.steps.length, 94)}</div><p class="display">Pequeños pasos.<br><em>Grandes avances.</em></p><p class="pt-fine">${last ? "Revisá los datos antes de guardar. Podés volver a cualquier paso para ajustarlos." : "Cada decisión deja más claro el próximo movimiento. Tus datos se guardan al confirmar el último paso."}</p><span class="generator-aside-code">${String(step + 1).padStart(2, "0")} — ${String(config.steps.length).padStart(2, "0")}</span></aside></div>`, active);
}
