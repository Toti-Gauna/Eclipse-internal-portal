# Contratación del reto — operación staff

PRE-VENTA. Base main `de34509`, rama `feat/reto-2026-10-13-contracting`. Nuevo módulo `#contratos` en la sesión y registro de módulos existentes; no crea auth, CRM ni storage alternativos.

API Eclipse-be 0.8.0 requerida. Listar engagements, preparar borrador ficticio con cliente verificado explícito, revisar documento completo, publicar con confirmación, consultar/exportar evidencia, registrar anticipo disponible, convertir una sola vez, registrar preview de activación, preparar acta tras QA y revocar. Saldo usa Cobros existente. Staff nunca firma ni declara consentimiento por el cliente. Observaciones y aceptación de acta no concilian saldo.

Los precios y opciones provienen del catálogo del servidor. Final validado solo para ofertas desde 500, máximo 1.000 del reto; no altera sistemas fuera de campaña. Cliente/totales no se autoasignan por email ni por selección de navegador. API valida permisos e importes; esconder un botón no otorga/revoca acceso.

Sandbox requiere `CONTRACT_SANDBOX_ENABLED=true` en BE de pruebas, NODE_ENV no productivo y datos ficticios. El adapter productivo está ausente, la plantilla es outline interno y todos los proyectos convertidos son ejemplos. Gate cerrado en servidor incluso si alguien manipula el frontend. No se implementó SMTP nuevo ni envío de contratos reales.

Config pública mediante script existente `npm run config`: PUBLIC_PORTAL_MODE=live, PUBLIC_API_BASE_URL=https://api.eclipse-business.com/api/v1 y PUBLIC_CLIENT_PORTAL_URL=https://eclipse-business.com/es/portal. Aquí el API incluye /api/v1 (a diferencia de la web Next). Verificar `docs/integration.md`; solo allowlist pública, nunca secretos. Hostinger interno y API Render requieren dominios same-site y HTTPS/cookies/CSRF intactos. Configuraciones de prueba se interceptan en navegador sin editar la configuración publicada.

Checks: `npm test` 128 tests; `tests/contracts-module.test.js` comprueba renderer seguro y gates; `CHROMIUM_PATH=<Chromium> E2E_API=http://localhost:3000 node tests/contracts-live-browser.mjs` comprueba MFA/sesión real, gates, consentimientos vacíos, catálogo, preview y móvil con API/DB local. No ejecutar contra producción. Screenshots son datos ficticios y no demuestran despliegue.

Integrar después de migración/grants/backend y antes de web. Revisión de Ignacio antes de merge/publicación; main dispara Pages. Rollback recupera artefacto frontend previo sin borrar evidencia DB. Pendientes productivos: partes/plantilla/método/contrafirma/retención (Ignacio/Legal), calendario/canal aprobado y costos (Ignacio), dominios/permisos/backup durable de Neon (Infra). No se compró proveedor ni se enviaron mensajes.
