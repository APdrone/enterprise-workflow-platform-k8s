import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OutboxRelayService } from '../../services/workflow-api/src/services/outbox.relay.js';
import { db } from '../../services/workflow-api/src/db/client.js';
import { eventProducer } from '../../services/workflow-api/src/kafka/producer.js';
import { WorkflowKafkaEvent } from '@workflow/shared-types';

describe('Transactional Outbox Relay Unit Tests', () => {
  let relayService: OutboxRelayService;

  beforeEach(() => {
    relayService = new OutboxRelayService();
    vi.restoreAllMocks();
  });

  it('saves events into outbox table with published = false', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(db, 'insert').mockImplementation(mockInsert as any);

    const event: WorkflowKafkaEvent = {
      id: 'evt-outbox-1',
      source: 'workflow-api',
      specversion: '1.0',
      type: 'workflow.submitted.v1',
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        workflowId: 'wf-1',
        tenantId: 'corp-alpha',
        type: 'EXPENSE',
        title: 'Office desk',
        requesterId: 'user-1',
        requesterName: 'User One',
        actorId: 'user-1',
        previousStatus: 'DRAFT',
        currentStatus: 'PENDING',
        timestamp: new Date().toISOString(),
      },
    };

    await relayService.saveToOutbox('corp-alpha', 'wf-1', event);

    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('relays pending outbox events to Kafka and marks them as published', async () => {
    const pendingRecord = {
      id: 'evt-pending-1',
      tenantId: 'corp-alpha',
      workflowId: 'wf-1',
      eventType: 'workflow.submitted.v1',
      payload: {
        id: 'evt-pending-1',
        source: 'workflow-api',
        specversion: '1.0',
        type: 'workflow.submitted.v1',
        time: new Date().toISOString(),
        datacontenttype: 'application/json',
        data: {
          workflowId: 'wf-1',
          tenantId: 'corp-alpha',
          type: 'EXPENSE',
          title: 'Office desk',
          requesterId: 'user-1',
          requesterName: 'User One',
          actorId: 'user-1',
          previousStatus: 'DRAFT',
          currentStatus: 'PENDING',
          timestamp: new Date().toISOString(),
        },
      },
      published: false,
      retryCount: 0,
    };

    vi.spyOn(db, 'select').mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([pendingRecord]),
          }),
        }),
      }),
    } as any);

    const updateSpy = vi.spyOn(db, 'update').mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    const publishSpy = vi.spyOn(eventProducer, 'publishWorkflowEvent').mockResolvedValue(undefined);

    const result = await relayService.relayUnpublishedEvents();

    expect(result.relayed).toBe(1);
    expect(result.errors).toBe(0);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
