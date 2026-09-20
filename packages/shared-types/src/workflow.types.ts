export type WorkflowStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type WorkflowType = 'EXPENSE' | 'LEAVE' | 'PURCHASE_ORDER' | 'GENERIC';

export type WorkflowStepStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';

export type ApprovalRole = 'TEAM_LEAD' | 'DEPT_MANAGER' | 'FINANCE_DIRECTOR' | 'SECURITY_OFFICER' | 'LEGAL_COUNSEL' | 'GENERAL_APPROVER';

export type ApprovalPolicy = 'ALL_MUST_APPROVE' | 'ANY_CAN_APPROVE';

export interface WorkflowStep {
  id: string;
  workflowId: string;
  tenantId: string;
  stepOrder: number;
  stepRole: ApprovalRole | string;
  approverId?: string;
  status: WorkflowStepStatus;
  policy?: ApprovalPolicy;
  parallelGroup?: string;
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
  department?: string;
  customSteps?: Array<{
    stepOrder: number;
    stepRole: string;
    approverId?: string;
    policy?: ApprovalPolicy;
    parallelGroup?: string;
  }>;
  metadata?: Record<string, unknown>;
}

export interface SubmitWorkflowDTO {
  comment?: string;
}

export interface ApproveWorkflowDTO {
  comment?: string;
  stepOrder?: number;
  stepId?: string;
}

export interface RejectWorkflowDTO {
  reason: string;
  stepOrder?: number;
  stepId?: string;
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

export interface RuleStepDefinition {
  stepOrder: number;
  stepRole: string;
  approverId?: string;
  policy?: ApprovalPolicy;
  parallelGroup?: string;
}

export interface WorkflowRule {
  id: string;
  tenantId: string;
  workflowType: WorkflowType;
  name: string;
  description?: string;
  minAmount?: number;
  maxAmount?: number;
  department?: string;
  priority: number;
  steps: RuleStepDefinition[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowRuleDTO {
  workflowType: WorkflowType;
  name: string;
  description?: string;
  minAmount?: number;
  maxAmount?: number;
  department?: string;
  priority?: number;
  steps: RuleStepDefinition[];
  active?: boolean;
}
