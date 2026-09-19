import { buildAuditApp } from './app.js';
import { runAuditMigrations } from './db/migrate.js';
import { AuditConsumer } from './consumer.js';

const PORT = parseInt(process.env.PORT || '3002', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    await runAuditMigrations();

    const consumer = new AuditConsumer();
    await consumer.start();

    const app = await buildAuditApp();
    await app.listen({ port: PORT, host: HOST });
    console.log(`[audit-service] Server running on http://${HOST}:${PORT}`);
  } catch (err) {
    console.error('[audit-service] Error starting server:', err);
    process.exit(1);
  }
}

start();
