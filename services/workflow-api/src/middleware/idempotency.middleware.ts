import { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';

export async function idempotencyMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Only apply to state mutating methods (POST, PUT, PATCH, DELETE)
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return;
  }

  const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
  if (!idempotencyKey || idempotencyKey.trim() === '') {
    return; // Optional unless required by specific endpoint
  }

  const tenantId = request.tenantId || 'global';
  const key = `${tenantId}:${idempotencyKey.trim()}`;

  try {
    const existing = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, idempotencyKey)))
      .limit(1);

    if (existing.length > 0) {
      const record = existing[0];
      if (record.status === 'COMPLETED' && record.statusCode && record.responseBody) {
        reply.header('x-idempotent-replay', 'true');
        return reply.status(record.statusCode).send(record.responseBody);
      } else if (record.status === 'PROCESSING') {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'CONCURRENT_REQUEST_IN_FLIGHT',
            message: 'A request with this Idempotency-Key is currently being processed.',
          },
        });
      }
    } else {
      // Record initial processing state
      await db.insert(idempotencyKeys).values({
        id: key,
        tenantId,
        key: idempotencyKey,
        status: 'PROCESSING',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }
  } catch (err: any) {
    // If conflict on concurrent insert
    request.log?.warn?.(`[Idempotency] Insert lock conflict for key ${key}: ${err.message}`);
  }
}

export async function recordIdempotencyResponse(
  tenantId: string,
  key: string,
  statusCode: number,
  body: any
): Promise<void> {
  const fullKey = `${tenantId}:${key.trim()}`;
  try {
    await db
      .update(idempotencyKeys)
      .set({
        statusCode,
        responseBody: body,
        status: 'COMPLETED',
        updatedAt: new Date(),
      })
      .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, key)));
  } catch (err: any) {
    console.warn(`[Idempotency] Failed to cache response for key ${fullKey}:`, err.message);
  }
}
