import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics for multi-tenant isolation analysis
const flooderRateLimitedRate = new Rate('flooder_rate_limited');
const guaranteedTenantLatency = new Trend('guaranteed_tenant_latency');
const guaranteedTenantSuccess = new Rate('guaranteed_tenant_success');

export const options = {
  scenarios: {
    // Scenario 1: Abusive / Noisy Tenant attempting to overwhelm platform capacity
    noisy_neighbor_flood: {
      executor: 'constant-arrival-rate',
      rate: 200,             // 200 req/sec flood
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 50,
      maxVUs: 100,
      tags: { scenario_name: 'noisy_flooder', tenant: 'tenant-flooder' },
      exec: 'runFlooderTraffic',
    },

    // Scenario 2: High-SLA Innocent Tenant running concurrent legitimate business workflows
    sla_guaranteed_tenant: {
      executor: 'constant-arrival-rate',
      rate: 15,              // 15 req/sec steady business traffic
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 10,
      maxVUs: 20,
      tags: { scenario_name: 'sla_guaranteed', tenant: 'tenant-sla-guaranteed' },
      exec: 'runGuaranteedTraffic',
    },
  },

  thresholds: {
    // Innocent tenant must be protected: latency < 100ms and 100% success rate
    'guaranteed_tenant_latency': ['p(95)<100'],
    'guaranteed_tenant_success': ['rate>0.99'],
    'http_req_failed{tenant:tenant-sla-guaranteed}': ['rate<0.01'],

    // Flooder tenant MUST be rate limited (429 Too Many Requests)
    'flooder_rate_limited': ['rate>0.70'], // At least 70% of abusive requests are throttled
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';

/**
 * 1. Flooder Tenant traffic generator
 */
export function runFlooderTraffic() {
  const tenantId = 'tenant-flooder';
  const headers = {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': `abusive-bot-${__VU}`,
    'x-user-name': 'Abusive Bot',
  };

  const payload = JSON.stringify({
    type: 'EXPENSE',
    title: `DDoS Probe Payload ${__ITER}`,
    amount: 100,
    currency: 'USD',
  });

  const res = http.post(`${BASE_URL}/api/v1/workflows`, payload, {
    headers,
    tags: { tenant: tenantId },
  });

  // Check whether request was throttled with 429 or succeeded under allowance
  const isRateLimited = res.status === 429;
  flooderRateLimitedRate.add(isRateLimited);

  check(res, {
    'flooder receives 429 when throttled or 201 when under limit': (r) =>
      r.status === 429 || r.status === 201,
    'rate-limit headers present': (r) => r.headers['X-Ratelimit-Limit'] !== undefined,
  });
}

/**
 * 2. SLA-Guaranteed Tenant traffic generator
 */
export function runGuaranteedTraffic() {
  const tenantId = 'tenant-sla-guaranteed';
  const headers = {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': `business-vip-${__VU}`,
    'x-user-name': 'Executive Approver',
  };

  const startTime = Date.now();
  const res = http.get(`${BASE_URL}/api/v1/workflows?limit=10`, {
    headers,
    tags: { tenant: tenantId },
  });
  const duration = Date.now() - startTime;

  guaranteedTenantLatency.add(duration);

  const isSuccess = res.status === 200;
  guaranteedTenantSuccess.add(isSuccess);

  check(res, {
    'guaranteed tenant status is 200': (r) => r.status === 200,
    'guaranteed tenant never receives 429': (r) => r.status !== 429,
  });

  sleep(0.1);
}
