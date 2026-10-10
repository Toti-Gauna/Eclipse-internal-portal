// Registro de módulos del modo live. Un módulo es un objeto declarativo en src/live/modules/<id>.js; el registro solo lo indexa.
//
// {
//   id: "proyectos",                       // vista de la ruta (#proyectos/…) e id de navegación. Único.
//   label: "Proyectos",                    // texto de la navegación
//   nav: { order: 40, area: "main" },      // area: "main" (barra) | "menu" (menú de tres puntos) | null (sin entrada)
//   status: "live",                        // "live" | "pending" (módulo aún sin conectar: pantalla honesta)
//   permission: "projects:read",           // permiso(s) para ver el módulo (string o lista: alcanza con uno)
//   slices: { nombre: { load(ctx, clave), permission?, forbiddenValue?, more? } },
//   prepare(ctx, route),                   // dispara las cargas de la ruta (repo.ensure…). Se llama al navegar, nunca al dibujar.
//   render(ctx, route),                    // HTML sincrónico de la pantalla, leyendo el repositorio
//   badge(ctx),                            // número para la navegación (opcional)
//   wizards: { "new-x": (wizard, ctx) => config },     // pantallas completas (#crear/new-x), misma forma que generatorConfig
//   modals:  { "x-y": { markup(ctx, modal) } },        // diálogos
//   actions: { "x-z": async (ctx, { id, kind, button }) => ({ message, refresh }) },   // botones directos
//   mutations: { "new-x": async (values, h) => ({ message, goto? }) },                 // envíos de formulario (por tipo)
// }
//
// h = { api, repo, session, scope, idem(body) → Idempotency-Key, touch([slice, clave]) → refrescar al terminar (aunque falle) }
export function createRegistry(modules) {
  const byId = new Map();
  const wizards = new Map();
  const modals = new Map();
  const actions = new Map();
  const mutations = new Map();
  const claim = (map, kind, name, value, owner) => {
    if (map.has(name)) throw new Error(`${kind} "${name}" duplicado (${owner} y ${map.get(name).owner}).`);
    map.set(name, { value, owner });
  };
  for (const module of modules) {
    if (!module?.id) throw new Error("Un módulo live necesita id.");
    if (byId.has(module.id)) throw new Error(`Módulo duplicado: ${module.id}`);
    byId.set(module.id, module);
    for (const [name, fn] of Object.entries(module.wizards || {})) claim(wizards, "Wizard", name, fn, module.id);
    for (const [name, def] of Object.entries(module.modals || {})) claim(modals, "Modal", name, def, module.id);
    for (const [name, fn] of Object.entries(module.actions || {})) claim(actions, "Acción", name, fn, module.id);
    for (const [name, fn] of Object.entries(module.mutations || {})) claim(mutations, "Mutación", name, fn, module.id);
  }

  const permissionsOf = (module) => (module.permission ? [].concat(module.permission) : []);
  const allowed = (module, can) => permissionsOf(module).length === 0 || permissionsOf(module).some((permission) => can(permission));

  return {
    modules: [...byId.values()],
    module: (id) => byId.get(id) || null,
    allowed,
    /** Entradas de navegación por área, ordenadas. Los módulos sin permiso se muestran deshabilitados, no desaparecen sin explicación. */
    nav(area, can) {
      return [...byId.values()]
        .filter((module) => module.nav && module.nav.area === area)
        .sort((a, b) => (a.nav.order ?? 100) - (b.nav.order ?? 100))
        .map((module) => ({ id: module.id, label: module.label, status: module.status || "live", allowed: allowed(module, can), hint: module.nav.hint || "" }));
    },
    views: () => [...byId.keys()],
    sliceDefinitions: () => [...byId.values()].flatMap((module) => Object.entries(module.slices || {}).map(([name, def]) => [name, def, module.id])),
    wizard: (type) => wizards.get(type)?.value || null,
    modal: (type) => modals.get(type)?.value || null,
    action: (type) => actions.get(type)?.value || null,
    mutation: (type) => mutations.get(type)?.value || null,
    hasWizard: (type) => wizards.has(type),
    hasModal: (type) => modals.has(type),
    hasAction: (type) => actions.has(type),
  };
}
