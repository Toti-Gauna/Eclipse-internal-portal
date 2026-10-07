# Eclipse · Operación interna

Portal interno de Eclipse para una sola persona. Aplica las reglas de **Contexto Eclipse** (Notion) y te dice qué toca hoy. Es HTML + JS nativo: sin framework ni build.

**Diseño:** usa el mismo sistema visual que el portal de clientes de [Eclipse-Web](https://github.com/Toti-Gauna/Eclipse-Web): tokens dawn/ink/corona, Geist, Geist Mono e Instrument Serif (en `assets/fonts`, licencia OFL), el glifo de fase de eclipse para las etapas, el ledger, el cronograma y la bitácora. **Los proyectos usan las mismas cinco etapas que ve el cliente** (Preparación → Construcción → Revisión de Eclipse → Revisión del cliente → Entrega, más Soporte, En pausa y Cerrado). Cada cambio de etapa, hito, acción pedida al cliente y actualización es lo que después se publica en su portal.

El modo oscuro es el predeterminado. El botón de sol/luna guarda la preferencia de este navegador. La carga reutiliza la animación de Eclipse-Web: eclipse, corona y wordmark, con la misma duración, posibilidad de saltear y variante para movimiento reducido.

## Ejecutar

```bash
python3 -m http.server 4173
```

Abrí `http://localhost:4173`.

## Secciones

| Sección | Para qué |
|---|---|
| **Hoy** | Metas personales, eventos y acciones operativas pendientes, con cinco ítems por página. Cobrado vs meta, MRR y los cinco números de los últimos siete días. |
| **Mi plan** | Desde **Planificar** en el header: elegir una acción pendiente o escribir una meta propia, definir fecha, hora, prioridad y subtareas. Se completa al terminar todos los pasos; desmarcar uno la reabre. Permite editar, eliminar y vincular metas a la operación. |
| **Calendario** | Mes nativo, selección de día, filtros y agenda paginada. Integra metas, hitos, vencimientos y eventos. Permite agendar, editar y completar llamadas, reuniones y bloques de foco; avisa de coincidencias de horarios. |
| **Prospectos** | Pipeline con la próxima acción calculada: responde → llamada el mismo día → propuesta ≤24 h → toques +2 / +5 / +9. Pausar pide causa y fecha de revisión. |
| **Lotes** | Generador de enfoque, demo y cadencia. Objetivo de contactos e hipótesis. D0 envío · señal y cierre configurables (por defecto +2 / +7), con informe de tres líneas. |
| **Proyectos** | Se crean solo al cobrar la seña. Las 5 etapas del cliente, próximo hito, acción del cliente y actualizaciones. Después de la entrega: cobro de saldo → referido en 48 h → Soporte (con mantenimiento) o Cerrado. |
| **Cobros** | Cobros por bimestre y unidad, reparto 40/40/10/10, abonos mensuales (MRR). |
| **Herramientas** | Calculadoras de ventas necesarias, propuestas según conversión, capacidad semanal (20% prospección / 70% proyectos / 10% margen) y reparto de cobros. Accesos para llevar los resultados al plan y al calendario. |
| **Bitácora** | Actividades con fecha y hora de ocurrencia, instante de carga y zona horaria. El historial de cada proyecto y prospecto va del más antiguo al más reciente. |

**Mi plan**, **Herramientas**, **Bitácora** y **Datos y respaldos** también están en el menú de tres puntos del header. Las altas de prospectos, lotes, proyectos, cobros, abonos, metas y eventos, además de hitos, actualizaciones y acciones del cliente, usan pantallas completas con pasos y revisión final. Los datos se guardan al confirmar.

Las reglas viven en `src/rules.js` (funciones puras, sin DOM). Las metas por bimestre (B1–B3, por unidad) y el hito de MRR están en `src/data/seed.js` → `SETTINGS`.

La lógica de planificación y fechas está en `src/planner.js`; los generadores en `src/generators.js`; las pantallas nuevas en `src/workspace-ui.js`. `workspace.css` extiende el sistema visual con tokens semánticos para los dos temas. El sitio sigue funcionando sin npm, framework ni build.

## Datos

- Se guardan en `localStorage` de **este navegador**. Desde **Datos** podés exportar o importar un respaldo `.json`, cargar los ejemplos o empezar en limpio. Los datos de la versión anterior se migran solos.
- La primera carga trae ejemplos con la forma real de la operación. Ningún nombre corresponde a un cliente real.
- Handy no está acá: tiene su propio sistema.
- No cargues datos sensibles de clientes si el sitio se publica en un hosting público (GitHub Pages lo es).

Los respaldos v1/v2 se normalizan a v3 sin agregar metas ni eventos ficticios a tus datos existentes. Se conserva la clave `eclipse-ops-v2` para mantener el almacenamiento actual. Los registros antiguos sin hora muestran **Hora no registrada**. Las fechas operativas siguen siendo días locales; los registros nuevos también guardan instantes UTC y zona horaria. La bitácora local permite revisar movimientos; su integridad y el acceso entre dispositivos dependerán del futuro backend.

## Verificación

Para las pruebas, con Node 22 o superior:

```bash
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

Las pruebas de navegador levantan su propio servidor local. Se puede usar un Chromium instalado con `CHROMIUM_PATH=/ruta/a/chromium`. Cubren metas y reapertura, persistencia, paginación, generadores, validaciones, calendario, auditoría, exportación/importación y desbordes en 375 / 768 / 1024 / 1440 px. Las capturas quedan en `test-results/`.

GitHub Actions ejecuta las verificaciones en las PRs. Pages incluye los tres estilos y el arranque de la carga, y versiona estilos y módulos para evitar caché obsoleta. [Revisión visual](docs/visual-review.md).

## Próximo backend y despliegue

Está listo el [prompt para conectar ambos portales con backend y DB](docs/backend-prompt.md), con [opciones de hosting y credenciales](docs/hosting.md) y [ejemplos dummy de entorno](docs/env/). Son documentación para la implementación futura; esta versión sigue guardando datos en el navegador. Los frontends no deben contener contraseñas ni secretos. El canal de comunicación acordado es **WhatsApp manual**, sin emails.

La decisión confirmada es mantener los frontends en Hostinger, usar **Render para la API** por ahora y **Neon PostgreSQL para la DB**, en un proyecto separado de Handy. Está incluido el [paso a paso de Neon y Render](docs/neon-render-setup.md). La privacidad del repo no sustituye autenticación y permisos de la API.
