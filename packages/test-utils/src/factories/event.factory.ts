import { v4 as uuidv4 } from 'uuid';
import { WorkflowKafkaEvent, WorkflowEventType, WorkflowEventData } from '@workflow/shared-types';

export function buildWorkflowEvent(
  type: WorkflowEventType,
  dataOverrides: Partial<WorkflowEventData> = {},
  envelopeOverrides: Partial<WorkflowKafkaEvent> = {}
): WorkflowKafkaEvent {
  const now = new Date().toISOString();
  const workflowId = dataOverrides.workflowId || uuidv4();
  const tenantId = dataOverrides.tenantId || 'tenant-test-1';

  let previousStatus = dataOverrides.previousStatus || 'DRAFT';
  let currentStatus = dataOverrides.currentStatus || 'PENDING';

  if (type === 'workflow.approved.v1') {
    previousStatus = 'PENDING';
    currentStatus = 'APPROVED';
  } else if (type === 'workflow.rejected.v1') {
    previousStatus = 'PENDING';
    currentStatus = 'REJECTED';
  } else if (type === 'workflow.cancelled.v1') {
    previousStatus = dataOverrides.previousStatus || 'PENDING';
    currentStatus = 'CANCELLED';
  }

  const defaultData: WorkflowEventData = {
    workflowId,
    tenantId,
    type: 'EXPENSE',
    title: 'Conference Registration Fee',
    amount: 500,
    currency: 'USD',
    requesterId: 'user-emp-1',
    requesterName: 'Alice Johnson',
    actorId: 'user-emp-1',
    previousStatus,
    currentStatus,
    timestamp: now,
    ...dataOverrides,
  };

  return {
    id: uuidv4(),
    source: 'workflow-api',
    specversion: '1.0',
    type,
    time: now,
    datacontenttype: 'application/json',
    data: defaultData,
    ...envelopeOverrides,
  };
}
