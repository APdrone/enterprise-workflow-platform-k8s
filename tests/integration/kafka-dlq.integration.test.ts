import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { NotificationConsumer } from '../../services/notification-service/src/consumer.js';
import { AuditConsumer } from '../../services/audit-service/src/consumer.js';

describe('Kafka DLQ & Resilience Integration Tests', () => {
  let notifConsumer: NotificationConsumer;
  let auditConsumer: AuditConsumer;

  beforeEach(() => {
    notifConsumer = new NotificationConsumer();
    auditConsumer = new AuditConsumer();
  });

  it('routes unparseable non-JSON poison pill message to DLQ topic with UNPARSEABLE_JSON errorType', async () => {
    const routeToDLQSpy = vi.spyOn(notifConsumer as any, 'routeToDLQ').mockResolvedValue(undefined);

    const mockPayload: any = {
      topic: 'workflow.events',
      partition: 0,
      message: {
        key: Buffer.from('corrupt-key'),
        value: Buffer.from('THIS IS NOT VALID JSON {{{{ malformed'),
        headers: {},
      },
    };

    await notifConsumer.processMessage(mockPayload);

    expect(routeToDLQSpy).toHaveBeenCalledTimes(1);
    expect(routeToDLQSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: 'UNPARSEABLE_JSON',
        originalTopic: 'workflow.events',
      })
    );
  });

  it('routes schema-violating poison pill to DLQ topic with SCHEMA_VALIDATION_ERROR', async () => {
    const routeToDLQSpy = vi.spyOn(auditConsumer as any, 'routeToDLQ').mockResolvedValue(undefined);

    const poisonPillEvent = {
      id: uuidv4(),
      source: 'unknown-service',
      specversion: '1.0',
      type: 'workflow.submitted.v1',
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        // Missing mandatory workflowId, requesterId, tenantId, etc.
        invalidField: 'bad data',
      },
    };

    const mockPayload: any = {
      topic: 'workflow.events',
      partition: 0,
      message: {
        key: Buffer.from('bad-event-key'),
        value: Buffer.from(JSON.stringify(poisonPillEvent)),
        headers: {},
      },
    };

    await auditConsumer.processMessage(mockPayload);

    expect(routeToDLQSpy).toHaveBeenCalledTimes(1);
    expect(routeToDLQSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: 'SCHEMA_VALIDATION_ERROR',
        originalTopic: 'workflow.events',
      })
    );
  });

  it('AuditConsumer persists messages from workflow.events.dlq into database', async () => {
    const persistDLQSpy = vi.spyOn(auditConsumer as any, 'persistDLQRecord').mockResolvedValue(undefined);

    const dlqPayload: any = {
      topic: 'workflow.events.dlq',
      partition: 0,
      message: {
        key: Buffer.from('dlq-key-1'),
        value: Buffer.from(JSON.stringify({ id: 'dlq-test-1', data: { tenantId: 'tenant-test' } })),
        headers: {
          'x-original-topic': Buffer.from('workflow.events'),
          'x-error-type': Buffer.from('PROCESSING_ERROR'),
          'x-retry-count': Buffer.from('3'),
        },
      },
    };

    await auditConsumer.processMessage(dlqPayload);

    expect(persistDLQSpy).toHaveBeenCalledTimes(1);
  });
});
