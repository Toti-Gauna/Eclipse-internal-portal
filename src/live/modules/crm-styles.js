// Estilos propios de Prospectos y Lotes (live-crm.css). Se enlazan una sola vez, al cargar el modo live, para no tocar index.html
// (archivo compartido con las demás secciones). Si el navegador no puede cargarlos, las pantallas siguen funcionando con los estilos base.
let linked = false;

export function ensureCrmStyles() {
  if (linked || typeof document === "undefined") return;
  linked = true;
  if (document.querySelector('link[data-live-crm]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../../../live-crm.css", import.meta.url).href;
  link.dataset.liveCrm = "";
  document.head.append(link);
}
