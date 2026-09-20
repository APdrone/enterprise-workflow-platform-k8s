import { Kafka, Consumer, Producer, EachMessagePayload } from 'kafkajs';
import { WorkflowKafkaEvent, DLQErrorType } from '@workflow/shared-types';
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
import { eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { auditEvents, dlqMessages } from './db/schema.js';
import crypto from 'node:crypto';

const tracer = getTracer('audit-service');
const metrics = getMetrics('audit-service');
const logger = getLogger('audit-service');


export class AuditConsumer {
  private kafka?: Kafka;
  private consumer?: Consumer;
  private producer?: Producer;
  public isConnected: boolean = false;

  constructor() {

    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    this.kafka = new Kafka({
      clientId: 'audit-service',
      brokers,
      retry: {
        initialRetryTime: 300,
        retries: 5,
      },
    });

    this.consumer = this.kafka.consumer({
      groupId: process.env.KAFKA_GROUP_ID || 'audit-service-group',
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
      console.log('[audit-service] Connected to Kafka producer and consumer.');

      // Subscribe to main, retry, and DLQ topics
      await this.consumer.subscribe({
        topics: [TOPIC_WORKFLOW_EVENTS, TOPIC_WORKFLOW_RETRY, TOPIC_WORKFLOW_DLQ],
        fromBeginning: true,
      });

      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.processMessage(payload);
        },
      });

      console.log('[audit-service] Listening on workflow.events, retry, and dlq topics.');
    } catch (error) {
      console.warn(
        '[audit-service] Could not connect to Kafka. Running in standalone mode:',
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

    // Header extraction
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

    // 1. Handle DLQ topic messages (persist directly to dlq_messages table)
    if (topic === TOPIC_WORKFLOW_DLQ) {
      await this.persistDLQRecord(rawValue, rawHeaders, key);
      return;
    }

    // 2. Handle Retry and Main Event topics
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

    // Schema Validation
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

    // If coming from retry topic, simulate backoff wait if needed
    if (topic === TOPIC_WORKFLOW_RETRY && retryCount > 0) {
      const delay = calculateBackoffDelay(retryCount);
      eventLogger.info(`Processing retry attempt #${retryCount} after ${delay}ms backoff`, { retryCount, delay });
    }

    // Attempt processing (Persist to audit_events table)
    try {
      await db.insert(auditEvents).values({
        id: event.id,
        workflowId: event.data.workflowId,
        tenantId: event.data.tenantId,
        eventType: event.type,
        actorId: event.data.actorId,
        timestamp: new Date(event.time),
        payload: event.data as any,
      });

      eventLogger.info(`Recorded audit event ${event.type} for workflow ${event.data.workflowId}`);
      span.end();
      metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'processed' });
    } catch (err: any) {
      // Postgres unique violation error code 23505 (idempotent duplicate handle)
      if (err.code === '23505') {
        eventLogger.info(`Event already persisted in audit table: ${event.id}`, { eventId: event.id });
        metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'duplicate_ignored' });
        span.end();
        return;
      }

      eventLogger.error(`Error persisting audit record (attempt ${retryCount}/${MAX_RETRY_COUNT})`, { retryCount }, err);
      span.status = 'ERROR';
      span.end();
      metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'error' });


      // Resilience Retry or DLQ escalation
      if (retryCount < MAX_RETRY_COUNT) {
        await this.routeToRetry({
          originalTopic: topic === TOPIC_WORKFLOW_RETRY ? (rawHeaders['x-original-topic'] || TOPIC_WORKFLOW_EVENTS) : topic,
          key,
          rawValue,
          errorType: 'PROCESSING_ERROR',
          errorMessage: err.message || 'Database persistence error',
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

  /**
   * Routes a failed message to the Retry topic
   */
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
      console.log(`[audit-service] Sent message to ${TOPIC_WORKFLOW_RETRY} (Retry #${opts.retryCount})`);
    } catch (err) {
      console.error('[audit-service] Failed to route message to retry topic:', err);
    }
  }

  /**
   * Routes a failed message to the DLQ topic
   */
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


  /**
   * Persists a DLQ event to the Postgres dlq_messages table
   */
  private async persistDLQRecord(rawValue: string, headers: Record<string, string>, key?: string): Promise<void> {
    try {
      let payloadJson: any;
      try {
        payloadJson = JSON.parse(rawValue);
      } catch {
        payloadJson = { raw: rawValue };
      }

      const id = payloadJson?.id || `dlq-${crypto.randomUUID()}`;
      const originalTopic = headers['x-original-topic'] || TOPIC_WORKFLOW_EVENTS;
      const errorType = (headers['x-error-type'] as DLQErrorType) || 'PROCESSING_ERROR';
      const errorMessage = headers['x-error-message'] || 'Unknown processing error';
      const retryCount = parseInt(headers['x-retry-count'] || '0', 10);
      const tenantId = headers['tenant-id'] || payloadJson?.data?.tenantId;
      const workflowId = payloadJson?.data?.workflowId;
      const failedAt = headers['x-failed-at'] ? new Date(headers['x-failed-at']) : new Date();

      await db
        .insert(dlqMessages)
        .values({
          id,
          originalTopic,
          originalKey: key,
          payload: payloadJson,
          errorType,
          errorMessage,
          retryCount,
          tenantId,
          workflowId,
          headers: headers as any,
          status: 'DEAD_LETTERED',
          failedAt,
        })
        .onConflictDoNothing();

      console.log(`[audit-service] 📥 Stored dead-lettered message ${id} in dlq_messages table.`);
    } catch (err) {
      console.error('[audit-service] Failed to persist DLQ record into database:', err);
    }
  }

  /**
   * Replays a dead-lettered message by republishing it to the main workflow.events topic
   */
  async replayDLQMessage(dlqId: string): Promise<{ success: boolean; message: string }> {
    try {
      const records = await db.select().from(dlqMessages).where(eq(dlqMessages.id, dlqId));
      if (!records || records.length === 0) {
        return { success: false, message: `DLQ record ${dlqId} not found` };
      }

      const record = records[0];
      if (!this.producer || !this.isConnected) {
        return { success: false, message: 'Kafka producer not connected' };
      }

      // Republish to originalTopic or workflow.events
      const targetTopic = record.originalTopic || TOPIC_WORKFLOW_EVENTS;
      const payloadString = typeof record.payload === 'string' ? record.payload : JSON.stringify(record.payload);

      await this.producer.send({
        topic: targetTopic,
        messages: [
          {
            key: record.originalKey || undefined,
            value: payloadString,
            headers: {
              'x-replayed-from-dlq': 'true',
              'x-replayed-at': new Date().toISOString(),
              'x-original-dlq-id': record.id,
              'x-retry-count': '0',
            },
          },
        ],
      });

      // Update DLQ record status
      await db
        .update(dlqMessages)
        .set({
          status: 'REPLAYED',
          replayedAt: new Date(),
        })
        .where(eq(dlqMessages.id, dlqId));

      console.log(`[audit-service] 🔄 Replayed DLQ message ${dlqId} back to ${targetTopic}`);
      return { success: true, message: `Replayed to ${targetTopic}` };
    } catch (err: any) {
      console.error(`[audit-service] Failed to replay DLQ message ${dlqId}:`, err);
      return { success: false, message: err.message || 'Replay failed' };
    }
  }
}

export const auditConsumerInstance = new AuditConsumer();
