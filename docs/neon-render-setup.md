# Eclipse: paso a paso de Neon y Render

Decisión del 7 de octubre de 2026: **backend Node.js en Render**, **PostgreSQL en Neon**, frontends en Hostinger y **WhatsApp manual** para comunicaciones. Handy mantiene su infraestructura separada. No se crea una base Render Postgres para Eclipse.

Esta guía prepara la infraestructura. El backend todavía debe implementarse con el [prompt incluido](backend-prompt.md); crear el proyecto de Neon no crea las tablas del portal, sus usuarios ni conecta los frontends automáticamente.

```mermaid
flowchart LR
  A["Portal interno · Hostinger"] -->|"HTTPS + sesión"| C["API Eclipse · Render"]
  B["Portal cliente · Hostinger"] -->|"HTTPS + sesión"| C
  C -->|"Postgres + TLS"| D["DB Eclipse · Neon"]
```

## 1. Elegir región y entorno

Antes de crear los recursos, elegí la región del backend en Render y una región cercana en Neon; si ambos ofrecen Virginia, es una combinación inicial razonable. Compará las opciones reales de los dos paneles. La distancia relevante para consultas es Render ↔ Neon. La región de un servicio Render no se cambia después de crearlo.

Podés comenzar con planes gratuitos para pruebas. Render Free se suspende después de 15 minutos sin tráfico; Neon puede suspender su cómputo por inactividad según la configuración. Eso puede sumar latencia al primer acceso. La suspensión de cómputo en Neon no borra la DB. Revisá las cuotas, almacenamiento y ventana de recuperación de tu plan antes de cargar la operación real; no asumas que un plan gratuito ofrece backups ilimitados ni disponibilidad constante.

Fuentes: [servicios Render](https://render.com/docs/web-services), [límites Free](https://render.com/docs/free), [regiones Render](https://render.com/docs/regions), [Neon: scale to zero](https://neon.com/docs/introduction/scale-to-zero).

## 2. Crear el proyecto de Neon

1. Entrá a [console.neon.tech](https://console.neon.tech) y creá tu cuenta o iniciá sesión.
2. Elegí **New Project** y colocá `eclipse` como nombre.
3. Elegí la región definida en el paso 1.
4. Dejá habilitado **Postgres database**. Usá una versión estable compatible con el ORM; no necesitamos cambiar la versión después de crear las migraciones.
5. No habilites Neon Auth, Data API, Functions ni otros servicios para esta primera versión: la autenticación y la API viven en el backend Render.
6. Presioná **Create project**.
7. Anotá el nombre del proyecto, región, versión Postgres y nombre de la rama inicial. Según el flujo puede llamarse `production` o `main`; identificá esa rama como producción, sin adivinar su nombre.

Fuente: [crear y administrar proyectos Neon](https://neon.com/docs/manage/projects).

## 3. Crear la base `eclipse` y separar pruebas

1. En el proyecto, abrí **Branches** y seleccioná la rama inicial.
2. Desde la sección **Databases** de esa rama, creá una base llamada `eclipse`; usá el rol propietario que ya generó Neon, habitualmente `neondb_owner`. Si el panel cambia, buscá la opción para crear una base dentro de la rama.
3. No borres `neondb` para hacer espacio: puede quedarse sin uso. Copiá las conexiones para `eclipse`, no para la base equivocada.
4. Antes de cargar datos reales, creá una rama de desarrollo/pruebas llamada `staging` desde la rama inicial todavía vacía. Cada rama tiene su propio endpoint.
5. Usá `staging` para desarrollar el esquema, probar migraciones y usar cuentas dummy. La rama de producción queda para datos reales.

Las ramas clonan esquema y datos del padre por defecto. Si el padre ya tiene datos reales, usá una rama de **solo esquema**, si está disponible, o un proyecto separado con datos ficticios. No copies clientes ni sesiones reales a pruebas por comodidad. No resetees una rama con información que querés conservar. Las migraciones SQL del repo se aplican a producción; no se «mergean» filas desde staging.

Fuentes: [ramas Neon](https://neon.com/docs/introduction/branching), [ramas de solo esquema](https://neon.com/docs/guides/branching-schema-only).

## 4. Obtener las dos conexiones

En Neon, abrí **Connect** y elegí explícitamente la rama, el compute, la base `eclipse` y el rol. Para comenzar el desarrollo, elegí `staging` y su propietario; antes de producción separaremos el rol de la app.

1. Activá **Connection pooling** y copiá la URL: el hostname contiene `-pooler`. Es la conexión de la aplicación, llamada `DATABASE_URL`.
2. Desactivá el toggle y copiá la conexión directa, sin `-pooler`. La llamaremos `DATABASE_URL_UNPOOLED`; es para Prisma CLI, migraciones y backups.
3. Conservá los parámetros TLS que entrega Neon, como `sslmode=require`; no desactives la validación de certificados.
4. Guardá las URLs en un gestor de secretos o en el `.env` privado del backend. No las pegues en Notion, GitHub, screenshots ni variables del frontend.

Ejemplos **dummy**, no conexiones reales:

```dotenv
# App: pooled. En producción usará el rol limitado eclipse_app.
DATABASE_URL="postgresql://eclipse_app:Dummy_DB_Cambiar_2026@ep-eclipse-dummy-pooler.us-east-1.aws.neon.tech/eclipse?sslmode=require"

# CLI: directa. El rol propietario aplica las migraciones.
DATABASE_URL_UNPOOLED="postgresql://neondb_owner:Dummy_Migracion_Cambiar_2026@ep-eclipse-dummy.us-east-1.aws.neon.tech/eclipse?sslmode=require"
```

No armes el hostname a mano ni cambies solo el nombre de la rama en una URL: copiá el endpoint correcto de cada rama. La contraseña de la DB es distinta de las contraseñas admin/cliente del portal.

Fuente: [pooling y conexión directa](https://neon.com/docs/connect/connection-pooling).

## 5. Comprobar que estás en la DB correcta

En **SQL Editor**, seleccioná `staging` y `eclipse`, y ejecutá:

```sql
SELECT current_database() AS database_name,
       current_user AS database_role,
       now() AS server_time;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

La primera consulta debe mostrar `eclipse`. La segunda puede estar vacía: todavía no se aplicó el esquema del backend. No pegues un modelo de usuarios arbitrario en el editor ni cargues passwords en texto plano para «activar» el login.

## 6. Configurar Prisma y generar el esquema del backend

Este paso se hace **cuando Eclipse-Backend tenga código, schema y migraciones**. Los comandos no se ejecutan en el repo del frontend.

La guía actual de Neon usa **Prisma 7** y Node **22.12 o superior** dentro de la rama 22. Fijá versiones compatibles de CLI, cliente y adapter en el lockfile; no uses un `latest` que pueda instalar un prerelease. En esa versión, el CLI usa la conexión directa en `prisma.config.ts`; el adapter de la aplicación usa `DATABASE_URL`. Este es el contrato del archivo, sin secretos:

```typescript
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: env('DATABASE_URL_UNPOOLED') },
});
```

El schema de Prisma 7 declara `provider = "postgresql"`; no copies una configuración antigua con `url` / `directUrl` dentro del datasource. El backend debe configurar el Prisma Client con el adapter compatible, sus transacciones y un pool acotado; no abrir un cliente nuevo por cada request.

En desarrollo, con ambas URLs apuntando a **staging** y el schema definido:

```bash
npm ci
npx prisma validate
npx prisma migrate dev --name init
npx prisma generate
npm run build
```

Revisá y versioná los archivos SQL en `prisma/migrations`. Si las migraciones iniciales ya existen, no generes otra `init`: aplicá las que entrega el backend. `migrate dev` puede necesitar permisos para una shadow database; usá el propietario del entorno de desarrollo o una shadow DB de pruebas explícita, nunca la DB de producción.

Para staging desplegado y producción, aplicá migraciones ya revisadas con:

```bash
npx prisma migrate deploy
npx prisma migrate status
```

Esas órdenes deben correr con `DATABASE_URL_UNPOOLED` del entorno correspondiente. No usar `migrate dev`, `migrate reset` o `db push` en producción. La creación de cuentas se hace después con el comando de bootstrap administrativo que debe implementar el backend; no en cada deploy. Los passwords se guardan como hashes y los dummy quedan solo en staging.

Fuentes: [Prisma con Neon](https://neon.com/docs/guides/prisma), [migraciones Prisma en Neon](https://neon.com/docs/guides/prisma-migrations).

## 7. Separar el rol de aplicación en producción

El propietario de la DB se usa para migrar y administrar. El proceso HTTP usa un rol `eclipse_app` con permisos limitados. **Los roles creados desde la consola/API/CLI de Neon reciben privilegios administrativos**; creá el rol limitado por SQL y asigná permisos explícitos.

El siguiente ejemplo se ejecuta en la base `eclipse` como propietario **después de las migraciones**, usando una contraseña real generada y sin publicar el script con ese valor. Sustituí `neondb_owner` si tu propietario tiene otro nombre:

```sql
CREATE ROLE eclipse_app LOGIN PASSWORD 'Dummy_DB_Cambiar_2026';
GRANT CONNECT ON DATABASE eclipse TO eclipse_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO eclipse_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO eclipse_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eclipse_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eclipse_app;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO eclipse_app;

-- Después de que exista el esquema del backend:
REVOKE INSERT, UPDATE, DELETE ON TABLE public._prisma_migrations FROM eclipse_app;
```

La línea con Dummy es solo un ejemplo; no crear una cuenta de producción con esa contraseña. La app no necesita permisos de crear tablas, crear roles o borrar bases. Los permisos de tablas de auditoría se afinan con el esquema definitivo: la app puede agregar auditoría, pero no actualizarla ni borrarla. Las tablas nuevas de auditoría también deben recibir esos permisos específicos en sus migraciones.

Para obtener la URL runtime de `eclipse_app`, usá una herramienta que permita elegir ese rol SQL; si la consola no lo ofrece, conservá host/base/parámetros del endpoint y sustituí solo credenciales mediante un gestor local que codifique usuario y password como componentes de URL. No elimines TLS ni imprimas el resultado. Guardá la URL pooled limitada en `DATABASE_URL`; dejá la directa del propietario para migraciones.

Fuente: [roles y privilegios Neon](https://neon.com/docs/manage/roles).

## 8. Conectar Render con Neon

1. En [dashboard.render.com](https://dashboard.render.com), elegí **New → Web Service** y conectá el repo `Eclipse-Backend`, preferentemente privado.
2. Runtime **Node**, nombre `eclipse-api`, región elegida en el paso 1 y rama de código destinada al entorno.
3. Una vez que el backend incluya los scripts definidos en el prompt, el build propuesto es `npm ci --include=dev && npx prisma generate && npm run build`; el start es `npm start`.
4. En **Environment** agregá las dos URLs de Neon del entorno correcto, `NODE_ENV=production`, secreto de sesión aleatorio, `SESSION_SECURE=true`, `SESSION_COOKIE_NAME=__Host-eclipse_session`, los dos orígenes permitidos y `WHATSAPP_MODE=manual`. No cargues los passwords dummy del portal en producción.
5. El servidor escucha en `0.0.0.0` y usa `process.env.PORT`. No hardcodear un puerto ni crear Render Postgres.
6. Configurá `/health` como health check básico. El backend debe agregar un chequeo privado de readiness que consulte Neon, sin publicar URLs, usuarios ni detalles de la DB.

En un servicio Render **de pago**, usá `npx prisma migrate deploy` como **Pre-Deploy Command**, antes de iniciar la nueva versión. En **Free** ese paso no está disponible: para las pruebas corré las migraciones de forma administrativa desde tu máquina o una CI protegida, con la URL directa correcta, antes del despliegue manual. No ejecutes bootstrap ni migraciones en cada arranque HTTP. En producción, la credencial administrativa usada por pre-deploy permanece privada; una fase posterior puede moverla a una CI separada para que el runtime solo reciba la credencial limitada.

Un despliegue staging requiere un servicio o un deploy de prueba conectado a la rama Neon staging. Nunca uses las URLs de producción en previews de PRs. Los cambios de datos en Neon no se publican al hacer merge de una PR de código.

Fuentes: [Web Services Render](https://render.com/docs/web-services), [Pre-Deploy Command](https://render.com/docs/deploys#pre-deploy-command).

## 9. Validar persistencia y conectar ambos portales

Después de implementar el backend:

1. Iniciá sesión como admin y creá un cliente, un proyecto con seña y una actualización usando la API protegida.
2. Verificá las filas en Neon y que `/admin/...` rechaza una sesión cliente.
3. Reiniciá/redeployá Render y comprobá que los datos siguen presentes en Neon.
4. Entrá como cliente y comprobá que ve su proyecto, nunca el de un segundo cliente, notas internas, cobros privados ni secretos.
5. Exportá un respaldo del localStorage antes de importar la operación existente; asigná cada proyecto a un cliente y revisá el preview de importación. No borres el respaldo ni el almacenamiento local hasta verificar la migración.
6. Configurá `api.tudominio.com` en Render, `interno.tudominio.com` para operación y el portal cliente bajo `www.tudominio.com` en Hostinger. Las URLs concretas deben corresponder a tus dominios reales.
7. En los frontends colocá solo la URL HTTPS de API y flags públicos; **ninguna URL de Neon**. Sesiones HttpOnly, cookies Secure, CORS exacto y protección CSRF quedan en el backend.

GitHub Pages continúa como revisión con ejemplos. Las rutas de proyecto del frontend Next exportado deben admitir IDs nuevos creados en runtime: si el export no puede resolver `[id]` sin `generateStaticParams`, implementá una ruta estática de detalle con ID por query y fetch autenticado. No prerenderizar datos de clientes para fabricar páginas individuales.

## 10. Configurar recuperación y backups

1. En **Settings → Postgres**, revisá **History window** y anotá la retención real que permite tu plan. Las páginas y planes cambian; verificá el valor configurado, no una duración supuesta.
2. Antes de una migración de producción, generá un dump con una conexión **directa** y almacenalo cifrado fuera del filesystem efímero de Render. Usá herramientas Postgres de versión compatible con el servidor.
3. Probá restaurar el dump en una base de restauración vacía y separada, con datos de prueba primero. Nunca pruebes un restore sobre producción.

Ejemplo de contrato de script, con la conexión ya cargada en una variable privada por un gestor de secretos; no pegar la URL en el historial del shell ni usar `set -x`:

```bash
pg_dump --dbname="$DATABASE_URL_UNPOOLED" --format=custom --no-owner --no-acl --file=eclipse-backup.dump
pg_restore --dbname="$RESTORE_DATABASE_URL_UNPOOLED" --no-owner --no-acl --exit-on-error eclipse-backup.dump
```

El dump no crea roles; prepará los roles de destino y sus permisos antes de restaurar, verificá conteos y login, y documentá cómo volver a apuntar el backend a la base recuperada. Guardá backups fuera de Git/Notion y con acceso restringido; no contienen solamente el esquema. Estos comandos no se ejecutaron en esta tarea.

Fuentes: [estrategias de backups Neon](https://neon.com/docs/manage/backups), [dump/restore](https://neon.com/docs/import/migrate-from-postgres).

## Checklist para cerrar el setup

- [ ] Proyecto Neon y región seleccionados.
- [ ] Base `eclipse` y rama staging identificadas.
- [ ] Conexiones pooled y directas guardadas como secretos del backend.
- [ ] Migraciones del backend aplicadas y `migrate status` correcto.
- [ ] Runtime con rol limitado y credencial de migración separada.
- [ ] Render conecta a Neon y los datos sobreviven a un redeploy.
- [ ] Admin y dos clientes probados con aislamiento.
- [ ] Ambos frontends apuntan a la API, sin secretos de Neon.
- [ ] Respaldo e importación de localStorage revisados.
- [ ] Ventana de recuperación y restauración de backup verificadas.

La decisión y esta guía se guardan en Notion. Los recursos reales, credenciales y despliegue quedan pendientes de implementación y configuración por el propietario.
