import { expect, Page } from '@playwright/test';
import { dismissBlockingOverlays, ensureHomepageReady } from './airbnb-scraper';
import { getAirbnbBaseUrl } from './airbnb-context';
import {
  getActionTimeoutMs,
  gotoAndSettle,
  waitForUiSettle,
} from '../../src/scraping/page-timing';
import { isTwoFactorModalVisible, passwordInput, submitTwoFactorCode, twoFactorHeading, passkeyLoginHeading, tryAnotherWayButton, emailCodeLoginOption, isOtpInputVisible } from './airbnb-2fa';
import { OTP_EMAIL_LOOKBACK_MS, waitForAirbnbOtp } from './composio-gmail';
import { authLog, maskEmail } from './auth-logger';
import { waitForSecurityChallengeIfPresent } from '../../src/scraping/security-challenge';
import {
  guestLoginMenuItem,
  headerProfileMenuButton,
  isLoggedInViaHeader,
} from './airbnb-header';

export const AUTH_SESSION_PATH = 'playwright/.auth/airbnb-session.json';

export type AirbnbCredentials = {
  email: string;
  password: string;
};

export type AccountAuthConfig = {
  accountId?: string;
  email: string;
  password: string;
  composioUserId?: string | null;
  composioConnectionId?: string | null;
  sessionPath?: string;
};

export function getCredentialsFromEnv(): AirbnbCredentials {
  const email = process.env.AIRBNB_EMAIL;
  const password = process.env.AIRBNB_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Missing AIRBNB_EMAIL or AIRBNB_PASSWORD. Copy .env.example to .env and fill in your credentials.',
    );
  }

  return { email, password };
}

export function resolveAccountAuthConfig(
  override?: Partial<AccountAuthConfig>,
): AccountAuthConfig {
  const fromEnv = getCredentialsFromEnv();
  return {
    email: override?.email ?? fromEnv.email,
    password: override?.password ?? fromEnv.password,
    accountId: override?.accountId,
    composioUserId: override?.composioUserId ?? process.env.COMPOSIO_USER_ID ?? null,
    composioConnectionId:
      override?.composioConnectionId ?? process.env.COMPOSIO_CONNECTION_ID ?? null,
    sessionPath: override?.sessionPath ?? AUTH_SESSION_PATH,
  };
}

async function openLoginModal(page: Page) {
  authLog('Paso 2/7', 'Cerrando modales que bloquean la UI');
  await dismissBlockingOverlays(page);

  authLog('Paso 2/7', 'Abriendo menú de usuario');
  await headerProfileMenuButton(page).click({ timeout: 10_000 });

  authLog('Paso 2/7', 'Seleccionando "Iniciar sesión"');
  await guestLoginMenuItem(page).click({ timeout: 10_000 });
  // Airbnb mantiene requests de analytics abiertas; esperar `networkidle` aquí
  // puede demorar el login aun cuando el modal ya está disponible.
  await page.waitForTimeout(750);
  // Proxy lento / Arkose a veces aparece en lugar del modal de login.
  await waitForSecurityChallengeIfPresent(page);
  await dismissBlockingOverlays(page);

  const loginModal = page
    .getByRole('dialog')
    .or(page.locator('[data-testid="modal-container"]'));

  try {
    await expect(loginModal.first()).toBeVisible({ timeout: getActionTimeoutMs() });
  } catch {
    authLog('Paso 2/7', 'Modal no visible — reabriendo menú de login');
    await dismissBlockingOverlays(page);
    await headerProfileMenuButton(page).click({ timeout: 10_000 });
    await guestLoginMenuItem(page).click({ timeout: 10_000 });
    await page.waitForTimeout(750);
    await waitForSecurityChallengeIfPresent(page);
    await expect(loginModal.first()).toBeVisible({ timeout: getActionTimeoutMs() });
  }

  authLog('Paso 2/7', 'Modal de login visible');
  return loginModal.first();
}

async function clickPrimaryContinue(page: Page) {
  const modal = page
    .locator('[data-testid="modal-container"]')
    .or(page.getByRole('dialog'))
    .first();

  const continueButton = modal.getByRole('button', {
    name: /^continuar$|^continúa$|^continue$/i,
  });

  authLog('Paso 3/7', 'Haciendo clic en Continuar (email)');
  await continueButton.waitFor({ state: 'visible', timeout: getActionTimeoutMs() });
  await continueButton.click({ timeout: getActionTimeoutMs() });
  await waitForUiSettle(page);
}

async function submitEmailStep(page: Page, email: string) {
  authLog('Paso 3/7', `Ingresando correo: ${maskEmail(email)}`);

  const modal = page
    .locator('[data-testid="modal-container"]')
    .or(page.getByRole('dialog'))
    .first();

  const emailWithButton = modal.getByRole('button', {
    name: /continúa con el correo electrónico|continue with email/i,
  });

  if (await emailWithButton.isVisible({ timeout: getActionTimeoutMs() / 3 }).catch(() => false)) {
    authLog('Paso 3/7', 'UI detectada: botón dedicado de correo electrónico');
    await emailWithButton.click();
    await modal
      .getByRole('textbox', { name: /correo electrónico|email/i })
      .fill(email);
  } else {
    authLog('Paso 3/7', 'UI detectada: campo unificado teléfono/correo');
    const unifiedInput = modal.getByRole('textbox', {
      name: /phone number or email|número de teléfono o correo|correo electrónico|email/i,
    });
    await unifiedInput.waitFor({ state: 'visible', timeout: getActionTimeoutMs() });
    await unifiedInput.fill(email);
  }

  await clickPrimaryContinue(page);
  return Date.now();
}

type PostEmailStep = 'password' | '2fa';

async function detectRateLimitOrBlock(page: Page): Promise<void> {
  const modal = page
    .locator('[data-testid="modal-container"]')
    .or(page.getByRole('dialog'))
    .first();
  const text = (await modal.innerText().catch(() => '')).slice(0, 800);
  if (/l[ií]mite de intentos|too many attempts|try again later/i.test(text)) {
    throw new Error(
      'Alcanzaste el límite de intentos para acceder a Airbnb. Espera 2–4 h antes de reintentar.',
    );
  }
}

/**
 * Tras ingresar el correo, Airbnb a veces muestra "¡Hola de nuevo!" con un botón
 * "Iniciar sesión" en lugar del campo de contraseña. Hay que pulsarlo primero.
 */
async function handleRememberedAccountIfPresent(page: Page): Promise<void> {
  const modal = page
    .locator('[data-testid="modal-container"]')
    .or(page.getByRole('dialog'))
    .first();

  const welcomeBack = modal.getByText(/hola de nuevo|welcome back/i);
  const notYouLink = modal.getByRole('link', { name: /no eres tú|not you/i });

  const isRemembered = await welcomeBack.isVisible({ timeout: getActionTimeoutMs() / 2 }).catch(() => false);
  if (!isRemembered) return;

  authLog('Paso 3b/7', 'UI detectada: cuenta recordada — pulsando Iniciar sesión');

  const loginButton = modal.getByRole('button', {
    name: /^iniciar sesión$|^log in$|^sign in$/i,
  });
  if (await loginButton.isVisible({ timeout: getActionTimeoutMs() / 2 }).catch(() => false)) {
    await loginButton.click({ timeout: getActionTimeoutMs() });
    await waitForUiSettle(page);
    return;
  }

  // Fallback: "¿No eres tú?" fuerza flujo completo de credenciales.
  if (await notYouLink.isVisible({ timeout: getActionTimeoutMs() / 4 }).catch(() => false)) {
    authLog('Paso 3b/7', 'Sin botón Iniciar sesión — usando "¿No eres tú?"');
    await notYouLink.click({ timeout: getActionTimeoutMs() });
    await waitForUiSettle(page);
  }
}

/**
 * Airbnb puede mostrar passkey ("clave de acceso") tras el correo. Hay que pulsar
 * "Intenta de otra forma" y luego "Recibe un código por correo electrónico".
 * Devuelve true si completó login por OTP de email.
 */
async function bypassPasskeyAndUseEmailCode(
  page: Page,
  composioUserId?: string | null,
  composioConnectionId?: string | null,
): Promise<boolean> {
  const passkeyVisible = await passkeyLoginHeading(page)
    .isVisible({ timeout: getActionTimeoutMs() / 2 })
    .catch(() => false);

  if (passkeyVisible) {
    authLog('Paso 4/7', 'UI detectada: modal passkey — pulsando Intenta de otra forma');
    await tryAnotherWayButton(page).click({ timeout: getActionTimeoutMs() });
    await waitForUiSettle(page);
  }

  const emailOptionVisible = await emailCodeLoginOption(page)
    .isVisible({ timeout: passkeyVisible ? getActionTimeoutMs() : getActionTimeoutMs() / 2 })
    .catch(() => false);

  if (!emailOptionVisible) return false;

  authLog('Paso 4/7', 'Seleccionando OTP por correo electrónico');
  const otpRequestedAt = Date.now();
  await emailCodeLoginOption(page).click({ timeout: getActionTimeoutMs() });
  await waitForUiSettle(page);

  await isOtpInputVisible(page, getActionTimeoutMs());
  await handleTwoFactor(
    page,
    otpRequestedAt - OTP_EMAIL_LOOKBACK_MS,
    composioUserId,
    composioConnectionId,
  );
  return true;
}

async function detectPostEmailStep(page: Page): Promise<PostEmailStep> {
  authLog('Paso 4/7', 'Detectando siguiente pantalla: contraseña o 2FA');

  const stepTimeout = getActionTimeoutMs();

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      authLog('Paso 4/7', `Reintento ${attempt + 1}/3 — esperando carga completa de la UI`);
      await waitForUiSettle(page);
    }

    const step = await Promise.race([
      passwordInput(page)
        .waitFor({ state: 'visible', timeout: stepTimeout })
        .then(() => 'password' as const),
      twoFactorHeading(page)
        .waitFor({ state: 'visible', timeout: stepTimeout })
        .then(() => '2fa' as const),
    ]).catch(() => null);

    if (step) {
      authLog(
        'Paso 4/7',
        step === 'password'
          ? 'Pantalla de contraseña detectada'
          : 'Modal 2FA detectado directamente (sin contraseña)',
      );
      return step;
    }
  }

  throw new Error(
    'Tras el correo no apareció ni el campo de contraseña ni el modal 2FA (conexión lenta: aumenta PLAYWRIGHT_SLOW_NETWORK=true o PLAYWRIGHT_ACTION_TIMEOUT_MS)',
  );
}

async function handleTwoFactor(
  page: Page,
  otpRequestedAt: number,
  composioUserId?: string | null,
  composioConnectionId?: string | null,
) {
  authLog('Paso 6/7', 'Solicitando OTP vía Composio/Gmail');
  const code = await waitForAirbnbOtp(otpRequestedAt, {
    userId: composioUserId ?? process.env.COMPOSIO_USER_ID ?? undefined,
    connectionId: composioConnectionId ?? process.env.COMPOSIO_CONNECTION_ID ?? undefined,
  });
  await submitTwoFactorCode(page, code);
  authLog('Paso 6/7', 'OTP enviado (modal cerrado ≠ sesión activa)');
  await dismissBlockingOverlays(page);
  await waitForUiSettle(page);
}

/** Si tras el OTP Airbnb pide contraseña, la completa. */
async function submitPasswordIfPrompted(
  page: Page,
  password: string,
  composioUserId?: string | null,
  composioConnectionId?: string | null,
): Promise<boolean> {
  if (!(await passwordInput(page).isVisible({ timeout: 4_000 }).catch(() => false))) {
    return false
  }

  authLog('Paso 6b/7', 'Airbnb pidió contraseña tras OTP — enviándola');
  await passwordInput(page).fill(password);
  await page
    .getByRole('button', { name: /^iniciar sesión$|^log in$|^sign in$/i })
    .click();
  await waitForUiSettle(page);
  await waitForSecurityChallengeIfPresent(page);

  if (await isTwoFactorModalVisible(page, 4_000)) {
    await handleTwoFactor(
      page,
      Date.now() - OTP_EMAIL_LOOKBACK_MS,
      composioUserId,
      composioConnectionId,
    );
  }

  return true
}

async function submitPasswordStep(
  page: Page,
  password: string,
  composioUserId?: string | null,
  composioConnectionId?: string | null,
) {
  authLog('Paso 4/7', 'Ingresando contraseña');
  await passwordInput(page).fill(password);

  const otpRequestedAt = Date.now();
  authLog('Paso 5/7', 'Enviando credenciales (clic en Iniciar sesión)');

  await page
    .getByRole('button', { name: /^iniciar sesión$|^log in$|^sign in$/i })
    .click();

  await waitForUiSettle(page);
  await waitForSecurityChallengeIfPresent(page);

  authLog('Paso 6/7', 'Comprobando si Airbnb pide verificación 2FA');
  if (await isTwoFactorModalVisible(page)) {
    await handleTwoFactor(page, otpRequestedAt, composioUserId, composioConnectionId);
  } else {
    authLog('Paso 6/7', 'Sin 2FA — sesión directa tras contraseña');
    await dismissBlockingOverlays(page);
  }
}

export async function loginAirbnb(
  page: Page,
  credentials: AirbnbCredentials | AccountAuthConfig,
) {
  const { email, password } = credentials;
  const composioUserId = 'composioUserId' in credentials ? credentials.composioUserId : null;
  const composioConnectionId =
    'composioConnectionId' in credentials ? credentials.composioConnectionId : null;
  const baseUrl = getAirbnbBaseUrl();

  authLog('Inicio', `Flujo de login en ${baseUrl}`);

  authLog('Paso 1/7', 'Navegando a la homepage');
  await gotoAndSettle(page, baseUrl);

  authLog('Paso 1/7', 'Cerrando banners y modales iniciales');
  await dismissBlockingOverlays(page);
  await waitForUiSettle(page);
  await dismissBlockingOverlays(page);

  // Arkose a veces aparece al cargar la home (IP nueva / riesgo).
  await waitForSecurityChallengeIfPresent(page);

  await openLoginModal(page);
  const otpRequestedAt = await submitEmailStep(page, email);

  await waitForUiSettle(page);
  await waitForSecurityChallengeIfPresent(page);
  await detectRateLimitOrBlock(page);
  await handleRememberedAccountIfPresent(page);
  await detectRateLimitOrBlock(page);

  const loggedInViaEmailCode = await bypassPasskeyAndUseEmailCode(
    page,
    composioUserId,
    composioConnectionId,
  );

  if (!loggedInViaEmailCode) {
    const postEmailStep = await detectPostEmailStep(page);
    if (postEmailStep === '2fa') {
      await handleTwoFactor(
    page,
    otpRequestedAt - OTP_EMAIL_LOOKBACK_MS,
    composioUserId,
    composioConnectionId,
  );
      await submitPasswordIfPrompted(page, password, composioUserId, composioConnectionId);
    } else {
      await submitPasswordStep(page, password, composioUserId, composioConnectionId);
    }
  } else {
    await submitPasswordIfPrompted(page, password, composioUserId, composioConnectionId);
  }

  authLog('Paso 7/7', 'Verificando que la sesión quedó activa en el header');

  await gotoAndSettle(page, baseUrl);
  authLog('Paso 7/7', 'Cerrando modales post-login (p. ej. tarifas incluidas)');
  await ensureHomepageReady(page);
  await waitForSecurityChallengeIfPresent(page);

  const loggedIn = await isLoggedInViaHeader(page);
  if (!loggedIn) {
    // Abrir menú para dejar evidencia clara en headed / logs.
    const menu = headerProfileMenuButton(page);
    if (await menu.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const expanded = await menu.getAttribute('aria-expanded').catch(() => null);
      if (expanded !== 'true') await menu.click({ timeout: 5_000 }).catch(() => undefined);
    }
    const guestVisible = await guestLoginMenuItem(page)
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    throw new Error(
      guestVisible
        ? 'Login falló: el header sigue mostrando "Iniciar sesión o registrarse" (OTP/modal cerró pero no hay sesión). Reintenta headed; si Airbnb pide password tras el OTP, debe completarse automáticamente.'
        : 'Login falló: no se pudo confirmar sesión activa en el header tras OTP/password.',
    );
  }

  authLog('Fin', 'Login exitoso — header sin opción de invitado');
}
