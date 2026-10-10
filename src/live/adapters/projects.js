import { centsToDollars, dayOfInstant, projectCode, stageToView, timeOfInstant, viewStage } from "./common.js";

/** Elemento de GET /admin/projects (sin dinero) o detalle de GET /admin/projects/:id → proyecto del modelo de vista. */
export function adaptProject(api) {
  const view = viewStage(api);
  const finance = api.finance ? { agreedCents: api.finance.agreedPriceCents, baseCents: api.finance.basePriceCents } : null;
  return {
    id: api.id,
    code: projectCode(api),
    prospectId: null,
    name: api.name,
    client: api.organization?.name || "",
    organizationId: api.organization?.id || api.organizationId || null,
    unit: "",
    service: api.service,
    stage: view,
    // Pausa y cierre conservan la etapa de la API: es "donde estaba".
    pausedIn: view === "paused" ? stageToView(api.stage) : null,
    apiStage: api.stage,
    status: api.status,
    version: api.version,
    total: finance ? centsToDollars(finance.agreedCents) : null,
    maintenance: 0,
    startedAt: api.startedOn || dayOfInstant(api.createdAt),
    createdAt: dayOfInstant(api.createdAt),
    deliveryEstimate: api.plannedEndOn || null,
    deliveredAt: null,
    paidAt: null,
    referral: null,
    notes: "",
    clientAction: null,
    milestone: null,
    pause: view === "paused" ? { since: dayOfInstant(api.updatedAt), reason: api.stateReason || "", next: "", review: api.reviewOn || null } : null,
    closedReason: api.status === "closed" ? api.stateReason || "" : null,
    completedOn: api.completedOn || null,
    history: [],
    updates: [],
    live: {
      origin: api.origin,
      startedOn: api.startedOn ?? null,
      plannedEndOn: api.plannedEndOn ?? null,
      legacyReference: api.legacyReference ?? null,
      sourcePlanRequestId: api.sourcePlanRequestId ?? null,
      agreementReference: api.agreementReference ?? null,
      agreementAcceptedOn: api.agreementAcceptedOn ?? null,
      scopeVersion: api.scopeVersion ?? null,
      leadAdminId: api.leadAdminId ?? null,
      stateReason: api.stateReason ?? null,
      reviewOn: api.reviewOn ?? null,
      members: (api.members || []).filter((member) => !member.removedAt),
      removedMembers: (api.members || []).filter((member) => member.removedAt),
      detailLoaded: Boolean(api.organization),
    },
  };
}

/** Tramos de etapa a partir de la auditoría: [{ stage, start, end? }]. Es una reconstrucción, no un dato guardado. */
export function stageHistoryFromAudit(project, events) {
  const changes = (events || [])
    .filter((event) => event.action === "project.stage_changed" && event.result === "success" && event.after?.stage)
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  const first = changes[0]?.before?.stage || project.apiStage;
  const spans = [{ stage: stageToView(first), start: project.startedAt || project.createdAt }];
  for (const change of changes) {
    const day = dayOfInstant(change.occurredAt);
    const last = spans.at(-1);
    if (last && !last.end) last.end = day;
    spans.push({ stage: stageToView(change.after.stage), start: day });
  }
  return spans;
}

export function adaptMilestone(api) {
  return {
    id: api.id,
    stage: stageToView(api.stage),
    apiStage: api.stage,
    title: api.title,
    description: api.description || "",
    status: api.status,
    ownerParty: api.ownerParty,
    plannedOn: api.plannedOn || null,
    actualOn: api.actualOn || null,
    visibleToClient: Boolean(api.visibleToClient),
    internalNotes: api.internalNotes || "",
    evidence: api.evidence || "",
    version: api.version,
  };
}

export function adaptUpdate(api) {
  return {
    id: api.id,
    kind: api.kind,
    state: api.state,
    title: api.title || "",
    body: api.body,
    dueOn: api.dueOn || null,
    resolved: Boolean(api.resolvedAt),
    resolvedAt: api.resolvedAt || null,
    publishedAt: api.publishedAt || null,
    withdrawnAt: api.withdrawnAt || null,
    withdrawReason: api.withdrawReason || "",
    version: api.version,
    // Fecha/hora = cuándo la registró el servidor. Es un instante real, no una hora de ocurrencia inventada.
    date: dayOfInstant(api.publishedAt || api.createdAt),
    time: timeOfInstant(api.publishedAt || api.createdAt),
    createdAt: api.createdAt,
    clientPreview: api.clientPreview || null,
  };
}

export function adaptChangeRequest(api) {
  return {
    id: api.id,
    number: api.number,
    origin: api.origin,
    title: api.title,
    description: api.description,
    status: api.status,
    sharedWithClient: Boolean(api.sharedWithClient),
    hoursImpact: api.hoursImpact ?? null,
    priceImpact: api.priceImpactCents === null || api.priceImpactCents === undefined ? null : centsToDollars(api.priceImpactCents),
    priceImpactCents: api.priceImpactCents ?? null,
    scheduleImpactDays: api.scheduleImpactDays ?? null,
    technicalAssessment: api.technicalAssessment || "",
    commercialDecision: api.commercialDecision || "",
    acceptanceReference: api.acceptanceReference || "",
    acceptedOn: api.acceptedOn || null,
    appliedScopeVersion: api.appliedScopeVersion ?? null,
    version: api.version,
  };
}

export function adaptScope(api) {
  return {
    versions: (api.versions || []).map((version) => ({ version: version.version, items: version.items, price: version.priceCents === undefined ? null : centsToDollars(version.priceCents), priceCents: version.priceCents ?? null, acceptedOn: version.acceptedOn, changeRequestId: version.changeRequestId ?? null })),
    changeRequests: (api.changeRequests || []).map(adaptChangeRequest),
  };
}

export function adaptFinance(api) {
  const price = api.price || {};
  const maintenance = api.maintenance || {};
  return {
    currency: api.currency,
    agreedCents: api.agreedPriceCents,
    baseCents: api.basePriceCents,
    collectedCents: price.collectedCents ?? 0,
    committedCents: price.committedCents ?? 0,
    proposedCents: price.proposedCents ?? 0,
    balanceCents: price.balanceCents ?? 0,
    unscheduledCents: price.unscheduledCents ?? 0,
    maintenanceCollectedCents: maintenance.collectedCents ?? 0,
    maintenanceCommittedCents: maintenance.committedCents ?? 0,
    maintenanceProposedCents: maintenance.proposedCents ?? 0,
    incomeCollectedCents: api.incomeCollectedCents ?? 0,
  };
}
