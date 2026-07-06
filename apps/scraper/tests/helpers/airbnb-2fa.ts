import { expect, Page } from '@playwright/test';
import { authLog, maskOtp } from './auth-logger';

function loginModal(page: Page) {
  return page
    .locator('[data-testid="modal-container"]')
    .or(page.getByRole('dialog'))
    .first();
}

export function passkeyLoginHeading(page: Page) {
  return page.getByRole('heading', {
    name: /inicia sesión con tu clave de acceso|log in with your passkey|sign in with your passkey/i,
  });
}

export function tryAnotherWayButton(page: Page) {
  return loginModal(page).getByRole('button', {
    name: /intenta de otra forma|try another way/i,
  });
}

export function emailCodeLoginOption(page: Page) {
  return loginModal(page)
    .locator('button, [role="button"]')
    .filter({ hasText: /recibe un código por correo|receive a code by email|get a code by email/i })
    .first();
}

export function otpCodeInput(page: Page) {
  const modal = loginModal(page);
  return modal
    .getByRole('textbox', {
      name: /one time code|código|verification|verificación|introduce el código|enter the code/i,
    })
    .or(modal.locator('input[inputmode="numeric"]'))
    .or(modal.locator('input[type="tel"]'))
    .first();
}

export async function isOtpInputVisible(page: Page, timeoutMs = 8_000): Promise<boolean> {
  return otpCodeInput(page)
    .isVisible({ timeout: timeoutMs })
    .catch(() => false);
}

export function twoFactorHeading(page: Page) {
  return page.getByRole('heading', {
    name: /confirma que eres tú|confirm it'?s you/i,
  });
}

export function passwordInput(page: Page) {
  return page.getByRole('textbox', {
    name: /contraseña|password/i,
  });
}

export async function isTwoFactorModalVisible(
  page: Page,
  timeoutMs = 8_000,
): Promise<boolean> {
  const headingVisible = await twoFactorHeading(page)
    .isVisible({ timeout: timeoutMs })
    .catch(() => false);
  const otpVisible = await isOtpInputVisible(page, timeoutMs);
  const visible = headingVisible || otpVisible;
  authLog(
    '2FA',
    visible
      ? 'Modal de verificación visible (heading o campo OTP)'
      : 'Modal 2FA no apareció en el tiempo esperado',
  );
  return visible;
}

export async function submitTwoFactorCode(page: Page, code: string) {
  authLog('2FA', `Ingresando código OTP: ${maskOtp(code)}`);

  const modal = loginModal(page);
  await expect(modal).toBeVisible({ timeout: 10_000 });

  const otpInput = otpCodeInput(page);

  await otpInput.waitFor({ state: 'visible', timeout: 10_000 });
  await otpInput.click();
  await otpInput.fill(code);
  authLog('2FA', 'Código ingresado — esperando confirmación de Airbnb');

  const heading = twoFactorHeading(page);

  await Promise.race([
    heading.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {}),
    modal.waitFor({ state: 'hidden', timeout: 30_000 }),
    otpInput.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {}),
  ]).catch(async () => {
    authLog('2FA', 'Modal aún visible — enviando Enter como respaldo');
    await page.keyboard.press('Enter');
    await heading.waitFor({ state: 'hidden', timeout: 20_000 });
  });

  authLog('2FA', 'Modal de verificación cerrado');
}
