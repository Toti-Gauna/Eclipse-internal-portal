// Exercise the packaged live login with a local API double; no production login.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve("_site");
const origin = "https://interno.eclipse-business.com";
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json" };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox"] });
try {
  for (const width of [375, 1024]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "es-AR", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    const missing = [];
    const logins = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const url = new URL(route.request().url());
      const path = resolve(root, `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
      if (!path.startsWith(`${root}/`)) return route.fulfill({ status: 403, body: "" });
      try {
        await route.fulfill({ status: 200, contentType: mime[extname(path)] || "application/octet-stream", body: await readFile(path) });
      } catch {
        missing.push(url.pathname);
        await route.fulfill({ status: 404, body: "" });
      }
    });
    await page.route("https://api.eclipse-business.com/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.includes("/login")) logins.push(path);
      const headers = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type,x-csrf-token", "access-control-allow-methods": "GET,POST,OPTIONS" };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (path.endsWith("/auth/csrf")) return route.fulfill({ status: 200, headers, json: { csrfToken: "local-browser-test" } });
      return route.fulfill({ status: 401, headers, json: { error: { code: "UNAUTHORIZED", message: "Unauthorized" } } });
    });
    await page.goto(origin);
    await page.locator('[data-form="live-login"]').waitFor();
    assert.equal(await page.locator('#auth-password').count(), 1);
    assert.equal(await page.locator('[data-action="open-data"]').count(), 0, "No demo data tools before login");
    assert.equal(await page.locator('[data-form="live-mfa"]').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("eclipse-ops-v2")), null, "No demo dataset in live mode");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "No horizontal overflow");
    await page.reload();
    await page.locator('[data-form="live-login"]').waitFor();
    assert.deepEqual(missing, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(logins, []);
    console.log(`PASS packaged live gate and reload at ${width}px; no login submitted`);
    await context.close();
  }
} finally {
  await browser.close();
}
