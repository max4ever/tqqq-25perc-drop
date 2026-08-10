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
  #forceNotify;
  #logger;

  constructor({ symbol, lookbackMonths, priceHistory, analyzer, notifier, forceNotify, logger }) {
    this.#symbol = symbol;
    this.#lookbackMonths = lookbackMonths;
    this.#priceHistory = priceHistory;
    this.#analyzer = analyzer;
    this.#notifier = notifier;
    this.#forceNotify = forceNotify;
    this.#logger = logger.child({ component: 'watcher' });
  }

  async check() {
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

    if (!analysis.triggered && this.#forceNotify) {
      this.#logger.warn('FORCE_NOTIFY is on — sending the message anyway to test delivery');
    }

    const notify = analysis.triggered || this.#forceNotify;
    if (notify) await this.#notifier.send(this.#buildMessage(analysis));

    return { ...analysis, notified: notify };
  }

  #buildMessage(analysis) {
    const money = (value) => `${value.toFixed(2)} ${analysis.currency}`;
    const title = analysis.name ? `${analysis.symbol} (${analysis.name})` : analysis.symbol;

    return [
      analysis.triggered
        ? `📉 ${title} dropped ${analysis.dropPercent}% from its ${this.#lookbackMonths}-month high.`
        : `🧪 Test message — no alert. ${title} is ${analysis.dropPercent}% below its ${this.#lookbackMonths}-month high, which has not reached the threshold.`,
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
