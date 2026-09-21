import { describe, it, expect, beforeEach } from 'vitest';
import { TenantRateLimiter } from '../../services/workflow-api/src/middleware/rate-limit.middleware.js';

describe('Tenant-Aware Rate Limiter (Noisy Neighbor Isolation)', () => {
  let rateLimiter: TenantRateLimiter;

  beforeEach(() => {
    rateLimiter = new TenantRateLimiter({
      windowMs: 1000,
      maxRequests: 5, // 5 req/sec limit for test
      tenantOverrides: {
        'tenant-premium': 10,
        'tenant-restricted': 2,
      },
    });
  });

  it('allows requests within the configured threshold for standard tenant', () => {
    const tenantId = 'tenant-corp-a';

    for (let i = 1; i <= 5; i++) {
      const res = rateLimiter.checkRateLimit(tenantId);
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(5 - i);
    }
  });

  it('blocks requests and flags 429 when tenant exceeds threshold', () => {
    const tenantId = 'tenant-flooder';

    // Exhaust 5 requests
    for (let i = 0; i < 5; i++) {
      rateLimiter.checkRateLimit(tenantId);
    }

    // 6th request must be rejected
    const blockedRes = rateLimiter.checkRateLimit(tenantId);
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.remaining).toBe(0);
    expect(blockedRes.limit).toBe(5);
  });

  it('preserves isolation: Tenant A exhausting limit does NOT affect Tenant B', () => {
    const tenantA = 'tenant-abusive';
    const tenantB = 'tenant-innocent';

    // Tenant A consumes all capacity and gets blocked
    for (let i = 0; i < 10; i++) {
      rateLimiter.checkRateLimit(tenantA);
    }
    const tenantABlocked = rateLimiter.checkRateLimit(tenantA);
    expect(tenantABlocked.allowed).toBe(false);

    // Tenant B must still have full allowance (5 remaining - 1 = 4)
    const tenantBAllowed = rateLimiter.checkRateLimit(tenantB);
    expect(tenantBAllowed.allowed).toBe(true);
    expect(tenantBAllowed.remaining).toBe(4);
  });

  it('respects tier-based custom tenant overrides', () => {
    const premiumTenant = 'tenant-premium';
    const restrictedTenant = 'tenant-restricted';

    // Premium gets 10
    for (let i = 0; i < 10; i++) {
      expect(rateLimiter.checkRateLimit(premiumTenant).allowed).toBe(true);
    }
    expect(rateLimiter.checkRateLimit(premiumTenant).allowed).toBe(false);

    // Restricted gets 2
    expect(rateLimiter.checkRateLimit(restrictedTenant).allowed).toBe(true);
    expect(rateLimiter.checkRateLimit(restrictedTenant).allowed).toBe(true);
    expect(rateLimiter.checkRateLimit(restrictedTenant).allowed).toBe(false);
  });
});
