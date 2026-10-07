# Backend, hosting y credenciales de Eclipse

Decisión actual: **WhatsApp manual**, sin email ni SMTP. El sitio de esta PR sigue siendo estático y con localStorage. El [prompt del backend](backend-prompt.md) define la implementación futura; los ejemplos de entorno todavía no se consumen por el código actual.

## Qué permite Hostinger

La captura de hPanel compartida por el propietario indica que su plan actual no permite ejecutar el backend Node.js. La documentación oficial permite Node.js en **Business Web Hosting y Cloud**, además de VPS. Se puede alojar un backend allí después de mejorar el plan; el hosting actual puede seguir sirviendo los frontends estáticos. Tener una casilla o un plan llamado «Unlimited» no habilita por sí solo un proceso Node.js.

Fuente: [opciones de Node.js en Hostinger](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/), consultada el 7 de octubre de 2026. Confirmar las prestaciones concretas en hPanel antes de contratar o cambiar de plan.

## Opción recomendada con el plan actual

| Parte | Alojamiento | Qué contiene |
|---|---|---|
| Portal interno | Hostinger estático; Pages para revisión con ejemplos | UI, login y URL pública de API |
| Portal del cliente / sitio público | Hostinger, export estático de Eclipse-Web | UI pública, login y datos obtenidos tras autenticación |
| Backend Node.js | Render Web Service | Sesiones, autorización, reglas y API |
| Base de datos | PostgreSQL persistente compatible | Usuarios con hashes, proyectos, cobros, metas y auditoría |

Para probar puede usarse Render gratuito, contemplando su arranque tras inactividad. Para producción se recomienda un servicio sin suspensión y una base persistente con backups. Render gratuito pierde archivos locales al reiniciar/redeployar y su PostgreSQL gratuito **expira a los 30 días**. No almacenar la operación real en SQLite local o en esa base temporal. [Límites oficiales de Render gratuito](https://render.com/docs/free).

Usar subdominios del mismo dominio registrable, por ejemplo `interno.tudominio.com`, `www.tudominio.com` y `api.tudominio.com` (el último apunta a Render), simplifica el manejo de cookies. Pages en `github.io` se reserva para la demostración visual; autenticarlo contra `onrender.com` puede depender de cookies de terceros y fallar en algunos navegadores.

## Repos privados, API pública y datos privados

La privacidad del repo controla quién ve el código fuente. No controla quién puede pedir una URL de la API. Hostinger admite despliegue desde repos privados mediante integración GitHub en sus planes Node.js: [guía oficial, comparación GitHub/ZIP](https://www.hostinger.com/tutorials/how-to-deploy-a-codex-app/).

Los navegadores necesitan alcanzar la API HTTPS. Una API accesible públicamente debe verificar sesión, rol y propiedad del proyecto en **cada solicitud**. Sin sesión, responde 401; sin permisos, 403 o 404 sin filtrar datos. El cliente A no obtiene proyectos del cliente B cambiando un ID. La DB se mantiene accesible solo desde el backend. Rate limits, validación y CSRF complementan estas verificaciones; CORS y una URL difícil de adivinar no reemplazan permisos.

También puede existir un servicio backend privado, pero exige un gateway público autenticado para los frontends. [Servicios privados de Render](https://render.com/docs/private-services). Para esta primera versión alcanza una API pública autenticada y una DB protegida. No hace falta Cloudflare Pro para implementar estas bases; no existe una garantía de «imposible de vulnerar» por elegir un repo privado.

## Qué editar en los entornos

| Archivo de ejemplo | Dónde se usa después de implementar | Valores |
|---|---|---|
| [backend.env.example](env/backend.env.example) | `.env` privado del backend o variables del panel | DB, secreto de sesión, orígenes y bootstrap admin/cliente dummy |
| [internal.env.example](env/internal.env.example) | Configuración del frontend interno | URL pública de API, portal del cliente y flags |
| [client.env.example](env/client.env.example) | `.env.local` de Eclipse-Web | Variables NEXT_PUBLIC_* con URL pública de API y flags |

Las contraseñas **no van en ningún frontend**, aunque el repo sea privado: el navegador descarga ese código. Un .env no convierte en secreta una variable usada en el bundle; NEXT_PUBLIC_* se publica expresamente. El frontend interno actual no lee .env. Su futuro build generará configuración pública desde una lista permitida, sin copiar el archivo de secretos.

Los ejemplos dummy son `admin@example.invalid / Dummy_Admin_Cambiar_2026!` y `cliente@example.invalid / Dummy_Cliente_Cambiar_2026!`, exclusivamente en el contrato del backend. Al implementar, se aprovisionan una vez y se guardan hashes en la DB. Cambiar el .env posteriormente no debe recrear cuentas ni sobrescribir sus contraseñas. La contraseña inicial se cambia al entrar y las altas/rotaciones posteriores se hacen con un comando administrativo o una pantalla protegida.

## Despliegue después de implementar

1. Crear la DB persistente, configurar conexión TLS y backups.
2. Conectar el repo privado del backend al proveedor. Configurar variables privadas, build, start y PORT según su documentación; ejecutar migraciones y bootstrap administrativo.
3. Configurar dominio `api.tudominio.com`, HTTPS y los dos orígenes permitidos. Probar health y login.
4. Configurar las URLs públicas de los frontends, construir/exportar y subir solo los artefactos estáticos a Hostinger. No subir `.env`, fixtures reales ni secretos a `public_html`.
5. Probar dos clientes distintos, roles, cierre de sesión, cambios desde el portal interno, backups/restauración y enlaces manuales de WhatsApp.

El backend todavía no está creado: los comandos exactos de build, migración y bootstrap deberán entregarse con su implementación, usando el prompt incluido.
