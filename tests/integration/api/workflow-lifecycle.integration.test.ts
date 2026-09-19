import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../services/workflow-api/src/app.js';
import { workflowService } from '../../../services/workflow-api/src/services/workflow.service.js';
import { eventProducer } from '../../../services/workflow-api/src/kafka/producer.js';

describe('Workflow API Lifecycle & HTTP Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant-lifecycle-test';
  const userId = 'user-requester-1';
  const userName = 'Sarah Connor';

  let createdWorkflowId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    vi.spyOn(eventProducer, 'publishWorkflowEvent').mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET / returns service meta information with status online', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.service).toBe('workflow-api');
    expect(body.status).toBe('online');
    expect(body.endpoints.ready).toBe('GET /ready');
  });

  it('GET /ready returns readiness status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    // In local unit/test mode without live Postgres it may return 503 or 200, checking envelope
    const body = JSON.parse(res.body);
    expect(body.service).toBe('workflow-api');
    expect(['ready', 'not_ready']).toContain(body.status);
  });

  it('POST /api/v1/workflows creates a new workflow in DRAFT status', async () => {
    const mockCreated = {
      id: 'wf-auto-101',
      tenantId,
      type: 'EXPENSE',
      title: 'Q3 Cloud Hosting Bill',
      amount: 4500,
      currency: 'USD',
      requesterId: userId,
      requesterName: userName,
      status: 'DRAFT',
      metadata: { department: 'Engineering' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(workflowService, 'createWorkflow').mockResolvedValue(mockCreated as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-id': userId,
        'x-user-name': userName,
        'x-correlation-id': 'corr-create-1',
      },
      payload: {
        title: 'Q3 Cloud Hosting Bill',
        type: 'EXPENSE',
        amount: 4500,
        metadata: { department: 'Engineering' },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.headers['x-correlation-id']).toBe('corr-create-1');

    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('wf-auto-101');
    expect(body.data.status).toBe('DRAFT');

    createdWorkflowId = body.data.id;
  });

  it('POST /api/v1/workflows/:id/submit advances workflow from DRAFT to PENDING', async () => {
    const mockSubmitted = {
      id: createdWorkflowId,
      tenantId,
      type: 'EXPENSE',
      title: 'Q3 Cloud Hosting Bill',
      amount: 4500,
      currency: 'USD',
      requesterId: userId,
      requesterName: userName,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(workflowService, 'submitWorkflow').mockResolvedValue(mockSubmitted as any);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${createdWorkflowId}/submit`,
      headers: {
        'x-tenant-id': tenantId,
        'x-user-id': userId,
        'x-user-name': userName,
      },
      payload: {
        comment: 'Please approve before end of month',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('PENDING');
  });

  it('POST /api/v1/workflows/:id/approve marks workflow as APPROVED', async () => {
    const mockApproved = {
      id: createdWorkflowId,
      tenantId,
      type: 'EXPENSE',
      title: 'Q3 Cloud Hosting Bill',
      status: 'APPROVED',
      approverId: 'mgr-99',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(workflowService, 'approveWorkflow').mockResolvedValue(mockApproved as any);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${createdWorkflowId}/approve`,
      headers: {
        'x-tenant-id': tenantId,
        'x-user-id': 'mgr-99',
        'x-user-name': 'Engineering Manager',
      },
      payload: {
        comment: 'Approved, within Q3 budget',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('APPROVED');
    expect(body.data.approverId).toBe('mgr-99');
  });

  it('DELETE /api/v1/admin/tenants/:tenantId/workflows cleans up test tenant data with admin token', async () => {
    vi.spyOn(workflowService, 'deleteWorkflowsByTenant').mockResolvedValue(3);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/tenants/${tenantId}/workflows`,
      headers: {
        'x-admin-token': 'test-admin-secret',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.deletedCount).toBe(3);
  });

  it('DELETE /api/v1/admin/tenants/:tenantId/workflows rejects unauthorized requests without token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/tenants/${tenantId}/workflows`,
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
