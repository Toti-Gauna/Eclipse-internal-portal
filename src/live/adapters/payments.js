import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS, centsToDollars } from "./common.js";

/** Pago de la API → fila del libro de cobros. `date` es el día que cuenta (cobrado, o vencimiento si aún no se cobró). */
export function adaptPayment(api, project = null) {
  return {
    id: api.id,
    projectId: api.projectId ?? project?.id ?? null,
    projectName: project?.name || "",
    kind: api.kind,
    status: api.status,
    concept: PAYMENT_KIND_LABELS[api.kind] || api.kind,
    statusLabel: PAYMENT_STATUS_LABELS[api.status] || api.status,
    amount: centsToDollars(api.amountCents),
    amountCents: api.amountCents,
    dueOn: api.dueOn || null,
    receivedOn: api.receivedOn || null,
    date: api.receivedOn || api.dueOn || null,
    // El servidor guarda el día del cobro, no la hora: no se inventa una.
    time: null,
    note: api.note || "",
    reference: api.reference || "",
    voidReason: api.voidReason || "",
    reducesBalance: Boolean(api.reducesProjectBalance),
    version: api.version,
    recordedAt: api.createdAt,
    unit: "",
  };
}
