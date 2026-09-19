import { WorkflowStatus, WorkflowType } from './workflow.types.js';

export type WorkflowEventType =
  | 'workflow.submitted.v1'
  | 'workflow.approved.v1'
  | 'workflow.step_approved.v1'
  | 'workflow.rejected.v1'
  | 'workflow.cancelled.v1';

export interface WorkflowEventData {
  workflowId: string;
  tenantId: string;
  type: WorkflowType;
  title: string;
  amount?: number;
  currency?: string;
  requesterId: string;
  requesterName: string;
  actorId: string;
  previousStatus: WorkflowStatus;
  currentStatus: WorkflowStatus;
  currentStepOrder?: number;
  totalSteps?: number;
  stepRole?: string;
  isDelegated?: boolean;
  delegatedFrom?: string;
  comment?: string;
  rejectionReason?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface CloudEventEnvelope<T = WorkflowEventData> {
  id: string;
  source: string;
  specversion: '1.0';
  type: WorkflowEventType;
  time: string;
  datacontenttype: 'application/json';
  data: T;
}

export type WorkflowKafkaEvent = CloudEventEnvelope<WorkflowEventData>;
