import dotenv from 'dotenv';
import path from 'path';
import { buildOtpConfigFromAccount } from '@repo/composio';
import { db } from '@repo/db';
import {
  extractAirbnbOtp,
  fetchLatestAirbnbEmails,
  findOtpInMessages,
  getComposioConfigFromEnv,
} from '../src/composio/gmail-otp';
import { authLogger } from '../tests/helpers/auth-logger';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function parseAccountIdArg(): string | null {
  const idx = process.argv.indexOf('--account-id');
  if (idx === -1) return null;
  return process.argv[idx + 1]?.trim() || null;
}

async function resolveConfig() {
  const accountId = parseAccountIdArg();
  if (accountId) {
    const account = await db.prospectAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        label: true,
        composioUserId: true,
        composioConnectionId: true,
      },
    });

    if (!account) {
      throw new Error(`ProspectAccount not found: ${accountId}`);
    }

    authLogger.info('otp-test', 'Usando credenciales Composio de la cuenta', {
      accountId: account.id,
      label: account.label,
      composioUserId: account.composioUserId,
    });

    return buildOtpConfigFromAccount(account);
  }

  authLogger.warn(
    'otp-test',
    'Sin --account-id; usando COMPOSIO_USER_ID de .env (deprecated)',
  );
  return getComposioConfigFromEnv();
}

async function main() {
  authLogger.step('otp-test', 'Iniciando prueba de Composio + Gmail');

  const config = await resolveConfig();
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;

  authLogger.info('otp-test', 'Buscando correos de automated@airbnb.com', {
    ventanaHoras: 24,
    userId: config.userId,
  });

  const messages = await fetchLatestAirbnbEmails(config);

  if (messages.length === 0) {
    authLogger.warn('otp-test', 'No se encontraron mensajes');
    process.exit(1);
  }

  authLogger.info('otp-test', 'Mensajes recientes', {
    total: messages.length,
  });
  for (const message of messages.slice(0, 3)) {
    authLogger.info('otp-test', 'Correo', {
      asunto: message.subject ?? '(sin asunto)',
      fecha: message.internalDate ?? 'sin fecha',
    });
  }

  const otp = findOtpInMessages(messages, sinceMs);
  if (!otp) {
    authLogger.warn('otp-test', 'No se pudo extraer OTP de los mensajes recientes');
    process.exit(1);
  }

  authLogger.info('otp-test', 'OTP extraído', {
    codigo: authLogger.maskOtp(otp),
  });

  const sample = messages[0];
  const sampleText = [sample.subject, sample.body, sample.snippet].filter(Boolean).join('\n');
  const parsed = extractAirbnbOtp(sampleText);
  authLogger.info('otp-test', 'Parseo del mensaje más reciente', {
    codigo: parsed ? authLogger.maskOtp(parsed) : 'ninguno',
  });
}

main().catch((error) => {
  authLogger.warn('otp-test', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
