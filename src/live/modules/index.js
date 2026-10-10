// Lista de módulos del modo live. Para sumar uno (etapa 2): crear src/live/modules/<id>.js con el contrato de registry.js
// y agregar su import y su entrada acá. Es la única línea compartida: nada más se toca.
import core from "./core.js";
import hoy from "./hoy.js";
import solicitudes from "./solicitudes.js";
import proyectos from "./proyectos.js";
import cobros from "./cobros.js";
import planner from "./planner.js";
import prospectos from "./prospectos.js";
import lotes from "./lotes.js";
import pending from "./pending.js";

export const MODULES = [core, hoy, solicitudes, proyectos, cobros, ...planner, prospectos, lotes, ...pending];
