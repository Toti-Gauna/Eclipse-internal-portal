// Secciones del portal que todavía no tienen contraparte conectada. En modo live muestran una pantalla honesta,
// no datos de ejemplo. Para conectar una (etapa 2): crear su módulo en esta carpeta, agregarlo a index.js y quitar su entrada de acá.
const pending = (id, label, nav, pendingText) => ({
  id, label, nav, status: "pending", pendingText, filters: {},
  prepare() {},
  render(ctx) { return ctx.pendingScreen(this); },
});

export default [
];
