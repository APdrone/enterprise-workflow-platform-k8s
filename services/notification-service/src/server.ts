import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { notificationStore } from './store.js';
import { telemetryPlugin } from '@workflow/telemetry';

export async function buildNotificationServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(telemetryPlugin, { serviceName: 'notification-service' });
  await app.register(cors, { origin: true });

  // Root Service Information Endpoint
  app.get('/', async () => {
    return {
      service: 'notification-service',
      name: 'Workflow Platform Notification Service',
      status: 'online',
      version: '1.0.0',
      description: 'Kafka event consumer for workflow lifecycle alerts & notifications',
      endpoints: {
        health: 'GET /health',
        listNotifications: 'GET /api/v1/notifications?tenantId=...&recipientId=...',
      },
      uiUrl: 'http://localhost:5173/notifications',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/health', async () => {
    return { status: 'ok', service: 'notification-service', timestamp: new Date().toISOString() };
  });

  app.get<{ Querystring: { tenantId?: string; recipientId?: string } }>(
    '/api/v1/notifications',
    async (request, reply) => {
      const { tenantId, recipientId } = request.query;
      const list = notificationStore.getNotifications(tenantId, recipientId);
      return { success: true, data: list };
    }
  );

  return app;
}
