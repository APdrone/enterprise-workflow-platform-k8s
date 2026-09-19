import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { WorkflowKafkaEvent, NotificationRecord } from '@workflow/shared-types';
import { validateEvent } from '@workflow/shared-schemas';
import { getTracer, getMetrics } from '@workflow/telemetry';
import { notificationStore } from './store.js';

const tracer = getTracer('notification-service');
const metrics = getMetrics('notification-service');

export class NotificationConsumer {
  private kafka?: Kafka;
  private consumer?: Consumer;
  private isConnected: boolean = false;

  constructor() {
    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    this.kafka = new Kafka({
      clientId: 'notification-service',
      brokers,
      retry: {
        initialRetryTime: 300,
        retries: 5,
      },
    });

    this.consumer = this.kafka.consumer({
      groupId: process.env.KAFKA_GROUP_ID || 'notification-service-group',
    });
  }

  async start(): Promise<void> {
    try {
      if (!this.consumer) return;
      await this.consumer.connect();
      this.isConnected = true;
      console.log('[notification-service] Connected to Kafka brokers.');

      await this.consumer.subscribe({
        topic: 'workflow.events',
        fromBeginning: true,
      });

      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.processMessage(payload);
        },
      });

      console.log('[notification-service] Listening on workflow.events topic.');
    } catch (error) {
      console.warn(
        '[notification-service] Could not connect to Kafka. Running in standalone mode:',
        (error as Error).message
      );
      this.isConnected = false;
    }
  }

  async stop(): Promise<void> {
    if (this.consumer && this.isConnected) {
      await this.consumer.disconnect();
    }
    this.isConnected = false;
  }

  async processMessage(payload: EachMessagePayload): Promise<void> {
    const rawValue = payload.message.value?.toString('utf-8');
    if (!rawValue) return;

    const traceparent = payload.message.headers?.['traceparent']?.toString();
    const correlationId = payload.message.headers?.['x-correlation-id']?.toString();

    let eventType = 'unknown';

    try {
      const event: WorkflowKafkaEvent = JSON.parse(rawValue);
      eventType = event.type;

      const span = tracer.startSpan(`Kafka Consume: ${event.type}`, traceparent);
      span.setAttribute('kafka.topic', payload.topic);
      span.setAttribute('kafka.partition', payload.partition);
      span.setAttribute('tenant.id', event.data.tenantId);
      if (correlationId) {
        span.setAttribute('correlation.id', correlationId);
      }

      // Validate schema
      const validation = validateEvent(event.type, event);
      if (!validation.valid) {
        console.warn(`[notification-service] Invalid event schema received: ${validation.errors?.join(', ')}`);
        span.status = 'ERROR';
        span.end();
        metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'schema_error' });
        return;
      }

      // Idempotency check: Ignore duplicate events
      if (notificationStore.hasProcessedEvent(event.id)) {
        console.log(`[notification-service] Duplicate event ignored: ${event.id}`);
        span.end();
        metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'duplicate_ignored' });
        return;
      }

      notificationStore.markEventProcessed(event.id);

      // Format notification based on event type
      const notification = this.createNotificationFromEvent(event);
      if (notification) {
        notificationStore.addNotification(notification);
        console.log(
          `🔔 [NOTIFICATION DISPATCHED] To: ${notification.recipientId} | Type: ${notification.type} | "${notification.title}" - ${notification.body}`
        );
      }

      span.end();
      metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'processed' });
    } catch (err) {
      console.error('[notification-service] Error processing message:', err);
      metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'error' });
    }
  }

  private createNotificationFromEvent(event: WorkflowKafkaEvent): NotificationRecord | null {
    const { data, type } = event;
    const now = new Date().toISOString();

    switch (type) {
      case 'workflow.submitted.v1':
        return {
          id: `notif-${event.id}`,
          tenantId: data.tenantId,
          recipientId: 'approver-team',
          type: 'SUBMITTED',
          title: `New Workflow Request: ${data.title}`,
          body: `${data.requesterName} submitted a ${data.type} request ($${data.amount || 0}) for review.`,
          workflowId: data.workflowId,
          read: false,
          createdAt: now,
        };

      case 'workflow.step_approved.v1':
        return {
          id: `notif-${event.id}`,
          tenantId: data.tenantId,
          recipientId: 'next-approver-team',
          type: 'STEP_APPROVED' as any,
          title: `Step ${data.currentStepOrder} Approved: ${data.title}`,
          body: `Step ${data.currentStepOrder}/${data.totalSteps} approved by ${data.actorId}. Next step approval is pending.`,
          workflowId: data.workflowId,
          read: false,
          createdAt: now,
        };

      case 'workflow.approved.v1':
        return {
          id: `notif-${event.id}`,
          tenantId: data.tenantId,
          recipientId: data.requesterId,
          type: 'APPROVED',
          title: `Workflow Approved: ${data.title}`,
          body: `Your request has been fully approved by ${data.actorId}.`,
          workflowId: data.workflowId,
          read: false,
          createdAt: now,
        };

      case 'workflow.rejected.v1':
        return {
          id: `notif-${event.id}`,
          tenantId: data.tenantId,
          recipientId: data.requesterId,
          type: 'REJECTED',
          title: `Workflow Rejected: ${data.title}`,
          body: `Your request was rejected. Reason: ${data.rejectionReason || 'No reason provided'}`,
          workflowId: data.workflowId,
          read: false,
          createdAt: now,
        };

      case 'workflow.cancelled.v1':
        return {
          id: `notif-${event.id}`,
          tenantId: data.tenantId,
          recipientId: data.requesterId,
          type: 'CANCELLED',
          title: `Workflow Cancelled: ${data.title}`,
          body: `Workflow ${data.title} was cancelled.`,
          workflowId: data.workflowId,
          read: false,
          createdAt: now,
        };

      default:
        return null;
    }
  }
}
