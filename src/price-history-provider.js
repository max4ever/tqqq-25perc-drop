import { Calendar } from './calendar.js';

/**
 * Thin wrapper around the Yahoo Finance chart endpoint.
 *
 * Its only job is to hand back a clean, chronologically sorted window of daily
 * candles plus the latest known price — no analysis lives here.
 */
export class PriceHistoryProvider {
  #client;
  #logger;

  constructor({ client, logger }) {
    this.#client = client;
    this.#logger = logger.child({ component: 'price-history' });
  }

  /**
   * @param {string} symbol
   * @param {number} months how far back the window reaches
   */
  async fetchWindow(symbol, months) {
    const end = new Date();
    const start = Calendar.subtractMonths(end, months);

    this.#logger.debug(
      { from: start.toISOString(), to: end.toISOString(), months },
      'fetching daily candles',
    );

    const chart = await this.#client.chart(symbol, {
      period1: start,
      period2: end,
      interval: '1d',
    });

    const candles = this.#normaliseCandles(chart.quotes ?? []);
    if (candles.length === 0) {
      throw new Error(`Yahoo Finance returned no usable candles for "${symbol}"`);
    }

    const meta = chart.meta ?? {};
    const lastCandle = candles.at(-1);
    const livePrice = this.#firstFiniteNumber([meta.regularMarketPrice, lastCandle.close]);

    if (livePrice === null) {
      throw new Error(`Could not determine a current price for "${symbol}"`);
    }

    this.#logger.debug(
      { candles: candles.length, livePrice, firstDate: candles[0].date, lastDate: lastCandle.date },
      'candles fetched',
    );

    return {
      symbol: meta.symbol ?? symbol,
      currency: meta.currency ?? 'USD',
      name: meta.longName ?? meta.shortName ?? null,
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
      windowStart: candles[0].date,
      windowEnd: lastCandle.date,
      candles,
      currentPrice: livePrice,
      currentPriceAsOf: meta.regularMarketTime instanceof Date ? meta.regularMarketTime : lastCandle.date,
    };
  }

  /** Keeps only candles we can actually reason about, sorted oldest → newest. */
  #normaliseCandles(rawCandles) {
    return rawCandles
      .map((candle) => {
        const date = candle.date instanceof Date ? candle.date : new Date(candle.date);
        const high = this.#firstFiniteNumber([candle.high, candle.close, candle.open]);
        const close = this.#firstFiniteNumber([candle.close, candle.high, candle.open]);
        return { date, high, close };
      })
      .filter(
        (candle) =>
          !Number.isNaN(candle.date?.getTime?.()) && candle.high !== null && candle.high > 0,
      )
      .sort((a, b) => a.date - b.date);
  }

  #firstFiniteNumber(candidates) {
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    }
    return null;
  }
}
