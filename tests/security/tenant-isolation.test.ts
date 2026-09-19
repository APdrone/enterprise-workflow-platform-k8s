import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../services/workflow-api/src/app.js';
import { workflowService } from '../../services/workflow-api/src/services/workflow.service.js';

describe('Multi-Tenant Security & Data Isolation Matrix', () => {
  let app: FastifyInstance;

  const TENANT_ALPHA = 'corp-alpha';
  const TENANT_BETA = 'corp-beta';
  const TENANT_GAMMA = 'corp-gamma';

  const mockWorkflows: Record<string, any[]> = {
    [TENANT_ALPHA]: [
      {
        id: 'wf-alpha-001',
        tenantId: TENANT_ALPHA,
        type: 'EXPENSE',
        title: 'Alpha confidential expense',
        amount: 5000,
        currency: 'USD',
        requesterId: 'user-alpha-1',
        requesterName: 'Alice Alpha',
        status: 'DRAFT',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    [TENANT_BETA]: [
      {
        id: 'wf-beta-001',
        tenantId: TENANT_BETA,
        type: 'EXPENSE',
        title: 'Beta team offsite',
        amount: 2500,
        currency: 'USD',
        requesterId: 'user-beta-1',
        requesterName: 'Bob Beta',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Mock workflowService methods to evaluate tenant isolation logic
    vi.spyOn(workflowService, 'getWorkflowById').mockImplementation(async (tenantId, id) => {
      const tenantList = mockWorkflows[tenantId] || [];
      const found = tenantList.find((w) => w.id === id);
      return found ? (found as any) : null;
    });

    vi.spyOn(workflowService, 'listWorkflows').mockImplementation(async (tenantId) => {
      const tenantList = mockWorkflows[tenantId] || [];
      return {
        workflows: tenantList as any,
        total: tenantList.length,
        limit: 50,
        offset: 0,
      };
    });
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('Header Validation & Context Enforcement', () => {
    it('rejects API request with 400 when x-tenant-id header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/workflows',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISSING_TENANT_ID');
    });

    it('rejects API request with 400 when x-tenant-id header is whitespace only', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/workflows',
        headers: {
          'x-tenant-id': '   ',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('MISSING_TENANT_ID');
    });
  });

  describe('Cross-Tenant Data Leakage Assertions (IDOR Protection)', () => {
    it('prevents Tenant Beta from viewing Tenant Alpha workflow (returns 404)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/workflows/wf-alpha-001',
        headers: {
          'x-tenant-id': TENANT_BETA,
          'x-user-id': 'attacker-user',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('WORKFLOW_NOT_FOUND');
    });

    it('prevents Tenant Beta from seeing Tenant Alpha workflows in paginated list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/workflows',
        headers: {
          'x-tenant-id': TENANT_BETA,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.workflows).toHaveLength(1);
      expect(body.data.workflows[0].id).toBe('wf-beta-001');

      // Crucial assertion: None of Alpha's data leaked
      const alphaLeaked = body.data.workflows.some((w: any) => w.id === 'wf-alpha-001');
      expect(alphaLeaked).toBe(false);
    });

    it('prevents Tenant Beta from submitting Tenant Alpha workflow', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workflows/wf-alpha-001/submit',
        headers: {
          'x-tenant-id': TENANT_BETA,
          'x-user-id': 'user-beta-1',
        },
        payload: { comment: 'Illegal submission' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('prevents Tenant Alpha from approving Tenant Beta workflow', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workflows/wf-beta-001/approve',
        headers: {
          'x-tenant-id': TENANT_ALPHA,
          'x-user-id': 'user-alpha-mgr',
        },
        payload: { comment: 'Illegal approval' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('prevents Tenant Gamma from cancelling Tenant Alpha workflow', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workflows/wf-alpha-001/cancel',
        headers: {
          'x-tenant-id': TENANT_GAMMA,
          'x-user-id': 'user-gamma-1',
        },
        payload: { reason: 'Illegal cancel' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Correlation Tracking & Public Probes', () => {
    it('allows /ready and /health without x-tenant-id and attaches x-correlation-id', async () => {
      const customCorrId = 'test-trace-999';
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'x-correlation-id': customCorrId,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-correlation-id']).toBe(customCorrId);
    });
  });
});
