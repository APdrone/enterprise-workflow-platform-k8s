import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';

export const auditRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Service Root Information Endpoint
  fastify.get('/', async () => {
    return {
      service: 'audit-service',
      name: 'Workflow Platform Audit & Compliance Ledger',
      status: 'online',
      version: '1.0.0',
      description: 'Kafka event consumer persisting immutable audit records in Postgres',
      endpoints: {
        health: 'GET /health',
        getAuditTrail: 'GET /api/v1/audit/:workflowId (requires x-tenant-id)',
      },
      uiUrl: 'http://localhost:5173/audit',
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/health', async () => {
    return { status: 'ok', service: 'audit-service', timestamp: new Date().toISOString() };
  });

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
};
