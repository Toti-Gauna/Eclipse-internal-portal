// Cliente de PRUEBA para el servidor e2e del backend: crea una cuenta de cliente verificada y le hace enviar una solicitud de plan,
// para que la bandeja de solicitudes del portal tenga algo real que mostrar. Origen web: http://localhost:3001 (docs/e2e.md).
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN || "http://localhost:3001";

function jar() {
  const cookies = new Map();
  return {
    absorb(response) {
      for (const line of response.headers.getSetCookie?.() || []) {
        const [pair] = line.split(";");
        const index = pair.indexOf("=");
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    },
    header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
  };
}

/**
 * Crea y verifica una cuenta de cliente. Si dos servidores e2e comparten la base de pruebas, el correo de verificación puede ser tomado
 * por el trabajador del otro proceso (clave de cifrado distinta por proceso: INVALID_OUTBOX_PAYLOAD). Por eso se reintenta con otro email.
 */
export async function createClientSession(apiRoot, options) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const email = attempt === 0 ? options.email : options.email.replace("@", `+r${attempt}@`);
    try { return await createClientSessionOnce(apiRoot, { ...options, email }); } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function createClientSessionOnce(apiRoot, { email, password = "Cliente-De-Prueba-2026!", displayName = "Cliente de prueba" }) {
  const api = `${apiRoot}/api/v1`;
  const cookies = jar();
  const call = async (method, path, { body, csrf, key } = {}) => {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: { Origin: WEB_ORIGIN, ...(cookies.header() ? { Cookie: cookies.header() } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    cookies.absorb(response);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(data)}`);
    return data;
  };
  const preauth = async () => (await call("GET", "/auth/csrf")).csrfToken;

  await call("POST", "/auth/client/register", { body: { email, password, displayName }, csrf: await preauth() });
  // El correo sale de una cola que se vacía cada segundo: se espera a que aparezca.
  let token;
  for (let attempt = 0; attempt < 14 && !token; attempt++) {
    const mail = (await (await fetch(`${apiRoot}/__e2e/mail?to=${encodeURIComponent(email)}`)).json()).mail;
    token = mail.map((message) => message.token || /token=([A-Za-z0-9_-]{43})/.exec(JSON.stringify(message))?.[1]).find(Boolean);
    if (!token) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!token) throw new Error("No llegó el correo de verificación al registrador de pruebas.");
  await call("POST", "/auth/client/email-verification/confirm", { body: { token }, csrf: await preauth() });
  const login = await call("POST", "/auth/client/login", { body: { email, password }, csrf: await preauth() });

  return {
    clientId: login.client.id,
    email,
    async submitPlanRequest({ name = "Cliente de prueba", phone = "+5491100000000", message = "Quiero conversar sobre esta propuesta.", selection } = {}) {
      const catalog = await call("GET", "/catalog/plans");
      const key = globalThis.crypto.randomUUID();
      const result = await call("POST", "/client/plan-requests", {
        key, csrf: login.csrfToken,
        body: { catalogVersion: catalog.version, selection: selection || { goals: ["encontrar"], planId: "presencia", items: ["seo"], billing: "monthly", vertical: "otro", founder: false }, contact: { name, phone }, message },
      });
      return result.request;
    },
  };
}
