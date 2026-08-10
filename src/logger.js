import { pino } from 'pino';

/**
 * Builds the root logger. Pretty output is opt-in (LOG_PRETTY=true) and only
 * used when `pino-pretty` is actually installed, which it is not in the
 * production image — there we emit newline-delimited JSON, which is what
 * Railway's log viewer indexes best.
 */
export function createLogger(config) {
  const options = {
    level: config.logLevel,
    base: { app: 'stock-drop-alert', symbol: config.symbol },
    redact: {
      paths: ['url', 'telegramUrl', '*.url', 'req.headers.authorization'],
      censor: '[redacted]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (!config.logPretty) return pino(options);

  try {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,app' },
      },
    });
  } catch {
    return pino(options);
  }
}
