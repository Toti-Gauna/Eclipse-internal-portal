// Slices compartidos por varios módulos (proyectos, cobros, hoy, solicitudes). No tiene pantalla ni navegación.
import { adaptFinance, adaptMilestone, adaptProject, adaptScope, adaptUpdate } from "../adapters/projects.js";
import { adaptPayment } from "../adapters/payments.js";
import { indexCatalog } from "../adapters/requests.js";

const projectRef = (repo, id) => (repo.data("projects")?.list || []).find((project) => project.id === id) || { id, name: "" };

export default {
  id: "core",
  label: "Núcleo",
  nav: null,
  status: "live",
  slices: {
    /** Catálogo público (nombres de paquetes y piezas). No necesita sesión. */
    catalog: {
      load: async ({ api, signal }) => indexCatalog(await api.get("/catalog/plans", { auth: false, signal })),
    },
    /** Lista de proyectos (sin dinero: la API no lo incluye en listas). */
    projects: {
      permission: "projects:read",
      forbiddenValue: { list: [], truncated: false },
      load: async ({ api, signal }) => {
        const { items, truncated } = await api.listAll("/admin/projects", { key: "projects", maxPages: 10, signal });
        return { list: items.map(adaptProject), truncated };
      },
    },
    project: {
      permission: "projects:read",
      load: async ({ api, signal }, id) => adaptProject((await api.get(`/admin/projects/${id}`, { signal })).project),
    },
    "project.milestones": {
      permission: "projects:read",
      forbiddenValue: [],
      load: async ({ api, signal }, id) => (await api.get(`/admin/projects/${id}/milestones`, { signal })).milestones.map(adaptMilestone),
    },
    "project.updates": {
      permission: "projects:read",
      forbiddenValue: [],
      load: async ({ api, signal }, id) => (await api.listAll(`/admin/projects/${id}/updates`, { key: "updates", maxPages: 6, signal })).items.map(adaptUpdate),
    },
    "project.scope": {
      permission: "projects:read",
      forbiddenValue: { versions: [], changeRequests: [] },
      load: async ({ api, signal }, id) => adaptScope(await api.get(`/admin/projects/${id}/scope`, { signal })),
    },
    /** Auditoría del proyecto: solo se usa para reconstruir el historial de etapas. */
    "project.audit": {
      permission: "projects:read",
      forbiddenValue: [],
      load: async ({ api, signal }, id) => (await api.listAll(`/admin/projects/${id}/audit`, { key: "events", query: { resourceType: "project" }, maxPages: 3, signal })).items,
    },
    "project.finance": {
      permission: "billing:read",
      forbiddenValue: null,
      load: async ({ api, signal }, id) => adaptFinance((await api.get(`/admin/projects/${id}/finance`, { signal })).finance),
    },
    "project.payments": {
      permission: "billing:read",
      forbiddenValue: [],
      load: async ({ api, repo, signal }, id) => {
        const project = projectRef(repo, id);
        return (await api.get(`/admin/projects/${id}/payments`, { signal })).payments.map((payment) => adaptPayment({ ...payment, projectId: id }, project));
      },
    },
  },
};
