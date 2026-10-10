#!/usr/bin/env node
// Genera public-config.json a partir de una LISTA PERMITIDA de variables PUBLIC_*.
// El portal es HTML + JS sin build: este script es el único paso previo al deploy y solo escribe un JSON
// que el navegador lee. Nunca copia otras variables del entorno ni lee archivos .env por su cuenta.
//
//   PUBLIC_PORTAL_MODE=live PUBLIC_API_BASE_URL=https://api.eclipse-business.com/api/v1 \
//     node scripts/build-public-config.mjs [--out public-config.json] [--check]
//
// --check valida y muestra el resultado sin escribir. Sale con código 1 si algo es inválido.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_VARIABLES, validatePublicEnv } from "../src/config-schema.js";

/** Solo las cuatro variables permitidas pasan; el resto del entorno ni se mira. */
export function pickPublicEnv(env) {
  return Object.fromEntries(PUBLIC_VARIABLES.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
}

/** Devuelve `{ config, json, errors, warnings }` sin tocar el disco. */
export function buildPublicConfig(env) {
  const allowed = pickPublicEnv(env);
  // Las PUBLIC_ desconocidas solo generan aviso: se pasan al validador para reportarlas, nunca se escriben.
  const withUnknown = { ...allowed, ...Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("PUBLIC_") && !PUBLIC_VARIABLES.includes(key))) };
  const { config, errors, warnings } = validatePublicEnv(withUnknown);
  return { config, errors, warnings, json: config ? `${JSON.stringify(config, null, 2)}\n` : "" };
}

function main(argv, env) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outIndex = argv.indexOf("--out");
  const out = resolve(root, outIndex >= 0 ? argv[outIndex + 1] : "public-config.json");
  const { config, json, errors, warnings } = buildPublicConfig(env);
  for (const warning of warnings) console.warn(`Aviso: ${warning}`);
  if (!config) {
    for (const error of errors) console.error(`Error: ${error}`);
    return 1;
  }
  if (argv.includes("--check")) {
    console.log(`Configuración válida (modo ${config.mode}).`);
    return 0;
  }
  writeFileSync(out, json);
  console.log(`Escrito ${out} (modo ${config.mode}).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2), process.env);
