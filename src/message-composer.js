/**
 * Turns an analysis into the exact text that reaches Telegram.
 *
 * Three shapes share one layout: the alert the job exists for, the monthly
 * digest that reports nothing happened, and the FORCE_NOTIFY test message.
 */
export class MessageComposer {
  #lookbackMonths;

  constructor({ lookbackMonths }) {
    this.#lookbackMonths = lookbackMonths;
  }

  /** @param {'alert'|'digest'|'test'} kind as decided by DropWatcher */
  compose(kind, analysis) {
    switch (kind) {
      case 'alert':
        return this.#alert(analysis);
      case 'digest':
        return this.#digest(analysis);
      case 'test':
        return this.#test(analysis);
      default:
        throw new Error(`Unknown message kind "${kind}"`);
    }
  }

  /** Leads with the day's low, which is what fired it; `Now` shows any recovery since. */
  #alert(analysis) {
    return this.#lines([
      `📉 ${this.#title(analysis)} dropped ${analysis.dayLowDropPercent}% from its ${this.#lookbackMonths}-month high.`,
      '',
      `Threshold: -${analysis.thresholdPercent}%`,
      this.#high(analysis),
      `Low:       ${this.#money(analysis, analysis.dayLow)} on ${this.#date(analysis.dayLowDate)}, -${analysis.dayLowDropPercent}%`,
      `${this.#now(analysis)}, -${analysis.dropPercent}%`,
      this.#window(analysis),
    ]);
  }

  #test(analysis) {
    return this.#lines([
      `🧪 Test message — no alert. ${this.#title(analysis)} is ${analysis.dropPercent}% below its ${this.#lookbackMonths}-month high, which has not reached the threshold.`,
      '',
      `Threshold: -${analysis.thresholdPercent}%`,
      this.#high(analysis),
      this.#now(analysis),
      this.#window(analysis),
    ]);
  }

  /**
   * The quiet-month message. It leads with the fact that nothing fired, so a
   * glance at the notification is enough to tell it from a real alert.
   */
  #digest(analysis) {
    return this.#lines([
      `🗓 Monthly digest — ${this.#title(analysis)}`,
      '',
      `No alert. ${analysis.dropPercent}% below its ${this.#lookbackMonths}-month high, and the threshold is ${analysis.thresholdPercent}%.`,
      '',
      this.#now(analysis),
      this.#month(analysis),
      this.#high(analysis),
      this.#alertAt(analysis),
      this.#window(analysis),
    ]);
  }

  #high(analysis) {
    return `High:      ${this.#money(analysis, analysis.peakPrice)} on ${this.#date(analysis.peakDate)}`;
  }

  #now(analysis) {
    return `Now:       ${this.#money(analysis, analysis.currentPrice)} (${this.#date(analysis.currentPriceAsOf)})`;
  }

  /** Dropped entirely when the window is too short to hold a month of trading. */
  #month(analysis) {
    if (analysis.monthChangePercent === null) return null;
    const sign = analysis.monthChangePercent > 0 ? '+' : '';
    return `Month:     ${sign}${analysis.monthChangePercent}%`;
  }

  #alertAt(analysis) {
    return (
      `Alert at:  ${this.#money(analysis, analysis.priceAtThreshold)}` +
      `, another ${analysis.remainingToThresholdPercent}% down`
    );
  }

  #window(analysis) {
    return `Window:    ${this.#date(analysis.windowStart)} → ${this.#date(analysis.windowEnd)}`;
  }

  #title(analysis) {
    return analysis.name ? `${analysis.symbol} (${analysis.name})` : analysis.symbol;
  }

  #money(analysis, value) {
    return `${value.toFixed(2)} ${analysis.currency}`;
  }

  #date(date) {
    const value = date instanceof Date ? date : new Date(date);
    return Number.isNaN(value.getTime()) ? 'unknown' : value.toISOString().slice(0, 10);
  }

  /** Joins the lines a shape asked for, minus the ones that had nothing to say. */
  #lines(lines) {
    return lines.filter((line) => line !== null).join('\n');
  }
}
