import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, asc, desc } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { auditEvents, dlqMessages } from '../db/schema.js';
import { auditConsumerInstance } from '../consumer.js';

export const auditRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Service Root Information Endpoint
  fastify.get('/', async () => {
    return {
      service: 'audit-service',
      name: 'Workflow Platform Audit & Compliance Ledger',
      status: 'online',
      version: '1.0.0',
      description: 'Kafka event consumer persisting immutable audit records in Postgres with DLQ and replay capabilities',
      endpoints: {
        health: 'GET /health',
        live: 'GET /health/live',
        ready: 'GET /health/ready',
        getAuditTrail: 'GET /api/v1/audit/:workflowId (requires x-tenant-id)',
        getDLQMessages: 'GET /api/v1/dlq/messages (optional query ?tenantId=&status=)',
        replayDLQMessage: 'POST /api/v1/dlq/replay/:id',
      },
      uiUrl: 'http://localhost:5173/audit',
      timestamp: new Date().toISOString(),
    };
  });

  // Liveness Probe
  const livenessHandler = async () => ({
    status: 'ok',
    service: 'audit-service',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });

  fastify.get('/health', livenessHandler);
  fastify.get('/health/live', livenessHandler);

  // Readiness Probe (checks DB & Kafka connections)
  const readinessHandler = async (_: any, reply: any) => {
    try {
      await pool.query('SELECT 1');
      return reply.status(200).send({
        status: 'ready',
        service: 'audit-service',
        checks: {
          database: 'ok',
          kafkaConsumer: auditConsumerInstance.isConnected ? 'ok' : 'standalone-or-reconnecting',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      return reply.status(503).send({
        status: 'not_ready',
        service: 'audit-service',
        checks: {
          database: 'error',
          kafkaConsumer: auditConsumerInstance.isConnected ? 'ok' : 'disconnected',
        },
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  };

  fastify.get('/ready', readinessHandler);
  fastify.get('/health/ready', readinessHandler);


  // Get Audit Trail for a Workflow
  fastify.get<{ Params: { workflowId: string } }>(
    '/api/v1/audit/:workflowId',
    async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string;
      const { workflowId } = request.params;

      if (!tenantId || tenantId.trim() === '') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'MISSING_TENANT_ID',
            message: 'x-tenant-id header is required',
          },
        });
      }

      try {
        const records = await db
          .select()
          .from(auditEvents)
          .where(and(eq(auditEvents.workflowId, workflowId), eq(auditEvents.tenantId, tenantId)))
          .orderBy(asc(auditEvents.timestamp));

        const formatted = records.map((r) => ({
          id: r.id,
          workflowId: r.workflowId,
          tenantId: r.tenantId,
          eventType: r.eventType,
          actorId: r.actorId,
          timestamp: r.timestamp.toISOString(),
          payload: r.payload,
          createdAt: r.createdAt.toISOString(),
        }));

        return reply.status(200).send({
          success: true,
          data: {
            workflowId,
            events: formatted,
          },
        });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to retrieve audit trail',
          },
        });
      }
    }
  );

  // GET /api/v1/dlq/messages - List Dead Letter Queue records
  fastify.get<{
    Querystring: {
      tenantId?: string;
      status?: string;
      limit?: string;
    };
  }>('/api/v1/dlq/messages', async (request, reply) => {
    try {
      const { tenantId, status, limit } = request.query;
      const maxLimit = Math.min(parseInt(limit || '50', 10), 100);

      const conditions: any[] = [];
      if (tenantId) {
        conditions.push(eq(dlqMessages.tenantId, tenantId));
      }
      if (status) {
        conditions.push(eq(dlqMessages.status, status));
      }

      const query = conditions.length > 0
        ? db.select().from(dlqMessages).where(and(...conditions)).orderBy(desc(dlqMessages.failedAt)).limit(maxLimit)
        : db.select().from(dlqMessages).orderBy(desc(dlqMessages.failedAt)).limit(maxLimit);

      const records = await query;

      const formatted = records.map((r) => ({
        id: r.id,
        originalTopic: r.originalTopic,
        originalKey: r.originalKey,
        payload: r.payload,
        errorType: r.errorType,
        errorMessage: r.errorMessage,
        retryCount: r.retryCount,
        tenantId: r.tenantId,
        workflowId: r.workflowId,
        headers: r.headers,
        status: r.status,
        failedAt: r.failedAt.toISOString(),
        replayedAt: r.replayedAt ? r.replayedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      }));

      return reply.status(200).send({
        success: true,
        data: {
          total: formatted.length,
          messages: formatted,
        },
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch DLQ messages',
        },
      });
    }
  });

  // POST /api/v1/dlq/replay/:id - Replay a dead-lettered message back into Kafka
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/dlq/replay/:id',
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await auditConsumerInstance.replayDLQMessage(id);
        if (!result.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'REPLAY_FAILED',
              message: result.message,
            },
          });
        }

        return reply.status(200).send({
          success: true,
          data: {
            id,
            status: 'REPLAYED',
            message: result.message,
          },
        });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to replay DLQ message',
          },
        });
      }
    }
  );
};
