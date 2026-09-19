export interface AuditEventRecord {
  id: string;
  workflowId: string;
  tenantId: string;
  eventType: string;
  actorId: string;
  timestamp: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditTrailResponse {
  workflowId: string;
  events: AuditEventRecord[];
}
