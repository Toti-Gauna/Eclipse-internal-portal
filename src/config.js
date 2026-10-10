import { DEMO_CONFIG, isLikelySameSite, validatePublicConfig } from "./config-schema.js";

/**
 * Lee ./public-config.json (generado por scripts/build-public-config.mjs).
 * - Sin archivo (404, red, hosting estático sin generar): modo demo.
 * - Archivo presente pero inválido: modo "invalid" con el motivo. Nunca se cae a demo en silencio,
 *   porque quien configuró live espera datos reales.
 */
export async function loadConfig({ fetchImpl = globalThis.fetch, url = "./public-config.json", location = globalThis.location } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { cache: "no-store", credentials: "omit" });
  } catch {
    return { ...DEMO_CONFIG, source: "default" };
  }
  if (!response || !response.ok) return { ...DEMO_CONFIG, source: "default" };
  let raw;
  try {
    raw = await response.json();
  } catch {
    return { mode: "invalid", errors: ["public-config.json no es un JSON legible."], warnings: [], source: "file" };
  }
  const { config, errors, warnings } = validatePublicConfig(raw);
  if (!config) return { mode: "invalid", errors, warnings, source: "file" };
  const sameSite = config.mode !== "live" || !location?.hostname ? true : isLikelySameSite(config.apiBaseUrl, location.hostname);
  return { ...config, warnings, sameSite, source: "file" };
}
