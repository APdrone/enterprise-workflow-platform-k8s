import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { WorkflowKafkaEvent } from '@workflow/shared-types';
import { validateEvent } from '@workflow/shared-schemas';
import { getTracer, getMetrics } from '@workflow/telemetry';
import { db } from './db/client.js';
import { auditEvents } from './db/schema.js';

const tracer = getTracer('audit-service');
const metrics = getMetrics('audit-service');

export class AuditConsumer {
  private kafka?: Kafka;
  private consumer?: Consumer;
  private isConnected: boolean = false;

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
  }

  async start(): Promise<void> {
    try {
      if (!this.consumer) return;
      await this.consumer.connect();
      this.isConnected = true;
      console.log('[audit-service] Connected to Kafka brokers.');

      await this.consumer.subscribe({
        topic: 'workflow.events',
        fromBeginning: true,
      });

      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.processMessage(payload);
        },
      });

      console.log('[audit-service] Listening on workflow.events topic.');
    } catch (error) {
      console.warn(
        '[audit-service] Could not connect to Kafka. Running in standalone mode:',
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
        console.warn(`[audit-service] Invalid event schema received: ${validation.errors?.join(', ')}`);
        span.status = 'ERROR';
        span.end();
        metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'schema_error' });
        return;
      }

      // Persist to audit_events table
      await db.insert(auditEvents).values({
        id: event.id,
        workflowId: event.data.workflowId,
        tenantId: event.data.tenantId,
        eventType: event.type,
        actorId: event.data.actorId,
        timestamp: new Date(event.time),
        payload: event.data as any,
      });

      console.log(`[audit-service] Recorded audit event ${event.type} for workflow ${event.data.workflowId}`);
      span.end();
      metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'processed' });
    } catch (err: any) {
      // Postgres unique violation error code 23505 (idempotent duplicate handle)
      if (err.code === '23505') {
        console.log(`[audit-service] Event already persisted in audit table: ${payload.message.key}`);
        metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'duplicate_ignored' });
        return;
      }
      console.error('[audit-service] Error persisting audit record:', err);
      metrics.kafkaEventsConsumed.inc({ event_type: eventType, status: 'error' });
    }
  }
}
