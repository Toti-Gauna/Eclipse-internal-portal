// Herramientas: calculadoras de cuenta pura en el navegador (plan de ventas, capacidad semanal, reparto de cobros). Funcionan igual que en la
// demostración, sin servidor. Lo que cambia en live: no hay metas por bimestre ni MRR (el servidor no los guarda), así que el monto a cubrir
// lo escribe la persona; y «llevar al plan / al calendario» crea metas y eventos REALES en el servidor.
import { salesPlan } from "../../planner.js";
import { split } from "../../rules.js";
import { formatCents as money } from "../adapters/common.js";
import { remember } from "./planner-shared.js";

let started = false;
const usd = (value) => money(Math.round(Number(value || 0) * 100));

export default {
  id: "herramientas",
  label: "Herramientas",
  nav: { order: 70, area: "menu", hint: "Ventas, capacidad y cobros" },
  status: "live",
  filters: {},

  prepare(ctx) {
    remember(ctx);
    // En demo el monto a cubrir sale de la meta del bimestre; acá esa meta no existe: arranca vacío y lo completa quien usa la calculadora.
    if (!started) { started = true; ctx.state.calculator.gap = ""; }
  },

  render(ctx) {
    remember(ctx);
    const { shell, crumbs, esc, icon, btn, field, row } = ctx;
    const v = ctx.state.calculator;
    const write = ctx.can("planner:write");
    const plan = salesPlan({ gap: Number(v.gap), ticket: Number(v.ticket), conversion: Number(v.conversion) });
    const available = Math.max(0, Math.min(168, Number(v.hours) || 0));
    const prospecting = Math.round(available * 0.2 * 10) / 10;
    const blocked = (what) => `<p class="pt-fine live-note">Para ${what} hace falta <span class="readout">planner:write</span>, y tu cuenta no lo tiene. La calculadora sirve igual.</p>`;
    return shell(`${crumbs([["Operación", "#hoy"], ["Herramientas"]])}<div class="pt-kicker"><span class="label">Menos intuición · más claridad</span></div><h1 class="display pt-title">Los números de <em>tu próxima jugada.</em></h1><p class="pt-company">Simulá escenarios antes de comprometer tiempo. Las cuentas se hacen en tu navegador: no se envía nada hasta que lo llevás a tu plan o a tu calendario.</p>
      <div class="tools-grid"><section class="tool-card ticks"><span class="label">01 / Plan de ventas</span><h2 class="pt-h2">De la meta a las propuestas.</h2><p class="pt-fine">Escribí cuánto querés cubrir. El servidor no guarda metas por bimestre, así que ese monto lo ponés vos. La conversión es una hipótesis que podés ajustar.</p><div class="pt-form">${field("gap", "Monto a cubrir · USD", "number", v.gap, 'min="0" step="1" data-calc="gap"')}${row(field("ticket", "Ticket promedio · USD", "number", v.ticket, 'min="1" step="1" data-calc="ticket"'), field("conversion", "Propuestas que cierran · %", "number", v.conversion, 'min="1" max="100" step="1" data-calc="conversion"'))}</div><div class="tool-result" aria-live="polite">${plan ? `<span><b class="readout">${plan.sales}</b> ventas</span><span><b class="readout">${plan.proposals}</b> propuestas</span>` : '<p class="pt-fine">Completá el monto, un ticket mayor a cero y una conversión entre 1 y 100%.</p>'}</div>${v.gap !== "" && Number(v.gap) >= 0 ? `<p class="pt-fine">Cubrir ${usd(v.gap)} con tickets de ${usd(v.ticket)}.</p>` : ""}${write ? btn("new-goal", "Llevarlo a mi plan", "btn-ghost", 'data-template="ventas"') : blocked("crear la meta")}</section>
      <section class="tool-card ticks"><span class="label">02 / Capacidad semanal</span><h2 class="pt-h2">Vendé sin saturar tu agenda.</h2><p class="pt-fine">Reservá un mínimo del 20% para prospectar y dejá un 10% de margen operativo.</p><div class="pt-form">${field("hours", "Horas disponibles / semana", "number", v.hours, 'min="0" max="168" step="0.5" data-calc="hours"')}</div><div class="capacity-bar"><span style="width:20%"></span><span style="width:70%"></span><span style="width:10%"></span></div><dl class="capacity-values"><div><dt>Prospección · 20%</dt><dd>${prospecting} h</dd></div><div><dt>Proyectos · 70%</dt><dd>${Math.round(available * 0.7 * 10) / 10} h</dd></div><div><dt>Margen · 10%</dt><dd>${Math.round(available * 0.1 * 10) / 10} h</dd></div></dl>${write ? btn("new-event", "Reservar bloque de foco", "btn-ghost", 'data-template="foco"') : blocked("reservar el bloque")}</section>
      <section class="tool-card ticks"><span class="label">03 / Reparto de cobros</span><h2 class="pt-h2">Cada dólar, con destino.</h2><p class="pt-fine">Simulá el reparto 40 / 40 / 10 / 10 antes de registrar el cobro.</p><div class="pt-form">${field("amount", "Cobro a distribuir · USD", "number", v.amount, 'min="0" step="1" data-calc="amount"')}</div><dl class="capacity-values">${split(Number(v.amount) || 0).map((part) => `<div><dt>${esc(part.label)} · ${Math.round(part.share * 100)}%</dt><dd class="readout">${usd(part.amount)}</dd></div>`).join("")}</dl>${ctx.can("billing:write") ? btn("new-payment", "Registrar un cobro", "btn-ghost") : '<p class="pt-fine live-note">Para registrar el cobro hace falta <span class="readout">billing:write</span>.</p>'}</section>
      <section class="tool-card tools-note"><span class="label">Una rutina que sostiene el sistema</span><h2 class="display">Abrir. Priorizar.<br><em>Avanzar. Cerrar.</em></h2><ol><li>Elegí una meta de ventas y una de entrega.</li><li>Reservá sus bloques en el calendario.</li><li>Registrá cada contacto con fecha y hora.</li><li>Cerrá el día completando tus pasos.</li></ol><a class="pt-link" href="#metas">Abrir mi plan ${icon("arrow")}</a></section></div>`, "herramientas");
  },
};
