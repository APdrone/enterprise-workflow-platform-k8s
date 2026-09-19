import { buildNotificationServer } from './server.js';
import { NotificationConsumer } from './consumer.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const consumer = new NotificationConsumer();
  await consumer.start();

  const server = await buildNotificationServer();
  await server.listen({ port: PORT, host: HOST });
  console.log(`[notification-service] Server running on http://${HOST}:${PORT}`);
}

start().catch((err) => {
  console.error('[notification-service] Failed to start:', err);
  process.exit(1);
});
