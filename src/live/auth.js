// Puerta de acceso del modo live: restaura la sesión al cargar y maneja el ingreso en dos pasos (contraseña → código).
// Estados (phase): checking → login | mfa | ready | unavailable. La contraseña nunca se guarda: se envía y se descarta.
import { ApiError } from "../api/errors.js";

export function createAuth({ api, onChange = () => {}, onReady = () => {}, now = () => Date.now() }) {
  const state = { phase: "checking", pending: false, error: null, notice: "", email: "", expiresAt: null, retryAfter: null };
  let attempt = 0;

  const emit = (patch) => { Object.assign(state, patch); onChange(state); };
  const describe = (error) => (error instanceof ApiError ? error.describe() : "Algo falló. Probá de nuevo.");

  async function start() {
    emit({ phase: "checking", pending: true, error: null });
    try {
      const admin = await api.restoreSession();
      if (admin) { emit({ phase: "ready", pending: false }); onReady(admin); } else emit({ phase: "login", pending: false });
    } catch (error) {
      // Sin red o permisos insuficientes: no es "no hay sesión". Se explica y se deja reintentar.
      emit({ phase: "unavailable", pending: false, error: describe(error) });
    }
  }

  /** Paso 1. Devuelve true si avanzó (código o sesión). */
  async function submitCredentials(email, password) {
    if (state.pending) return false;
    const mine = ++attempt;
    emit({ pending: true, error: null, notice: "", email: email.trim() });
    try {
      const result = await api.login(email.trim(), password);
      if (mine !== attempt) return false;
      if (result.mfaRequired) { emit({ phase: "mfa", pending: false, expiresAt: result.expiresAt, retryAfter: null }); return true; }
      emit({ phase: "ready", pending: false });
      onReady(result.admin);
      return true;
    } catch (error) {
      if (mine === attempt) emit({ pending: false, error: describe(error), retryAfter: error.retryAfter || null });
      return false;
    }
  }

  /** Paso 2. */
  async function submitCode(code) {
    if (state.pending) return false;
    if (state.expiresAt && Date.parse(state.expiresAt) < now()) {
      emit({ phase: "login", error: null, notice: "El desafío de ingreso venció (dura 5 minutos). Escribí tu email y contraseña otra vez.", expiresAt: null });
      return false;
    }
    if (!/^\d{6}$/.test(code)) {
      emit({ error: "El código tiene seis dígitos, sin espacios." });
      return false;
    }
    const mine = ++attempt;
    emit({ pending: true, error: null });
    try {
      const result = await api.verifyMfa(code);
      if (mine !== attempt) return false;
      emit({ phase: "ready", pending: false, expiresAt: null });
      onReady(result.admin);
      return true;
    } catch (error) {
      if (mine !== attempt) return false;
      // 404 = el desafío ya no existe (venció o se anuló por intentos): hay que empezar de nuevo.
      if (error instanceof ApiError && (error.status === 404 || (error.status === 401 && /venci/.test(error.message) && state.expiresAt && Date.parse(state.expiresAt) < now()))) {
        emit({ phase: "login", pending: false, error: null, notice: error.message, expiresAt: null });
      } else emit({ pending: false, error: describe(error), retryAfter: error.retryAfter || null });
      return false;
    }
  }

  function backToLogin() {
    attempt++;
    emit({ phase: "login", pending: false, error: null, notice: "", expiresAt: null });
  }

  /** La sesión se perdió estando adentro (refresh fallido): volver al ingreso con una explicación. */
  function expire(message = "Tu sesión venció. Ingresá de nuevo.") {
    attempt++;
    emit({ phase: "login", pending: false, error: null, notice: message, expiresAt: null });
  }

  async function logout() {
    emit({ pending: true });
    const result = await api.logout();
    attempt++;
    emit({ phase: "login", pending: false, error: null, notice: result.ok ? "Cerraste la sesión." : "Cerraste la sesión en este navegador, pero el servidor no confirmó la baja. Si compartís la computadora, esperá a que venza o avisá.", email: "", expiresAt: null });
    return result;
  }

  return { state, start, submitCredentials, submitCode, backToLogin, expire, logout };
}

export function renderAuthScreen(auth, { esc, phaseGlyph, icon, dark, config }) {
  const { phase, pending, error, notice, email, expiresAt } = auth;
  const until = expiresAt ? new Date(expiresAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
  const crossSite = config && config.sameSite === false;
  const errorBlock = error ? `<p class="form-error live-auth-error" role="alert" id="auth-error">${esc(error)}</p>` : `<p class="form-error live-auth-error" role="alert" id="auth-error"></p>`;
  const noticeBlock = notice ? `<p class="live-auth-notice pt-fine" role="status">${esc(notice)}</p>` : "";
  const busy = (label) => (pending ? `${esc(label)}…` : esc(label));
  let body;
  if (phase === "checking") {
    body = `<div class="live-auth-checking" role="status" aria-live="polite" aria-busy="true">${phaseGlyph(0.5, 32)}<p class="pt-h2">Verificando tu sesión…</p></div>`;
  } else if (phase === "unavailable") {
    body = `<h1 id="auth-title" class="display live-auth-title">No pudimos <em>conectar</em>.</h1>
      <p class="pt-company">${esc(error || "El servidor no respondió.")}</p>
      <div class="live-auth-actions"><button class="btn btn-ink" type="button" data-action="live-auth-retry">Reintentar</button></div>`;
  } else if (phase === "mfa") {
    body = `<span class="label">Paso 2 de 2 · segundo factor</span>
      <h1 id="auth-title" class="display live-auth-title">Tu código de <em>seis dígitos</em>.</h1>
      <p class="pt-company">Abrí tu app autenticadora y escribí el código vigente de ${esc(email || "tu cuenta")}.${until ? ` Tenés hasta las ${esc(until)}.` : ""}</p>
      <form class="pt-form live-auth-form" data-form="live-mfa">
        <div class="pt-field"><label for="auth-code">Código de la app</label>
          <input class="pt-input live-code-input readout" id="auth-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" required spellcheck="false" autocapitalize="off" aria-describedby="auth-error" data-autofocus ${pending ? "disabled" : ""}></div>
        ${errorBlock}${noticeBlock}
        <div class="live-auth-actions"><button class="btn btn-primary" type="submit" ${pending ? 'disabled aria-busy="true"' : ""}>${busy("Ingresar")}</button>
        <button class="btn btn-ghost" type="button" data-action="live-auth-back" ${pending ? "disabled" : ""}>Empezar de nuevo</button></div>
      </form>`;
  } else {
    body = `<span class="label">Paso 1 de 2 · cuenta</span>
      <h1 id="auth-title" class="display live-auth-title">Entrá a tu <em>operación</em>.</h1>
      <p class="pt-company">Acceso solo para la persona que opera Eclipse. La sesión se guarda en una cookie protegida del navegador, no en esta página.</p>
      <form class="pt-form live-auth-form" data-form="live-login">
        <div class="pt-field"><label for="auth-email">Email</label>
          <input class="pt-input" id="auth-email" name="email" type="email" autocomplete="username" required spellcheck="false" autocapitalize="off" value="${esc(email)}" aria-describedby="auth-error" data-autofocus ${pending ? "disabled" : ""}></div>
        <div class="pt-field"><label for="auth-password">Contraseña</label>
          <input class="pt-input" id="auth-password" name="password" type="password" autocomplete="current-password" required aria-describedby="auth-error" ${pending ? "disabled" : ""}></div>
        ${errorBlock}${noticeBlock}
        <div class="live-auth-actions"><button class="btn btn-primary" type="submit" ${pending ? 'disabled aria-busy="true"' : ""}>${busy("Continuar")}${pending ? "" : icon("arrow")}</button></div>
      </form>`;
  }
  const warning = crossSite ? `<p class="live-auth-warning pt-fine" role="note"><strong>Aviso:</strong> esta página y la API no comparten dominio. Los navegadores pueden bloquear las cookies de sesión y el ingreso fallaría. Mirá docs/integration.md.</p>` : "";
  return `<header class="pt-header"><div class="container-x pt-header-row">
      <a class="pt-brand" href="#hoy" aria-label="Eclipse">${phaseGlyph(1, 22)}<span class="pt-brand-name">ECLIPSE</span></a>
      <span class="pt-brand-label">Operación interna</span>
      <div class="pt-tools" style="margin-left:auto"><button class="hdr-link theme-toggle" type="button" data-action="theme-toggle" aria-label="${dark ? "Activar modo claro" : "Activar modo oscuro"}" title="${dark ? "Modo claro" : "Modo oscuro"}">${icon(dark ? "sun" : "moon")}</button></div>
    </div></header>
    <main id="main-content" class="pt-main" tabindex="-1"><div class="pt-light" aria-hidden="true"></div>
      <div class="container-x pt-page live-auth">
        <section class="live-auth-card ticks" aria-labelledby="auth-title">${phase === "checking" ? '<h1 id="auth-title" class="sr-only">Verificando tu sesión</h1>' : ""}${body}${warning}</section>
        ${config?.apiHost ? `<p class="live-auth-foot pt-fine">Servidor: <span class="readout">${esc(config.apiHost)}</span></p>` : ""}
      </div>
    </main><div class="toast-region" aria-live="polite"></div>`;
}
