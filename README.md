# Eclipse · Operación

Tablero operativo de Eclipse para una sola persona. Aplica las reglas de **Contexto Eclipse** (Notion) y te dice qué toca hoy. Es HTML + JS nativo: sin framework ni build.

## Ejecutar

```bash
python3 -m http.server 4173
```

Abrí `http://localhost:4173`.

## Secciones

| Sección | Para qué |
|---|---|
| **Hoy** | Cobrado del bimestre vs meta (con ritmo lineal y USD/semana necesarios), MRR vs 2.500, propuesto / por cobrar / cobrado separados, los 5 números de los últimos 7 días y la agenda de lo vencido y del día. |
| **Prospectos** | Pipeline con la próxima acción calculada: responde → llamada el mismo día → propuesta ≤24 h → toques +2 / +5 / +9. Pausar pide causa y fecha de revisión. |
| **Lotes** | D0 envío · D+2 señal · D+7 cierre con informe de 3 líneas (qué funcionó, qué no, qué cambio). |
| **Proyectos** | Se crean solo al cobrar la seña. Build → QA → entrega → cobro de saldo → referido en 48 h. |
| **Cobros** | Cobros por bimestre y unidad, reparto 40/40/10/10, abonos mensuales (MRR). |

Las reglas viven en `src/rules.js` (funciones puras, sin DOM). Las metas por bimestre (B1–B3, por unidad) y el hito de MRR están en `src/data/seed.js` → `SETTINGS`.

## Datos

- Se guardan en `localStorage` de **este navegador**. Desde **Datos** podés exportar o importar un respaldo `.json`, o volver a los ejemplos.
- La primera carga trae ejemplos con la forma real de la operación. Ningún nombre corresponde a un cliente real.
- Handy no está acá: tiene su propio sistema.
- No cargues datos sensibles de clientes si el sitio se publica en un hosting público (GitHub Pages lo es).
