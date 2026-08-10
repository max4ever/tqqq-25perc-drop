import { pino } from 'pino';

/**
 * Newline-delimited JSON on stdout — one object per line, which is what log
 * viewers index best. Nothing to configure.
 */
export function createLogger(config) {
  return pino({
    level: 'info',
    base: { app: 'stock-drop-alert', symbol: config.symbol },
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
