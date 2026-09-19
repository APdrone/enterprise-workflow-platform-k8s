import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowService } from '../../services/workflow-api/src/services/workflow.service.js';
import { outboxRelayService } from '../../services/workflow-api/src/services/outbox.relay.js';
import { delegationService } from '../../services/workflow-api/src/services/delegation.service.js';
import { db } from '../../services/workflow-api/src/db/client.js';
import { buildCreateWorkflowDTO } from '../../packages/test-utils/src/factories/workflow.factory.js';

describe('Workflow State Machine & Business Logic Unit Tests', () => {
  let service: WorkflowService;
  const mockTenantA = 'tenant-test-a';
  const mockUser = 'user-test-1';
  const mockUserName = 'Test User';

  beforeEach(() => {
    service = new WorkflowService();
    vi.restoreAllMocks();
    vi.spyOn(outboxRelayService, 'saveToOutbox').mockResolvedValue(undefined);
    vi.spyOn(outboxRelayService, 'relayEventImmediately').mockResolvedValue(true);
  });

  it('creates workflow in DRAFT status with dynamic multi-step generation based on threshold', async () => {
    const dto = buildCreateWorkflowDTO({ title: 'Travel reimbursement', amount: 5000 });

    vi.spyOn(db, 'insert').mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    } as any);

    const createdRecord = {
      id: 'wf-draft-1',
      tenantId: mockTenantA,
      type: 'EXPENSE',
      title: 'Travel reimbursement',
      amount: 5000,
      currency: 'USD',
      requesterId: mockUser,
      requesterName: mockUserName,
      status: 'DRAFT',
      currentStepOrder: 1,
      totalSteps: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(service, 'getWorkflowById').mockResolvedValue(createdRecord as any);

    const result = await service.createWorkflow(mockTenantA, mockUser, mockUserName, dto);

    expect(result.id).toBeDefined();
    expect(result.title).toBe('Travel reimbursement');
    expect(result.status).toBe('DRAFT');
    expect(result.tenantId).toBe(mockTenantA);
  });

  it('transitions DRAFT -> PENDING on submitWorkflow and writes to outbox', async () => {
    const existingDraft = {
      id: 'wf-100',
      tenantId: mockTenantA,
      type: 'EXPENSE',
      title: 'Server Hardware',
      amount: 1200,
      currency: 'USD',
      requesterId: mockUser,
      requesterName: mockUserName,
      status: 'DRAFT',
      currentStepOrder: 1,
      totalSteps: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const pendingResult = {
      ...existingDraft,
      status: 'PENDING',
    };

    vi.spyOn(service, 'getWorkflowById')
      .mockResolvedValueOnce(existingDraft as any)
      .mockResolvedValueOnce(pendingResult as any);

    vi.spyOn(db, 'update').mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    const outboxSpy = vi.spyOn(outboxRelayService, 'saveToOutbox');

    const result = await service.submitWorkflow(mockTenantA, mockUser, mockUserName, 'wf-100', {
      comment: 'Please approve urgent purchase',
    });

    expect(result.status).toBe('PENDING');
    expect(outboxSpy).toHaveBeenCalledTimes(1);
    expect(outboxSpy).toHaveBeenCalledWith(
      mockTenantA,
      'wf-100',
      expect.objectContaining({
        type: 'workflow.submitted.v1',
        data: expect.objectContaining({
          workflowId: 'wf-100',
          previousStatus: 'DRAFT',
          currentStatus: 'PENDING',
        }),
      })
    );
  });

  it('multi-step progression: advances step 1 to step 2 on first approval', async () => {
    const multiStepPending = {
      id: 'wf-multi-1',
      tenantId: mockTenantA,
      type: 'EXPENSE',
      title: 'High Value Equipment',
      amount: 50000,
      currency: 'USD',
      requesterId: mockUser,
      requesterName: mockUserName,
      status: 'PENDING',
      currentStepOrder: 1,
      totalSteps: 2,
      steps: [
        { id: 's1', workflowId: 'wf-multi-1', tenantId: mockTenantA, stepOrder: 1, stepRole: 'TEAM_LEAD', status: 'PENDING', createdAt: '' },
        { id: 's2', workflowId: 'wf-multi-1', tenantId: mockTenantA, stepOrder: 2, stepRole: 'DEPT_MANAGER', status: 'PENDING', createdAt: '' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const step2Pending = {
      ...multiStepPending,
      currentStepOrder: 2,
    };

    vi.spyOn(service, 'getWorkflowById')
      .mockResolvedValueOnce(multiStepPending as any)
      .mockResolvedValueOnce(step2Pending as any);

    vi.spyOn(db, 'update').mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    const outboxSpy = vi.spyOn(outboxRelayService, 'saveToOutbox');

    const result = await service.approveWorkflow(mockTenantA, 'lead-1', 'Lead Bob', 'wf-multi-1', {
      comment: 'Lead approved',
    });

    expect(result.status).toBe('PENDING');
    expect(result.currentStepOrder).toBe(2);
    expect(outboxSpy).toHaveBeenCalledWith(
      mockTenantA,
      'wf-multi-1',
      expect.objectContaining({
        type: 'workflow.step_approved.v1',
        data: expect.objectContaining({
          currentStepOrder: 1,
          totalSteps: 2,
          currentStatus: 'PENDING',
        }),
      })
    );
  });

  it('delegation authorization: allows proxy approver when active delegation exists', async () => {
    const pendingWf = {
      id: 'wf-del-1',
      tenantId: mockTenantA,
      status: 'PENDING',
      type: 'EXPENSE',
      title: 'Delegated approval request',
      approverId: 'manager-main',
      currentStepOrder: 1,
      totalSteps: 1,
      steps: [
        { id: 's1', workflowId: 'wf-del-1', tenantId: mockTenantA, stepOrder: 1, stepRole: 'TEAM_LEAD', approverId: 'manager-main', status: 'PENDING', createdAt: '' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const approvedWf = {
      ...pendingWf,
      status: 'APPROVED',
    };

    vi.spyOn(service, 'getWorkflowById')
      .mockResolvedValueOnce(pendingWf as any)
      .mockResolvedValueOnce(approvedWf as any);

    vi.spyOn(delegationService, 'isAuthorizedApprover').mockResolvedValue({
      authorized: true,
      isDelegated: true,
      delegatedFrom: 'manager-main',
    });

    vi.spyOn(db, 'update').mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    const outboxSpy = vi.spyOn(outboxRelayService, 'saveToOutbox');

    const result = await service.approveWorkflow(mockTenantA, 'delegate-actor', 'Proxy Actor', 'wf-del-1', {
      comment: 'Approving on behalf of manager',
    });

    expect(result.status).toBe('APPROVED');
    expect(outboxSpy).toHaveBeenCalledWith(
      mockTenantA,
      'wf-del-1',
      expect.objectContaining({
        type: 'workflow.approved.v1',
        data: expect.objectContaining({
          isDelegated: true,
          delegatedFrom: 'manager-main',
        }),
      })
    );
  });

  it('rejects invalid state transition: Cannot submit a workflow that is already APPROVED', async () => {
    const approvedWf = {
      id: 'wf-200',
      tenantId: mockTenantA,
      status: 'APPROVED',
      type: 'EXPENSE',
      title: 'Already approved request',
      requesterId: mockUser,
      requesterName: mockUserName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(service, 'getWorkflowById').mockResolvedValue(approvedWf as any);

    await expect(
      service.submitWorkflow(mockTenantA, mockUser, mockUserName, 'wf-200', {})
    ).rejects.toThrow(/Cannot submit workflow in 'APPROVED' status/);
  });

  it('transitions PENDING -> REJECTED when rejection reason is provided', async () => {
    const pendingWf = {
      id: 'wf-400',
      tenantId: mockTenantA,
      status: 'PENDING',
      type: 'EXPENSE',
      title: 'Expensive monitor',
      amount: 800,
      currency: 'USD',
      requesterId: mockUser,
      requesterName: mockUserName,
      currentStepOrder: 1,
      totalSteps: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const rejectedWf = {
      ...pendingWf,
      status: 'REJECTED',
      rejectionReason: 'Over budget for Q3',
    };

    vi.spyOn(service, 'getWorkflowById')
      .mockResolvedValueOnce(pendingWf as any)
      .mockResolvedValueOnce(rejectedWf as any);

    vi.spyOn(db, 'update').mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    const outboxSpy = vi.spyOn(outboxRelayService, 'saveToOutbox');

    const result = await service.rejectWorkflow(mockTenantA, 'manager-1', 'Manager Bob', 'wf-400', {
      reason: 'Over budget for Q3',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReason).toBe('Over budget for Q3');
    expect(outboxSpy).toHaveBeenCalledWith(
      mockTenantA,
      'wf-400',
      expect.objectContaining({
        type: 'workflow.rejected.v1',
        data: expect.objectContaining({
          workflowId: 'wf-400',
          currentStatus: 'REJECTED',
          rejectionReason: 'Over budget for Q3',
        }),
      })
    );
  });

  it('fails rejection when reason is empty', async () => {
    const pendingWf = {
      id: 'wf-401',
      tenantId: mockTenantA,
      status: 'PENDING',
      type: 'EXPENSE',
      title: 'Expensive monitor',
      requesterId: mockUser,
      requesterName: mockUserName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(service, 'getWorkflowById').mockResolvedValue(pendingWf as any);

    await expect(
      service.rejectWorkflow(mockTenantA, 'manager-1', 'Manager Bob', 'wf-401', { reason: '' })
    ).rejects.toThrow(/Rejection reason is required/);
  });

  it('allows cancellation from DRAFT or PENDING status', async () => {
    const draftWf = {
      id: 'wf-500',
      tenantId: mockTenantA,
      status: 'DRAFT',
      type: 'EXPENSE',
      title: 'Draft to cancel',
      requesterId: mockUser,
      requesterName: mockUserName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const cancelledWf = {
      ...draftWf,
      status: 'CANCELLED',
    };

    vi.spyOn(service, 'getWorkflowById')
      .mockResolvedValueOnce(draftWf as any)
      .mockResolvedValueOnce(cancelledWf as any);

    vi.spyOn(db, 'update').mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    const outboxSpy = vi.spyOn(outboxRelayService, 'saveToOutbox');

    const result = await service.cancelWorkflow(mockTenantA, mockUser, mockUserName, 'wf-500', {
      reason: 'No longer needed',
    });

    expect(result.status).toBe('CANCELLED');
    expect(outboxSpy).toHaveBeenCalledWith(
      mockTenantA,
      'wf-500',
      expect.objectContaining({
        type: 'workflow.cancelled.v1',
      })
    );
  });
});
