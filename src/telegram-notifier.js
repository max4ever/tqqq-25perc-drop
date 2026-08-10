const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'apikey',
  'api_key',
  'key',
  'secret',
  'password',
  'chat_id',
  'chatid',
  'user',
  'username',
  'phone',
]);

/**
 * Calls the user-supplied webhook URL that delivers the Telegram message.
 *
 * The URL shape is deliberately open-ended so it works with the raw Bot API
 * (`https://api.telegram.org/bot<token>/sendMessage?chat_id=…`), CallMeBot,
 * IFTTT, n8n, or anything else that answers to an HTTP call:
 *
 *  - contains `{message}`  → the placeholder is replaced with the URL-encoded text
 *  - otherwise             → the text is added as a query parameter (default `text`)
 *
 * With TELEGRAM_METHOD=POST the text is *also* sent as a JSON body.
 */
export class TelegramNotifier {
  #url;
  #method;
  #messageParam;
  #timeoutMs;
  #retries;
  #dryRun;
  #logger;

  constructor({ url, method, messageParam, timeoutMs, retries, dryRun, logger }) {
    this.#url = url;
    this.#method = method;
    this.#messageParam = messageParam;
    this.#timeoutMs = timeoutMs;
    this.#retries = retries;
    this.#dryRun = dryRun;
    this.#logger = logger.child({ component: 'telegram' });
  }

  async send(message) {
    const target = this.#buildUrl(message);
    const safeTarget = this.#redact(target);

    if (this.#dryRun) {
      this.#logger.warn({ endpoint: safeTarget, message }, 'DRY_RUN enabled — notification not sent');
      return { delivered: false, dryRun: true };
    }

    let lastError;
    for (let attempt = 1; attempt <= this.#retries + 1; attempt += 1) {
      try {
        const response = await this.#dispatch(target, message);
        this.#logger.info({ endpoint: safeTarget, status: response.status, attempt }, 'notification sent');
        return { delivered: true, dryRun: false, status: response.status };
      } catch (error) {
        lastError = error;
        const isLastAttempt = attempt === this.#retries + 1;
        this.#logger.warn(
          { endpoint: safeTarget, attempt, err: error, willRetry: !isLastAttempt },
          'notification attempt failed',
        );
        if (isLastAttempt) break;
        await this.#sleep(this.#backoffMs(attempt));
      }
    }

    throw new Error(`Telegram notification failed after ${this.#retries + 1} attempt(s): ${lastError?.message}`, {
      cause: lastError,
    });
  }

  async #dispatch(target, message) {
    const request = {
      method: this.#method,
      signal: AbortSignal.timeout(this.#timeoutMs),
      headers: { 'user-agent': 'stock-drop-alert/1.0' },
    };

    if (this.#method === 'POST') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify({ [this.#messageParam]: message, text: message });
    }

    const response = await fetch(target, request);
    if (!response.ok) {
      const body = (await response.text().catch(() => '')).slice(0, 500);
      throw new Error(`HTTP ${response.status} ${response.statusText} — ${body}`);
    }
    return response;
  }

  #buildUrl(message) {
    if (this.#url.includes('{message}')) {
      return this.#url.replaceAll('{message}', encodeURIComponent(message));
    }

    const url = new URL(this.#url);
    url.searchParams.set(this.#messageParam, message);
    return url.toString();
  }

  /** Never let a bot token or chat id reach the logs. */
  #redact(rawUrl) {
    try {
      const url = new URL(rawUrl);
      url.pathname = url.pathname
        .split('/')
        .map((segment) => (/^bot\d+:/i.test(segment) ? 'bot[redacted]' : segment))
        .join('/');

      for (const key of [...url.searchParams.keys()]) {
        if (key === this.#messageParam) {
          url.searchParams.set(key, '[message]');
        } else if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
          url.searchParams.set(key, '[redacted]');
        }
      }
      return `${url.origin}${url.pathname}${url.search}`;
    } catch {
      return '[unparseable url]';
    }
  }

  #backoffMs(attempt) {
    const base = Math.min(1000 * 2 ** (attempt - 1), 15_000);
    return base + Math.floor(Math.random() * 250);
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
