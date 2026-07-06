import { expect, Page } from '@playwright/test';
import { dismissBlockingOverlays, ensureHomepageReady } from './airbnb-scraper';
import { getAirbnbBaseUrl } from './airbnb-context';
import { isTwoFactorModalVisible, passwordInput, submitTwoFactorCode, twoFactorHeading, passkeyLoginHeading, tryAnotherWayButton, emailCodeLoginOption, isOtpInputVisible } from './airbnb-2fa';
import { waitForAirbnbOtp } from './composio-gmail';
import { authLog, maskEmail } from './auth-logger';

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
  const userMenu = page.getByRole('button', {
    name: /main navigation menu|menú de navegación principal|menú principal/i,
  });
  await userMenu.click({ timeout: 10_000 });

  authLog('Paso 2/7', 'Seleccionando "Iniciar sesión"');
  await page
    .getByRole('menuitem', { name: /iniciar sesión|log in|sign in/i })
    .or(page.getByRole('link', { name: /iniciar sesión|log in|sign in/i }))
    .first()
    .click();

  const loginModal = page
    .getByRole('dialog')
    .or(page.locator('[data-testid="modal-container"]'));
  await expect(loginModal.first()).toBeVisible({ timeout: 15_000 });
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
  await continueButton.waitFor({ state: 'visible', timeout: 10_000 });
  await continueButton.click({ timeout: 10_000 });
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

  if (await emailWithButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
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
    await unifiedInput.waitFor({ state: 'visible', timeout: 10_000 });
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

  const isRemembered = await welcomeBack.isVisible({ timeout: 4_000 }).catch(() => false);
  if (!isRemembered) return;

  authLog('Paso 3b/7', 'UI detectada: cuenta recordada — pulsando Iniciar sesión');

  const loginButton = modal.getByRole('button', {
    name: /^iniciar sesión$|^log in$|^sign in$/i,
  });
  if (await loginButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await loginButton.click({ timeout: 10_000 });
    await page.waitForTimeout(2_000);
    return;
  }

  // Fallback: "¿No eres tú?" fuerza flujo completo de credenciales.
  if (await notYouLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
    authLog('Paso 3b/7', 'Sin botón Iniciar sesión — usando "¿No eres tú?"');
    await notYouLink.click({ timeout: 10_000 });
    await page.waitForTimeout(2_000);
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
    .isVisible({ timeout: 5_000 })
    .catch(() => false);

  if (passkeyVisible) {
    authLog('Paso 4/7', 'UI detectada: modal passkey — pulsando Intenta de otra forma');
    await tryAnotherWayButton(page).click({ timeout: 10_000 });
    await page.waitForTimeout(1_500);
  }

  const emailOptionVisible = await emailCodeLoginOption(page)
    .isVisible({ timeout: passkeyVisible ? 8_000 : 4_000 })
    .catch(() => false);

  if (!emailOptionVisible) return false;

  authLog('Paso 4/7', 'Seleccionando OTP por correo electrónico');
  const otpRequestedAt = Date.now();
  await emailCodeLoginOption(page).click({ timeout: 10_000 });
  await page.waitForTimeout(2_000);

  await isOtpInputVisible(page, 20_000);
  await handleTwoFactor(page, otpRequestedAt - 5_000, composioUserId, composioConnectionId);
  return true;
}

async function detectPostEmailStep(page: Page): Promise<PostEmailStep> {
  authLog('Paso 4/7', 'Detectando siguiente pantalla: contraseña o 2FA');

  const step = await Promise.race([
    passwordInput(page)
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => 'password' as const),
    twoFactorHeading(page)
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => '2fa' as const),
  ]).catch(() => null);

  if (!step) {
    throw new Error(
      'Tras el correo no apareció ni el campo de contraseña ni el modal 2FA',
    );
  }

  authLog(
    'Paso 4/7',
    step === 'password'
      ? 'Pantalla de contraseña detectada'
      : 'Modal 2FA detectado directamente (sin contraseña)',
  );

  return step;
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
  authLog('Paso 6/7', 'Verificación 2FA completada');
  await dismissBlockingOverlays(page);
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
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  authLog('Paso 1/7', 'Cerrando banners y modales iniciales');
  await dismissBlockingOverlays(page);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
    authLog('Paso 1/7', 'networkidle no alcanzado; continuando');
  });
  await dismissBlockingOverlays(page);

  await openLoginModal(page);
  const otpRequestedAt = await submitEmailStep(page, email);

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
      await handleTwoFactor(page, otpRequestedAt - 5_000, composioUserId, composioConnectionId);
    } else {
      await submitPasswordStep(page, password, composioUserId, composioConnectionId);
    }
  }

  authLog('Paso 7/7', 'Verificando que la sesión quedó activa');

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  authLog('Paso 7/7', 'Cerrando modales post-login (p. ej. tarifas incluidas)');
  await ensureHomepageReady(page);

  const profileLink = page.locator('a[href="/users/profile"]');
  if (await profileLink.isVisible({ timeout: 10_000 }).catch(() => false)) {
    authLog('Fin', 'Login exitoso — enlace a perfil visible');
    return;
  }

  const userMenu = page
    .getByRole('button', {
      name: /main navigation menu|menú de navegación principal|menú principal/i,
    })
    .or(page.locator('nav').getByRole('button').last());

  await userMenu.click({ timeout: 15_000 });
  await expect(
    page.getByRole('menuitem', { name: /iniciar sesión|log in|sign in/i }),
  ).toHaveCount(0, { timeout: 20_000 });

  authLog('Fin', 'Login exitoso — menú de usuario sin opción "Iniciar sesión"');
}
