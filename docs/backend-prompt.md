# Prompt para implementar el backend de Eclipse

Copiá el bloque siguiente en una sesión con acceso a **Eclipse-internal-portal** y **Eclipse-Web**, y a un repositorio nuevo **Eclipse-Backend**. Los archivos en [env/](env/) son ejemplos dummy para la implementación futura; no crean usuarios ni conectan la versión actual. La decisión final es usar **WhatsApp manual**, sin emails.

---

Actuá como desarrollador responsable de implementar y conectar el backend real de Eclipse. Completá el trabajo en código, con migraciones, pruebas, documentación y PRs concretas. Antes de editar, leé los AGENTS.md de cada repositorio y sus instrucciones locales. Conservá la estética y los flujos ya implementados.

## Contexto y resultado esperado

Hay dos frontends existentes:

1. **Toti-Gauna/Eclipse-internal-portal**: HTML, CSS y JavaScript nativo, sin framework. `src/app.js` coordina las pantallas y mutaciones; `src/rules.js` contiene las reglas de negocio; `src/planner.js`, las metas, el calendario y los timestamps; `src/generators.js`, los generadores por pasos; `src/workspace-ui.js`, el plan, calendario, herramientas y bitácora. `src/data/store.js` usa localStorage con clave `eclipse-ops-v2`, datos y respaldos versión 3. No reemplaces el portal por una app nueva.
2. **Toti-Gauna/Eclipse-Web**: Next.js, React y next-intl, con exportación estática. Revisá las versiones del package.json y la documentación instalada antes de cambiarlo. El login en `components/portal/LoginForm.tsx` es una demostración; los proyectos salen de `lib/portal/fixtures.ts`. Las rutas son `app/[locale]/portal/page.tsx`, `portal/proyectos/page.tsx` y `portal/proyectos/[id]/page.tsx`. Conectá estas vistas a datos autenticados, manteniendo el sitio público, las traducciones, el loader y el diseño. No publiques datos reales de clientes en fixtures o HTML prerenderizado.

Creá **Eclipse-Backend** con Node.js 22, TypeScript, Express, PostgreSQL y Prisma, usando versiones compatibles verificadas al implementar y lockfile. PostgreSQL persistente es la fuente de verdad. Los frontends deben leer y modificar los mismos proyectos: un avance cargado por el admin debe verse en el portal del cliente correcto después de guardar y recargar. No prometas tiempo real si implementás refetch; eso alcanza para esta primera versión.

El plan actual de Hostinger del propietario **no permite Node.js**, confirmado por su captura de hPanel. Prioridad de despliegue: frontends estáticos en Hostinger y backend Node.js en **Render**, con base PostgreSQL persistente. Prepará también instrucciones para Hostinger Business/Cloud si se cambia de plan. Render gratuito sirve para pruebas con sus limitaciones; no uses un filesystem efímero o una base gratuita que expira como almacenamiento de producción. No asumas que Hostinger incluye PostgreSQL: usá un proveedor compatible o indicá una alternativa concreta si el plan cambia.

## Autenticación y cuentas con contraseña asignada

El propietario asigna un email y una contraseña inicial distinta a cada admin/cliente. No hay registro público ni emails de alta o recuperación. Los emails son identificadores de login. Las contraseñas y los secretos deben existir **solo en el backend**, nunca en .env del frontend, NEXT_PUBLIC_*, HTML, JavaScript, JSON público o GitHub.

Usá como contrato los ejemplos dummy de `docs/env/backend.env.example`, `internal.env.example` y `client.env.example` del repo interno. Escribí `.env.example` reales y documentados en cada repo; el usuario reemplazará los valores a mano al desplegar. Los ejemplos son:

```text
Admin:   admin@example.invalid   / Dummy_Admin_Cambiar_2026!
Cliente: cliente@example.invalid / Dummy_Cliente_Cambiar_2026!
```

Solo un comando administrativo de aprovisionamiento lee `BOOTSTRAP_USERS_JSON` del .env privado del backend para crear usuarios ausentes. Guardá hashes **Argon2id**, nunca contraseñas en texto plano en la DB. No ejecutes ese comando automáticamente en cada arranque; no sobrescribas hashes, no reactives cuentas y no restaures contraseñas iniciales al redeployar. Detectá duplicados y roles/clientId inválidos. El seed de desarrollo crea `cliente-demo` antes del bootstrap dummy; en producción asigná un cliente existente o crealo mediante un comando explícito. Eliminá el secreto de bootstrap después de aprovisionar en producción. Proporcioná un comando seguro para crear o rotar credenciales de usuarios nuevos; un cambio posterior en .env por sí solo no debe resetear cuentas.

La contraseña inicial debe cambiarse en el primer acceso, invalidando las sesiones previas. Implementá cambio autenticado de contraseña y recuperación por intervención del admin; no agregues SMTP. En producción rechazá valores dummy, secretos débiles, cookies inseguras y modo demo habilitado. Para desarrollo usá un nombre de cookie sin prefijo __Host- cuando `SESSION_SECURE=false`; ese prefijo requiere Secure en producción.

Implementá sesiones opacas aleatorias con almacenamiento en DB, expiración, revocación y rotación al autenticar. Guardá un hash del token de sesión. Cookie HttpOnly, Secure en producción, Path=/, sin Domain; SameSite=Lax cuando las tres aplicaciones estén bajo el mismo dominio registrable. Los fetch autenticados usan `credentials: 'include'`.

Para producción proponé `interno.dominio.com`, `www.dominio.com` para el cliente y `api.dominio.com` apuntando a Render. Así evitamos depender de cookies de terceros entre github.io y onrender.com. No prometas que SameSite=None soluciona Safari: Pages se usa para revisar el frontend con ejemplos. Si se exige probar autenticación desde orígenes distintos, documentá y probá esa configuración o implementá un gateway del mismo sitio.

Validá Origin y un token CSRF para mutaciones; CORS permite únicamente los orígenes configurados, nunca '*' con credenciales. CORS no sustituye autenticación. Rate limit persistente para login y endpoints sensibles, errores de login genéricos, límites de tamaño, validación estricta de entradas, consultas parametrizadas, cabeceras de seguridad y logs sin contraseñas ni tokens. Configurá trust proxy según el hosting real; no confíes indiscriminadamente en X-Forwarded-For.

No se necesita Cloudflare Pro para esto. HTTPS, sesiones, autorización y validación deben funcionar por sí mismos. Cloudflare puede ser una capa adicional futura.

## Roles y aislamiento por cliente

Roles iniciales: `admin` y `client`. El admin opera prospectos, lotes, proyectos, cobros, abonos, metas, calendario y bitácora. Un cliente accede solamente a sus proyectos y sus actualizaciones publicadas.

Todas las consultas de cliente filtran por el `clientId` de la sesión en el servidor. No confíes en un clientId enviado por el navegador. Cambiar un ID en una URL no debe permitir ver o modificar otro cliente. No uses el código ECL-xxx como contraseña. Los DTO públicos se construyen con listas permitidas de campos; no serialices el registro interno completo.

Quedan internos los prospectos, lotes, calculadoras, informes, márgenes, cobros detallados, MRR, metas personales, calendario privado, bitácora administrativa y notas internas. El cliente puede ver etapas, hitos, entrega estimada, acciones que le pedimos y actualizaciones publicadas. Conservá los importes públicos que el diseño actual del portal ya muestre, después de revisar sus tipos. Definí explícitamente `internalNote` y `publicBody`; los datos de cobros internos no entran en la timeline del cliente.

## Modelo de datos y reglas a conservar

Diseñá migraciones para usuarios, clientes, sesiones, prospectos, eventos de prospectos, lotes, señales e informes, proyectos, historial de etapas, hitos, acciones del cliente, actualizaciones, cobros, abonos, metas, subtareas, eventos de calendario, audit_log y registros de comunicación manual por WhatsApp. Usá relaciones, claves únicas e índices para búsquedas, ownership y orden cronológico. Guardá dinero en unidades mínimas enteras o Decimal; nunca floats para sumas financieras. Conservá USD y las unidades Eclipse del frontend.

Las cinco etapas son Preparación → Construcción → Revisión de Eclipse → Revisión del cliente → Entrega, con estados adicionales Soporte, En pausa y Cerrado. Se crea un proyecto al registrar seña, en una transacción que incluye proyecto, cobro y primer avance. La seña no supera el total, el hito no antecede al inicio y la entrega estimada no antecede al hito. Conservá cierre entrega → saldo → referido en 48 h → Soporte con mantenimiento o Cerrado. Mantener la cadencia de lotes configurable y las reglas de propuestas/toques del módulo actual; no reescribir reglas sin pruebas equivalentes.

Las metas personales conservan subtareas: completar todas completa la meta; reabrir una o agregar un pendiente la reabre. Su vínculo a un proyecto no las publica automáticamente al cliente. El calendario integra las metas, hitos y vencimientos, con eventos editables y detección de solapamientos. Cinco ítems por página en las agendas y listas que ya tienen paginado.

Para toda actividad o mutación persistí `occurredAt` en UTC, `recordedAt` desde reloj del servidor, zona horaria, actor y entidad. Las fechas de planificación siguen siendo días locales. Diferenciá hora prevista del hito y hora de registro. Ordená las timelines del más antiguo al más reciente, con un desempate estable por ID/orden de creación. Preservá los datos antiguos sin hora con «Hora no registrada»; no inventes timestamps históricos.

El audit_log lo crea el servidor en la misma transacción que la mutación. No aceptes actor ni recordedAt del frontend. Protegé registros de auditoría contra edición por endpoints normales. Documentá los límites de integridad: no prometas que un log en una DB bajo control del admin es criptográficamente inalterable. Usá control de concurrencia (versión/updatedAt) y claves de idempotencia para evitar doble seña o cobro al repetir una solicitud.

## API y conexión de ambos frontends

Creá OpenAPI y un contrato versionado `/api/v1`, con validación compartida o DTOs explícitos. Como mínimo:

```text
POST /auth/login               GET /auth/me
POST /auth/logout              POST /auth/password
GET/POST /admin/clients        POST /admin/users (sin devolver contraseñas persistidas)
GET/POST/PATCH /admin/prospects, /admin/batches, /admin/projects
POST /admin/projects/:id/advance, /pause, /resume, /deliver
POST /admin/projects/:id/updates, /milestones, /client-actions
GET/POST/PATCH /admin/payments, /admin/subscriptions
GET/POST/PATCH/DELETE /admin/goals, /admin/calendar-events
PATCH /admin/goals/:id/steps/:stepId
GET /admin/agenda              GET /admin/audit
POST /admin/import/preview     POST /admin/import/commit
GET /admin/export
GET /client/projects          GET /client/projects/:id
GET /client/projects/:id/updates
GET /health (estado básico, sin configuración ni datos privados)
```

Los comandos de etapas, cobros y subtareas deben estar validados en el servidor. Los endpoints de cliente no aceptan mutaciones administrativas. Si necesitás otros endpoints para conservar una función existente, agregalos y documentalos. Paginación, filtros y límites de consulta aplicados en servidor; respuestas y errores uniformes.

En el portal interno introducí un repositorio/adaptador de datos, una sesión de admin y estados de carga/error. Adaptá las mutaciones actuales a llamadas de API que se esperan con await; solo mostrás éxito después de confirmar persistencia. No hagas fallback silencioso a localStorage cuando falle la API: eso hace creer que un cambio se sincronizó. Conservá un modo demo explícito separado, únicamente para Pages y desarrollo, con ejemplos ficticios. La API de producción nunca acepta datos demo como credenciales.

El .env del frontend interno solo contiene PUBLIC_API_BASE_URL, PUBLIC_PORTAL_MODE, PUBLIC_CLIENT_PORTAL_URL y PUBLIC_WHATSAPP_MODE. Como hoy no hay build, implementá un pequeño paso que genera `public-config.json` o un módulo de configuración desde esa lista permitida; no publiques .env ni copies todas las variables del proceso. En Eclipse-Web usá únicamente NEXT_PUBLIC_* para URLs y flags públicos. El email y password que se escriben en la pantalla de login se envían al backend por HTTPS, no se comparan contra valores del bundle.

En Eclipse-Web reemplazá fixtures de producción por fetch autenticados y estados de sesión, carga, vacío y error. Protegé las rutas y verificá `/auth/me` antes de cargar proyectos. Logout limpia la UI y revoca la sesión. Un 401 devuelve al login. Los datos reales no deben quedar en el bundle exportado ni en páginas estáticas. No uses tokens en localStorage.

## WhatsApp manual como único canal de comunicación

No implementes email, Nodemailer, SMTP, plantillas de correo, magic links por email ni credenciales de proveedores de correo. Mantené la comunicación con clientes por WhatsApp, iniciada por el admin.

Permití guardar un teléfono en formato internacional E.164 por cliente y preparar texto para hito, actualización, acción o cambio de etapa. El admin revisa el destinatario y el mensaje antes de abrir `https://wa.me/<número>?text=<texto codificado>`. Incluí el enlace del portal del cliente y la información publicada correspondiente; nunca notas internas, contraseñas ni tokens de sesión. Para teléfonos argentinos documentá cómo ingresarlos correctamente, sin agregar prefijos por suposición.

Abrir WhatsApp no significa que el mensaje se envió o se entregó. Registrá `prepared` / `opened` como estados comprobables; si el admin confirma manualmente «Enviado», almacenalo como una declaración manual con fecha, hora y actor, sin inventar comprobante de entrega. Sin WhatsApp Business API, webhooks, bots ni automatizaciones no solicitadas. Prepará el diseño para un proveedor futuro, pero no lo agregues ahora.

## Migración desde localStorage y respaldos

Implementá importación administrativa de respaldos v1/v2/v3 con preview y validación antes de guardar. Conservá IDs y relaciones, timestamps existentes, subtareas realizadas y eventos completados. Asigná explícitamente los proyectos importados a clientes: los respaldos actuales no tienen ownership real. La importación es transaccional e idempotente, con reporte de registros rechazados y sin sobrescribir datos existentes por defecto. Exportá un respaldo antes de migrar y no borres localStorage hasta comprobar el resultado. No trates un campo example del JSON como prueba de que el usuario quiso importar datos ficticios; hacé visible esa condición.

## Despliegue y operación

Entregá instrucciones ejecutables para desarrollo, staging y producción. El backend usa process.env.PORT y escucha en 0.0.0.0; maneja apagado ordenado, conexiones DB y errores sin filtrar secretos. Scripts de build/start, migraciones y bootstrap separados. `.env` siempre ignorado por Git; `.env.example` contiene solo dummy. Nunca subir .env a public_html ni a GitHub Pages.

Ruta A actual: repo backend preferentemente privado, conectado a Render mediante permisos de GitHub; Web Service Node y PostgreSQL persistente compatible, TLS y dominio api.dominio.com. Frontends estáticos en Hostinger apuntando a ese dominio. Documentá build/start reales y orden de migraciones, variables, DNS y prueba de salud. No despliegues producción ni cargues credenciales reales sin autorización para esas acciones.

Ruta B si se mejora el plan: Node.js App en Hostinger Business/Cloud, GitHub privado o ZIP, variables privadas del backend en el panel y DB persistente compatible. Los exports estáticos de los frontends van a sus propios sitios. Verificá disponibilidad del runtime y límites del plan antes de afirmar compatibilidad.

Un repo privado protege acceso al código fuente. Una API HTTPS pública es necesaria para que los navegadores la consuman y debe rechazar solicitudes no autorizadas. La DB no se expone directamente al navegador. Si se opta por un backend privado en red, requiere un gateway/BFF público autenticado; no puede consumirse directamente desde un frontend estático. No uses una API key compartida en el frontend para «ocultar» la API. Proporcioná backups y un procedimiento probado de restauración; no guardes la DB en el disco efímero de Render.

## Validación y entregables

Probá login/logout, expiración y revocación, cambio inicial de contraseña, no reseteo de cuentas al redeploy, rate limit, CSRF, autorizaciones admin/client y aislamiento de al menos dos clientes. Probá ID de proyecto ajeno, mutación administrativa desde cliente y que cobros/notas internas no aparecen en DTOs de cliente. Probá importación v1/v2/v3, doble click/idempotencia en cobros, cronología con horas y sin horas antiguas, subtareas y reapertura, y conservar reglas financieras.

Recorrido completo en navegador: admin inicia sesión → crea cliente/proyecto con seña → publica hito/actualización → cliente inicia sesión y ve solo su proyecto → admin prepara WhatsApp y abre enlace → cliente cierra sesión y pierde acceso. Revisá ambos temas y móvil/tablet/escritorio. Verificá el bundle y los exports de ambos frontends para confirmar que no contienen contraseñas, SESSION_SECRET, DATABASE_URL, bootstrap ni datos privados.

Entregá código funcional en los tres repositorios, migraciones, OpenAPI, ejemplos de entorno, scripts reproducibles, pruebas pasadas y README de despliegue. Abrí PRs sin mergear y reportá límites reales y tareas operativas pendientes. El resultado debe poder ejecutarse localmente con datos dummy y quedar listo para que el propietario configure los valores reales y despliegue a mano.

---

Ver también [decisión de hosting y configuración](hosting.md).
