// Ayudas SOLO para pruebas contra el servidor e2e del backend (docs/e2e.md). Nada de esto se publica ni se usa en el portal.
// El código TOTP de un paso de 30 s se acepta una sola vez por cuenta: se espera a que cambie antes de pedir otro ingreso.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const E2E_ADMIN = { email: "admin@eclipse.test", password: "E2e-Admin-Password-2026!" };
const MARK = join(tmpdir(), "eclipse-portal-e2e-last-totp.json");

function lastUsed() {
  try { return JSON.parse(readFileSync(MARK, "utf8")); } catch { return {}; }
}

/** Devuelve un código vigente que todavía no se usó con este servidor (esperando hasta 35 s si hace falta). */
export async function freshAdminCode(apiRoot) {
  const deadline = Date.now() + 40_000;
  for (;;) {
    const { code, next } = await (await fetch(`${apiRoot}/__e2e/admin-code`)).json();
    const used = lastUsed()[apiRoot];
    if (code !== used) { writeFileSync(MARK, JSON.stringify({ ...lastUsed(), [apiRoot]: code })); return code; }
    if (Date.now() > deadline) throw new Error("No apareció un código TOTP nuevo a tiempo.");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    void next;
  }
}
