const API_ORIGIN = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

/**
 * Posts the alert to the Telegram Bot API.
 *
 * Only the bot token and the chat id are configurable — the endpoint, method and
 * payload are this class's business. The token never reaches the logs.
 */
export class TelegramNotifier {
  #botToken;
  #chatId;
  #logger;

  constructor({ botToken, chatId, logger }) {
    this.#botToken = botToken;
    this.#chatId = chatId;
    this.#logger = logger.child({ component: 'telegram' });
  }

  async send(text) {
    let lastError;
    let attempts = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      try {
        await this.#post(text);
        this.#logger.info({ chatId: this.#chatId, attempt }, 'notification sent');
        return;
      } catch (error) {
        lastError = error;
        const canRetry = error.retryable && attempt < MAX_ATTEMPTS;
        this.#logger.warn({ attempt, err: error, willRetry: canRetry }, 'notification attempt failed');
        if (!canRetry) break;
        await this.#sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }

    // The cause carries the detail; repeating it here would double it in the logs.
    throw new Error(`Telegram notification failed after ${attempts} attempt(s)`, {
      cause: lastError,
    });
  }

  async #post(text) {
    let response;
    try {
      response = await fetch(`${API_ORIGIN}/bot${this.#botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.#chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Network-level failure: worth another go.
      throw this.#fail(`could not reach ${API_ORIGIN}: ${error.message}`, true, error);
    }

    if (response.ok) return;

    const detail = await this.#describeFailure(response);
    // A bad token or chat id will fail identically forever; rate limits and
    // Telegram-side errors will not.
    const retryable = response.status === 429 || response.status >= 500;
    throw this.#fail(`HTTP ${response.status} — ${detail}`, retryable);
  }

  async #describeFailure(response) {
    const body = await response.text().catch(() => '');
    try {
      return JSON.parse(body).description ?? body.slice(0, 200);
    } catch {
      return body.slice(0, 200) || response.statusText;
    }
  }

  #fail(message, retryable, cause) {
    const error = new Error(message, cause ? { cause } : undefined);
    error.retryable = retryable;
    return error;
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
