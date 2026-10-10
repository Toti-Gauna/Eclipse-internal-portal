import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicConfig } from "../scripts/build-public-config.mjs";
import { isLikelySameSite, validatePublicConfig, validatePublicEnv } from "../src/config-schema.js";
import { loadConfig } from "../src/config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const live = { PUBLIC_PORTAL_MODE: "live", PUBLIC_API_BASE_URL: "https://api.eclipse-business.com/api/v1", PUBLIC_CLIENT_PORTAL_URL: "https://www.eclipse-business.com/es/portal", PUBLIC_WHATSAPP_MODE: "manual" };

test("solo las cuatro variables PUBLIC_ permitidas llegan al archivo; nada más del entorno", () => {
  const { config, json, warnings } = buildPublicConfig({ ...live, DATABASE_URL: "postgres://secreto", ADMIN_JWT_SECRET: "x", PUBLIC_EXTRA: "algo", HOME: "/root" });
  assert.deepEqual(Object.keys(config).sort(), ["apiBaseUrl", "clientPortalUrl", "mode", "whatsappMode"]);
  assert.ok(!/secreto|ADMIN_JWT|algo|root/.test(json));
  assert.deepEqual(warnings, ["PUBLIC_EXTRA: variable PUBLIC_ desconocida, se ignora."]);
  assert.equal(config.apiBaseUrl, live.PUBLIC_API_BASE_URL);
});

test("sin variables el resultado es demo, sin URL de API", () => {
  const { config } = buildPublicConfig({});
  assert.deepEqual(config, { mode: "demo", apiBaseUrl: "", clientPortalUrl: "", whatsappMode: "manual" });
  assert.equal(buildPublicConfig({ PUBLIC_PORTAL_MODE: "demo", PUBLIC_API_BASE_URL: "https://api.x.com/api/v1" }).config.apiBaseUrl, "", "demo nunca publica una API");
});

test("validaciones: modo, https salvo localhost, sin barra final, URL obligatoria en live", () => {
  const errorsOf = (env) => validatePublicEnv(env).errors.join(" | ");
  assert.match(errorsOf({ PUBLIC_PORTAL_MODE: "api" }), /no es válido/);
  assert.match(errorsOf({ PUBLIC_PORTAL_MODE: "live" }), /obligatoria en modo live/);
  assert.match(errorsOf({ ...live, PUBLIC_API_BASE_URL: "http://api.eclipse-business.com/api/v1" }), /exige https/);
  assert.match(errorsOf({ ...live, PUBLIC_API_BASE_URL: "https://api.eclipse-business.com/api/v1/" }), /no debe terminar en/);
  assert.match(errorsOf({ ...live, PUBLIC_API_BASE_URL: "no es url" }), /no es una URL válida/);
  assert.match(errorsOf({ ...live, PUBLIC_API_BASE_URL: "https://user:pw@api.x.com/api/v1" }), /usuario ni contraseña/);
  assert.match(errorsOf({ ...live, PUBLIC_API_BASE_URL: "https://api.x.com/api/v1?x=1" }), /parámetros/);
  assert.match(errorsOf({ ...live, PUBLIC_API_BASE_URL: "ftp://api.x.com/api/v1" }), /https/);
  assert.match(errorsOf({ ...live, PUBLIC_WHATSAPP_MODE: "auto" }), /PUBLIC_WHATSAPP_MODE/);
  assert.equal(errorsOf({ ...live, PUBLIC_API_BASE_URL: "http://localhost:3100/api/v1" }), "", "http en localhost es válido");
  assert.equal(errorsOf({ ...live, PUBLIC_API_BASE_URL: "http://127.0.0.1:3100/api/v1" }), "");
});

test("el script escribe public-config.json y sale con 1 si algo es inválido", () => {
  const dir = mkdtempSync(join(tmpdir(), "eclipse-config-"));
  try {
    const out = join(dir, "public-config.json");
    const env = { PATH: process.env.PATH, ...live, SECRET_DB: "no-copiar" };
    const run = (extra, e = env) => spawnSync(process.execPath, [join(root, "scripts/build-public-config.mjs"), ...extra], { env: e, encoding: "utf8" });
    const good = run(["--out", out]);
    assert.equal(good.status, 0, good.stderr);
    const written = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(written.mode, "live");
    assert.ok(!readFileSync(out, "utf8").includes("no-copiar"));
    const bad = run(["--out", join(dir, "otro.json")], { PATH: process.env.PATH, PUBLIC_PORTAL_MODE: "live" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /obligatoria en modo live/);
    assert.equal(existsSync(join(dir, "otro.json")), false, "no escribe nada si es inválido");
    const check = run(["--check", "--out", join(dir, "nope.json")]);
    assert.equal(check.status, 0);
    assert.equal(existsSync(join(dir, "nope.json")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("el ejemplo versionado es una configuración válida", () => {
  const example = JSON.parse(readFileSync(join(root, "public-config.example.json"), "utf8"));
  assert.deepEqual(validatePublicConfig(example).errors, []);
});

const jsonResponse = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test("sin public-config.json (404 o sin red) el portal arranca en demo", async () => {
  assert.equal((await loadConfig({ fetchImpl: async () => new Response("", { status: 404 }) })).mode, "demo");
  assert.equal((await loadConfig({ fetchImpl: async () => { throw new TypeError("offline"); } })).mode, "demo");
});

test("un public-config.json válido activa live y marca si API y página son del mismo sitio", async () => {
  const config = await loadConfig({ fetchImpl: jsonResponse({ mode: "live", apiBaseUrl: "https://api.eclipse-business.com/api/v1", clientPortalUrl: "", whatsappMode: "manual" }), location: { hostname: "interno.eclipse-business.com" } });
  assert.equal(config.mode, "live");
  assert.equal(config.sameSite, true);
  const cross = await loadConfig({ fetchImpl: jsonResponse({ mode: "live", apiBaseUrl: "https://eclipse.onrender.com/api/v1" }), location: { hostname: "toti-gauna.github.io" } });
  assert.equal(cross.sameSite, false);
});

test("un archivo presente pero inválido NO cae a demo: queda marcado como inválido", async () => {
  const broken = await loadConfig({ fetchImpl: async () => new Response("{no json", { status: 200 }) });
  assert.equal(broken.mode, "invalid");
  const wrong = await loadConfig({ fetchImpl: jsonResponse({ mode: "live", apiBaseUrl: "http://api.example.com/api/v1" }) });
  assert.equal(wrong.mode, "invalid");
  assert.match(wrong.errors[0], /https/);
});

test("heurística de mismo sitio para cookies SameSite=Lax", () => {
  assert.equal(isLikelySameSite("https://api.eclipse-business.com/api/v1", "interno.eclipse-business.com"), true);
  assert.equal(isLikelySameSite("https://api.eclipse-business.com/api/v1", "toti-gauna.github.io"), false);
  assert.equal(isLikelySameSite("http://localhost:3100/api/v1", "localhost"), true);
  assert.equal(isLikelySameSite("http://127.0.0.1:3100/api/v1", "localhost"), false, "localhost y 127.0.0.1 son sitios distintos");
});
