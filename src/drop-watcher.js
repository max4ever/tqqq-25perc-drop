import { Calendar } from './calendar.js';

/**
 * One pass of the whole job: fetch → analyse → decide → notify.
 * Every collaborator is injected, so this class stays trivially testable.
 */
export class DropWatcher {
  #symbol;
  #lookbackMonths;
  #priceHistory;
  #analyzer;
  #composer;
  #notifier;
  #forceNotify;
  #monthlyDigest;
  #now;
  #logger;

  constructor({
    symbol,
    lookbackMonths,
    priceHistory,
    analyzer,
    composer,
    notifier,
    forceNotify,
    monthlyDigest,
    now = () => new Date(),
    logger,
  }) {
    this.#symbol = symbol;
    this.#lookbackMonths = lookbackMonths;
    this.#priceHistory = priceHistory;
    this.#analyzer = analyzer;
    this.#composer = composer;
    this.#notifier = notifier;
    this.#forceNotify = forceNotify;
    this.#monthlyDigest = monthlyDigest;
    this.#now = now;
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
        monthChangePercent: analysis.monthChangePercent,
        thresholdPercent: analysis.thresholdPercent,
        triggered: analysis.triggered,
        candles: analysis.candleCount,
      },
      analysis.triggered
        ? `${analysis.symbol} is ${analysis.dropPercent}% below its ${this.#lookbackMonths}-month high — threshold reached`
        : `${analysis.symbol} is ${analysis.dropPercent}% below its ${this.#lookbackMonths}-month high — below threshold`,
    );

    const kind = this.#decide(analysis);
    if (kind) await this.#notifier.send(this.#composer.compose(kind, analysis));

    return { ...analysis, notified: Boolean(kind), messageKind: kind };
  }

  /**
   * Which message this run has earned, if any. At most one: an alert already
   * says everything the digest would have, so a triggered check never sends
   * both, and FORCE_NOTIFY outranks the digest so a delivery test is never
   * mistaken for the monthly report.
   *
   * @returns {'alert'|'test'|'digest'|null}
   */
  #decide(analysis) {
    if (analysis.triggered) return 'alert';

    if (this.#forceNotify) {
      this.#logger.warn('FORCE_NOTIFY is on — sending the message anyway to test delivery');
      return 'test';
    }

    if (this.#isDigestDay()) {
      this.#logger.info('first weekday of the month — sending the monthly digest');
      return 'digest';
    }

    return null;
  }

  /**
   * True on the first Monday-to-Friday of the month, so a schedule that skips
   * weekends never misses one and a daily schedule still sends only one.
   */
  #isDigestDay() {
    if (!this.#monthlyDigest) return false;

    const today = this.#now();
    if (Calendar.isWeekend(today)) return false;
    // When the 1st is a Saturday or Sunday, the first weekday is the Monday after.
    return today.getDate() === 1 || (today.getDay() === 1 && today.getDate() <= 3);
  }
}
