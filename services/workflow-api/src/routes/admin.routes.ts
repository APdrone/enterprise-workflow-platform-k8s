import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { workflowService } from '../services/workflow.service.js';

export const adminRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const expectedAdminToken = process.env.ADMIN_TOKEN || 'test-admin-secret';

  fastify.delete<{ Params: { tenantId: string } }>(
    '/api/v1/admin/tenants/:tenantId/workflows',
    async (request, reply) => {
      const adminToken = request.headers['x-admin-token'];

      if (!adminToken || adminToken !== expectedAdminToken) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or missing x-admin-token header',
          },
        });
      }

      const { tenantId } = request.params;
      if (!tenantId) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'tenantId parameter is required',
          },
        });
      }

      try {
        const deletedCount = await workflowService.deleteWorkflowsByTenant(tenantId);
        return reply.status(200).send({
          success: true,
          data: {
            tenantId,
            deletedCount,
            message: `Successfully cleaned up workflows for tenant '${tenantId}'`,
          },
        });
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'CLEANUP_ERROR',
            message: err.message || 'Failed to cleanup test data',
          },
        });
      }
    }
  );
};
