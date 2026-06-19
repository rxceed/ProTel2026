import { app } from './app';
import { config } from './config';
import { testConnection, closePool } from './db/client';
import { logger } from './shared/utils/logger.util';
import { startScheduler, stopScheduler } from './modules/scheduler/scheduler.service';
import { startMqttListener } from './modules/telemetry/mqtt.service';

async function bootstrap(): Promise<void> {
  logger.info(`Starting Smart AWD Server 1 [${config.NODE_ENV}]...`);

  // 1. Verify database connection before accepting traffic
  await testConnection();

  // 2. Start HTTP server
  const server = app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      `🚀 Server 1 listening on port ${config.PORT}`,
    );
    // 3. Start cron scheduler (after server is up, non-blocking)
    if (config.NODE_ENV !== 'test') {
      startScheduler();
      startMqttListener();
    }
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');

    server.close(async () => {
      logger.info('HTTP server closed');
      stopScheduler();
      await closePool();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Force exit setelah 10 detik jika graceful shutdown gagal
    setTimeout(() => {
      logger.error('Forced exit after 10s timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception — shutting down');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
