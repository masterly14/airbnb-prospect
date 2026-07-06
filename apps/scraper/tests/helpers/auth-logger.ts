const PREFIX = '[auth]';

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function maskOtp(code: string): string {
  if (code.length < 4) return '****';
  return `${code.slice(0, 2)}****${code.slice(-2)}`;
}

function formatMeta(data?: Record<string, unknown>): string {
  if (!data || Object.keys(data).length === 0) return '';
  const pairs = Object.entries(data).map(
    ([key, value]) => `${key}=${JSON.stringify(value)}`,
  );
  return ` (${pairs.join(', ')})`;
}

function write(
  level: 'log' | 'warn',
  kind: 'STEP' | 'INFO' | 'WARN',
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  const line = `${PREFIX} [${kind}] [${scope}] ${message}${formatMeta(data)}`;
  console[level](line);
}

export const authLogger = {
  step(scope: string, message: string, data?: Record<string, unknown>): void {
    write('log', 'STEP', scope, message, data);
  },

  info(scope: string, message: string, data?: Record<string, unknown>): void {
    write('log', 'INFO', scope, message, data);
  },

  warn(scope: string, message: string, data?: Record<string, unknown>): void {
    write('warn', 'WARN', scope, message, data);
  },

  maskEmail,
  maskOtp,
};

/** Atajo: authLog('Paso 1/7', 'detalle') */
export function authLog(scope: string, message?: string): void {
  if (message) {
    authLogger.info(scope, message);
  } else {
    authLogger.info('login', scope);
  }
}

export function authWarn(scope: string, message?: string): void {
  if (message) {
    authLogger.warn(scope, message);
  } else {
    authLogger.warn('login', scope);
  }
}
