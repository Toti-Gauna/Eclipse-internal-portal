// Contratación pre-proyecto sobre la misma sesión/API. Todo texto no confiable se escapa.
import { FormError } from "../errors.js";
import { checkbox, ensureStyles, saveBlob } from "./comms-support.js";
import { formatCents as money } from "../adapters/common.js";
const isId = (id) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id || "");
const rowOf = (ctx, id) => ctx.repo.data("contract.engagement", id) || null;
const names = {
  draft: "Borrador interno",
  published: "Revisión pendiente",
  test_completed: "Prueba completada — no firma real",
  revoked: "Revocado",
};
const checks = (ctx) => checkbox(ctx.esc, "confirm", "Confirmo la acción explícita en sandbox con datos ficticios", { required: true });
export default {
  id: "contratos",
  label: "Contratación",
  nav: { order: 49, area: "menu", hint: "Ofertas, acuerdos y evidencia" },
  status: "live",
  permission: "documents:read",
  slices: {
    "contract.gates": { permission: "documents:read", load: async ({ api, signal }) => api.get("/admin/contracts/gates", { signal }) },
    "contract.list": {
      permission: "documents:read",
      forbiddenValue: [],
      load: async ({ api, signal }) => (await api.get("/admin/engagements", { signal })).engagements,
    },
    "contract.engagement": {
      permission: "documents:read",
      load: async ({ api, signal }, id) => (await api.get(`/admin/engagements/${id}`, { signal })).engagement,
    },
  },
  prepare(ctx, route) {
    ensureStyles();
    if (!ctx.can("billing:read")) return;
    ctx.repo.ensure("contract.gates").catch(() => {});
    ctx.repo.ensure("contract.list").catch(() => {});
    ctx.repo.ensure("catalog").catch(() => {});
    if (isId(route.id)) ctx.repo.ensure("contract.engagement", route.id, { force: true }).catch(() => {});
  },
  render(ctx, route) {
    const { esc, btn } = ctx;
    const shell = (title, body) => ctx.shell(`<h1 class="display pt-title">${esc(title)}</h1>${body}`, "contratos");
    const gates = ctx.repo.data("contract.gates");
    const rows = ctx.repo.data("contract.list") || [];
    const row = isId(route.id) ? rowOf(ctx, route.id) : null;
    if (!ctx.can("billing:read"))
      return shell(
        "Contratación",
        '<p class="pt-notice">Para revisar precio y expediente falta billing:read además de documents:read. Pedí acceso al responsable.</p>',
      );
    const intro = `<p class="pt-notice">Producción contractual bloqueada: plantilla, partes fiscales, método, retención y calendario pendientes. WhatsApp manual; sin SMTP nuevo. ${gates?.sandboxEnabled ? "Sandbox local habilitado, solo datos ficticios." : "Sandbox deshabilitado."}</p>`;
    const can = ctx.can("documents:write") && ctx.can("billing:write") && gates?.sandboxEnabled && !!ctx.repo.data("catalog");
    const list = rows
      .map(
        (r) =>
          `<li><a class="pt-link" href="#contratos/${esc(r.id)}">${esc(r.name)}</a> · ${esc(r.sandbox ? "SANDBOX" : "Oferta")} · ${esc(r.deposit.state === "available" ? "Anticipo verificado (prueba)" : "Anticipo pendiente")}</li>`,
      )
      .join("");
    const create = can ? btn("contract-create", "Preparar borrador ficticio", "btn-primary") : "";
    if (!isId(route.id))
      return shell(
        "Contratación",
        `${intro}${create}${ctx.entryView(ctx.repo.get("contract.list"), { slice: "contract.list", key: "", label: "No pudimos consultar acuerdos; reintentá", render: () => `<ul>${list || "<li>No hay acuerdos para revisar. Registrar una cuenta no genera contrato.</li>"}</ul>` })}`,
      );
    if (!row) {
      const state = ctx.repo.get("contract.engagement", route.id);
      return shell(
        "Acuerdo",
        intro +
          ctx.entryView(state, { slice: "contract.engagement", key: route.id, label: "No pudimos cargar el acuerdo", render: () => "" }),
      );
    }
    const facts = `<dl class="ld-facts"><div><dt>Total / anticipo / saldo</dt><dd>${money(row.snapshot.totalCents)} / ${money(row.snapshot.depositCents)} / ${money(row.snapshot.balanceCents)}</dd></div><div><dt>Mensualidad</dt><dd>${money(row.snapshot.monthlyCents)}/mes · ${row.snapshot.bonusMonths} meses bonificados</dd></div><div><dt>Estado</dt><dd>${esc(row.deposit.state)} · proyecto ${esc(row.projectId || "aún sin activar")}</dd></div></dl><p>${esc(row.snapshot.externals)}</p><ul>${row.snapshot.scope.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`;
    const actions = can
      ? `${btn("contract-issue", "Nueva versión / acta", "btn-ghost", `data-id="${esc(row.id)}"`)}${btn("contract-deposit", "Verificar anticipo (prueba)", "btn-ghost", `data-id="${esc(row.id)}"`)}${btn("contract-convert", "Convertir a proyecto (prueba)", "btn-ghost", `data-id="${esc(row.id)}"`)}${btn("contract-activation", "Preview de activación", "btn-ghost", `data-id="${esc(row.id)}"`)}${btn("contract-revoke", "Revocar acceso", "btn-ghost", `data-id="${esc(row.id)}"`)}`
      : "";
    const issues = row.issues
      .map(
        (i) =>
          `<article class="pt-card"><h3>${i.kind === "start" ? "Acuerdo de inicio" : "Acta de entrega"} v${i.number}</h3><p>${esc(names[i.status] || i.status)} · ${esc(i.method)} · plantilla ${esc(i.templateVersion)}</p><p class="pt-fine" style="overflow-wrap:anywhere">SHA-256 ${esc(i.documentHash)}</p>${btn("contract-read", "Previsualizar documento completo", "btn-ghost", `data-id="${esc(row.id)}" data-kind="${esc(i.id)}"`)}${btn("contract-evidence", "Descargar evidencia y observaciones", "btn-ghost", `data-id="${esc(row.id)}" data-kind="${esc(i.id)}"`)}${i.status === "draft" && can ? btn("contract-publish", "Publicar explícitamente en sandbox", "btn-ghost", `data-id="${esc(row.id)}" data-kind="${esc(i.id)}"`) : ""}</article>`,
      )
      .join("");
    return shell(
      row.name,
      `${intro}${facts}<div class="lc-actions">${actions}</div>${issues}<p>El staff nunca firma por el cliente. La prueba completada no acredita dinero. QA/entrega deben registrarse desde Proyectos antes de preparar/publicar el acta. El saldo se verifica por separado desde Cobros.</p>${row.projectId ? `<a class="pt-link" href="#cobros/${esc(row.projectId)}">Cobros del proyecto</a>` : ""}`,
    );
  },
  modals: {
    "contract-create": {
      markup(ctx) {
        const catalog = ctx.repo.data("catalog");
        return ctx.modalShell(
          "Sandbox",
          "Borrador interno — no aprobado para contratación",
          "Cuenta ficticia verificada y asociación explícita. Importes y bonificación recalculados por el servidor.",
          `${ctx.field("clientId", "ID de cuenta ficticia verificada", "text", "", "required")}${ctx.field("organizationName", "Organización ficticia", "text", "", 'required maxlength="120"')}${ctx.field("name", "Nombre del engagement", "text", "", 'required maxlength="120"')}${ctx.select(
            "planId",
            "Paquete",
            Object.values(catalog?.plans || {})
              .filter((p) => ["presencia", "automatiza", "volta", "velmar", "operativo", "ampliado"].includes(p.id))
              .map((p) => [p.id, p.name.es]),
            "volta",
          )}${ctx.select(
            "maintenance",
            "Plan mensual",
            Object.values(catalog?.maintenance || {}).map((m) => [m.id, `${m.name.es} · ${money(m.monthlyCents)}/mes`]),
            "esencial",
          )}${checkbox(ctx.esc, "landing", `Extra landing ${money(catalog?.items?.["landing-extra"]?.priceCents || 0)} (solo Volta/Velmar compatible)`)}${checkbox(ctx.esc, "whatsapp", `Extra WhatsApp ${money(catalog?.items?.["whatsapp-extra"]?.priceCents || 0)} (solo Volta/Velmar compatible)`)}${ctx.field("finalTotalCents", "Total final USD centavos (solo ofertas desde; vacío usa catálogo)", "number", "", 'min="50000" max="100000" step="1"')}${ctx.area("scope", "Alcance validado / límites (una línea por partida)", "", 'required maxlength="4000"')}${ctx.area("externals", "Servicios externos y condiciones a validar", "", 'required maxlength="2000"')}${ctx.area("details", "Esquema / pruebas para revisión interna", "", 'required maxlength="8000"')}${checks(ctx)}`,
          "Preparar",
          { live: true },
        );
      },
    },
    "contract-issue": {
      markup(ctx, m) {
        return ctx.modalShell(
          "Versionado",
          "Preparar nueva versión o acta",
          "Documento nuevo; no sobrescribe bytes ni consentimiento. Acta solo después de QA/entrega.",
          `${ctx.select(
            "kind",
            "Tipo",
            [
              ["start", "Acuerdo de inicio"],
              ["delivery", "Acta de entrega"],
            ],
            "start",
          )}${ctx.area("details", "Pruebas, entregables y esquema interno", "", 'required maxlength="8000"')}${checks(ctx)}`,
          "Preparar",
          { live: true },
        );
      },
    },
    "contract-publish": {
      markup(ctx, m) {
        const row = rowOf(ctx, m.id);
        return ctx.modalShell(
          "Publicación explícita",
          "Publicar prueba para el cliente",
          "No habilita contrato productivo ni firma real. Antes, previsualizá el documento completo.",
          `${ctx.field("issueId", "ID de emisión previsualizada", "text", m.kind || row?.issues.find((i) => i.status === "draft")?.id || "", "required")}${checks(ctx)}`,
          "Publicar sandbox",
          { live: true },
        );
      },
    },
    "contract-deposit": {
      markup(ctx, m) {
        const row = rowOf(ctx, m.id);
        return ctx.modalShell(
          "Conciliación de prueba",
          "Anticipo acreditado disponible",
          "Solo tras verificar acreditación. Captura, promesa o escrow financiado no sirven. No activa el proyecto por sí solo.",
          `${ctx.field("amountCents", "Importe USD centavos", "number", row?.snapshot.depositCents || "", 'required min="25000" max="50000" step="1"')}${ctx.field("reference", "Referencia de prueba", "text", "", 'required maxlength="160"')}${ctx.field("receivedOn", "Fecha real de recepción ficticia", "date", "", "required")}${checks(ctx)}`,
          "Registrar prueba",
          { live: true },
        );
      },
    },
    "contract-convert": {
      markup(ctx) {
        return ctx.modalShell(
          "Inicio",
          "Convertir engagement a proyecto de prueba",
          "El servidor exige acuerdo vigente completado en sandbox y anticipo verificado; reintentos no duplican.",
          checks(ctx),
          "Convertir",
          { live: true },
        );
      },
    },
    "contract-activation": {
      markup(ctx) {
        return ctx.modalShell(
          "Calendario",
          "Preview de activación",
          "Convención por aniversario con ajuste al fin de mes, pendiente de Ignacio/Finance. Tres meses, no 90 días.",
          `${ctx.field("activatedOn", "Activación ficticia", "date", "", "required")}${ctx.field("publishedOn", "Publicación ficticia (requerida para bonificación)", "date", "")}${checks(ctx)}`,
          "Registrar preview",
          { live: true },
        );
      },
    },
    "contract-revoke": {
      markup(ctx) {
        return ctx.modalShell(
          "Acceso",
          "Revocar engagement",
          "Se conserva todo el expediente; descargas mediadas vuelven a verificar autorización.",
          `${ctx.area("reason", "Motivo", "", 'required maxlength="500"')}${checks(ctx)}`,
          "Revocar",
          { live: true },
        );
      },
    },
  },
  actions: {
    async "contract-read"(ctx, { kind }) {
      const { blob } = await ctx.api.download(`/admin/contracts/${kind}/content`);
      const text = await blob.text();
      const box = document.createElement("dialog");
      box.className = "pt-card";
      box.style.cssText = "max-width:min(90vw,900px);max-height:85vh;overflow:auto;background:#fcf8ef;color:#29251e;padding:2rem;";
      const pre = document.createElement("pre");
      pre.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.7 sans-serif";
      pre.textContent = text;
      const close = document.createElement("button");
      close.textContent = "Cerrar preview";
      close.className = "btn btn-ghost";
      close.onclick = () => box.close();
      box.append(close, pre);
      document.body.append(box);
      box.addEventListener("close", () => box.remove());
      box.showModal();
      return { message: "Preview completo de borrador interno. No es envío ni firma.", refresh: [] };
    },
    async "contract-evidence"(ctx, { kind }) {
      const { blob } = await ctx.api.download(`/admin/contracts/${kind}/evidence`);
      saveBlob(blob, "evidencia-sandbox.json");
      return { message: "Evidencia exportada; método real y observaciones conservados.", refresh: [] };
    },
  },
  mutations: Object.fromEntries(
    ["create", "issue", "publish", "deposit", "convert", "activation", "revoke"].map((action) => [
      `contract-${action}`,
      async (v, h) => {
        if (!v.confirm) throw new FormError("Confirmá explícitamente la acción.");
        const id = h.target.id;
        let result;
        if (action === "create") {
          const selection = {
            goals: [],
            planId: v.planId,
            items: [...(v.landing ? ["landing-extra"] : []), ...(v.whatsapp ? ["whatsapp-extra"] : [])],
            maintenance: v.maintenance,
            billing: "monthly",
            vertical: null,
            founder: false,
          };
          result = await h.api.post(
            "/admin/engagements",
            {
              clientId: v.clientId,
              organizationName: v.organizationName,
              name: v.name,
              selection,
              scope: v.scope
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
              externals: v.externals,
              details: v.details,
              isExample: true,
              ...(v.finalTotalCents ? { finalTotalCents: Number(v.finalTotalCents) } : {}),
            },
            {
              idempotencyKey: h.idem({
                clientId: v.clientId,
                selection,
                details: v.details,
                name: v.name,
                scope: v.scope,
                externals: v.externals,
                organizationName: v.organizationName,
              }),
            },
          );
        } else if (action === "issue") result = await h.api.post(`/admin/engagements/${id}/issues`, { kind: v.kind, details: v.details });
        else if (action === "publish") result = await h.api.post(`/admin/contracts/${v.issueId}/publish`, { confirm: true });
        else if (action === "deposit")
          result = await h.api.post(`/admin/engagements/${id}/deposit`, {
            amountCents: Number(v.amountCents),
            currency: "USD",
            state: "available",
            reference: v.reference,
            receivedOn: v.receivedOn,
            confirm: true,
          });
        else if (action === "activation")
          result = await h.api.post(`/admin/engagements/${id}/activation`, {
            activatedOn: v.activatedOn,
            publishedOn: v.publishedOn || null,
            confirmPreview: true,
          });
        else if (action === "revoke") result = await h.api.post(`/admin/engagements/${id}/revoke`, { reason: v.reason });
        else result = await h.api.post(`/admin/engagements/${id}/convert`, { confirm: true });
        h.touch(["contract.list"]);
        if (id) h.touch(["contract.engagement", id]);
        return {
          message: "Estado confirmado por el servidor. Sandbox; ningún contrato, firma ni cobro productivo.",
          goto: action === "create" ? `#contratos/${result.engagement.id}` : undefined,
        };
      },
    ]),
  ),
};
