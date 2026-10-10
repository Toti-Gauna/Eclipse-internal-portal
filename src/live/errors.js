// Error de validación local: el formulario no se envía y se explica el problema. No es una falla del servidor.
export class FormError extends Error {
  constructor(message) {
    super(message);
    this.name = "FormError";
  }
}

/** Convierte el { body } | { error } de los constructores de cuerpos en un valor o una FormError. */
export function unwrap(result) {
  if (result.error) throw new FormError(result.error);
  return result.body;
}
