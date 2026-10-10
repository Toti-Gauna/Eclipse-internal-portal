// Prueba de navegador de Comunicaciones, Documentos e Importaciones contra el backend REAL (servidor e2e de Eclipse-be, docs/e2e.md).
//
//   E2E_API=http://localhost:3203 E2E_PORTAL=http://localhost:4203 npm run test:live:comms
//
// Mismos requisitos que tests/live-browser.mjs (portal servido en el origen admin permitido; "localhost" en ambos). Se saltea con un
// aviso si faltan E2E_API o E2E_PORTAL, o si el servidor no responde. Usa UN solo ingreso de administrador (el límite de credenciales
// es de ~50 intentos por 15 min por IP) y datos propios de cada corrida: la base es compartida y descartable.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicConfig } from "../scripts/build-public-config.mjs";
import { makeBackup } from "./support/backup-fixture.mjs";
import { adminApi } from "./support/e2e-admin-api.mjs";
import { E2E_ADMIN, freshAdminCode } from "./support/e2e-admin.mjs";
import { createClientSession } from "./support/e2e-client.mjs";
import { clientWeb } from "./support/e2e-client-web.mjs";

const API = process.env.E2E_API?.replace(/\/+$/, "");
const PORTAL = process.env.E2E_PORTAL?.replace(/\/+$/, "");
if (!API || !PORTAL) {
  console.log("SALTEADO: la prueba live de comunicaciones necesita E2E_API (p. ej. http://localhost:3203) y E2E_PORTAL (p. ej. http://localhost:4203).");
  console.log("Levantá el servidor e2e de Eclipse-be (docs/e2e.md), servilo con `python3 -m http.server 4203` y volvé a correr `npm run test:live:comms`.");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = resolve(root, "test-results/live-comms");
mkdirSync(shots, { recursive: true });

// Elegir el archivo y esperar a que la pantalla lo muestre antes de tocar «Subir»: la lista de importaciones puede redibujar la tarjeta justo ahí.
async function pickBackup(page, file) {
  const name = typeof file === "string" ? file.split("/").pop() : file.name;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.setInputFiles("#li-file", file);
    try { await page.locator("#li-file-status", { hasText: name }).waitFor({ timeout: 4000 }); return; } catch { /* se redibujó: se vuelve a elegir */ }
  }
  throw new Error(`La pantalla no mostró el archivo elegido (${name}).`);
}

try {
  assert.equal((await fetch(`${API}/__e2e/health`)).ok, true);
} catch {
  console.log(`SALTEADO: el servidor e2e no responde en ${API}/__e2e/health.`);
  process.exit(0);
}

const { config, errors } = buildPublicConfig({ PUBLIC_PORTAL_MODE: "live", PUBLIC_API_BASE_URL: `${API}/api/v1`, PUBLIC_CLIENT_PORTAL_URL: "http://localhost:3001/es/portal" });
assert.ok(config, errors?.join(" "));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
const errorsSeen = [];
let checks = 0;
const check = (message) => { checks++; console.log(`✓ ${message}`); };
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function newPage(context, { theme = "dark", width = 1440, height = 1000 } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.addInitScript((value) => { try { if (!localStorage.getItem("eclipse-theme")) localStorage.setItem("eclipse-theme", value); } catch { /* sin storage */ } }, theme);
  await page.route(`${PORTAL}/public-config.json`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(config) }));
  page.on("pageerror", (error) => errorsSeen.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/status of (400|401|403|404|409|413|429|503)|net::ERR_FAILED/.test(message.text())) errorsSeen.push(`console: ${message.text()}`); });
  return page;
}
const ready = async (page) => { await page.goto(`${PORTAL}/`); await page.waitForFunction(() => document.documentElement.dataset.loader === "done"); };
const noOverflow = async (page, label) => {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(scroll <= inner, `${label}: desborde horizontal (${scroll} > ${inner})`);
};
const toast = async (page, text, timeout = 20000) => {
  try {
    await page.locator(".toast", { hasText: text }).first().waitFor({ timeout });
  } catch (error) {
    const visible = await page.locator("#modal-error, #wizard-error, .form-error, .toast").allTextContents().catch(() => []);
    throw new Error(`No apareció el aviso «${text}». En pantalla: ${JSON.stringify(visible.filter(Boolean))}`, { cause: error });
  }
};
const goto = async (page, hash) => { await page.evaluate((value) => { location.hash = value; }, hash); await page.waitForFunction((value) => location.hash === value, hash); };
const login = async (page) => {
  await page.fill("#auth-email", E2E_ADMIN.email);
  await page.fill("#auth-password", E2E_ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector("#auth-code");
  await page.fill("#auth-code", await freshAdminCode(API.replace("localhost", "127.0.0.1")));
  await page.click('button[type="submit"]');
  await page.waitForSelector('.pt-mode[data-mode="live"]');
};
// El límite general de la API es de 120 pedidos por minuto y por IP: antes de cada fase pesada se espera a que la ventana tenga margen.
const calm = async (needed = 60) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(`${API}/api/v1/auth/csrf`, { headers: { Origin: PORTAL } });
    const remaining = Number(/r=(\d+)/.exec(response.headers.get("ratelimit") || "")?.[1] ?? 999);
    if (remaining >= needed) return;
    await sleep(3000);
  }
};
const mailTo = async (email) => (await (await fetch(`${API}/__e2e/mail?to=${encodeURIComponent(email)}`)).json()).mail;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");
const work = join(tmpdir(), `eclipse-comms-e2e-${Date.now()}`);
mkdirSync(work, { recursive: true });
const commsOf = async (admin, projectId) => (await admin.get(`/admin/communications?projectId=${projectId}&limit=50`)).body.communications;

try {
  const stamp = Date.now();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce", acceptDownloads: true });
  await context.route("https://wa.me/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>wa.me simulado</h1>" }));
  const page = await newPage(context);
  await ready(page);
  await login(page);
  const admin = adminApi({ context, api: API, origin: PORTAL });
  const me = (await admin.get("/auth/admin/me")).body.admin;
  for (const permission of ["communications:read", "communications:send", "documents:read", "documents:write", "imports:run", "updates:send"]) assert.ok(me.permissions.includes(permission), `el administrador de prueba necesita ${permission}`);
  let emailBudget = true;
  let draftId = null;
  let waId = null;
  // El servidor deja 20 correos por administrador por hora: si el cupo está casi agotado, esta prueba no puede confirmar el suyo.
  {
    const hourAgo = Date.now() - 3_600_000;
    const sent = ((await admin.get("/admin/communications?channel=email&limit=50")).body?.communications || []).filter((entry) => entry.confirmedBy === me.id && entry.confirmedAt && Date.parse(entry.confirmedAt) > hourAgo && entry.status !== "cancelled");
    if (sent.length >= 20) {
      const frees = new Date(Math.min(...sent.map((entry) => Date.parse(entry.confirmedAt))) + 3_600_000);
      console.log(`AVISO: el administrador de prueba ya confirmó ${sent.length} de 20 correos en la última hora (tope del servidor): se saltea Comunicaciones y se corren Documentos e Importaciones. Se libera un cupo a las ${frees.toISOString()}.`);
      emailBudget = false;
    }
  }
  const storageBefore = await page.evaluate(() => ({ local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage) }));

  // ---- Datos: un cliente real con teléfono, un proyecto con ese cliente, una novedad publicada, una nota interna, un hito visible ----
  const client = await createClientSession(API, { email: `comms-e2e-${stamp}@example.test`, displayName: "Clínica Comms" });
  await client.submitPlanRequest({ name: "Clínica Comms", phone: "+5491155550000" });
  const project = await admin.createProject({ name: `Comms ${stamp}`, clientId: client.clientId });
  const published = await admin.publishUpdate(project.id, { title: "Primera entrega lista", body: "La landing ya está en staging.\nFalta cargar los textos finales." });
  const note = await admin.post(`/admin/projects/${project.id}/updates`, { kind: "internal_note", body: "NOTA INTERNA: el cliente pidió descuento." });
  assert.equal(note.status, 201);
  const milestone = await admin.visibleMilestone(project.id, { title: "Landing en producción" });

  // El portal cachea la lista de proyectos un minuto: se recarga para que vea los datos preparados por detrás.
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.loader === "done");
  await page.waitForSelector('.pt-mode[data-mode="live"]');

  // ============================ COMUNICACIONES ============================
  if (emailBudget) {
  // ---- 1. El enlace desde la ficha del proyecto (gancho mínimo) lleva al redactor con el proyecto elegido ----
  await goto(page, `#proyectos/${project.id}`);
  await page.locator(".pt-current").waitFor();
  const link = page.locator('a[href^="#comunicaciones/p-"]');
  await link.waitFor();
  assert.ok(await page.locator(`a[href="#documentos/${project.id}"]`).count() === 1, "la ficha enlaza a los documentos");
  await link.click();
  await page.waitForSelector(".lc-grid");
  await page.waitForFunction((id) => document.querySelector("#lc-cproject")?.value === id, project.id);
  await page.locator('input[name="lc-cClient"]:checked').waitFor();
  assert.match(await page.locator(".lc-choice:has(input:checked)").first().textContent(), /Email verificado/);
  check("«Comunicar al cliente» en la ficha abre el redactor con el proyecto y el único destinatario elegidos");

  // ---- 2. Novedad publicada → vista previa exacta (sin enviar nada) ----
  await page.waitForFunction(() => document.querySelectorAll("#lc-update option").length > 1);
  const optionTexts = await page.locator("#lc-update option").allTextContents();
  assert.equal(optionTexts.length, 2, "solo la novedad publicada: ni la nota interna ni borradores");
  assert.ok(!optionTexts.join(" ").includes("NOTA INTERNA"));
  await page.selectOption("#lc-update", published.id);
  assert.match(await page.locator(".lc-source").textContent(), /La landing ya está en staging/);
  await page.fill("#lc-message", "Cualquier duda, escribime.");
  assert.equal(await page.inputValue("#lc-message"), "Cualquier duda, escribime.", "el texto sobrevive a un redibujado");
  await page.click('[data-action="comm-prepare"]');
  await page.waitForFunction(() => /^#comunicaciones\/[0-9a-f-]{36}$/.test(location.hash));
  await page.locator(".lc-mail-text").waitFor();
  draftId = (await page.evaluate(() => location.hash)).split("/")[1];
  const draft = (await admin.get(`/admin/communications/${draftId}`)).body.communication;
  assert.equal(draft.status, "draft");
  assert.equal((await page.locator(".lc-mail-text").textContent()), draft.text, "la vista previa es exactamente el texto del servidor");
  assert.match(draft.text, /Cualquier duda, escribime\./);
  assert.ok(!draft.text.includes("NOTA INTERNA"));
  assert.equal(await page.locator(".lc-mail-head dd").first().textContent(), client.email);
  assert.match(await page.locator(".lc-hash").first().textContent(), new RegExp(draft.contentHash.slice(0, 8)));
  await page.locator(".pt-tag", { hasText: "Borrador" }).first().waitFor();
  assert.equal((await mailTo(client.email)).filter((mail) => mail.purpose === "communication").length, 0, "preparar no envía nada");
  await noOverflow(page, "comunicación 1440");
  check("la vista previa es el texto exacto del servidor, sin notas internas, y preparar no envía ni encola nada");

  // ---- 3. Confirmación explícita → «queued» → «accepted_by_smtp» (nunca «entregado») ----
  await page.click('[data-action="comm-confirm"]');
  await page.waitForSelector("dialog[open]");
  assert.equal(await page.locator('dialog [name="confirm"]').getAttribute("required"), "", "la casilla es obligatoria");
  await page.click('dialog button[type="submit"]');
  assert.equal(await page.locator("dialog[open]").count(), 1, "sin casilla no se envía");
  assert.equal((await admin.get(`/admin/communications/${draftId}`)).body.communication.status, "draft");
  await page.check('dialog [name="confirm"]');
  await page.click('dialog button[type="submit"]');
  await toast(page, "En cola");
  await page.locator(".pt-tag", { hasText: "Aceptado por el servidor de correo" }).waitFor({ timeout: 40000 });
  assert.match(await page.locator(".lc-evidence").textContent(), /NO prueba que haya llegado/);
  assert.equal(await page.locator("body").textContent().then((text) => /entregado correctamente|se entregó/i.test(text)), false);
  const accepted = (await admin.get(`/admin/communications/${draftId}`)).body.communication;
  assert.equal(accepted.status, "accepted_by_smtp");
  assert.equal(accepted.evidence, "smtp_accepted");
  const sent = (await mailTo(client.email)).filter((mail) => mail.purpose === "communication");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, draft.text, "el correo que salió es el texto que se aprobó");
  check("correo: confirmar → en cola → «aceptado por el servidor de correo», con el aviso de que no prueba entrega, y el registrador recibió el texto aprobado");

  // ---- 4. Hito visible + cancelar un borrador ----
  await goto(page, `#comunicaciones/p-${project.id}`);
  await page.locator('input[name="lc-cClient"]:checked').waitFor();
  await page.check('input[name="lc-cPurpose"][value="milestone"]');
  await page.waitForFunction(() => document.querySelectorAll("#lc-milestone option").length > 1);
  await page.selectOption("#lc-milestone", milestone.id);
  await page.check('input[name="lc-cChannel"][value="whatsapp"]');
  await page.click('[data-action="comm-prepare"]');
  await page.waitForFunction(() => /^#comunicaciones\/[0-9a-f-]{36}$/.test(location.hash));
  await page.locator(".lc-mail-text").waitFor();
  assert.match(await page.locator(".lc-mail-text").textContent(), /Landing en producción/);
  await page.locator('[data-action="comm-cancel"]').click();
  await page.waitForSelector("dialog[open]");
  await page.click('dialog button[type="submit"]');
  await toast(page, "Borrador descartado");
  await page.locator(".pt-tag", { hasText: "Cancelado" }).waitFor();
  check("un hito visible se prepara para WhatsApp y el borrador se descarta (queda cancelado, no se borra)");

  // ---- 5. WhatsApp: manual. Abrir se registra en el servidor; «enviado» es una declaración ----
  await goto(page, `#comunicaciones/p-${project.id}`);
  await page.locator('input[name="lc-cClient"]:checked').waitFor();
  await page.check('input[name="lc-cChannel"][value="whatsapp"]');
  await page.check('input[name="lc-cPurpose"][value="custom"]');
  assert.equal(await page.locator("#lc-subject").count(), 0, "WhatsApp no lleva asunto");
  await page.fill("#lc-message", "Hola, mañana te mando la landing.");
  await page.click('[data-action="comm-prepare"]');
  await page.waitForFunction(() => /^#comunicaciones\/[0-9a-f-]{36}$/.test(location.hash));
  await page.locator(".lc-mail-text").waitFor();
  waId = (await page.evaluate(() => location.hash)).split("/")[1];
  assert.equal(await page.locator('[data-action="comm-declare"]').count(), 0, "no se puede declarar sin abrir");
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.click('[data-action="comm-wa-open"]')]);
  assert.match(popup.url(), /^https:\/\/wa\.me\/5491155550000\?text=/);
  await popup.close();
  await page.locator(".pt-tag", { hasText: "WhatsApp abierto" }).waitFor();
  assert.equal((await admin.get(`/admin/communications/${waId}`)).body.communication.status, "opened");
  assert.match(await page.locator(".lc-evidence").textContent(), /Falta que lo envíes vos/);
  await page.click('[data-action="comm-declare"]');
  await page.waitForSelector("dialog[open]");
  assert.equal(await page.locator('dialog [name="confirm"]').getAttribute("required"), "");
  await page.check('dialog [name="confirm"]');
  await page.click('dialog button[type="submit"]');
  await toast(page, "Declarado como enviado");
  await page.locator(".pt-tag", { hasText: "Declarado como enviado" }).waitFor();
  assert.match(await page.locator(".lc-evidence").textContent(), /No hay comprobante de entrega/);
  const declared = (await admin.get(`/admin/communications/${waId}`)).body.communication;
  assert.equal(declared.status, "declared_sent");
  assert.equal(declared.evidence, "manual_declaration");
  assert.equal(declared.whatsappUrl, null, "ya enviado: el servidor deja de servir el enlace");
  check("WhatsApp manual: se registra «abierto» en el servidor, se declara «enviado» con confirmación y se aclara que no es comprobante");

  // ---- 6. Errores: SMTP apagado (503) sin romper WhatsApp, tope de envíos real (429), contenido retirado (409) ----
  await goto(page, `#comunicaciones/p-${project.id}`);
  await page.locator('input[name="lc-cClient"]:checked').waitFor();
  await page.waitForFunction(() => document.querySelectorAll("#lc-update option").length > 1);
  await page.selectOption("#lc-update", published.id);
  await page.route(`${API}/api/v1/admin/communications`, (route) => (route.request().method() === "POST" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "x" } }) }) : route.continue()));
  await page.click('[data-action="comm-prepare"]');
  await page.locator("#lc-compose-error", { hasText: "SMTP sin configurar" }).waitFor();
  await page.locator(".lc-banner", { hasText: "El correo está apagado" }).waitFor();
  assert.match(await page.locator("#lc-compose-error").textContent(), /WhatsApp/);
  await page.unroute(`${API}/api/v1/admin/communications`);
  check("SMTP apagado (503): se explica que el correo está apagado y que WhatsApp sigue disponible");

  // 409 por contenido retirado: se prepara un borrador y, antes de confirmar, la novedad se retira desde la API.
  const extra = await admin.publishUpdate(project.id, { title: "Segunda novedad", body: "Texto que luego se retira." });
  await goto(page, "#comunicaciones");
  await goto(page, `#comunicaciones/p-${project.id}`);
  await page.locator('input[name="lc-cClient"]:checked').waitFor();
  await page.waitForFunction(() => document.querySelectorAll("#lc-update option").length > 2);
  await page.selectOption("#lc-update", extra.id);
  await page.click('[data-action="comm-prepare"]');
  await page.waitForFunction(() => /^#comunicaciones\/[0-9a-f-]{36}$/.test(location.hash));
  await page.locator(".lc-mail-text").waitFor();
  const staleId = (await page.evaluate(() => location.hash)).split("/")[1];
  const withdrawn = await admin.post(`/admin/projects/${project.id}/updates/${extra.id}/withdraw`, { version: extra.version, reason: "Era un error" });
  assert.equal(withdrawn.status, 200);
  await page.click('[data-action="comm-confirm"]');
  await page.waitForSelector("dialog[open]");
  await page.check('dialog [name="confirm"]');
  await page.click('dialog button[type="submit"]');
  await page.locator("#modal-error", { hasText: "No se pudo confirmar" }).waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 1, "el diálogo sigue abierto con el motivo");
  assert.equal((await admin.get(`/admin/communications/${staleId}`)).body.communication.status, "draft", "no se envió nada");
  assert.equal((await mailTo(client.email)).filter((mail) => mail.purpose === "communication").length, 1, "sigue habiendo un solo correo");
  await page.click('dialog [data-action="close-modal"]');
  check("409: un contenido retirado después de la vista previa no se envía y se explica");

  // 429: el tope es 3 correos por cliente por día (y 20 por administrador por hora, compartido con quien use este servidor de pruebas).
  // Por defecto se simula la respuesta del servidor para no gastar ese cupo; con E2E_COMMS_REAL_LIMIT=1 se agota de verdad (gasta 3 correos más).
  const fresh = await admin.publishUpdate(project.id, { title: "Quinta novedad", body: "Texto de la quinta." });
  if (process.env.E2E_COMMS_REAL_LIMIT === "1") {
    for (const title of ["Tercera novedad", "Cuarta novedad"]) {
      const update = await admin.publishUpdate(project.id, { title, body: `Texto de ${title}.` });
      const created = await admin.post("/admin/communications", { projectId: project.id, clientId: client.clientId, channel: "email", purpose: "update", language: "es", updateId: update.id });
      assert.equal(created.status, 201);
      const confirmed = await admin.post(`/admin/communications/${created.body.communication.id}/confirm`, { version: created.body.communication.version, contentHash: created.body.communication.contentHash, confirm: true });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    }
  }
  const over = await admin.post("/admin/communications", { projectId: project.id, clientId: client.clientId, channel: "email", purpose: "update", language: "es", updateId: fresh.id });
  assert.equal(over.status, 201, "preparar un borrador no cuenta para el tope");
  await goto(page, `#comunicaciones/${over.body.communication.id}`);
  await page.locator('[data-action="comm-confirm"]').waitFor();
  if (process.env.E2E_COMMS_REAL_LIMIT !== "1") await page.route(`${API}/api/v1/admin/communications/${over.body.communication.id}/confirm`, (route) => route.fulfill({ status: 429, contentType: "application/json", headers: { "Retry-After": "3600" }, body: JSON.stringify({ error: { code: "TOO_MANY_REQUESTS", message: "x" } }) }));
  await page.locator('[data-action="comm-confirm"]').click();
  await page.waitForSelector("dialog[open]");
  await page.check('dialog [name="confirm"]');
  await page.click('dialog button[type="submit"]');
  await page.locator("#modal-error", { hasText: "3 correos por cliente por día" }).waitFor();
  assert.equal((await admin.get(`/admin/communications/${over.body.communication.id}`)).body.communication.status, "draft");
  await page.click('dialog [data-action="close-modal"]');
  await page.unroute(`${API}/api/v1/admin/communications/${over.body.communication.id}/confirm`).catch(() => {});
  check(`429 ${process.env.E2E_COMMS_REAL_LIMIT === "1" ? "real" : "simulado"}: el cuarto correo del día al mismo cliente se frena con el tope explicado y queda en borrador`);

  // El destinatario sale del proyecto: el chat preparado ya no se puede abrir.
  const detail = (await admin.get(`/admin/projects/${project.id}`)).body.project;
  const waDraft = await admin.post("/admin/communications", { projectId: project.id, clientId: client.clientId, channel: "whatsapp", purpose: "custom", language: "es", message: "Mensaje que no va a salir." });
  assert.equal(waDraft.status, 201);
  await goto(page, `#comunicaciones/${waDraft.body.communication.id}`);
  await page.locator('[data-action="comm-wa-open"]').waitFor();
  const removed = await admin.post(`/admin/projects/${project.id}/members/${detail.members[0].id}/remove`);
  assert.ok([200, 204].includes(removed.status), JSON.stringify(removed.body));
  await page.click('[data-action="comm-wa-open"]');
  await toast(page, "Ya no se puede abrir");
  assert.equal((await admin.get(`/admin/communications/${waDraft.body.communication.id}`)).body.communication.status, "draft");
  await goto(page, `#comunicaciones/p-${project.id}`);
  await page.locator(".pt-fine", { hasText: "no tiene personas del cliente con acceso" }).waitFor();
  check("recipient fuera del proyecto: abrir WhatsApp responde 409 con explicación y el redactor avisa que no hay destinatarios");
  const restored = await admin.post(`/admin/projects/${project.id}/members`, { clientId: client.clientId, role: "client_admin" });
  assert.ok([200, 201].includes(restored.status), JSON.stringify(restored.body));

  // ---- 7. Historial con filtros ----
  await calm();
  await goto(page, "#comunicaciones");
  await page.locator(".pt-row").first().waitFor();
  await page.selectOption("#lc-project", project.id);
  await page.waitForFunction((n) => document.querySelectorAll(".pt-row").length >= n, 4);
  const allRows = await page.locator(".pt-row").count();
  await page.selectOption("#lc-channel", "whatsapp");
  await page.waitForFunction((n) => document.querySelectorAll(".pt-row").length < n, allRows);
  assert.ok((await page.locator(".pt-row").allTextContents()).every((text) => /WhatsApp/.test(text)));
  await page.selectOption("#lc-status", "declared_sent");
  await page.waitForFunction(() => document.querySelectorAll(".pt-row").length === 1);
  await page.selectOption("#lc-channel", "");
  await page.selectOption("#lc-status", "");
  await page.fill("#lc-client-email", client.email);
  await page.click('[data-action="comm-client-lookup"]');
  await page.locator(".lc-client-filter .pt-tag").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".pt-row").length >= 4);
  await noOverflow(page, "historial 1440");
  check("historial: filtros por proyecto, canal, estado y cliente (email exacto)");

  } else console.log("— Comunicaciones saltada (sin cupo de correo por hora) —");

  // ============================ DOCUMENTOS ============================
  await calm();
  const web = await clientWeb(API, { email: client.email });
  await goto(page, `#documentos/${project.id}`);
  await page.locator(".pt-empty, .ld-list").first().waitFor();
  await page.locator('[data-action="doc-create"]').first().click();
  await page.waitForSelector("dialog[open]");
  // El navegador frena lo evidente antes de pedirle nada al servidor.
  const uploads = [];
  page.on("request", (request) => { if (/\/admin\/documents\/.+\/content$/.test(request.url()) && request.method() === "POST") uploads.push(request.url()); });
  await page.fill('dialog [name="title"]', "Contrato");
  await page.setInputFiles('dialog [name="file"]', { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
  await page.click('dialog button[type="submit"]');
  await page.locator("#modal-error", { hasText: "Solo se admiten PDF, PNG, JPEG o WebP" }).waitFor();
  await page.setInputFiles('dialog [name="file"]', { name: "grande.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1) });
  await page.click('dialog button[type="submit"]');
  await page.locator("#modal-error", { hasText: "el máximo es 5 MB" }).waitFor();
  await page.setInputFiles('dialog [name="file"]', { name: "contrato.png", mimeType: "application/pdf", buffer: PDF });
  await page.click('dialog button[type="submit"]');
  await page.locator("#modal-error", { hasText: "extensión" }).waitFor();
  assert.equal(uploads.length, 0, "ninguna de esas subidas llegó al servidor");
  check("documentos: tipo, tamaño y extensión se revisan antes de subir");

  // La subida falla DESPUÉS de crear el registro: queda «sin archivo» y se dice la verdad.
  await page.setInputFiles('dialog [name="file"]', { name: "contrato.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.route(/\/admin\/documents\/[^/]+\/content$/, (route) => (route.request().method() === "POST" ? route.abort("failed") : route.continue()));
  await page.click('dialog button[type="submit"]');
  await page.locator("#modal-error", { hasText: "el archivo NO se subió" }).waitFor();
  await page.unroute(/\/admin\/documents\/[^/]+\/content$/);
  await page.click('dialog [data-action="close-modal"]');
  const pendingItem = page.locator(".ld-item", { hasText: "Contrato" });
  await pendingItem.locator(".pt-tag", { hasText: "Falta subir el archivo" }).waitFor();
  assert.match(await pendingItem.textContent(), /Sin archivo · el cliente no lo ve/);
  assert.equal(await pendingItem.locator('[data-action="doc-visibility"]').count(), 0, "un registro sin archivo no se puede mostrar al cliente");
  await pendingItem.locator('[data-action="doc-upload"]').click();
  await page.waitForSelector("dialog[open]");
  await page.setInputFiles('dialog [name="file"]', { name: "otro.png", mimeType: "image/png", buffer: Buffer.alloc(64, 1) });
  await page.click('dialog button[type="submit"]');
  await page.locator("#modal-error", { hasText: "mismo tipo" }).waitFor();
  await page.setInputFiles('dialog [name="file"]', { name: "contrato.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.click('dialog button[type="submit"]');
  await toast(page, "Archivo subido");
  const item = page.locator(".ld-item", { hasText: "Contrato" });
  await item.locator(".pt-tag", { hasText: "Activo" }).waitFor();
  assert.match(await item.textContent(), /Interno · el cliente no lo ve/);
  assert.match(await item.locator(".ld-hash").textContent(), new RegExp(sha(PDF)));
  assert.match(await item.textContent(), /Tamaño\s*\d+ B/);
  assert.equal(await item.locator('[data-shared]').count(), 0);
  const records = (await admin.get(`/admin/projects/${project.id}/documents`)).body.documents;
  const record = records.find((entry) => entry.title === "Contrato");
  assert.equal(record.sha256, sha(PDF));
  assert.equal(record.visibility, "internal");
  check("documentos: el registro creado queda «sin archivo» si la subida falla, se reintenta y muestra checksum, tamaño y que es interno");

  // Interno: el cliente no lo ve ni lo puede bajar.
  assert.deepEqual((await web.listDocuments(project.id)).documents, []);
  assert.equal((await web.download(record.id)).status, 404);
  await item.locator('[data-action="doc-rename"]').click();
  await page.waitForSelector("dialog[open]");
  await page.fill('dialog [name="title"]', "Contrato firmado");
  await page.click('dialog button[type="submit"]');
  await toast(page, "Título guardado");
  const renamed = page.locator(".ld-item", { hasText: "Contrato firmado" });
  await renamed.waitFor();
  check("documentos: un archivo interno es un 404 para el cliente; renombrar solo cambia el título");

  // Publicar: casilla obligatoria; el cliente lo descarga idéntico.
  await renamed.locator('[data-action="doc-visibility"]').click();
  await page.waitForSelector("dialog[open]");
  assert.equal(await page.locator('dialog [name="confirm"]').getAttribute("required"), "");
  await page.check('dialog [name="confirm"]');
  await page.click('dialog button[type="submit"]');
  await toast(page, "Compartido");
  await page.locator(".ld-item[data-shared]", { hasText: "Contrato firmado" }).waitFor();
  assert.match(await page.locator(".ld-item[data-shared]").textContent(), /Compartido con el cliente/);
  const shared = await web.listDocuments(project.id);
  assert.equal(shared.documents.length, 1);
  assert.equal(shared.documents[0].title, "Contrato firmado");
  assert.equal("sha256" in shared.documents[0], false, "el cliente no ve el checksum");
  const clientCopy = await web.download(record.id);
  assert.equal(clientCopy.status, 200);
  assert.ok(clientCopy.bytes.equals(PDF), "el cliente descarga exactamente los bytes subidos");
  assert.match(clientCopy.disposition, /attachment/);
  // Descarga del administrador desde la interfaz: fetch → Blob → archivo; verifica el SHA-256.
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator('.ld-item[data-shared] [data-action="doc-download"]').click()]);
  assert.equal(download.suggestedFilename(), "contrato.pdf");
  const savedPath = join(work, "bajado.pdf");
  await download.saveAs(savedPath);
  assert.ok(readFileSync(savedPath).equals(PDF));
  await toast(page, "El SHA-256 coincide");
  await noOverflow(page, "documentos 1440");
  check("documentos: publicar exige casilla, el cliente descarga los mismos bytes (sin checksum en su vista) y la descarga del admin verifica el SHA-256");

  // Ocultar y archivar con motivo: el cliente deja de verlo para siempre.
  await page.locator('.ld-item[data-shared] [data-action="doc-visibility"]').click();
  await page.waitForSelector("dialog[open]");
  await page.click('dialog button[type="submit"]');
  await toast(page, "Ahora es interno");
  assert.deepEqual((await web.listDocuments(project.id)).documents, []);
  assert.equal((await web.download(record.id)).status, 404);
  await page.locator(".ld-item", { hasText: "Contrato firmado" }).locator('[data-action="doc-archive"]').click();
  await page.waitForSelector("dialog[open]");
  await page.fill('dialog [name="reason"]', "Reemplazado por la versión 2");
  await page.check('dialog [name="confirm"]');
  await page.click('dialog button[type="submit"]');
  await toast(page, "Archivado");
  await page.click('[data-action="filter"][data-id="documentos.show"][data-kind="archivados"]');
  const archived = page.locator(".ld-item[data-archived]", { hasText: "Contrato firmado" });
  await archived.waitFor();
  assert.match(await archived.textContent(), /Reemplazado por la versión 2/);
  assert.equal(await archived.locator('[data-action="doc-rename"], [data-action="doc-visibility"], [data-action="doc-archive"]').count(), 0, "un archivado no se modifica");
  assert.equal((await web.download(record.id)).status, 404);
  assert.equal((await admin.download(`/admin/documents/${record.id}/content`)).status, 200, "los bytes se conservan para el admin");
  check("documentos: ocultar y archivar con motivo cortan el acceso del cliente; el archivado queda inmutable y descargable por el admin");

  // ============================ IMPORTACIONES ============================
  await calm();
  const backup = makeBackup(stamp);
  const backupPath = join(work, "respaldo.json");
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  await page.click('[data-action="open-data"], .workspace-menu summary').catch(() => {});
  await goto(page, "#hoy");
  await page.locator(".workspace-menu summary").click();
  await page.locator('[data-action="open-data"]').click();
  await page.waitForSelector("dialog[open]");
  assert.match(await page.locator("dialog").textContent(), /Importar el respaldo de la demostración/);
  assert.match(await page.locator("dialog").textContent(), /Tu navegador no se modifica/);
  await page.locator('dialog a[href="#importar"]').click();
  await page.waitForSelector("#li-file");
  // Un archivo que no es un respaldo se rechaza en el navegador; la copia del servidor tampoco.
  await pickBackup(page, { name: "servidor.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ origen: "servidor", datos: {} })) });
  await page.click('[data-action="imp-upload"]');
  await page.locator("#li-upload-error", { hasText: "copia de lo que ve el servidor" }).waitFor();
  await pickBackup(page, { name: "roto.json", mimeType: "application/json", buffer: Buffer.from("{no es json") });
  await page.click('[data-action="imp-upload"]');
  await page.locator("#li-upload-error", { hasText: "JSON válido" }).waitFor();
  await pickBackup(page, backupPath);
  await page.click('[data-action="imp-upload"]');
  await page.waitForFunction(() => /^#importar\/[0-9a-f-]{36}$/.test(location.hash));
  const importId = (await page.evaluate(() => location.hash)).split("/")[1];
  await page.locator(".li-table").waitFor();
  assert.match(await page.locator("#li-summary-title").textContent(), /Qué encontró/);
  const table = await page.locator(".li-table").textContent();
  assert.match(table, /Proyectos\s*5/);
  assert.match(table, /Abonos mensuales/);
  assert.match(await page.locator(".li-card[data-warn]").textContent(), /datos de ejemplo/);
  assert.match(await page.locator("#main-content").textContent(), /Todavía no se guardó nada/);
  assert.equal((await admin.get(`/admin/projects`)).body.projects.some((p) => p.name.includes(`T${stamp}`)), false, "revisar no escribe datos de negocio");
  assert.ok(await page.locator('[data-action="imp-commit"]').isDisabled(), "sin decisiones no se puede confirmar");
  check("importar: un archivo que no es respaldo se rechaza; el respaldo se sube y se revisa sin escribir nada (ejemplo, resumen, no modelado)");

  // Registro por registro: filtros y paginación del lado del navegador.
  await page.selectOption("#li-review-kind", "project");
  assert.equal(await page.locator(".li-item").count(), 5);
  assert.match(await page.locator(".li-reasons").first().textContent(), /abono de mantenimiento no se modela/);
  await page.selectOption("#li-review-kind", "");
  await page.selectOption("#li-review-status", "needs_input");
  assert.equal(await page.locator(".li-item").count(), 1);
  assert.match(await page.locator(".li-item").textContent(), /Hay que elegir qué tipo de cobro es/);
  await page.selectOption("#li-review-status", "");
  assert.ok(await page.locator(".li-pager").count() >= 1, "34 registros: hay más de una página");
  await page.click('.li-pager [aria-label="Página siguiente"]');
  assert.match(await page.locator(".li-pager").textContent(), /21–34 de 34/);
  check("importar: revisión registro por registro con motivos en español, filtros y paginación");

  // Decisiones.
  await calm();
  await page.fill("#li-email", client.email);
  await page.click('[data-action="imp-lookup"]');
  await toast(page, "Cliente agregado");
  await page.selectOption("#li-bulk", "internal");
  await page.click('[data-action="imp-assign-all"]');
  await page.selectOption("#li-a0", client.clientId);
  await page.selectOption("#li-k0", "installment");
  await page.fill("#li-follow", "2026-12-01");
  assert.ok(await page.locator('[data-action="imp-commit"]').isDisabled(), "falta reconocer el ejemplo");
  assert.match(await page.locator(".li-note").last().textContent(), /Falta: Este respaldo es de EJEMPLO/);
  await page.click('#li-ack'); await page.locator('#li-ack:checked').waitFor();
  // Un re-dibujado no pierde las decisiones.
  await page.selectOption("#li-review-kind", "payment");
  assert.equal(await page.inputValue("#li-a0"), client.clientId);
  await page.selectOption("#li-review-kind", "");
  await page.waitForFunction(() => !document.querySelector('[data-action="imp-commit"]').disabled);
  assert.match(await page.locator(".li-note").last().textContent(), /3 lotes · 13 prospectos · 5 proyectos · 7 cobros · 2 metas · 2 eventos/);
  await noOverflow(page, "importar decisiones 1440");
  check("importar: cada proyecto se asigna a propósito (cliente o solo interno), el cobro ambiguo se clasifica, se pide fecha y reconocer el ejemplo");

  // Confirmación final: sin la casilla no se escribe nada.
  await page.click('[data-action="imp-commit"]');
  await page.waitForSelector("dialog[open]");
  assert.match(await page.locator("dialog").textContent(), /no se puede deshacer/i);
  assert.match(await page.locator("dialog .lc-hash").textContent(), /[a-f0-9]{64}/);
  await page.click('dialog button[type="submit"]');
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.equal((await admin.get(`/admin/imports/${importId}`)).body.import.status, "previewed");
  // El servidor responde 409 («la revisión ya no coincide»): se explica y no se da por hecho nada.
  await page.check('dialog [name="confirm"]');
  await page.route(`${API}/api/v1/admin/imports/${importId}/commit`, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT", message: "x" } }) }));
  await page.click('dialog button[type="submit"]');
  await page.locator("#modal-error", { hasText: "Volvimos a pedir la revisión" }).waitFor();
  await page.unroute(`${API}/api/v1/admin/imports/${importId}/commit`);
  assert.equal((await admin.get(`/admin/imports/${importId}`)).body.import.status, "previewed");
  await page.click('dialog button[type="submit"]');
  await toast(page, "Importación confirmada", 60000);
  await page.locator(".li-counts").waitFor();
  const counts = await page.locator(".li-counts").textContent();
  assert.match(counts, /Proyectos\s*5/);
  assert.match(counts, /Prospectos\s*13/);
  assert.match(counts, /Cobros\s*7/);
  assert.match(await page.locator("#main-content").textContent(), /Tu navegador no se modificó/);
  assert.match(await page.locator("#main-content").textContent(), /1 registro del archivo no se importaron|1 registro del archivo no se importó|registro.* no se importaron/);
  await page.click('[data-action="filter"][data-id="importar.reportFilter"][data-kind="not_imported"]');
  assert.match(await page.locator(".li-items").textContent(), /no está asociado a un proyecto/);
  const finalReport = (await admin.get(`/admin/imports/${importId}`)).body.import;
  assert.equal(finalReport.status, "committed");
  assert.equal(finalReport.report.created.projects, 5);
  assert.equal(finalReport.report.created.payments, 7, "los 6 nuevos + el ambiguo al que se le eligió tipo");
  const importedProjects = (await admin.get("/admin/projects?limit=50")).body.projects.filter((p) => p.name.includes(`T${stamp}`));
  assert.equal(importedProjects.length, 5);
  const first = (await admin.get(`/admin/projects/${importedProjects.find((p) => p.name.startsWith("Tienda de ropa")).id}`)).body.project;
  assert.deepEqual(first.members.map((member) => member.clientId), [client.clientId], "el proyecto asignado tiene a su cliente");
  const other = (await admin.get(`/admin/projects/${importedProjects.find((p) => p.name.startsWith("Clínica")).id}`)).body.project;
  assert.deepEqual(other.members, [], "los demás quedaron solo internos");
  assert.equal(importedProjects.every((p) => p.origin === "historical"), true);
  check("importar: la confirmación pide casilla, un 409 se explica sin dar nada por hecho y el informe muestra lo creado y lo no importado (con el motivo)");

  // Idempotencia: el mismo archivo es la misma importación ya confirmada.
  await goto(page, "#importar");
  await page.locator(".li-list").waitFor();
  await pickBackup(page, backupPath);
  await page.click('[data-action="imp-upload"]');
  await page.waitForFunction((id) => location.hash === `#importar/${id}`, importId, { timeout: 15000 }).catch(async (error) => {
    throw new Error(`El mismo archivo no devolvió la misma importación. Hash: ${await page.evaluate(() => location.hash)}; error: ${await page.locator("#li-upload-error").textContent().catch(() => "?")}`, { cause: error });
  });
  await toast(page, "Ese archivo ya se importó antes");
  await page.locator(".li-counts").waitFor();
  assert.equal((await admin.get("/admin/projects?limit=50")).body.projects.filter((p) => p.name.includes(`T${stamp}`)).length, 5, "no se duplicó nada");
  await page.setInputFiles("#li-file", backupPath).catch(() => {});
  check("importar: subir de nuevo el mismo archivo devuelve la misma importación (su informe) y no duplica nada");

  // Storage del navegador: intacto (nada de datos ni tokens).
  const storageAfter = await page.evaluate(() => ({ local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage) }));
  assert.deepEqual(storageAfter, storageBefore, "el localStorage del navegador no se tocó");
  assert.deepEqual(storageAfter.local.filter((key) => key !== "eclipse-theme"), []);
  check("importar: el localStorage del navegador quedó exactamente como estaba");

  // Revisión vencida: otra importación con los mismos nombres cambia lo que el servidor ve; la confirmación se frena.
  await calm();
  const backupB = makeBackup(`${stamp}b`, { sameNamesAs: stamp });
  const previewB = await admin.post("/admin/imports", { backup: backupB });
  assert.equal(previewB.status, 201);
  const idB = previewB.body.import.id;
  assert.ok(previewB.body.import.preview.summary.project.possible_duplicate === 5, "los proyectos con el mismo nombre son parecidos a los ya importados");
  await goto(page, `#importar/${idB}`);
  await page.locator(".li-table").waitFor();
  assert.ok(await page.locator('[data-action="imp-commit"]').isDisabled(), "todo es parecido y se omite: no hay nada nuevo que escribir");
  assert.match(await page.locator("#main-content").textContent(), /Parecidos a lo que ya existe/);
  check("importar: los registros parecidos a lo ya importado se detectan, se omiten por defecto y se pueden decidir uno por uno");

  const backupC = makeBackup(`${stamp}c`);
  const previewC = await admin.post("/admin/imports", { backup: backupC });
  assert.equal(previewC.status, 201);
  const idC = previewC.body.import.id;
  await goto(page, `#importar/${idC}`);
  await page.locator(".li-table").waitFor();
  await page.selectOption("#li-bulk", "internal");
  await page.click('[data-action="imp-assign-all"]');
  await page.selectOption("#li-k0", "final");
  await page.fill("#li-follow", "2026-12-01");
  await page.click('#li-ack'); await page.locator('#li-ack:checked').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-action="imp-commit"]').disabled);
  // Mientras la revisión de C está abierta, otra persona importa un respaldo con los mismos nombres: lo que el servidor ve cambia.
  const same = await admin.post("/admin/imports", { backup: makeBackup(`${stamp}d`, { sameNamesAs: `${stamp}c` }) });
  assert.equal(same.status, 201);
  const same_preview = same.body.import.preview;
  const assignments = same_preview.needs.projectAssignments.map((entry) => ({ projectId: entry.projectId, clientId: null }));
  const committed = await admin.post(`/admin/imports/${same.body.import.id}/commit`, { confirm: true, previewHash: same_preview.previewHash, assignments, paymentKinds: same_preview.needs.paymentKinds.map((entry) => ({ paymentId: entry.paymentId, kind: "final" })), duplicates: [], followUpOn: "2026-12-01", acknowledgeExample: true });
  assert.ok([200, 201].includes(committed.status), JSON.stringify(committed.body));
  await page.click('[data-action="imp-commit"]');
  await page.waitForSelector("dialog[open]");
  await page.check('dialog [name="confirm"]');
  await page.click('dialog button[type="submit"]');
  await page.locator("#modal-error", { hasText: "La revisión cambió desde que la miraste" }).waitFor();
  assert.equal((await admin.get(`/admin/imports/${idC}`)).body.import.status, "previewed", "no se escribió nada");
  await page.click('dialog [data-action="close-modal"]');
  await page.locator(".li-table").waitFor();
  assert.match(await page.locator("#main-content").textContent(), /Parecidos a lo que ya existe/, "la pantalla muestra la revisión nueva");
  check("importar: una revisión vencida (la base cambió) no se confirma a ciegas: se vuelve a pedir y se pide revisar de nuevo");

  // ============================ GALERÍA ============================
  await calm();
  const gallery = async (hash, name, waitFor) => {
    for (const [width, height] of [[1440, 1000], [375, 800]]) {
      for (const theme of ["dark", "light"]) {
        await page.setViewportSize({ width, height });
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        await goto(page, "#hoy");
        await goto(page, hash);
        await page.locator(waitFor).first().waitFor({ timeout: 20000 });
        await sleep(400);
        await noOverflow(page, `${name} ${width} ${theme}`);
        await page.screenshot({ path: `${shots}/${name}-${width}-${theme}.png`, fullPage: true });
      }
    }
  };
  if (emailBudget) {
    await gallery(`#comunicaciones/p-${project.id}`, "comunicaciones-redactar", ".lc-grid");
    await gallery(`#comunicaciones/${draftId}`, "comunicaciones-vista-previa", ".lc-mail-text");
    await gallery(`#comunicaciones/${waId}`, "comunicaciones-whatsapp-declarado", ".lc-mail-text");
    await gallery(`#comunicaciones/h-${project.id}`, "comunicaciones-historial", ".pt-row");
  }
  await gallery(`#documentos/${project.id}`, "documentos", ".ld-item, .pt-empty");
  // Una revisión limpia (nada parecido a lo ya importado) para mostrar las decisiones de verdad.
  const previewE = await admin.post("/admin/imports", { backup: makeBackup(`${stamp}e`) });
  assert.equal(previewE.status, 201);
  const idE = previewE.body.import.id;
  await gallery("#importar", "importar-inicio", "#li-file");
  await gallery(`#importar/${idE}`, "importar-revision", ".li-table");
  await gallery(`#importar/${importId}`, "importar-informe", ".li-counts");
  // Las decisiones están al final de la revisión: captura de esa sección, a medio completar.
  for (const [width, height, theme] of [[1440, 1000, "light"], [1440, 1000, "dark"], [375, 800, "light"], [375, 800, "dark"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await goto(page, "#hoy");
    await goto(page, `#importar/${idE}`);
    await page.locator("#li-decide-title").waitFor();
    await page.fill("#li-email", client.email);
    await page.click('[data-action="imp-lookup"]');
    await toast(page, "Cliente agregado");
    await page.selectOption("#li-a0", client.clientId);
    await page.selectOption("#li-a1", "internal");
    await page.selectOption("#li-k0", "installment");
    await page.fill("#li-follow", "2026-12-01");
    await page.evaluate(() => document.getElementById("li-decide-title")?.scrollIntoView({ block: "center" }));
    await noOverflow(page, `decisiones ${width} ${theme}`);
    await page.locator(".li-card", { has: page.locator("#li-decide-title") }).screenshot({ path: `${shots}/importar-decisiones-${width}-${theme}.png` });
  }
  check("capturas a 375 y 1440 px, oscuro y claro, sin desborde horizontal (test-results/live-comms/)");

  assert.deepEqual(errorsSeen, [], `errores en el navegador:\n${errorsSeen.join("\n")}`);
  check("sin errores de consola ni de página");
  console.log(`\n${checks} comprobaciones OK`);
} catch (error) {
  console.error(error);
  for (const [index, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      await page.screenshot({ path: `${shots}/fallo-${index}-${pageIndex}.png`, fullPage: true }).catch(() => {});
      console.error(`Pantalla ${index}.${pageIndex} (${page.url()}): ${(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700)}`);
    }
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
