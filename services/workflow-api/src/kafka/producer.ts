import { Kafka, Producer, CompressionTypes } from 'kafkajs';
import { WorkflowKafkaEvent } from '@workflow/shared-types';
import { validateEvent } from '@workflow/shared-schemas';
import { getMetrics } from '@workflow/telemetry';

const metrics = getMetrics('workflow-api');

export class EventProducer {
  private kafka?: Kafka;
  private producer?: Producer;
  public isConnected: boolean = false;
  private isMock: boolean = false;
  public publishedEvents: WorkflowKafkaEvent[] = [];

  constructor(isMock: boolean = false) {
    this.isMock = isMock;
    if (!this.isMock) {
      const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
      this.kafka = new Kafka({
        clientId: 'workflow-api',
        brokers,
        retry: {
          initialRetryTime: 300,
          retries: 5,
        },
      });
      this.producer = this.kafka.producer();
    }
  }

  async connect(): Promise<void> {
    if (this.isMock) {
      this.isConnected = true;
      return;
    }

    try {
      if (this.producer) {
        await this.producer.connect();
        this.isConnected = true;
        console.log('[workflow-api] Kafka producer connected successfully.');
      }
    } catch (error) {
      console.warn('[workflow-api] Could not connect to Kafka broker. Running in fallback mode:', (error as Error).message);
      this.isConnected = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.producer && this.isConnected && !this.isMock) {
      await this.producer.disconnect();
    }
    this.isConnected = false;
  }

  async publishWorkflowEvent(
    event: WorkflowKafkaEvent,
    correlationId?: string,
    traceparent?: string
  ): Promise<void> {
    // 1. Validate with JSON Schema
    const validation = validateEvent(event.type, event);
    if (!validation.valid) {
      console.error('[workflow-api] Event validation failed:', validation.errors);
      throw new Error(`Schema validation error for ${event.type}: ${validation.errors?.join(', ')}`);
    }

    this.publishedEvents.push(event);

    // Record Prometheus Kafka publish metric
    metrics.kafkaEventsPublished.inc({
      event_type: event.type,
      topic: 'workflow.events',
    });

    if (this.isMock || !this.isConnected || !this.producer) {
      console.log(`[workflow-api] [MOCK / LOCAL] Published event ${event.type} for workflow ${event.data.workflowId}`);
      return;
    }

    // 2. Publish to Kafka with partition key = tenantId:workflowId (ordering guarantee)
    const key = `${event.data.tenantId}:${event.data.workflowId}`;
    const headers: Record<string, string> = {
      'ce-id': event.id,
      'ce-source': event.source,
      'ce-type': event.type,
      'ce-specversion': event.specversion,
      'ce-time': event.time,
      'tenant-id': event.data.tenantId,
      'x-correlation-id': correlationId || event.id,
    };

    if (traceparent) {
      headers['traceparent'] = traceparent;
    }

    await this.producer.send({
      topic: 'workflow.events',
      messages: [
        {
          key,
          value: JSON.stringify(event),
          headers,
        },
      ],
      compression: CompressionTypes.GZIP,
    });

    console.log(`[workflow-api] Published ${event.type} for workflow ${event.data.workflowId} to Kafka topic workflow.events`);
  }
}

export const eventProducer = new EventProducer(process.env.NODE_ENV === 'test' && !process.env.TEST_WITH_REAL_KAFKA);
