import { Cron } from 'croner';
import YahooFinance from 'yahoo-finance2';

import { AlertStateStore } from './alert-state-store.js';
import { DrawdownAnalyzer } from './drawdown-analyzer.js';
import { DropWatcher } from './drop-watcher.js';
import { HealthServer } from './health-server.js';
import { PriceHistoryProvider } from './price-history-provider.js';
import { TelegramNotifier } from './telegram-notifier.js';

/**
 * Composition root and lifecycle owner.
 *
 * RUN_MODE=once     → run a single check, then exit (Railway cron job style).
 * RUN_MODE=schedule → stay up, run on CHECK_CRON, expose a health endpoint.
 */
export class App {
  #config;
  #logger;
  #watcher;
  #healthServer;
  #job = null;
  #lastResult = null;
  #lastError = null;
  #checkInFlight = false;
  #shuttingDown = false;

  constructor({ config, logger }) {
    this.#config = config;
    this.#logger = logger;
    this.#watcher = this.#buildWatcher();
    this.#healthServer = config.healthServerEnabled && config.runMode === 'schedule'
      ? new HealthServer({
          port: config.port,
          getSnapshot: () => this.#snapshot(),
          logger,
        })
      : null;
  }

  async start() {
    this.#logger.info({ config: this.#config.describe() }, 'starting stock-drop-alert');

    if (this.#config.runMode === 'once') {
      const result = await this.#runCheck();
      if (this.#lastError) throw this.#lastError;
      return result;
    }

    await this.#healthServer?.start();
    this.#registerSignalHandlers();

    this.#job = new Cron(
      this.#config.checkCron,
      { timezone: this.#config.cronTimezone, protect: true, catch: true },
      () => this.#runCheck(),
    );

    this.#logger.info(
      { cron: this.#config.checkCron, timezone: this.#config.cronTimezone, nextRun: this.#job.nextRun() },
      'schedule armed',
    );

    if (this.#config.runOnStart) await this.#runCheck();
    return null;
  }

  async stop() {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    this.#logger.info('shutting down');
    this.#job?.stop();
    await this.#healthServer?.stop();
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

  async #runCheck() {
    if (this.#checkInFlight) {
      this.#logger.warn('previous check still running — skipping this tick');
      return null;
    }

    this.#checkInFlight = true;
    try {
      const result = await this.#watcher.check();
      this.#lastResult = result;
      this.#lastError = null;
      return result;
    } catch (error) {
      this.#lastError = error;
      this.#logger.error({ err: error }, 'check failed');
      // Marked so the entrypoint can exit without logging the same stack twice.
      error.alreadyLogged = true;
      return null;
    } finally {
      this.#checkInFlight = false;
    }
  }

  #snapshot() {
    return {
      status: this.#lastError ? 'degraded' : 'ok',
      config: this.#config.describe(),
      nextRun: this.#job?.nextRun() ?? null,
      lastCheck: this.#lastResult,
      lastError: this.#lastError ? { message: this.#lastError.message } : null,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  #registerSignalHandlers() {
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.once(signal, () => {
        this.#logger.info({ signal }, 'signal received');
        this.stop()
          .catch((error) => this.#logger.error({ err: error }, 'error during shutdown'))
          .finally(() => process.exit(0));
      });
    }
  }
}
