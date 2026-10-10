// Claves Idempotency-Key (UUIDv4 en minúsculas). Regla del backend: la misma clave con el mismo cuerpo repite el
// resultado (200); con otro cuerpo es 409. Por eso la clave se REUTILIZA al reintentar el mismo envío y se RENUEVA
// para uno nuevo: dos claves distintas son dos cobros.

export function newIdempotencyKey(cryptoImpl = globalThis.crypto) {
  if (cryptoImpl?.randomUUID) return cryptoImpl.randomUUID().toLowerCase();
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/**
 * Guarda, por envío (`scope`), la clave del último intento que no terminó bien.
 * - Mismo cuerpo que el intento fallido → la misma clave (reintento seguro).
 * - Cuerpo distinto → clave nueva (el usuario corrigió algo: es otro envío).
 * - `settle(scope)` al confirmar el servidor: el próximo envío usa otra clave.
 */
export function createIdempotencyStore({ generate = newIdempotencyKey } = {}) {
  const pending = new Map();
  return {
    keyFor(scope, body) {
      const fingerprint = stable(body);
      const known = pending.get(scope);
      if (known && known.fingerprint === fingerprint) return known.key;
      const key = generate();
      pending.set(scope, { key, fingerprint });
      return key;
    },
    settle(scope) { pending.delete(scope); },
    clear() { pending.clear(); },
    has(scope) { return pending.has(scope); },
  };
}
