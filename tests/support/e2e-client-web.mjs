// Cliente WEB de prueba: inicia sesión como cliente (origen de Eclipse-Web) y lee lo que ESE cliente puede ver de los documentos.
// Sirve para comprobar, desde el otro lado, que un archivo interno no existe para él y que uno compartido se descarga idéntico.
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN || "http://localhost:3001";

export async function clientWeb(apiRoot, { email, password = "Cliente-De-Prueba-2026!" }) {
  const root = `${apiRoot}/api/v1`;
  const cookies = new Map();
  const absorb = (response) => { for (const line of response.headers.getSetCookie?.() || []) { const [pair] = line.split(";"); const index = pair.indexOf("="); cookies.set(pair.slice(0, index), pair.slice(index + 1)); } };
  const cookie = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  const raw = async (method, path, { body, csrf } = {}) => {
    const response = await fetch(`${root}${path}`, { method, headers: { Origin: WEB_ORIGIN, ...(cookie() ? { Cookie: cookie() } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
    absorb(response);
    return response;
  };
  const pre = (await (await raw("GET", "/auth/csrf")).json()).csrfToken;
  const login = await raw("POST", "/auth/client/login", { body: { email, password }, csrf: pre });
  if (!login.ok) throw new Error(`Login del cliente: ${login.status}`);
  return {
    async listDocuments(projectId) {
      const response = await raw("GET", `/client/projects/${projectId}/documents`);
      return { status: response.status, documents: response.ok ? (await response.json()).documents : [] };
    },
    async download(id) {
      const response = await raw("GET", `/client/documents/${id}/content`);
      return { status: response.status, contentType: response.headers.get("content-type") || "", disposition: response.headers.get("content-disposition") || "", bytes: Buffer.from(await response.arrayBuffer()) };
    },
  };
}
