// Prueba de navegador del modo live contra el backend REAL (servidor e2e de Eclipse-be, docs/e2e.md).
//
//   E2E_API=http://localhost:3100 E2E_PORTAL=http://localhost:4173 npm run test:live
//
// E2E_API    raíz del servidor e2e tal como la ve el navegador (mismo sitio que el portal: usar "localhost" en ambos).
// E2E_PORTAL origen donde se sirve el portal (python3 -m http.server 4173 desde la raíz del repo). Tiene que ser el origen admin
//            permitido por el servidor (por defecto http://localhost:4173).
// Sin esas dos variables la prueba se saltea con un aviso. Cualquier servidor e2e comparte una base descartable: no se limpia nada.
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicConfig } from "../scripts/build-public-config.mjs";
import { E2E_ADMIN, freshAdminCode } from "./support/e2e-admin.mjs";
import { createClientSession } from "./support/e2e-client.mjs";

const API = process.env.E2E_API?.replace(/\/+$/, "");
const PORTAL = process.env.E2E_PORTAL?.replace(/\/+$/, "");
if (!API || !PORTAL) {
  console.log("SALTEADO: la prueba live necesita E2E_API (p. ej. http://localhost:3100) y E2E_PORTAL (p. ej. http://localhost:4173).");
  console.log("Levantá el servidor e2e de Eclipse-be (docs/e2e.md), servilo con `python3 -m http.server 4173` y volvé a correr `npm run test:live`.");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = resolve(root, "test-results/live");
mkdirSync(shots, { recursive: true });

try {
  const health = await fetch(`${API}/__e2e/health`);
  assert.equal(health.ok, true);
} catch {
  console.log(`SALTEADO: el servidor e2e no responde en ${API}/__e2e/health.`);
  process.exit(0);
}

const { config, errors } = buildPublicConfig({ PUBLIC_PORTAL_MODE: "live", PUBLIC_API_BASE_URL: `${API}/api/v1`, PUBLIC_CLIENT_PORTAL_URL: "http://localhost:3001/es/portal" });
assert.ok(config, errors?.join(" "));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
const errorsSeen = [];
const throttled = [];
let checks = 0;
const check = (message) => { checks++; console.log(`✓ ${message}`); };

async function newPage(context, { theme = "dark", width = 1440, height = 1000 } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.addInitScript((value) => { try { localStorage.setItem("eclipse-theme", value); } catch { /* sin storage */ } }, theme);
  // El portal es estático: la configuración pública se sirve como la serviría public-config.json.
  await page.route(`${PORTAL}/public-config.json`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(config) }));
  page.on("pageerror", (error) => errorsSeen.push(`pageerror: ${error.message}`));
  page.on("response", (response) => { if (response.status() === 429 && response.url().startsWith(API)) throttled.push(`${response.request().method()} ${response.url().replace(API, "")}`); });
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
// Lectura directa de la API con la sesión del navegador; respeta el límite general (120 req/min) esperando si hace falta.
const apiGet = async (context, path) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await context.request.get(`${API}/api/v1${path}`, { headers: { Origin: PORTAL } });
    if (response.status() !== 429) return { status: response.status(), body: await response.json().catch(() => null) };
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`GET ${path}: el límite de la API no se liberó`);
};
// El límite general de la API es de 120 pedidos por minuto y por IP. La base de pruebas acumula proyectos (cada pantalla pide uno por proyecto):
// antes de cada fase pesada se espera a que la ventana vuelva a tener margen.
const calm = async (needed = 90) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(`${API}/api/v1/auth/csrf`, { headers: { Origin: PORTAL } });
    const remaining = Number(/r=(\d+)/.exec(response.headers.get("ratelimit") || "")?.[1] ?? 999);
    if (remaining >= needed) return;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
};
const usdText = (cents) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: Number.isInteger(cents / 100) ? 0 : 2 }).format(cents / 100);

try {
  // ---- Datos del lado del cliente: una solicitud real en la bandeja ----
  const stamp = Date.now();
  const client = await createClientSession(API, { email: `portal-e2e-${stamp}@example.test`, displayName: "Clínica E2E" });
  const request = await client.submitPlanRequest({ name: `Clínica E2E ${stamp} <b>demo</b>`, message: "Quiero turnos online.\n<img src=x onerror=alert(1)>" });

  // ---- 1. Ingreso en dos pasos: errores claros, MFA y sin secretos en el navegador ----
  const anonymous = await browser.newContext({ viewport: { width: 375, height: 800 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce" });
  const gate = await newPage(anonymous, { width: 375, height: 800 });
  await ready(gate);
  await gate.locator("#auth-email").waitFor();
  assert.equal(await gate.locator("#auth-email").count(), 1, "antes de ingresar solo se ve el login");
  assert.equal(await gate.locator(".pt-nav a").count(), 0, "sin sesión no hay navegación ni datos");
  await noOverflow(gate, "login 375");
  await shot(gate, "login-375-dark");
  // Solo UN fallo por corrida: cinco fallos de la cuenta en 15 min la bloquean 15 min (el mensaje de contraseña incorrecta se prueba en tests/api-client.test.js).
  await gate.fill("#auth-email", E2E_ADMIN.email);
  await gate.fill("#auth-password", E2E_ADMIN.password);
  await gate.click('button[type="submit"]');
  await gate.waitForSelector("#auth-code");
  assert.equal(await gate.locator("#auth-code").getAttribute("autocomplete"), "one-time-code");
  assert.equal(await gate.evaluate(() => document.activeElement?.id), "auth-code", "el foco pasa al campo del código");
  await noOverflow(gate, "mfa 375");
  await shot(gate, "mfa-375-dark");
  await gate.fill("#auth-code", "12ab");
  assert.equal(await gate.inputValue("#auth-code"), "12", "solo dígitos");
  await gate.fill("#auth-code", "000000");
  await gate.click('button[type="submit"]');
  await gate.locator("#auth-error").filter({ hasText: /código/i }).waitFor();
  check("login en dos pasos con errores claros, foco y campo de código accesible");
  await gate.close();
  await anonymous.close();

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce" });
  const page = await newPage(context);
  await ready(page);
  await page.locator("#auth-email").waitFor();
  await shot(page, "login-1440-dark");
  await login(page);
  const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie }));
  assert.deepEqual(storage.local.filter((key) => key !== "eclipse-theme"), [], "localStorage solo guarda el tema");
  assert.deepEqual(storage.session, []);
  assert.ok(!/eclipse-admin|csrf|preauth/i.test(storage.cookie), "las cookies de sesión son HttpOnly");
  assert.match(await page.locator(".pt-mode").textContent(), /admin@eclipse\.test/);
  assert.equal(await page.locator(".pt-mode [data-action=\"live-logout\"]").isVisible(), true);
  check("ingresa con MFA, muestra la cuenta y no guarda sesión ni datos en storage");

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.loader === "done");
  await page.waitForSelector('.pt-mode[data-mode="live"]');
  check("la sesión se restaura al recargar (GET /auth/admin/me)");

  // ---- 2. Bandeja de solicitudes ----
  await goto(page, "#solicitudes");
  const row = page.locator(".pt-row", { hasText: String(stamp) });
  await row.waitFor();
  await noOverflow(page, "solicitudes 1440");
  await shot(page, "solicitudes-1440-dark");
  await row.locator(".pt-row-name").click();
  await page.waitForSelector(".pt-current");
  assert.equal(await page.locator(".live-quote img, .pt-title img").count(), 0, "los textos del cliente se escapan");
  assert.match(await page.locator(".live-quote").textContent(), /<img src=x onerror=alert\(1\)>/);
  await shot(page, "solicitud-detalle-1440-dark");
  await page.getByRole("button", { name: "Aceptar", exact: true }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill("#m-publicResponse", "Gracias, coordinemos por WhatsApp.");
  await page.fill("#m-internalNote", "Cliente simpático.");
  await page.click('dialog button[type="submit"]');
  await toast(page, "Solicitud aceptada. No se creó ningún proyecto.");
  await page.locator(".pt-current-name", { hasText: "Aceptada" }).waitFor();
  check("revisar y aceptar una solicitud no crea proyecto y se confirma recién con la respuesta del servidor");

  // ---- 3. Crear el proyecto desde la solicitud (acuerdo + seña, idempotente) ----
  await page.getByRole("button", { name: /Crear proyecto desde esta solicitud/ }).click();
  await page.waitForSelector('[data-form="wizard"]');
  assert.equal(await page.inputValue('[name="name"]'), `Clínica E2E ${stamp} <b>demo</b>`, "prellenado desde la solicitud");
  await page.fill('[name="service"]', "Landing premium + turnos");
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.fill('[name="agreementReference"]', "Presupuesto E2E-1");
  await page.fill('[name="price"]', "2000");
  await page.fill('[name="scopeItems"]', "Landing premium\nSistema de turnos");
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.fill('[name="depositAmount"]', "500.50");
  await page.fill('[name="depositReference"]', "Transferencia E2E");
  await page.click('[data-form="wizard"] button[type="submit"]');
  assert.equal(await page.locator('[name="authorizeRequest"]').isChecked(), true, "autoriza la cuenta de la solicitud por defecto");
  await page.click('[data-form="wizard"] button[type="submit"]');
  assert.match(await page.locator(".generator-summary").textContent(), /USD 2\.000/);
  assert.match(await page.locator(".generator-summary").textContent(), /USD 500,50/);
  // Una falla de red durante el alta deja el formulario abierto. El cliente ya reintenta una vez solo (con la misma clave);
  // si vuelve a fallar, el reintento manual del usuario sigue usando esa clave: el servidor nunca registra dos seña.
  const keys = [];
  let failures = 2;
  await page.route(`${API}/api/v1/admin/projects`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    if (failures-- > 0) return route.abort("failed");
    return route.continue();
  });
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.locator("#wizard-error", { hasText: "No pudimos conectar" }).waitFor();
  assert.equal(await page.locator('[data-form="wizard"]').count(), 1, "el formulario sigue abierto");
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.waitForFunction(() => /^#proyectos\/[0-9a-f-]{36}$/.test(location.hash));
  await toast(page, "Seña registrada");
  assert.ok(keys.length === 3 && new Set(keys).size === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-4/.test(keys[0]), `la misma Idempotency-Key en el reintento (${keys.join(",")})`);
  await page.unroute(`${API}/api/v1/admin/projects`);
  const projectUrl = await page.evaluate(() => location.hash);
  const projectId = projectUrl.split("/")[1];
  await page.locator(".pt-current-name", { hasText: "Preparación" }).waitFor();
  assert.match(await page.locator(".pt-box", { hasText: "Finanzas" }).textContent(), /Cobrado\s*USD 500,50/);
  assert.match(await page.locator(".pt-box", { hasText: "Finanzas" }).textContent(), /Saldo por cobrar\s*USD 1\.499,50/);
  check("proyecto creado con acuerdo y seña (centavos exactos), reintento con la misma clave sin duplicar");

  // ---- 4. Cobros: saldo calculado por el servidor; mantenimiento no lo reduce ----
  await page.click('[data-action="tab"][data-id="payments"]');
  await page.getByRole("button", { name: /Cobro/ }).first().click();
  await page.waitForSelector('[data-form="wizard"]');
  await page.fill('[name="amount"]', "500");
  await shot(page, "cobro-form-1440-dark");
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.click('[data-form="wizard"] button[type="submit"]');
  await toast(page, "Cobro registrado.");
  await page.waitForFunction(() => /Saldo por cobrar\s*USD 999,50/.test(document.querySelector(".pt-box:nth-child(1)")?.textContent || document.body.textContent));
  // Mantenimiento
  await page.click('[data-action="tab"][data-id="payments"]');
  await page.getByRole("button", { name: /Cobro/ }).first().click();
  await page.waitForSelector('[data-form="wizard"]');
  await page.selectOption('[name="kind"]', "maintenance");
  await page.fill('[name="amount"]', "30");
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.click('[data-form="wizard"] button[type="submit"]');
  await toast(page, "Cobro registrado.");
  const finance = await page.locator(".pt-box", { hasText: "Finanzas" }).textContent();
  assert.match(finance, /Saldo por cobrar\s*USD 999,50/, "el mantenimiento no reduce el saldo");
  assert.match(finance, /Mantenimiento cobrado USD 30/);
  // Un cobro que supera el saldo se frena con un mensaje claro, sin ir al servidor.
  await page.click('[data-action="tab"][data-id="payments"]');
  await page.getByRole("button", { name: /Cobro/ }).first().click();
  await page.waitForSelector('[data-form="wizard"]');
  await page.fill('[name="amount"]', "5000");
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.click('[data-form="wizard"] button[type="submit"]');
  await page.locator("#wizard-error", { hasText: "supera lo que falta cobrar" }).waitFor();
  await page.click('[data-action="wizard-cancel"]');
  check("cobros: el saldo lo calcula el servidor, el mantenimiento no lo reduce y el exceso se frena");

  // ---- 5. Etapa, actualización en borrador → publicación explícita, nota interna ----
  await page.getByRole("button", { name: "Pasar a Construcción" }).click();
  await page.waitForSelector("dialog[open]");
  await page.check('[name="draft"]');
  await page.fill('[name="body"]', "Arrancamos la construcción.");
  await page.click('dialog button[type="submit"]');
  await toast(page, "El borrador para el cliente espera tu revisión.");
  await page.locator(".pt-current-name", { hasText: "Construcción" }).waitFor();
  const updates = page.locator(".pt-log-item");
  await updates.filter({ hasText: "Borrador" }).waitFor();
  await page.getByRole("button", { name: /Registro/ }).click();
  await page.waitForSelector("dialog[open]");
  await page.selectOption('[name="updateKind"]', "internal_note");
  await page.fill('[name="body"]', "Nota interna: el cliente pidió descuento.");
  await page.click('dialog button[type="submit"]');
  await toast(page, "Nota interna guardada");
  const note = updates.filter({ hasText: "Nota interna: el cliente pidió descuento." });
  await note.waitFor();
  assert.equal(await note.getByRole("button", { name: /Publicar/ }).count(), 0, "una nota interna no se puede publicar");
  const draft = updates.filter({ hasText: "Arrancamos la construcción." });
  await draft.getByRole("button", { name: "Publicar al cliente" }).click();
  await page.waitForSelector("dialog[open]");
  assert.match(await page.locator(".live-preview").textContent(), /Arrancamos la construcción\./);
  assert.equal(await page.locator('dialog [name="confirm"]').getAttribute("required"), "", "la confirmación es obligatoria");
  await page.check('dialog [name="confirm"]');
  await page.click('dialog button[type="submit"]');
  await toast(page, "Publicado. El cliente ya lo ve");
  await updates.filter({ hasText: "Publicada" }).first().waitFor();
  const preview = (await apiGet(context, `/admin/projects/${projectId}/updates`)).body;
  assert.equal(preview.updates.find((update) => update.kind === "internal_note").state, "internal");
  assert.equal(preview.updates.find((update) => update.kind === "status_change").state, "published");
  await noOverflow(page, "proyecto 1440");
  await shot(page, "proyecto-1440-dark");
  check("actualización: borrador → publicación con confirmación; la nota interna sigue interna");

  // ---- 6. Hito y pausa ----
  await page.click('[data-action="tab"][data-id="milestones"]');
  await page.getByRole("button", { name: /Hito/ }).first().click();
  await page.waitForSelector("dialog[open]");
  await page.fill('[name="title"]', "Primer entregable");
  await page.fill('[name="plannedOn"]', "2026-10-30");
  await page.click('dialog button[type="submit"]');
  await toast(page, "Hito creado");
  const milestone = page.locator(".live-milestones li", { hasText: "Primer entregable" });
  await milestone.getByText("Interno", { exact: true }).waitFor();
  await milestone.getByRole("button", { name: "Completar" }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill('[name="evidence"]', "Revisión en staging");
  await page.click('dialog button[type="submit"]');
  await toast(page, "Hito completado.");
  await page.getByRole("button", { name: "Pausar" }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill('[name="reason"]', "Esperando material del cliente");
  await page.click('dialog button[type="submit"]');
  await toast(page, "Proyecto en pausa.");
  await page.locator(".pt-pause-title", { hasText: "En pausa" }).waitFor();
  await page.getByRole("button", { name: "Retomar" }).click();
  await toast(page, "Proyecto retomado.");
  check("hitos (completar exige evidencia) y pausa/retomar");

  await calm();
  // ---- 7. Cobros globales ----
  await goto(page, "#cobros");
  await page.waitForSelector(".pt-row");
  await page.click('[data-action="filter"][data-id="cobros.status"][data-kind="todos"]');
  const mine = page.locator(".pt-row", { hasText: String(stamp) });
  await mine.first().waitFor();
  assert.equal(await mine.count(), 3, "la seña, la cuota y el mantenimiento de este proyecto");
  const ledger = await mine.allTextContents();
  assert.ok(ledger.some((text) => /Seña/.test(text) && /500,50/.test(text)));
  assert.ok(ledger.some((text) => /Mantenimiento/.test(text) && /\b30\b/.test(text)));
  assert.match(await page.locator(".pt-overview").first().textContent(), /incluye mantenimiento USD [1-9]/);
  await page.click('[data-action="filter"][data-id="cobros.status"][data-kind="collected"]');
  await noOverflow(page, "cobros 1440");
  await shot(page, "cobros-1440-dark");
  check("el libro de cobros suma lo cobrado de todos los proyectos");

  await calm();
  // ---- 8. Permisos: lo que la cuenta no puede hacer se oculta o se explica ----
  const limited = await newPage(context);
  await limited.route(`${API}/api/v1/auth/admin/me`, async (route) => {
    const response = await route.fetch({ headers: { ...route.request().headers(), origin: PORTAL } });
    const body = await response.json();
    if (!response.ok() || !body.admin) return route.fulfill({ response });
    body.admin.permissions = body.admin.permissions.filter((permission) => !["billing:read", "billing:write", "updates:send", "requests:review"].includes(permission));
    await route.fulfill({ response, json: body });
  });
  const writes = [];
  limited.on("request", (req) => { if (req.method() !== "GET" && req.url().includes("/api/v1/admin/")) writes.push(req.url()); });
  await limited.goto(`${PORTAL}/#proyectos/${projectId}`);
  await limited.waitForSelector(".pt-current");
  assert.match(await limited.locator(".pt-box", { hasText: "Finanzas" }).textContent(), /billing:read/);
  await limited.click('[data-action="tab"][data-id="updates"]');
  assert.equal(await limited.getByRole("button", { name: "Publicar al cliente" }).count(), 0);
  await goto(limited, "#cobros");
  await limited.locator(".live-forbidden").waitFor();
  await goto(limited, "#solicitudes");
  await limited.locator(".pt-row-name").first().click();
  await limited.waitForSelector(".pt-current");
  assert.equal(await limited.getByRole("button", { name: "Rechazar" }).count(), 0, "sin requests:review no hay botones de revisión");
  assert.equal(writes.length, 0, "sin permiso no se envía ninguna escritura");
  await limited.close();
  check("permisos: se ocultan o explican las acciones que la cuenta no puede hacer (sin escrituras)");

  await calm();
  // ---- 9. Sesión: refresh transparente y vuelta al login si no se puede renovar ----
  const refreshCalls = [];
  const flaky = await newPage(context);
  let served401 = false;
  await flaky.route(`${API}/api/v1/admin/projects?**`, async (route) => {
    if (!served401) { served401 = true; return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Unauthorized" }, requestId: "11111111-1111-4111-8111-111111111111" }) }); }
    return route.continue();
  });
  flaky.on("request", (req) => { if (req.url().endsWith("/auth/admin/refresh")) refreshCalls.push(req.url()); });
  await flaky.goto(`${PORTAL}/#proyectos`);
  try {
    await flaky.locator(".pt-row-name", { hasText: String(stamp) }).waitFor();
  } catch (error) {
    await flaky.screenshot({ path: `${shots}/debug-flaky.png`, fullPage: true });
    throw new Error(`La lista no apareció tras el refresh. Pantalla: ${(await flaky.locator("body").innerText()).slice(0, 600)}`, { cause: error });
  }
  assert.equal(refreshCalls.length, 1, "un 401 dispara un solo refresh y la lista se carga igual");
  await flaky.close();

  const doomed = await newPage(context);
  await doomed.goto(`${PORTAL}/#proyectos`);
  await doomed.locator(".pt-row-name", { hasText: String(stamp) }).waitFor();
  await doomed.route(`${API}/api/v1/auth/admin/refresh`, (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAUTHORIZED", message: "x" }, requestId: "22222222-2222-4222-8222-222222222222" }) }));
  await doomed.route(`${API}/api/v1/admin/projects/${projectId}`, (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAUTHORIZED", message: "x" }, requestId: "33333333-3333-4333-8333-333333333333" }) }));
  await doomed.evaluate((id) => { location.hash = `#proyectos/${id}`; }, projectId);
  await doomed.locator("#auth-email").waitFor();
  assert.match(await doomed.locator(".live-auth-notice").textContent(), /sesión venció/i);
  assert.equal(await doomed.locator(".pt-nav a").count(), 0, "al perder la sesión no queda ningún dato en pantalla");
  await doomed.close();
  check("sesión: refresh transparente ante un 401 y vuelta al login si no se puede renovar");

  await calm();
  // ---- 10. Cerrar sesión ----
  await page.locator(".pt-mode [data-action=\"live-logout\"]").click();
  await page.locator("#auth-email").waitFor();
  assert.equal(await page.locator(".pt-nav a").count(), 0);
  assert.ok(!(await page.content()).includes(`Clínica E2E ${stamp}`), "tras cerrar sesión no queda nada del servidor en el DOM");
  const after = await apiGet(context, "/admin/projects");
  assert.equal(after.status, 401, "el servidor revocó la sesión");
  check("cerrar sesión revoca en el servidor y limpia la pantalla");
  await context.close();

  await calm();
  // ---- 11. Capturas en ambos temas y anchos; sin desbordes ----
  // El servidor limita los intentos de credenciales (50 cada 15 min por IP): el paso del código solo se captura en los casos nuevos.
  const matrix = [[375, "dark", false], [375, "light", true], [1440, "light", true]];
  for (const [width, theme, withCode] of matrix) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce" });
    const p = await newPage(ctx, { theme, width, height: 900 });
    await ready(p);
    await p.locator("#auth-email").waitFor();
    await noOverflow(p, `login ${width} ${theme}`);
    await shot(p, `login-${width}-${theme}`);
    if (withCode) {
      await p.fill("#auth-email", E2E_ADMIN.email);
      await p.fill("#auth-password", E2E_ADMIN.password);
      await p.click('button[type="submit"]');
      await p.waitForSelector("#auth-code");
      await noOverflow(p, `mfa ${width} ${theme}`);
      await shot(p, `mfa-${width}-${theme}`);
    }
    await ctx.close();
  }
  const authed = await browser.newContext({ viewport: { width: 375, height: 900 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce" });
  const mobile = await newPage(authed, { width: 375, height: 900 });
  await ready(mobile);
  await mobile.locator("#auth-email").waitFor();
  await login(mobile);
  const responsive = [["#solicitudes", "solicitudes"], [`#proyectos/${projectId}`, "proyecto"], ["#cobros", "cobros"], ["#hoy", "hoy"]];
  for (const theme of ["dark", "light"]) {
    for (const width of [375, 1440]) {
      await mobile.setViewportSize({ width, height: 900 });
      await mobile.evaluate((value) => { document.documentElement.dataset.theme = value; localStorage.setItem("eclipse-theme", value); }, theme);
      for (const [hash, name] of responsive) {
        await calm(60);
        await goto(mobile, hash);
        await mobile.waitForTimeout(900);
        await noOverflow(mobile, `${name} ${width} ${theme}`);
        if (["solicitudes", "proyecto", "cobros"].includes(name)) await shot(mobile, `${name}-${width}-${theme}`);
      }
      await goto(mobile, `#proyectos/${projectId}`);
      await mobile.click('[data-action="tab"][data-id="payments"]');
      await mobile.getByRole("button", { name: /Cobro/ }).first().click();
      await mobile.waitForSelector('[data-form="wizard"]');
      await noOverflow(mobile, `form cobro ${width} ${theme}`);
      await shot(mobile, `cobro-form-${width}-${theme}`);
      await mobile.click('[data-action="wizard-cancel"]');
    }
  }
  await authed.close();
  check("capturas en 375 y 1440 px, tema oscuro y claro, sin desbordes horizontales");

  assert.deepEqual(errorsSeen, [], `errores en consola:\n${errorsSeen.join("\n")}`);
  console.log(`\n${checks} recorridos del modo live contra el servidor real. Capturas en test-results/live/. Sin errores de JavaScript.`);
} catch (error) {
  console.error(error);
  if (throttled.length) console.error(`El servidor respondió 429 (límite de pedidos) ${throttled.length} veces: ${throttled.slice(0, 5).join(", ")}`);
  for (const [index, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      await page.screenshot({ path: `${shots}/fallo-${index}-${pageIndex}.png`, fullPage: true }).catch(() => {});
      console.error(`Pantalla ${index}.${pageIndex} (${page.url()}): ${(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500)}`);
    }
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
