import test from "node:test";
import assert from "node:assert/strict";
import contracts from "../src/live/modules/contratos.js";
const esc = (s) => String(s).replace(/[&<>"']/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[x]);
function context(can = true) {
  const data = { "contract.gates": { sandboxEnabled: true }, "contract.list": [] };
  return {
    can: (p) => (p === "billing:read" ? can : true),
    esc,
    btn: (a, l, c, attrs) => `<button data-action="${a}" ${attrs}>${l}</button>`,
    shell: (s) => s,
    repo: { data: (k) => data[k], get: () => ({ status: "ready", data: [] }) },
    entryView: (_e, o) => o.render([]),
    data,
  };
}
test("staff gates communicate blocked production and never render a client signing action", () => {
  const ctx = context();
  const html = contracts.render(ctx, {});
  assert.match(html, /Producción contractual bloqueada/);
  assert.match(html, /ficticio/);
  assert.doesNotMatch(html, /sandbox-event|Firmar por cliente/);
  assert.match(contracts.render(context(false), {}), /falta billing:read/);
});
test("untrusted names/scope/externals are escaped in the staff overview and no consent is preselected", () => {
  const ctx = context();
  const id = "00000000-0000-4000-8000-000000000001";
  ctx.repo.data = (key) =>
    key === "contract.gates"
      ? { sandboxEnabled: true }
      : key === "contract.engagement"
        ? {
            id,
            name: "<script>x</script>",
            snapshot: {
              totalCents: 50000,
              depositCents: 25000,
              balanceCents: 25000,
              monthlyCents: 2000,
              bonusMonths: 3,
              externals: "<img src=x onerror=x>",
              scope: ["<b>unsafe</b>"],
            },
            deposit: { state: "pending" },
            issues: [],
            projectId: null,
          }
        : [];
  const html = contracts.render(ctx, { id });
  assert.doesNotMatch(html, /<script>|<img src=x|<b>unsafe/);
  assert.match(html, /&lt;script&gt;/);
  const modalCtx = {
    esc,
    modalShell: (_a, _b, _c, s) => s,
    field: () => "",
    area: () => "",
    select: () => "",
    repo: { data: () => ({ plans: [] }) },
  };
  assert.doesNotMatch(contracts.modals["contract-create"].markup(modalCtx), / checked/);
});
test("staff create persists through the authenticated API with server-owned selection and a stable retry key", async () => {
  const calls = [];
  const h = {
    api: {
      post: async (...args) => {
        calls.push(args);
        return { engagement: { id: "id" } };
      },
    },
    target: {},
    idem: () => "retry-key",
    touch: () => {},
  };
  const v = {
    confirm: "1",
    clientId: "client",
    organizationName: "fake",
    name: "fake",
    planId: "volta",
    maintenance: "esencial",
    landing: "1",
    whatsapp: "1",
    scope: "One scope",
    externals: "External",
    details: "Draft",
  };
  const result = await contracts.mutations["contract-create"](v, h);
  assert.equal(result.goto, "#contratos/id");
  assert.equal(calls[0][2].idempotencyKey, "retry-key");
  assert.equal(calls[0][1].isExample, true);
  assert.deepEqual(calls[0][1].selection.items, ["landing-extra", "whatsapp-extra"]);
  assert.equal(calls[0][1].selection.founder, false);
  assert.equal("totalCents" in calls[0][1], false);
});
