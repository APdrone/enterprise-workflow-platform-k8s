import { v4 as uuidv4 } from 'uuid';
import { Workflow, CreateWorkflowDTO, WorkflowStatus, WorkflowType } from '@workflow/shared-types';

export function buildWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    tenantId: 'tenant-test-1',
    type: 'EXPENSE' as WorkflowType,
    title: 'Test Expense Reimbursement',
    description: 'Travel expenses for engineering conference',
    amount: 1500.0,
    currency: 'USD',
    requesterId: 'user-emp-1',
    requesterName: 'Alice Johnson',
    status: 'DRAFT' as WorkflowStatus,
    metadata: { department: 'Engineering' },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function buildCreateWorkflowDTO(overrides: Partial<CreateWorkflowDTO> = {}): CreateWorkflowDTO {
  return {
    type: 'EXPENSE',
    title: 'Tokyo Office Equipment',
    description: 'Ergonomic keyboard and 4k monitor',
    amount: 850.0,
    currency: 'USD',
    metadata: { department: 'Design' },
    ...overrides,
  };
}
