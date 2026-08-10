/**
 * Typed, validated view over the process environment.
 *
 * Everything the app can be tuned with lives here, so the rest of the code never
 * touches `process.env` directly. All problems are collected and reported at
 * once — a container that starts with three bad variables should say so on the
 * first run, not on the third.
 */
export class Config {
  #values;

  constructor(env = process.env) {
    this.#values = this.#parse(env);
  }

  #parse(env) {
    const issues = [];

    const values = {
      symbol: (this.#read(env, 'SYMBOL') ?? 'TQQQ').toUpperCase(),
      dropThresholdPercent: this.#number(env, 'DROP_THRESHOLD_PERCENT', issues, {
        fallback: 25,
        min: 0.01,
        max: 100,
      }),
      lookbackMonths: this.#number(env, 'LOOKBACK_MONTHS', issues, {
        fallback: 6,
        min: 1,
        max: 600,
        integer: true,
      }),
      botToken: this.#botToken(env, issues),
      chatId: this.#required(env, 'TELEGRAM_CHAT_ID', issues),
      forceNotify: this.#boolean(env, 'FORCE_NOTIFY', issues),
    };

    if (issues.length > 0) {
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
    return values;
  }

  /** Empty variables count as unset, so a blank value falls back to the default. */
  #read(env, key) {
    const raw = env[key];
    return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
  }

  #required(env, key, issues) {
    const value = this.#read(env, key);
    if (value === undefined) issues.push(`${key} is required`);
    return value;
  }

  #number(env, key, issues, { fallback, min, max, integer = false }) {
    const raw = this.#read(env, key);
    if (raw === undefined) return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      issues.push(`${key} must be a number (got "${raw}")`);
    } else if (integer && !Number.isInteger(value)) {
      issues.push(`${key} must be a whole number (got "${raw}")`);
    } else if (value < min || value > max) {
      issues.push(`${key} must be between ${min} and ${max} (got ${value})`);
    } else {
      return value;
    }
    return fallback;
  }

  #boolean(env, key, issues) {
    const raw = this.#read(env, key);
    if (raw === undefined) return false;

    const normalised = raw.toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalised)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalised)) return false;

    issues.push(`${key} must be true or false (got "${raw}")`);
    return false;
  }

  #botToken(env, issues) {
    const value = this.#required(env, 'TELEGRAM_BOT_TOKEN', issues);
    if (value !== undefined && !/^\d+:\S+$/.test(value)) {
      // Catches the easy mistake of pasting the bot's numeric id instead of the
      // whole token, which would otherwise only show up as a 404 from Telegram.
      issues.push('TELEGRAM_BOT_TOKEN should look like "123456789:AAExample-Token"');
    }
    return value;
  }

  get symbol() {
    return this.#values.symbol;
  }

  get dropThresholdPercent() {
    return this.#values.dropThresholdPercent;
  }

  get lookbackMonths() {
    return this.#values.lookbackMonths;
  }

  get telegram() {
    return { botToken: this.#values.botToken, chatId: this.#values.chatId };
  }

  /** Send the message even when the threshold was not reached, to test delivery. */
  get forceNotify() {
    return this.#values.forceNotify;
  }

  /** Secret-free snapshot, safe to write to the logs on boot. */
  describe() {
    return {
      symbol: this.symbol,
      dropThresholdPercent: this.dropThresholdPercent,
      lookbackMonths: this.lookbackMonths,
      chatId: this.#values.chatId,
      forceNotify: this.forceNotify,
    };
  }
}
