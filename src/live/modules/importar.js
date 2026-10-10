// Importar el respaldo del portal de demostración al servidor, con revisión previa. Reemplaza el viejo diálogo «Datos» del modo live.
// Flujo (docs/imports.md del backend): elegir el .json → el servidor lo revisa SIN escribir nada → decidir (cliente de cada proyecto, tipo de
// cada cobro, parecidos, seguimiento) → confirmación final → informe. El navegador no se toca: ni localStorage ni el archivo original.
import { ApiError } from "../../api/errors.js";
import { formatCents, shortId } from "../adapters/common.js";
import { CREATED_LABELS, KIND_LABELS, KIND_ORDER, KIND_SINGULAR, PAGE_SIZE, PAYMENT_KIND_CHOICES, STATUS_LABELS, STATUS_ORDER, STATUS_TONE, adaptImport, decisionsFromFlat, expectedCounts, filterItems, importErrorMessage, paginate, projectSlots, requiredDecisions, summaryRows } from "../adapters/imports.js";
import * as out from "../adapters/outbound-comms.js";
import { FormError, unwrap } from "../errors.js";
import { bindRoot, checkbox, ensureStyles, pager, selectField, tag } from "./comms-support.js";

const PREVIEW_PERMISSIONS = ["imports:run", "leads:read", "projects:read", "billing:read", "planner:read"];
const COMMIT_PERMISSIONS = [...PREVIEW_PERMISSIONS, "leads:write", "projects:write", "billing:write", "planner:write"];
const LIST_LIMIT = 20;

const DEFAULT_FILTERS = { kind: "", status: "", page: "1", followUpOn: "", ack: "", bulk: "", reportFilter: "created", reportPage: "1", noop: "" };

// El archivo elegido y los clientes encontrados viven en memoria del módulo (nunca en storage).
let picked = null;
let forcedFor = "";
if (typeof window !== "undefined") window.addEventListener("hashchange", () => { forcedFor = ""; });
let pickedError = "";
let clients = [];
let lastImportId = "";
let filtersRef = null;

const missing = (ctx, list) => list.filter((permission) => !ctx.can(permission));

function resetDecisions(f) {
  for (const key of Object.keys(f)) if (/^[adk]\d+$/.test(key)) delete f[key];
  Object.assign(f, { ...DEFAULT_FILTERS });
  clients = [];
}

export default {
  id: "importar",
  label: "Importar",
  nav: { order: 56, area: "menu", hint: "Traer el respaldo de la demo" },
  status: "live",
  permission: "imports:run",
  filters: { importar: { ...DEFAULT_FILTERS } },

  slices: {
    "imports.list": {
      permission: "imports:run",
      forbiddenValue: { items: [], nextCursor: null },
      load: async ({ api, signal }) => {
        const page = await api.get("/admin/imports", { query: { limit: LIST_LIMIT }, signal });
        return { items: page.imports.map(adaptImport), nextCursor: page.nextCursor || null };
      },
      more: async ({ api }, _key, current) => {
        if (!current.nextCursor) return current;
        const page = await api.get("/admin/imports", { query: { limit: LIST_LIMIT, cursor: current.nextCursor } });
        const known = new Set(current.items.map((item) => item.id));
        return { items: [...current.items, ...page.imports.filter((item) => !known.has(item.id)).map(adaptImport)], nextCursor: page.nextCursor || null };
      },
    },
    "imports.item": {
      permission: "imports:run",
      load: async ({ api, signal }, id) => adaptImport((await api.get(`/admin/imports/${id}`, { signal, timeout: 60000 })).import),
    },
  },

  prepare(ctx, route) {
    ensureStyles();
    bindRoot("change", "[data-li-file]", (event, input) => {
      const file = input.files?.[0] || null;
      picked = file;
      pickedError = "";
      const status = document.getElementById("li-file-status");
      if (status) status.textContent = file ? `${file.name} · ${(file.size / 1024).toFixed(file.size < 10240 ? 1 : 0)} KB` : "Ningún archivo elegido.";
    });
    // Una casilla no pasa por el mecanismo de filtros de app.js (su valor no cambia): se guarda y se pide un redibujado con un evento sobre el campo oculto.
    bindRoot("change", "[data-li-check]", (event, input) => {
      ctx.state.filters.importar[input.dataset.liCheck] = input.checked ? "1" : "";
      document.getElementById("li-rerender")?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const f = ctx.state.filters.importar;
    filtersRef = f;
    if (route.id) {
      if (route.id !== lastImportId) { lastImportId = route.id; resetDecisions(f); }
      // Siempre se vuelve a pedir: el servidor recalcula la revisión contra la base de ahora.
      // Solo al entrar: un redibujado por un filtro o una casilla vuelve a llamar a prepare() y no tiene que pedir otra vez ni pisar lo que se está escribiendo.
      if (forcedFor !== route.id) {
        forcedFor = route.id;
        ctx.repo.ensure("imports.item", route.id, { force: true }).catch(() => {});
      } else ctx.repo.ensure("imports.item", route.id).catch(() => {});
    } else {
      lastImportId = "";
      ctx.repo.ensure("imports.list", "", { force: true }).catch(() => {});
    }
  },

  render(ctx, route) {
    return route.id ? importScreen(ctx, route.id) : startScreen(ctx);
  },

  // ---------- «Datos»: el diálogo del menú, ahora con la importación ----------
  modals: {
    data: { markup(ctx) {
      const canImport = ctx.can("imports:run");
      return ctx.modalShell("Datos", "Dónde viven tus datos", "En modo live todo se guarda en el servidor. Este portal no guarda copias de tu operación en el navegador: solo recuerda el tema claro u oscuro.", `
        <div class="pt-data-actions">
          ${canImport ? `<a class="btn btn-sm btn-ink" href="#importar">Importar el respaldo de la demostración</a>` : `<span class="pt-fine">Importar un respaldo requiere el permiso <span class="readout">imports:run</span>.</span>`}
          <button class="btn btn-sm btn-ghost" type="button" data-action="export-data">Descargar lo que se ve ahora (.json)</button>
        </div>
        <p class="pt-fine">La importación revisa el archivo en el servidor sin escribir nada, te deja decidir cada punto y recién después de tu confirmación lo guarda. Tu navegador no se modifica.</p>
        <p class="pt-fine">«Descargar lo que se ve ahora» es una copia de solo lectura de lo que el servidor devolvió y está cargado en pantalla. No es un respaldo del sistema: el respaldo vive en la base de datos.</p>`, "");
    } },
    "imp-commit": { markup(ctx, modal) {
      const imp = ctx.repo.data("imports.item", modal.id);
      const { esc } = ctx;
      if (!imp?.preview) return ctx.modalShell("Importación", "Confirmar", "", `<p class="pt-fine">No encontramos la revisión. Cerrá y actualizá la pantalla.</p>`, "", { live: true });
      const f = ctx.state.filters.importar;
      const decisions = decisionsFromFlat(imp.preview, f);
      const check = out.importCommitBody(imp.preview, { ...decisions, confirmed: true }, { knownClients: clients });
      const counts = expectedCounts(imp.preview, decisions);
      const lines = KIND_ORDER.filter((kind) => counts[kind]).map((kind) => `<li><span>${esc(KIND_LABELS[kind])}</span><span class="pt-leader"></span><span class="readout">${counts[kind]}</span></li>`).join("");
      const slots = projectSlots(imp.preview);
      const assigned = slots.map((slot, index) => ({ slot, choice: f[`a${index}`] })).filter(({ slot, choice }) => choice && (!slot.duplicateKey || decisions.duplicates[slot.duplicateKey] === "import"));
      const toClients = assigned.filter(({ choice }) => choice !== "internal").length;
      return ctx.modalShell("Importación · último paso", "Confirmar la importación", "Se escribe en el servidor en una sola operación: si algo falla, no queda nada. <strong>Desde el portal no se puede deshacer.</strong>", check.error ? `
        <p class="form-error" role="alert">${esc(check.error)}</p>` : `
        <div class="li-note"><p class="label">Según la revisión, se crearía</p><ul class="pt-ledger">${lines || "<li><span>Nada: no hay registros nuevos.</span></li>"}</ul>
          <p class="pt-fine">${assigned.length} proyecto${assigned.length === 1 ? "" : "s"}: ${toClients} con cliente asignado y ${assigned.length - toClients} solo interno${assigned.length - toClients === 1 ? "" : "s"}. Nada se publica al cliente.</p></div>
        <p class="lc-hash"><span class="label">Huella de la revisión que confirmás</span> ${esc(imp.preview.previewHash)}</p>
        <input type="hidden" name="seenHash" value="${esc(imp.preview.previewHash)}">
        ${checkbox(esc, "confirm", "Revisé lo que encontró el servidor y mis decisiones. Confirmo que se importe, sabiendo que no se puede deshacer desde el portal.", { required: true })}`,
      check.error ? "" : "Importar al servidor", { live: true });
    } },
  },

  actions: {
    "imp-upload": async (ctx) => {
      if (!picked) { pickedError = "Elegí el archivo del respaldo."; throw new FormError(pickedError); }
      const built = out.importFileBody(await picked.text(), { name: picked.name });
      if (built.error) { pickedError = built.error; throw new FormError(built.error); }
      pickedError = "";
      let imp;
      try {
        imp = adaptImport((await ctx.api.post("/admin/imports", built.body, { timeout: 60000 })).import);
      } catch (error) {
        const message = error instanceof ApiError ? importErrorMessage(error, "preview") : null;
        if (message) { pickedError = message; throw new FormError(message); }
        throw error;
      }
      ctx.repo.invalidate("imports.list");
      picked = null;
      window.location.hash = `#importar/${imp.id}`;
      return { message: imp.status === "committed" ? "Ese archivo ya se importó antes: te mostramos su informe." : "Respaldo cargado. Todavía no se escribió nada: revisá lo que encontró el servidor." };
    },

    /** Busca un cliente por email exacto (clients:read) para poder asignarle proyectos. No crea nada. */
    "imp-lookup": async (ctx, { button }) => {
      const email = (button.closest(".li-card")?.querySelector("#li-email")?.value || "").trim().toLowerCase();
      if (!email) throw new FormError("Escribí el email de la cuenta.");
      let found;
      try {
        found = (await ctx.api.post("/admin/clients/lookup", { email })).client;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) throw new FormError("No hay una cuenta de cliente verificada con ese email. El cliente tiene que registrarse y verificar su email primero.");
        if (error instanceof ApiError && error.status === 403) throw new FormError("Tu cuenta no puede buscar clientes (falta clients:read).");
        throw error;
      }
      if (!found.active || !found.emailVerified) throw new FormError("Esa cuenta está suspendida o sin verificar: el servidor no deja asignarle proyectos.");
      if (!clients.some((client) => client.id === found.id)) clients = [...clients, found];
      return { message: `Cliente agregado a las opciones: ${found.displayName || found.email}.` };
    },

    "imp-assign-all": async (ctx, { id }) => {
      const f = ctx.state.filters.importar;
      const imp = ctx.repo.data("imports.item", id);
      if (!imp?.preview) return null;
      if (!f.bulk) throw new FormError("Elegí primero a quién asignar.");
      const decisions = decisionsFromFlat(imp.preview, f);
      projectSlots(imp.preview).forEach((slot, index) => { if (!slot.duplicateKey || decisions.duplicates[slot.duplicateKey] === "import") f[`a${index}`] = f.bulk; });
      return { message: "Asignado a todos los proyectos. Podés cambiar cada uno." };
    },

    "imp-refresh": async (ctx, { id }) => {
      await ctx.repo.ensure("imports.item", id, { force: true });
      return { message: "Revisión actualizada contra lo que hay hoy en el servidor." };
    },
  },

  mutations: {
    async "imp-commit"(values, h) {
      const id = h.target.id;
      const before = h.repo.data("imports.item", id);
      if (!before?.preview) throw new FormError("No encontramos la revisión. Actualizá la pantalla.");
      const missingPermissions = COMMIT_PERMISSIONS.filter((permission) => !h.can(permission));
      if (missingPermissions.length) throw new FormError(`Tu cuenta no puede confirmar la importación. Faltan: ${missingPermissions.join(", ")}.`);
      h.touch(["imports.item", id]);
      h.touch(["imports.list", ""]);
      // La revisión se recalcula contra la base de ahora: si cambió desde que la viste, no se confirma a ciegas.
      const fresh = adaptImport((await h.api.get(`/admin/imports/${id}`, { timeout: 60000 })).import);
      if (fresh.status === "committed") return { message: "Esta importación ya estaba confirmada: te mostramos su informe." };
      if (!fresh.preview || fresh.preview.previewHash !== values.seenHash) {
        await h.repo.refresh([["imports.item", id]]).catch(() => {});
        throw new FormError("La revisión cambió desde que la miraste (el respaldo o la base se modificaron). Actualizamos la pantalla: revisala de nuevo antes de confirmar.");
      }
      const decisions = decisionsFromFlat(fresh.preview, filtersRef || {});
      const body = unwrap(out.importCommitBody(fresh.preview, { ...decisions, confirmed: Boolean(values.confirm) }, { knownClients: clients }));
      let done;
      try {
        done = adaptImport((await h.api.post(`/admin/imports/${id}/commit`, body, { timeout: 120000 })).import);
      } catch (error) {
        const message = error instanceof ApiError ? importErrorMessage(error, "commit") : null;
        if (error instanceof ApiError && error.status === 409) await h.repo.refresh([["imports.item", id]]).catch(() => {});
        if (message) throw new FormError(message);
        throw error;
      }
      if (done.status !== "committed" || !done.report) throw new FormError("El servidor no devolvió el informe de la importación. Actualizá la pantalla antes de volver a intentar: no repitas el envío a ciegas.");
      // Lo importado cambia proyectos, cobros y prospectos: nada de lo cargado antes sigue siendo cierto.
      h.repo.invalidateAll();
      return { message: "Importación confirmada. Este es el informe: tu navegador no se modificó.", goto: `#importar/${id}` };
    },
  },
};

// ---------- Pantallas ----------

function permissionsBox(ctx) {
  const { esc } = ctx;
  const row = (permission) => `<li><span class="readout">${esc(permission)}</span><span class="pt-leader"></span>${ctx.can(permission) ? tag(esc, "Tenés", "ok") : tag(esc, "Falta", "late")}</li>`;
  return `<details class="li-card"><summary class="pt-h2">Permisos que usa la importación</summary>
    <p class="pt-fine">Revisar necesita lectura de prospectos, proyectos, cobros y planificador. Confirmar necesita además escritura en esas cuatro áreas.</p>
    <ul class="pt-ledger">${COMMIT_PERMISSIONS.map(row).join("")}</ul></details>`;
}

function startScreen(ctx) {
  const { shell, crumbs, esc, btn, icon, entryView, fmtDate } = ctx;
  const lacking = missing(ctx, PREVIEW_PERMISSIONS);
  const entry = ctx.repo.get("imports.list");
  const list = (data) => data.items.length ? `<ul class="li-list">${data.items.map((item) => `<li><span><a class="pt-row-name" href="#importar/${encodeURIComponent(item.id)}">Importación #${esc(shortId(item.id))}</a><span class="pt-meta">${item.date ? esc(fmtDate(item.date, true)) : ""} · versión ${item.sourceVersion ?? "?"} · ${(item.payloadBytes / 1024).toFixed(0)} KB${item.example ? " · ejemplo" : ""}</span></span><span>${tag(esc, item.status === "committed" ? "Confirmada" : "Revisada, sin confirmar", item.status === "committed" ? "ok" : "attn")}</span></li>`).join("")}</ul>${data.nextCursor ? `<div class="lc-more">${btn("live-more", "Cargar más", "btn-ghost", 'data-id="imports.list" data-kind=""')}</div>` : ""}` : `<p class="pt-fine">Todavía no se importó ningún respaldo en este servidor.</p>`;
  return shell(`${crumbs([["Operación", "#hoy"], ["Importar"]])}
    <div class="pt-kicker"><span class="label">Del navegador al servidor</span></div>
    <h1 class="display pt-title">Traer el <em>respaldo</em>.</h1>
    <p class="pt-company">Es el archivo <span class="readout">.json</span> que descarga «Exportar respaldo» del portal en modo demostración. Primero el servidor lo <strong>revisa sin escribir nada</strong>; vos decidís cada punto; recién después lo guarda.</p>
    <ol class="li-steps" aria-label="Pasos"><li aria-current="step">1 · Elegir el archivo</li><li>2 · Revisar</li><li>3 · Decidir</li><li>4 · Confirmar</li><li>5 · Informe</li></ol>
    <div class="li-grid">
      <section class="li-card" aria-labelledby="li-upload-title"${lacking.length ? " data-danger" : ""}>
        <h2 id="li-upload-title" class="pt-h2">1 · Elegí el respaldo</h2>
        ${lacking.length ? `<p class="form-error" role="alert">Tu cuenta no puede revisar importaciones: faltan <span class="readout">${esc(lacking.join(", "))}</span>.</p>` : ""}
        <div class="li-file pt-field"><label for="li-file">Archivo .json</label><input id="li-file" type="file" accept="application/json,.json" data-li-file${lacking.length ? " disabled" : ""}><span class="pt-fine" id="li-file-status" aria-live="polite">${picked ? esc(`${picked.name} · ${(picked.size / 1024).toFixed(picked.size < 10240 ? 1 : 0)} KB`) : "Ningún archivo elegido."}</span></div>
        <p class="form-error" role="alert" id="li-upload-error">${esc(pickedError)}</p>
        <div class="lc-actions">${btn("imp-upload", "Subir para revisar", "btn-ink", lacking.length ? "disabled" : "")}</div>
        <p class="li-note"><strong>Tu navegador no se modifica.</strong> Se lee el archivo, se manda al servidor para revisarlo y nada más: el <span class="readout">localStorage</span> de la demostración y el archivo original quedan como están. Hasta 4 MB. El mismo archivo dos veces es la misma importación.</p>
      </section>
      ${permissionsBox(ctx)}
      <section aria-labelledby="li-list-title"><h2 id="li-list-title" class="pt-h2" style="margin-bottom:12px">Importaciones anteriores</h2>${entryView(entry, { slice: "imports.list", key: "", label: "No pudimos cargar las importaciones", render: list })}</section>
    </div>`, "importar");
}

function importScreen(ctx, id) {
  const { shell, crumbs, esc, entryView, emptyState, icon } = ctx;
  const entry = ctx.repo.get("imports.item", id);
  if (entry.status === "error" && entry.error?.status === 404) return shell(`${crumbs([["Operación", "#hoy"], ["Importar", "#importar"], ["No encontrada"]])}${emptyState("No existe esa importación", "", `<a class="pt-link" href="#importar">${icon("back")} Volver a importar</a>`)}`, "importar");
  return shell(`${crumbs([["Operación", "#hoy"], ["Importar", "#importar"], [`#${shortId(id)}`]])}${entryView(entry, { slice: "imports.item", key: id, label: "No pudimos cargar la importación", render: (imp) => (imp.status === "committed" ? reportView(ctx, imp) : reviewView(ctx, imp)) })}`, "importar");
}

const statusTag = (ctx, status) => tag(ctx.esc, STATUS_LABELS[status] || status, STATUS_TONE[status]);

function reasonsList(ctx, item) {
  const { esc } = ctx;
  const all = [...item.reasons.map((reason) => `<li>${esc(reason.message)}</li>`), ...item.warnings.map((reason) => `<li data-warning>${esc(reason.message)}</li>`)];
  return all.length ? `<ul class="li-reasons">${all.join("")}</ul>` : "";
}

function summaryTable(ctx, summary) {
  const { esc } = ctx;
  const rows = summaryRows(summary);
  const statuses = STATUS_ORDER.filter((status) => rows.some((row) => row.counts[status]));
  if (!rows.length) return `<p class="pt-fine">El respaldo no tiene registros.</p>`;
  return `<div class="li-table-wrap"><table class="li-table"><caption class="pt-fine" style="text-align:left;padding-bottom:6px">Registros del respaldo por tipo y por lo que haría el servidor con cada uno.</caption><thead><tr><th scope="col">Tipo</th>${statuses.map((status) => `<th scope="col">${esc(STATUS_LABELS[status])}</th>`).join("")}<th scope="col">Total</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><th scope="row" style="text-transform:none;letter-spacing:0;font-family:inherit;font-size:.875rem;color:var(--fg)">${esc(KIND_LABELS[row.kind])}</th>${statuses.map((status) => `<td${row.counts[status] ? "" : ' class="zero"'}>${row.counts[status] || 0}</td>`).join("")}<td><strong>${row.total}</strong></td></tr>`).join("")}</tbody></table></div>`;
}

function itemsList(ctx, items, { group, kindName, statusName, pageName, filters, kinds, statuses, showOutcome = false }) {
  const { esc, options } = ctx;
  const filtered = filterItems(items, filters);
  const page = paginate(filtered, filters.page);
  return `<div class="lc-filter-row" role="group" aria-label="Filtrar registros">
      ${selectField(ctx, { id: `li-${group}-kind`, label: "Tipo", list: kinds.map((kind) => [kind, KIND_LABELS[kind]]), selected: filters.kind, empty: "Todos los tipos", filter: `importar.${kindName}` })}
      ${statuses.length ? selectField(ctx, { id: `li-${group}-status`, label: "Estado", list: statuses.map((status) => [status, STATUS_LABELS[status]]), selected: filters.status, empty: "Todos los estados", filter: `importar.${statusName}` }) : ""}
    </div>
    ${page.items.length ? `<ul class="li-items">${page.items.map((item) => `<li class="li-item">
      <span class="label">${esc(KIND_SINGULAR[item.kind] || item.kind)}</span>
      <div><span class="li-item-label">${esc(item.label)}</span>${reasonsList(ctx, item)}${showOutcome && item.outcome === "created" && item.createdId && item.kind === "project" ? `<a class="pt-link" style="min-height:0" href="#proyectos/${encodeURIComponent(item.createdId)}">Ver el proyecto creado</a>` : ""}</div>
      <span>${showOutcome ? tag(esc, item.outcome === "created" ? "Creado" : "No se importó", item.outcome === "created" ? "ok" : "out") : statusTag(ctx, item.status)}</span></li>`).join("")}</ul>
      ${page.pages > 1 ? pager(ctx, { group: "importar", name: pageName, ...page }) : `<p class="pt-fine">${page.total} registro${page.total === 1 ? "" : "s"}.</p>`}`
      : `<p class="pt-fine">Ningún registro coincide con ese filtro.</p>`}`;
}

function reviewView(ctx, imp) {
  const { esc, btn, icon, fmtDate } = ctx;
  const preview = imp.preview;
  const f = ctx.state.filters.importar;
  if (!preview) return `<div class="pt-empty live-error" role="alert"><p class="pt-empty-title">El servidor no devolvió la revisión</p><p class="pt-empty-body">Probá actualizar. Si sigue, volvé a subir el archivo.</p>${btn("imp-refresh", "Actualizar la revisión", "btn-ink", `data-id="${esc(imp.id)}"`)}</div>`;
  const canCommit = missing(ctx, COMMIT_PERMISSIONS).length === 0;
  const decisions = decisionsFromFlat(preview, f);
  const needed = requiredDecisions(preview, decisions);
  const slots = projectSlots(preview);
  const check = out.importCommitBody(preview, { ...decisions, confirmed: true }, { knownClients: clients });
  const counts = expectedCounts(preview, decisions);
  const kinds = KIND_ORDER.filter((kind) => preview.items.some((item) => item.kind === kind));
  const statuses = STATUS_ORDER.filter((status) => preview.items.some((item) => item.status === status));
  const clientOptions = [["internal", "Solo interno (ningún cliente lo ve)"], ...clients.map((client) => [client.id, `${client.displayName || client.email} · ${client.email}`])];
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const projectsBlock = slots.some((slot, index) => !slot.duplicateKey || decisions.duplicates[slot.duplicateKey] === "import") ? `
    <h3 class="pt-h3">Cliente de cada proyecto</h3>
    <p class="pt-fine">Los respaldos no traen dueño real. Cada proyecto que se escribe necesita que elijas a propósito: un cliente (lo va a ver en su portal cuando publiques algo) o «solo interno».</p>
    <div class="li-found"><div class="pt-field"><label for="li-email">Buscar un cliente por email exacto</label><div class="live-inline"><input class="pt-input" id="li-email" type="email" autocomplete="off" placeholder="cliente@empresa.com"${ctx.can("clients:read") ? "" : " disabled"}>${btn("imp-lookup", "Buscar", "btn-ghost", ctx.can("clients:read") ? "" : "disabled")}</div></div>
      ${ctx.can("clients:read") ? "" : `<p class="pt-fine">Buscar clientes requiere <span class="readout">clients:read</span>: sin eso solo podés dejar los proyectos como internos.</p>`}
      <p class="pt-fine">${clients.length ? `Clientes disponibles: ${esc(clients.map((client) => client.displayName || client.email).join(", "))}.` : "Todavía no agregaste clientes: la búsqueda los suma a las opciones de cada proyecto."}</p></div>
    <div class="li-decision"><div class="li-decision-label">Aplicar la misma opción a todos los proyectos</div><div class="live-inline">${selectField(ctx, { id: "li-bulk", label: "Opción para todos", list: clientOptions, selected: f.bulk, empty: "Elegí…", filter: "importar.bulk" })}${btn("imp-assign-all", "Aplicar a todos", "btn-ghost", `data-id="${esc(imp.id)}"`)}</div></div>
    ${slots.map((slot, index) => (slot.duplicateKey && decisions.duplicates[slot.duplicateKey] !== "import") ? "" : `<div class="li-decision"><label class="li-decision-label" for="li-a${index}">${esc(slot.label)}${slot.duplicateKey ? ' <span class="pt-fine">(parecido, importado por decisión)</span>' : ""}</label>${selectField(ctx, { id: `li-a${index}`, label: `Cliente de ${slot.label}`, list: clientOptions, selected: f[`a${index}`] || "", empty: "Elegí…", filter: `importar.a${index}`, bare: true })}</div>`).join("")}` : "";

  const paymentsBlock = needed.paymentKinds.length ? `
    <h3 class="pt-h3">Tipo de cada cobro ambiguo</h3>
    <p class="pt-fine">Un cobro «Otro» no dice qué es. Los de concepto «Seña», «Saldo» o «Abono mensual» ya tienen su tipo y no se pueden reclasificar. Mantenimiento no baja el saldo del proyecto.</p>
    ${needed.paymentKinds.map((payment, index) => `<div class="li-decision"><label class="li-decision-label" for="li-k${index}">${esc(payment.label)}</label>${selectField(ctx, { id: `li-k${index}`, label: `Tipo de ${payment.label}`, list: PAYMENT_KIND_CHOICES, selected: f[`k${index}`] || "", empty: "Elegí…", filter: `importar.k${index}`, bare: true })}</div>`).join("")}` : "";

  const duplicatesBlock = needed.duplicates.length ? `
    <h3 class="pt-h3">Parecidos a lo que ya existe</h3>
    <p class="pt-fine">Por defecto se omiten. Si decidís importarlos, se crea otro registro aunque haya uno parecido.</p>
    ${needed.duplicates.map((entry, index) => `<div class="li-decision"><label class="li-decision-label" for="li-d${index}">${esc(KIND_SINGULAR[entry.kind] || entry.kind)} · ${esc(entry.label)}</label>${selectField(ctx, { id: `li-d${index}`, label: `Qué hacer con ${entry.label}`, list: [["skip", "Omitir (no importar)"], ["import", "Importar igual"]], selected: f[`d${index}`] === "import" ? "import" : "skip", filter: `importar.d${index}`, bare: true })}</div>`).join("")}` : "";

  const followBlock = needed.prospects > 0 ? `
    <h3 class="pt-h3">Seguimiento de los prospectos abiertos</h3>
    <div class="pt-field"><label for="li-follow">Fecha de la próxima acción</label><input class="pt-input" id="li-follow" type="date" min="${todayIso}" value="${esc(f.followUpOn)}" data-filter="importar.followUpOn"><span class="pt-fine">El servidor exige una fecha para los prospectos que siguen abiertos (la base no admite uno sin próxima acción). Tiene que ser hoy o futura. Los cerrados la ignoran.</span></div>` : "";

  const exampleBlock = preview.example ? `<div class="li-card" data-warn><h3 class="pt-h3">Este respaldo es de ejemplo</h3><p>Está marcado como <strong>datos de ejemplo</strong> (los negocios ficticios de la demostración). Si lo importás, lo creado queda marcado como ejemplo y fuera de los indicadores. Un servidor de producción no lo acepta.</p>
    ${checkbox(esc, "ack", "Reconozco que son datos de ejemplo y quiero importarlos igual", { checked: f.ack === "1", id: "li-ack", attrs: 'data-li-check="ack"' })}</div>` : "";

  const pendingDecisions = check.error && check.error !== "Marcá la confirmación final para importar." ? check.error : "";
  const expectedLines = KIND_ORDER.filter((kind) => counts[kind]).map((kind) => `${counts[kind]} ${KIND_LABELS[kind].toLowerCase()}`);

  return `
    <p class="pt-detail-meta"><span class="pt-detail-code">#${esc(shortId(imp.id))}</span><span>Respaldo versión ${imp.sourceVersion ?? "?"}</span><span>${(imp.payloadBytes / 1024).toFixed(0)} KB</span>${imp.date ? `<span>Cargado el ${esc(fmtDate(imp.date, true))}</span>` : ""}</p>
    <h1 class="display pt-title">Revisión <em>sin escribir</em>.</h1>
    <p class="pt-company">Esto es lo que el servidor encontró en el archivo. <strong>Todavía no se guardó nada.</strong> La revisión se recalcula cada vez contra lo que hay hoy en la base.</p>
    <input type="hidden" id="li-rerender" data-filter="importar.noop" value="">
    <ol class="li-steps" aria-label="Pasos"><li>1 · Elegir el archivo</li><li aria-current="step">2 · Revisar y decidir</li><li>3 · Confirmar</li><li>4 · Informe</li></ol>
    <div class="li-grid">
      <section class="li-card" aria-labelledby="li-summary-title"><h2 id="li-summary-title" class="pt-h2">Qué encontró</h2>
        ${summaryTable(ctx, preview.summary)}
        <p class="lc-hash"><span class="label">Huella de esta revisión</span> ${esc(preview.previewHash)}</p>
        <div class="lc-actions">${btn("imp-refresh", `${icon("arrow")} Volver a revisar`, "btn-ghost", `data-id="${esc(imp.id)}"`)}<a class="btn btn-sm btn-ghost" href="#importar">Elegir otro archivo</a></div></section>
      ${exampleBlock}
      <section class="li-card" aria-labelledby="li-items-title"><h2 id="li-items-title" class="pt-h2">Registro por registro</h2>
        <p class="pt-fine">Cada motivo viene en español del servidor. «Aviso» es algo que se acortó u omitió pero no impide importar.</p>
        ${itemsList(ctx, preview.items, { group: "review", kindName: "kind", statusName: "status", pageName: "page", filters: { kind: f.kind, status: f.status, page: f.page }, kinds, statuses })}</section>
      <section class="li-card" aria-labelledby="li-notmodeled-title"><h2 id="li-notmodeled-title" class="pt-h2">Lo que el sistema no modela</h2>
        <ul class="pt-ledger"><li><span>Bitácora del portal</span><span class="pt-leader"></span><span class="readout">${preview.notModeled.auditEntries} entradas</span></li>
        <li><span>Abonos mensuales</span><span class="pt-leader"></span><span class="readout">${preview.notModeled.subscriptions}</span></li>
        <li><span>Historial de etapas y referidos</span><span class="pt-leader"></span><span class="readout">no se modelan</span></li></ul>
        <p class="pt-fine">Todo eso queda en el respaldo original que guarda el servidor, y se cuenta en el informe. No se pierde, pero tampoco aparece en las pantallas.</p></section>
      ${canCommit ? `<section class="li-card" aria-labelledby="li-decide-title"><h2 id="li-decide-title" class="pt-h2">Tus decisiones</h2>
        ${projectsBlock}${paymentsBlock}${duplicatesBlock}${followBlock}
        <h3 class="pt-h3">Responsable</h3><p class="pt-fine">Los prospectos, metas y eventos importados quedan a tu nombre (${esc(ctx.admin?.email || "")}), que es quien confirma.</p>
        ${!projectsBlock && !paymentsBlock && !duplicatesBlock && !followBlock ? `<p class="pt-fine">Esta revisión no necesita decisiones de tu parte.</p>` : ""}
        <div class="li-note" aria-live="polite"><p class="label">Según la revisión, se crearía</p><p>${expectedLines.length ? esc(expectedLines.join(" · ")) : "Nada: no hay registros nuevos para importar."}</p>${pendingDecisions ? `<p class="pt-fine">Falta: ${esc(pendingDecisions)}</p>` : `<p class="pt-fine">Decisiones completas.</p>`}</div>
        <div class="lc-actions">${btn("imp-commit", "Revisar y confirmar…", "btn-ink", `data-id="${esc(imp.id)}"${pendingDecisions || !expectedLines.length ? " disabled" : ""}`)}</div>
        <p class="pt-fine">Antes de escribir, el servidor vuelve a comprobar que la revisión sea la misma que ves acá. Tu navegador no se modifica.</p></section>`
      : `<section class="li-card" data-danger><h2 class="pt-h2">Tu cuenta puede revisar, pero no confirmar</h2><p>Para confirmar hacen falta además: <span class="readout">${esc(missing(ctx, COMMIT_PERMISSIONS).join(", "))}</span>.</p></section>`}
    </div>`;
}

function reportView(ctx, imp) {
  const { esc, fmtDate } = ctx;
  const report = imp.report;
  const f = ctx.state.filters.importar;
  if (!report) return `<div class="pt-empty live-error" role="alert"><p class="pt-empty-title">Importación confirmada, pero sin informe</p><p class="pt-empty-body">El servidor no devolvió el informe. Actualizá la pantalla.</p></div>`;
  const created = Object.entries(CREATED_LABELS).filter(([key]) => report.created[key] !== undefined);
  const filter = f.reportFilter === "not_imported" ? "not_imported" : "created";
  const shown = report.items.filter((item) => item.outcome === filter);
  const kinds = KIND_ORDER.filter((kind) => shown.some((item) => item.kind === kind));
  const page = paginate(filterItems(shown, { kind: f.kind }), f.reportPage);
  const committed = imp.committedAt ? new Date(imp.committedAt) : null;
  return `
    <p class="pt-detail-meta"><span class="pt-detail-code">#${esc(shortId(imp.id))}</span><span>Respaldo versión ${report.sourceVersion ?? imp.sourceVersion ?? "?"}</span>${committed ? `<span>Confirmada el ${esc(fmtDate(`${committed.getFullYear()}-${String(committed.getMonth() + 1).padStart(2, "0")}-${String(committed.getDate()).padStart(2, "0")}`, true))}</span>` : ""}</p>
    <h1 class="display pt-title">Informe de la <em>importación</em>.</h1>
    <p class="pt-company">Esto es lo que quedó escrito en el servidor. Un segundo envío de esta importación devuelve este mismo informe y no escribe nada nuevo.</p>
    <ol class="li-steps" aria-label="Pasos"><li>1 · Elegir el archivo</li><li>2 · Revisar y decidir</li><li>3 · Confirmar</li><li aria-current="step">4 · Informe</li></ol>
    <div class="li-grid">
      <section class="li-card" aria-labelledby="li-created-title"><h2 id="li-created-title" class="pt-h2">Lo que se creó</h2>
        ${created.length ? `<ul class="li-counts">${created.map(([key, label]) => `<li><span class="label">${esc(label)}</span><strong>${report.created[key]}</strong></li>`).join("")}</ul>` : `<p class="pt-fine">No se creó ningún registro.</p>`}
        ${report.example ? `<p class="li-note">Era un respaldo de <strong>ejemplo</strong>: lo creado quedó marcado como ejemplo y fuera de los indicadores.</p>` : ""}
        <p class="pt-fine">${report.notImported} registro${report.notImported === 1 ? " del archivo no se importó" : "s del archivo no se importaron"} (abajo, con el motivo).</p></section>
      <section class="li-card" aria-labelledby="li-detail-title"><h2 id="li-detail-title" class="pt-h2">Detalle</h2>
        <div class="pt-seg" role="group" aria-label="Ver">${[["created", "Creados"], ["not_imported", "No importados"]].map(([key, label]) => `<button type="button" data-action="filter" data-id="importar.reportFilter" data-kind="${key}" aria-pressed="${filter === key}">${label} <span class="pt-count">${report.items.filter((item) => item.outcome === key).length}</span></button>`).join("")}</div>
        ${itemsList(ctx, shown, { group: "report", kindName: "kind", statusName: "status", pageName: "reportPage", filters: { kind: f.kind, status: "", page: f.reportPage }, kinds, statuses: [], showOutcome: true })}
        </section>
      <section class="li-card" aria-labelledby="li-nm-title"><h2 id="li-nm-title" class="pt-h2">Lo que no se modela</h2>
        <ul class="pt-ledger"><li><span>Bitácora del portal</span><span class="pt-leader"></span><span class="readout">${report.notModeled.auditEntries} entradas</span></li><li><span>Abonos mensuales</span><span class="pt-leader"></span><span class="readout">${report.notModeled.subscriptions}</span></li>${report.notModeled.stageHistory ? `<li><span>Historial de etapas</span><span class="pt-leader"></span><span class="readout">no se modela</span></li>` : ""}</ul>
        <p class="pt-fine">Quedan en el respaldo original que guarda el servidor.</p></section>
      <section class="li-card" aria-labelledby="li-notes-title"><h2 id="li-notes-title" class="pt-h2">Notas</h2>
        <ul class="pt-ledger">${report.notes.map((note) => `<li><span>${esc(note)}</span></li>`).join("")}<li><span><strong>Tu navegador no se modificó:</strong> el localStorage de la demostración y el archivo original siguen como estaban.</span></li></ul>
        <p class="lc-hash"><span class="label">SHA-256 del respaldo</span> ${esc(report.payloadSha256 || imp.payloadSha256)}</p>
        <div class="lc-actions"><a class="btn btn-sm btn-ink" href="#proyectos">Ver proyectos</a><a class="btn btn-sm btn-ghost" href="#importar">Volver a importar</a></div></section>
    </div>`;
}
