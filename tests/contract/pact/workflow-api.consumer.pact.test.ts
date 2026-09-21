import { describe, it, expect } from 'vitest';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';

const { like, string, uuid, integer, boolean } = MatchersV3;

const provider = new PactV3({
  consumer: 'workflow-host-app',
  provider: 'workflow-api',
  dir: path.resolve(process.cwd(), 'pacts'),
});

describe('Pact Consumer Contract: workflow-host-app -> workflow-api', () => {
  const tenantId = 'tenant-corp-a';
  const userId = 'user-alice';
  const workflowId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

  it('generates contract for POST /api/v1/workflows (Create Draft)', async () => {
    await provider
      .uponReceiving('a request to create a draft workflow')
      .withRequest({
        method: 'POST',
        path: '/api/v1/workflows',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'x-user-id': userId,
          'x-user-name': 'Alice Requester',
        },
        body: {
          type: 'EXPENSE',
          title: 'MacBook Pro M3 Max for Development',
          amount: 3500,
          currency: 'USD',
          description: 'Team workstation refresh',
        },
      })
      .willRespondWith({
        status: 201,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: {
          success: true,
          data: {
            id: uuid(workflowId),
            tenantId: string(tenantId),
            type: string('EXPENSE'),
            title: string('MacBook Pro M3 Max for Development'),
            amount: integer(3500),
            currency: string('USD'),
            description: string('Team workstation refresh'),
            status: string('DRAFT'),
            currentStep: integer(1),
            totalSteps: integer(1),
            requesterId: string(userId),
            requesterName: string('Alice Requester'),
            createdAt: string('2026-09-21T08:00:00.000Z'),
            updatedAt: string('2026-09-21T08:00:00.000Z'),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const res = await fetch(`${mockServer.url}/api/v1/workflows`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-tenant-id': tenantId,
            'x-user-id': userId,
            'x-user-name': 'Alice Requester',
          },
          body: JSON.stringify({
            type: 'EXPENSE',
            title: 'MacBook Pro M3 Max for Development',
            amount: 3500,
            currency: 'USD',
            description: 'Team workstation refresh',
          }),
        });

        expect(res.status).toBe(201);
        const body = (await res.json()) as { success: boolean; data: { id: string; status: string } };
        expect(body.success).toBe(true);
        expect(body.data.id).toBeDefined();
        expect(body.data.status).toBe('DRAFT');
      });
  });

  it('generates contract for GET /api/v1/workflows/:id (Query Workflow)', async () => {
    await provider
      .uponReceiving('a request to fetch an existing workflow by ID')
      .withRequest({
        method: 'GET',
        path: `/api/v1/workflows/${workflowId}`,
        headers: {
          'x-tenant-id': tenantId,
          'x-user-id': userId,
        },
      })
      .willRespondWith({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: {
          success: true,
          data: {
            id: uuid(workflowId),
            tenantId: string(tenantId),
            type: string('EXPENSE'),
            title: string('MacBook Pro M3 Max for Development'),
            status: string('DRAFT'),
            amount: integer(3500),
            currency: string('USD'),
            requesterId: string(userId),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const res = await fetch(`${mockServer.url}/api/v1/workflows/${workflowId}`, {
          method: 'GET',
          headers: {
            'x-tenant-id': tenantId,
            'x-user-id': userId,
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { success: boolean; data: { id: string; status: string } };
        expect(body.success).toBe(true);
        expect(body.data.id).toBe(workflowId);
      });
  });

  it('generates contract for POST /api/v1/workflows/:id/submit (Submit for Approval)', async () => {
    await provider
      .uponReceiving('a request to submit a draft workflow for approval')
      .withRequest({
        method: 'POST',
        path: `/api/v1/workflows/${workflowId}/submit`,
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': tenantId,
          'x-user-id': userId,
          'x-user-name': 'Alice Requester',
        },
        body: {
          comment: 'Submitting hardware purchase for approval',
        },
      })
      .willRespondWith({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: {
          success: true,
          data: {
            id: uuid(workflowId),
            tenantId: string(tenantId),
            status: string('PENDING'),
            currentStep: integer(1),
            totalSteps: integer(1),
            assignedRole: string('APPROVER'),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const res = await fetch(`${mockServer.url}/api/v1/workflows/${workflowId}/submit`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-tenant-id': tenantId,
            'x-user-id': userId,
            'x-user-name': 'Alice Requester',
          },
          body: JSON.stringify({
            comment: 'Submitting hardware purchase for approval',
          }),
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { success: boolean; data: { status: string } };
        expect(body.success).toBe(true);
        expect(body.data.status).toBe('PENDING');
      });
  });
});
