import YahooFinance from 'yahoo-finance2';

import { DrawdownAnalyzer } from './drawdown-analyzer.js';
import { DropWatcher } from './drop-watcher.js';
import { MessageComposer } from './message-composer.js';
import { PriceHistoryProvider } from './price-history-provider.js';
import { TelegramNotifier } from './telegram-notifier.js';

/**
 * Composition root. Builds the object graph, runs exactly one check, and
 * returns — the container holds no state and the schedule lives outside it.
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
    this.#logger.info(
      { triggered: result.triggered, notified: result.notified, messageKind: result.messageKind },
      'check complete',
    );
    return result;
  }

  #buildWatcher() {
    const config = this.#config;

    return new DropWatcher({
      symbol: config.symbol,
      lookbackMonths: config.lookbackMonths,
      priceHistory: new PriceHistoryProvider({
        client: this.#buildYahooClient(),
        logger: this.#logger,
      }),
      analyzer: new DrawdownAnalyzer({ thresholdPercent: config.dropThresholdPercent }),
      composer: new MessageComposer({ lookbackMonths: config.lookbackMonths }),
      notifier: new TelegramNotifier({ ...config.telegram, logger: this.#logger }),
      forceNotify: config.forceNotify,
      monthlyDigest: config.monthlyDigest,
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
