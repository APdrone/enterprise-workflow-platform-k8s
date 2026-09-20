import { eq, and, asc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { outboxEvents } from '../db/schema.js';
import { eventProducer } from '../kafka/producer.js';
import { WorkflowKafkaEvent } from '@workflow/shared-types';
import { getLogger, getMetrics } from '@workflow/telemetry';

const logger = getLogger('workflow-api');
const metrics = getMetrics('workflow-api');

export class OutboxRelayService {
  private intervalId: NodeJS.Timeout | null = null;
  private isProcessing = false;

  async saveToOutbox(
    tenantId: string,
    workflowId: string,
    event: WorkflowKafkaEvent,
    dbClient: any = db,
    traceparent?: string
  ): Promise<void> {
    if (traceparent) {
      event.data = event.data || {} as any;
      event.data.metadata = event.data.metadata || {};
      event.data.metadata.traceparent = traceparent;
    }

    await dbClient.insert(outboxEvents).values({
      id: event.id,
      tenantId,
      workflowId,
      eventType: event.type,
      payload: event,
      published: false,
      retryCount: 0,
      createdAt: new Date(),
    });

    metrics.outboxUnpublishedEvents.inc();
  }

  async relayEventImmediately(eventId: string): Promise<boolean> {
    try {
      const records = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, eventId))
        .limit(1);

      if (records.length === 0 || records[0].published) {
        return true;
      }

      const record = records[0];
      const event = record.payload as WorkflowKafkaEvent;
      const traceparent = (event.data as any)?.metadata?.traceparent;
      await eventProducer.publishWorkflowEvent(event, undefined, traceparent);

      await db
        .update(outboxEvents)
        .set({
          published: true,
          publishedAt: new Date(),
          lastError: null,
        })
        .where(eq(outboxEvents.id, eventId));

      metrics.kafkaEventsPublished.inc({ event_type: event.type });
      metrics.outboxUnpublishedEvents.dec();
      return true;
    } catch (err: any) {
      logger.warn(`Immediate outbox publish failed for event ${eventId}, will retry in background`, { eventId }, err);
      await db
        .update(outboxEvents)
        .set({
          retryCount: sql`${outboxEvents.retryCount} + 1`,
          lastError: err.message,
        })
        .where(eq(outboxEvents.id, eventId));
      return false;
    }
  }

  async relayUnpublishedEvents(batchSize: number = 20): Promise<{ relayed: number; errors: number }> {
    if (this.isProcessing) return { relayed: 0, errors: 0 };
    this.isProcessing = true;

    const startTime = Date.now();
    let relayed = 0;
    let errors = 0;

    try {
      const pending = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.published, false))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(batchSize);

      metrics.outboxUnpublishedEvents.set({}, pending.length);

      for (const record of pending) {
        try {
          const event = record.payload as WorkflowKafkaEvent;
          const traceparent = (event.data as any)?.metadata?.traceparent;
          await eventProducer.publishWorkflowEvent(event, undefined, traceparent);

          await db
            .update(outboxEvents)
            .set({
              published: true,
              publishedAt: new Date(),
              lastError: null,
            })
            .where(eq(outboxEvents.id, record.id));

          metrics.kafkaEventsPublished.inc({ event_type: event.type });
          relayed++;
        } catch (err: any) {
          errors++;
          logger.error(`Error dispatching outbox event ${record.id}`, { eventId: record.id, tenantId: record.tenantId }, err);
          await db
            .update(outboxEvents)
            .set({
              retryCount: record.retryCount + 1,
              lastError: err.message,
            })
            .where(eq(outboxEvents.id, record.id));
        }
      }

      if (pending.length > 0) {
        metrics.outboxRelayDuration.observe({}, (Date.now() - startTime) / 1000);
      }
    } finally {
      this.isProcessing = false;
    }

    return { relayed, errors };
  }


  startWorker(intervalMs: number = 1000): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(async () => {
      try {
        await this.relayUnpublishedEvents();
      } catch (err: any) {
        logger.error('Background outbox relay worker error', {}, err);
      }
    }, intervalMs);
  }


  stopWorker(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const outboxRelayService = new OutboxRelayService();
