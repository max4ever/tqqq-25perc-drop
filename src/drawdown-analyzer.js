import { Calendar } from './calendar.js';

/**
 * Turns a price window into a drawdown verdict: how far the current price sits
 * below the highest high of the window, and whether that clears the threshold.
 */
export class DrawdownAnalyzer {
  #thresholdPercent;

  constructor({ thresholdPercent }) {
    this.#thresholdPercent = thresholdPercent;
  }

  /** @param {object} window as returned by PriceHistoryProvider#fetchWindow */
  analyze(window) {
    const peak = this.#findPeak(window.candles);
    const currentPrice = window.currentPrice;
    const dropPercent = ((peak.high - currentPrice) / peak.high) * 100;
    const triggered = dropPercent >= this.#thresholdPercent;

    return {
      symbol: window.symbol,
      name: window.name,
      currency: window.currency,
      peakPrice: this.#round(peak.high),
      peakDate: peak.date,
      currentPrice: this.#round(currentPrice),
      currentPriceAsOf: window.currentPriceAsOf,
      dropPercent: this.#round(dropPercent),
      monthChangePercent: this.#monthChangePercent(window.candles, currentPrice),
      thresholdPercent: this.#thresholdPercent,
      remainingToThresholdPercent: this.#round(Math.max(0, this.#thresholdPercent - dropPercent)),
      priceAtThreshold: this.#round(peak.high * (1 - this.#thresholdPercent / 100)),
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      candleCount: window.candles.length,
      triggered,
    };
  }

  /**
   * How the price moved over the last calendar month, measured against the
   * newest candle that is already a month old — so a weekend or a bank holiday
   * shifts the comparison to the previous trading day instead of losing it.
   *
   * @returns {number|null} null when the window is shorter than a month
   */
  #monthChangePercent(candles, currentPrice) {
    const aMonthBefore = Calendar.subtractMonths(candles.at(-1).date, 1).getTime();
    const reference = candles.findLast((candle) => candle.date.getTime() <= aMonthBefore);
    if (!reference || !(reference.close > 0)) return null;
    return this.#round(((currentPrice - reference.close) / reference.close) * 100);
  }

  #findPeak(candles) {
    let peak = candles[0];
    for (const candle of candles) {
      if (candle.high > peak.high) peak = candle;
    }
    if (!peak || !(peak.high > 0)) {
      throw new Error('No positive high found in the price window');
    }
    return peak;
  }

  #round(value) {
    return Math.round(value * 100) / 100;
  }
}
