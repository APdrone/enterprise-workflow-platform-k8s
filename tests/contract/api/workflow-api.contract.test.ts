import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../../services/workflow-api/src/app.js';
import { workflowService } from '../../../services/workflow-api/src/services/workflow.service.js';
import { eventProducer } from '../../../services/workflow-api/src/kafka/producer.js';
import { Workflow, PaginatedWorkflowsResponse, ApiResponse } from '@workflow/shared-types';

describe('Workflow Platform REST API Contract Verification', () => {
  let app: FastifyInstance;
  const mockTenant = 'tenant-corp-a';
  const mockUser = 'user-alice';
  const mockUserName = 'Alice Johnson';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    vi.spyOn(eventProducer, 'publishWorkflowEvent').mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('Root & Health Metadata Contracts', () => {
    it('GET / satisfies standard microservice metadata contract', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body).toHaveProperty('service', 'workflow-api');
      expect(body).toHaveProperty('version');
      expect(body).toHaveProperty('status', 'online');
      expect(body).toHaveProperty('endpoints');
      expect(body.endpoints).toHaveProperty('health');
      expect(body.endpoints).toHaveProperty('ready');
      expect(body.endpoints).toHaveProperty('listWorkflows');
      expect(body.endpoints).toHaveProperty('createWorkflow');
    });


    it('GET /ready satisfies standard readiness probe contract', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('service', 'workflow-api');
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('checks');
      expect(body.checks).toHaveProperty('database');
      expect(body.checks).toHaveProperty('kafka');
    });
  });

  describe('Workflow Entity API Contracts', () => {
    it('POST /api/v1/workflows contract matches { success: true, data: Workflow }', async () => {
      const mockCreated: Workflow = {
        id: 'wf-contract-101',
        tenantId: mockTenant,
        type: 'EXPENSE',
        title: 'Cloud Infrastructure Contract Test',
        amount: 3200,
        currency: 'USD',
        requesterId: mockUser,
        requesterName: mockUserName,
        status: 'DRAFT',
        currentStepOrder: 1,
        totalSteps: 1,
        steps: [],
        metadata: { department: 'Engineering' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.spyOn(workflowService, 'createWorkflow').mockResolvedValue(mockCreated);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/workflows',
        headers: {
          'x-tenant-id': mockTenant,
          'x-user-id': mockUser,
          'x-user-name': mockUserName,
          'content-type': 'application/json',
        },
        payload: {
          type: 'EXPENSE',
          title: 'Cloud Infrastructure Contract Test',
          amount: 3200,
        },
      });

      expect(res.statusCode).toBe(201);
      const envelope: ApiResponse<Workflow> = JSON.parse(res.body);

      // Contract assertions
      expect(envelope.success).toBe(true);
      expect(envelope.data).toBeDefined();
      if (!envelope.data) throw new Error('envelope.data missing');
      expect(envelope.data.id).toBe('wf-contract-101');
      expect(envelope.data.tenantId).toBe(mockTenant);
      expect(envelope.data.status).toBe('DRAFT');
      expect(typeof envelope.data.amount).toBe('number');
      expect(typeof envelope.data.title).toBe('string');
      expect(envelope.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('GET /api/v1/workflows paginated list matches { success: true, data: PaginatedWorkflowsResponse }', async () => {
      const mockWorkflows: Workflow[] = [
        {
          id: 'wf-p-1',
          tenantId: mockTenant,
          type: 'PURCHASE_ORDER',
          title: 'Hardware Order',
          amount: 4500,
          currency: 'USD',
          requesterId: mockUser,
          requesterName: mockUserName,
          status: 'PENDING',
          currentStepOrder: 1,
          totalSteps: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      vi.spyOn(workflowService, 'listWorkflows').mockResolvedValue({
        workflows: mockWorkflows,
        total: 1,
        limit: 50,
        offset: 0,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/workflows',
        headers: {
          'x-tenant-id': mockTenant,
          'x-user-id': mockUser,
        },
      });

      expect(res.statusCode).toBe(200);
      const envelope: ApiResponse<PaginatedWorkflowsResponse> = JSON.parse(res.body);

      expect(envelope.success).toBe(true);
      expect(envelope.data).toBeDefined();
      if (!envelope.data) throw new Error('envelope.data missing');
      expect(Array.isArray(envelope.data.workflows)).toBe(true);
      expect(typeof envelope.data.total).toBe('number');
      expect(typeof envelope.data.limit).toBe('number');
      expect(typeof envelope.data.offset).toBe('number');
      expect(envelope.data.workflows[0].id).toBe('wf-p-1');
    });

  });

  describe('Standard Error Envelope Contract', () => {
    it('returns { success: false, error: { code, message } } when mandatory tenant header is omitted', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/workflows',
      });

      expect(res.statusCode).toBe(400);
      const envelope = JSON.parse(res.body);

      expect(envelope.success).toBe(false);
      expect(envelope).toHaveProperty('error');
      expect(envelope.error).toHaveProperty('code');
      expect(envelope.error).toHaveProperty('message');
      expect(envelope.error.code).toBe('MISSING_TENANT_ID');
      expect(typeof envelope.error.message).toBe('string');
    });

    it('returns standard 400 error envelope when body payload validation fails', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/workflows',
        headers: {
          'x-tenant-id': mockTenant,
          'content-type': 'application/json',
        },
        payload: {
          // Missing required 'title' and 'amount'
          type: 'EXPENSE',
        },
      });

      expect(res.statusCode).toBe(400);
      const envelope = JSON.parse(res.body);

      expect(envelope.success).toBe(false);
      expect(envelope.error).toBeDefined();
      expect(envelope.error.code).toBe('VALIDATION_ERROR');
      expect(envelope.error.message).toContain('title');
    });
  });
});
