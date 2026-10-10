// Controlador del modo live: une el cliente de API, la sesión, el repositorio y los módulos.
// app.js solo conoce esta interfaz; cada módulo (src/live/modules) se enchufa por el registro.
import { createApiClient } from "../api/client.js";
import { ApiError } from "../api/errors.js";
import { createIdempotencyStore } from "../api/idempotency.js";
import { createAuth, renderAuthScreen } from "./auth.js";
import { FormError } from "./errors.js";
import { MODULES } from "./modules/index.js";
import { createRegistry } from "./registry.js";
import { createRepository } from "./repository.js";
import { createLiveUi } from "./ui.js";

export function createLive({ config, ui, hooks, fetchImpl, modules = MODULES }) {
  const registry = createRegistry(modules);
  let repo;
  let auth;
  const can = (permission) => Boolean(api.admin?.permissions?.includes(permission));
  const api = createApiClient({
    baseUrl: config.apiBaseUrl,
    fetchImpl,
    onSessionLost: () => {
      repo?.clear();
      idem.clear();
      // Si el cierre fue voluntario, auth ya está en "login"; si no, se explica.
      if (auth.state.phase === "ready") auth.expire();
      hooks.requestRender();
    },
  });
  const idem = createIdempotencyStore();
  repo = createRepository({ api, can });
  for (const [name, definition] of registry.sliceDefinitions()) repo.define(name, definition);
  const liveUi = createLiveUi(ui);
  let busy = false;
  let currentRoute = { view: "hoy", id: "" };

  const apiHost = (() => { try { return new URL(config.apiBaseUrl).host; } catch { return ""; } })();

  // Contexto que reciben los módulos: las primitivas del portal + el estado del servidor.
  const ctx = {
    ...ui,
    ...liveUi,
    api, repo, registry, can, config,
    get admin() { return api.admin; },
    get state() { return hooks.state; },
    setModal: (patch) => hooks.setModal(patch),
    pendingScreen: (module) => liveUi.pendingScreen(module, ui.shell, ui.crumbs),
  };

  auth = createAuth({
    api,
    onChange: () => hooks.requestRender(),
    onReady: () => { repo.clear(); idem.clear(); hooks.onReady(); },
  });
  repo.subscribe(() => hooks.requestRender({ fromData: true }));

  function prepare(route) {
    currentRoute = route;
    if (route.view === "crear" && auth.state.phase === "ready") {
      // Los formularios a pantalla completa eligen entre proyectos ya cargados.
      repo.ensure("projects").catch(() => {});
      return;
    }
    const module = registry.module(route.view);
    if (!module || !auth.state || auth.state.phase !== "ready" || !registry.allowed(module, can)) return;
    try { module.prepare?.(ctx, route); } catch (error) { console.error("prepare", route.view, error); }
  }

  function screenFor(route) {
    const module = registry.module(route.view) || registry.module("hoy");
    if (!registry.allowed(module, can)) {
      return ctx.shell(`${ctx.crumbs([["Operación", "#hoy"], [module.label]])}${liveUi.forbidden([].concat(module.permission).join(" o "), module.label)}`, module.id);
    }
    try {
      return module.render(ctx, route);
    } catch (error) {
      console.error("render", module.id, error);
      return ctx.shell(`${ctx.crumbs([["Operación", "#hoy"], [module.label]])}<div class="pt-empty live-error" role="alert"><p class="pt-empty-title">Esta pantalla falló al dibujarse</p><p class="pt-empty-body">Recargá la página. Si sigue, avisá: ${ctx.esc(error.message)}</p></div>`, module.id);
    }
  }

  /** Datos que cambian el estado del servidor: un solo envío a la vez, refresco al terminar, error entendible. */
  async function submit(type, values, { target = {}, modal = null, scope }) {
    const handler = registry.mutation(type);
    if (!handler) throw new FormError("Esta acción todavía no está conectada al servidor.");
    if (busy) return { skipped: true };
    busy = true;
    const touched = [];
    const helpers = {
      api, repo, can, scope, target, modal,
      get session() { return { admin: api.admin }; },
      touch: (slice) => touched.push(slice),
      idem: (body) => idem.keyFor(scope, { type, body }),
    };
    let result;
    let failure = null;
    try {
      result = await handler(values, helpers);
    } catch (error) {
      failure = error;
    }
    try {
      if (failure) {
        // 409 o resultado incierto: lo que se ve puede estar viejo. Se marca todo como vencido y se recarga lo de esta pantalla.
        if (failure instanceof ApiError && (failure.isConflict || failure.unknownOutcome)) {
          repo.invalidateAll();
          await repo.refresh(touched).catch(() => {});
          prepare(currentRoute);
        }
        throw failure;
      }
      idem.settle(scope);
      let refreshFailed = false;
      try { await repo.refresh(touched); } catch { refreshFailed = true; }
      return { ...result, refreshFailed };
    } finally {
      busy = false;
    }
  }

  /** Botones directos (sin formulario): retomar, resolver, quitar acceso… */
  async function runAction(type, detail) {
    const handler = registry.action(type);
    if (!handler) return { skipped: true };
    if (busy) return { skipped: true };
    busy = true;
    try {
      const result = await handler(ctx, detail);
      if (!result) return { silent: true };
      let refreshFailed = false;
      try { await repo.refresh(result.refresh || []); } catch { refreshFailed = true; }
      return { ...result, refreshFailed };
    } catch (error) {
      if (error instanceof ApiError && (error.isConflict || error.unknownOutcome)) {
        repo.invalidateAll();
        prepare(currentRoute);
      }
      throw error;
    } finally {
      busy = false;
    }
  }

  /** Texto del archivo de "Datos": solo lo que el servidor devolvió y está en pantalla. */
  function exportSnapshot() {
    return JSON.stringify({
      origen: "servidor",
      exportadoEn: new Date().toISOString(),
      aviso: "Copia de lo que el portal tiene cargado ahora. No es un respaldo del sistema: el respaldo vive en la base de datos del servidor.",
      cuenta: api.admin ? { id: api.admin.id, email: api.admin.email } : null,
      datos: repo.snapshot(),
    }, null, 2);
  }

  return {
    mode: "live",
    config,
    api, repo, registry, auth, ctx,
    get ready() { return auth.state.phase === "ready"; },
    can,
    get admin() { return api.admin; },
    views: () => registry.views().filter((view) => view !== "core"),
    initialFilters() {
      return Object.fromEntries(registry.modules.flatMap((module) => Object.entries(module.filters || {})));
    },
    start: () => auth.start(),
    authScreen: ({ dark }) => renderAuthScreen(auth.state, { esc: ui.esc, phaseGlyph: ui.phaseGlyph, icon: ui.icon, dark, config: { ...config, apiHost } }),
    prepare,
    screenFor,
    navItems(area) {
      return registry.nav(area, can).map((item) => ({ ...item, badge: registry.module(item.id).badge?.(ctx) || null }));
    },
    hasWizard: (type) => registry.hasWizard(type),
    hasModal: (type) => registry.hasModal(type),
    hasAction: (type) => registry.hasAction(type),
    wizardConfig: (wizard) => registry.wizard(wizard.type)(wizard, ctx),
    modalMarkup: (modal) => registry.modal(modal.type).markup(ctx, modal),
    submit,
    runAction,
    retry: (slice, key) => {
      if (registry.sliceDefinitions().some(([name]) => name === slice)) repo.ensure(slice, key, { force: true }).catch(() => {});
      else { repo.invalidateAll(); prepare(currentRoute); }
    },
    more: (slice, key) => repo.more(slice, key),
    refreshRoute() { repo.invalidateAll(); prepare(currentRoute); },
    logout: () => auth.logout().finally(() => { repo.clear(); idem.clear(); }),
    exportSnapshot,
  };
}
