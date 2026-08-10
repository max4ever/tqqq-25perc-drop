import YahooFinance from 'yahoo-finance2';

import { AlertStateStore } from './alert-state-store.js';
import { DrawdownAnalyzer } from './drawdown-analyzer.js';
import { DropWatcher } from './drop-watcher.js';
import { PriceHistoryProvider } from './price-history-provider.js';
import { TelegramNotifier } from './telegram-notifier.js';

/**
 * Composition root. Builds the object graph, runs exactly one check, and
 * returns — the schedule lives outside the container.
 */
export class App {
  #config;
  #logger;
  #watcher;

  constructor({ config, logger }) {
    this.#config = config;
    this.#logger = logger;
    this.#watcher = this.#buildWatcher();
  }

  async run() {
    this.#logger.info({ config: this.#config.describe() }, 'starting stock-drop-alert');
    const result = await this.#watcher.check();
    this.#logger.info({ triggered: result.triggered, notified: result.notified }, 'check complete');
    return result;
  }

  #buildWatcher() {
    const config = this.#config;
    const telegram = config.telegram;

    return new DropWatcher({
      symbol: config.symbol,
      lookbackMonths: config.lookbackMonths,
      priceHistory: new PriceHistoryProvider({
        client: this.#buildYahooClient(),
        logger: this.#logger,
      }),
      analyzer: new DrawdownAnalyzer({ thresholdPercent: config.dropThresholdPercent }),
      notifier: new TelegramNotifier({
        url: telegram.url,
        method: telegram.method,
        messageParam: telegram.messageParam,
        timeoutMs: telegram.timeoutMs,
        retries: telegram.retries,
        dryRun: config.dryRun,
        logger: this.#logger,
      }),
      stateStore: new AlertStateStore({
        filePath: config.stateFile,
        cooldownHours: config.alertCooldownHours,
        logger: this.#logger,
      }),
      logger: this.#logger,
    });
  }

  /** Routes yahoo-finance2's own chatter through pino instead of bare console. */
  #buildYahooClient() {
    const log = this.#logger.child({ component: 'yahoo-finance' });
    const forward = (level) => (...args) => log[level](args.map((arg) => String(arg)).join(' '));

    return new YahooFinance({
      suppressNotices: ['yahooSurvey', 'ripHistorical'],
      logger: {
        info: forward('debug'),
        debug: forward('debug'),
        warn: forward('warn'),
        error: forward('error'),
        dir: forward('debug'),
      },
    });
  }
}
