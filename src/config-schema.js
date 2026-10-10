// Validación de la configuración PÚBLICA del portal. La comparten el script que genera
// public-config.json (Node) y el cargador del navegador, así que no usa APIs de ninguno de los dos.
// Solo cuatro variables PUBLIC_* entran en el archivo; nada más del entorno se copia.

export const PUBLIC_VARIABLES = Object.freeze(["PUBLIC_PORTAL_MODE", "PUBLIC_API_BASE_URL", "PUBLIC_CLIENT_PORTAL_URL", "PUBLIC_WHATSAPP_MODE"]);
export const PORTAL_MODES = Object.freeze(["demo", "live"]);
export const WHATSAPP_MODES = Object.freeze(["manual", "off"]);

export const DEMO_CONFIG = Object.freeze({ mode: "demo", apiBaseUrl: "", clientPortalUrl: "", whatsappMode: "manual" });

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(value, label, errors, { allowTrailingSlash }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    errors.push(`${label}: no es una URL válida.`);
    return "";
  }
  if (!["http:", "https:"].includes(url.protocol)) errors.push(`${label}: tiene que empezar con https:// (o http:// solo para localhost).`);
  else if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) errors.push(`${label}: exige https salvo en localhost.`);
  if (url.username || url.password) errors.push(`${label}: no puede llevar usuario ni contraseña.`);
  if (url.search || url.hash) errors.push(`${label}: no puede llevar parámetros ni fragmento.`);
  if (!allowTrailingSlash && value.endsWith("/")) errors.push(`${label}: no debe terminar en "/".`);
  return value;
}

/**
 * Valida un objeto de variables PUBLIC_* y devuelve `{ config, errors, warnings }`.
 * Si hay errores, `config` es null. Las claves ajenas a la lista permitida se ignoran (con aviso).
 */
export function validatePublicEnv(env = {}) {
  const errors = [];
  const warnings = [];
  for (const key of Object.keys(env)) {
    if (key.startsWith("PUBLIC_") && !PUBLIC_VARIABLES.includes(key)) warnings.push(`${key}: variable PUBLIC_ desconocida, se ignora.`);
  }
  const text = (key) => (typeof env[key] === "string" ? env[key].trim() : "");

  const mode = text("PUBLIC_PORTAL_MODE") || "demo";
  if (!PORTAL_MODES.includes(mode)) errors.push(`PUBLIC_PORTAL_MODE: "${mode}" no es válido. Usá ${PORTAL_MODES.join(" o ")}.`);

  const whatsappMode = text("PUBLIC_WHATSAPP_MODE") || "manual";
  if (!WHATSAPP_MODES.includes(whatsappMode)) errors.push(`PUBLIC_WHATSAPP_MODE: "${whatsappMode}" no es válido. Usá ${WHATSAPP_MODES.join(" o ")}.`);

  let apiBaseUrl = text("PUBLIC_API_BASE_URL");
  if (apiBaseUrl) apiBaseUrl = parseUrl(apiBaseUrl, "PUBLIC_API_BASE_URL", errors, { allowTrailingSlash: false });
  else if (mode === "live") errors.push("PUBLIC_API_BASE_URL: es obligatoria en modo live.");

  let clientPortalUrl = text("PUBLIC_CLIENT_PORTAL_URL");
  if (clientPortalUrl) clientPortalUrl = parseUrl(clientPortalUrl, "PUBLIC_CLIENT_PORTAL_URL", errors, { allowTrailingSlash: true });

  if (errors.length) return { config: null, errors, warnings };
  // En demo no se publica ninguna URL de API: el modo demo nunca habla con un servidor.
  return { config: { mode, apiBaseUrl: mode === "live" ? apiBaseUrl : "", clientPortalUrl, whatsappMode }, errors, warnings };
}

/** Valida el contenido ya generado de public-config.json (lo que lee el navegador). */
export function validatePublicConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { config: null, errors: ["public-config.json: tiene que ser un objeto."], warnings: [] };
  const env = {
    PUBLIC_PORTAL_MODE: raw.mode,
    PUBLIC_API_BASE_URL: raw.apiBaseUrl,
    PUBLIC_CLIENT_PORTAL_URL: raw.clientPortalUrl,
    PUBLIC_WHATSAPP_MODE: raw.whatsappMode,
  };
  const result = validatePublicEnv(env);
  const known = new Set(["mode", "apiBaseUrl", "clientPortalUrl", "whatsappMode"]);
  for (const key of Object.keys(raw)) if (!known.has(key)) result.warnings.push(`public-config.json: la clave "${key}" no es parte del contrato y se ignora.`);
  return result;
}

const labelsOf = (hostname) => hostname.replace(/^\[|\]$/g, "").split(".").filter(Boolean);

/**
 * Las cookies de sesión son SameSite=Lax: solo viajan si la página y la API son del mismo sitio.
 * Heurística (sin lista de sufijos públicos): mismo host, o mismos dos últimos rótulos.
 */
export function isLikelySameSite(apiBaseUrl, pageHostname) {
  let apiHost;
  try { apiHost = new URL(apiBaseUrl).hostname; } catch { return false; }
  if (apiHost === pageHostname) return true;
  if (LOCAL_HOSTS.has(apiHost) || LOCAL_HOSTS.has(pageHostname) || /^[\d.]+$/.test(apiHost) || /^[\d.]+$/.test(pageHostname)) return false;
  const a = labelsOf(apiHost);
  const b = labelsOf(pageHostname);
  return a.length >= 2 && b.length >= 2 && a.slice(-2).join(".") === b.slice(-2).join(".");
}
