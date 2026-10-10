// Secciones del portal que todavía no tienen contraparte conectada. En modo live muestran una pantalla honesta,
// no datos de ejemplo. Para conectar una (etapa 2): crear su módulo en esta carpeta, agregarlo a index.js y quitar su entrada de acá.
const pending = (id, label, nav, pendingText) => ({
  id, label, nav, status: "pending", pendingText, filters: {},
  prepare() {},
  render(ctx) { return ctx.pendingScreen(this); },
});

export default [
  pending("prospectos", "Prospectos", { order: 30, area: "main" }, "El pipeline se conecta con los leads del servidor (leads:read)."),
  pending("lotes", "Lotes", { order: 35, area: "main" }, "Los lotes de prospección se conectan con los lotes del servidor (leads:read)."),
];
