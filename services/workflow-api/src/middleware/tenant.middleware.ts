import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    userId: string;
    userName: string;
    correlationId: string;
  }
}

export async function tenantMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Extract or generate X-Correlation-ID
  const correlationId =
    (request.headers['x-correlation-id'] as string) ||
    (request.headers['x-request-id'] as string) ||
    uuidv4();
  request.correlationId = correlationId;
  reply.header('x-correlation-id', correlationId);

  // Allow root info, health checks, readiness probes, metrics, and admin endpoints without x-tenant-id
  if (
    request.url === '/' ||
    request.url === '' ||
    request.url === '/health' ||
    request.url.startsWith('/health/') ||
    request.url === '/ready' ||
    request.url.startsWith('/ready/') ||
    request.url === '/metrics' ||
    request.url.startsWith('/metrics/') ||
    request.url.startsWith('/api/v1/admin')
  ) {
    return;
  }

  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  if (!tenantId || tenantId.trim() === '') {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'MISSING_TENANT_ID',
        message: 'x-tenant-id header is required for all API requests',
      },
    });
  }

  const userId = (request.headers['x-user-id'] as string) || 'anonymous-user';
  const userName = (request.headers['x-user-name'] as string) || 'Anonymous User';

  request.tenantId = tenantId.trim();
  request.userId = userId.trim();
  request.userName = userName.trim();
}

