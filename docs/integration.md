# Integración con el backend (fase 8, etapa 1)

El portal interno tiene dos modos. Se elige al cargar, leyendo `public-config.json`:

| Modo | Cuándo | De dónde salen los datos |
|---|---|---|
| **demo** | No hay `public-config.json` (404), o `PUBLIC_PORTAL_MODE=demo`. Es lo que publica GitHub Pages. | `localStorage` de este navegador, con los ejemplos de siempre. Se muestra siempre la franja «Modo demostración · datos de este navegador». |
| **live** | `PUBLIC_PORTAL_MODE=live` con `PUBLIC_API_BASE_URL`. | **Solo el servidor** ([Eclipse-be](https://github.com/Toti-Gauna/Eclipse-be)). Nunca se cae a `localStorage`: sin sesión no se ve ni un dato. |

Si `public-config.json` existe pero es inválido, el portal **no** arranca en demo en silencio: muestra la configuración rota y no hace nada más.

`localStorage` se sigue usando únicamente para la preferencia de tema (`eclipse-theme`) y las marcas de «ya vi esto» de la interfaz. En live no se guarda ningún dato de la API, token ni valor CSRF en ningún storage (la prueba de navegador lo verifica).

## Variables públicas y `public-config.json`

No hay build: un único script de Node genera el JSON que lee el navegador, a partir de una **lista permitida** de cuatro variables `PUBLIC_*`. Nunca copia otras variables del entorno.

```bash
PUBLIC_PORTAL_MODE=live \
PUBLIC_API_BASE_URL=https://api.eclipse-business.com/api/v1 \
PUBLIC_CLIENT_PORTAL_URL=https://www.eclipse-business.com/es/portal \
PUBLIC_WHATSAPP_MODE=manual \
node scripts/build-public-config.mjs            # escribe public-config.json
node scripts/build-public-config.mjs --check    # solo valida
node scripts/build-public-config.mjs --out dist/public-config.json
```

| Variable | Valores | Regla |
|---|---|---|
| `PUBLIC_PORTAL_MODE` | `demo` (por defecto) · `live` | Cualquier otro valor (por ejemplo el viejo `api`) es un error. |
| `PUBLIC_API_BASE_URL` | URL de la API **con** `/api/v1`, sin `/` final | Obligatoria en `live`. `https` salvo `localhost`, `127.0.0.1` o `[::1]`. Sin usuario, parámetros ni fragmento. En `demo` no se publica ninguna URL. |
| `PUBLIC_CLIENT_PORTAL_URL` | URL | Opcional, mismas reglas de esquema. Reservada para los enlaces al portal del cliente (etapa 2). |
| `PUBLIC_WHATSAPP_MODE` | `manual` (por defecto) · `off` | WhatsApp es siempre manual: el portal arma el mensaje, nunca lo envía. |

Cualquier otra variable `PUBLIC_*` genera un aviso y se ignora. `public-config.json` está en `.gitignore`; `public-config.example.json` documenta la forma. La validación vive en `src/config-schema.js` y la usan el script y el navegador (`src/config.js`). Si `public-config.json` falta, el portal queda en demo; el workflow de Pages no lo genera, así que Pages publica solo la demostración.

## Dominios y cookies

Las cookies de sesión del administrador son `HttpOnly`, `SameSite=Lax`, con prefijo `__Host-` en producción. Viajan solo si la página y la API son del **mismo sitio**.

- Producción prevista: `eclipse-business.com` (sitio), `interno.eclipse-business.com` (este portal) y `api.eclipse-business.com` (API en Render). Comparten el dominio registrable: las cookies `SameSite=Lax` funcionan.
- El backend debe permitir el origen exacto del portal en `ADMIN_ALLOWED_ORIGINS` (subconjunto de `ALLOWED_ORIGINS`). El navegador manda el `Origin`; el portal no lo fabrica.
- **GitHub Pages ↔ Render (`*.github.io` ↔ `*.onrender.com`) es cross-site y NO está soportado en live**: los navegadores bloquean las cookies de terceros y el ingreso fallaría. Pages queda solo para la demostración. Si la configuración live apunta a una API de otro sitio, la pantalla de ingreso muestra un aviso.
- En local: servir el portal y la API bajo el **mismo nombre de host**. `http://localhost:4173` + `http://localhost:3100/api/v1` funciona; `localhost` + `127.0.0.1` son sitios distintos y no.

## Autenticación

Todas las llamadas llevan `credentials: "include"` y JSON. Los tokens de acceso (15 min) y de refresco viajan solo en cookies que JavaScript no puede leer.

1. `GET /auth/csrf` → `{csrfToken}` (cookie preauth de 10 min).
2. `POST /auth/admin/login {email, password}` con `X-CSRF-Token` preauth → `200 {mfaRequired:true, expiresAt}`. Solo se emite una cookie de desafío (5 min); todavía no hay sesión.
3. `GET /auth/csrf` de nuevo y `POST /auth/admin/login/mfa {code}` (seis dígitos) → `200 {admin:{id,email,permissions,mfa}, csrfToken}`. Ese `csrfToken` de sesión va en `X-CSRF-Token` de **todo** POST/PATCH autenticado. Vive solo en memoria.
4. Al recargar: `GET /auth/admin/me` restaura la sesión (necesita `auth:read`) y `GET /auth/admin/csrf` recupera el CSRF.
5. Un 401 en una llamada autenticada hace **un** `POST /auth/admin/refresh {}` compartido (varias llamadas simultáneas esperan el mismo refresh: rotarlo dos veces revoca la sesión) y **un** reintento. Si el refresh falla: se limpia la memoria y se vuelve al ingreso con el aviso «Tu sesión venció».
6. Un 403 en una escritura vuelve a pedir el CSRF una vez; si cambió, se reintenta (el servidor rechazó, no procesó).
7. «Cerrar sesión» llama `POST /auth/admin/logout {}` y siempre limpia el estado local, aunque el servidor no responda (en ese caso lo avisa).

Estados del ingreso: verificando · email y contraseña · código · no disponible (sin red o sin permiso). Errores específicos: credenciales incorrectas, desafío vencido, código ya usado, cuenta bloqueada (429 tras cinco códigos fallidos, 15 min). El campo del código usa `autocomplete="one-time-code"`.

El servidor limita los intentos: cada ingreso de administrador gasta **dos** de los `AUTH_LIMIT_MAX` por IP y ventana de 15 min (también cuentan registro, login de clientes, etc.). Un 429 se muestra con la espera sugerida (`Retry-After`) y nunca se reintenta solo.

## Cómo está armado

```
src/config-schema.js      validación de las variables públicas (compartida con el script)
src/config.js             lee public-config.json; demo si no existe, "invalid" si está roto
src/api/errors.js         ApiError { code, status, requestId, message(es) } y textos por código
src/api/client.js         fetch con cookies, CSRF, refresh single-flight, reintentos seguros, listAll() con tope
src/api/idempotency.js    claves UUIDv4: se reutilizan para el mismo envío, se renuevan para uno nuevo
src/live/index.js         controlador: une cliente, sesión, repositorio y módulos; submit() y runAction()
src/live/auth.js          puerta de acceso (login, código, restauración, expiración) y su pantalla
src/live/repository.js    datos del servidor en memoria: slices, carga única, abortar, refresh, suscripción
src/live/registry.js      registro extensible de módulos (contrato abajo)
src/live/adapters/        API ⇄ modelo de vista: common (dinero, fechas, etapas, textos), projects, payments, requests, outbound
src/live/modules/         un archivo por módulo: core, hoy, solicitudes, proyectos (+forms), cobros, pending, index
live.css                  estilos propios del modo live (mismos tokens que styles.css y workspace.css)
```

### Reglas de datos

- **Dinero**: centavos enteros en la API; dólares en la interfaz. `parseDollars("19.99")` trabaja con texto (nunca `19.99 * 100`). Se muestran centavos solo si existen.
- **Fechas**: la API usa días `YYYY-MM-DD`. El portal nunca inventa una hora: un cobro tiene día y se muestra «Hora no registrada». Las actualizaciones muestran la hora real en que el servidor las registró.
- **Etapas**: `preparation|build|eclipse_review|client_review|delivery|support` ⇄ `preparation|build|eclipseReview|clientReview|delivery|support`. Pausa y cierre son **estados** (`status`) del proyecto, no etapas: el portal los muestra como etapas «En pausa» / «Cerrado» y recuerda en qué etapa estaba.
- **IDs**: son los UUID del servidor. El «código» visible es `legacyReference` (ECL-NNN) o `#` + los 8 primeros caracteres del UUID.
- **Versiones**: toda edición envía `version`. Un 409 significa «esto cambió»: se marca todo como vencido, se vuelve a pedir lo de la pantalla, se avisa y el formulario queda abierto.
- **Texto del servidor**: siempre se escapa al dibujar (`esc()`); nunca `innerHTML` con datos de clientes.

### Escrituras

`live.submit(tipo, valores, …)` ejecuta la mutación registrada para ese tipo y devuelve una promesa. La interfaz muestra «Guardando…», **espera la confirmación del servidor**, vuelve a pedir lo que la mutación declaró con `h.touch()` y recién entonces cierra el formulario y muestra el éxito. Si falla: mensaje en español dentro del mismo formulario, que sigue abierto. Los reintentos del mismo envío usan la misma `Idempotency-Key` (alta de proyecto y cobros); si el usuario cambia algún dato, es otro envío y la clave se renueva. Con un corte de red durante un alta (resultado incierto) el reintento es seguro: o se registra una vez, o el servidor repite la respuesta original.

Solo hay un envío a la vez. Publicar una actualización o mostrar un hito al cliente exige una casilla de confirmación explícita (`confirm: true` en la API). Aceptar una solicitud no crea proyecto: es un paso aparte.

### Contrato del registro para sumar un módulo (etapa 2)

1. Crear `src/live/modules/<id>.js` con `export default { id, label, nav, status, permission, filters, slices, prepare, render, badge, wizards, modals, actions, mutations }` (cada campo está descrito en el encabezado de `src/live/registry.js`).
2. Agregar su `import` y su entrada en `src/live/modules/index.js` (la única línea compartida) y quitar su entrada de `pending.js` si existía.
3. **Slice**: `slices: { "leads": { permission: "leads:read", forbiddenValue: [], load: async ({ api, repo, signal }, clave) => adaptado } }`. Los datos se leen con `ctx.repo.get/data` y se piden con `ctx.repo.ensure(nombre, clave)` desde `prepare()`, nunca desde `render()`. Para paginar: `more()` y el botón `data-action="live-more"`.
4. **Pantalla**: `render(ctx, route)` devuelve HTML con `ctx.shell(...)`; usa `ctx.entryView(entry, { slice, key, label, render })` para cargando/error/reintento. Todo texto dinámico pasa por `ctx.esc`.
5. **Adaptador**: la conversión API ⇄ vista vive en `src/live/adapters/` (agregar un archivo; `common.js` tiene dinero, fechas y etiquetas) y los cuerpos hacia la API en `outbound.js` (validan y devuelven `{ body } | { error }`; se prueban en `tests/live-adapters.test.js`).
6. **Mutación**: `mutations: { "new-lead": async (valores, h) => { const body = unwrap(...); h.touch(["leads"]); await h.api.post(..., body, { idempotencyKey: h.idem(body) }); return { message: "Prospecto creado.", goto: "#prospectos/…" }; } }`. `h = { api, repo, can, scope, target, modal, touch, idem }`. Lanzar `FormError` para errores de validación locales.
7. **Formularios**: `wizards` (pantalla completa, misma forma que `generatorConfig`) y `modals` (`markup(ctx, modal)` con `ctx.modalShell(..., { live: true })`). Un botón abre un diálogo con `data-action="<tipo-de-modal>" data-id=… data-kind=…` (todo `data-*` llega al diálogo). Un botón directo usa `actions: { "<tipo>": async (ctx, { id, kind, button }) => ({ message, refresh: [[slice, clave]] }) }`.
8. **Navegación**: `nav: { order, area: "main" | "menu" }`; `status: "pending"` muestra una pantalla honesta sin datos de ejemplo. Los permisos faltantes atenúan la entrada y la pantalla explica qué permiso falta.
9. Agregar sus pruebas: adaptadores y cuerpos en Node (`tests/*.test.js`) y recorridos en `tests/live-browser.mjs`.

## Compatibilidad

Backend: **Eclipse-be OpenAPI 0.7.0** (`src/docs/openapi.json`), probado contra el servidor de pruebas `tests/e2e/server.ts` (`docs/e2e.md` del backend). Prueba del portal: `npm run test:live` (ver abajo).

| Área de la API | Endpoints usados en la etapa 1 |
|---|---|
| Sesión | `GET /auth/csrf`, `POST /auth/admin/login`, `POST /auth/admin/login/mfa`, `GET /auth/admin/me`, `GET /auth/admin/csrf`, `POST /auth/admin/refresh`, `POST /auth/admin/logout` |
| Catálogo | `GET /catalog/plans` (nombres de paquetes y piezas) |
| Solicitudes | `GET /admin/plan-requests` (+ `status`, `review`, `limit`, `cursor`), `GET /admin/plan-requests/:id`, `PATCH /admin/plan-requests/:id/review` |
| Proyectos | `GET/POST /admin/projects`, `GET/PATCH /admin/projects/:id`, `POST …/transition`, `POST …/members`, `POST …/members/:id/remove`, `GET …/audit`, `POST /admin/clients/lookup` |
| Hitos | `GET/POST …/milestones`, `PATCH …/milestones/:id`, `POST …/milestones/:id/visibility` |
| Actualizaciones | `GET/POST …/updates`, `PATCH …/updates/:id`, `POST …/publish`, `…/withdraw`, `…/resolve` |
| Alcance | `GET …/scope`, `POST …/change-requests`, `PATCH …/change-requests/:id`, `POST …/decision` |
| Cobros | `GET/POST …/payments`, `PATCH …/payments/:id`, `GET …/finance` |
| **No usados todavía** (etapa 2) | leads, batches, planner, reports, communications, documents, imports, issues (bloqueos/riesgos), organizaciones, auditoría global |

Permisos del administrador: la interfaz oculta o explica lo que la cuenta no puede hacer (`requests:read|review`, `projects:read|write`, `billing:read|write`, `updates:send`, `clients:read`) y un 403 se muestra con su causa. Las decisiones de seguridad siguen siendo del servidor.

## Estado de los módulos

| Sección | Etapa 1 | Detalle |
|---|---|---|
| Ingreso, sesión, cerrar sesión | Hecho | Login con MFA, restauración, refresh, expiración. |
| Solicitudes (nueva) | Hecho | Filtros por estado, paginación por cursor, detalle con estimación y mensaje, revisión (`requests:review`), «crear proyecto desde esta solicitud». |
| Proyectos | Hecho | Lista, ficha, alta con acuerdo + seña (idempotente), etapa, pausa/retomar/cierre, datos, hitos (crear, editar, completar con evidencia, mostrar/ocultar al cliente), actualizaciones y acciones del cliente (borrador → publicar con confirmación → retirar/resolver; notas internas), miembros, alcance y solicitudes de cambio, finanzas del servidor. |
| Cobros | Hecho | Alta (cobrado, comprometido, propuesto, mantenimiento), transiciones, anulación, libro global por período y estado. |
| Hoy | Hecho (etapa 2) | Agenda del sistema, metas y eventos de hoy, solicitudes, cobros comprometidos y los cinco números del servidor con definición, fuente y desglose de filas. Ver [integration-planner.md](integration-planner.md). |
| Calendario, Mi plan (metas), Herramientas | Hecho (etapa 2) | Metas con pasos, eventos por rango con choques de horario, calculadoras que crean metas y eventos reales. Ver [integration-planner.md](integration-planner.md). |
| Bitácora | Hecho con alcance parcial (etapa 2) | Junta la auditoría de los proyectos y prospectos recientes: la API no tiene bitácora global. Ver [integration-planner.md](integration-planner.md). |
| Prospectos | Hecho | Lista con filtros del servidor (búsqueda, etapa, responsable, fuente, tibios, acción vencida, fechas, duplicados) y «Cargar más» por cursor; ficha con historial (orden a elección), camino a la seña, regla de la casa calculada (llamada el mismo día → propuesta ≤24 h → toques +2/+5/+9), actividades con hora real opcional, etapa (pausa con motivo y revisión, perdido, reactivar), consentimiento, edición, anulación con motivo, duplicados (búsqueda al crear con confirmación y «duplicado de»), lote, auditoría, exportación CSV (`leads:export`), alta desde solicitud de plan y conversión en proyecto (`leads:write` + `projects:write` + `billing:write`, con `Idempotency-Key`). Importes con `billing:read|write`. |
| Lotes | Hecho | Lista, alta, edición (abiertos), D0 manual, señal, cierre con informe de tres líneas, sumar y sacar prospectos, métricas y recordatorios D+señal/D+cierre del servidor. El sistema no envía nada. |
| Importar el respaldo de la demo | Pendiente (etapa 2) | `POST /admin/imports` (`docs/imports.md` del backend). |
| Comunicaciones (WhatsApp manual, correo), documentos | Pendiente (etapa 2) | |

## Lo que el servidor no modela (y el portal no inventa)

- **Unidad Agency / Media / Market** de proyectos y cobros: sin filtro ni columna en live.
- **MRR y abonos, metas por bimestre**: sin tarjetas ni medidores. El **mantenimiento** sí existe como cobro `maintenance` (nunca baja el saldo).
- **Hora de un cobro**: el servidor guarda el día. «Hora no registrada».
- **Un único hito y una única acción del cliente por proyecto**: en live hay **varios** hitos y acciones; la ficha muestra el próximo hito pendiente y las acciones publicadas sin resolver.
- **Referido, entrega y saldo cobrado como etapas internas**: no existen. El proyecto pasa a Soporte o se cierra con un motivo.
- **Exportar respaldo**: en live descarga una copia de solo lectura de lo que el servidor devolvió y está en pantalla; no es un respaldo del sistema. «Cargar ejemplos», «Empezar en limpio» e «Importar» (reemplazar todo) no existen en live.

## Límites conocidos

- Las listas de proyectos no traen dinero ni nombre de la organización: el total y el saldo de cada fila salen de `GET …/finance`, uno por proyecto (concurrencia 3, tope de 500 proyectos en la lista). Cobros junta los pagos proyecto por proyecto (los primeros 60). Con más proyectos conviene un endpoint de pagos global.
- Los miembros de un proyecto y el cliente de una solicitud se identifican por un id corto de cuenta: la API no devuelve su email ni su nombre. Para autorizar a alguien se busca por email exacto (`clients:read`).
- Los 400 del servidor no dicen qué campo falló: el portal valida antes de enviar con las mismas reglas.
- Una solicitud ya usada para un proyecto no se marca como tal en la bandeja (la lista de proyectos no trae `sourcePlanRequestId`); un segundo intento termina en 409.
- La sesión admin vive en memoria del servidor (una instancia): un reinicio o un redeploy cierra la sesión y hay que volver a ingresar.

## Brechas del backend detectadas (sin parches: se trabajó alrededor)

| Qué | Esperado | Real | Sugerencia |
|---|---|---|---|
| Lista de proyectos | Datos para mostrar una fila completa | `GET /admin/projects` no trae dinero, nombre de la organización, `startedOn`, `reviewOn` ni `sourcePlanRequestId` | Opción `include=finance,organization` o un resumen agregado |
| Cobros globales | Un libro de pagos con filtros por período/estado | Solo `GET /admin/projects/:id/payments` (N pedidos); sin unidad Agency/Media/Market | `GET /admin/payments?from&to&status&cursor` |
| Quién es el cliente | Email o nombre de la cuenta en miembros y solicitudes | Solo `clientId` | Devolver `{email, displayName}` en miembros y en la solicitud (con `clients:read`) |
| Errores 400 | Campo y motivo | `{"code":"BAD_REQUEST","message":"Bad request"}` | `details: [{field, reason}]` sin datos sensibles; hoy el portal duplica las validaciones |
| Servidores e2e que comparten base | Cada uno entrega sus correos | La clave de cifrado de la cola de correo es aleatoria por proceso: el otro proceso reclama la fila y falla con `INVALID_OUTBOX_PAYLOAD`, así que a veces el correo de verificación nunca llega | Clave fija por variable de entorno en `tests/e2e/server.ts`, o un esquema por instancia |
| Límite de credenciales | — | 50 intentos / 15 min por IP, y cinco fallos de una cuenta la bloquean 15 min (también con la clave correcta): las pruebas repetidas se bloquean solas | Variable para subirlo en el servidor e2e |
| Límite general | — | 120 req/min por IP; abrir Cobros o Proyectos con muchos proyectos abiertos dispara un pedido por proyecto | Resolver con los endpoints agregados de arriba (el portal ya usa caché de 5 min y tope de 40–60 proyectos) |

## Pruebas

```bash
npm test                      # unitarias (Node): cliente de API, config, adaptadores, repositorio, planificación
npm run test:browser          # demo: recorridos completos con datos de ejemplo (sin servidor)
# live: servidor e2e del backend + portal servido en el origen admin permitido
python3 -m http.server 4173 &
E2E_API=http://localhost:3100 E2E_PORTAL=http://localhost:4173 npm run test:live
```

`test:live` se saltea con un aviso si faltan `E2E_API` o `E2E_PORTAL` o si el servidor no responde. Ingresa con MFA, revisa una solicitud real, crea un proyecto con seña por la interfaz (probando el reintento con la misma `Idempotency-Key`), registra cobros, mueve la etapa, publica una actualización y verifica el saldo, los permisos recortados, el refresh de sesión y el cierre de sesión. Guarda capturas en `test-results/live/`. Usa `CHROMIUM_PATH=/ruta/al/chromium` para un navegador ya instalado. El servidor limita 50 intentos de credenciales por 15 min y por IP, y bloquea la cuenta 15 min tras cinco fallos: la prueba provoca un solo fallo por corrida y consume unos 12 intentos, así que no conviene correrla más de tres veces seguidas.
