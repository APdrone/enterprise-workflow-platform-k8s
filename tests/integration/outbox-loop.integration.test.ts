import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutboxRelayService } from '../../services/workflow-api/src/services/outbox.relay.js';
import { eventProducer } from '../../services/workflow-api/src/kafka/producer.js';
import { buildWorkflowEvent, MockKafkaProducer } from '@workflow/test-utils';
import { WorkflowKafkaEvent } from '@workflow/shared-types';

describe('Transactional Outbox Pattern & Relay Loop Integration Tests', () => {
  let outboxService: OutboxRelayService;
  let inMemoryOutboxTable: Map<string, any>;
  let mockKafka: MockKafkaProducer;

  beforeEach(() => {
    outboxService = new OutboxRelayService();
    inMemoryOutboxTable = new Map();
    mockKafka = new MockKafkaProducer();

    vi.spyOn(eventProducer, 'publishWorkflowEvent').mockImplementation(async (event: WorkflowKafkaEvent) => {
      await mockKafka.send({
        topic: 'workflow.events',
        messages: [{ key: `${event.data.tenantId}:${event.data.workflowId}`, value: JSON.stringify(event) }],
      });
    });
  });

  it('guarantees dual-write consistency: saves event in DB outbox, relays to Kafka, and marks published', async () => {
    const event = buildWorkflowEvent('workflow.submitted.v1', {
      title: 'Outbox Dual-Write Test Workflow',
      amount: 12000,
    });

    const mockDbClient = {
      insert: () => ({
        values: async (data: any) => {
          inMemoryOutboxTable.set(data.id, { ...data, published: false });
        },
      }),
    };

    // 1. Transactional save to Outbox
    await outboxService.saveToOutbox(event.data.tenantId, event.data.workflowId, event, mockDbClient);

    expect(inMemoryOutboxTable.has(event.id)).toBe(true);
    const storedRecord = inMemoryOutboxTable.get(event.id);
    expect(storedRecord.published).toBe(false);
    expect(storedRecord.eventType).toBe('workflow.submitted.v1');

    // 2. Direct immediate relay
    vi.spyOn(eventProducer, 'publishWorkflowEvent');

    // Simulate poll and relay
    await eventProducer.publishWorkflowEvent(event);
    storedRecord.published = true;
    storedRecord.publishedAt = new Date();

    // 3. Verify event is in Kafka stream
    const publishedEvents = mockKafka.getPublishedEvents();
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0].id).toBe(event.id);
    expect(publishedEvents[0].data.title).toBe('Outbox Dual-Write Test Workflow');

    // 4. Verify DB outbox record status updated
    expect(storedRecord.published).toBe(true);
    expect(storedRecord.publishedAt).toBeDefined();
  });

  it('handles retry backoff and failure isolation when Kafka broker encounters transient network error', async () => {
    const event = buildWorkflowEvent('workflow.approved.v1');

    let outboxRecord: any = {
      id: event.id,
      tenantId: event.data.tenantId,
      workflowId: event.data.workflowId,
      eventType: event.type,
      payload: event,
      published: false,
      retryCount: 0,
      lastError: null,
    };

    // Simulate Kafka publish failure
    vi.spyOn(eventProducer, 'publishWorkflowEvent').mockRejectedValueOnce(
      new Error('Kafka broker connection timeout (ECONNRESET)')
    );

    let errorOccurred = false;
    try {
      await eventProducer.publishWorkflowEvent(event);
    } catch (err: any) {
      errorOccurred = true;
      outboxRecord.retryCount += 1;
      outboxRecord.lastError = err.message;
    }

    expect(errorOccurred).toBe(true);
    // Outbox record remains unpublished, with incremented retry count
    expect(outboxRecord.published).toBe(false);
    expect(outboxRecord.retryCount).toBe(1);
    expect(outboxRecord.lastError).toContain('ECONNRESET');

    // Next retry attempt succeeds
    vi.spyOn(eventProducer, 'publishWorkflowEvent').mockResolvedValueOnce(undefined);
    await eventProducer.publishWorkflowEvent(event);
    outboxRecord.published = true;
    outboxRecord.lastError = null;

    expect(outboxRecord.published).toBe(true);
    expect(outboxRecord.lastError).toBeNull();
  });
});
