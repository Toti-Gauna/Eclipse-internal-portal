# Contrato del backend futuro

Este documento acompaña a [`src/contracts.ts`](../src/contracts.ts). Define tipos de intercambio; no define endpoints ni implementa persistencia. La app actual usa únicamente [`src/mock/adapter.js`](../src/mock/adapter.js).

## Entidades

| Tipo | Responsabilidad | Campos de control |
| --- | --- | --- |
| `Lead` | Contacto entrante, canal/origen, necesidad, consentimiento, dueño y siguiente acción. | Estado comercial, consentimiento, `AccessScope`. |
| `Activity` | Línea cronológica de una entidad; los recordatorios son acciones humanas. | Actor, fecha, audiencia y permiso de lectura. |
| `Proposal` | Versión y estado comercial de una propuesta; no representa dinero recibido. | Moneda, importe opcional, estado, carácter hipotético y acceso. |
| `Project` | Registro operativo creado solo después del acuerdo/seña explícitos. | Etapa interna, proyección separada al cliente, responsable y referencias. |
| `ScopeVersion` | Alcance versionado, inclusiones, exclusiones y aceptación explícita. | Estado, actor/fecha de aceptación y cambio relacionado. |
| `Milestone` | Criterios de entrada/salida, responsable, fecha estimada y evidencia. | Visibilidad al cliente separada del estado interno. |
| `Risk` | Riesgo operativo, probabilidad/impacto, mitigación y dueño. | Estado y permisos. |
| `Blocker` | Causa, responsable, fecha de revisión y estado de un bloqueo. | Audiencia explícita; interno por defecto. |
| `Decision` | Resultado de una decisión y evidencia asociada. | Actor, fecha, audiencia y permisos. |
| `ChangeRequest` | Solicitud → evaluación de costo/plazo → oferta → aceptación explícita. | El trabajo adicional no se habilita antes de la aceptación. |
| `Artifact` | Documento/archivo por categoría, proyecto, versión y relación con hito/decisión. | Audiencia, estado de publicación e historial de corrección/retiro. |
| `PaymentRecord` | Prometido, facturado, cobrado o reintegrado. | Moneda, fecha recibida, referencia de acuerdo y acceso restringido. |
| `Notification` | Aviso interno programado para vencimiento, aprobación, bloqueo o hito. | Destinatario, canal y fechas de entrega/lectura. |
| `AuditEvent` | Registro inmutable de actor, objeto, acción y antes/después. | Audiencia y permiso de auditoría. |

## Acceso y audiencia

Todo recurso sensible tiene un `AccessScope`: audiencia (`internal` o `client`), organización/proyecto permitido y permisos requeridos. La autorización se decide en el servidor para cada lectura/escritura; la UI filtra contenido como defensa adicional, nunca como control de seguridad. El cliente no recibe notas internas, referencias de archivo privadas ni datos de otra organización. El backend debe aplicar mínimo privilegio, denegación por defecto y redacción de campos.

Roles candidatos: `owner_admin`, `sales`, `project_lead`, `tech_delivery` y `finance_viewer`. La matriz real de personas, roles y permisos queda pendiente de scoping. `finance_viewer` no implica escritura contable.

## Listas y filtros

Las listas aceptan `PageRequest<Filters>` con cursor opaco, límite acotado, orden explícito y filtros tipados. La respuesta `Page<T>` informa `hasMore` y `nextCursor`; `total` puede omitirse si calcularlo es costoso. Los filtros comunes incluyen consulta, estado, origen/canal, rubro, responsable, vencimiento, proyecto, categoría, audiencia, bloqueo e hito. El servidor aplica primero permisos y después búsqueda/filtros/paginación para evitar inferencias por conteos.

## Errores

Las operaciones devuelven `ApiResult<T>` con datos o un `ApiError` estable: `code`, mensaje seguro, HTTP status, errores por campo, `requestId` y si puede reintentarse. Estados esperados de UI: carga; vacío; falta de permisos (403 sin filtrar datos); error reintentable/no reintentable; éxito confirmado. Una respuesta parcial no debe tratarse como éxito para acciones sensibles.

## Reglas de transición

- Lead a proyecto: acuerdo aceptado y registro explícito de seña; `won` por sí solo no alcanza. Un registro de propuesta no equivale a un cobro.
- La actividad registra responsables y fechas. Respuesta → llamada el mismo día; propuesta ≤24 h; seguimientos +2/+5/+9 según configuración, sin envío automático.
- Un proyecto pausado requiere causa y fecha de revisión.
- Alcance adicional: solicitud → evaluación → impacto de costo/plazo → oferta → aceptación explícita → nueva versión.
- La audiencia inicial de archivos es interna. Publicación requiere previsualización, confirmación explícita y `AuditEvent`; corregir/retirar conserva historial.
- `USD cobrado` suma solo pagos con estado `received` y moneda USD, nunca promesas, propuestas ni facturas pendientes.

## Supuestos de esta demo

- La UI es una superficie interna independiente; no se agrega enlace a la navegación pública ni al portal de clientes.
- Las fechas e importes no se conectan a Contexto Eclipse; todos los registros visibles son sintéticos y las cinco cifras muestran `—`.
- Publicar, convertir, fusionar, pausar y crear cambios no producen efectos de negocio. No hay archivos reales ni enlaces públicos.
- El backend, autenticación, permisos reales, política de retención, hosting y sistema fuente de cada campo siguen fuera de este frontend.
