import { Kafka, Consumer, Producer, EachMessagePayload } from 'kafkajs';
import { WorkflowKafkaEvent, NotificationRecord, DLQErrorType } from '@workflow/shared-types';
import {
  validateEvent,
  TOPIC_WORKFLOW_EVENTS,
  TOPIC_WORKFLOW_RETRY,
  TOPIC_WORKFLOW_DLQ,
  MAX_RETRY_COUNT,
  calculateBackoffDelay,
  buildResilienceHeaders,
} from '@workflow/shared-schemas';
import { getTracer, getMetrics, getLogger, traceStorage } from '@workflow/telemetry';
import { notificationStore } from './store.js';
import { sseManager } from './sse.js';

const tracer = getTracer('notification-service');
const metrics = getMetrics('notification-service');
const logger = getLogger('notification-service');


export class NotificationConsumer {
  private kafka?: Kafka;
  private consumer?: Consumer;
  private producer?: Producer;
  public isConnected: boolean = false;

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

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
    });
  }

  async start(): Promise<void> {
    try {
      if (!this.consumer || !this.producer) return;
      await this.producer.connect();
      await this.consumer.connect();
      this.isConnected = true;
      console.log('[notification-service] Connected to Kafka producer and consumer.');

      await this.consumer.subscribe({
        topics: [TOPIC_WORKFLOW_EVENTS, TOPIC_WORKFLOW_RETRY],
        fromBeginning: true,
      });

      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.processMessage(payload);
        },
      });

      console.log('[notification-service] Listening on workflow.events and workflow.events.retry topics.');
    } catch (error) {
      console.warn(
        '[notification-service] Could not connect to Kafka. Running in standalone mode:',
        (error as Error).message
      );
      this.isConnected = false;
    }
  }

  async stop(): Promise<void> {
    if (this.isConnected) {
      if (this.consumer) await this.consumer.disconnect();
      if (this.producer) await this.producer.disconnect();
    }
    this.isConnected = false;
  }

  async processMessage(payload: EachMessagePayload): Promise<void> {
    const { topic } = payload;
    const rawValue = payload.message.value?.toString('utf-8');
    if (!rawValue) return;

    const rawHeaders: Record<string, string> = {};
    if (payload.message.headers) {
      for (const [key, val] of Object.entries(payload.message.headers)) {
        if (val) rawHeaders[key] = val.toString();
      }
    }

    const traceparent = rawHeaders['traceparent'];
    const correlationId = rawHeaders['x-correlation-id'];
    const retryCount = parseInt(rawHeaders['x-retry-count'] || '0', 10);
    const key = payload.message.key?.toString();

    let parsedEvent: any;
    try {
      parsedEvent = JSON.parse(rawValue);
    } catch (parseErr: any) {
      logger.error('Unparseable JSON message received. Routing to DLQ', { topic, correlationId, traceId: traceparent }, parseErr);
      await this.routeToDLQ({
        originalTopic: topic,
        key,
        rawValue,
        errorType: 'UNPARSEABLE_JSON',
        errorMessage: `JSON parse error: ${parseErr.message}`,
        retryCount,
        correlationId,
        traceparent,
      });
      return;
    }

    const event = parsedEvent as WorkflowKafkaEvent;
    const eventType = event.type || 'unknown';

    const span = tracer.startSpan(`Kafka Consume: ${eventType}`, traceparent);
    span.setAttribute('kafka.topic', topic);
    span.setAttribute('kafka.partition', payload.partition);
    if (event.data?.tenantId) span.setAttribute('tenant.id', event.data.tenantId);
    if (correlationId) span.setAttribute('correlation.id', correlationId);

    traceStorage.enterWith({
      span,
      traceparent: span.toTraceparent(),
      tenantId: event.data?.tenantId,
    });

    const eventLogger = logger.child({
      traceId: span.context.traceId,
      spanId: span.context.spanId,
      tenantId: event.data?.tenantId,
      correlationId,
      workflowId: event.data?.workflowId,
    });

    // Validate schema
    const validation = validateEvent(event.type, event);
    if (!validation.valid) {
      const errorMsg = validation.errors?.join(', ') || 'Schema validation failed';
      eventLogger.warn(`Invalid schema for ${event.type}. Routing to DLQ`, { errorMsg });
      span.status = 'ERROR';
      span.end();
      metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'schema_error' });

      await this.routeToDLQ({
        originalTopic: topic,
        key,
        rawValue,
        errorType: 'SCHEMA_VALIDATION_ERROR',
        errorMessage: errorMsg,
        retryCount,
        tenantId: event.data?.tenantId,
        workflowId: event.data?.workflowId,
        correlationId,
        traceparent,
      });
      return;
    }

    // Handle retry backoff
    if (topic === TOPIC_WORKFLOW_RETRY && retryCount > 0) {
      const delay = calculateBackoffDelay(retryCount);
      eventLogger.info(`Processing retry attempt #${retryCount} after ${delay}ms backoff`, { retryCount, delay });
    }

    try {
      // Idempotency check: Ignore duplicate events
      if (notificationStore.hasProcessedEvent(event.id)) {
        eventLogger.info(`Duplicate event ignored: ${event.id}`, { eventId: event.id });
        span.end();
        metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'duplicate_ignored' });
        return;
      }

      notificationStore.markEventProcessed(event.id);

      // Format notification based on event type
      const notification = this.createNotificationFromEvent(event);
      if (notification) {
        notificationStore.addNotification(notification);
        eventLogger.info(`Notification dispatched to ${notification.recipientId}`, {
          recipientId: notification.recipientId,
          type: notification.type,
          title: notification.title,
        });
      }

      // Real-time SSE Broadcast to active UI clients
      sseManager.broadcast(
        event.data.tenantId,
        {
          type: event.type,
          data: event.data,
          notification: notification || undefined,
        },
        notification?.recipientId
      );

      span.end();
      metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'processed' });
    } catch (err: any) {
      eventLogger.error(`Error processing notification (attempt ${retryCount}/${MAX_RETRY_COUNT})`, { retryCount }, err);
      span.status = 'ERROR';
      span.end();
      metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'error' });


      if (retryCount < MAX_RETRY_COUNT) {
        await this.routeToRetry({
          originalTopic: topic === TOPIC_WORKFLOW_RETRY ? (rawHeaders['x-original-topic'] || TOPIC_WORKFLOW_EVENTS) : topic,
          key,
          rawValue,
          errorType: 'PROCESSING_ERROR',
          errorMessage: err.message || 'Notification processing error',
          retryCount: retryCount + 1,
          tenantId: event.data?.tenantId,
          workflowId: event.data?.workflowId,
          correlationId,
          traceparent,
        });
      } else {
        await this.routeToDLQ({
          originalTopic: rawHeaders['x-original-topic'] || topic,
          key,
          rawValue,
          errorType: 'MAX_RETRIES_EXCEEDED',
          errorMessage: `Exceeded max retries (${MAX_RETRY_COUNT}): ${err.message}`,
          retryCount,
          tenantId: event.data?.tenantId,
          workflowId: event.data?.workflowId,
          correlationId,
          traceparent,
        });
      }
    }
  }

  private async routeToRetry(opts: {
    originalTopic: string;
    key?: string;
    rawValue: string;
    errorType: DLQErrorType;
    errorMessage: string;
    retryCount: number;
    tenantId?: string;
    workflowId?: string;
    correlationId?: string;
    traceparent?: string;
  }): Promise<void> {
    if (!this.producer || !this.isConnected) return;
    try {
      const headers = buildResilienceHeaders(opts);
      await this.producer.send({
        topic: TOPIC_WORKFLOW_RETRY,
        messages: [
          {
            key: opts.key,
            value: opts.rawValue,
            headers,
          },
        ],
      });
      console.log(`[notification-service] Sent message to ${TOPIC_WORKFLOW_RETRY} (Retry #${opts.retryCount})`);
    } catch (err) {
      console.error('[notification-service] Failed to route message to retry topic:', err);
    }
  }

  private async routeToDLQ(opts: {
    originalTopic: string;
    key?: string;
    rawValue: string;
    errorType: DLQErrorType;
    errorMessage: string;
    retryCount: number;
    tenantId?: string;
    workflowId?: string;
    correlationId?: string;
    traceparent?: string;
  }): Promise<void> {
    if (!this.producer || !this.isConnected) return;
    try {
      const headers = buildResilienceHeaders(opts);
      await this.producer.send({
        topic: TOPIC_WORKFLOW_DLQ,
        messages: [
          {
            key: opts.key,
            value: opts.rawValue,
            headers,
          },
        ],
      });
      metrics.dlqMessagesTotal.inc({ error_type: opts.errorType });
      logger.warn(`Poison-pill / failed message routed to ${TOPIC_WORKFLOW_DLQ}`, { errorType: opts.errorType, correlationId: opts.correlationId });
    } catch (err: any) {
      logger.error('Failed to route message to DLQ topic', { errorType: opts.errorType }, err);
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
