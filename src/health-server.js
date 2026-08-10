import { createServer } from 'node:http';

/**
 * Minimal HTTP surface so Railway (and you) can see the worker is alive and
 * what the last check concluded. No framework — one file, zero dependencies.
 */
export class HealthServer {
  #port;
  #logger;
  #getSnapshot;
  #server = null;

  constructor({ port, getSnapshot, logger }) {
    this.#port = port;
    this.#getSnapshot = getSnapshot;
    this.#logger = logger.child({ component: 'health' });
  }

  async start() {
    this.#server = createServer((req, res) => this.#handle(req, res));

    await new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(this.#port, '0.0.0.0', () => {
        this.#server.removeListener('error', reject);
        resolve();
      });
    });

    this.#logger.info({ port: this.#port }, 'health server listening');
  }

  async stop() {
    if (!this.#server) return;
    await new Promise((resolve) => this.#server.close(resolve));
    this.#server = null;
    this.#logger.info('health server stopped');
  }

  #handle(req, res) {
    const path = new URL(req.url, 'http://localhost').pathname;

    if (path === '/health' || path === '/healthz' || path === '/') {
      return this.#json(res, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
    }
    if (path === '/status') {
      return this.#json(res, 200, this.#getSnapshot());
    }
    return this.#json(res, 404, { error: 'not found' });
  }

  #json(res, status, payload) {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    res.end(body);
  }
}
