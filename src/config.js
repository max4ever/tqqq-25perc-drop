import { z } from 'zod';

/**
 * Typed, validated view over the process environment.
 *
 * Everything the app can be tuned with lives here, so the rest of the code
 * never touches `process.env` directly.
 */
export class Config {
  #values;

  constructor(env = process.env) {
    this.#values = this.#parse(env);
  }

  #booleanish(defaultValue) {
    return z
      .union([z.boolean(), z.string()])
      .default(defaultValue)
      .transform((value, ctx) => {
        if (typeof value === 'boolean') return value;

        const normalised = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'y', 'on'].includes(normalised)) return true;
        if (['0', 'false', 'no', 'n', 'off', ''].includes(normalised)) return false;

        ctx.addIssue({ code: 'custom', message: `expected a boolean-ish value, got "${value}"` });
        return z.NEVER;
      });
  }

  #buildSchema() {
    return z.object({
      SYMBOL: z
        .string()
        .trim()
        .min(1)
        .default('TQQQ')
        .transform((value) => value.toUpperCase()),

      DROP_THRESHOLD_PERCENT: z.coerce.number().gt(0).lte(100).default(25),

      LOOKBACK_MONTHS: z.coerce.number().int().min(1).max(600).default(6),

      TELEGRAM_URL: z
        .string({ error: 'TELEGRAM_URL is required — see .env.example' })
        .trim()
        .min(1, 'TELEGRAM_URL is required')
        .refine(
          (value) => {
            try {
              const probe = new URL(value.replaceAll('{message}', 'probe'));
              return probe.protocol === 'http:' || probe.protocol === 'https:';
            } catch {
              return false;
            }
          },
          { message: 'TELEGRAM_URL must be a valid http(s) URL' },
        ),
      TELEGRAM_METHOD: z
        .string()
        .trim()
        .toUpperCase()
        .pipe(z.enum(['GET', 'POST']))
        .default('GET'),
      TELEGRAM_MESSAGE_PARAM: z.string().trim().min(1).default('text'),
      TELEGRAM_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(10_000),
      TELEGRAM_RETRIES: z.coerce.number().int().min(0).max(10).default(3),

      RUN_MODE: z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.enum(['once', 'schedule']))
        .default('schedule'),
      CHECK_CRON: z.string().trim().min(1).default('0 * * * *'),
      CRON_TIMEZONE: z.string().trim().min(1).default('UTC'),
      RUN_ON_START: this.#booleanish(true),

      ALERT_COOLDOWN_HOURS: z.coerce.number().min(0).max(8760).default(24),
      STATE_FILE: z.string().trim().min(1).optional(),

      HEALTH_SERVER: this.#booleanish(true),
      PORT: z.coerce.number().int().min(1).max(65_535).default(3000),

      DRY_RUN: this.#booleanish(false),
      LOG_LEVEL: z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']))
        .default('info'),
      LOG_PRETTY: this.#booleanish(false),
    });
  }

  #parse(env) {
    // Treat empty strings as "not set" so an empty Railway variable falls back
    // to the default instead of failing validation.
    const cleaned = Object.fromEntries(
      Object.entries(env).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
    );

    const result = this.#buildSchema().safeParse(cleaned);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      throw new Error(`Invalid configuration:\n${details}`);
    }
    return result.data;
  }

  get symbol() {
    return this.#values.SYMBOL;
  }

  get dropThresholdPercent() {
    return this.#values.DROP_THRESHOLD_PERCENT;
  }

  get lookbackMonths() {
    return this.#values.LOOKBACK_MONTHS;
  }

  get telegram() {
    return {
      url: this.#values.TELEGRAM_URL,
      method: this.#values.TELEGRAM_METHOD,
      messageParam: this.#values.TELEGRAM_MESSAGE_PARAM,
      timeoutMs: this.#values.TELEGRAM_TIMEOUT_MS,
      retries: this.#values.TELEGRAM_RETRIES,
    };
  }

  get runMode() {
    return this.#values.RUN_MODE;
  }

  get checkCron() {
    return this.#values.CHECK_CRON;
  }

  get cronTimezone() {
    return this.#values.CRON_TIMEZONE;
  }

  get runOnStart() {
    return this.#values.RUN_ON_START;
  }

  get alertCooldownHours() {
    return this.#values.ALERT_COOLDOWN_HOURS;
  }

  get stateFile() {
    return this.#values.STATE_FILE;
  }

  get healthServerEnabled() {
    return this.#values.HEALTH_SERVER;
  }

  get port() {
    return this.#values.PORT;
  }

  get dryRun() {
    return this.#values.DRY_RUN;
  }

  get logLevel() {
    return this.#values.LOG_LEVEL;
  }

  get logPretty() {
    return this.#values.LOG_PRETTY;
  }

  /** Secret-free snapshot, safe to write to the logs on boot. */
  describe() {
    return {
      symbol: this.symbol,
      dropThresholdPercent: this.dropThresholdPercent,
      lookbackMonths: this.lookbackMonths,
      runMode: this.runMode,
      checkCron: this.checkCron,
      cronTimezone: this.cronTimezone,
      runOnStart: this.runOnStart,
      alertCooldownHours: this.alertCooldownHours,
      stateFile: this.stateFile ?? null,
      healthServer: this.healthServerEnabled,
      port: this.port,
      dryRun: this.dryRun,
      telegramMethod: this.telegram.method,
      logLevel: this.logLevel,
    };
  }
}
