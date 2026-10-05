import { addDays, todayISO } from "../rules.js";

// Datos de ejemplo con la forma real de la operación (fuentes, demos base, rangos de precio).
// Ningún nombre corresponde a un cliente real. Las fechas son relativas al día en que se cargan.

export const SETTINGS = {
  mrrGoal: 2500,
  bimesters: [
    { id: "B1", label: "B1 · oct–nov 2026", start: "2026-10-01", end: "2026-11-30", goals: { Agency: 20000 } },
    { id: "B2", label: "B2 · dic 2026–ene 2027", start: "2026-12-01", end: "2027-01-31", goals: { Agency: 11000, Media: 9000 } },
    { id: "B3", label: "B3 · feb–mar 2027", start: "2027-02-01", end: "2027-03-31", goals: { Agency: 9000, Media: 6000, Market: 5000 } },
  ],
};

export function buildSeed(today = todayISO()) {
  const d = (offset) => addDays(today, offset);
  const ev = (id, type, offset, note = "", extra = {}) => ({ id, type, date: d(offset), note, ...extra });

  const batches = [
    {
      id: "lote-gastro", name: "Gastronomía MdP · agente de atención", unit: "Agency", vertical: "Gastronomía",
      demo: "Demo base — Agente de atención (reservas y menú por WhatsApp)", sentAt: d(-2), signal: null, report: null,
    },
    {
      id: "lote-inmo", name: "Inmobiliarias · automatización documental", unit: "Agency", vertical: "Inmobiliarias",
      demo: "Demo base — Automatización documental (fichas y contratos)", sentAt: d(-9),
      signal: { date: d(-7), note: "1 de 2 respondió; interés en fichas automáticas." }, report: null,
    },
    {
      id: "lote-salud", name: "Consultorios · asistente de voz", unit: "Agency", vertical: "Salud",
      demo: "Demo base — Asistente de voz de recepción", sentAt: d(-20),
      signal: { date: d(-18), note: "Sin respuestas al D+2." },
      report: {
        date: d(-13),
        worked: "La demo con su nombre y horarios generó curiosidad en la llamada.",
        notWorked: "Nadie respondió por email; los consultorios atienden por WhatsApp.",
        change: "Próximo lote de salud: primer contacto por WhatsApp con video de 30 s.",
      },
    },
  ];

  const prospects = [
    {
      id: "p-constructora", name: "Constructora (AU) · web + CRM", contact: "Upwork · cliente verificado", unit: "Agency", source: "Upwork", batchId: null,
      need: "Web premium con journey de consultas, integración con monday CRM y atribución.", offer: "USD 2.400–4.000", stage: "propuesta", createdAt: d(-5),
      events: [ev("e1", "alta", -5, "Postulación enviada con demo de journey."), ev("e2", "respuesta", -4, "Pide llamada."), ev("e3", "llamada", -4, "Quiere lanzar en 6 semanas."), ev("e4", "propuesta", -3, "Propuesta v1: web + CRM, sin atribución avanzada.", { amount: 3200 })],
    },
    {
      id: "p-whitelabel", name: "Estudio digital (UK) · partner white-label", contact: "Upwork", unit: "Agency", source: "Upwork", batchId: null,
      need: "Partner técnico para sitios de 5 páginas y apps bajo su marca.", offer: "USD 450–900 por sitio", stage: "respondio", createdAt: d(-2),
      events: [ev("e1", "alta", -2, "Postulación con 2 casos."), ev("e2", "respuesta", 0, "Respondió: quiere hablar hoy.")],
    },
    {
      id: "p-estetica", name: "Centro de estética · turnos", contact: "Dueña · WhatsApp", unit: "Agency", source: "Presencial", batchId: null,
      need: "Turnos y recordatorios automáticos; hoy los maneja a mano.", offer: "USD 900–1.400", stage: "llamada", createdAt: d(-3),
      events: [ev("e1", "alta", -3, "Contacto en evento de comercio local."), ev("e2", "respuesta", -1, ""), ev("e3", "llamada", -1, "Pierde ~6 turnos por semana por no confirmar.")],
    },
    {
      id: "p-cafe", name: "Café del Puerto", contact: "Encargado · WhatsApp", unit: "Agency", source: "Lote", batchId: "lote-gastro",
      need: "Responder reservas y menú fuera de horario.", offer: "USD 600–900", stage: "respondio", createdAt: d(-2),
      events: [ev("e1", "alta", -2, "Demo personalizada enviada."), ev("e2", "respuesta", -1, "Le gustó la demo; pregunta precio.")],
    },
    {
      id: "p-panaderia", name: "Panadería de barrio", contact: "WhatsApp", unit: "Agency", source: "Lote", batchId: "lote-gastro",
      need: "Pedidos para eventos por WhatsApp.", offer: "USD 600–900", stage: "contactado", createdAt: d(-2), events: [ev("e1", "alta", -2, "Demo personalizada enviada.")],
    },
    {
      id: "p-parrilla", name: "Parrilla costera", contact: "Instagram", unit: "Agency", source: "Lote", batchId: "lote-gastro",
      need: "Reservas de fin de semana.", offer: "USD 600–900", stage: "contactado", createdAt: d(-2), events: [ev("e1", "alta", -2, "Demo personalizada enviada.")],
    },
    {
      id: "p-propiedades", name: "Propiedades Sur", contact: "Martillero · email", unit: "Agency", source: "Lote", batchId: "lote-inmo",
      need: "Generar fichas de propiedades y borradores de contrato.", offer: "USD 800–1.200", stage: "propuesta", createdAt: d(-9),
      events: [ev("e1", "alta", -9, "Demo enviada."), ev("e2", "respuesta", -7, ""), ev("e3", "llamada", -7, ""), ev("e4", "propuesta", -5, "Fichas + contratos.", { amount: 900 }), ev("e5", "toque", -3, "Toque 1 por WhatsApp.")],
    },
    {
      id: "p-inmofaro", name: "Inmobiliaria del Faro", contact: "email", unit: "Agency", source: "Lote", batchId: "lote-inmo",
      need: "Fichas automáticas.", offer: "USD 800–1.200", stage: "contactado", createdAt: d(-9), events: [ev("e1", "alta", -9, "Demo enviada.")],
    },
    {
      id: "p-inmocosta", name: "Inmobiliaria Costa", contact: "Socio · referido de cliente", unit: "Agency", source: "Referido", batchId: null,
      need: "Agente que precalifique consultas de alquiler.", offer: "USD 1.200–1.800", stage: "propuesta", createdAt: d(-11),
      events: [ev("e1", "alta", -11, "Referido por cliente actual."), ev("e2", "respuesta", -10, ""), ev("e3", "llamada", -10, ""), ev("e4", "propuesta", -9, "Agente de precalificación.", { amount: 1500 }), ev("e5", "toque", -7, ""), ev("e6", "toque", -4, "Dice que lo ve con su socio.")],
    },
    {
      id: "p-taller", name: "Taller mecánico", contact: "WhatsApp", unit: "Agency", source: "Comunidad", batchId: null,
      need: "Avisos de service y presupuestos.", offer: "USD 500–800", stage: "pausado", createdAt: d(-14),
      events: [ev("e1", "alta", -14, "Grupo de comerciantes."), ev("e2", "respuesta", -13, ""), ev("e3", "pausa", -6, "Retoma después de temporada.", { reviewDate: d(5), prevStage: "respondio" })],
    },
    {
      id: "p-odonto", name: "Consultorio odontológico", contact: "email", unit: "Agency", source: "Lote", batchId: "lote-salud",
      need: "Recepción de llamadas fuera de horario.", offer: "USD 700–1.000", stage: "perdido", createdAt: d(-20),
      events: [ev("e1", "alta", -20, "Demo enviada."), ev("e2", "perdido", -13, "Sin respuesta tras el cierre del lote.")],
    },
    {
      id: "p-ropa", name: "Tienda de ropa online", contact: "Dueño · referido", unit: "Agency", source: "Referido", batchId: null,
      need: "Rehacer tienda con catálogo, carrito y agente de consultas.", offer: "USD 2.000–2.800", stage: "ganado", createdAt: d(-12),
      events: [ev("e1", "alta", -12, ""), ev("e2", "respuesta", -11, ""), ev("e3", "llamada", -11, ""), ev("e4", "propuesta", -10, "", { amount: 2400 }), ev("e5", "seña", -4, "Seña 50%.", { amount: 1200 })],
    },
    {
      id: "p-reel", name: "Marca de indumentaria · reels", contact: "Instagram", unit: "Media", source: "Comunidad", batchId: null,
      need: "4 reels mensuales con edición.", offer: "USD 250 por pack", stage: "contactado", createdAt: d(-1), events: [ev("e1", "alta", -1, "Mensaje directo con muestra.")],
    },
  ];

  const projects = [
    {
      id: "pr-ropa", prospectId: "p-ropa", name: "Tienda de ropa · e-commerce", client: "Tienda de ropa online", unit: "Agency",
      stage: "build", total: 2400, startedAt: d(-4), deliveryDate: d(10), deliveredAt: null, paidAt: null,
      notes: "Catálogo + carrito + agente de consultas. Extra sin pedir: guía de talles con IA.",
    },
    {
      id: "pr-clinica", prospectId: null, name: "Clínica · turnos por WhatsApp", client: "Clínica (referido)", unit: "Agency",
      stage: "cobro", total: 1800, startedAt: d(-15), deliveryDate: d(-1), deliveredAt: d(-1), paidAt: null,
      notes: "Entregado y capacitado. Mantenimiento mensual contratado.",
    },
    {
      id: "pr-contable", prospectId: null, name: "Estudio contable · automatización documental", client: "Estudio contable", unit: "Agency",
      stage: "referido", total: 1200, startedAt: d(-25), deliveryDate: d(-5), deliveredAt: d(-5), paidAt: d(-2),
      notes: "Cobrado completo.",
    },
  ];

  const payments = [
    { id: "c1", date: d(-4), amount: 1200, unit: "Agency", projectId: "pr-ropa", concept: "Seña", note: "Transferencia" },
    { id: "c2", date: d(-3), amount: 900, unit: "Agency", projectId: "pr-clinica", concept: "Seña", note: "" },
    { id: "c3", date: d(-25), amount: 600, unit: "Agency", projectId: "pr-contable", concept: "Seña", note: "" },
    { id: "c4", date: d(-2), amount: 600, unit: "Agency", projectId: "pr-contable", concept: "Saldo", note: "" },
    { id: "c5", date: d(-1), amount: 250, unit: "Media", projectId: null, concept: "Otro", note: "Edición de reel puntual" },
  ];

  const subscriptions = [
    { id: "s1", client: "Clínica · mantenimiento", unit: "Agency", amount: 120, since: d(-1), active: true },
  ];

  return { version: 1, settings: SETTINGS, prospects, batches, projects, payments, subscriptions };
}
