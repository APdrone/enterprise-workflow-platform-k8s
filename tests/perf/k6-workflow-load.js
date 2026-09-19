import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 }, // ramp up to 20 users
    { duration: '30s', target: 50 }, // hold at 50 users
    { duration: '10s', target: 0 },  // ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'], // 95% of requests must complete below 200ms
    http_req_failed: ['rate<0.01'],   // error rate under 1%
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';

export default function () {
  const tenantId = `tenant-${Math.floor(Math.random() * 5) + 1}`;
  const userId = `user-k6-${__VU}`;

  const headers = {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': userId,
    'x-user-name': `Load Tester ${__VU}`,
  };

  // 1. Create Workflow Draft
  const createPayload = JSON.stringify({
    type: 'EXPENSE',
    title: `Load Test Expense - VU ${__VU} - ${Date.now()}`,
    amount: Math.floor(Math.random() * 1000) + 50,
    currency: 'USD',
    description: 'Automated performance test payload',
  });

  const createRes = http.post(`${BASE_URL}/api/v1/workflows`, createPayload, { headers });

  const createSuccess = check(createRes, {
    'create status is 201': (r) => r.status === 201,
    'response has workflow id': (r) => JSON.parse(r.body).data.id !== undefined,
  });

  if (createSuccess) {
    const workflowId = JSON.parse(createRes.body).data.id;

    // 2. Submit workflow
    const submitRes = http.post(
      `${BASE_URL}/api/v1/workflows/${workflowId}/submit`,
      JSON.stringify({ comment: 'Automated submission' }),
      { headers }
    );

    check(submitRes, {
      'submit status is 200': (r) => r.status === 200,
      'status is PENDING': (r) => JSON.parse(r.body).data.status === 'PENDING',
    });
  }

  // 3. Query workflows list
  const listRes = http.get(`${BASE_URL}/api/v1/workflows?limit=10`, { headers });
  check(listRes, {
    'list status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
