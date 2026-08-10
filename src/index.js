import { App } from './app.js';
import { Config } from './config.js';
import { createLogger } from './logger.js';

try {
  // Node's own .env loader. Real environment variables still take precedence.
  process.loadEnvFile();
} catch {
  // No .env file, which is the normal case in a container.
}

let config;
try {
  config = new Config(process.env);
} catch (error) {
  // The logger needs a valid config, so config errors go straight to stderr.
  console.error(error.message);
  process.exit(78); // EX_CONFIG
}

const logger = createLogger(config);

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection');
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});

try {
  await new App({ config, logger }).run();
  process.exit(0);
} catch (error) {
  logger.fatal({ err: error }, 'check failed');
  process.exit(1);
}
