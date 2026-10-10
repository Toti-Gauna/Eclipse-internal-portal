// Piezas visuales comunes del modo live. Usan las mismas clases y primitivas del portal (styles.css / workspace.css).
import { ApiError } from "../api/errors.js";

export function createLiveUi({ esc, icon, phaseGlyph, btn }) {
  const loading = (label = "Cargando…") => `<div class="pt-empty live-loading" role="status" aria-busy="true">${phaseGlyph(0.5, 28)}<p class="pt-empty-title">${esc(label)}</p></div>`;

  const failure = (error, { slice, key = "", title = "No pudimos cargar esto" } = {}) => {
    const message = error instanceof ApiError ? error.describe() : "Algo falló al cargar los datos.";
    const retry = slice ? btn("live-retry", "Reintentar", "btn-ink", `data-id="${esc(slice)}" data-kind="${esc(key)}"`) : "";
    return `<div class="pt-empty live-error" role="alert">${phaseGlyph(0, 28)}<p class="pt-empty-title">${esc(title)}</p><p class="pt-empty-body">${esc(message)}</p>${retry}</div>`;
  };

  const forbidden = (permission, what = "esta sección") => `<div class="pt-empty live-forbidden">${phaseGlyph(0, 28)}<p class="pt-empty-title">Tu cuenta no tiene acceso a ${esc(what)}</p><p class="pt-empty-body">Falta el permiso <span class="readout">${esc(permission)}</span>. Se configura en el servidor, no desde el portal.</p></div>`;

  /** Dibuja un slice según su estado: cargando, error (con reintento) o los datos. */
  const entryView = (entry, { slice, key, label, render }) => {
    if (entry.status === "error") return failure(entry.error, { slice, key, title: label });
    if (entry.status !== "ready" || entry.data === undefined) return loading();
    const stale = entry.error ? `<p class="live-stale pt-fine" role="status">No pudimos actualizar estos datos: ${esc(entry.error instanceof ApiError ? entry.error.describe() : "error desconocido")}. Se muestra lo último que se cargó. ${btn("live-retry", "Reintentar", "btn-ghost", `data-id="${esc(slice)}" data-kind="${esc(key)}"`)}</p>` : "";
    return stale + render(entry.data);
  };

  const pendingScreen = (module, shell, crumbs) => shell(`${crumbs([["Operación", "#hoy"], [module.label]])}
    <div class="pt-kicker"><span class="label">Sin conectar todavía</span></div>
    <h1 class="display pt-title">${esc(module.label)}</h1>
    <section class="live-pending" aria-live="polite">${phaseGlyph(0.25, 36)}<div>
      <p class="pt-h2">Esta sección todavía no está conectada al servidor.</p>
      <p class="pt-company">${esc(module.pendingText || "Se conecta en la próxima etapa de la integración.")} Mientras tanto no se muestran datos de ejemplo ni cálculos locales: en modo live solo se ve lo que guarda el servidor.</p>
      <p class="pt-fine">El modo demostración (sin servidor) sigue disponible con los datos de ejemplo del navegador.</p>
      <p><a class="pt-link" href="#solicitudes">${icon("arrow")} Ir a Solicitudes</a> <a class="pt-link" href="#proyectos">${icon("arrow")} Ir a Proyectos</a></p>
    </div></section>`, module.id);

  return { loading, failure, forbidden, entryView, pendingScreen };
}
