import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { auditRoutes } from './routes/audit.routes.js';
import { telemetryPlugin } from '@workflow/telemetry';

export async function buildAuditApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  await app.register(telemetryPlugin, { serviceName: 'audit-service' });
  await app.register(sensible);
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-user-id', 'x-user-name', 'x-correlation-id', 'traceparent'],
    exposedHeaders: ['x-correlation-id', 'traceparent'],
  });

  await app.register(auditRoutes);

  return app;
}
