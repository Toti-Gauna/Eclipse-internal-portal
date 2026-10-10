// Prueba de navegador del planificador en modo live (Hoy, Mi plan, Calendario, Herramientas, Bitácora) contra el backend REAL.
//
//   E2E_API=http://localhost:3202 E2E_PORTAL=http://localhost:4202 npm run test:live:planner
//
// Mismas reglas que tests/live-browser.mjs: "localhost" en ambos (cookies del mismo sitio), el portal servido en el origen admin que
// permite el servidor, una base descartable y compartida (todo lo que se crea lleva una marca única; nada depende de tablas vacías).
// Un solo ingreso por corrida (el servidor limita 50 intentos de credenciales por 15 min).
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicConfig } from "../scripts/build-public-config.mjs";
import { E2E_ADMIN, freshAdminCode } from "./support/e2e-admin.mjs";

process.env.TZ = "America/Argentina/Buenos_Aires";
const API = process.env.E2E_API?.replace(/\/+$/, "");
const PORTAL = process.env.E2E_PORTAL?.replace(/\/+$/, "");
if (!API || !PORTAL) {
  console.log("SALTEADO: la prueba del planificador necesita E2E_API (p. ej. http://localhost:3202) y E2E_PORTAL (p. ej. http://localhost:4202).");
  console.log("Levantá el servidor e2e de Eclipse-be (docs/e2e.md), servilo con `python3 -m http.server 4202` y volvé a correr `npm run test:live:planner`.");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = resolve(root, "test-results/live-planner");
mkdirSync(shots, { recursive: true });

try {
  assert.equal((await fetch(`${API}/__e2e/health`)).ok, true);
} catch {
  console.log(`SALTEADO: el servidor e2e no responde en ${API}/__e2e/health.`);
  process.exit(0);
}

const { monthGrid } = await import("../src/live/adapters/planner.js");
const { config, errors } = buildPublicConfig({ PUBLIC_PORTAL_MODE: "live", PUBLIC_API_BASE_URL: `${API}/api/v1`, PUBLIC_CLIENT_PORTAL_URL: "http://localhost:3001/es/portal" });
assert.ok(config, errors?.join(" "));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
const errorsSeen = [];
let checks = 0;
const check = (message) => { checks++; console.log(`✓ ${message}`); };
const stamp = Date.now();

// ---- Días (zona de Buenos Aires, igual que el navegador de la prueba) ----
const pad = (n) => String(n).padStart(2, "0");
const dayOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return dayOf(d); };
const TODAY = dayOf(new Date());

async function newPage(context, { theme = "dark", width = 1440, height = 1000 } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.addInitScript((value) => { try { localStorage.setItem("eclipse-theme", value); } catch { /* sin storage */ } }, theme);
  await page.route(`${PORTAL}/public-config.json`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(config) }));
  page.on("pageerror", (error) => errorsSeen.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/status of (401|403|404|409)|net::ERR_FAILED/.test(message.text())) errorsSeen.push(`console: ${message.text()}`); });
  return page;
}
const ready = async (page, hash = "") => { await page.goto(`${PORTAL}/${hash}`); await page.waitForFunction(() => document.documentElement.dataset.loader === "done"); };
const noOverflow = async (page, label) => {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(scroll <= inner, `${label}: desborde horizontal (${scroll} > ${inner})`);
};
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
const goto = async (page, hash) => { await page.evaluate((value) => { location.hash = value; }, hash); await page.waitForFunction((value) => location.hash === value, hash); };
const toast = async (page, text) => {
  try {
    await page.locator(".toast", { hasText: text }).first().waitFor({ timeout: 15000 });
  } catch (error) {
    const visible = await page.locator("#modal-error, #wizard-error, .toast").allTextContents().catch(() => []);
    throw new Error(`No apareció el aviso «${text}». En pantalla: ${JSON.stringify(visible.filter(Boolean))}`, { cause: error });
  }
};
const login = async (page) => {
  await page.fill("#auth-email", E2E_ADMIN.email);
  await page.fill("#auth-password", E2E_ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector("#auth-code");
  await page.fill("#auth-code", await freshAdminCode(API.replace("localhost", "127.0.0.1")));
  await page.click('button[type="submit"]');
  await page.waitForSelector('.pt-mode[data-mode="live"]');
};
const apiGet = async (context, path) => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await context.request.get(`${API}/api/v1${path}`, { headers: { Origin: PORTAL } });
    if (response.status() !== 429) return { status: response.status(), body: await response.json().catch(() => null) };
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`GET ${path}: el límite de la API no se liberó`);
};
const apiWrite = async (context, method, path, data) => {
  const csrf = (await (await context.request.get(`${API}/api/v1/auth/admin/csrf`, { headers: { Origin: PORTAL } })).json()).csrfToken;
  const response = await context.request.fetch(`${API}/api/v1${path}`, { method, headers: { Origin: PORTAL, "X-CSRF-Token": csrf, "Content-Type": "application/json" }, data: JSON.stringify(data) });
  return { status: response.status(), body: await response.json().catch(() => null) };
};
const calm = async (needed = 80) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(`${API}/api/v1/auth/csrf`, { headers: { Origin: PORTAL } });
    const remaining = Number(/r=(\d+)/.exec(response.headers.get("ratelimit") || "")?.[1] ?? 999);
    if (remaining >= needed) return;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
};
/** Espera a que el servidor tenga cierto estado (las escrituras ya se confirmaron en la pantalla, pero la lectura directa es independiente). */
const until = async (read, predicate, message) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(message);
};
const goalOnServer = async (context, id) => (await apiGet(context, "/admin/planner/goals")).body.goals.find((goal) => goal.id === id);
const eventOnServer = async (context, id, day = TODAY) => (await apiGet(context, `/admin/planner/events?from=${day}&to=${day}`)).body.events.find((event) => event.id === id);
/** La base de pruebas es compartida y descartable, pero los choques de horario dependen de lo que ya haya hoy: se cancelan los eventos de corridas anteriores. */
const MINE = /^(Evento E2E|Evento que se pisa|Evento de la noche|Bloque de foco · prospección|Exploración evento)/;
const cancelLeftovers = async (context) => {
  const events = (await apiGet(context, `/admin/planner/events?from=${TODAY}&to=${TODAY}`)).body.events.filter((event) => event.status !== "cancelled" && MINE.test(event.title));
  for (const event of events) await apiWrite(context, "PATCH", `/admin/planner/events/${event.id}`, { version: event.version, status: "cancelled" });
};
const MINE_GOALS = /^(Meta E2E|Meta simple|Definir mi plan para|Exploración meta|Meta cortada)/;
const cancelGoalLeftovers = async (context) => {
  for (const goal of (await apiGet(context, "/admin/planner/goals")).body.goals.filter((item) => item.status === "open" && MINE_GOALS.test(item.title))) await apiWrite(context, "PATCH", `/admin/planner/goals/${goal.id}`, { version: goal.version, status: "cancelled" });
};
/** La agenda pagina de a cinco y la base compartida acumula pendientes de otras corridas: se busca en todas las páginas de «Qué toca hoy». */
const hoyRow = async (page, hasText) => {
  const section = page.locator('section[aria-labelledby="today-title"]');
  const prev = section.locator('[aria-label="Página anterior"]');
  for (let attempt = 0; attempt < 40 && (await prev.count()) && !(await prev.isDisabled()); attempt++) await prev.click();
  for (let attempt = 0; attempt < 40; attempt++) {
    const row = section.locator(".pt-row", { hasText });
    if (await row.count()) return row.first();
    const nextButton = section.locator('[aria-label="Página siguiente"]');
    if (!(await nextButton.count()) || (await nextButton.isDisabled())) return null;
    await nextButton.click();
    await page.waitForTimeout(80);
  }
  return null;
};
const next = (page) => page.click('[data-form="wizard"] button[type="submit"]');
const idOf = async (page) => {
  await page.waitForFunction(() => /^#(metas|calendario)\/[0-9a-f-]{36}$/.test(location.hash));
  return (await page.evaluate(() => location.hash)).split("/")[1];
};

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", reducedMotion: "reduce" });
  const page = await newPage(context);
  await ready(page);
  await page.locator("#auth-email").waitFor();
  await login(page);
  const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  assert.deepEqual(storage.local.filter((key) => key !== "eclipse-theme"), []);
  assert.deepEqual(storage.session, []);

  await cancelLeftovers(context);
  await cancelGoalLeftovers(context);
  // Un proyecto real para vincular (la base de pruebas ya trae varios).
  const projects = (await apiGet(context, "/admin/projects?limit=5")).body.projects;
  assert.ok(projects.length > 0, "la base de pruebas necesita al menos un proyecto (corré antes npm run test:live)");
  const project = projects[0];

  // ---- Prospecto real para la agenda y los indicadores ----
  const lead = await apiWrite(context, "POST", "/admin/leads", { contactName: `Prospecto Planner ${stamp}`, channel: "whatsapp", handle: `@planner${stamp}`, source: "referral", sourceDetail: "Lo recomendó un cliente de pruebas", need: "Agenda online", nextAction: `Llamar a Planner ${stamp}`, nextActionOn: TODAY, firstContactOn: TODAY, acknowledgeDuplicates: true });
  assert.equal(lead.status, 201, JSON.stringify(lead.body));
  const leadId = lead.body.lead.id;

  // ---------------------------------------------------------------- Mi plan
  await goto(page, "#metas");
  await page.locator(".pt-title", { hasText: "a propósito" }).waitFor();
  await page.getByRole("button", { name: /Nueva meta/ }).click();
  await page.waitForSelector('[data-form="wizard"]');
  const goalTitle = `Meta E2E ${stamp} <b>x</b>`;
  await page.fill('[name="title"]', goalTitle);
  await page.selectOption('[name="category"]', "sales");
  await page.selectOption('[name="priority"]', "high");
  await page.fill('[name="notes"]', "Contexto <i>real</i>");
  await next(page);
  assert.equal(await page.inputValue('[name="due"]'), TODAY, "el día de la meta arranca en hoy");
  await page.fill('[name="time"]', "16:45");
  await page.fill('[name="steps"]', "Paso uno\nPaso dos\n\nPaso tres");
  await page.waitForFunction(() => document.querySelectorAll('[name="reference"] option').length > 1);
  await page.selectOption('[name="reference"]', `project:${project.id}`);
  await next(page);
  assert.match(await page.locator(".generator-summary").textContent(), /Paso uno · Paso dos · Paso tres/);
  await next(page);
  await page.waitForFunction(() => /^#metas\/[0-9a-f-]{36}$/.test(location.hash));
  await toast(page, "Meta creada con 3 pasos.");
  const goalId = await idOf(page);
  await page.locator("h1.pt-title", { hasText: `Meta E2E ${stamp}` }).waitFor();
  assert.equal(await page.locator(".pt-title b, .pt-company i").count(), 0, "el texto de la meta se escapa");
  assert.equal(await page.locator(".goal-checklist input[data-action=\"goal-step\"]").count(), 3);
  const created = await goalOnServer(context, goalId);
  assert.deepEqual([created.category, created.priority, created.dueOn, created.dueTime, created.refType, created.refId, created.steps.length], ["sales", "high", TODAY, "16:45", "project", project.id, 3]);
  await shot(page, "meta-detalle-1440-dark");
  check("Mi plan: crear una meta con pasos, vínculo, día y hora; se confirma recién con la respuesta del servidor y el texto se escapa");

  // Los pasos completan y reabren la meta (lo decide el servidor).
  const stepLabel = (index) => page.locator(".goal-checklist li").nth(index).locator("label");
  await stepLabel(0).click();
  await until(() => goalOnServer(context, goalId), (goal) => goal.steps.filter((step) => step.doneAt).length === 1, "el primer paso no quedó guardado");
  await stepLabel(1).click();
  await until(() => goalOnServer(context, goalId), (goal) => goal.steps.filter((step) => step.doneAt).length === 2 && goal.status === "open", "el segundo paso no quedó guardado");
  await stepLabel(2).click();
  await toast(page, "Último paso listo: la meta se completó.");
  assert.equal((await goalOnServer(context, goalId)).status, "done");
  await page.locator(".goal-progress .label", { hasText: "Meta completada" }).waitFor();
  assert.equal(await page.locator('[data-action="goal-step-add"]').count(), 0, "una meta completa no admite pasos nuevos");
  await stepLabel(2).click();
  await toast(page, "la meta volvió a estar abierta");
  const reopened = await goalOnServer(context, goalId);
  assert.deepEqual([reopened.status, reopened.completedAt], ["open", null]);
  check("Mi plan: al terminar el último paso la meta se completa y al reabrir un paso se reabre (decide el servidor)");

  // Agregar un paso, editar y cancelar.
  await page.getByRole("button", { name: /Paso$/ }).click();
  await page.waitForSelector("dialog[open]");
  await page.fill('dialog [name="title"]', "Paso cuatro");
  await page.click('dialog button[type="submit"]');
  await toast(page, "Paso agregado.");
  assert.equal((await goalOnServer(context, goalId)).steps.length, 4);
  await page.getByRole("button", { name: "Editar meta" }).click();
  await page.waitForSelector('[data-form="wizard"]');
  assert.equal(await page.inputValue('[name="title"]'), goalTitle, "la edición arranca con los datos reales");
  await next(page);
  await next(page);
  await next(page);
  await page.locator("#wizard-error", { hasText: "No cambiaste nada" }).waitFor();
  await page.click('[data-action="wizard-prev"]');
  await page.click('[data-action="wizard-prev"]');
  await page.fill('[name="title"]', `${goalTitle} editada`);
  await next(page);
  await next(page);
  await next(page);
  await toast(page, "Meta guardada.");
  assert.equal((await goalOnServer(context, goalId)).title, `${goalTitle} editada`);
  await page.getByRole("button", { name: "Cancelar meta" }).click();
  await page.waitForSelector("dialog[open]");
  assert.equal(await page.locator('dialog [name="confirm"]').getAttribute("required"), "", "cancelar exige confirmar");
  await page.check('dialog [name="confirm"]');
  await page.click('dialog button[type="submit"]');
  await toast(page, "Meta cancelada.");
  assert.equal((await goalOnServer(context, goalId)).status, "cancelled");
  await goto(page, "#metas");
  await page.click('[data-action="filter"][data-id="metas.view"][data-kind="canceladas"]');
  const mine = page.locator(".goal-title", { hasText: `Meta E2E ${stamp}` });
  for (let pageNumber = 0; pageNumber < 10 && (await mine.count()) === 0; pageNumber++) await page.click('[aria-label="Página siguiente"]');
  await mine.waitFor();
  check("Mi plan: agregar un paso, editar (sin cambios se frena) y cancelar con confirmación; la meta cancelada sigue en «Canceladas»");

  // Meta sin pasos para hoy: aparece en Hoy y se completa a mano.
  await page.getByRole("button", { name: /Nueva meta/ }).click();
  await page.waitForSelector('[data-form="wizard"]');
  const simpleTitle = `Meta simple ${stamp}`;
  await page.fill('[name="title"]', simpleTitle);
  await next(page);
  await next(page);
  await next(page);
  await toast(page, "Meta creada.");
  const simpleId = await idOf(page);
  await shot(page, "meta-simple-1440-dark");

  // ---------------------------------------------------------------- Calendario
  await goto(page, "#calendario");
  await page.locator(".calendar-grid").waitFor();
  const planned = [];
  page.on("request", (request) => { const url = request.url(); if (url.includes("/admin/planner/events?")) planned.push(new URL(url).searchParams.get("from") + ".." + new URL(url).searchParams.get("to")); });
  const eventTitle = `Evento E2E ${stamp}`;
  const openEntry = async (title) => { const details = entryOf(title).locator("details"); if (!(await details.evaluate((node) => node.open))) await entryOf(title).locator("summary").click(); };
  const entryOf = (title) => page.locator(".calendar-entry", { has: page.locator("summary", { hasText: title }) });
  const createEvent = async (title, time, duration, { acknowledge = false } = {}) => {
    await page.locator('.pt-head-actions [data-action="new-event"]').click();
    await page.waitForSelector('[data-form="wizard"]');
    await page.fill('[name="title"]', title);
    await page.selectOption('[name="type"]', "meeting");
    await next(page);
    await page.fill('[name="date"]', TODAY);
    await page.fill('[name="time"]', time);
    await page.locator('[name="time"]').dispatchEvent("change");
    await page.fill('[name="duration"]', String(duration));
    return acknowledge;
  };
  await createEvent(eventTitle, "14:00", 60);
  await next(page);
  await page.locator(".generator-summary").waitFor();
  await next(page);
  await page.waitForFunction(() => /^#calendario\/[0-9a-f-]{36}$/.test(location.hash));
  await toast(page, "Evento agendado.");
  const eventId = await idOf(page);
  const first = await eventOnServer(context, eventId);
  assert.deepEqual([first.type, first.onDate, first.startTime, first.durationMinutes, first.status], ["meeting", TODAY, "14:00", 60, "scheduled"]);
  await page.locator(".calendar-entry details[open] summary", { hasText: eventTitle }).waitFor();
  check("Calendario: agendar un evento con hora y duración reales; queda abierto en el día");

  // Un segundo evento que se pisa: aviso en el formulario, el servidor no lo guarda sin confirmar y con la casilla sí.
  const overlapTitle = `Evento que se pisa ${stamp}`;
  await createEvent(overlapTitle, "14:30", 30);
  await page.locator(".generator-warning", { hasText: "Coincide con" }).waitFor();
  await next(page);
  assert.match(await page.locator(".generator-warning").last().textContent(), new RegExp(`coincide con.*${eventTitle}`, "i"), "el resumen avisa del choque calculado sobre lo cargado");
  await next(page);
  await page.locator("#wizard-error", { hasText: "Coincide con" }).waitFor();
  assert.equal(await page.locator('[data-form="wizard"]').count(), 1, "el formulario sigue abierto");
  await page.check('[name="allowOverlap"]');
  await next(page);
  await page.waitForFunction(() => /^#calendario\/[0-9a-f-]{36}$/.test(location.hash) && !location.hash.endsWith("/undefined"));
  await toast(page, "Evento agendado.");
  const overlapId = await idOf(page);
  assert.ok(await eventOnServer(context, overlapId));
  await page.locator(".calendar-entry summary", { hasText: "Coincide con otro evento" }).first().waitFor();
  await entryOf(overlapTitle).locator(".generator-warning", { hasText: "Coincide con" }).waitFor();
  await shot(page, "calendario-choque-1440-dark");
  check("Calendario: aviso de choque de horario en el formulario y en el día; solo se guarda si se confirma");

  // Completar, editar y cancelar (los eventos no se borran).
  await openEntry(eventTitle);
  await entryOf(eventTitle).getByRole("button", { name: "Completar" }).click();
  await toast(page, "Evento completado.");
  assert.equal((await eventOnServer(context, eventId)).status, "done");
  await openEntry(eventTitle);
  await entryOf(eventTitle).getByRole("button", { name: "Editar" }).click();
  await page.waitForSelector('[data-form="wizard"]');
  await page.fill('[name="title"]', `${eventTitle} editado`);
  await next(page);
  await next(page);
  await next(page);
  await toast(page, "Evento guardado.");
  assert.equal((await eventOnServer(context, eventId)).title, `${eventTitle} editado`);
  await openEntry(overlapTitle);
  await entryOf(overlapTitle).getByRole("button", { name: "Cancelar evento" }).click();
  await page.waitForSelector("dialog[open]");
  await page.check('dialog [name="confirm"]');
  await page.click('dialog button[type="submit"]');
  await toast(page, "Evento cancelado.");
  assert.equal((await eventOnServer(context, overlapId)).status, "cancelled");
  await entryOf(overlapTitle).locator("summary", { hasText: "Cancelado" }).waitFor();
  assert.equal(await page.locator(".calendar-cell-events span", { hasText: overlapTitle }).count(), 0, "el cancelado no ocupa la grilla");
  check("Calendario: completar, editar y cancelar eventos con confirmación del servidor (cancelar no borra)");

  // Navegación por meses: cada mes pide su rango recién cuando se llega a él.
  const thisMonth = TODAY.slice(0, 7);
  const [year, month] = thisMonth.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  const nextGrid = monthGrid(nextMonth);
  const currentGrid = monthGrid(thisMonth);
  assert.ok(!planned.includes(`${nextGrid.from}..${nextGrid.to}`), "el mes siguiente no se pide hasta llegar a él");
  assert.ok(planned.includes(`${currentGrid.from}..${currentGrid.to}`), "el mes actual sí");
  const before = planned.length;
  await page.click('[aria-label="Mes siguiente"]');
  await page.waitForFunction((label) => document.querySelector(".calendar-month-control h2")?.textContent.toLowerCase().includes(label), new Date(`${nextMonth}-15T12:00:00`).toLocaleDateString("es-AR", { month: "long" }));
  await until(async () => planned, (list) => list.includes(`${nextGrid.from}..${nextGrid.to}`), "no se pidió el rango del mes siguiente");
  assert.ok(planned.length > before);
  const afterNext = planned.length;
  await page.click('[aria-label="Mes anterior"]');
  await page.locator(".calendar-cell[data-today=\"true\"]").waitFor();
  await page.waitForTimeout(500);
  assert.equal(planned.length, afterNext, "volver a un mes ya cargado no lo vuelve a pedir (caché)");
  await page.fill("#cal-goto", `${nextMonth}-10`);
  await page.click('[data-action="calendar-goto"]');
  await page.locator(".calendar-selected-title", { hasText: "10" }).waitFor();
  await page.click('[data-action="filter"][data-id="calendario.day"][data-kind="' + TODAY + '"]');
  check("Calendario: cada mes pide su rango al llegar a él, la caché evita repetirlo y se puede ir a una fecha");
  await calm();

  // Un evento para más tarde: aparece en Hoy y se completa desde ahí.
  const lateTitle = `Evento de la noche ${stamp}`;
  await createEvent(lateTitle, "23:00", 30);
  await next(page);
  await next(page);
  await toast(page, "Evento agendado.");
  const lateId = await idOf(page);

  // ---------------------------------------------------------------- Hoy
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.loader === "done");
  await goto(page, "#hoy");
  await page.locator(".focus-band").waitFor();
  await page.waitForFunction(() => document.querySelector('section[aria-labelledby="today-title"] .pt-count')?.textContent !== "0");
  assert.ok(await hoyRow(page, simpleTitle), "la meta de hoy está en «Qué toca hoy»");
  assert.ok(await hoyRow(page, lateTitle), "el evento de hoy está en «Qué toca hoy»");
  const leadRow = await hoyRow(page, `Llamar a Planner ${stamp}`);
  assert.ok(leadRow, "la próxima acción del prospecto está en la agenda");
  assert.match(await leadRow.textContent(), new RegExp(`Prospecto Planner ${stamp}`), "la agenda trae solo el id del prospecto: el nombre sale de la lista de prospectos");
  assert.match(await leadRow.textContent(), /Próxima acción/);
  assert.equal(await hoyRow(page, overlapTitle), null, "un evento cancelado no está en la agenda");
  const agendaToday = (await apiGet(context, `/admin/planner/agenda?from=${TODAY}&to=${addDays(TODAY, 7)}&ownerAdminId=${(await apiGet(context, "/auth/admin/me")).body.admin.id}`)).body.items;
  assert.ok(agendaToday.some((item) => item.id === simpleId) && agendaToday.some((item) => item.id === lateId));
  await goto(page, "#hoy");
  await (await hoyRow(page, lateTitle)).getByRole("button", { name: "Completar" }).click();
  await toast(page, "Evento completado.");
  assert.equal((await eventOnServer(context, lateId)).status, "done");
  assert.equal(await hoyRow(page, lateTitle), null);
  check("Hoy: la agenda real muestra metas, eventos y próximas acciones de prospectos, y un evento se completa desde ahí");

  // Los cinco números, con definiciones del servidor y desglose.
  await page.locator("#numbers-title").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".pt-overview[data-grid] > div").length === 5);
  const week = { from: addDays(TODAY, -6), to: TODAY };
  const indicators = (await apiGet(context, `/admin/reports/indicators?from=${week.from}&to=${week.to}`)).body;
  const cells = await page.locator(".pt-overview[data-grid] > div").allTextContents();
  assert.match(cells[0], new RegExp(`Contactos nuevos\\s*${indicators.indicators.newContacts.value}`));
  assert.ok(indicators.indicators.newContacts.value >= 1, "el prospecto de la prueba cuenta como contacto nuevo");
  assert.match(cells[1], new RegExp(`Abiertas ahora: ${indicators.indicators.conversationsOpened.openNow}`));
  assert.match(cells[4], /\d+(\.\d)?%/, "con un contacto tibio hay porcentaje");
  const definitions = await page.locator(".live-defs").first().textContent();
  for (const item of Object.values(indicators.indicators)) {
    if (item.definition) assert.ok(definitions.includes(item.definition), `falta la definición «${item.definition.slice(0, 40)}…»`);
    if (item.source) assert.ok(definitions.includes(item.source), `falta la fuente ${item.source}`);
  }
  assert.match(await page.locator(".live-pipeline").textContent(), /Cobrado en el período[\s\S]*Prometido[\s\S]*Propuesto abierto/);
  assert.equal(await page.locator("text=/meta del bimestre|MRR/i").count(), 0, "no hay metas por bimestre ni MRR en live");
  await shot(page, "hoy-1440-dark");
  // Desglose: contactos nuevos
  await page.click('a[href="#hoy/new_contacts"]');
  await page.locator("h1.pt-title", { hasText: "Contactos nuevos" }).waitFor();
  await page.locator(".pt-row", { hasText: `Prospecto Planner ${stamp}` }).waitFor();
  const items = (await apiGet(context, `/admin/reports/indicators/new_contacts/items?from=${week.from}&to=${week.to}&limit=20`)).body;
  assert.equal(await page.locator(".pt-rows .pt-row").count(), items.items.length, "las filas coinciden con las del servidor");
  assert.match(await page.locator(".pt-row", { hasText: `Prospecto Planner ${stamp}` }).textContent(), /Referido/);
  assert.match(await page.locator(".pt-company").textContent(), /Leads con primer contacto/);
  await shot(page, "indicadores-contactos-1440-dark");
  await page.click('[data-action="filter"][data-id="hoy.period"][data-kind="30"]');
  await page.waitForFunction((from) => document.body.textContent.includes(from.split("-").reverse()[0]), addDays(TODAY, -29));
  // Desglose: dinero cobrado
  await goto(page, "#hoy/collected");
  await page.locator("h1.pt-title", { hasText: "USD cobrado" }).waitFor();
  const collected = (await apiGet(context, `/admin/reports/indicators/collected/items?from=${addDays(TODAY, -29)}&to=${TODAY}&limit=20`)).body;
  await page.waitForFunction((count) => document.querySelectorAll(".pt-rows .pt-row").length === count, collected.items.length);
  assert.match(await page.locator(".pt-rows").textContent(), /Hora no registrada/);
  await noOverflow(page, "desglose 1440");
  await shot(page, "indicadores-cobrado-1440-dark");
  await goto(page, "#hoy");
  check("Hoy: los cinco números con definición, fuente y período del servidor, y el desglose de las filas que los componen");
  await calm();

  // ---------------------------------------------------------------- Herramientas
  await goto(page, "#herramientas");
  await page.fill("#m-gap", "3000");
  await page.fill("#m-ticket", "1000");
  await page.fill("#m-conversion", "25");
  await page.locator(".tool-result", { hasText: "12" }).waitFor();
  assert.match(await page.locator(".tool-result").first().textContent(), /3\s*ventas\s*12\s*propuestas/);
  await page.click('[data-action="new-goal"][data-template="ventas"]');
  await page.waitForSelector('[data-form="wizard"]');
  assert.equal(await page.inputValue('[name="title"]'), "Definir mi plan para 12 propuestas");
  assert.match(await page.inputValue('[name="notes"]'), /3 ventas y 12 propuestas/);
  await next(page);
  await next(page);
  await next(page);
  await toast(page, "Meta creada con 3 pasos.");
  const toolGoalId = await idOf(page);
  const toolGoal = await goalOnServer(context, toolGoalId);
  assert.deepEqual([toolGoal.title, toolGoal.category, toolGoal.steps.length], ["Definir mi plan para 12 propuestas", "sales", 3]);
  await goto(page, "#herramientas");
  await page.fill("#m-hours", "20");
  await page.click('[data-action="new-event"][data-template="foco"]');
  await page.waitForSelector('[data-form="wizard"]');
  assert.equal(await page.inputValue('[name="type"]'), "focus");
  await next(page);
  assert.equal(await page.inputValue('[name="duration"]'), "50", "20 h → 4 h de prospección por semana → 50 min por día hábil");
  await page.fill('[name="time"]', "07:00");
  await next(page);
  await next(page);
  await toast(page, "Evento agendado.");
  const focusId = await idOf(page);
  const focus = await eventOnServer(context, focusId);
  assert.deepEqual([focus.type, focus.durationMinutes, focus.startTime], ["focus", 50, "07:00"]);
  await goto(page, "#herramientas");
  await noOverflow(page, "herramientas 1440");
  await shot(page, "herramientas-1440-dark");
  check("Herramientas: las calculadoras siguen siendo de cuenta local y «llevar al plan / al calendario» crea una meta y un evento reales");

  // ---------------------------------------------------------------- Bitácora
  await goto(page, "#actividad");
  await page.locator(".audit-list li").first().waitFor();
  assert.match(await page.locator(".audit-scope").textContent(), /La API no tiene una bitácora global/);
  assert.match(await page.locator(".audit-scope").textContent(), /Qué no incluye/);
  const audit = (await apiGet(context, `/admin/projects/${projects[0].id}/audit?limit=5`)).body.events[0];
  const instants = await page.locator(".audit-list time").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime")));
  assert.ok(instants.includes(audit.occurredAt), "se muestra el instante UTC exacto que registró el servidor");
  assert.match(await page.locator(".audit-list li").first().textContent(), /UTC/);
  assert.match(await page.locator(".audit-list").textContent(), /Vos/, "el actor propio se reconoce; los demás salen por cuenta");
  await noOverflow(page, "bitácora 1440");
  await shot(page, "bitacora-1440-dark");
  check("Bitácora: junta la auditoría de proyectos y prospectos recientes, con el instante UTC del servidor, el actor y el alcance dicho en pantalla");

  // Sin instante: «Hora no registrada». Se simula una respuesta sin occurredAt.
  const stub = await newPage(context);
  await stub.route(`${API}/api/v1/admin/projects/*/audit?**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [{ id: "99999999-9999-4999-8999-999999999999", occurredAt: null, actorKind: "system", actorId: null, action: "project.updated", resourceType: "project", resourceId: project.id, result: "success", before: null, after: null }], nextCursor: null }) }));
  await stub.goto(`${PORTAL}/#actividad`);
  await stub.locator(".audit-list li").first().waitFor();
  assert.match(await stub.locator(".audit-list").first().textContent(), /Hora no registrada/);
  assert.match(await stub.locator(".audit-list").first().textContent(), /Sistema/);
  await stub.close();
  check("Bitácora: sin instante en el registro se muestra «Hora no registrada» (nunca se inventa)");
  await calm();

  // ---------------------------------------------------------------- Errores y permisos
  const forbidden = await newPage(context);
  await forbidden.route(`${API}/api/v1/admin/planner/goals`, (route) => route.request().method() === "GET" ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Forbidden" }, requestId: "44444444-4444-4444-8444-444444444444" }) }) : route.continue());
  await forbidden.goto(`${PORTAL}/#metas`);
  await forbidden.locator(".live-error").waitFor();
  assert.match(await forbidden.locator(".live-error").textContent(), /no tiene permiso/);
  assert.equal(await forbidden.getByRole("button", { name: "Reintentar" }).count(), 1);
  await forbidden.unroute(`${API}/api/v1/admin/planner/goals`);
  await forbidden.getByRole("button", { name: "Reintentar" }).click();
  await forbidden.locator(".goal-card").first().waitFor();
  // Una escritura que se corta: no se sabe si quedó guardada, y no se reintenta sola.
  await forbidden.route(`${API}/api/v1/admin/planner/goals`, (route) => route.request().method() === "POST" ? route.abort("failed") : route.continue());
  await forbidden.getByRole("button", { name: /Nueva meta/ }).click();
  await forbidden.waitForSelector('[data-form="wizard"]');
  await forbidden.fill('[name="title"]', `Meta cortada ${stamp}`);
  await forbidden.click('[data-form="wizard"] button[type="submit"]');
  await forbidden.click('[data-form="wizard"] button[type="submit"]');
  await forbidden.click('[data-form="wizard"] button[type="submit"]');
  await forbidden.locator("#wizard-error", { hasText: "no pudimos confirmar si la meta se guardó" }).waitFor();
  assert.equal(await forbidden.locator('[data-form="wizard"]').count(), 1, "el formulario queda abierto");
  await forbidden.close();
  check("errores: un 403 se explica con «Reintentar» y un corte durante un alta avisa que el resultado es incierto");

  await calm();
  const limited = await newPage(context);
  await limited.route(`${API}/api/v1/auth/admin/me`, async (route) => {
    const response = await route.fetch({ headers: { ...route.request().headers(), origin: PORTAL } });
    const body = await response.json();
    if (!response.ok() || !body.admin) return route.fulfill({ response });
    body.admin.permissions = body.admin.permissions.filter((permission) => !["planner:write", "reports:read", "billing:read", "leads:read"].includes(permission));
    await route.fulfill({ response, json: body });
  });
  const writes = [];
  limited.on("request", (req) => { if (req.method() !== "GET" && req.url().includes("/api/v1/admin/")) writes.push(req.url()); });
  await limited.goto(`${PORTAL}/#hoy`);
  await limited.locator("#numbers-title").waitFor();
  assert.match(await limited.locator("section[aria-labelledby=\"numbers-title\"]").textContent(), /reports:read/);
  assert.equal(await limited.locator(".hdr-plan").count(), 0, "sin planner:write no hay «Planificar»");
  assert.equal(await limited.getByRole("button", { name: /Planificar mi día/ }).count(), 0);
  await goto(limited, "#metas");
  await limited.locator(".goal-card").first().waitFor();
  assert.equal(await limited.getByRole("button", { name: /Nueva meta/ }).count(), 0);
  assert.match(await limited.locator(".pt-head-actions").textContent(), /planner:write/);
  await limited.locator(".goal-card a.goal-title").first().click();
  await limited.locator(".goal-checklist, .pt-fine").first().waitFor();
  assert.equal(await limited.locator('input[data-action="goal-step"]:not([disabled])').count(), 0, "los pasos quedan solo de lectura");
  assert.equal(await limited.getByRole("button", { name: "Cancelar meta" }).count(), 0);
  await goto(limited, "#calendario");
  await limited.locator(".calendar-grid").waitFor();
  assert.equal(await limited.getByRole("button", { name: "Agendar" }).count(), 0);
  assert.match(await limited.locator(".calendar-board .live-note").textContent(), /leads:read/);
  await goto(limited, "#hoy/collected");
  await limited.locator(".live-forbidden").first().waitFor();
  await goto(limited, "#herramientas");
  assert.match(await limited.locator(".tool-card").first().textContent(), /planner:write/);
  assert.equal(await limited.locator('[data-action="new-goal"]').count(), 0);
  assert.equal(writes.length, 0, "sin permiso no se envía ninguna escritura");
  await limited.close();
  check("permisos: sin planner:write, reports:read o leads:read se oculta o se explica lo que falta, sin escrituras");

  // ---------------------------------------------------------------- Capturas
  await calm();
  const matrix = [[1440, "dark"], [1440, "light"], [375, "dark"], [375, "light"]];
  const screens = [["#hoy", "hoy"], ["#metas", "metas"], [`#metas/${goalId}`, "meta-detalle"], ["#calendario", "calendario"], ["#hoy/new_contacts", "indicadores"], ["#herramientas", "herramientas"], ["#actividad", "bitacora"]];
  for (const [width, theme] of matrix) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; localStorage.setItem("eclipse-theme", value); }, theme);
    for (const [hash, name] of screens) {
      await calm(60);
      await goto(page, hash);
      await page.waitForTimeout(1100);
      await noOverflow(page, `${name} ${width} ${theme}`);
      await shot(page, `${name}-${width}-${theme}`);
    }
    // Formularios
    await goto(page, "#metas");
    await page.getByRole("button", { name: /Nueva meta/ }).click();
    await page.waitForSelector('[data-form="wizard"]');
    await noOverflow(page, `form meta ${width} ${theme}`);
    await shot(page, `form-meta-${width}-${theme}`);
    await page.click('[data-action="wizard-cancel"]');
    await goto(page, "#calendario");
    await page.locator('.pt-head-actions [data-action="new-event"]').click();
    await page.waitForSelector('[data-form="wizard"]');
    await noOverflow(page, `form evento ${width} ${theme}`);
    await page.click('[data-action="wizard-cancel"]');
  }
  check("capturas en 375 y 1440 px, tema oscuro y claro, de todas las pantallas del planificador, sin desbordes horizontales");

  await cancelLeftovers(context);
  await cancelGoalLeftovers(context);
  assert.deepEqual(errorsSeen, [], `errores en consola:\n${errorsSeen.join("\n")}`);
  console.log(`\n${checks} recorridos del planificador contra el servidor real. Capturas en test-results/live-planner/. Sin errores de JavaScript.`);
  await context.close();
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
