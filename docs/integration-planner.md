# Planificador, indicadores y bitácora (etapa 2, módulo B)

Pantallas: **Hoy** (`hoy.js`), **Mi plan** (`metas.js`), **Calendario** (`calendario.js`), **Herramientas** (`herramientas.js`) y **Bitácora** (`actividad.js`). Comparten `planner-shared.js` (slices del planificador, referencias y refresco tras escribir), `adapters/planner.js` (API → vista y cuentas sobre lo cargado) y `adapters/outbound-planner.js` (cuerpos hacia la API, con pruebas en `tests/live-planner.test.js`). Estilos propios en `planner.css`, que el módulo enlaza solo (no se toca `index.html`).

## Endpoints usados

| Pantalla | Endpoints | Permiso |
|---|---|---|
| Mi plan | `GET/POST /admin/planner/goals`, `PATCH …/goals/:id`, `POST …/goals/:id/steps`, `PATCH …/goals/:id/steps/:stepId` | `planner:read` / `planner:write` |
| Calendario | `GET/POST /admin/planner/events` (`from`, `to`, máx. 120 días), `PATCH …/events/:id`, `GET /admin/planner/agenda`; hitos y cobros con fecha salen de los slices `project.milestones` y `project.payments` que ya cargan Proyectos y Cobros | `planner:*`, `leads:read`, `projects:read`, `billing:read` (cada fuente se omite, con aviso, si falta el permiso) |
| Hoy | `GET /admin/planner/agenda`, metas y eventos de arriba, `GET /admin/reports/indicators`, `GET /admin/reports/indicators/:key/items` | `planner:read` o `leads:read`; `reports:read` (+ `leads:read` o `billing:read` para las filas) |
| Prospectos como referencia y para ponerle nombre a la agenda | `GET /admin/leads` (hasta 200, slice `planner.leads`) | `leads:read` |
| Bitácora | `GET /admin/projects/:id/audit`, `GET /admin/leads/:id/audit` | `projects:read`, `leads:read` |

## Reglas que el portal respeta

- Una meta con pasos se completa **sola** al terminar el último paso y se reabre si se reabre uno: lo decide el servidor y el portal solo muestra el resultado. A una meta sin pasos se la completa a mano. Una meta completa no admite pasos nuevos.
- Las metas y los eventos **no se borran**: se cancelan (queda «Cancelada» / «Cancelado»). El «eliminar» de la demostración pasó a «cancelar», con confirmación.
- Un evento puede no tener hora (todo el día); la duración exige hora y no puede cruzar la medianoche. Nunca se inventa una hora: los cobros y las filas de los indicadores muestran «Hora no registrada».
- **Choques de horario**: se calculan en el navegador sobre los eventos **cargados** (mismo día, mismo responsable, no cancelados). Como no es una garantía, al guardar el portal pide al servidor ese día completo y frena si hay un choque no confirmado («Agendar igual si coincide con otro evento»). Editar solo el título o las notas no vuelve a frenar.
- Cada mes se pide al navegar a él (la grilla del mes, 35–42 días) y se cachea 60 s; volver a un mes cargado no pide nada.
- Las metas personales las ve solo su dueño (el servidor responde 404 a los demás). «Mi plan» muestra por defecto las propias; «Del equipo» suma las compartidas.
- Los números de Hoy son los del servidor (`reports/indicators`), con su definición, su fuente, su zona horaria y la hora a la que se calcularon. Prometido, propuesto y cobrado se muestran **separados**. **No existen** en live las metas por bimestre, el MRR ni «cobrado vs. meta» (el servidor no los guarda): no hay tarjetas ni se calculan con datos locales. En Herramientas el monto a cubrir lo escribe la persona.
- Los envíos esperan la confirmación del servidor. Un corte durante un **alta** de meta o de evento deja el resultado como incierto y lo dice (no hay `Idempotency-Key` en el planificador: ver brechas).

## Bitácora: alcance

El backend no tiene una bitácora global. La pantalla junta la auditoría de los **6 proyectos y los 6 prospectos más recientes** de sus listas (20 registros cada uno, «Pedir registros más antiguos» sigue con el cursor de cada fuente) y lo explica en pantalla. Cada registro muestra el instante UTC que guardó el servidor, convertido a la zona del navegador; la API devuelve el actor solo como id de cuenta («Vos» si es la propia). No incluye metas, eventos, solicitudes, comunicaciones ni documentos (no hay auditoría legible de ellos), y sin `billing:read` el servidor omite los eventos de cobros y de presupuesto.

## Brechas del backend (sin parches: se trabajó alrededor)

| Qué | Esperado | Real | Cómo se trabajó |
|---|---|---|---|
| Bitácora global | `GET /admin/audit?cursor` con filtros | Solo auditoría por proyecto y por prospecto | Se junta la de los más recientes y se dice el alcance |
| Actor de un registro | Email o nombre | Solo `actorId` | «Vos» / «Administrador · cuenta xxxxxxxx» |
| Agenda de prospectos | Nombre del prospecto en cada ítem | Solo `id` y el texto de la acción (`detail` no sale en la respuesta) | Se cruza con `planner.leads` (hasta 200 prospectos); si no está, «Prospecto #id» |
| Altas del planificador | `Idempotency-Key` en `POST /goals` y `POST /events` | No existe | Un corte de red se informa como resultado incierto y no se reintenta solo |
| Un evento por id | `GET /admin/planner/events/:id` | Solo por rango | Un enlace directo a un evento que no está en el mes cargado no lo abre; Hoy y los formularios fijan antes el día del calendario |
| Filtro de metas | `GET /goals` sin tope | Tope de 500 sin paginación ni cursor | Se avisa por la lista; no hay más que hacer |
| Indicadores | Tipos de cada indicador en OpenAPI | `object` sin forma | Las formas se leyeron del servicio (`report.service.ts`) y están probadas |
| Cuerpos 400 | Campo y motivo | Genérico | Validaciones locales en español (como en etapa 1) |

## Pruebas

```bash
npm test                                   # incluye tests/live-planner.test.js (adaptadores, cuerpos, choques, rangos, indicadores, auditoría)
E2E_API=http://localhost:3202 E2E_PORTAL=http://localhost:4202 npm run test:live:planner
```

`test:live:planner` hace un solo ingreso, crea sus datos con una marca única (y cancela al empezar y al terminar sus metas y eventos de corridas anteriores) y recorre: meta con pasos que se completa y se reabre, edición y cancelación; eventos con choque de horario, completar, editar y cancelar; navegación de meses; Hoy con agenda real y los cinco números con desglose; calculadoras que crean una meta y un evento; Bitácora (incluido «Hora no registrada» simulado); 403 y corte de red simulados; permisos recortados sin escrituras; y capturas a 375 y 1440 px en tema oscuro y claro en `test-results/live-planner/`.
