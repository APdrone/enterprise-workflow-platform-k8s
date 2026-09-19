export interface NotificationRecord {
  id: string;
  tenantId: string;
  recipientId: string;
  type: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  title: string;
  body: string;
  workflowId: string;
  read: boolean;
  createdAt: string;
}
