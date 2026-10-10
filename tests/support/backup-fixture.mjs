// Respaldo de PRUEBA con la forma que produce «Exportar respaldo» del portal en modo demostración, armado con los datos de ejemplo
// (src/data/seed.js) y fechas fijas en el pasado. Cada corrida usa identificadores, nombres y códigos propios (`stamp`): la base de
// pruebas es compartida y descartable, y lo ya importado (por id, por código ECL o por nombre parecido) no se vuelve a importar.
import { buildSeed } from "../../src/data/seed.js";

const FIXED_DAY = "2026-09-15";

export function makeBackup(stamp, { today = FIXED_DAY, sameNamesAs = null } = {}) {
  const seed = buildSeed(today);
  const names = sameNamesAs ?? stamp;
  const ids = new Map();
  for (const list of [seed.prospects, seed.batches, seed.projects, seed.payments, seed.goals, seed.calendarEvents]) for (const item of list) ids.set(item.id, `t${stamp}-${item.id}`);
  const remap = (value) => {
    if (typeof value === "string") {
      if (ids.has(value)) return ids.get(value);
      const ref = /^(prospect|project|lead):(.+)$/.exec(value);
      if (ref && ids.has(ref[2])) return `${ref[1]}:${ids.get(ref[2])}`;
      return value;
    }
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, remap(inner)]));
    return value;
  };
  const data = remap(seed);
  const tag = (text) => `${text} · T${names}`;
  data.prospects.forEach((p) => { p.name = tag(p.name); });
  data.batches.forEach((b) => { b.name = tag(b.name); });
  data.projects.forEach((p, index) => { p.name = tag(p.name); p.client = tag(p.client); p.code = `ECL-T${stamp}-${index + 1}`; });
  data.goals.forEach((g) => { g.title = tag(g.title); });
  data.calendarEvents.forEach((e) => { e.title = tag(e.title); });
  // Un cobro «Otro» de un proyecto que sí se importa: el servidor pide decidir qué tipo es.
  data.payments.push({ id: `t${stamp}-c8`, date: "2026-09-10", amount: 100, unit: "Agency", projectId: `t${stamp}-pr-clinica`, concept: "Otro", note: "Ajuste puntual" });
  return data;
}
