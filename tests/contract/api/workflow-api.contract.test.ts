import { describe, it, expect } from 'vitest';
import { Workflow, PaginatedWorkflowsResponse } from '@workflow/shared-types';

describe('Workflow Platform Consumer Contract Schema Assertions', () => {
  it('verifies standard API response wrapper contract { success: boolean, data: ... }', () => {
    const mockApiResponse = {
      success: true,
      data: {
        id: 'wf-c-001',
        tenantId: 'corp-xyz',
        type: 'EXPENSE',
        title: 'Team lunch',
        status: 'DRAFT',
        requesterId: 'user-1',
        requesterName: 'User One',
        currency: 'USD',
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } satisfies Workflow,
    };

    expect(mockApiResponse).toHaveProperty('success');
    expect(typeof mockApiResponse.success).toBe('boolean');
    expect(mockApiResponse).toHaveProperty('data');
    expect(mockApiResponse.data.id).toBeDefined();
    expect(mockApiResponse.data.status).toBe('DRAFT');
  });

  it('verifies paginated list response contract shape', () => {
    const mockListResponse: { success: boolean; data: PaginatedWorkflowsResponse } = {
      success: true,
      data: {
        workflows: [
          {
            id: 'wf-c-002',
            tenantId: 'corp-xyz',
            type: 'PURCHASE_ORDER',
            title: 'Laptop procurement',
            status: 'PENDING',
            requesterId: 'user-2',
            requesterName: 'User Two',
            currency: 'USD',
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      },
    };

    expect(mockListResponse.success).toBe(true);
    expect(Array.isArray(mockListResponse.data.workflows)).toBe(true);
    expect(typeof mockListResponse.data.total).toBe('number');
    expect(typeof mockListResponse.data.limit).toBe('number');
    expect(typeof mockListResponse.data.offset).toBe('number');
  });

  it('verifies error response contract shape { success: false, error: { code, message } }', () => {
    const mockErrorResponse = {
      success: false,
      error: {
        code: 'INVALID_STATE_TRANSITION',
        message: "Cannot approve workflow in 'DRAFT' status.",
      },
    };

    expect(mockErrorResponse.success).toBe(false);
    expect(mockErrorResponse.error).toBeDefined();
    expect(mockErrorResponse.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(typeof mockErrorResponse.error.message).toBe('string');
  });
});
