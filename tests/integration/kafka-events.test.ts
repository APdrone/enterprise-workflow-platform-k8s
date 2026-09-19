import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { NotificationConsumer } from '../../services/notification-service/src/consumer.js';
import { notificationStore } from '../../services/notification-service/src/store.js';
import { buildWorkflowEvent } from '../../packages/test-utils/src/factories/event.factory.js';

describe('Kafka Consumer Integration & Idempotency Tests', () => {
  let consumer: NotificationConsumer;

  beforeEach(() => {
    consumer = new NotificationConsumer();
    notificationStore.clear();
  });

  it('processes incoming workflow.submitted event and stores notification', async () => {
    const workflowId = uuidv4();
    const event = buildWorkflowEvent('workflow.submitted.v1', {
      workflowId,
      tenantId: 'tenant-corp-a',
      title: 'DevOps Training Subscription',
      amount: 400,
    });

    const mockPayload: any = {
      message: {
        key: Buffer.from(`${event.data.tenantId}:${event.data.workflowId}`),
        value: Buffer.from(JSON.stringify(event)),
      },
    };

    await consumer.processMessage(mockPayload);

    const notifications = notificationStore.getNotifications('tenant-corp-a');
    expect(notifications.length).toBe(1);
    expect(notifications[0].type).toBe('SUBMITTED');
    expect(notifications[0].title).toContain('DevOps Training Subscription');
  });

  it('enforces idempotency: ignores duplicate Kafka messages with identical event ID', async () => {
    const workflowId = uuidv4();
    const event = buildWorkflowEvent('workflow.approved.v1', {
      workflowId,
      tenantId: 'tenant-corp-a',
      title: 'Monitor Purchase',
    });

    const mockPayload: any = {
      message: {
        key: Buffer.from(`${event.data.tenantId}:${event.data.workflowId}`),
        value: Buffer.from(JSON.stringify(event)),
      },
    };

    // First delivery
    await consumer.processMessage(mockPayload);
    expect(notificationStore.getNotifications('tenant-corp-a').length).toBe(1);

    // Duplicate redelivery
    await consumer.processMessage(mockPayload);
    // Should still be exactly 1 notification, not 2
    expect(notificationStore.getNotifications('tenant-corp-a').length).toBe(1);
  });
});
