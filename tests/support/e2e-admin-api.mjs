// Ayudas SOLO para pruebas: llamadas a la API con la sesión de administrador que ya tiene un contexto de Playwright (sus cookies HttpOnly).
// Sirven para preparar datos (un proyecto con cliente, una novedad publicada) y para verificar lo que el servidor guardó; la interfaz
// del portal es lo que se prueba, no esto. Respetan el límite general (120 pedidos por minuto) esperando si hace falta.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function adminApi({ context, api, origin }) {
  let csrf = null;
  const root = `${api}/api/v1`;
  async function token() {
    if (csrf) return csrf;
    const response = await context.request.get(`${root}/auth/admin/csrf`, { headers: { Origin: origin } });
    csrf = (await response.json()).csrfToken;
    return csrf;
  }
  async function call(method, path, { body, key, tries = 6 } = {}) {
    for (let attempt = 0; attempt < tries; attempt++) {
      const headers = { Origin: origin, ...(method === "GET" ? {} : { "X-CSRF-Token": await token() }), ...(key ? { "Idempotency-Key": key } : {}) };
      const response = await context.request.fetch(`${root}${path}`, { method, headers, ...(body !== undefined ? { data: body } : {}) });
      if (response.status() === 429 && attempt < tries - 1) { await sleep(5000); continue; }
      if (response.status() === 403 && method !== "GET" && attempt === 0) { csrf = null; continue; }
      const text = await response.text();
      return { status: response.status(), body: text ? JSON.parse(text) : null, headers: response.headers() };
    }
    throw new Error(`${method} ${path}: el límite de la API no se liberó`);
  }
  return {
    get: (path) => call("GET", path),
    post: (path, body, options) => call("POST", path, { body, ...options }),
    patch: (path, body) => call("PATCH", path, { body }),
    /** Descarga binaria con la sesión de administrador. */
    async download(path) {
      const response = await context.request.get(`${root}${path}`, { headers: { Origin: origin } });
      return { status: response.status(), contentType: response.headers()["content-type"] || "", bytes: await response.body() };
    },
    /** Proyecto con acuerdo + seña, y al cliente dado como miembro. Devuelve el proyecto. */
    async createProject({ name, clientId, price = 200000, deposit = 50000 }) {
      const result = await call("POST", "/admin/projects", {
        key: globalThis.crypto.randomUUID(),
        body: {
          organization: { name }, name, service: "Landing premium", currency: "USD",
          agreement: { reference: `E2E-${Date.now()}`, acceptedOn: "2026-09-01", priceCents: price, scopeItems: ["Landing premium"] },
          deposit: { amountCents: deposit, receivedOn: "2026-09-02" },
          members: clientId ? [{ clientId, role: "client_admin" }] : [],
        },
      });
      if (result.status !== 201 && result.status !== 200) throw new Error(`No se pudo crear el proyecto: ${result.status} ${JSON.stringify(result.body)}`);
      return result.body.project;
    },
    /** Novedad al cliente publicada (borrador → publicación con confirm). */
    async publishUpdate(projectId, { title, body }) {
      const draft = await call("POST", `/admin/projects/${projectId}/updates`, { body: { kind: "client_update", title, body } });
      if (draft.status !== 201) throw new Error(`No se pudo crear la novedad: ${draft.status} ${JSON.stringify(draft.body)}`);
      const update = draft.body.update;
      const published = await call("POST", `/admin/projects/${projectId}/updates/${update.id}/publish`, { body: { version: update.version, confirm: true } });
      if (published.status !== 200) throw new Error(`No se pudo publicar: ${published.status} ${JSON.stringify(published.body)}`);
      return published.body.update;
    },
    /** Hito de una etapa, mostrado al cliente (visibilidad con confirm). */
    async visibleMilestone(projectId, { title, stage = "preparation", plannedOn = "2026-11-15" }) {
      const created = await call("POST", `/admin/projects/${projectId}/milestones`, { body: { stage, title, ownerParty: "eclipse", plannedOn } });
      if (created.status !== 201) throw new Error(`No se pudo crear el hito: ${created.status} ${JSON.stringify(created.body)}`);
      const milestone = created.body.milestone;
      const shown = await call("POST", `/admin/projects/${projectId}/milestones/${milestone.id}/visibility`, { body: { version: milestone.version, visible: true, confirm: true } });
      if (shown.status !== 200) throw new Error(`No se pudo mostrar el hito: ${shown.status} ${JSON.stringify(shown.body)}`);
      return shown.body.milestone;
    },
  };
}
