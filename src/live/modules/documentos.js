// Documentos de un proyecto: internos (solo administradores) o compartidos con el cliente. Los bytes viven en PostgreSQL del servidor y se
// descargan por la API autenticada (fetch → Blob → guardar): nunca hay un enlace público. Ver docs/documents.md del backend.
import { ApiError } from "../../api/errors.js";
import { dayOfInstant, shortId } from "../adapters/common.js";
import { ACCEPT, DOCUMENT_LIMIT_PER_PROJECT, DOC_KIND_LABELS, DOC_STATUS_LABELS, MEDIA, VISIBILITY_LABELS, adaptDocument, authorLabel, checkFile, documentErrorMessage, formatBytes, saveName } from "../adapters/documents.js";
import * as out from "../adapters/outbound-comms.js";
import { FormError, unwrap } from "../errors.js";
import { checkbox, ensureStyles, saveBlob, tag } from "./comms-support.js";

const { isUuid } = out;

const SHOWS = [["vigentes", "Vigentes"], ["archivados", "Archivados"], ["todos", "Todos"]];
const showFilter = { vigentes: (d) => d.status !== "archived", archivados: (d) => d.status === "archived", todos: () => true };

const projectOf = (ctx, id) => (ctx.repo.data("projects")?.list || []).find((project) => project.id === id) || null;
const documentOf = (ctx, projectId, id) => (ctx.repo.data("docs.project", projectId) || []).find((doc) => doc.id === id) || null;

async function sha256Hex(blob) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Traduce los fallos conocidos de un paso; lo desconocido se relanza. Siempre vuelve a pedir la lista (lo que se ve puede estar viejo). */
async function translate(error, step, h, projectId) {
  if (!(error instanceof ApiError)) throw error;
  const message = documentErrorMessage(error, step);
  if (!message) throw error;
  if ([409, 403, 400].includes(error.status)) await h.repo.refresh([["docs.project", projectId]]).catch(() => {});
  throw new FormError(message);
}

export default {
  id: "documentos",
  label: "Documentos",
  nav: { order: 50, area: "menu", hint: "Archivos de cada proyecto" },
  status: "live",
  permission: "documents:read",
  filters: { documentos: { show: "vigentes" } },

  slices: {
    "docs.project": {
      permission: "documents:read",
      forbiddenValue: [],
      load: async ({ api, signal }, projectId) => (await api.listAll(`/admin/projects/${projectId}/documents`, { key: "documents", maxPages: 4, signal })).items.map(adaptDocument),
    },
  },

  prepare(ctx, route) {
    ensureStyles();
    ctx.repo.ensure("projects").catch(() => {});
    if (isUuid(route.id)) {
      ctx.repo.ensure("docs.project", route.id, { force: true }).catch(() => {});
      ctx.repo.ensure("project", route.id).catch(() => {});
    }
  },

  render(ctx, route) {
    return isUuid(route.id) ? projectScreen(ctx, route.id) : picker(ctx);
  },

  projectLinks(ctx, project) {
    if (!ctx.can("documents:read")) return "";
    return `<a class="pt-link" href="#documentos/${encodeURIComponent(project.id)}">${ctx.icon("arrow")} Documentos del proyecto</a>`;
  },

  // ---------- Diálogos ----------
  modals: {
    "doc-create": { markup(ctx, modal) {
      const project = projectOf(ctx, modal.id);
      return ctx.modalShell(project?.name || "Proyecto", "Nuevo documento", "Se registra como <strong>interno</strong>: el cliente no lo ve hasta que lo muestres. PDF, PNG, JPEG o WebP, hasta 5 MB.", `
        ${ctx.field("title", "Título", "text", "", 'required maxlength="160" autocomplete="off"')}
        ${ctx.select("kind", "Tipo", Object.entries(DOC_KIND_LABELS), "other")}
        <div class="pt-field ld-file"><label for="m-file">Archivo</label><input id="m-file" name="file" type="file" accept="${ACCEPT}" required><span class="pt-fine">El nombre y el tipo del archivo quedan registrados tal cual. El servidor verifica que el contenido sea del tipo que dice ser.</span></div>
        <p class="pt-fine">Se crea el registro y enseguida se sube el archivo. Si la subida falla, el registro queda «sin archivo» para reintentar.</p>`, "Crear y subir", { live: true });
    } },
    "doc-upload": { markup(ctx, modal) {
      const doc = documentOf(ctx, modal.id, modal.kind);
      const label = MEDIA[doc?.mediaType]?.label || "archivo";
      return ctx.modalShell(doc?.title || "Documento", "Subir el archivo", `Este registro espera un <strong>${ctx.esc(label)}</strong> (${ctx.esc(doc?.fileName || "")}). El archivo se sube una sola vez.`, `
        <div class="pt-field ld-file"><label for="m-file">Archivo</label><input id="m-file" name="file" type="file" accept="${ctx.esc(doc?.mediaType || ACCEPT)}" required></div>`, "Subir", { live: true });
    } },
    "doc-rename": { markup(ctx, modal) {
      const doc = documentOf(ctx, modal.id, modal.kind);
      return ctx.modalShell(doc?.fileName || "Documento", "Cambiar el título", "Solo cambia el título. El archivo, su nombre y su contenido no se modifican.", ctx.field("title", "Título", "text", doc?.title || "", 'required maxlength="160" autocomplete="off"'), "Guardar", { live: true });
    } },
    "doc-visibility": { markup(ctx, modal) {
      const doc = documentOf(ctx, modal.id, modal.kind);
      const project = ctx.repo.data("project", modal.id);
      const share = modal.to === "client";
      if (share && !ctx.can("updates:send")) {
        return ctx.modalShell(doc?.title || "Documento", "Mostrar al cliente", "Mostrarle un archivo al cliente es una publicación, igual que una actualización: hace falta el permiso <span class=\"readout\">updates:send</span> además de <span class=\"readout\">documents:write</span>. Tu cuenta no lo tiene.", "", "", { live: true });
      }
      const people = project?.live?.members?.length;
      return ctx.modalShell(doc?.title || "Documento", share ? "Mostrar al cliente" : "Ocultar al cliente",
        share ? `Las personas con acceso al proyecto${people ? ` (${people})` : ""} van a poder <strong>descargar</strong> este archivo desde su portal. No ven el checksum, el autor ni las notas.` : "El cliente deja de verlo y de poder descargarlo. El archivo y su historial se conservan.",
        `<dl class="ld-facts"><div><dt>Archivo</dt><dd>${ctx.esc(doc?.fileName || "")}</dd></div><div><dt>Tamaño</dt><dd>${ctx.esc(formatBytes(doc?.sizeBytes))}</dd></div></dl>${share ? checkbox(ctx.esc, "confirm", "Confirmo que el cliente puede ver y descargar este archivo", { required: true }) : ""}`,
        share ? "Mostrar al cliente" : "Ocultar", { live: true });
    } },
    "doc-archive": { markup(ctx, modal) {
      const doc = documentOf(ctx, modal.id, modal.kind);
      return ctx.modalShell(doc?.title || "Documento", "Archivar", "Es <strong>definitivo</strong>: el cliente deja de verlo para siempre y el documento ya no se puede modificar. Los bytes se conservan y se pueden descargar desde acá.", `
        ${ctx.area("reason", "Motivo", "", 'required rows="3" maxlength="500"')}
        ${checkbox(ctx.esc, "confirm", "Entiendo que archivar no se puede deshacer", { required: true })}`, "Archivar", { live: true });
    } },
  },

  // ---------- Botones directos ----------
  actions: {
    /** Descarga autenticada: fetch → Blob → guardar. Comprueba el SHA-256 contra el que registró el servidor. */
    "doc-download": async (ctx, { id, kind }) => {
      const doc = documentOf(ctx, id, kind);
      if (!doc) throw new FormError("No encontramos el documento. Actualizá la pantalla.");
      const { blob } = await ctx.api.download(`/admin/documents/${doc.id}/content`);
      const hash = await sha256Hex(blob).catch(() => null);
      saveBlob(blob, saveName(doc));
      const verdict = !doc.sha256 ? "" : hash === null ? " No pudimos verificar el checksum en este navegador." : hash === doc.sha256 ? " El SHA-256 coincide con el que registró el servidor." : " ATENCIÓN: el SHA-256 no coincide con el registrado.";
      return { message: `Descargado: ${doc.fileName} (${formatBytes(blob.size)}).${verdict}`, refresh: [] };
    },
  },

  // ---------- Envíos ----------
  mutations: {
    async "doc-create"(values, h) {
      const projectId = h.target.id;
      if (!h.can("documents:write")) throw new FormError("Tu cuenta no puede crear documentos (falta documents:write).");
      const file = values.file;
      const checked = checkFile(file instanceof File ? file : null);
      if (checked.error) throw new FormError(checked.error);
      const body = unwrap(out.documentCreateBody({ title: values.title, kind: values.kind, fileName: checked.fileName, mediaType: checked.mediaType }));
      h.touch(["docs.project", projectId]);
      let doc;
      try {
        doc = adaptDocument((await h.api.post(`/admin/projects/${projectId}/documents`, body)).document);
      } catch (error) { await translate(error, "create", h, projectId); }
      try {
        const uploaded = adaptDocument((await h.api.upload(`/admin/documents/${doc.id}/content`, file, { contentType: checked.mediaType })).document);
        if (uploaded.status !== "active") throw new FormError("El servidor no dejó el documento activo. Actualizá la lista.");
      } catch (error) {
        // El registro ya existe: queda «sin archivo» y se puede reintentar desde la lista. No se finge éxito.
        await h.repo.refresh([["docs.project", projectId]]).catch(() => {});
        const reason = error instanceof FormError ? error.message : (error instanceof ApiError && documentErrorMessage(error, "upload")) || (error instanceof ApiError ? error.describe() : "Falló la subida.");
        throw new FormError(`El registro se creó pero el archivo NO se subió: ${reason} Queda como «Falta subir el archivo»: cerrá este diálogo y reintentá desde la lista.`);
      }
      return { message: "Documento subido. Es interno: el cliente no lo ve hasta que lo muestres." };
    },

    async "doc-upload"(values, h) {
      const projectId = h.target.id;
      const doc = documentOf(h, projectId, h.target.kind);
      if (!doc) throw new FormError("No encontramos el documento. Actualizá la pantalla.");
      const file = values.file;
      const checked = checkFile(file instanceof File ? file : null, { expectedType: doc.mediaType });
      if (checked.error) throw new FormError(checked.error);
      h.touch(["docs.project", projectId]);
      let uploaded;
      try {
        uploaded = adaptDocument((await h.api.upload(`/admin/documents/${doc.id}/content`, file, { contentType: doc.mediaType })).document);
      } catch (error) { await translate(error, "upload", h, projectId); }
      if (uploaded.status !== "active") throw new FormError("El servidor no dejó el documento activo. Actualizá la lista.");
      return { message: "Archivo subido." };
    },

    async "doc-rename"(values, h) {
      const projectId = h.target.id;
      const doc = documentOf(h, projectId, h.target.kind);
      if (!doc) throw new FormError("No encontramos el documento. Actualizá la pantalla.");
      const body = unwrap(out.documentRenameBody(values, doc));
      h.touch(["docs.project", projectId]);
      try { await h.api.patch(`/admin/documents/${doc.id}`, body); } catch (error) { await translate(error, "patch", h, projectId); }
      return { message: "Título guardado." };
    },

    async "doc-visibility"(values, h) {
      const projectId = h.target.id;
      const doc = documentOf(h, projectId, h.target.kind);
      if (!doc) throw new FormError("No encontramos el documento. Actualizá la pantalla.");
      const visibility = h.target.to === "client" ? "client" : "internal";
      const body = unwrap(out.documentVisibilityBody(doc, visibility, { confirmed: Boolean(values.confirm), canPublish: h.can("updates:send") }));
      h.touch(["docs.project", projectId]);
      let changed;
      try { changed = adaptDocument((await h.api.patch(`/admin/documents/${doc.id}`, body)).document); } catch (error) { await translate(error, "patch", h, projectId); }
      if (changed.visibility !== visibility) throw new FormError("El servidor no cambió la visibilidad. Actualizá la lista.");
      return { message: visibility === "client" ? "Compartido. Las personas del proyecto ya pueden descargarlo." : "Ahora es interno. El cliente ya no lo ve." };
    },

    async "doc-archive"(values, h) {
      const projectId = h.target.id;
      const doc = documentOf(h, projectId, h.target.kind);
      if (!doc) throw new FormError("No encontramos el documento. Actualizá la pantalla.");
      const body = unwrap(out.documentArchiveBody(values, doc));
      h.touch(["docs.project", projectId]);
      let archived;
      try { archived = adaptDocument((await h.api.post(`/admin/documents/${doc.id}/archive`, body)).document); } catch (error) { await translate(error, "archive", h, projectId); }
      if (archived.status !== "archived") throw new FormError("El servidor no archivó el documento. Actualizá la lista.");
      return { message: "Archivado. El cliente ya no lo ve; los bytes se conservan." };
    },
  },
};

// ---------- Pantallas ----------

function picker(ctx) {
  const { shell, crumbs, esc, entryView, emptyState } = ctx;
  const entry = ctx.repo.get("projects");
  const body = (data) => {
    const list = [...data.list].sort((a, b) => a.name.localeCompare(b.name));
    return list.length ? `<ul class="ld-picker">${list.map((project) => `<li><a href="#documentos/${encodeURIComponent(project.id)}"><span><span class="pt-row-name">${esc(project.name)}</span><span class="pt-meta">${esc(project.client || project.service)}</span></span><span class="pt-code">${esc(project.code)}</span></a></li>`).join("")}</ul>` : emptyState("Todavía no hay proyectos", "Los documentos cuelgan de un proyecto.", "");
  };
  return shell(`${crumbs([["Operación", "#hoy"], ["Documentos"]])}
    <div class="pt-kicker"><span class="label">Archivos</span></div>
    <h1 class="display pt-title">Documentos por <em>proyecto</em>.</h1>
    <p class="pt-company">Contratos, presupuestos, entregables. Cada archivo es <strong>interno</strong> hasta que decidas mostrárselo al cliente, y se descarga siempre por la sesión de administrador: no existen enlaces públicos.</p>
    ${entryView(entry, { slice: "projects", key: "", label: "No pudimos cargar los proyectos", render: body })}`, "documentos");
}

function projectScreen(ctx, projectId) {
  const { shell, crumbs, esc, icon, btn, phaseGlyph, entryView, emptyState, fmtDate } = ctx;
  const project = projectOf(ctx, projectId) || ctx.repo.data("project", projectId);
  const f = ctx.state.filters.documentos;
  const canWrite = ctx.can("documents:write") && ctx.can("projects:read");
  const entry = ctx.repo.get("docs.project", projectId);
  const me = ctx.admin?.id;
  const name = project?.name || `Proyecto #${shortId(projectId)}`;

  const body = (docs) => {
    const shown = docs.filter(showFilter[f.show] || showFilter.vigentes).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const shared = docs.filter((d) => d.clientVisible).length;
    const internal = docs.filter((d) => d.status !== "archived" && d.visibility === "internal").length;
    const pending = docs.filter((d) => d.status === "pending").length;
    const people = ctx.repo.data("project", projectId)?.live?.members?.length;
    const item = (d) => {
      const a = `data-id="${esc(projectId)}" data-kind="${esc(d.id)}"`;
      const buttons = [];
      if (d.status === "active" || d.status === "archived") if (ctx.can("documents:read")) buttons.push(btn("doc-download", "Descargar", "btn-ghost", a));
      if (canWrite && d.status !== "archived") {
        if (d.status === "pending") buttons.push(btn("doc-upload", "Subir el archivo", "btn-ink", a));
        if (d.status === "active" && d.visibility === "internal") buttons.push(ctx.can("updates:send") ? btn("doc-visibility", "Mostrar al cliente…", "btn-ink", `${a} data-to="client"`) : `<button class="btn btn-sm btn-ghost" type="button" disabled aria-describedby="ld-need-send">Mostrar al cliente…</button>`);
        if (d.status === "active" && d.visibility === "client") buttons.push(btn("doc-visibility", "Ocultar al cliente…", "btn-ghost", `${a} data-to="internal"`));
        buttons.push(btn("doc-rename", "Cambiar título", "btn-ghost", a), btn("doc-archive", "Archivar…", "btn-danger", a));
      }
      const visibility = d.status === "archived" ? "Archivado · el cliente no lo ve" : d.status === "pending" ? "Sin archivo · el cliente no lo ve" : VISIBILITY_LABELS[d.visibility];
      return `<li class="ld-item"${d.clientVisible ? " data-shared" : ""}${d.status === "archived" ? " data-archived" : ""}>
        <div>
          <p class="ld-title">${esc(d.title)}</p>
          <p class="ld-visibility" ${d.clientVisible ? 'data-shared' : ""}>${phaseGlyph(d.clientVisible ? 0.1 : 1, 18)}<span>${esc(visibility)}</span></p>
          <p class="lc-flags" style="margin-top:8px">${tag(esc, DOC_KIND_LABELS[d.kind] || d.kind)}${tag(esc, DOC_STATUS_LABELS[d.status], d.status === "pending" ? "attn" : d.status === "archived" ? "out" : "ok")}${tag(esc, MEDIA[d.mediaType]?.label || d.mediaType, "out")}</p>
        </div>
        <dl class="ld-facts">
          <div><dt>Archivo</dt><dd>${esc(d.fileName)}</dd></div>
          <div><dt>Tamaño</dt><dd>${d.sizeBytes === null ? "Sin archivo" : esc(formatBytes(d.sizeBytes))}</dd></div>
          <div><dt>Registrado</dt><dd>${esc(fmtDate(dayOfInstant(d.createdAt), true))} por ${esc(authorLabel(d.createdBy, me))}</dd></div>
          ${d.uploadedAt ? `<div><dt>Subido</dt><dd>${esc(fmtDate(dayOfInstant(d.uploadedAt), true))}</dd></div>` : ""}
          ${d.archivedAt ? `<div><dt>Archivado</dt><dd>${esc(fmtDate(dayOfInstant(d.archivedAt), true))} · ${esc(d.archiveReason)}</dd></div>` : ""}
          ${d.sha256 ? `<div><dt>SHA-256 (lo calculó el servidor al recibirlo)</dt><dd class="ld-hash">${esc(d.sha256)}</dd></div>` : ""}
        </dl>
        ${buttons.length ? `<div class="lc-actions">${buttons.join("")}</div>` : ""}
      </li>`;
    };
    return `<dl class="pt-overview" style="--cols:3">
        <div><dt>Compartidos con el cliente</dt><dd><span class="pt-big">${shared}</span><span class="pt-fine">${people ? `Los ven ${people} persona${people === 1 ? "" : "s"} con acceso.` : "Solo activos y compartidos."}</span></dd></div>
        <div><dt>Internos</dt><dd><span class="pt-big">${internal}</span><span class="pt-fine">Solo administradores. El cliente no sabe que existen.</span></dd></div>
        <div><dt>Sin archivo</dt><dd><span class="pt-big">${pending}</span><span class="pt-fine">Registros creados que esperan su archivo.</span></dd></div>
      </dl>
      ${!ctx.can("updates:send") && canWrite ? `<p class="pt-fine live-note" id="ld-need-send">Mostrar un archivo al cliente es una publicación: tu cuenta no tiene <span class="readout">updates:send</span>, así que solo podés cargarlos como internos.</p>` : ""}
      <div class="pt-filters"><div class="pt-seg" role="group" aria-label="Mostrar">${SHOWS.map(([key, label]) => `<button type="button" data-action="filter" data-id="documentos.show" data-kind="${key}" aria-pressed="${f.show === key}">${label} <span class="pt-count">${docs.filter(showFilter[key]).length}</span></button>`).join("")}</div></div>
      ${shown.length ? `<ul class="ld-list">${shown.map(item).join("")}</ul>` : emptyState(docs.length ? "Nada en esta vista" : "Este proyecto no tiene documentos", "Cada documento nace interno y sin compartir.", canWrite ? btn("doc-create", `${icon("plus")} Nuevo documento`, "btn-ink", `data-id="${esc(projectId)}"`) : "")}
      <p class="pt-fine live-note">Límites del servidor: 5 MB por archivo, ${DOCUMENT_LIMIT_PER_PROJECT} por proyecto. Solo PDF, PNG, JPEG o WebP, verificados por su contenido. No hay antivirus ni versiones: un archivo nuevo es otro documento.</p>`;
  };

  return shell(`${crumbs([["Operación", "#hoy"], ["Documentos", "#documentos"], [name]])}
    <div class="pt-head-row"><div>
      <div class="pt-kicker"><span class="label">Archivos del proyecto</span></div>
      <h1 class="display pt-title">${esc(name)}</h1>
      <p class="pt-company">Un archivo interno no lo ve nadie fuera de Eclipse. Uno compartido lo ven las personas con acceso al proyecto, y solo mientras esté activo.</p>
    </div><div class="pt-head-actions">${canWrite ? btn("doc-create", `${icon("plus")} Nuevo documento`, "btn-primary", `data-id="${esc(projectId)}"`) : `<span class="pt-fine">Crear documentos requiere <span class="readout">documents:write</span>.</span>`}<a class="btn btn-sm btn-ghost" href="#proyectos/${encodeURIComponent(projectId)}">Ver proyecto</a></div></div>
    ${entryView(entry, { slice: "docs.project", key: projectId, label: "No pudimos cargar los documentos", render: body })}`, "documentos");
}
