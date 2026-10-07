import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = process.env.SITE_DIR ? resolve(process.env.SITE_DIR) : root;
const artifacts = resolve(root, "test-results");
await mkdir(artifacts, { recursive: true });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const path = resolve(siteRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!path.startsWith(`${siteRoot}/`)) { res.writeHead(403).end(); return; }
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("eclipse-ops-v2")));
const go = async (hash) => {
  await page.evaluate((hash) => { location.hash = hash; }, hash);
  await page.waitForFunction((hash) => location.hash === hash && !document.querySelector('[data-form="wizard"]'), hash);
  await page.waitForTimeout(70);
};
const continueStep = () => page.locator('[data-form="wizard"] button[type="submit"]').click();
const field = (name) => page.locator(`[data-form="wizard"] [name="${name}"]`);
const openData = async () => { await page.locator(".workspace-menu summary").click(); await page.locator('[data-action="open-data"]').click(); };
const waitSaved = (predicate) => page.waitForFunction(predicate);
let checks = 0;
function check(message) { checks++; console.log(`✓ ${message}`); }

try {
  await page.goto(base);
  await page.waitForFunction(() => document.documentElement.dataset.loader === "done");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal((await saved()).version, 3);
  assert.equal(await page.locator('[aria-labelledby="today-title"] .pt-row').count(), 5);
  const initialRows = await page.locator('[aria-labelledby="today-title"] .pt-row-name').allTextContents();
  await page.locator('[data-action="page"][data-id="today"][data-kind="2"]').click();
  assert.equal(await page.locator('[aria-labelledby="today-title"] .pt-row').count(), 5);
  assert.notDeepEqual(await page.locator('[aria-labelledby="today-title"] .pt-row-name').allTextContents(), initialRows);
  check("oscuro por defecto y agenda de cinco ítems por página");

  await go("#metas/goal-sales");
  await page.locator('[data-step="step-sales-2"]').check();
  await page.locator('[data-step="step-sales-3"]').check();
  assert.ok((await saved()).goals.find((goal) => goal.id === "goal-sales").completedAt);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.loader === "done");
  assert.equal(await page.locator('.goal-checklist input:checked').count(), 3);
  await page.locator('[data-step="step-sales-1"]').uncheck();
  assert.equal((await saved()).goals.find((goal) => goal.id === "goal-sales").completedAt, null);
  check("subtareas, cierre automático, reapertura y persistencia tras recargar");

  const today = (await saved()).goals[0].due;
  await page.locator('.hdr-plan').click();
  assert.equal(await page.locator("dialog").count(), 0);
  await field("title").fill("Meta de prueba <segura>");
  await field("category").selectOption("Ventas");
  await continueStep();
  await field("due").fill(today);
  await field("time").fill("10:30");
  await field("steps").fill("Preparar propuesta\nEnviar propuesta");
  await field("reference").selectOption("project:pr-turnos");
  await page.locator('[data-action="wizard-prev"]').click();
  assert.equal(await field("title").inputValue(), "Meta de prueba <segura>");
  await continueStep();
  assert.equal(await field("steps").inputValue(), "Preparar propuesta\nEnviar propuesta");
  await page.locator('[data-action="theme-toggle"]').click();
  assert.equal(await field("steps").inputValue(), "Preparar propuesta\nEnviar propuesta");
  await continueStep();
  assert.ok((await page.locator(".generator-summary").textContent()).includes("Meta de prueba <segura>"));
  await continueStep();
  await page.waitForURL(/#metas\/goal-/);
  let data = await saved();
  const goal = data.goals.find((goal) => goal.title === "Meta de prueba <segura>");
  assert.equal(goal.steps.length, 2);
  assert.equal(goal.reference, "project:pr-turnos");
  await page.locator(".goal-checklist input").nth(0).check();
  await page.locator(".goal-checklist input").nth(1).check();
  assert.ok((await saved()).goals.find((item) => item.id === goal.id).completedAt);
  await page.screenshot({ path: `${artifacts}/goal-light.png`, fullPage: true });
  check("generador de metas, pasos anteriores, tema durante el borrador y texto seguro");

  await page.locator('[data-action="new-goal"][data-id]').click();
  await continueStep();
  await field("steps").fill("Preparar propuesta\nEnviar propuesta\nAgendar seguimiento");
  await continueStep(); await continueStep();
  await page.waitForURL(/#metas\/goal-/);
  const editedGoal = (await saved()).goals.find((item) => item.id === goal.id);
  assert.equal(editedGoal.steps.filter((step) => step.done).length, 2);
  assert.equal(editedGoal.completedAt, null);
  check("editar una meta conserva los pasos hechos y reabre al agregar un pendiente");

  await page.locator(".hdr-plan").click();
  const inspirationValue = await field("inspiration").locator("option").nth(1).getAttribute("value");
  await field("inspiration").selectOption(inspirationValue);
  assert.ok((await field("title").inputValue()).length > 0);
  assert.notEqual(await field("category").inputValue(), "Operación");
  await continueStep();
  assert.ok((await field("reference").inputValue()).includes(":"));
  await page.locator('[data-action="wizard-cancel"]').first().click();
  check("seleccionar acciones pendientes desde el header genera una meta vinculada");

  await go("#calendario");
  await page.locator(`[data-action="calendar-day"][data-id="${today}"]`).click();
  await page.locator('[data-action="new-event"]').first().click();
  await field("title").fill("Llamada comercial de prueba");
  await field("reference").selectOption("prospect:p-constructora");
  await continueStep();
  await field("time").fill("15:15");
  await field("duration").fill("30");
  await continueStep();
  assert.ok((await page.locator(".generator-warning").textContent()).includes("coincide"));
  await continueStep();
  await page.waitForURL(/#calendario\/event-/);
  const event = (await saved()).calendarEvents.find((event) => event.title === "Llamada comercial de prueba");
  assert.equal(event.date, today);
  assert.equal(event.time, "15:15");
  assert.ok(event.startAt.endsWith("Z"));
  await page.locator('[data-action="calendar-filter"][data-id="eventos"]').click();
  await page.locator(`[data-action="event-toggle"][data-id="${event.id}"]`).click();
  assert.ok((await saved()).calendarEvents.find((item) => item.id === event.id).completedAt);
  const eventCompletedAt = (await saved()).calendarEvents.find((item) => item.id === event.id).completedAt;
  await page.locator('[data-action="calendar-month"][data-id="1"]').click();
  assert.notEqual(await page.locator("[data-calendar-date]").inputValue(), today);
  await page.locator('[data-action="calendar-today"]').click();
  assert.equal(await page.locator("[data-calendar-date]").inputValue(), today);
  check("calendario, vínculos, detección de coincidencias, completar eventos y navegar meses");

  await go("#lotes");
  await page.locator('[data-action="new-batch"]').first().click();
  await field("name").fill("Lote de prueba");
  await field("vertical").fill("Gastronomía");
  await field("target").fill("8");
  await continueStep();
  await field("demo").fill("Demo de reservas");
  await field("hypothesis").fill("El video consigue más respuestas");
  await continueStep();
  await field("signalDays").fill("4");
  await field("closeDays").fill("3");
  await continueStep(); await continueStep();
  assert.ok((await page.locator("#wizard-error").textContent()).includes("después"));
  await page.locator('[data-action="wizard-prev"]').click();
  await field("closeDays").fill("10");
  await continueStep(); await continueStep();
  await page.waitForURL(/#lotes\/lote-/);
  const batch = (await saved()).batches.find((batch) => batch.name === "Lote de prueba");
  assert.equal(batch.signalDays, 4);
  assert.equal(batch.closeDays, 10);
  assert.ok((await page.locator(".pt-rail").textContent()).includes("D+10"));
  check("generador de lotes y cadencia personalizada validada");

  await go("#proyectos");
  await page.locator('[data-action="new-project"]').first().click();
  await field("name").fill("Proyecto de prueba");
  await field("client").fill("Cliente de prueba");
  await field("service").fill("Web y agente");
  await continueStep();
  await field("total").fill("1000");
  await field("deposit").fill("1200");
  await field("time").fill("11:45");
  await continueStep(); await continueStep(); await continueStep();
  assert.ok((await page.locator("#wizard-error").textContent()).includes("seña"));
  await page.locator('[data-action="wizard-prev"]').click();
  await page.locator('[data-action="wizard-prev"]').click();
  await field("deposit").fill("500");
  await continueStep(); await continueStep(); await continueStep();
  await page.waitForURL(/#proyectos\/pr-/);
  const project = (await saved()).projects.find((project) => project.name === "Proyecto de prueba");
  const deposit = (await saved()).payments.find((payment) => payment.projectId === project.id);
  assert.equal(deposit.amount, 500);
  assert.equal(deposit.time, "11:45");
  assert.equal(project.updates[0].time, "11:45");
  assert.equal(project.stage, "preparation");
  check("generador de proyectos, control de seña y registro conjunto de proyecto y cobro");

  await go("#proyectos/pr-turnos");
  await page.locator('[data-action="project-update"]').click();
  await field("title").fill("Avance a las 16"); await continueStep();
  await field("date").fill(today); await field("time").fill("16:00");
  await continueStep(); await continueStep();
  await page.waitForURL(/#proyectos\/pr-turnos/);
  await page.locator('[data-action="project-update"]').click();
  await field("title").fill("Avance a las 09"); await continueStep();
  await field("date").fill(today); await field("time").fill("09:00");
  await continueStep(); await continueStep();
  await page.waitForURL(/#proyectos\/pr-turnos/);
  const titles = await page.locator(".pt-log-title").allTextContents();
  assert.ok(titles.indexOf("Proyecto confirmado") < titles.indexOf("Arranca Construcción"));
  assert.ok(titles.indexOf("Avance a las 09") < titles.indexOf("Avance a las 16"));
  assert.ok((await page.locator(".pt-log").textContent()).includes("Hora no registrada"));
  check("historial de antiguo a reciente, con orden por hora y datos antiguos conservados");

  await page.locator('[data-action="project-milestone"]').click();
  await field("title").fill("Hito de auditoría");
  await field("due").fill(today); await field("time").fill("17:00");
  await continueStep();
  await field("recordTime").fill("12:20");
  await continueStep(); await continueStep();
  await page.waitForURL(/#proyectos\/pr-turnos/);
  const milestoneProject = (await saved()).projects.find((item) => item.id === "pr-turnos");
  assert.equal(milestoneProject.milestone.time, "17:00");
  assert.equal(milestoneProject.updates.at(-1).time, "12:20");
  check("hitos distinguen hora planificada y hora de registro");

  await page.locator('[data-action="client-action"]').click();
  await field("title").fill("Enviar accesos de prueba"); await field("time").fill("12:30");
  await continueStep(); await continueStep();
  await page.waitForURL(/#proyectos\/pr-turnos/);
  assert.equal((await saved()).projects.find((item) => item.id === "pr-turnos").clientAction.time, "12:30");
  await page.locator('[data-action="client-action-done"]').click();
  assert.equal((await saved()).projects.find((item) => item.id === "pr-turnos").clientAction, null);
  check("acciones del cliente auditadas al pedir y resolver");

  await go("#herramientas");
  await page.locator('[data-calc="gap"]').fill("10000");
  await page.locator('[data-calc="ticket"]').fill("1500");
  await page.locator('[data-calc="conversion"]').fill("25");
  assert.ok((await page.locator(".tool-result").textContent()).includes("28"));
  await page.screenshot({ path: `${artifacts}/tools-light.png`, fullPage: true });
  await go("#actividad");
  assert.equal(await page.locator(".audit-list li").count(), 5);
  data = await saved();
  assert.ok(data.audit.every((entry) => entry.occurredAt && entry.recordedAt && entry.timezone));
  check("calculadoras reactivas y bitácora con instantes y zona horaria");

  await openData();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-action="export-data"]').click()]);
  const backup = resolve(artifacts, "backup.json");
  await download.saveAs(backup);
  assert.equal(JSON.parse(await readFile(backup, "utf8")).goals.find((item) => item.id === goal.id).steps.length, 3);
  await page.locator('[data-action="close-modal"]').click();
  await page.evaluate(() => { localStorage.removeItem("eclipse-ops-v2"); });
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.loader === "done");
  await openData();
  await page.locator('[data-action-change="import-data"]').setInputFiles(backup);
  await waitSaved(() => JSON.parse(localStorage.getItem("eclipse-ops-v2")).goals.some((goal) => goal.title === "Meta de prueba <segura>"));
  assert.equal((await saved()).calendarEvents.find((item) => item.id === event.id).completedAt, eventCompletedAt);
  check("exportar e importar conserva el plan, las subtareas y el calendario");

  await page.locator('[data-action="theme-toggle"]').click();
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.loader === "done");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await go("#hoy");
  await page.screenshot({ path: `${artifacts}/today-dark.png`, fullPage: true });
  await go("#calendario");
  await page.screenshot({ path: `${artifacts}/calendar-dark.png`, fullPage: true });

  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["#hoy", "#calendario", "#metas", "#herramientas", "#proyectos/pr-turnos"]) {
      await go(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `${route} desborda en ${width}px`);
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await go("#calendario");
  await page.screenshot({ path: `${artifacts}/calendar-mobile-dark.png`, fullPage: true });
  await page.locator('.hdr-plan').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.screenshot({ path: `${artifacts}/generator-mobile-dark.png`, fullPage: true });
  check("diseño sin desbordes en móvil, tablet y escritorio");
  assert.deepEqual(errors, []);
  if (process.env.UPDATE_PREVIEWS === "1") {
    const previewPath = resolve(root, "docs/preview");
    await mkdir(previewPath, { recursive: true });
    const review = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce" });
    const clean = await review.newPage();
    await clean.goto(base);
    await clean.waitForFunction(() => document.documentElement.dataset.loader === "done");
    await clean.screenshot({ path: `${previewPath}/hoy-oscuro.png`, fullPage: true });
    await clean.evaluate(() => { location.hash = "#calendario"; });
    await clean.waitForTimeout(180);
    await clean.screenshot({ path: `${previewPath}/calendario-oscuro.png`, fullPage: true });
    await clean.evaluate(() => { location.hash = "#metas/goal-sales"; });
    await clean.waitForTimeout(180);
    await clean.locator('[data-action="theme-toggle"]').click();
    await clean.screenshot({ path: `${previewPath}/meta-claro.png`, fullPage: true });
    await clean.locator('[data-action="theme-toggle"]').click();
    await clean.locator(".hdr-plan").click();
    await clean.waitForTimeout(180);
    await clean.screenshot({ path: `${previewPath}/generador-oscuro.png`, fullPage: true });
    await clean.locator('[data-action="wizard-cancel"]').first().click();
    await clean.setViewportSize({ width: 390, height: 844 });
    await clean.evaluate(() => { location.hash = "#calendario"; });
    await clean.waitForTimeout(180);
    await clean.screenshot({ path: `${previewPath}/calendario-movil.png`, fullPage: true });
    await review.close();
    console.log("Cinco capturas de revisión actualizadas con datos de ejemplo.");
  }
  console.log(`\n${checks} recorridos completos. Sin errores de JavaScript.`);
} catch (error) {
  await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true }).catch(() => {});
  console.error("Pantalla al fallar:", await page.locator("h1").allTextContents(), "Errores del navegador:", errors);
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
