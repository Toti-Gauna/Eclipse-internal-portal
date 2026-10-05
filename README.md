# Eclipse · Operaciones

Prototipo estático de la superficie interna de operaciones de Eclipse. El repo estaba vacío, así que la interfaz usa módulos nativos del navegador y no agrega un framework ni dependencias de build.

## Ejecutar localmente

Desde esta carpeta, inicia un servidor estático:

```bash
python3 -m http.server 4173
```

Abre `http://localhost:4173`. La navegación usa fragmentos (`#today`, `#contacts`, `#projects`, `#activity`, `#documents`, `#help`) para funcionar en hosting estático.

## Alcance de esta demo

- Todos los registros son ficticios y viven en `src/mock/adapter.js`.
- No hay API, autenticación, base de datos, envío de mensajes, almacenamiento de archivos ni persistencia comercial.
- Las acciones de publicación y conversión solo muestran una simulación en memoria; no cambian la visibilidad del cliente ni crean proyectos.
- `localStorage` se usa únicamente para recordar si se cerró el onboarding.
- No desplegar ni cargar datos reales: GitHub Pages es público en la configuración actual del repositorio.

El contrato tipado para una API futura está en `src/contracts.ts`; las reglas de integración y permisos, en [`docs/backend-contract.md`](docs/backend-contract.md).

La licencia existente se conserva sin cambios.
