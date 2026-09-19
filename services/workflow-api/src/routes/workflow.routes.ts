import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { workflowService } from '../services/workflow.service.js';
import { delegationService } from '../services/delegation.service.js';
import { pool } from '../db/client.js';
import { eventProducer } from '../kafka/producer.js';
import { recordIdempotencyResponse } from '../middleware/idempotency.middleware.js';
import {
  CreateWorkflowDTO,
  SubmitWorkflowDTO,
  ApproveWorkflowDTO,
  RejectWorkflowDTO,
  CancelWorkflowDTO,
  ListWorkflowsQuery,
  CreateDelegationDTO,
} from '@workflow/shared-types';

export const workflowRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Service Root Information Endpoint
  fastify.get('/', async () => {
    return {
      service: 'workflow-api',
      name: 'Workflow Platform Core API',
      status: 'online',
      version: '1.1.0',
      description: 'Multi-tenant workflow state machine, multi-step routing & event publishing service',
      endpoints: {
        health: 'GET /health',
        ready: 'GET /ready',
        listWorkflows: 'GET /api/v1/workflows (requires x-tenant-id)',
        getWorkflow: 'GET /api/v1/workflows/:id (requires x-tenant-id)',
        createWorkflow: 'POST /api/v1/workflows (requires x-tenant-id)',
        submitWorkflow: 'POST /api/v1/workflows/:id/submit (requires x-tenant-id)',
        approveWorkflow: 'POST /api/v1/workflows/:id/approve (requires x-tenant-id)',
        rejectWorkflow: 'POST /api/v1/workflows/:id/reject (requires x-tenant-id)',
        cancelWorkflow: 'POST /api/v1/workflows/:id/cancel (requires x-tenant-id)',
        createDelegation: 'POST /api/v1/delegations (requires x-tenant-id)',
        listDelegations: 'GET /api/v1/delegations (requires x-tenant-id)',
      },
      uiUrl: 'http://localhost:5173',
      timestamp: new Date().toISOString(),
    };
  });

  // Healthcheck
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      service: 'workflow-api',
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness Probe (checks DB & Kafka connections)
  fastify.get('/ready', async (_, reply) => {
    try {
      await pool.query('SELECT 1');
      return reply.status(200).send({
        status: 'ready',
        service: 'workflow-api',
        db: 'ok',
        kafka: eventProducer.isConnected ? 'ok' : 'mock-or-degraded',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      return reply.status(503).send({
        status: 'not_ready',
        service: 'workflow-api',
        db: 'error',
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Create workflow (Draft)
  fastify.post<{ Body: CreateWorkflowDTO }>('/api/v1/workflows', async (request, reply) => {
    const { tenantId, userId, userName } = request;
    const body = request.body;
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    if (!body || !body.title) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Workflow title is required',
        },
      });
    }

    try {
      const created = await workflowService.createWorkflow(tenantId, userId, userName, body);
      const resData = {
        success: true,
        data: created,
      };

      if (idempotencyKey) {
        await recordIdempotencyResponse(tenantId, idempotencyKey, 201, resData);
      }

      return reply.status(201).send(resData);
    } catch (err: any) {
      request.log.error(err);
      return reply.status(err.statusCode || 500).send({
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message || 'An error occurred while creating workflow',
        },
      });
    }
  });

  // List workflows
  fastify.get<{ Querystring: ListWorkflowsQuery }>('/api/v1/workflows', async (request, reply) => {
    const { tenantId } = request;
    const query = request.query;

    try {
      const result = await workflowService.listWorkflows(tenantId, query);
      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(err.statusCode || 500).send({
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message || 'Failed to fetch workflows',
        },
      });
    }
  });

  // Get workflow by ID
  fastify.get<{ Params: { id: string } }>('/api/v1/workflows/:id', async (request, reply) => {
    const { tenantId } = request;
    const { id } = request.params;

    try {
      const workflow = await workflowService.getWorkflowById(tenantId, id);
      if (!workflow) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'WORKFLOW_NOT_FOUND',
            message: `Workflow ${id} not found`,
          },
        });
      }

      return reply.status(200).send({
        success: true,
        data: workflow,
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(err.statusCode || 500).send({
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message || 'Failed to fetch workflow',
        },
      });
    }
  });

  // Submit workflow
  fastify.post<{ Params: { id: string }; Body: SubmitWorkflowDTO }>(
    '/api/v1/workflows/:id/submit',
    async (request, reply) => {
      const { tenantId, userId, userName } = request;
      const { id } = request.params;
      const body = request.body || {};
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      try {
        const traceparent = request.span?.toTraceparent();
        const updated = await workflowService.submitWorkflow(tenantId, userId, userName, id, body, traceparent);
        const resData = {
          success: true,
          data: updated,
        };

        if (idempotencyKey) {
          await recordIdempotencyResponse(tenantId, idempotencyKey, 200, resData);
        }

        return reply.status(200).send(resData);
      } catch (err: any) {
        request.log.error(err);
        return reply.status(err.statusCode || 500).send({
          success: false,
          error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message,
          },
        });
      }
    }
  );

  // Approve workflow (supports multi-step & delegation)
  fastify.post<{ Params: { id: string }; Body: ApproveWorkflowDTO }>(
    '/api/v1/workflows/:id/approve',
    async (request, reply) => {
      const { tenantId, userId, userName } = request;
      const { id } = request.params;
      const body = request.body || {};
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      try {
        const traceparent = request.span?.toTraceparent();
        const updated = await workflowService.approveWorkflow(tenantId, userId, userName, id, body, traceparent);
        const resData = {
          success: true,
          data: updated,
        };

        if (idempotencyKey) {
          await recordIdempotencyResponse(tenantId, idempotencyKey, 200, resData);
        }

        return reply.status(200).send(resData);
      } catch (err: any) {
        request.log.error(err);
        return reply.status(err.statusCode || 500).send({
          success: false,
          error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message,
          },
        });
      }
    }
  );

  // Reject workflow
  fastify.post<{ Params: { id: string }; Body: RejectWorkflowDTO }>(
    '/api/v1/workflows/:id/reject',
    async (request, reply) => {
      const { tenantId, userId, userName } = request;
      const { id } = request.params;
      const body = request.body || {};
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      try {
        const traceparent = request.span?.toTraceparent();
        const updated = await workflowService.rejectWorkflow(tenantId, userId, userName, id, body, traceparent);
        const resData = {
          success: true,
          data: updated,
        };

        if (idempotencyKey) {
          await recordIdempotencyResponse(tenantId, idempotencyKey, 200, resData);
        }

        return reply.status(200).send(resData);
      } catch (err: any) {
        request.log.error(err);
        return reply.status(err.statusCode || 500).send({
          success: false,
          error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message,
          },
        });
      }
    }
  );

  // Cancel workflow
  fastify.post<{ Params: { id: string }; Body: CancelWorkflowDTO }>(
    '/api/v1/workflows/:id/cancel',
    async (request, reply) => {
      const { tenantId, userId, userName } = request;
      const { id } = request.params;
      const body = request.body || {};
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      try {
        const traceparent = request.span?.toTraceparent();
        const updated = await workflowService.cancelWorkflow(tenantId, userId, userName, id, body, traceparent);
        const resData = {
          success: true,
          data: updated,
        };

        if (idempotencyKey) {
          await recordIdempotencyResponse(tenantId, idempotencyKey, 200, resData);
        }

        return reply.status(200).send(resData);
      } catch (err: any) {
        request.log.error(err);
        return reply.status(err.statusCode || 500).send({
          success: false,
          error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message,
          },
        });
      }
    }
  );

  // Create Delegation
  fastify.post<{ Body: CreateDelegationDTO }>('/api/v1/delegations', async (request, reply) => {
    const { tenantId } = request;
    const body = request.body;

    if (!body || !body.delegatorId || !body.delegateeId || !body.validFrom || !body.validUntil) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'delegatorId, delegateeId, validFrom, and validUntil are required.',
        },
      });
    }

    try {
      const delegation = await delegationService.createDelegation(tenantId, body);
      return reply.status(201).send({
        success: true,
        data: delegation,
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(err.statusCode || 500).send({
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message,
        },
      });
    }
  });

  // List Delegations
  fastify.get<{ Querystring: { delegatorId?: string } }>('/api/v1/delegations', async (request, reply) => {
    const { tenantId } = request;
    const { delegatorId } = request.query;

    try {
      const results = await delegationService.listDelegations(tenantId, delegatorId);
      return reply.status(200).send({
        success: true,
        data: results,
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(err.statusCode || 500).send({
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message,
        },
      });
    }
  });
};
