// Prueba de navegador de Prospectos y Lotes contra el backend REAL (servidor e2e de Eclipse-be, docs/e2e.md).
//
//   E2E_API=http://localhost:3201 E2E_PORTAL=http://localhost:4201 npm run test:live:crm
//
// E2E_API    raíz del servidor e2e tal como la ve el navegador (mismo sitio que el portal: "localhost" en ambos).
// E2E_PORTAL origen donde se sirve el portal (python3 -m http.server 4201 desde la raíz del repo); tiene que ser el origen admin permitido.
// Sin esas dos variables la prueba se saltea con un aviso. La base de pruebas es compartida y descartable: cada corrida crea registros con
// nombre único y no depende de que las tablas estén vacías.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicConfig } from "../scripts/build-public-config.mjs";
import { E2E_ADMIN, freshAdminCode } from "./support/e2e-admin.mjs";
import { createClientSession } from "./support/e2e-client.mjs";

const API = process.env.E2E_API?.replace(/\/+$/, "");
const PORTAL = process.env.E2E_PORTAL?.replace(/\/+$/, "");
if (!API || !PORTAL) {
  console.log("SALTEADO: la prueba live de prospectos y lotes necesita E2E_API (p. ej. http://localhost:3201) y E2E_PORTAL (p. ej. http://localhost:4201).");
  console.log("Levantá el servidor e2e de Eclipse-be (docs/e2e.md), servilo con `python3 -m http.server 4201` y volvé a correr `npm run test:live:crm`.");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = resolve(root, "test-results/crm");
mkdirSync(shots, { recursive: true });

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

async function newPage(context, { theme = "dark", width = 1440, height = 1000 } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.addInitScript((value) => { try { localStorage.setItem("eclipse-theme", value); } catch { /* sin storage */ } }, theme);
  await page.route(`${PORTAL}/public-config.json`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(config) }));
  page.on("pageerror", (error) => errorsSeen.push(`pageerror: ${error.message}`));
  if (process.env.E2E_DEBUG) page.on("response", (response) => { if (response.url().includes("/api/v1/") && response.status() >= 400) console.log(`  ! ${response.status()} ${response.request().method()} ${response.url().replace(API, "")}`); });
  page.on("console", (message) => { if (message.type() === "error" && !/status of (401|403|404|409)|net::ERR_FAILED/.test(message.text())) errorsSeen.push(`console: ${message.text()}`); });
  return page;
}
const ready = async (page) => { await page.goto(`${PORTAL}/`); await page.waitForFunction(() => document.documentElement.dataset.loader === "done"); };
const noOverflow = async (page, label) => {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(scroll <= inner, `${label}: desborde horizontal (${scroll} > ${inner})`);
};
const shot = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
const toast = async (page, text) => {
  try {
    await page.locator(".toast", { hasText: text }).first().waitFor({ timeout: 15000 });
    // Un envío que se confirmó cierra su diálogo (los avisos repetidos de una acción anterior no cuentan).
    await page.waitForSelector("dialog[open]", { state: "detached", timeout: 15000 });
  } catch (error) {
    const visible = await page.locator("#modal-error, #wizard-error, .toast").allTextContents().catch(() => []);
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
const next = (page) => page.click('[data-form="wizard"] button[type="submit"]');
const submitDialog = (page) => page.click('dialog button[type="submit"]');
const idOf = async (page, prefix) => {
  await page.waitForFunction((value) => new RegExp(`^#${value}/[0-9a-f-]{36}$`).test(location.hash), prefix);
  return (await page.evaluate(() => location.hash)).split("/")[1];
};
const stageName = (page) => page.locator(".pt-current-name");
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });

try {
  const stamp = Date.now();
  const emailA = `crm-a-${stamp}@example.test`;
  const phoneA = `+54 9 11 ${String(stamp).slice(-8, -4)}-${String(stamp).slice(-4)}`; // único por corrida: la base es compartida
  const nameA = `Aurora E2E ${stamp} <b>negrita</b>`;
  const nameB = `Aurora bis ${stamp}`;
  // Una solicitud real de un cliente, antes de ingresar: la bandeja la trae al abrirse.
  const client = await createClientSession(API, { email: `crm-req-${stamp}@example.test`, displayName: `Solicitante ${stamp}` });
  await client.submitPlanRequest({ name: `Panadería ${stamp}`, message: "Quiero un sistema de pedidos." });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce", acceptDownloads: true });
  const page = await newPage(context);
  await ready(page);
  await page.locator("#auth-email").waitFor();
  await login(page);

  // ---- 1. Las secciones ya no son «sin conectar» ----
  await goto(page, "#prospectos");
  await page.locator("#f-search").waitFor();
  assert.equal(await page.locator(".live-pending").count(), 0, "Prospectos ya está conectado");
  assert.equal(await page.locator('.hdr-link[data-pending]:has-text("Prospectos")').count(), 0);
  await goto(page, "#lotes");
  await page.getByRole("heading", { name: "Abiertos" }).waitFor();
  check("Prospectos y Lotes están conectados al servidor (sin pantallas «sin conectar»)");

  // ---- 2. Alta de un prospecto (sin duplicados) ----
  await goto(page, "#prospectos");
  await page.getByRole("button", { name: /Prospecto/ }).first().click();
  await page.waitForSelector('[data-form="wizard"]');
  await shot(page, "nuevo-prospecto-1440-dark");
  await page.fill("#m-contactName", nameA);
  await page.fill("#m-company", `Aurora SA ${stamp}`);
  await page.fill("#m-email", emailA);
  await page.fill("#m-phone", phoneA);
  await page.click('[data-action="lead-duplicate-check"]');
  await toast(page, "No encontramos duplicados");
  assert.match(await page.locator(".live-dups").textContent(), /No encontramos coincidencias/);
  await next(page);
  await page.selectOption("#m-source", "referral");
  await page.fill("#m-need", "Quiere turnos online y recordatorios.");
  await next(page);
  // Referido sin detalle: se frena antes de ir al servidor, con el motivo.
  await next(page);
  await next(page);
  await page.locator("#wizard-error", { hasText: "quién o dónde" }).waitFor();
  await page.click('[data-action="wizard-prev"]');
  await page.click('[data-action="wizard-prev"]');
  await page.waitForSelector("#m-sourceDetail");
  await page.fill("#m-sourceDetail", "Dra. Pérez");
  await next(page);
  await next(page);
  await next(page);
  await toast(page, "Prospecto creado.");
  const leadA = await idOf(page, "prospectos");
  await stageName(page).filter({ hasText: "Prospecto" }).waitFor();
  assert.equal(await page.locator(".pt-title b").count(), 0, "el nombre se escapa: no se interpreta HTML");
  assert.match(await page.locator(".pt-title").textContent(), /<b>negrita<\/b>/);
  assert.match(await page.locator(".pt-detail-meta").textContent(), /Referido · Dra\. Pérez · tibio/);
  assert.match(await page.locator(".pt-box", { hasText: "Próxima acción" }).first().textContent(), /Dar seguimiento/);
  assert.match(await page.locator("body").textContent(), /Responsable: Vos|Vos/);
  check("alta de prospecto: duplicados sin coincidencias, regla de fuente tibia con detalle, responsable y próxima acción");

  // ---- 3. Duplicado: no se crea sin confirmar; se confirma y se crea separado ----
  await goto(page, "#prospectos");
  await page.getByRole("button", { name: /Prospecto/ }).first().click();
  await page.waitForSelector('[data-form="wizard"]');
    await page.fill("#m-contactName", nameB);
  await page.fill("#m-email", emailA);
  await next(page);
  await page.fill("#m-need", "Misma persona cargada dos veces.");
  await next(page);
  await next(page);
  await next(page);
  await page.locator("#wizard-error", { hasText: "posible" }).waitFor();
  assert.equal(await page.locator('[data-form="wizard"]').count(), 1, "sigue en el formulario: no se creó");
  await page.click('[data-action="lead-duplicate-check"]');
  await toast(page, "Encontramos 1 posible duplicado");
  const dupLink = page.locator(".live-dups a", { hasText: "Aurora E2E" }).first();
  await dupLink.waitFor();
  assert.match(await page.locator(".live-dups").first().textContent(), /mismo email/);
  await page.locator('[name="acknowledgeDuplicates"]').check();
  await next(page);
  await toast(page, "Quedó separado");
  const leadB = await idOf(page, "prospectos");
  assert.notEqual(leadA, leadB);
  assert.match(await page.locator(".live-dups").textContent(), /Aurora E2E/, "la ficha muestra el posible duplicado");
  check("duplicados: sin confirmar no se crea; con confirmación se crea separado y la ficha lo señala");

  // ---- 4. Actividades: la regla responde → llamada → demo → propuesta → toques mueve la etapa ----
  await goto(page, `#prospectos/${leadA}`);
  await page.locator(".pt-current").waitFor();
  const act = async (button, summary, extra = {}) => {
    await page.getByRole("button", { name: button, exact: true }).first().click();
    await page.waitForSelector("dialog[open]");
    await page.fill("#m-summary", summary);
    for (const [name, value] of Object.entries(extra)) await page.fill(`dialog [name="${name}"]`, value);
    await submitDialog(page);
  };
  await act("Respondió", "Escribió que quiere ver la demo.");
  await toast(page, "Respuesta registrada");
  await stageName(page).filter({ hasText: "Conversación" }).waitFor();
  assert.match(await page.locator(".pt-log").textContent(), /Respondió/);
  assert.match(await page.locator(".pt-log").textContent(), /Hora no registrada/, "sin hora real no se inventa una");
  await act("Llamada hecha", "Hablamos 10 minutos.");
  await toast(page, "Llamada registrada");
  await act("Demo hecha", "Vio la demo de turnos.");
  await toast(page, "Demo registrada");
  await stageName(page).filter({ hasText: "Demo" }).waitFor();
  assert.match(await page.locator(".pt-box", { hasText: "Próxima acción" }).first().textContent(), /Regla de la casa|propuesta/i);
  await act("Propuesta enviada", "Landing + turnos.", { amount: "900", outcome: "Pidió ajustar el alcance" });
  await toast(page, "Propuesta registrada");
  await stageName(page).filter({ hasText: "Propuesta" }).waitFor();
  assert.match(await page.locator(".pt-log").textContent(), /USD 900/);
  assert.match(await page.locator(".pt-dl").first().textContent(), /USD 900/);
  await page.getByRole("button", { name: "Toque hecho" }).click();
  await page.waitForSelector("dialog[open]");
  assert.match(await page.locator('dialog [name="nextAction"]').inputValue(), /Toque 2 de 3/, "la regla +2/+5/+9 propone el toque siguiente");
  await page.fill("#m-summary", "Le escribí para ver si lo pensó.");
  await submitDialog(page);
  await toast(page, "Toque registrado");
  await page.getByRole("button", { name: "Agregar nota" }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#m-summary", "Nota por error de carga.");
  await submitDialog(page);
  await toast(page, "Nota guardada");
  // Duplicar el mismo registro dentro de un minuto lo frena el servidor, con explicación.
  await page.getByRole("button", { name: "Agregar nota" }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#m-summary", "Nota por error de carga.");
  await submitDialog(page);
  await page.locator("#modal-error", { hasText: "misma actividad" }).waitFor();
  await page.click('dialog [data-action="close-modal"]');
  // Anular con motivo: la fila queda, tachada y con su motivo.
  const noteItem = page.locator(".pt-log-item", { hasText: "Nota por error de carga." });
  await noteItem.getByRole("button", { name: "Anular" }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#m-reason", "Era de otro cliente");
  await submitDialog(page);
  await toast(page, "Actividad anulada");
  await noteItem.getByText("Anulada", { exact: true }).first().waitFor();
  assert.match(await noteItem.textContent(), /Era de otro cliente/);
  assert.equal(await noteItem.getByRole("button", { name: "Anular" }).count(), 0, "lo anulado no se anula dos veces");
  await page.getByRole("button", { name: "Más nuevo primero" }).click();
  assert.match(await page.locator(".pt-log-item").first().textContent(), /Nota por error de carga/, "orden del historial: lo más nuevo primero");
  check("actividades: la respuesta, la demo y la propuesta mueven la etapa; toques +2/+5/+9; anular conserva la fila con su motivo");

  // ---- 5. Pausa y reactivación ----
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#m-reason", "Espera el presupuesto del socio");
  await submitDialog(page);
  await toast(page, "Prospecto en pausa");
  await page.locator(".pt-pause-title", { hasText: "En pausa" }).waitFor();
  assert.match(await page.locator(".pt-pause").textContent(), /Espera el presupuesto del socio/);
  await page.getByRole("button", { name: "Reactivar" }).click();
  await page.waitForSelector("dialog[open]");
  assert.equal(await page.locator('dialog [name="stage"]').inputValue(), "proposal", "vuelve a la etapa donde estaba (leída del historial)");
  await submitDialog(page);
  await toast(page, "Ahora está en Propuesta");
  await stageName(page).filter({ hasText: "Propuesta" }).waitFor();
  // Perdido y reactivar.
  await page.getByRole("button", { name: "Perdido", exact: true }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#m-reason", "Prueba E2E");
  await submitDialog(page);
  await toast(page, "marcado como perdido");
  await stageName(page).filter({ hasText: "Perdido" }).waitFor();
  await page.getByRole("button", { name: "Reactivar" }).click();
  await page.waitForSelector("dialog[open]");
  await page.selectOption('dialog [name="stage"]', "proposal");
  await submitDialog(page);
  await toast(page, "Ahora está en Propuesta");
  check("pausa con motivo y fecha, reactivar a la etapa previa, perdido y reactivar");

  // ---- 6. Consentimiento rechazado: se bloquea lo saliente, lo entrante sigue ----
  await page.getByRole("button", { name: "Consentimiento" }).click();
  await page.waitForSelector("dialog[open]");
  await page.selectOption('dialog [name="status"]', "denied");
  await page.fill("#m-basis", "Pidió por mensaje que no lo contactemos");
  await submitDialog(page);
  await toast(page, "No contactar");
  await page.locator(".generator-warning", { hasText: "No contactar" }).waitFor();
  await page.getByRole("button", { name: "Toque hecho" }).click();
  await page.waitForSelector("dialog[open]");
  assert.match(await page.locator("dialog").textContent(), /no se pueden registrar contactos salientes/);
  assert.equal(await page.locator('dialog button[type="submit"]').count(), 0, "no hay botón para guardar un contacto saliente");
  await page.click('dialog [data-action="close-modal"]');
  // El servidor también lo hace cumplir (409): se prueba directo, con el CSRF de la sesión.
  const csrf = (await (await context.request.get(`${API}/api/v1/auth/admin/csrf`, { headers: { Origin: PORTAL } })).json()).csrfToken;
  const refused = await context.request.post(`${API}/api/v1/admin/leads/${leadA}/activities`, { headers: { Origin: PORTAL, "X-CSRF-Token": csrf }, data: { kind: "message", direction: "outbound", channel: "whatsapp", occurredOn: today(), summary: "Intento saliente E2E" } });
  assert.equal(refused.status(), 409, "el servidor rechaza lo saliente con el consentimiento rechazado");
  await page.getByRole("button", { name: "Agregar nota" }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#m-summary", "Anotación interna con consentimiento rechazado.");
  await submitDialog(page);
  await toast(page, "Nota guardada");
  // Volver a aceptar exige la base.
  await page.getByRole("button", { name: "Consentimiento" }).click();
  await page.waitForSelector("dialog[open]");
  await page.selectOption('dialog [name="status"]', "granted");
  await submitDialog(page);
  await page.locator("#modal-error", { hasText: "registrar la base" }).waitFor();
  await page.fill("#m-basis", "Volvió a escribir y pidió la propuesta");
  await submitDialog(page);
  await toast(page, "Consentimiento registrado");
  await page.locator(".generator-warning", { hasText: "No contactar" }).waitFor({ state: "detached" });
  check("consentimiento rechazado bloquea lo saliente (interfaz y servidor 409), permite notas y exige la base para volver");

  // ---- 7. Marcar un duplicado ----
  await goto(page, `#prospectos/${leadB}`);
  await page.locator(".live-dups").waitFor();
  await page.getByRole("button", { name: "Es duplicado de este" }).click();
  await page.waitForSelector("dialog[open]");
  await submitDialog(page);
  await toast(page, "Marcado como duplicado");
  await page.locator(".generator-warning", { hasText: "Marcado como duplicado" }).waitFor();
  await stageName(page).filter({ hasText: "Perdido" }).waitFor();
  check("duplicado: decisión humana, queda perdido apuntando al principal, sin mezclar nada");

  // ---- 8. Lotes: crear, sumar, D0, señal y cierre con informe ----
  await goto(page, "#lotes");
  await page.getByRole("button", { name: /Lote/ }).first().click();
  await page.waitForSelector('[data-form="wizard"]');
  const batchName = `Lote E2E ${stamp}`;
  await page.fill("#m-name", batchName);
  await page.fill("#m-vertical", "Clínicas");
  await next(page);
  await page.fill("#m-demo", "Demo base — agente de turnos");
  await page.fill("#m-hypothesis", "Los turnos por WhatsApp convierten mejor.");
  await next(page);
  await next(page);
  await next(page);
  await toast(page, "Lote creado");
  const batchId = await idOf(page, "lotes");
  await page.locator(".pt-card-title", { hasText: batchName }).waitFor();
  assert.match(await page.locator(".pt-card").textContent(), /Se calcula con D0/);
  assert.match(await page.locator(".pt-card").textContent(), /0\/10\s*asignados/);
  // Sumar el prospecto desde su ficha (Aurora A está en Propuesta, con consentimiento vuelto a otorgar).
  await goto(page, `#prospectos/${leadA}`);
  await page.getByRole("button", { name: "Sumar a un lote" }).click();
  await page.waitForSelector("dialog[open]");
  await page.selectOption('dialog [name="batchId"]', batchId);
  await submitDialog(page);
  await toast(page, "Prospecto sumado al lote");
  await page.locator(".pt-facts a", { hasText: batchName }).waitFor();
  // Un segundo prospecto, sumado desde el lote.
  await goto(page, "#prospectos");
  await page.getByRole("button", { name: /Prospecto/ }).first().click();
  await page.waitForSelector('[data-form="wizard"]');
  const nameC = `Cedro E2E ${stamp}`;
  const emailC = `crm-c-${stamp}@example.test`;
  await page.fill("#m-contactName", nameC);
  await page.fill("#m-email", emailC);
  await next(page);
  await page.fill("#m-need", "Quiere un chatbot.");
  await next(page);
  await next(page);
  await next(page);
  await toast(page, "Prospecto creado.");
  const leadC = await idOf(page, "prospectos");
  await goto(page, `#lotes/${batchId}`);
  await page.getByRole("button", { name: "Sumar prospectos" }).first().click();
  await page.waitForSelector("dialog[open]");
  await page.locator(`dialog [name="lead_${leadC}"]`).check();
  await submitDialog(page);
  await toast(page, "1 prospecto sumado");
  await page.locator(".pt-row", { hasText: nameC }).waitFor();
  assert.match(await page.locator(".pt-card").textContent(), /2\/10\s*asignados/);
  // Sacar a C del lote (confirmación nativa).
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".pt-row", { hasText: nameC }).getByRole("button", { name: "Sacar" }).click();
  await toast(page, "Prospecto sacado del lote");
  await page.locator(".pt-row", { hasText: nameC }).waitFor({ state: "detached" });
  assert.match(await page.locator(".pt-card").textContent(), /1\/10\s*asignados/);
  // D0 manual → recordatorios calculados por el servidor.
  await page.getByRole("button", { name: "Registrar envío D0" }).click();
  await page.waitForSelector("dialog[open]");
  assert.match(await page.locator("dialog").textContent(), /el sistema no envía nada/);
  await page.fill('dialog [name="sentCount"]', "12");
  await submitDialog(page);
  await toast(page, "Envío D0 registrado");
  await page.locator(".pt-fine", { hasText: "12 mensajes mandados a mano" }).waitFor();
  const stateAfterD0 = (await context.request.get(`${API}/api/v1/admin/batches/${batchId}`, { headers: { Origin: PORTAL } })).json();
  const d0 = (await stateAfterD0).batch;
  assert.equal(d0.status, "sent");
  assert.ok(d0.signalDueOn && d0.closeDueOn, "el servidor calculó D+señal y D+cierre");
  assert.match(await page.locator(".pt-rail").textContent(), new RegExp(`D\\+2[\\s\\S]*D\\+7`));
  await page.getByRole("button", { name: "Registrar señal" }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#m-note", "1 de 1 respondió y pidió propuesta");
  await submitDialog(page);
  await toast(page, "Señal registrada");
  await page.getByText("1 de 1 respondió y pidió propuesta").waitFor();
  await shot(page, "lote-detalle-1440-dark");
  await page.getByRole("button", { name: "Cerrar con informe" }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#m-worked", "La demo corta");
  await page.fill("#m-notWorked", "El mensaje largo");
  await page.fill("#m-change", "Mandar solo el video");
  await submitDialog(page);
  await toast(page, "Lote cerrado");
  await page.locator(".pt-report", { hasText: "Mandar solo el video" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Cerrar con informe" }).count(), 0, "un lote cerrado no se opera");
  assert.equal(await page.getByRole("button", { name: "Sumar prospectos" }).count(), 0);
  const closed = (await (await context.request.get(`${API}/api/v1/admin/batches/${batchId}`, { headers: { Origin: PORTAL } })).json()).batch;
  assert.equal(closed.status, "closed");
  assert.equal(closed.report.worked, "La demo corta");
  assert.equal(closed.metrics.assigned, 1);
  await goto(page, "#lotes");
  await page.getByRole("heading", { name: "Informes cerrados" }).waitFor();
  await page.locator(".pt-card", { hasText: batchName }).waitFor();
  check("lotes: crear, sumar y sacar prospectos, D0 manual con recordatorios del servidor, señal y cierre con informe de tres líneas");

  // ---- 9. Convertir en proyecto ----
  const convertKeys = [];
  page.on("request", (req) => { if (req.method() === "POST" && req.url().endsWith(`/admin/leads/${leadA}/convert`)) convertKeys.push(req.headers()["idempotency-key"]); });
  await goto(page, `#prospectos/${leadA}`);
  await page.locator(".pt-current").waitFor();
  await page.getByRole("button", { name: "Convertir en proyecto" }).first().click();
  await page.waitForSelector('[data-form="wizard"]');
  assert.equal(await page.inputValue("#m-name"), `Aurora SA ${stamp}`, "prellenado desde el prospecto");
  assert.match(await page.locator(".generator-warning").textContent(), /Aurora E2E/);
  await page.fill("#m-service", "Landing + turnos online");
  await next(page);
  await page.fill("#m-agreementReference", "Presupuesto CRM-E2E");
  await page.fill("#m-price", "2000");
  await page.fill("#m-scopeItems", "Landing\nSistema de turnos");
  await next(page);
  await page.fill("#m-depositAmount", "800");
  await next(page);
  await next(page);
  assert.match(await page.locator(".generator-summary").textContent(), /USD 2\.000/);
  await next(page);
  await toast(page, "Prospecto convertido");
  const projectId = await idOf(page, "proyectos");
  await page.locator(".pt-current-name", { hasText: "Preparación" }).waitFor();
  assert.match(await page.locator(".pt-box", { hasText: "Finanzas" }).textContent(), /Cobrado\s*USD 800/);
  assert.equal(convertKeys.length, 1);
  assert.match(convertKeys[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4/, "la conversión viaja con Idempotency-Key");
  await goto(page, "#proyectos");
  await page.locator(".pt-row-name", { hasText: `Aurora SA ${stamp}` }).waitFor();
  await goto(page, `#prospectos/${leadA}`);
  await stageName(page).filter({ hasText: "Ganado" }).waitFor();
  await page.getByRole("link", { name: /Ver proyecto/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Pausar", exact: true }).count(), 0, "un prospecto ganado ya no cambia de etapa");
  assert.match(await page.locator(".pt-log").textContent(), /Convertido en proyecto/);
  const leadAfter = (await (await context.request.get(`${API}/api/v1/admin/leads/${leadA}`, { headers: { Origin: PORTAL } })).json()).lead;
  assert.equal(leadAfter.stage, "won");
  assert.equal(leadAfter.projectId, projectId);
  check("conversión: un solo pedido transaccional con Idempotency-Key, proyecto con seña en Preparación y el prospecto queda Ganado enlazado");

  // ---- 10. Auditoría del prospecto ----
  await page.getByRole("button", { name: "Ver auditoría" }).click();
  await page.locator(".live-audit li", { hasText: "Convertido en proyecto" }).waitFor();
  assert.ok(await page.locator(".live-audit li", { hasText: "Prospecto creado" }).count() >= 1);
  assert.ok(await page.locator(".live-audit li", { hasText: "Cambio de consentimiento" }).count() >= 1);
  check("auditoría del prospecto: cada cambio con su fecha y quién lo hizo");

  // ---- 11. Lista: búsqueda y filtros del servidor, paginación por cursor y exportación CSV ----
  await goto(page, "#prospectos");
  await page.fill("#f-search", String(stamp));
  await page.locator(".pt-row", { hasText: nameC }).waitFor();
  await page.waitForSelector(".pt-list:not(.live-stale-list)");
  assert.equal(await page.locator(".pt-row", { hasText: nameB }).count(), 0, "los duplicados marcados no están en la lista por defecto");
  assert.equal(await page.locator(".pt-row", { hasText: nameA }).count(), 0, "los convertidos no están en «Activos»");
  await page.click('[data-action="filter"][data-id="prospectos.stage"][data-kind="won"]');
  await page.locator(".pt-row", { hasText: nameA }).waitFor();
  assert.match(await page.locator(".pt-row", { hasText: nameA }).textContent(), /Referido/);
  await page.click('[data-action="filter"][data-id="prospectos.stage"][data-kind="activos"]');
  await page.locator(".pt-row", { hasText: nameC }).waitFor();
  await page.locator("details.live-more-filters summary").click();
  await page.click('[data-action="filter"][data-id="prospectos.dup"][data-kind="1"]');
  await page.locator(".pt-row", { hasText: nameB }).waitFor();
  await page.click('[data-action="filter"][data-id="prospectos.dup"][data-kind=""]');
  await page.click('[data-action="filter"][data-id="prospectos.warm"][data-kind="1"]');
  await page.locator(".pt-row", { hasText: nameC }).waitFor({ state: "detached" });
  await page.click('[data-action="filter"][data-id="prospectos.warm"][data-kind=""]');
  await page.locator(".pt-row", { hasText: nameC }).waitFor();
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="leads-export"]')]);
  assert.match(download.suggestedFilename(), /^prospectos-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await download.path(), "utf8");
  assert.ok(csv.includes(emailC), "el CSV trae el prospecto buscado");
  assert.ok(!csv.includes(emailA), "y respeta el filtro (el convertido no está en «Activos»)");
  await toast(page, "CSV descargado");
  check("lista: búsqueda y filtros del servidor, convertidos y duplicados aparte, exportación CSV por fetch → Blob");

  // Paginación por cursor: con 20 por página, el listado general pide la siguiente página con «Cargar más».
  await page.fill("#f-search", "");
  await page.waitForSelector(".pt-list:not(.live-stale-list)");
  await page.locator(".pt-row").first().waitFor();
  const lost = await page.locator(".pt-row").count();
  if (await page.locator('[data-action="live-more"]').count()) {
    await page.click('[data-action="live-more"]');
    await page.waitForFunction((before) => document.querySelectorAll(".pt-row").length > before, lost);
    check("paginación por cursor: «Cargar más» suma la página siguiente");
  } else {
    console.log("· paginación: la base de pruebas tiene menos de 21 prospectos activos; se omite «Cargar más»");
  }

  // ---- 12. Desde una solicitud de plan ----
  await goto(page, "#solicitudes");
  const requestRow = page.locator(".pt-row", { hasText: String(stamp) });
  await requestRow.waitFor();
  await requestRow.locator(".pt-row-name").click();
  await page.waitForSelector(".pt-current");
  await page.getByRole("button", { name: /Crear prospecto/ }).click();
  await page.waitForSelector("dialog[open]");
  await submitDialog(page);
  await toast(page, "Prospecto listo desde la solicitud");
  const leadR = await idOf(page, "prospectos");
  assert.match(await page.locator(".pt-detail-meta").textContent(), /Armador de planes/);
  assert.match(await page.locator(".pt-facts").textContent(), /Solicitud de plan/);
  await page.goBack();
  await page.waitForSelector(".pt-current");
  await page.getByRole("button", { name: /Crear prospecto/ }).click();
  await page.waitForSelector("dialog[open]");
  await submitDialog(page);
  await toast(page, "Prospecto listo desde la solicitud");
  assert.equal(await idOf(page, "prospectos"), leadR, "idempotente: una solicitud, un prospecto");
  check("desde una solicitud de plan: crea el prospecto (fuente «armador de planes») y es idempotente");

  // ---- 13. Permisos y errores del servidor ----
  const limited = await newPage(context);
  await limited.route(`${API}/api/v1/auth/admin/me`, async (route) => {
    const response = await route.fetch({ headers: { ...route.request().headers(), origin: PORTAL } });
    const body = await response.json();
    if (!response.ok() || !body.admin) return route.fulfill({ response });
    body.admin.permissions = body.admin.permissions.filter((permission) => !["leads:write", "leads:export", "billing:read", "billing:write"].includes(permission));
    await route.fulfill({ response, json: body });
  });
  const writes = [];
  limited.on("request", (req) => { if (req.method() !== "GET" && req.url().includes("/api/v1/admin/")) writes.push(req.url()); });
  await limited.goto(`${PORTAL}/#prospectos`);
  await limited.locator("#f-search").waitFor();
  await limited.locator(".pt-row").first().waitFor();
  assert.equal(await limited.locator('[data-action="new-prospect"]').count(), 0, "sin leads:write no hay alta");
  assert.equal(await limited.locator('[data-action="leads-export"]').count(), 0, "sin leads:export no hay exportación");
  assert.match(await limited.locator(".pt-rows-head").first().textContent(), /Responsable/, "sin billing:read no hay columna de presupuesto");
  await goto(limited, `#prospectos/${leadC}`);
  await limited.locator(".pt-current").waitFor();
  assert.match(await limited.locator(".pt-current").textContent(), /falta leads:write/);
  assert.match(await limited.locator(".pt-current").textContent(), /billing:read/);
  for (const name of ["Respondió", "Pausar", "Perdido", "Convertir en proyecto", "Agregar nota"]) assert.equal(await limited.getByRole("button", { name, exact: true }).count(), 0, `sin permiso no hay «${name}»`);
  await goto(limited, "#lotes");
  await limited.getByRole("heading", { name: "Abiertos" }).waitFor();
  assert.equal(await limited.locator('[data-action="new-batch"]').count(), 0);
  assert.equal(writes.length, 0, "sin permiso no se envía ninguna escritura");
  await limited.close();

  // Un 403 y un 409 del servidor se explican sin perder el formulario.
  const explain = await newPage(context);
  await explain.goto(`${PORTAL}/#prospectos/${leadC}`);
  await explain.locator(".pt-current").waitFor();
  await explain.route(`${API}/api/v1/admin/leads/${leadC}/consent`, (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Forbidden" } }) }));
  await explain.getByRole("button", { name: "Consentimiento" }).click();
  await explain.waitForSelector("dialog[open]");
  await explain.selectOption('dialog [name="status"]', "granted");
  await explain.click('dialog button[type="submit"]');
  await explain.locator("#modal-error", { hasText: "no tiene permiso" }).waitFor();
  assert.equal(await explain.locator("dialog[open]").count(), 1, "el formulario sigue abierto");
  await explain.click('dialog [data-action="close-modal"]');
  await explain.route(`${API}/api/v1/admin/leads/${leadC}/stage`, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT", message: "Conflict" } }) }));
  await explain.getByRole("button", { name: "Cambiar de etapa" }).click();
  await explain.waitForSelector("dialog[open]");
  await explain.selectOption('dialog [name="stage"]', "demo");
  await explain.click('dialog button[type="submit"]');
  await explain.locator("#modal-error", { hasText: "propuesta enviada registrada" }).waitFor();
  await explain.close();
  check("permisos: se ocultan o explican las acciones sin permiso (sin escrituras); 403 y 409 se explican con el formulario abierto");

  // ---- 14. Sin datos de la API en storage ----
  const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  assert.deepEqual(storage.local.filter((key) => key !== "eclipse-theme"), []);
  assert.deepEqual(storage.session, []);
  check("nada de la API queda en localStorage ni sessionStorage");

  // ---- 15. Capturas en 375 y 1440, tema oscuro y claro, sin desbordes ----
  await goto(page, "#prospectos");
  const views = [
    ["prospectos", "#prospectos", ".pt-row"],
    ["prospecto-detalle", `#prospectos/${leadC}`, ".pt-current"],
    ["lotes", "#lotes", ".pt-card"],
    ["lote-detalle", `#lotes/${batchId}`, ".pt-card"],
  ];
  for (const theme of ["dark", "light"]) {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; localStorage.setItem("eclipse-theme", value); }, theme);
      for (const [name, hash, selector] of views) {
        await goto(page, hash);
        await page.locator(selector).first().waitFor();
        await page.waitForTimeout(700);
        await noOverflow(page, `${name} ${width} ${theme}`);
        await shot(page, `${name}-${width}-${theme}`);
      }
      await goto(page, "#prospectos");
      await page.getByRole("button", { name: /Prospecto/ }).first().click();
      await page.waitForSelector('[data-form="wizard"]');
      await noOverflow(page, `nuevo-prospecto ${width} ${theme}`);
      await shot(page, `nuevo-prospecto-${width}-${theme}`);
      await page.click('[data-action="wizard-cancel"]');
      await goto(page, "#lotes");
      await page.getByRole("heading", { name: "Abiertos" }).waitFor();
      await page.getByRole("button", { name: /Lote/ }).first().click();
      await page.waitForSelector('[data-form="wizard"]');
      await noOverflow(page, `nuevo-lote ${width} ${theme}`);
      await page.click('[data-action="wizard-cancel"]');
    }
  }
  check("capturas en 375 y 1440 px, tema oscuro y claro, sin desbordes horizontales");

  assert.deepEqual(errorsSeen, [], `errores en consola:\n${errorsSeen.join("\n")}`);
  console.log(`\n${checks} recorridos de Prospectos y Lotes contra el servidor real. Capturas en test-results/crm/. Sin errores de JavaScript.`);
  await context.close();
} catch (error) {
  console.error(error);
  for (const [index, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      await page.screenshot({ path: `${shots}/fallo-${index}-${pageIndex}.png`, fullPage: true }).catch(() => {});
      console.error(`Pantalla ${index}.${pageIndex} (${page.url()}): ${(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600)}`);
    }
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
