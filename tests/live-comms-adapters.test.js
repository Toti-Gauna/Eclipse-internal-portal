import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/api/errors.js";
import { createApiClient } from "../src/api/client.js";
import { adaptCommunication, adaptRecipient, commsErrorMessage, publishedUpdates, recipientProblem, safeWhatsappUrl, shortHash, visibleMilestones, EVIDENCE_NOTES, FINAL_STATUSES } from "../src/live/adapters/comms.js";
import { adaptDocument, checkFile, checkFileName, documentErrorMessage, extensionMatches, formatBytes, MAX_DOCUMENT_BYTES } from "../src/live/adapters/documents.js";
import { adaptImport, decisionsFromFlat, expectedCounts, explainReason, filterItems, importErrorMessage, paginate, projectSlots, requiredDecisions, summaryRows } from "../src/live/adapters/imports.js";
import * as out from "../src/live/adapters/outbound-comms.js";
import { makeBackup } from "./support/backup-fixture.mjs";

const U = (n) => `3931ac6f-f567-48a5-8561-60${String(n).padStart(10, "0")}`;
const PROJECT = U(1);
const CLIENT = U(2);
const UPDATE = U(3);
const HASH = "a".repeat(64);
const api = (patch = {}) => ({ id: U(9), projectId: PROJECT, clientId: CLIENT, channel: "email", purpose: "custom", language: "es", updateId: null, milestoneId: null, subject: "Hola", text: "Hola,\n\nTexto", contentHash: HASH, recipient: { email: "c@x.test", phone: null }, status: "draft", version: 1, confirmedAt: null, confirmedBy: null, resultAt: null, evidence: "none", createdAt: "2026-10-10T16:26:21.325Z", createdBy: U(5), whatsappUrl: null, ...patch });

// ---------- Comunicaciones ----------

test("comunicación: el estado y la evidencia se leen tal cual y SMTP nunca se llama entrega", () => {
  const queued = adaptCommunication(api({ status: "queued" }));
  assert.equal(queued.final, false);
  assert.equal(queued.isEmail, true);
  const accepted = adaptCommunication(api({ status: "accepted_by_smtp", evidence: "smtp_accepted" }));
  assert.equal(accepted.final, true);
  assert.match(EVIDENCE_NOTES.accepted_by_smtp, /NO prueba/);
  assert.ok(Object.values(EVIDENCE_NOTES).every((note) => !/\bse entregó\b|\bentregado correctamente\b/i.test(note)), "ningún estado afirma entrega");
  for (const status of ["accepted_by_smtp", "failed", "unknown", "cancelled", "declared_sent"]) assert.ok(FINAL_STATUSES.includes(status));
  assert.equal(adaptCommunication(api({ status: "declared_sent", channel: "whatsapp", evidence: "manual_declaration" })).evidence, "manual_declaration");
});

test("whatsapp: solo se acepta un enlace https://wa.me", () => {
  assert.equal(safeWhatsappUrl("https://wa.me/5491155550000?text=Hola"), "https://wa.me/5491155550000?text=Hola");
  for (const bad of ["javascript:alert(1)", "http://wa.me/1", "https://evil.test/wa.me", "https://wa.me.evil.test/1", "https://u:p@wa.me/1", "", null, undefined, 5]) assert.equal(safeWhatsappUrl(bad), null, String(bad));
  assert.equal(adaptCommunication(api({ channel: "whatsapp", whatsappUrl: "javascript:alert(1)" })).waUrl, null);
});

test("destinatarios y fuentes aprobadas", () => {
  assert.deepEqual(adaptRecipient({ clientId: CLIENT, email: "c@x.test", displayName: null, verified: true, phoneAvailable: false }), { clientId: CLIENT, email: "c@x.test", name: "", verified: true, phoneAvailable: false });
  assert.match(recipientProblem({ verified: false }, "email"), /no está verificado/);
  assert.equal(recipientProblem({ verified: false }, "whatsapp"), "");
  assert.ok(recipientProblem(null, "email"));
  const updates = [{ id: "a", state: "published", kind: "client_update" }, { id: "b", state: "draft", kind: "client_update" }, { id: "c", state: "internal", kind: "internal_note" }, { id: "d", state: "withdrawn", kind: "client_update" }, { id: "e", state: "published", kind: "internal_note" }];
  assert.deepEqual(publishedUpdates(updates).map((u) => u.id), ["a"]);
  const milestones = [{ id: "a", visibleToClient: true, status: "pending" }, { id: "b", visibleToClient: false, status: "pending" }, { id: "c", visibleToClient: true, status: "cancelled" }];
  assert.deepEqual(visibleMilestones(milestones).map((m) => m.id), ["a"]);
  assert.equal(shortHash(HASH), "aaaaaaaa…aaaa");
});

test("errores de comunicaciones: SMTP apagado, tope de envíos y contenido vencido", () => {
  const e = (status, extra = {}) => new ApiError({ code: { 400: "BAD_REQUEST", 409: "CONFLICT", 429: "TOO_MANY_REQUESTS", 503: "SERVICE_UNAVAILABLE" }[status], status, ...extra });
  assert.match(commsErrorMessage(e(503), "create"), /SMTP sin configurar.*WhatsApp/s);
  assert.match(commsErrorMessage(e(503), "confirm"), /SMTP/);
  assert.equal(commsErrorMessage(e(503), "cancel"), null);
  assert.match(commsErrorMessage(e(429, { retryAfter: 600 }), "confirm"), /3 correos por cliente por día y 20 por administrador por hora.*10 min/s);
  assert.match(commsErrorMessage(e(409), "confirm"), /cambió desde la vista previa|ya no está publicado|salió del proyecto/);
  assert.match(commsErrorMessage(e(409), "opened"), /se retiró|salió del proyecto/);
  assert.match(commsErrorMessage(e(409), "create"), /inactiva|verificado/);
  assert.match(commsErrorMessage(e(409), "cancel"), /ya tomó/);
  assert.ok(commsErrorMessage(e(400), "create"));
  assert.equal(commsErrorMessage(new Error("x"), "create"), null);
});

test("cuerpo de un borrador: el navegador nunca manda direcciones y respeta las reglas del servidor", () => {
  const one = [{ clientId: CLIENT }];
  const base = { projectId: PROJECT, channel: "email", purpose: "update", language: "es", updateId: UPDATE };
  assert.deepEqual(out.communicationCreateBody(base, { recipients: one }).body, { projectId: PROJECT, channel: "email", purpose: "update", language: "es", updateId: UPDATE });
  const body = out.communicationCreateBody({ ...base, clientId: CLIENT, email: "otro@x.test", phone: "+5491100000000", message: " Nota " }, { recipients: one }).body;
  assert.deepEqual(Object.keys(body).sort(), ["channel", "clientId", "language", "message", "projectId", "purpose", "updateId"]);
  assert.equal(body.message, "Nota");
  // varios destinatarios: hay que elegir
  assert.match(out.communicationCreateBody(base, { recipients: [{ clientId: CLIENT }, { clientId: U(7) }] }).error, /más de una persona/);
  assert.match(out.communicationCreateBody(base, { recipients: [] }).error, /no tiene personas/);
  assert.match(out.communicationCreateBody({ ...base, clientId: U(8) }, { recipients: one }).error, /ya no está en el proyecto/);
  // update/milestone no llevan asunto; la novedad es obligatoria
  assert.equal(out.communicationCreateBody({ ...base, subject: "x" }, { recipients: one }).body.subject, undefined);
  assert.match(out.communicationCreateBody({ ...base, updateId: "" }, { recipients: one }).error, /novedad publicada/);
  assert.match(out.communicationCreateBody({ ...base, purpose: "milestone", updateId: undefined }, { recipients: one }).error, /hito/);
  // propio: correo con asunto, WhatsApp sin asunto, mensaje obligatorio y tope de 1500
  const custom = { projectId: PROJECT, channel: "email", purpose: "custom", message: "Hola" };
  assert.match(out.communicationCreateBody(custom, { recipients: one }).error, /asunto/);
  assert.deepEqual(out.communicationCreateBody({ ...custom, subject: "Asunto" }, { recipients: one }).body.subject, "Asunto");
  assert.equal(out.communicationCreateBody({ ...custom, channel: "whatsapp", subject: "Asunto" }, { recipients: one }).body.subject, undefined);
  assert.match(out.communicationCreateBody({ ...custom, message: "" , subject: "A"}, { recipients: one }).error, /Escribí el mensaje/);
  assert.match(out.communicationCreateBody({ ...custom, subject: "A", message: "x".repeat(1501) }, { recipients: one }).error, /1500/);
  assert.match(out.communicationCreateBody({ ...custom, subject: "x".repeat(121) }, { recipients: one }).error, /120/);
  assert.match(out.communicationCreateBody({ ...custom, subject: "A\u0007" }, { recipients: one }).error, /caracteres/);
  assert.match(out.communicationCreateBody({ ...custom, channel: "sms" }, { recipients: one }).error, /canal/);
});

test("confirmar un correo exige la casilla, un borrador de correo y la huella que se vio", () => {
  const draft = adaptCommunication(api());
  assert.deepEqual(out.communicationConfirmBody(draft, { seenHash: HASH, confirmed: true }).body, { version: 1, contentHash: HASH, confirm: true });
  assert.match(out.communicationConfirmBody(draft, { seenHash: HASH, confirmed: false }).error, /casilla/);
  assert.match(out.communicationConfirmBody(draft, { seenHash: "b".repeat(64), confirmed: true }).error, /cambió desde la vista previa/);
  assert.match(out.communicationConfirmBody({ ...draft, status: "queued" }, { seenHash: HASH, confirmed: true }).error, /borrador/);
  assert.match(out.communicationConfirmBody({ ...draft, channel: "whatsapp" }, { seenHash: HASH, confirmed: true }).error, /borrador/);
  assert.deepEqual(out.communicationVersionBody(draft).body, { version: 1 });
});

test("declarar un WhatsApp exige haberlo abierto y la casilla", () => {
  const opened = adaptCommunication(api({ channel: "whatsapp", status: "opened", version: 2 }));
  assert.deepEqual(out.communicationDeclareBody(opened, true).body, { version: 2, confirm: true });
  assert.match(out.communicationDeclareBody(opened, false).error, /casilla/);
  assert.match(out.communicationDeclareBody({ ...opened, status: "draft" }, true).error, /abriste/);
  assert.match(out.communicationDeclareBody(adaptCommunication(api()), true).error, /abriste/);
});

// ---------- Documentos ----------

const doc = (patch = {}) => ({ id: U(10), projectId: PROJECT, title: "Contrato", kind: "contract", visibility: "internal", status: "active", fileName: "c.pdf", mediaType: "application/pdf", sizeBytes: 1024, sha256: "f".repeat(64), version: 2, uploadedAt: "2026-10-10T16:26:21.325Z", archivedAt: null, archiveReason: null, createdAt: "2026-10-10T16:00:00.000Z", createdBy: U(5), ...patch });

test("documento: lo que el cliente ve es solo activo + compartido", () => {
  assert.equal(adaptDocument(doc()).clientVisible, false);
  assert.equal(adaptDocument(doc({ visibility: "client" })).clientVisible, true);
  assert.equal(adaptDocument(doc({ visibility: "client", status: "archived" })).clientVisible, false);
  assert.equal(adaptDocument(doc({ visibility: "client", status: "pending", sizeBytes: null, sha256: null })).clientVisible, false);
  assert.equal(adaptDocument(doc({ sha256: null })).sha256, null);
  assert.equal(adaptDocument(doc({ archiveReason: null })).archiveReason, "");
});

test("archivo: tipo, tamaño, nombre y extensión se revisan antes de subir", () => {
  const ok = { name: "contrato.pdf", type: "application/pdf", size: 1000 };
  assert.deepEqual(checkFile(ok), { fileName: "contrato.pdf", mediaType: "application/pdf" });
  assert.match(checkFile(null).error, /Elegí/);
  assert.match(checkFile({ ...ok, type: "image/svg+xml" }).error, /PDF, PNG, JPEG o WebP/);
  assert.match(checkFile({ ...ok, type: "text/html", name: "x.html" }).error, /PDF, PNG/);
  assert.match(checkFile({ ...ok, size: 0 }).error, /vacío/);
  assert.match(checkFile({ ...ok, size: MAX_DOCUMENT_BYTES + 1 }).error, /5 MB/);
  assert.equal(checkFile({ ...ok, size: MAX_DOCUMENT_BYTES }).error, undefined);
  assert.match(checkFile({ ...ok, name: "contrato.png" }).error, /extensión/);
  assert.match(checkFile({ ...ok, name: ".pdf" }).error, /no es válido|corto/);
  assert.match(checkFile({ ...ok, name: "a/b.pdf" }).error, /no puede llevar/);
  assert.match(checkFile({ ...ok, name: `${"x".repeat(158)}.pdf` }).error, /160/);
  assert.match(checkFile({ ...ok, type: "image/png", name: "a.png" }, { expectedType: "application/pdf" }).error, /mismo tipo/);
  assert.equal(extensionMatches("image/jpeg", "foto.JPG"), true);
  assert.equal(extensionMatches("image/jpeg", "foto.png"), false);
  assert.ok(checkFileName("a‮b.pdf"), "los caracteres de formato invisibles se rechazan");
  assert.equal(formatBytes(1536), "1,5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5 MB");
  assert.equal(formatBytes(12), "12 B");
});

test("documento: cuerpos de crear, renombrar, publicar y archivar", () => {
  assert.deepEqual(out.documentCreateBody({ title: " Contrato ", kind: "contract", fileName: "c.pdf", mediaType: "application/pdf" }).body, { title: "Contrato", kind: "contract", fileName: "c.pdf", mediaType: "application/pdf" });
  assert.match(out.documentCreateBody({ title: "", kind: "contract" }).error, /Título/);
  assert.match(out.documentCreateBody({ title: "x", kind: "otra" }).error, /tipo/);
  const d = adaptDocument(doc());
  assert.deepEqual(out.documentRenameBody({ title: "Nuevo" }, d).body, { version: 2, title: "Nuevo" });
  assert.match(out.documentRenameBody({ title: "Contrato" }, d).error, /mismo/);
  // publicar: casilla + updates:send + archivo subido
  assert.deepEqual(out.documentVisibilityBody(d, "client", { confirmed: true, canPublish: true }).body, { version: 2, visibility: "client" });
  assert.match(out.documentVisibilityBody(d, "client", { confirmed: false }).error, /casilla/);
  assert.match(out.documentVisibilityBody(d, "client", { confirmed: true, canPublish: false }).error, /updates:send/);
  assert.match(out.documentVisibilityBody({ ...d, status: "pending" }, "client", { confirmed: true }).error, /subí el archivo/);
  assert.match(out.documentVisibilityBody({ ...d, status: "archived" }, "internal", { confirmed: true }).error, /archivado/);
  assert.deepEqual(out.documentVisibilityBody({ ...d, visibility: "client" }, "internal", { confirmed: false }).body, { version: 2, visibility: "internal" });
  assert.match(out.documentVisibilityBody(d, "internal", {}).error, /interno/);
  assert.deepEqual(out.documentArchiveBody({ reason: " Reemplazado ", confirm: "1" }, d).body, { version: 2, reason: "Reemplazado" });
  assert.match(out.documentArchiveBody({ reason: "", confirm: "1" }, d).error, /Motivo/);
  assert.match(out.documentArchiveBody({ reason: "x" }, d).error, /definitivo/);
  assert.match(out.documentArchiveBody({ reason: "x", confirm: "1" }, { ...d, status: "archived" }).error, /archivado/);
});

test("errores de documentos", () => {
  assert.match(documentErrorMessage({ status: 413 }, "upload"), /5 MB/);
  assert.match(documentErrorMessage({ status: 409 }, "upload"), /una sola vez/);
  assert.match(documentErrorMessage({ status: 409 }, "create"), /100/);
  assert.match(documentErrorMessage({ status: 400 }, "upload"), /contenido no coincide/);
  assert.match(documentErrorMessage({ status: 403 }, "patch"), /updates:send/);
  assert.equal(documentErrorMessage({ status: 500 }, "patch"), null);
});

// ---------- Importaciones ----------

const preview = (patch = {}) => ({ sourceVersion: 3, example: true, summary: { project: { new: 2, possible_duplicate: 1 }, payment: { new: 1, needs_input: 1 }, prospect: { new: 1 }, subscription: { not_modeled: 1 } },
  items: [
    { kind: "project", legacyId: "p1", label: "Uno", status: "new", reasons: [], warnings: [{ code: "maintenance_not_modeled", message: "m" }] },
    { kind: "project", legacyId: "p2", label: "Dos", status: "new", reasons: [], warnings: [] },
    { kind: "project", legacyId: "p3", label: "Tres", status: "possible_duplicate", reasons: [{ code: "similar_existing:abc", message: "x" }], warnings: [] },
    { kind: "payment", legacyId: "c1", label: "Seña", status: "new", reasons: [], warnings: [] },
    { kind: "payment", legacyId: "c2", label: "Otro", status: "needs_input", reasons: [{ code: "payment_kind_required", message: "Hay que elegir qué tipo de cobro es." }], warnings: [] },
    { kind: "prospect", legacyId: "l1", label: "Lead", status: "new", reasons: [], warnings: [] },
    { kind: "subscription", legacyId: "s1", label: "Abono", status: "not_modeled", reasons: [{ code: "subscriptions_not_modeled", message: "s" }], warnings: [] },
  ],
  needs: { projectAssignments: [{ projectId: "p1", label: "Uno" }, { projectId: "p2", label: "Dos" }], paymentKinds: [{ paymentId: "c2", label: "Otro · USD 100" }], duplicates: [{ kind: "project", legacyId: "p3", label: "Tres" }] },
  notModeled: { auditEntries: 4, subscriptions: 1 }, previewHash: HASH, ...patch });
const imp = (patch = {}) => adaptImport({ id: U(20), status: "previewed", sourceVersion: 3, example: true, payloadSha256: "c".repeat(64), payloadBytes: 5000, createdAt: "2026-10-10T16:00:00Z", createdBy: U(5), committedAt: null, committedBy: null, preview: preview(), ...patch });

test("importación: la revisión y el informe se adaptan con motivos en español", () => {
  const view = imp();
  assert.equal(view.preview.items[0].warnings[0].message, "El abono de mantenimiento no se modela: queda en el respaldo.");
  assert.match(view.preview.items[2].reasons[0].message, /parecido en el sistema/);
  assert.equal(view.preview.needs.paymentKinds[0].paymentId, "c2");
  assert.equal(view.example, true);
  // el informe trae códigos crudos: se traducen
  const report = adaptImport({ id: U(21), status: "committed", report: { created: { projects: 2 }, notImported: 1, items: [{ kind: "payment", legacyId: "c9", label: "x", outcome: "not_imported", status: "invalid", id: null, reasons: ["payment_without_project", "codigo_nuevo"], warnings: [] }], notModeled: { auditEntries: 0, subscriptions: 2, stageHistory: true }, notes: ["n"] } });
  assert.equal(report.report.items[0].reasons[0].message, "El cobro no está asociado a un proyecto: no hay dónde registrarlo.");
  assert.equal(report.report.items[0].reasons[1].message, "Revisar este registro.");
  assert.equal(report.report.notModeled.stageHistory, true);
  assert.equal(explainReason("similar_existing:uuid").code, "similar_existing:uuid");
  // un OpenAPI laxo: la forma incompleta no rompe
  assert.equal(adaptImport({ id: U(22), status: "previewed" }).preview, null);
  assert.deepEqual(adaptImport({ id: U(22), status: "previewed", preview: {} }).preview.items, []);
});

test("importación: resumen, filtros y paginación del lado del navegador", () => {
  const rows = summaryRows(preview().summary);
  assert.deepEqual(rows.map((row) => [row.kind, row.total]), [["prospect", 1], ["project", 3], ["payment", 2], ["subscription", 1]]);
  const items = imp().preview.items;
  assert.equal(filterItems(items, { kind: "project" }).length, 3);
  assert.equal(filterItems(items, { status: "new" }).length, 4);
  assert.equal(filterItems(items, { kind: "payment", status: "needs_input" }).length, 1);
  const many = Array.from({ length: 45 }, (_, i) => i);
  assert.deepEqual(paginate(many, 1), { items: many.slice(0, 20), page: 1, pages: 3, total: 45, from: 1, to: 20 });
  assert.equal(paginate(many, 3).items.length, 5);
  assert.equal(paginate(many, 99).page, 3);
  assert.equal(paginate([], 1).from, 0);
});

test("decisiones: los proyectos parecidos que se importan también necesitan dueño", () => {
  const p = imp().preview;
  assert.equal(projectSlots(p).length, 3);
  assert.equal(requiredDecisions(p, { duplicates: {} }).projects.length, 2);
  const withDup = requiredDecisions(p, { duplicates: { "project:p3": "import" } });
  assert.deepEqual(withDup.projects.map((x) => x.projectId), ["p1", "p2", "p3"]);
  assert.equal(withDup.prospects, 1);
  assert.deepEqual(expectedCounts(p, { duplicates: {} }), { project: 2, payment: 1, prospect: 1 });
  assert.equal(expectedCounts(p, { duplicates: { "project:p3": "import" } }).project, 3);
  assert.equal(expectedCounts(p, { duplicates: {}, paymentKinds: { c2: "final" } }).payment, 2, "el cobro ambiguo cuenta cuando se le elige tipo");
  const flat = { a0: "internal", a1: CLIENT, a2: "internal", k0: "maintenance", d0: "import", followUpOn: "2026-11-01", ack: "1" };
  const decisions = decisionsFromFlat(p, flat);
  assert.deepEqual(decisions.assignments, { p1: "internal", p2: CLIENT, p3: "internal" });
  assert.deepEqual(decisions.paymentKinds, { c2: "maintenance" });
  assert.deepEqual(decisions.duplicates, { "project:p3": "import" });
  // sin decidir importar el parecido, su asignación no cuenta
  assert.deepEqual(decisionsFromFlat(p, { ...flat, d0: "" }).assignments, { p1: "internal", p2: CLIENT });
});

test("commit: cada decisión es explícita y el cuerpo es exactamente lo que el servidor exige", () => {
  const p = imp().preview;
  const clients = [{ id: CLIENT }];
  const full = { assignments: { p1: "internal", p2: CLIENT }, paymentKinds: { c2: "deposit" }, duplicates: { "project:p3": "skip" }, followUpOn: "2026-10-20", acknowledgeExample: true, confirmed: true };
  const { body } = out.importCommitBody(p, full, { today: "2026-10-10", knownClients: clients });
  assert.deepEqual(body, { confirm: true, previewHash: HASH, assignments: [{ projectId: "p1", clientId: null }, { projectId: "p2", clientId: CLIENT }], paymentKinds: [{ paymentId: "c2", kind: "deposit" }], duplicates: [{ kind: "project", legacyId: "p3", action: "skip" }], acknowledgeExample: true, followUpOn: "2026-10-20" });
  const bad = (patch, opts) => out.importCommitBody(p, { ...full, ...patch }, { today: "2026-10-10", knownClients: clients, ...opts }).error;
  assert.match(bad({ assignments: { p1: "internal" } }), /Elegí el cliente de «Dos»/);
  assert.match(bad({ assignments: { p1: "internal", p2: U(77) } }), /ya no está en la lista/);
  assert.match(bad({ paymentKinds: {} }), /tipo de cobro/);
  assert.match(bad({ paymentKinds: { c2: "otro" } }), /tipo de cobro/);
  assert.match(bad({ followUpOn: "" }), /próxima acción/);
  assert.match(bad({ followUpOn: "2026-10-09" }), /hoy o una fecha futura/);
  assert.match(bad({ acknowledgeExample: false }), /EJEMPLO/);
  assert.match(bad({ confirmed: false }), /confirmación final/);
  // un parecido importado suma un proyecto a asignar
  assert.match(bad({ duplicates: { "project:p3": "import" } }), /Elegí el cliente de «Tres»/);
  assert.equal(bad({ duplicates: { "project:p3": "import" }, assignments: { ...full.assignments, p3: "internal" } }), undefined);
  // sin revisión no hay commit
  assert.match(out.importCommitBody(null, full).error, /revisión/);
  // sin prospectos ni example no hace falta fecha ni reconocimiento
  const lean = imp({ preview: preview({ example: false, items: preview().items.filter((i) => i.kind !== "prospect") }) }).preview;
  assert.equal(out.importCommitBody(lean, { ...full, followUpOn: "", acknowledgeExample: false }, { today: "2026-10-10", knownClients: clients }).body.followUpOn, undefined);
});

test("archivo de respaldo: solo el .json que produce la demostración", () => {
  const backup = makeBackup(7);
  const text = JSON.stringify(backup, null, 2);
  const built = out.importFileBody(text, { name: "eclipse-ops.json" });
  assert.equal(built.body.backup.version, 3);
  assert.ok(built.bytes > 1000);
  assert.match(out.importFileBody("{no", { name: "a.json" }).error, /JSON válido/);
  assert.match(out.importFileBody("[]").error, /no es un respaldo/);
  assert.match(out.importFileBody(JSON.stringify({ origen: "servidor", datos: {} })).error, /copia de lo que ve el servidor/);
  assert.match(out.importFileBody(JSON.stringify({ ...backup, projects: undefined })).error, /«projects»/);
  assert.match(out.importFileBody(JSON.stringify({ ...backup, version: 9 })).error, /versión/);
  assert.match(out.importFileBody(JSON.stringify({ ...backup, audit: Array.from({ length: 80000 }, (_, i) => ({ id: `a${i}`, title: "x".repeat(60) })) })).error, /4 MB/);
});

test("fixture del respaldo: ids, nombres y códigos propios por corrida y referencias intactas", () => {
  const a = makeBackup(1);
  const b = makeBackup(2);
  assert.notEqual(a.projects[0].id, b.projects[0].id);
  assert.notEqual(a.projects[0].code, b.projects[0].code);
  assert.equal(a.example, true);
  assert.ok(a.payments.every((payment) => !payment.projectId || a.projects.some((project) => project.id === payment.projectId)));
  assert.ok(a.prospects.filter((prospect) => prospect.batchId).every((prospect) => a.batches.some((batch) => batch.id === prospect.batchId)));
  assert.equal(makeBackup(3, { sameNamesAs: 1 }).projects[0].name, a.projects[0].name, "mismo nombre, otro id: el servidor lo ve como parecido");
  assert.match(importErrorMessage({ status: 409 }, "commit"), /Volvimos a pedir la revisión/);
  assert.match(importErrorMessage({ status: 413 }, "preview"), /4 MB/);
  assert.match(importErrorMessage({ status: 403 }, "commit"), /leads:write/);
  assert.equal(importErrorMessage({ status: 500 }, "commit"), null);
});

// ---------- Cliente HTTP: subida y descarga binarias ----------

test("api.upload manda el archivo tal cual con su Content-Type y el CSRF; api.download devuelve el Blob", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    if (path.endsWith("/auth/admin/csrf")) return new Response(JSON.stringify({ csrfToken: "sess" }), { status: 200 });
    if (init.method === "POST") return new Response(JSON.stringify({ document: { id: "d" } }), { status: 200 });
    if (path.endsWith("/missing/content")) return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
    return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="a.pdf"' } });
  };
  const client = createApiClient({ baseUrl: "https://api.test/api/v1", fetchImpl, sleep: async () => {} });
  const file = new Blob([new Uint8Array([37, 80, 68, 70, 45])], { type: "application/pdf" });
  const result = await client.upload("/admin/documents/d/content", file, { contentType: "application/pdf" });
  assert.deepEqual(result, { document: { id: "d" } });
  const post = calls.find((call) => call.init.method === "POST");
  assert.equal(post.init.headers["Content-Type"], "application/pdf");
  assert.equal(post.init.headers["X-CSRF-Token"], "sess");
  assert.equal(post.init.body, file, "el cuerpo es el archivo, no JSON");
  assert.equal(post.init.headers["Idempotency-Key"], undefined, "una subida nunca se reintenta sola");
  const download = await client.download("/admin/documents/d/content");
  assert.equal(download.blob.size, 4);
  assert.equal(download.contentType, "application/pdf");
  assert.match(download.disposition, /attachment/);
  await assert.rejects(client.download("/admin/documents/missing/content"), (error) => error instanceof ApiError && error.status === 404);
});
