import { test as setup } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { toComposioUserId } from '@repo/composio';
import { db } from '@repo/db';
import {
  AUTH_SESSION_PATH,
  getCredentialsFromEnv,
  loginAirbnb,
  type AccountAuthConfig,
} from './helpers/airbnb-auth';
import { authLogger } from './helpers/auth-logger';

setup('save Airbnb session', async ({ page }) => {
  setup.setTimeout(180_000);

  authLogger.step('setup', 'Iniciando flujo de autenticación de Airbnb');
  authLogger.info('setup', 'Timeout configurado', { segundos: 180 });

  const fromEnv = getCredentialsFromEnv();
  authLogger.info('setup', 'Credenciales cargadas desde .env', {
    email: authLogger.maskEmail(fromEnv.email),
  });

  // OTP via Composio must use the ProspectAccount Gmail link, not COMPOSIO_USER_ID=1.
  const account = await db.prospectAccount.findUnique({
    where: { airbnbEmail: fromEnv.email.trim().toLowerCase() },
    select: {
      id: true,
      label: true,
      composioConnectionId: true,
    },
  });

  const credentials: AccountAuthConfig = {
    email: fromEnv.email,
    password: fromEnv.password,
    accountId: account?.id,
    composioUserId: account ? toComposioUserId(account.id) : process.env.COMPOSIO_USER_ID ?? null,
    composioConnectionId:
      account?.composioConnectionId ?? process.env.COMPOSIO_CONNECTION_ID ?? null,
  };

  if (account?.composioConnectionId) {
    authLogger.info('setup', 'Usando Composio de ProspectAccount', {
      accountId: account.id,
      label: account.label,
      composioUserId: credentials.composioUserId,
    });
  } else if (account) {
    throw new Error(
      `ProspectAccount "${account.label}" (${account.id}) has no Gmail connected. ` +
        'Connect it in /settings/accounts before auth:login.',
    );
  } else {
    authLogger.warn(
      'setup',
      'Sin ProspectAccount para el email; fallback a COMPOSIO_* del .env (deprecated)',
    );
  }

  await loginAirbnb(page, credentials);

  authLogger.step('setup', 'Login completado, guardando estado de sesión');
  fs.mkdirSync(path.dirname(AUTH_SESSION_PATH), { recursive: true });
  await page.context().storageState({ path: AUTH_SESSION_PATH });

  authLogger.info('setup', 'Sesión persistida correctamente', {
    ruta: AUTH_SESSION_PATH,
  });
});
