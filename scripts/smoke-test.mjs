#!/usr/bin/env node
/**
 * Build-time sanity check: every module resolves, the config validates and the
 * whole object graph can be constructed. Runs offline — no market data, no
 * webhook call — so it is safe inside `docker build`.
 *
 * Its real job is catching an over-eager `prune-modules.mjs` at build time.
 */
import { Config } from '../src/config.js';
import { App } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { DrawdownAnalyzer } from '../src/drawdown-analyzer.js';

const config = new Config({
  SYMBOL: 'TQQQ',
  TELEGRAM_URL: 'https://example.invalid/send?text={message}',
  DROP_THRESHOLD_PERCENT: '25',
  LOOKBACK_MONTHS: '6',
  DRY_RUN: 'true',
  LOG_LEVEL: 'silent',
});


const logger = createLogger(config);
new App({ config, logger });

const analysis = new DrawdownAnalyzer({ thresholdPercent: 25 }).analyze({
  symbol: 'TQQQ',
  name: null,
  currency: 'USD',
  candles: [
    { date: new Date('2026-01-02'), high: 100, close: 99 },
    { date: new Date('2026-02-02'), high: 120, close: 118 },
    { date: new Date('2026-03-02'), high: 95, close: 90 },
  ],
  currentPrice: 90,
  currentPriceAsOf: new Date('2026-03-02'),
  windowStart: new Date('2026-01-02'),
  windowEnd: new Date('2026-03-02'),
});

if (analysis.peakPrice !== 120) throw new Error(`expected peak 120, got ${analysis.peakPrice}`);
if (analysis.dropPercent !== 25) throw new Error(`expected drop 25, got ${analysis.dropPercent}`);
if (!analysis.triggered) throw new Error('expected a 25% drop to trigger the 25% threshold');

console.log('smoke test ok — modules resolve, config validates, drawdown maths check out');
