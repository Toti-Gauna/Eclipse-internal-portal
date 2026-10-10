import { GOAL_LABELS, MAINTENANCE_LABELS, REQUEST_STATUS_LABELS, VERTICAL_LABELS, centsToDollars, dayOfInstant, timeOfInstant } from "./common.js";

const localized = (text, locale = "es") => (text && typeof text === "object" ? text[locale] || text.es || "" : text || "");

/** Índices del catálogo público para poner nombre a los ids (piezas, paquetes, mantenimiento). */
export function indexCatalog(catalog) {
  const byId = (list) => Object.fromEntries((list || []).map((entry) => [entry.id, entry]));
  return { version: catalog?.version || null, items: byId(catalog?.items), plans: byId(catalog?.plans), maintenance: byId(catalog?.maintenance), verticals: byId(catalog?.verticals) };
}

/** Solicitud de plan (DTO admin) → modelo de vista. Los textos del cliente no se interpretan: se escapan al dibujar. */
export function adaptRequest(api, catalog = indexCatalog(null)) {
  const selection = api.selection || {};
  const plan = selection.planId ? catalog.plans[selection.planId] : null;
  const estimate = api.estimate || {};
  return {
    id: api.id,
    status: api.status,
    statusLabel: REQUEST_STATUS_LABELS[api.status] || api.status,
    version: api.version,
    clientId: api.clientId,
    contactName: api.contact?.name || "",
    contactPhone: api.contact?.phone || "",
    message: api.message || "",
    createdAt: api.createdAt,
    date: dayOfInstant(api.createdAt),
    time: timeOfInstant(api.createdAt),
    reviewedAt: api.reviewedAt || null,
    publicResponse: api.publicResponse || "",
    internalNote: api.internalNote || "",
    catalogVersion: api.catalogVersion,
    selection: {
      goals: (selection.goals || []).map((id) => GOAL_LABELS[id] || id),
      planId: selection.planId || "",
      planName: plan ? localized(plan.name) : selection.planId ? selection.planId : "",
      items: (selection.items || []).map((id) => ({ id, name: localized(catalog.items[id]?.name) || id })),
      maintenance: selection.maintenance ? MAINTENANCE_LABELS[selection.maintenance] || selection.maintenance : "",
      billing: selection.billing === "annual" ? "Anual" : "Mensual",
      vertical: selection.vertical ? VERTICAL_LABELS[selection.vertical] || selection.vertical : "",
      founder: Boolean(selection.founder),
    },
    estimate: {
      provisional: estimate.provisional !== false,
      lines: (estimate.lines || []).map((line) => ({ id: line.id, kind: line.kind, name: localized((line.kind === "plan" ? catalog.plans : catalog.items)[line.id]?.name) || line.id, price: centsToDollars(line.priceCents), priceCents: line.priceCents, listCents: line.listCents })),
      subtotalCents: estimate.subtotalCents ?? 0,
      totalCents: estimate.totalCents ?? 0,
      range: estimate.rangeCents ? { fromCents: estimate.rangeCents.from, toCents: estimate.rangeCents.to } : null,
      voiceCombo: Boolean(estimate.voiceCombo),
      founderDiscountCents: estimate.founderDiscountCents ?? 0,
      maintenanceMonthlyCents: estimate.maintenance?.monthlyCents ?? 0,
      maintenancePeriodCents: estimate.maintenance?.periodCents ?? 0,
      voiceUsageMonthlyCents: estimate.maintenance?.voiceUsageMonthlyCents ?? 0,
    },
    // Resumen de una línea para listas.
    summary: plan ? localized(plan.name) : (selection.items || []).slice(0, 3).map((id) => localized(catalog.items[id]?.name) || id).join(" · ") || "Sin selección",
  };
}
