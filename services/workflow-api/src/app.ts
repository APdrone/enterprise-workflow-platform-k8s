import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { tenantMiddleware } from './middleware/tenant.middleware.js';
import { rateLimitMiddleware } from './middleware/rate-limit.middleware.js';
import { idempotencyMiddleware } from './middleware/idempotency.middleware.js';
import { workflowRoutes } from './routes/workflow.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { rulesRoutes } from './routes/rules.routes.js';
import { telemetryPlugin } from '@workflow/telemetry';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  // Telemetry & Metrics plugin
  await app.register(telemetryPlugin, { serviceName: 'workflow-api' });

  await app.register(sensible);
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-tenant-id',
      'x-user-id',
      'x-user-name',
      'x-user-role',
      'x-correlation-id',
      'x-request-id',
      'x-admin-token',
      'idempotency-key',
      'traceparent',
    ],
    exposedHeaders: [
      'x-correlation-id',
      'traceparent',
      'x-idempotent-replay',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
  });

  // Global tenant middleware
  app.addHook('onRequest', tenantMiddleware);

  // Tenant-aware rate limiting (Noisy Neighbor protection)
  app.addHook('preHandler', rateLimitMiddleware);

  // Idempotency pre-handler for POST/PUT/PATCH/DELETE
  app.addHook('preHandler', idempotencyMiddleware);

  // Register workflow, rules, and admin routes
  await app.register(workflowRoutes);
  await app.register(rulesRoutes);
  await app.register(adminRoutes);

  return app;
}
