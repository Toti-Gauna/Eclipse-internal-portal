// Módulos del planificador (etapa 2, B): Mi plan, Calendario, Herramientas y Bitácora. Hoy vive en hoy.js (etapa 1, ampliado).
// Un único archivo para sumar en index.js, así la integración con los otros módulos de la etapa 2 toca una sola línea.
import actividad from "./actividad.js";
import calendario from "./calendario.js";
import herramientas from "./herramientas.js";
import metas from "./metas.js";

export default [calendario, metas, herramientas, actividad];
