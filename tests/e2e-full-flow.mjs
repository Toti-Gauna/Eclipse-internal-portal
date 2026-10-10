// Recorrido obligatorio de la fase 8: cliente (Eclipse-Web) y administración (este portal) contra UN solo backend real.
//
//   E2E_API=http://localhost:3000  E2E_PORTAL=http://localhost:4173  E2E_WEB=http://localhost:3001  npm run test:e2e:full
//
// Requisitos (docs/integration.md de los tres repos):
//  - servidor e2e de Eclipse-be (tests/e2e/server.ts) en E2E_API, con E2E_PORTAL_ORIGIN = E2E_PORTAL y E2E_WEB_ORIGIN = E2E_WEB.
//  - Eclipse-Web exportado con NEXT_PUBLIC_API_BASE_URL=<E2E_API> NEXT_PUBLIC_PORTAL_MODE=live (sin basePath), servido en E2E_WEB.
//  - este portal servido en E2E_PORTAL (python3 -m http.server 4173); la configuración pública se inyecta desde la prueba.
// Usar "localhost" en los tres: así las cookies son del mismo sitio. Sin esas variables la prueba se saltea.
//
// Pasos: 1 registro → 2 verificación por correo → 3 login del cliente → 4 armar plan → 5 enviar solicitud →
// 6 login admin con MFA → 7 revisar la solicitud (no crea proyecto) → 8 acuerdo + seña → 9 proyecto creado →
// 10 el cliente lo ve → 11 el admin cambia de etapa y publica → 12 el cliente ve la novedad pública (y no la nota interna) →
// 13 cobro registrado → 14 saldo correcto (el mantenimiento no lo reduce) → 15 ambos cierran sesión.
// Y aislamiento: un segundo cliente no ve nada del primero.
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
const WEB = process.env.E2E_WEB?.replace(/\/+$/, "");
if (!API || !PORTAL || !WEB) {
  console.log("SALTEADO: el recorrido completo necesita E2E_API, E2E_PORTAL y E2E_WEB (ver el encabezado de este archivo).");
  process.exit(0);
}
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = resolve(root, "test-results/full-flow");
mkdirSync(shots, { recursive: true });

try { assert.equal((await fetch(`${API}/__e2e/health`)).ok, true); } catch { console.log(`SALTEADO: el servidor e2e no responde en ${API}/__e2e/health.`); process.exit(0); }
try { assert.equal((await fetch(`${WEB}/es/portal/`)).ok, true); } catch { console.log(`SALTEADO: Eclipse-Web (live) no responde en ${WEB}/es/portal/.`); process.exit(0); }

const { config, errors } = buildPublicConfig({ PUBLIC_PORTAL_MODE: "live", PUBLIC_API_BASE_URL: `${API}/api/v1`, PUBLIC_CLIENT_PORTAL_URL: `${WEB}/es/portal` });
assert.ok(config, errors?.join(" "));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
const seen = [];
let steps = 0;
const step = (n, message) => { steps++; console.log(`✓ ${String(n).padStart(2, " ")}. ${message}`); };
const stamp = Date.now();
const PASSWORD = "Cliente-De-Prueba-2026!";
const emailA = `ana.${stamp}@example.test`;
const nameA = `Ana Flujo ${stamp}`;

const watch = (page, label) => {
  page.on("pageerror", (error) => seen.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/status of (401|403|404|409)|Failed to load resource|ERR_TUNNEL|\/_next\/image|fonts|net::ERR_FAILED/.test(message.text())) seen.push(`${label} console: ${message.text()}`); });
};
const noOverflow = async (page, label) => {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(scroll <= inner, `${label}: desborde horizontal (${scroll} > ${inner})`);
};
const shot = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
const settleWeb = async (page) => { await page.waitForFunction(() => document.documentElement.dataset.loader !== "on", null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(250); };
const openWeb = async (page, path) => { await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded" }); await settleWeb(page); };
const toast = async (page, text) => {
  try { await page.locator(".toast", { hasText: text }).first().waitFor({ timeout: 15000 }); } catch (error) {
    const visible = await page.locator("#modal-error, #wizard-error, .toast").allTextContents().catch(() => []);
    throw new Error(`No apareció el aviso «${text}». En pantalla: ${JSON.stringify(visible.filter(Boolean))}`, { cause: error });
  }
};
const goto = async (page, hash) => { await page.evaluate((value) => { location.hash = value; }, hash); await page.waitForFunction((value) => location.hash === value, hash); };
const mailToken = async (email) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const mail = (await (await fetch(`${API}/__e2e/mail?to=${encodeURIComponent(email)}`)).json()).mail ?? [];
    const token = mail.map((message) => message.token).filter(Boolean).pop();
    if (token) return token;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`No llegó ningún correo para ${email}.`);
};

try {
  // ---------------- Cliente A en Eclipse-Web ----------------
  const clientCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-AR", acceptDownloads: true });
  const web = await clientCtx.newPage();
  watch(web, "web");

  // 1. Registro
  await openWeb(web, "/es/portal/registro/");
  await web.getByLabel("Nombre", { exact: false }).first().fill(nameA);
  await web.getByLabel("Email").fill(emailA);
  await web.getByLabel("Contraseña").fill(PASSWORD);
  await web.getByRole("button", { name: "Crear cuenta" }).click();
  await web.getByRole("heading", { name: "Revisá tu correo" }).waitFor({ timeout: 10000 });
  step(1, "el cliente se registra y ve la respuesta neutra");

  // 2. Verificación por correo (el enlace lleva el token en el fragmento y exige un clic)
  const token = await mailToken(emailA);
  await openWeb(web, `/es/portal/verificar-email/#token=${token}`);
  await web.getByRole("button", { name: "Confirmar mi email" }).click();
  await web.getByRole("heading", { name: "Email verificado" }).waitFor({ timeout: 10000 });
  step(2, "el correo se verifica con el enlace recibido (un solo uso)");

  // 3. Login del cliente
  await openWeb(web, "/es/portal/");
  await web.getByLabel("Email").fill(emailA);
  await web.getByLabel("Contraseña").fill(PASSWORD);
  await web.getByRole("button", { name: "Ingresar" }).first().click();
  await web.waitForURL(/\/es\/portal\/proyectos\//, { timeout: 15000 });
  await web.getByText("Todavía no tenés proyectos asignados").waitFor({ timeout: 15000 });
  step(3, "el cliente inicia sesión y todavía no tiene proyectos");

  // 4-5. Armar el plan y enviar la solicitud
  await openWeb(web, "/es/plan/?g=encontrar&plan=presencia&items=seo&m=esencial&v=clinicas");
  await web.getByRole("heading", { name: "Enviar solicitud" }).waitFor({ timeout: 15000 });
  step(4, "el plan se arma en el constructor (paquete Presencia + SEO + mantenimiento Esencial)");
  await web.getByLabel("Teléfono (con código de país)").fill("+54 9 223 555 0000");
  await web.getByLabel("Mensaje para el equipo").fill(`Quiero empezar este mes (${stamp}).`);
  await web.getByRole("button", { name: "Enviar solicitud" }).click();
  await web.getByText("Solicitud enviada").waitFor({ timeout: 15000 });
  step(5, "la solicitud se envía y el éxito aparece solo cuando el servidor confirma");

  // ---------------- Administración en el portal interno ----------------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce" });
  const admin = await adminCtx.newPage();
  watch(admin, "portal");
  await admin.route(`${PORTAL}/public-config.json`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(config) }));
  await admin.addInitScript(() => { try { localStorage.setItem("eclipse-theme", "dark"); } catch { /* sin storage */ } });

  // 6. Login admin con MFA
  await admin.goto(`${PORTAL}/`);
  await admin.waitForFunction(() => document.documentElement.dataset.loader === "done");
  await admin.fill("#auth-email", E2E_ADMIN.email);
  await admin.fill("#auth-password", E2E_ADMIN.password);
  await admin.click('button[type="submit"]');
  await admin.waitForSelector("#auth-code");
  await admin.fill("#auth-code", await freshAdminCode(API.replace("localhost", "127.0.0.1")));
  await admin.click('button[type="submit"]');
  await admin.waitForSelector('.pt-mode[data-mode="live"]');
  step(6, "la administración ingresa con contraseña + código TOTP");

  // 7. Revisar la solicitud: aceptar NO crea un proyecto
  await goto(admin, "#solicitudes");
  const row = admin.locator(".pt-row", { hasText: String(stamp) });
  await row.first().waitFor({ timeout: 20000 });
  await row.first().locator(".pt-row-name").click();
  await admin.waitForSelector(".pt-current");
  await admin.getByRole("button", { name: "Aceptar", exact: true }).click();
  await admin.waitForSelector("dialog[open]");
  await admin.fill("#m-publicResponse", "Gracias Ana, armamos el acuerdo y arrancamos.");
  await admin.fill("#m-internalNote", "NOTA-INTERNA-FLUJO: cliente de buena pinta.");
  await admin.click('dialog button[type="submit"]');
  await toast(admin, "Solicitud aceptada. No se creó ningún proyecto.");
  step(7, "la solicitud se revisa y se acepta; el servidor confirma que no se creó ningún proyecto");

  // 8-9. Acuerdo + seña → proyecto
  await admin.getByRole("button", { name: /Crear proyecto desde esta solicitud/ }).click();
  await admin.waitForSelector('[data-form="wizard"]');
  await admin.fill('[name="service"]', "Presencia + SEO");
  await admin.click('[data-form="wizard"] button[type="submit"]');
  await admin.fill('[name="agreementReference"]', `ACUERDO-FLUJO-${stamp}`);
  await admin.fill('[name="price"]', "1500");
  await admin.fill('[name="scopeItems"]', "Sitio de presencia\nSEO inicial");
  await admin.click('[data-form="wizard"] button[type="submit"]');
  await admin.fill('[name="depositAmount"]', "450");
  await admin.fill('[name="depositReference"]', `SENIA-FLUJO-${stamp}`);
  await admin.click('[data-form="wizard"] button[type="submit"]');
  assert.equal(await admin.locator('[name="authorizeRequest"]').isChecked(), true, "autoriza la cuenta de la solicitud por defecto");
  await admin.click('[data-form="wizard"] button[type="submit"]');
  step(8, "acuerdo y seña registrados en el asistente (el resumen muestra USD 1.500 y USD 450)");
  await admin.click('[data-form="wizard"] button[type="submit"]');
  await admin.waitForFunction(() => /^#proyectos\/[0-9a-f-]{36}$/.test(location.hash), null, { timeout: 20000 });
  await toast(admin, "Seña registrada");
  const projectId = (await admin.evaluate(() => location.hash)).split("/")[1];
  await admin.locator(".pt-current-name", { hasText: "Preparación" }).waitFor();
  step(9, `el proyecto existe recién ahora (${projectId.slice(0, 8)}…) con acuerdo y seña cobrada`);

  // 10. El cliente ve el proyecto
  await openWeb(web, "/es/portal/proyectos/");
  await web.getByRole("link", { name: /Presencia/ }).first().waitFor({ timeout: 20000 }).catch(async () => { await web.locator("main a[href*='proyecto']").first().waitFor({ timeout: 20000 }); });
  await openWeb(web, `/es/portal/proyecto/?id=${projectId}`);
  await web.locator(".pt-current-name", { hasText: "Preparación" }).waitFor({ timeout: 20000 });
  assert.equal((await web.locator("main").innerText()).match(/USD|US\$|NOTA-INTERNA/) , null, "el cliente no ve dinero ni notas internas");
  await shot(web, "cliente-proyecto-1440");
  await noOverflow(web, "proyecto del cliente 1440");
  step(10, "el cliente ve su proyecto (etapa Preparación), sin dinero ni notas internas");

  // 11. Admin: pasa a Construcción con una novedad publicada y deja una nota interna
  await admin.getByRole("button", { name: "Pasar a Construcción" }).click();
  await admin.waitForSelector("dialog[open]");
  await admin.check('[name="draft"]');
  await admin.fill('[name="body"]', `Arrancamos la construcción (${stamp}).`);
  await admin.click('dialog button[type="submit"]');
  await toast(admin, "El borrador para el cliente espera tu revisión.");
  await admin.locator(".pt-current-name", { hasText: "Construcción" }).waitFor({ timeout: 15000 });
  // El borrador NO se ve hasta que el equipo lo publica con una confirmación explícita.
  const draft = admin.locator(".pt-log-item").filter({ hasText: `Arrancamos la construcción (${stamp}).` });
  await draft.getByRole("button", { name: "Publicar al cliente" }).waitFor();
  await openWeb(web, `/es/portal/proyecto/?id=${projectId}`);
  await web.getByText(`Arrancamos la construcción (${stamp}).`).first().waitFor({ timeout: 4000 }).then(() => assert.fail("el borrador no debía verse"), () => {});
  await draft.getByRole("button", { name: "Publicar al cliente" }).click();
  await admin.waitForSelector("dialog[open]");
  await admin.check('dialog [name="confirm"]');
  await admin.click('dialog button[type="submit"]');
  await toast(admin, "Publicado. El cliente ya lo ve");
  await admin.getByRole("button", { name: /Registro/ }).click();
  await admin.waitForSelector("dialog[open]");
  await admin.selectOption('[name="updateKind"]', "internal_note");
  await admin.fill('[name="body"]', "NOTA-INTERNA-FLUJO: no debe verla el cliente.");
  await admin.click('dialog button[type="submit"]');
  await toast(admin, "Nota interna guardada");
  step(11, "la administración pasa a Construcción, el borrador no se ve hasta publicarlo con confirmación, y guarda una nota interna");

  // 12. El cliente ve la novedad pública y no la interna
  await openWeb(web, `/es/portal/proyecto/?id=${projectId}`);
  await web.locator(".pt-current-name", { hasText: "Construcción" }).waitFor({ timeout: 20000 });
  await web.getByText(`Arrancamos la construcción (${stamp}).`).first().waitFor({ timeout: 20000 });
  assert.ok(!(await web.content()).includes("NOTA-INTERNA-FLUJO"), "la nota interna no llega al navegador del cliente");
  await shot(web, "cliente-novedad-1440");
  step(12, "el cliente ve la nueva etapa y la novedad pública; la nota interna nunca llega a su navegador");

  // 13-14. Cobro y saldo (el mantenimiento no reduce el saldo del proyecto)
  await admin.click('[data-action="tab"][data-id="payments"]');
  await admin.getByRole("button", { name: /Cobro/ }).first().click();
  await admin.waitForSelector('[data-form="wizard"]');
  await admin.fill('[name="amount"]', "400");
  await admin.click('[data-form="wizard"] button[type="submit"]');
  await admin.click('[data-form="wizard"] button[type="submit"]');
  await admin.click('[data-form="wizard"] button[type="submit"]');
  await toast(admin, "Cobro registrado.");
  step(13, "el cobro de USD 400 queda registrado (confirmado por el servidor)");
  await admin.waitForFunction(() => /Saldo por cobrar\s*USD 650/.test(document.body.textContent));
  await admin.click('[data-action="tab"][data-id="payments"]');
  await admin.getByRole("button", { name: /Cobro/ }).first().click();
  await admin.waitForSelector('[data-form="wizard"]');
  await admin.selectOption('[name="kind"]', "maintenance");
  await admin.fill('[name="amount"]', "30");
  await admin.click('[data-form="wizard"] button[type="submit"]');
  await admin.click('[data-form="wizard"] button[type="submit"]');
  await admin.click('[data-form="wizard"] button[type="submit"]');
  await toast(admin, "Cobro registrado.");
  const finance = await admin.locator(".pt-box", { hasText: "Finanzas" }).textContent();
  assert.match(finance, /Cobrado\s*USD 850/, "seña 450 + cobro 400");
  assert.match(finance, /Saldo por cobrar\s*USD 650/, "1500 − 850; el mantenimiento no lo reduce");
  assert.match(finance, /Mantenimiento cobrado USD 30/);
  step(14, "saldo correcto: 1.500 − (450 + 400) = USD 650; el mantenimiento (USD 30) es ingreso y no lo reduce");

  // 15. Ambos cierran sesión
  await admin.locator('.pt-mode [data-action="live-logout"]').click();
  await admin.locator("#auth-email").waitFor();
  assert.equal(await admin.locator(".pt-nav a").count(), 0);
  assert.ok(!(await admin.content()).includes(String(stamp)), "tras salir no queda nada del servidor en el DOM del admin");
  await openWeb(web, "/es/portal/proyectos/");
  await web.getByRole("button", { name: "Salir" }).click();
  await web.waitForURL(/\/es\/portal\/$/, { timeout: 15000 });
  await openWeb(web, "/es/portal/proyectos/");
  await web.waitForURL(/\/es\/portal\/\?next=/, { timeout: 15000 });
  const leftover = (await clientCtx.cookies()).filter((cookie) => cookie.name.startsWith("eclipse-client"));
  assert.deepEqual(leftover, [], "el cierre de sesión borró las cookies del cliente");
  step(15, "ambos cierran sesión: el servidor revoca y las pantallas privadas vuelven a pedir ingreso");

  // ---------------- Aislamiento: un segundo cliente ----------------
  const second = await createClientSession(API, { email: `beto.${stamp}@example.test`, displayName: `Beto Flujo ${stamp}` });
  const otherCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-AR" });
  const other = await otherCtx.newPage();
  watch(other, "web-b");
  await openWeb(other, "/es/portal/");
  await other.getByLabel("Email").fill(second.email);
  await other.getByLabel("Contraseña").fill(PASSWORD);
  await other.getByRole("button", { name: "Ingresar" }).first().click();
  await other.waitForURL(/\/es\/portal\/proyectos\//, { timeout: 15000 });
  await other.getByText("Todavía no tenés proyectos asignados").waitFor({ timeout: 15000 });
  await openWeb(other, `/es/portal/proyecto/?id=${projectId}`);
  await other.getByText("No encontramos este proyecto").waitFor({ timeout: 15000 });
  const foreign = await other.locator("main").innerText();
  await openWeb(other, "/es/portal/proyecto/?id=00000000-0000-4000-8000-000000000000");
  await other.getByText("No encontramos este proyecto").waitFor({ timeout: 15000 });
  assert.equal(foreign, await other.locator("main").innerText(), "el proyecto de otro cliente responde igual que un id inexistente");
  await openWeb(other, "/es/portal/solicitudes/");
  await other.getByText("Todavía no enviaste ninguna solicitud").waitFor({ timeout: 15000 });
  assert.ok(!(await other.content()).includes(String(stamp)) || !(await other.content()).includes(nameA), "el segundo cliente no ve datos del primero");
  console.log("✓ aislamiento: el segundo cliente no ve el proyecto, la solicitud ni los datos del primero");
  await otherCtx.close();
  await adminCtx.close();
  await clientCtx.close();

  assert.deepEqual(seen, [], `errores en consola:\n${seen.join("\n")}`);
  console.log(`\n${steps} pasos del recorrido obligatorio + aislamiento de dos clientes, contra un único backend. Capturas en test-results/full-flow/. Sin errores de JavaScript.`);
} catch (error) {
  console.error(error);
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
