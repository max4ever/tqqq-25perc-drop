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
    };

    if (issues.length > 0) {
      throw new Error(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
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

  /** Secret-free snapshot, safe to write to the logs on boot. */
  describe() {
    return {
      symbol: this.symbol,
      dropThresholdPercent: this.dropThresholdPercent,
      lookbackMonths: this.lookbackMonths,
      chatId: this.#values.chatId,
    };
  }
}
