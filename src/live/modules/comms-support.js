// Piezas compartidas por Comunicaciones, Documentos e Importaciones: hoja de estilos propia, escuchas sobre #app y marcas comunes.
// Los módulos no editan app.js: las interacciones que necesitan (cambiar un filtro, elegir un archivo) se enganchan desde acá.

let styled = false;
/** Carga live-comms.css la primera vez (no se toca index.html: tres ramas agregan módulos en paralelo). */
export function ensureStyles() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../../../live-comms.css", import.meta.url).href;
  link.dataset.liveComms = "";
  document.head.append(link);
}

const bound = new Set();
/** Una escucha delegada sobre #app por tipo+selector (idempotente). `handler(event, elementoQueCoincide)`. */
export function bindRoot(type, selector, handler) {
  if (typeof document === "undefined") return;
  const key = `${type}\u0000${selector}`;
  const root = document.getElementById("app");
  if (!root || bound.has(key)) return;
  bound.add(key);
  root.addEventListener(type, (event) => {
    const target = event.target?.closest?.(selector);
    if (target) handler(event, target);
  });
}

/** Ruta actual en la misma forma que routeInfo() de app.js: { view, id }. */
export function currentRoute() {
  const raw = (typeof window === "undefined" ? "" : window.location.hash).replace(/^#\/?/, "");
  const [view, id] = raw.split("/");
  return { view: view || "hoy", id: id ? decodeURIComponent(id) : "" };
}

export const checkbox = (esc, name, label, { checked = false, required = false, hint = "", id = "", attrs = "" } = {}) =>
  `<div class="pt-field live-check"><label><input type="checkbox" name="${name}" value="1"${id ? ` id="${esc(id)}"` : ""}${checked ? " checked" : ""}${required ? " required" : ""} ${attrs}> <span>${label}</span></label>${hint ? `<p class="pt-fine">${hint}</p>` : ""}</div>`;

export const tag = (esc, label, tone = "") => `<span class="pt-tag${tone ? ` pt-tag-${tone}` : ""}">${esc(label)}</span>`;

/** Guarda un Blob como archivo (descarga autenticada: el enlace es local y se revoca enseguida). */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Lee un archivo del usuario como texto (el navegador no lo sube a ningún lado hasta que se confirma). */
export const readFileText = (file) => file.text();

/** Paginación local: botones que usan el filtro `data-action="filter"` de app.js (cambia state.filters[grupo][nombre] y redibuja). */
export function pager(ctx, { group, name, page, pages, from, to, total }) {
  const { btn, icon } = ctx;
  const attrs = (target, disabled) => `data-id="${group}.${name}" data-kind="${target}" ${disabled ? "disabled" : ""}`;
  return `<nav class="li-pager" aria-label="Páginas"><span class="pt-fine" aria-live="polite">${from}–${to} de ${total}</span><div class="lc-actions">${btn("filter", icon("back"), "btn-ghost icon-button", `${attrs(page - 1, page <= 1)} aria-label="Página anterior"`)}<span class="readout">${page} / ${pages}</span>${btn("filter", icon("arrow"), "btn-ghost icon-button", `${attrs(page + 1, page >= pages)} aria-label="Página siguiente"`)}</div></nav>`;
}

/** <select> con etiqueta que redibuja por el mecanismo de filtros de app.js (`data-filter="grupo.nombre"`). */
export function selectField(ctx, { id, label, list, selected = "", empty, filter = "", attrs = "", bare = false }) {
  // bare: sin etiqueta visible (la fila ya la tiene); el nombre accesible va en aria-label.
  const name = bare ? `aria-label="${ctx.esc(label)}"` : "";
  return `<div class="pt-field">${bare ? "" : `<label for="${ctx.esc(id)}">${ctx.esc(label)}</label>`}<select class="pt-input" id="${ctx.esc(id)}" ${name}${filter ? ` data-filter="${ctx.esc(filter)}"` : ""} ${attrs}>${ctx.options(list, selected, empty)}</select></div>`;
}
