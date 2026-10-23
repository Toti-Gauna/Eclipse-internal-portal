import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareHostinger } from "../scripts/prepare-hostinger.mjs";

const env = {
  PUBLIC_PORTAL_MODE: "live", PUBLIC_API_BASE_URL: "https://api.eclipse-business.com/api/v1",
  PUBLIC_CLIENT_PORTAL_URL: "https://eclipse-business.com/portal/", PUBLIC_WHATSAPP_MODE: "manual",
  DATABASE_URL: "DO_NOT_PUBLISH", ADMIN_JWT_SECRET: "DO_NOT_PUBLISH", PUBLIC_UNKNOWN: "DO_NOT_PUBLISH",
};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "eclipse-internal-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, content) => { mkdirSync(join(root, name, ".."), { recursive: true }); writeFileSync(join(root, name), content); };
  put("index.html", '<link href="./styles.css"><script type="module" src="./src/app.js"></script>');
  for (const file of ["styles.css", "live-comms.css", "live-crm.css", "planner.css"]) put(file, "body{}");
  put("src/app.js", 'import { config } from "./config.js"; import("./next.js"); new URL("../live-comms.css", import.meta.url);');
  put("src/config.js", 'export const config = "public-config.json";');
  put("src/next.js", "export const next = true;");
  put("assets/fonts/font.woff2", "font");
  put("deploy/hostinger.htaccess", "DirectoryIndex index.html\n");
  for (const file of [".env", "docs/private.md", "tests/private.js", "node_modules/private.js"]) put(file, "DO_NOT_PUBLISH");
  return { root, put };
}

test("Hostinger artifact includes only public files and stamps modules and dynamic styles", (t) => {
  const { root } = fixture(t);
  const out = prepareHostinger({ root, env, version: "abc123" });
  for (const file of ["index.html", ".htaccess", "public-config.json", "deploy-info.json", "src/config.js", "assets/fonts/font.woff2", "live-comms.css", "live-crm.css", "planner.css"]) {
    assert.ok(existsSync(join(out, file)), file);
  }
  for (const file of [".env", "docs", "tests", "node_modules", "package.json"]) assert.equal(existsSync(join(out, file)), false, file);
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.ok(html.includes("app.js?v=abc123"));
  const app = readFileSync(join(out, "src/app.js"), "utf8");
  assert.ok(app.includes('"./config.js?v=abc123"'));
  assert.ok(app.includes('"./next.js?v=abc123"'));
  assert.ok(app.includes('"../live-comms.css?v=abc123"'));
  assert.deepEqual(JSON.parse(readFileSync(join(out, "public-config.json"), "utf8")), {
    mode: "live", apiBaseUrl: env.PUBLIC_API_BASE_URL, clientPortalUrl: env.PUBLIC_CLIENT_PORTAL_URL, whatsappMode: "manual",
  });
  assert.equal(readFileSync(join(out, "public-config.json"), "utf8").includes("DO_NOT_PUBLISH"), false);
});

test("Hostinger packaging rejects demo or invalid config before replacing the prior artifact", (t) => {
  const { root } = fixture(t);
  const out = prepareHostinger({ root, env, version: "abc123" });
  const before = readFileSync(join(out, "public-config.json"), "utf8");
  for (const invalid of [{ ...env, PUBLIC_PORTAL_MODE: "demo" }, { ...env, PUBLIC_API_BASE_URL: "invalid" }]) {
    assert.throws(() => prepareHostinger({ root, env: invalid, version: "abc123" }));
    assert.equal(readFileSync(join(out, "public-config.json"), "utf8"), before);
  }
  assert.throws(() => prepareHostinger({ root, env, version: "../escape" }));
});

test("Repackaging removes stale files from the generated output only", (t) => {
  const { root, put } = fixture(t);
  put("_site/stale.txt", "stale");
  const out = prepareHostinger({ root, env, version: "current" });
  assert.equal(readdirSync(out).includes("stale.txt"), false);
  assert.equal(readFileSync(join(root, "docs/private.md"), "utf8"), "DO_NOT_PUBLISH");
});
