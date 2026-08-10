/**
 * One pass of the whole job: fetch → analyse → decide → notify.
 * Every collaborator is injected, so this class stays trivially testable.
 */
export class DropWatcher {
  #symbol;
  #lookbackMonths;
  #priceHistory;
  #analyzer;
  #notifier;
  #stateStore;
  #logger;

  constructor({ symbol, lookbackMonths, priceHistory, analyzer, notifier, stateStore, logger }) {
    this.#symbol = symbol;
    this.#lookbackMonths = lookbackMonths;
    this.#priceHistory = priceHistory;
    this.#analyzer = analyzer;
    this.#notifier = notifier;
    this.#stateStore = stateStore;
    this.#logger = logger.child({ component: 'watcher' });
  }

  async check() {
    const startedAt = new Date();
    this.#logger.info({ lookbackMonths: this.#lookbackMonths }, 'starting check');

    const window = await this.#priceHistory.fetchWindow(this.#symbol, this.#lookbackMonths);
    const analysis = this.#analyzer.analyze(window);

    this.#logger.info(
      {
        peakPrice: analysis.peakPrice,
        peakDate: analysis.peakDate,
        currentPrice: analysis.currentPrice,
        dropPercent: analysis.dropPercent,
        thresholdPercent: analysis.thresholdPercent,
        triggered: analysis.triggered,
        candles: analysis.candleCount,
      },
      analysis.triggered
        ? `${analysis.symbol} is ${analysis.dropPercent}% below its ${this.#lookbackMonths}-month high — threshold reached`
        : `${analysis.symbol} is ${analysis.dropPercent}% below its ${this.#lookbackMonths}-month high — below threshold`,
    );

    const outcome = { ...analysis, checkedAt: startedAt, notified: false, suppressed: false };

    if (!analysis.triggered) return outcome;

    const cooldownKey = this.#cooldownKey(analysis);
    const { suppressed, lastAlertAt, nextAllowedAt } = await this.#stateStore.isSuppressed(cooldownKey);

    if (suppressed) {
      this.#logger.info({ lastAlertAt, nextAllowedAt }, 'threshold reached but still within cooldown — not notifying');
      return { ...outcome, suppressed: true, lastAlertAt, nextAllowedAt };
    }

    const message = this.#buildMessage(analysis);
    const result = await this.#notifier.send(message);

    if (result.delivered) {
      await this.#stateStore.recordAlert(cooldownKey, {
        dropPercent: analysis.dropPercent,
        peakPrice: analysis.peakPrice,
        currentPrice: analysis.currentPrice,
      });
    }

    return { ...outcome, notified: result.delivered, dryRun: result.dryRun === true, message };
  }

  /** Threshold and window are part of the key so config changes start a fresh cooldown. */
  #cooldownKey(analysis) {
    return `${this.#symbol}:${this.#lookbackMonths}m:${analysis.thresholdPercent}pct`;
  }

  #buildMessage(analysis) {
    const money = (value) => `${value.toFixed(2)} ${analysis.currency}`;
    const title = analysis.name ? `${analysis.symbol} (${analysis.name})` : analysis.symbol;

    return [
      `📉 ${title} dropped ${analysis.dropPercent}% from its ${this.#lookbackMonths}-month high.`,
      '',
      `Threshold: -${analysis.thresholdPercent}%`,
      `High:      ${money(analysis.peakPrice)} on ${this.#formatDate(analysis.peakDate)}`,
      `Now:       ${money(analysis.currentPrice)} (${this.#formatDate(analysis.currentPriceAsOf)})`,
      `Window:    ${this.#formatDate(analysis.windowStart)} → ${this.#formatDate(analysis.windowEnd)}`,
    ].join('\n');
  }

  #formatDate(date) {
    const value = date instanceof Date ? date : new Date(date);
    return Number.isNaN(value.getTime()) ? 'unknown' : value.toISOString().slice(0, 10);
  }
}
