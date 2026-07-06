import { test as setup } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  AUTH_SESSION_PATH,
  getCredentialsFromEnv,
  loginAirbnb,
} from './helpers/airbnb-auth';
import { authLogger } from './helpers/auth-logger';

setup('save Airbnb session', async ({ page }) => {
  setup.setTimeout(180_000);

  authLogger.step('setup', 'Iniciando flujo de autenticación de Airbnb');
  authLogger.info('setup', 'Timeout configurado', { segundos: 180 });

  const credentials = getCredentialsFromEnv();
  authLogger.info('setup', 'Credenciales cargadas desde .env', {
    email: authLogger.maskEmail(credentials.email),
  });

  await loginAirbnb(page, credentials);

  authLogger.step('setup', 'Login completado, guardando estado de sesión');
  fs.mkdirSync(path.dirname(AUTH_SESSION_PATH), { recursive: true });
  await page.context().storageState({ path: AUTH_SESSION_PATH });

  authLogger.info('setup', 'Sesión persistida correctamente', {
    ruta: AUTH_SESSION_PATH,
  });
});
