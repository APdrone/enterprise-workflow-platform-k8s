import { FastifyRequest, FastifyReply } from 'fastify';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  tenantOverrides?: Record<string, number>;
}

interface ClientBucket {
  count: number;
  resetTime: number;
}

export class TenantRateLimiter {
  private buckets = new Map<string, ClientBucket>();
  private windowMs: number;
  private defaultMax: number;
  private tenantOverrides: Record<string, number>;

  constructor(config?: Partial<RateLimitConfig>) {
    this.windowMs = config?.windowMs || 1000;
    this.defaultMax = config?.maxRequests || 100;
    this.tenantOverrides = config?.tenantOverrides || {};
  }

  public checkRateLimit(tenantId: string): {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetTime: number;
  } {
    const now = Date.now();
    const limit = this.tenantOverrides[tenantId] ?? this.defaultMax;

    let bucket = this.buckets.get(tenantId);

    if (!bucket || now >= bucket.resetTime) {
      bucket = {
        count: 1,
        resetTime: now + this.windowMs,
      };
      this.buckets.set(tenantId, bucket);
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - 1),
        resetTime: bucket.resetTime,
      };
    }

    bucket.count++;
    const remaining = Math.max(0, limit - bucket.count);
    const allowed = bucket.count <= limit;

    return {
      allowed,
      limit,
      remaining,
      resetTime: bucket.resetTime,
    };
  }

  public reset(): void {
    this.buckets.clear();
  }
}

export const tenantRateLimiter = new TenantRateLimiter({
  windowMs: 1000,
  maxRequests: 100, // 100 req/sec per tenant default
  tenantOverrides: {
    'tenant-flooder': 20, // strict limit for noisy test tenant
    'tenant-sla-guaranteed': 500, // high SLA tier
  },
});

export async function rateLimitMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Exclude health, ready, metrics, and admin probes
  if (
    !request.tenantId ||
    request.url === '/' ||
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

  const result = tenantRateLimiter.checkRateLimit(request.tenantId);

  reply.header('X-RateLimit-Limit', result.limit.toString());
  reply.header('X-RateLimit-Remaining', result.remaining.toString());
  reply.header('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());

  if (!result.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((result.resetTime - Date.now()) / 1000));
    reply.header('Retry-After', retryAfterSeconds.toString());

    return reply.status(429).send({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Tenant "${request.tenantId}" exceeded rate limit of ${result.limit} req/sec. Noisy neighbor protection activated.`,
        retryAfter: retryAfterSeconds,
      },
    });
  }
}
