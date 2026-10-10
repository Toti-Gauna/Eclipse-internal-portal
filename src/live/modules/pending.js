// Secciones del portal que todavía no tienen contraparte conectada. En modo live muestran una pantalla honesta,
// no datos de ejemplo. Para conectar una (etapa 2): crear su módulo en esta carpeta, agregarlo a index.js y quitar su entrada de acá.
const pending = (id, label, nav, pendingText) => ({
  id, label, nav, status: "pending", pendingText, filters: {},
  prepare() {},
  render(ctx) { return ctx.pendingScreen(this); },
});

export default [
  pending("calendario", "Calendario", { order: 20, area: "main" }, "Eventos, vencimientos y bloques de foco viven en el planificador del servidor (planner:read)."),
  pending("metas", "Mi plan", { order: 60, area: "menu", hint: "Metas y próximos pasos" }, "Las metas y sus pasos viven en el planificador del servidor (planner:read)."),
  pending("herramientas", "Herramientas", { order: 70, area: "menu", hint: "Ventas, capacidad y cobros" }, "Las calculadoras dependen de las metas por bimestre, que el servidor todavía no guarda."),
  pending("actividad", "Bitácora", { order: 80, area: "menu", hint: "Actividad y auditoría" }, "La bitácora se arma con la auditoría del servidor, que hoy se consulta por proyecto desde cada ficha."),
];
