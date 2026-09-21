import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Verifier } from '@pact-foundation/pact';
import path from 'path';

// Mock DB pool and services before importing app
vi.mock('../../../services/workflow-api/src/db/client.js', () => ({
  db: {
    insert: () => ({ values: () => Promise.resolve() }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
          orderBy: () => Promise.resolve([]),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
  pool: {
    query: () => Promise.resolve({ rows: [] }),
    end: () => Promise.resolve(),
  },
}));

vi.mock('../../../services/workflow-api/src/services/workflow.service.js', () => ({
  workflowService: {
    createWorkflow: vi.fn().mockImplementation((tenantId, requesterId, requesterName, dto) =>
      Promise.resolve({
        id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        tenantId,
        type: dto.type || 'EXPENSE',
        title: dto.title,
        amount: dto.amount || 3500,
        currency: dto.currency || 'USD',
        description: dto.description || 'Team workstation refresh',
        status: 'DRAFT',
        currentStep: 1,
        totalSteps: 1,
        requesterId,
        requesterName,
        createdAt: '2026-09-21T08:00:00.000Z',
        updatedAt: '2026-09-21T08:00:00.000Z',
      })
    ),
    getWorkflowById: vi.fn().mockImplementation((tenantId, id) =>
      Promise.resolve({
        id,
        tenantId,
        type: 'EXPENSE',
        title: 'MacBook Pro M3 Max for Development',
        status: 'DRAFT',
        amount: 3500,
        currency: 'USD',
        requesterId: 'user-alice',
        requesterName: 'Alice Requester',
        createdAt: '2026-09-21T08:00:00.000Z',
        updatedAt: '2026-09-21T08:00:00.000Z',
      })
    ),
    submitWorkflow: vi.fn().mockImplementation((tenantId, userId, userName, id, body) =>
      Promise.resolve({
        id,
        tenantId,
        status: 'PENDING',
        currentStep: 1,
        totalSteps: 1,
        assignedRole: 'APPROVER',
        updatedAt: '2026-09-21T08:05:00.000Z',
      })
    ),
  },
}));

import { buildApp } from '../../../services/workflow-api/src/app.js';
import type { FastifyInstance } from 'fastify';

describe('Pact Provider Verification: workflow-api satisfies workflow-host-app contract', () => {
  let app: FastifyInstance;
  let providerBaseUrl: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address && typeof address === 'object') {
      providerBaseUrl = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error('Could not determine provider port');
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('verifies provider against generated host-app pact file', async () => {
    const pactFile = path.resolve(process.cwd(), 'pacts', 'workflow-host-app-workflow-api.json');

    const verifier = new Verifier({
      provider: 'workflow-api',
      providerBaseUrl,
      pactUrls: [pactFile],
    });

    const output = await verifier.verifyProvider();
    expect(output).toBeDefined();
  });
});
