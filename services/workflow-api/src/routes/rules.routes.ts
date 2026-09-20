import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { CreateWorkflowRuleDTO } from '@workflow/shared-types';
import { rulesEngineService } from '../services/rules.engine.js';

export const rulesRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/v1/rules - List configured rules for tenant
  fastify.get<{
    Querystring: {
      workflowType?: string;
    };
  }>('/api/v1/rules', async (request, reply) => {
    const tenantId = request.tenantId;
    const { workflowType } = request.query;

    try {
      const rules = await rulesEngineService.listRules(tenantId, workflowType);
      return reply.status(200).send({
        success: true,
        data: {
          total: rules.length,
          rules,
        },
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve workflow rules',
        },
      });
    }
  });

  // POST /api/v1/rules - Create a new workflow rule
  fastify.post<{
    Body: CreateWorkflowRuleDTO;
  }>('/api/v1/rules', async (request, reply) => {
    const tenantId = request.tenantId;
    const body = request.body;

    if (!body.name || !body.steps || body.steps.length === 0) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Rule name and at least one step definition are required',
        },
      });
    }

    try {
      const created = await rulesEngineService.createRule(tenantId, body);
      return reply.status(201).send({
        success: true,
        data: created,
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create workflow rule',
        },
      });
    }
  });

  // GET /api/v1/rules/:id - Get a specific rule
  fastify.get<{
    Params: { id: string };
  }>('/api/v1/rules/:id', async (request, reply) => {
    const tenantId = request.tenantId;
    const { id } = request.params;

    try {
      const rule = await rulesEngineService.getRuleById(tenantId, id);
      if (!rule) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Workflow rule ${id} not found`,
          },
        });
      }

      return reply.status(200).send({
        success: true,
        data: rule,
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch workflow rule',
        },
      });
    }
  });

  // DELETE /api/v1/rules/:id - Delete a rule
  fastify.delete<{
    Params: { id: string };
  }>('/api/v1/rules/:id', async (request, reply) => {
    const tenantId = request.tenantId;
    const { id } = request.params;

    try {
      await rulesEngineService.deleteRule(tenantId, id);
      return reply.status(200).send({
        success: true,
        data: { id, deleted: true },
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete workflow rule',
        },
      });
    }
  });
};
