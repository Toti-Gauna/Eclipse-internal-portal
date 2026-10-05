# Eclipse · Operación interna

Portal interno de Eclipse para una sola persona. Aplica las reglas de **Contexto Eclipse** (Notion) y te dice qué toca hoy. Es HTML + JS nativo: sin framework ni build.

**Diseño:** usa el mismo sistema visual que el portal de clientes de [Eclipse-Web](https://github.com/Toti-Gauna/Eclipse-Web): tokens dawn/ink/corona, Geist, Geist Mono e Instrument Serif (en `assets/fonts`, licencia OFL), el glifo de fase de eclipse para las etapas, el ledger, el cronograma y la bitácora. **Los proyectos usan las mismas cinco etapas que ve el cliente** (Preparación → Construcción → Revisión de Eclipse → Revisión del cliente → Entrega, más Soporte, En pausa y Cerrado). Cada cambio de etapa, hito, acción pedida al cliente y actualización es lo que después se publica en su portal.

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
| **Proyectos** | Se crean solo al cobrar la seña. Las 5 etapas del cliente, próximo hito, acción del cliente y actualizaciones. Después de la entrega: cobro de saldo → referido en 48 h → Soporte (con mantenimiento) o Cerrado. |
| **Cobros** | Cobros por bimestre y unidad, reparto 40/40/10/10, abonos mensuales (MRR). |

Las reglas viven en `src/rules.js` (funciones puras, sin DOM). Las metas por bimestre (B1–B3, por unidad) y el hito de MRR están en `src/data/seed.js` → `SETTINGS`.

## Datos

- Se guardan en `localStorage` de **este navegador**. Desde **Datos** podés exportar o importar un respaldo `.json`, cargar los ejemplos o empezar en limpio. Los datos de la versión anterior se migran solos.
- La primera carga trae ejemplos con la forma real de la operación. Ningún nombre corresponde a un cliente real.
- Handy no está acá: tiene su propio sistema.
- No cargues datos sensibles de clientes si el sitio se publica en un hosting público (GitHub Pages lo es).
