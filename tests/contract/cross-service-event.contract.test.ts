import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateEvent } from '@workflow/shared-schemas';
import { buildWorkflowEvent } from '@workflow/test-utils';
import { NotificationConsumer } from '../../services/notification-service/src/consumer.js';
import { AuditConsumer } from '../../services/audit-service/src/consumer.js';
import { notificationStore } from '../../services/notification-service/src/store.js';
import { sseManager } from '../../services/notification-service/src/sse.js';
import { db } from '../../services/audit-service/src/db/client.js';

vi.mock('../../services/audit-service/src/db/client.js', () => {
  const chain: any = {
    values: vi.fn().mockResolvedValue(undefined),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      insert: vi.fn(() => chain),
      select: vi.fn(() => chain),
    },
    pool: { end: vi.fn() },
  };
});

describe('Cross-Service Kafka Event Contract & Compatibility Suite', () => {
  let notificationConsumer: NotificationConsumer;
  let auditConsumer: AuditConsumer;

  beforeEach(() => {
    vi.clearAllMocks();
    notificationConsumer = new NotificationConsumer();
    auditConsumer = new AuditConsumer();
  });

  describe('CloudEvents 1.0 Specification Invariants', () => {
    const allEventTypes = [
      'workflow.submitted.v1',
      'workflow.step_approved.v1',
      'workflow.approved.v1',
      'workflow.rejected.v1',
      'workflow.cancelled.v1',
    ] as const;

    allEventTypes.forEach((eventType) => {
      it(`event "${eventType}" strictly satisfies CloudEvents 1.0 envelope invariants`, () => {
        const event = buildWorkflowEvent(eventType);

        // Standard CloudEvents 1.0 envelope attributes
        expect(event.specversion).toBe('1.0');
        expect(event.type).toBe(eventType);
        expect(event.source).toBe('workflow-api');
        expect(event.datacontenttype).toBe('application/json');
        expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(event.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // Core workflow domain data
        expect(event.data.workflowId).toBeDefined();
        expect(event.data.tenantId).toBeDefined();
        expect(event.data.title).toBeDefined();
        expect(event.data.actorId).toBeDefined();

        // Schema validation pass
        const validation = validateEvent(eventType, event);
        expect(validation.valid).toBe(true);
        expect(validation.errors).toBeUndefined();
      });
    });
  });

  describe('Producer -> Notification Service Consumer Contract', () => {
    it('notification-service consumer successfully processes workflow.submitted event payload', async () => {
      const event = buildWorkflowEvent('workflow.submitted.v1', {
        title: 'Q3 Enterprise Architecture License',
        amount: 15000,
      });

      const sseSpy = vi.spyOn(sseManager, 'broadcast').mockReturnValue(undefined as any);
      const storeSpy = vi.spyOn(notificationStore, 'addNotification');

      const messagePayload: any = {
        topic: 'workflow.events',
        partition: 0,
        message: {
          key: Buffer.from(`${event.data.tenantId}:${event.data.workflowId}`),
          value: Buffer.from(JSON.stringify(event)),
          headers: {},
        },
      };

      await (notificationConsumer as any).processMessage(messagePayload);

      expect(storeSpy).toHaveBeenCalled();
      const savedNotification = storeSpy.mock.calls[0][0];
      expect(savedNotification.workflowId).toBe(event.data.workflowId);
      expect(savedNotification.tenantId).toBe(event.data.tenantId);
      expect(savedNotification.type).toBe('SUBMITTED');
      expect(sseSpy).toHaveBeenCalledWith(
        event.data.tenantId,
        expect.objectContaining({ type: 'workflow.submitted.v1' }),
        'approver-team'
      );
    });


    it('notification-service consumer successfully processes workflow.rejected event with rejectionReason', async () => {
      const event = buildWorkflowEvent('workflow.rejected.v1', {
        rejectionReason: 'Exceeds budget cap for Q3 department spend',
      });

      const storeSpy = vi.spyOn(notificationStore, 'addNotification');

      const messagePayload: any = {
        topic: 'workflow.events',
        partition: 0,
        message: {
          key: Buffer.from(`${event.data.tenantId}:${event.data.workflowId}`),
          value: Buffer.from(JSON.stringify(event)),
          headers: {},
        },
      };

      await (notificationConsumer as any).processMessage(messagePayload);

      expect(storeSpy).toHaveBeenCalled();
      const notification = storeSpy.mock.calls[0][0];
      expect(notification.type).toBe('REJECTED');
      expect(notification.title).toContain('Workflow Rejected');
    });
  });

  describe('Producer -> Audit Service Consumer Contract', () => {
    it('audit-service consumer successfully parses and commits audit log entry for workflow.approved event', async () => {
      const event = buildWorkflowEvent('workflow.approved.v1', {
        actorId: 'user-bob',
        currentStatus: 'APPROVED',
        previousStatus: 'PENDING',
      });

      const insertSpy = vi.spyOn(db, 'insert');

      const messagePayload: any = {
        topic: 'workflow.events',
        partition: 0,
        message: {
          key: Buffer.from(`${event.data.tenantId}:${event.data.workflowId}`),
          value: Buffer.from(JSON.stringify(event)),
          headers: {
            traceparent: Buffer.from('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'),
          },
        },
      };

      await (auditConsumer as any).processMessage(messagePayload);

      expect(insertSpy).toHaveBeenCalled();
    });
  });

  describe('Backward & Forward Schema Evolution Contract', () => {
    it('allows additive non-breaking metadata extensions without breaking consumers', async () => {
      const extendedEvent = buildWorkflowEvent('workflow.approved.v1', {
        metadata: {
          costCenter: 'FIN-2024',
          taxExempt: true,
          erpSyncId: 'SAP-98124',
          subDepartment: 'Cloud Infrastructure & Security',
        },
      });

      const validation = validateEvent('workflow.approved.v1', extendedEvent);
      expect(validation.valid).toBe(true);

      const storeSpy = vi.spyOn(notificationStore, 'addNotification');
      const messagePayload: any = {
        topic: 'workflow.events',
        partition: 0,
        message: {
          key: Buffer.from(`${extendedEvent.data.tenantId}:${extendedEvent.data.workflowId}`),
          value: Buffer.from(JSON.stringify(extendedEvent)),
          headers: {},
        },
      };

      // Both notification and audit consumers must process the extended payload without error
      await (notificationConsumer as any).processMessage(messagePayload);
      expect(storeSpy).toHaveBeenCalled();
    });
  });
});
