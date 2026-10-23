#!/usr/bin/env node
// Public, read-only checks. Never submit administrator credentials.
import assert from "node:assert/strict";

const origin = "https://interno.eclipse-business.com";
const api = "https://api.eclipse-business.com";
const version = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(version || "")) throw new Error("Missing expected deployment commit.");

async function get(path) {
  const response = await fetch(`${origin}${path}${path.includes("?") ? "&" : "?"}release=${version}`, {
    signal: AbortSignal.timeout(20000), cache: "no-store", redirect: "error",
  });
  assert.equal(response.status, 200, `Internal portal returned HTTP ${response.status} for ${path.split("?")[0]}`);
  return response;
}

try {
  const config = await (await get("/public-config.json")).json();
  assert.equal(config.mode, "live", "Portal is not configured for live data.");
  assert.equal(config.apiBaseUrl, `${api}/api/v1`, "Unexpected API URL.");
  assert.equal(config.clientPortalUrl, "https://eclipse-business.com/portal/", "Unexpected client portal URL.");
  assert.equal(config.whatsappMode, "manual", "Unexpected WhatsApp mode.");
  assert.deepEqual(Object.keys(config).sort(), ["mode", "apiBaseUrl", "clientPortalUrl", "whatsappMode"].sort());
  const info = await (await get("/deploy-info.json")).json();
  assert.equal(info.commit, version, "Hostinger is serving a different deployment.");
  const html = await (await get("/")).text();
  assert.ok(html.includes("Operación interna"), "Unexpected index page.");
  assert.ok(html.includes(`app.js?v=${version}`), "The index is not using the current modules.");
  for (const file of ["src/app.js", "styles.css", "live.css", "live-crm.css", "live-comms.css", "planner.css"]) {
    await get(`/${file}?v=${version}`);
  }
  const health = await fetch(`${api}/health`, { signal: AbortSignal.timeout(20000) });
  assert.equal(health.status, 200, "API health failed.");
  assert.equal((await health.json()).status, "ok");
  const protectedRoute = await fetch(`${api}/api/v1/auth/admin/me`, {
    headers: { Origin: origin }, signal: AbortSignal.timeout(20000),
  });
  assert.equal(protectedRoute.status, 401, "Admin data must require authentication.");
  assert.equal(protectedRoute.headers.get("access-control-allow-origin"), origin, "Admin CORS origin is not allowed.");
  assert.equal(protectedRoute.headers.get("access-control-allow-credentials"), "true", "Credentialed CORS is not enabled.");
  console.log("Internal live configuration, deployment version, assets, API health, and protected admin CORS: OK.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
