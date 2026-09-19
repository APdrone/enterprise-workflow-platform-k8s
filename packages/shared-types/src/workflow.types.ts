export type WorkflowStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type WorkflowType = 'EXPENSE' | 'LEAVE' | 'PURCHASE_ORDER' | 'GENERIC';

export type WorkflowStepStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';

export type ApprovalRole = 'TEAM_LEAD' | 'DEPT_MANAGER' | 'FINANCE_DIRECTOR' | 'GENERAL_APPROVER';

export interface WorkflowStep {
  id: string;
  workflowId: string;
  tenantId: string;
  stepOrder: number;
  stepRole: ApprovalRole | string;
  approverId?: string;
  status: WorkflowStepStatus;
  actedBy?: string;
  actedAt?: string;
  comment?: string;
  createdAt: string;
}

export interface Workflow {
  id: string;
  tenantId: string;
  type: WorkflowType;
  title: string;
  description?: string;
  amount?: number;
  currency?: string;
  requesterId: string;
  requesterName: string;
  status: WorkflowStatus;
  approverId?: string;
  currentStepOrder?: number;
  totalSteps?: number;
  steps?: WorkflowStep[];
  rejectionReason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowDTO {
  type: WorkflowType;
  title: string;
  description?: string;
  amount?: number;
  currency?: string;
  approverId?: string;
  customSteps?: Array<{ stepOrder: number; stepRole: string; approverId?: string }>;
  metadata?: Record<string, unknown>;
}

export interface SubmitWorkflowDTO {
  comment?: string;
}

export interface ApproveWorkflowDTO {
  comment?: string;
  stepOrder?: number;
}

export interface RejectWorkflowDTO {
  reason: string;
  stepOrder?: number;
}

export interface CancelWorkflowDTO {
  reason?: string;
}

export interface Delegation {
  id: string;
  tenantId: string;
  delegatorId: string;
  delegateeId: string;
  validFrom: string;
  validUntil: string;
  reason?: string;
  active: boolean;
  createdAt: string;
}

export interface CreateDelegationDTO {
  delegatorId: string;
  delegateeId: string;
  validFrom: string;
  validUntil: string;
  reason?: string;
}
