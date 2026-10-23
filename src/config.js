import env from 'env-var';

/**
 * Typed, validated view over the process environment, so the rest of the code
 * never touches `process.env` directly.
 */
export class Config {
  #values;

  constructor(source = process.env) {
    this.#values = this.#parse(source);
  }

  #parse(source) {
    // Blank counts as unset, so `SYMBOL=` falls back instead of parsing as "".
    const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v?.trim?.() !== ''));
    const from = env.from(set);

    try {
      return {
        symbol: from.get('SYMBOL').default('TQQQ').asString().toUpperCase(),
        dropThresholdPercent: this.#percent(from),
        lookbackMonths: from.get('LOOKBACK_MONTHS').default(6).asIntPositive(),
        botToken: this.#botToken(from),
        chatId: from.get('TELEGRAM_CHAT_ID').required().asString(),
        forceNotify: from.get('FORCE_NOTIFY').default('false').asBool(),
        monthlyDigest: from.get('MONTHLY_DIGEST').default('true').asBool(),
      };
    } catch (error) {
      throw new Error(
        `${error.message}\n\nOnly TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required.\n` +
          'SYMBOL, DROP_THRESHOLD_PERCENT and LOOKBACK_MONTHS default to TQQQ, 25 and 6.',
      );
    }
  }

  /** Above 100 the alert could never fire, which would fail silently forever. */
  #percent(from) {
    const value = from.get('DROP_THRESHOLD_PERCENT').default(25).asFloatPositive();
    if (value > 100) throw new Error('env-var: "DROP_THRESHOLD_PERCENT" must be 100 or less');
    return value;
  }

  #botToken(from) {
    const token = from.get('TELEGRAM_BOT_TOKEN').required().asString();
    // Pasting the bot's numeric id instead of the whole token would otherwise
    // only show up as a 404 from Telegram.
    if (!/^\d+:\S+$/.test(token)) {
      throw new Error('env-var: "TELEGRAM_BOT_TOKEN" should look like "123456789:AAExample-Token"');
    }
    return token;
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

  /** Report on the first weekday of each month even when nothing has happened. */
  get monthlyDigest() {
    return this.#values.monthlyDigest;
  }

  /** Secret-free snapshot, safe to write to the logs on boot. */
  describe() {
    return {
      symbol: this.symbol,
      dropThresholdPercent: this.dropThresholdPercent,
      lookbackMonths: this.lookbackMonths,
      chatId: this.#values.chatId,
      forceNotify: this.forceNotify,
      monthlyDigest: this.monthlyDigest,
    };
  }
}
