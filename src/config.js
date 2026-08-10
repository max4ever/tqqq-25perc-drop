import { cleanEnv, EnvError, EnvMissingError, makeValidator, str } from 'envalid';

/**
 * Typed, validated view over the process environment.
 *
 * Everything the app can be tuned with lives here, so the rest of the code never
 * touches `process.env` directly. All problems are collected and reported at
 * once — a container that starts with three bad variables should say so on the
 * first run, not on the third.
 */
export class Config {
  #env;

  constructor(env = process.env) {
    this.#env = this.#parse(env);
  }

  #parse(env) {
    return cleanEnv(
      this.#withoutBlanks(env),
      {
        SYMBOL: this.#ticker({ default: 'TQQQ' }),
        DROP_THRESHOLD_PERCENT: this.#percentage({ default: 25 }),
        LOOKBACK_MONTHS: this.#months({ default: 6 }),
        TELEGRAM_BOT_TOKEN: this.#botToken(),
        TELEGRAM_CHAT_ID: str(),
        FORCE_NOTIFY: this.#flag({ default: false }),
      },
      { reporter: ({ errors }) => this.#report(errors) },
    );
  }

  /**
   * envalid only treats a variable as missing when it is literally undefined, so
   * `SYMBOL=` would otherwise parse as an empty ticker rather than falling back
   * to the default. Blank means unset here.
   */
  #withoutBlanks(env) {
    return Object.fromEntries(
      Object.entries(env).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
    );
  }

  #ticker(spec) {
    return makeValidator((input) => input.trim().toUpperCase())(spec);
  }

  #percentage(spec) {
    return makeValidator((input) => {
      const value = Number(input);
      if (!Number.isFinite(value)) throw new EnvError(`must be a number (got "${input}")`);
      if (value <= 0 || value > 100) throw new EnvError(`must be between 0.01 and 100 (got ${value})`);
      return value;
    })(spec);
  }

  #months(spec) {
    return makeValidator((input) => {
      const value = Number(input);
      if (!Number.isInteger(value)) throw new EnvError(`must be a whole number (got "${input}")`);
      if (value < 1 || value > 600) throw new EnvError(`must be between 1 and 600 (got ${value})`);
      return value;
    })(spec);
  }

  /** envalid's own bool() phrases its error differently to the rest of these. */
  #flag(spec) {
    return makeValidator((input) => {
      const normalised = input.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(normalised)) return true;
      if (['0', 'false', 'no', 'n', 'off'].includes(normalised)) return false;
      throw new EnvError(`must be true or false (got "${input}")`);
    })(spec);
  }

  #botToken(spec) {
    return makeValidator((input) => {
      // Catches the easy mistake of pasting the bot's numeric id instead of the
      // whole token, which would otherwise only show up as a 404 from Telegram.
      if (!/^\d+:\S+$/.test(input)) {
        throw new EnvError('should look like "123456789:AAExample-Token"');
      }
      return input;
    })(spec);
  }

  /**
   * Replaces envalid's reporter, which logs to console and exits by itself.
   * It is called on every run, including clean ones — hence the early return.
   */
  #report(errors) {
    if (Object.keys(errors).length === 0) return;

    const issues = Object.entries(errors).map(([key, error]) =>
      error instanceof EnvMissingError ? `${key} is required` : `${key} ${error.message}`,
    );

    throw new Error(
      [
        'Invalid configuration:',
        ...issues.map((issue) => `  - ${issue}`),
        '',
        'Only TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required.',
        'SYMBOL, DROP_THRESHOLD_PERCENT and LOOKBACK_MONTHS default to TQQQ, 25 and 6.',
      ].join('\n'),
    );
  }

  get symbol() {
    return this.#env.SYMBOL;
  }

  get dropThresholdPercent() {
    return this.#env.DROP_THRESHOLD_PERCENT;
  }

  get lookbackMonths() {
    return this.#env.LOOKBACK_MONTHS;
  }

  get telegram() {
    return { botToken: this.#env.TELEGRAM_BOT_TOKEN, chatId: this.#env.TELEGRAM_CHAT_ID };
  }

  /** Send the message even when the threshold was not reached, to test delivery. */
  get forceNotify() {
    return this.#env.FORCE_NOTIFY;
  }

  /** Secret-free snapshot, safe to write to the logs on boot. */
  describe() {
    return {
      symbol: this.symbol,
      dropThresholdPercent: this.dropThresholdPercent,
      lookbackMonths: this.lookbackMonths,
      chatId: this.#env.TELEGRAM_CHAT_ID,
      forceNotify: this.forceNotify,
    };
  }
}
