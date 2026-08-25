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
      this.#logger.info(
        { dayOfMonth: this.#monthlyDigest.dayOfMonth },
        'digest day — sending the monthly digest',
      );
      return 'digest';
    }

    return null;
  }

  /**
   * True on the configured day of the month, in the container's own timezone
   * (set `TZ` to move it). With nothing remembering the last digest, the
   * schedule decides how often this lands: once a month on a daily run, once
   * per run on that day if the job runs more often than that.
   */
  #isDigestDay() {
    if (!this.#monthlyDigest.enabled) return false;

    const today = this.#now();
    // A day the month is too short for means its last day, so asking for the
    // 31st still gets you a February digest rather than silent nothing.
    const digestDay = Math.min(this.#monthlyDigest.dayOfMonth, Calendar.daysInMonth(today));
    return today.getDate() === digestDay;
  }
}
