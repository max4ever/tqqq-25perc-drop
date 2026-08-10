import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Remembers when an alert last went out so a symbol sitting below the threshold
 * for weeks does not produce one Telegram message per cron tick.
 *
 * Kept in memory, and additionally persisted to STATE_FILE when one is set
 * (point that at a Railway volume if you want the cooldown to survive redeploys).
 */
export class AlertStateStore {
  #filePath;
  #cooldownMs;
  #logger;
  #state = {};
  #loaded = false;

  constructor({ filePath, cooldownHours, logger }) {
    this.#filePath = filePath ?? null;
    this.#cooldownMs = cooldownHours * 60 * 60 * 1000;
    this.#logger = logger.child({ component: 'alert-state' });
  }

  /** Alerts are suppressed while the previous one for `key` is still within its cooldown. */
  async isSuppressed(key) {
    if (this.#cooldownMs <= 0) return { suppressed: false, lastAlertAt: null, nextAllowedAt: null };

    await this.#load();
    const lastAlertAt = this.#state[key]?.lastAlertAt;
    if (!lastAlertAt) return { suppressed: false, lastAlertAt: null, nextAllowedAt: null };

    const last = new Date(lastAlertAt);
    const nextAllowedAt = new Date(last.getTime() + this.#cooldownMs);
    return { suppressed: nextAllowedAt > new Date(), lastAlertAt: last, nextAllowedAt };
  }

  async recordAlert(key, details = {}) {
    await this.#load();
    this.#state[key] = { lastAlertAt: new Date().toISOString(), ...details };
    await this.#persist();
  }

  async #load() {
    if (this.#loaded) return;
    this.#loaded = true;
    if (!this.#filePath) return;

    try {
      const raw = await readFile(this.#filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') this.#state = parsed;
      this.#logger.debug({ keys: Object.keys(this.#state).length }, 'alert state loaded');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.#logger.warn({ err: error }, 'could not read alert state, starting empty');
      }
    }
  }

  async #persist() {
    if (!this.#filePath) return;
    try {
      await mkdir(dirname(this.#filePath), { recursive: true });
      await writeFile(this.#filePath, JSON.stringify(this.#state, null, 2), 'utf8');
    } catch (error) {
      // A missing volume must never break the alerting path.
      this.#logger.warn({ err: error }, 'could not persist alert state');
    }
  }
}
