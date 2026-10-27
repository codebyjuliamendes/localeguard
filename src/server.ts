import { ConfigError, loadConfig } from './config.js';
import { buildApp } from './http/app.js';
import { openDatabase } from './store/database.js';
import { seedDemo } from './store/demo.js';
import { Repository } from './store/repository.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  if (config.seedDemo) seedDemo(new Repository(db));
  const app = await buildApp({ config, db });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      app.log.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    timer.unref();
    app.close().then(
      () => {
        app.log.info('shutdown complete');
        process.exit(0);
      },
      (error: unknown) => {
        app.log.error({ err: error }, 'error during shutdown');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ err: reason }, 'unhandled rejection');
    shutdown('SIGTERM');
  });

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  // Logger may not exist yet (bad config); write a single structured line.
  const message = error instanceof ConfigError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${JSON.stringify({ level: 'fatal', msg: 'failed to start', error: message })}\n`);
  process.exit(1);
});
