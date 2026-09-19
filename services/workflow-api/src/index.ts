import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { eventProducer } from './kafka/producer.js';
import { outboxRelayService } from './services/outbox.relay.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    // Run database migrations on startup
    await runMigrations();

    // Connect to Kafka producer
    await eventProducer.connect();

    // Start background Transactional Outbox relay worker
    outboxRelayService.startWorker(2000);
    console.log('[workflow-api] Outbox relay worker started.');

    const app = await buildApp();
    await app.listen({ port: PORT, host: HOST });
    console.log(`[workflow-api] Server running on http://${HOST}:${PORT}`);

    const shutdown = async () => {
      console.log('[workflow-api] Gracefully shutting down...');
      outboxRelayService.stopWorker();
      await eventProducer.disconnect();
      await app.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[workflow-api] Error starting server:', err);
    process.exit(1);
  }
}

start();
