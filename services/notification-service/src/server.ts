import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { notificationStore } from './store.js';
import { sseManager } from './sse.js';
import { telemetryPlugin } from '@workflow/telemetry';
import { NotificationConsumer } from './consumer.js';

export async function buildNotificationServer(consumer?: NotificationConsumer): Promise<FastifyInstance> {
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
        live: 'GET /health/live',
        ready: 'GET /health/ready',
        listNotifications: 'GET /api/v1/notifications?tenantId=...&recipientId=...',
        realtimeStream: 'GET /api/v1/stream?tenantId=...&userId=...',
      },
      uiUrl: 'http://localhost:5173/notifications',
      timestamp: new Date().toISOString(),
    };
  });

  // Liveness Probe
  const livenessHandler = async () => ({
    status: 'ok',
    service: 'notification-service',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });

  app.get('/health', livenessHandler);
  app.get('/health/live', livenessHandler);

  // Readiness Probe
  const readinessHandler = async (_: any, reply: any) => {
    const isKafkaConnected = consumer ? consumer.isConnected : true;
    return reply.status(200).send({
      status: 'ready',
      service: 'notification-service',
      checks: {
        kafkaConsumer: isKafkaConnected ? 'ok' : 'standalone-or-reconnecting',
      },
      timestamp: new Date().toISOString(),
    });
  };

  app.get('/ready', readinessHandler);
  app.get('/health/ready', readinessHandler);


  app.get<{ Querystring: { tenantId?: string; recipientId?: string } }>(
    '/api/v1/notifications',
    async (request, reply) => {
      const { tenantId, recipientId } = request.query;
      const list = notificationStore.getNotifications(tenantId, recipientId);
      return { success: true, data: list };
    }
  );

  // Server-Sent Events (SSE) Real-Time Live Stream
  app.get<{ Querystring: { tenantId?: string; userId?: string } }>(
    '/api/v1/stream',
    async (request, reply) => {
      const tenantId = request.query.tenantId || 'tenant-corp-a';
      const userId = request.query.userId;
      reply.hijack();
      sseManager.addClient(tenantId, userId, reply.raw);
    }
  );

  return app;
}
