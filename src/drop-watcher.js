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
  #logger;

  constructor({ symbol, lookbackMonths, priceHistory, analyzer, notifier, logger }) {
    this.#symbol = symbol;
    this.#lookbackMonths = lookbackMonths;
    this.#priceHistory = priceHistory;
    this.#analyzer = analyzer;
    this.#notifier = notifier;
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

    if (analysis.triggered) await this.#notifier.send(this.#buildMessage(analysis));

    return analysis;
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
