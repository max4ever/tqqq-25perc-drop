import { config as loadDotenv } from 'dotenv';

import { App } from './app.js';
import { Config } from './config.js';
import { createLogger } from './logger.js';

loadDotenv({ quiet: true });

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
