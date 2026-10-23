#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicConfig } from "./build-public-config.mjs";

/** Prepare only public assets; credentials, docs, tests and dependencies stay out. */
export function prepareHostinger({ root, env, version }) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(version || "")) throw new Error("Invalid deployment version.");
  const built = buildPublicConfig(env);
  if (built.errors.length || built.config?.mode !== "live") throw new Error("A valid live public configuration is required.");
  const out = join(resolve(root), "_site");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, "index.html"), join(out, "index.html"));
  for (const name of readdirSync(root)) {
    if (/^[a-zA-Z0-9-]+\.css$/.test(name)) cpSync(join(root, name), join(out, name));
  }
  for (const name of ["src", "assets"]) cpSync(join(root, name), join(out, name), { recursive: true });
  cpSync(join(root, "deploy/hostinger.htaccess"), join(out, ".htaccess"));
  // Stamp relative JS/CSS references, including dynamic imports and new URL(...).
  const stamp = (text) => text.replace(/(["'])(\.\.?\/[^"'?#\s]+\.(?:js|css))\1/g,
    (_, quote, url) => `${quote}${url}?v=${version}${quote}`);
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = join(directory, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (entry.name.endsWith(".js") || entry.name === "index.html") {
        writeFileSync(name, stamp(readFileSync(name, "utf8")));
      }
    }
  };
  walk(out);
  writeFileSync(join(out, "public-config.json"), built.json);
  writeFileSync(join(out, "deploy-info.json"), `${JSON.stringify({ commit: version, mode: "live" })}\n`);
  return out;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const out = prepareHostinger({ root, env: process.env, version: process.env.GITHUB_SHA || "local" });
    console.log(`Prepared live Hostinger site: ${out}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
