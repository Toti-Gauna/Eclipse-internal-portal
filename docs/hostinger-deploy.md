# Portal interno real en Hostinger

El workflow **Deploy internal portal to Hostinger** publica exclusivamente
`/home/u902414219/domains/interno.eclipse-business.com/public_html`, la carpeta
confirmada por SSH. No modifica la raíz de `eclipse-business.com`, su portal de
clientes, la API de Render ni las tablas de Neon.

El código sigue siendo HTML/JS estático. El navegador llama a la API real; no hace
falta un proceso Node.js en Hostinger. GitHub Pages conserva la demostración.

## Configuración pública del artefacto

GitHub Actions ejecuta los tests y prepara `_site/` mediante
`node scripts/prepare-hostinger.mjs`. Solo copia el HTML, todos los CSS del portal,
`src/` y `assets/`, y agrega el `.htaccess` del hosting y estos cuatro valores:

```json
{
  "mode": "live",
  "apiBaseUrl": "https://api.eclipse-business.com/api/v1",
  "clientPortalUrl": "https://eclipse-business.com/portal/",
  "whatsappMode": "manual"
}
```

No se incluyen `.env`, dependencias, tests, docs ni secretos del backend. Los
módulos y estilos llevan la versión del commit para evitar caché vieja en Safari;
HTML, configuración y marcador de despliegue usan `Cache-Control: no-store`.
El artefacto contiene también `live-comms.css`, `live-crm.css` y `planner.css`,
incluidos los estilos cargados dinámicamente.

## Preparar GitHub una vez

Los secrets de un repositorio no se heredan de otro. En **Eclipse-internal-portal →
Settings → Secrets and variables → Actions → Secrets**, crear dos **Repository
secrets** con los mismos contenidos ya verificados para el hosting de la web:

| Secret | Contenido |
| --- | --- |
| `HOSTINGER_SSH_KEY` | La clave privada completa `~/.ssh/eclipse_hostinger_actions`, incluidas BEGIN/END. |
| `HOSTINGER_KNOWN_HOSTS` | La entrada verificada de `[185.239.210.183]:65002` en `~/.ssh/known_hosts`. |

La clave privada se copia directamente del editor de Codespaces al secret. No
compartirla por chat ni capturas. La `.pub` ya registrada en Hostinger no sirve
como clave privada. Usar el Codespace original que contiene esos archivos; un
Codespace nuevo no los tiene automáticamente. No hace falta otra clave en
Hostinger mientras se use el mismo usuario SSH.

Para abrir los archivos desde el Codespace original, fuera de la sesión SSH:

```bash
code ~/.ssh/eclipse_hostinger_actions
ssh-keygen -F '[185.239.210.183]:65002' -f ~/.ssh/known_hosts > /tmp/eclipse_hostinger_known_hosts
code /tmp/eclipse_hostinger_known_hosts
```

En **Actions → Variables**, crear la variable de repositorio
`HOSTINGER_DEPLOY_ENABLED=true` cuando estén listos ambos secrets. El workflow
valida su presencia y la identidad del servidor sin desactivar la verificación.

## Primera publicación y siguientes

1. El sitio separado `interno.eclipse-business.com` y su certificado HTTPS deben
   existir en Hostinger. La carpeta inicial contiene `default.php`; no hace falta
   borrarlo: `DirectoryIndex index.html` prioriza el portal nuevo.
2. El backend debe permitir `https://interno.eclipse-business.com` tanto en
   `ALLOWED_ORIGINS` como en `ADMIN_ALLOWED_ORIGINS`, con autenticación y MFA
   activadas. Esto ya se configuró durante el despliegue de la API.
3. Fusionar la PR después de pasar los checks. Un push a `main` publica si la
   variable está activada. Si se configuró después de fusionar, ejecutar
   **Actions → Deploy internal portal to Hostinger → Run workflow → main**.
4. Solo `main` puede publicar, incluso al lanzar una ejecución manual. Las PR
   verifican y empaquetan sin recibir las credenciales de despliegue.
5. El workflow comprueba el modo live, el commit publicado, los estilos/módulos,
   salud de la API y que `/auth/admin/me` exija sesión y permita el origen admin.
   No hace login ni crea datos. Una comprobación fallida restaura el respaldo.
6. Abrir `https://interno.eclipse-business.com` en Safari: debe mostrar el ingreso
   en dos pasos, sin banner de demostración ni datos de ejemplo. Ingresar con la
   cuenta admin de Render y el código vigente del autenticador. Ante el primer
   fallo real, detenerse y diagnosticar; no repetir intentos a ciegas.
7. Confirmar sesión al recargar y cierre de sesión. Los datos privados solo deben
   aparecer después de autenticar. Comprobar también que la web pública y
   `/portal/` siguen funcionando.

El certificado y el origen permitido no cambian los secretos de autenticación.
No agregar JWT, `ADMIN_ACCOUNTS_JSON`, contraseñas ni URLs PostgreSQL a este repo.

## Respaldo y recuperación

Cada release guarda el contenido anterior de la raíz, incluidos archivos ocultos,
en el directorio privado del subdominio `.eclipse-deploy/backups/<release>.tar.gz`.
Los archivos públicos se copian con modos 644 y directorios 755; los respaldos se
mantienen privados. Se conservan archivos ajenos al paquete. El script rechaza la
carpeta de la web pública, reglas `.htaccess` existentes no revisadas, enlaces
simbólicos y despliegues concurrentes. No usa `/dev/fd`, incompatible con la shell
enjaulada observada en Hostinger.

Si falla la copia o el chequeo público, se restaura el respaldo y se retiran solo
los archivos introducidos por esa release. Para volver manualmente a una copia
anterior, con el identificador indicado en el log:

```bash
ssh -p 65002 -i ~/.ssh/eclipse_hostinger_actions -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes u902414219@185.239.210.183 \
  'bash -s -- rollback /home/u902414219/domains/interno.eclipse-business.com/public_html IDENTIFICADOR_DE_RELEASE' \
  < scripts/hostinger-publish.sh
```

Staging y respaldos se conservan para recuperar versiones; revisar el espacio y
archivar o retirar versiones antiguas después de guardar una copia independiente.
Si una interrupción deja un lock, confirmar que no haya otra ejecución activa
antes de retirar exclusivamente `.eclipse-deploy/lock`. No borrar la raíz pública
ni usar el script del portal interno para restaurar el sitio público.

Esta publicación usa el `main` actual con la integración existente. La PR de
contratación permanece separada; no se aplican sus migraciones ni se habilita ese
módulo. SMTP sigue como estaba en Render y WhatsApp continúa siendo manual.
