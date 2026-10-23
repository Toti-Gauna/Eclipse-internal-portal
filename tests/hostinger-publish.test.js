import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

const script = resolve("scripts/hostinger-publish.sh");
const release = `123-1-${"a".repeat(40)}`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "eclipse-internal-deploy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const domain = join(root, "domains/interno.eclipse-business.com");
  const target = join(domain, "public_html");
  const base = join(domain, ".eclipse-deploy");
  const stage = join(base, "staging", release);
  const put = (name, value) => { mkdirSync(dirname(name), { recursive: true }); writeFileSync(name, value); };
  put(join(target, "default.php"), "original welcome");
  chmodSync(join(target, "default.php"), 0o644);
  put(join(target, ".well-known/keep.txt"), "unrelated");
  for (const name of ["index.html", "public-config.json", "deploy-info.json", "src/app.js", "assets/font.woff2", "styles.css", "live.css", "live-comms.css", "live-crm.css", "planner.css"]) put(join(stage, name), "new public file");
  put(join(stage, ".htaccess"), readFileSync("deploy/hostinger.htaccess", "utf8"));
  const run = (action = "publish", env = process.env, destination = target) => spawnSync("bash", [script, action, destination, release], { encoding: "utf8", env });
  return { root, target, base, stage, put, run };
}

test("Internal publication preserves unrelated files, public modes, and private backups; rollback restores the welcome", (t) => {
  const f = fixture(t);
  f.put(join(f.target, "src/app.js"), "previous module");
  chmodSync(join(f.target, "src/app.js"), 0o600);
  chmodSync(join(f.target, "src"), 0o700);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  for (const name of ["index.html", "src/app.js", "public-config.json", ".htaccess"]) assert.equal(statSync(join(f.target, name)).mode & 0o777, 0o644);
  for (const name of ["src", "assets"]) assert.equal(statSync(join(f.target, name)).mode & 0o777, 0o755);
  assert.equal(statSync(join(f.base, "backups")).mode & 0o777, 0o700);
  assert.equal(statSync(join(f.base, "backups", `${release}.tar.gz`)).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(f.target, ".well-known/keep.txt"), "utf8"), "unrelated");
  assert.equal(f.run("rollback").status, 0);
  assert.equal(existsSync(join(f.target, "index.html")), false);
  assert.equal(readFileSync(join(f.target, "src/app.js"), "utf8"), "previous module");
  assert.equal(statSync(join(f.target, "src/app.js")).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(f.target, "default.php"), "utf8"), "original welcome");
  assert.equal(statSync(join(f.target, "default.php")).mode & 0o777, 0o644);
});

test("Internal publisher refuses the public website directory", (t) => {
  const f = fixture(t);
  const website = join(f.root, "domains/eclipse-business.com/public_html");
  f.put(join(website, "index.html"), "public site");
  assert.notEqual(f.run("publish", process.env, website).status, 0);
  assert.equal(readFileSync(join(website, "index.html"), "utf8"), "public site");
});

test("Internal publisher stops for existing rules or an active deployment", (t) => {
  const f = fixture(t);
  f.put(join(f.target, ".htaccess"), "unreviewed rules");
  assert.notEqual(f.run().status, 0);
  assert.equal(readFileSync(join(f.target, ".htaccess"), "utf8"), "unreviewed rules");
  rmSync(join(f.target, ".htaccess"));
  mkdirSync(join(f.base, "lock"));
  assert.notEqual(f.run().status, 0);
  assert.equal(existsSync(join(f.target, "index.html")), false);
  assert.equal(existsSync(join(f.base, "lock")), true);
});

test("Internal copy failure restores the backup and removes introduced assets", (t) => {
  const f = fixture(t);
  const bin = join(f.root, "bin");
  f.put(join(bin, "cp"), '#!/usr/bin/env bash\n/bin/cp "$@"\nexit 1\n');
  chmodSync(join(bin, "cp"), 0o755);
  const result = f.run("publish", { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  assert.notEqual(result.status, 0);
  assert.ok(result.stdout.includes("Restored backup"));
  assert.equal(existsSync(join(f.target, "src/app.js")), false);
  assert.equal(existsSync(join(f.target, "assets/font.woff2")), false);
  assert.equal(readFileSync(join(f.target, "default.php"), "utf8"), "original welcome");
  assert.equal(existsSync(join(f.base, "lock")), false);
});
