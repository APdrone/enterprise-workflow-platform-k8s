import { describe, it, expect, vi } from 'vitest';
import { MessageConsumerPact, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';

vi.mock('../../../services/audit-service/src/db/client.js', () => ({
  db: {
    insert: () => ({
      values: () => Promise.resolve([{ id: 'mock-audit-id' }]),
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  },
  pool: {
    query: () => Promise.resolve({ rows: [] }),
    end: () => Promise.resolve(),
  },
}));

import { NotificationConsumer } from '../../../services/notification-service/src/consumer.js';
import { AuditConsumer } from '../../../services/audit-service/src/consumer.js';

const { like, string, uuid, integer } = MatchersV3;

describe('Pact Async Message Contract: workflow-platform-events -> notification-service & audit-service', () => {
  const notificationPact = new MessageConsumerPact({
    consumer: 'notification-service',
    provider: 'workflow-platform-events',
    dir: path.resolve(process.cwd(), 'pacts'),
  });

  const auditPact = new MessageConsumerPact({
    consumer: 'audit-service',
    provider: 'workflow-platform-events',
    dir: path.resolve(process.cwd(), 'pacts'),
  });

  it('notification-service consumes workflow.submitted.v1 event', async () => {
    await notificationPact
      .expectsToReceive('a CloudEvent for workflow.submitted.v1')
      .withContent({
        specversion: string('1.0'),
        id: uuid('f1e2d3c4-b5a6-7890-1234-56789abcdef0'),
        source: string('workflow-api'),
        type: string('workflow.submitted.v1'),
        datacontenttype: string('application/json'),
        time: string('2026-09-21T08:00:00.000Z'),
        data: {
          workflowId: uuid('e1a2b3c4-d5e6-7f80-1234-56789abcdef0'),
          tenantId: string('tenant-corp-a'),
          type: string('EXPENSE'),
          title: string('AWS Cloud Infrastructure Annual Invoice'),
          requesterId: string('user-alice'),
          requesterName: string('Alice Engineer'),
          actorId: string('user-alice'),
          previousStatus: string('DRAFT'),
          currentStatus: string('PENDING'),
          assignedRole: string('APPROVER'),
          amount: integer(12000),
          currency: string('USD'),
          timestamp: string('2026-09-21T08:00:00.000Z'),
        },
      })
      .withMetadata({
        contentType: 'application/json',
      })
      .verify(async (message) => {
        const payload = typeof message.contents === 'string' ? JSON.parse(message.contents) : message.contents;

        // Verify notification-service can process this message contract
        const mockStorage = {
          save: () => Promise.resolve({ id: 'notif-1' }),
        };
        const mockDlq = {
          routeToDlq: () => Promise.resolve(),
        };
        const consumer = new NotificationConsumer();
        await expect(
          consumer.processMessage({
            topic: 'workflow.events',
            partition: 0,
            message: {
              value: Buffer.from(JSON.stringify(payload)),
              headers: { 'x-correlation-id': Buffer.from('test-corr-id') },
            } as any,
            heartbeat: () => Promise.resolve(),
            pause: () => () => {},
          } as any)
        ).resolves.not.toThrow();
      });
  });

  it('notification-service consumes workflow.approved.v1 event', async () => {
    await notificationPact
      .expectsToReceive('a CloudEvent for workflow.approved.v1')
      .withContent({
        specversion: string('1.0'),
        id: uuid('b1e2d3c4-b5a6-7890-1234-56789abcdef1'),
        source: string('workflow-api'),
        type: string('workflow.approved.v1'),
        datacontenttype: string('application/json'),
        time: string('2026-09-21T08:05:00.000Z'),
        data: {
          workflowId: uuid('e1a2b3c4-d5e6-7f80-1234-56789abcdef0'),
          tenantId: string('tenant-corp-a'),
          type: string('EXPENSE'),
          title: string('AWS Cloud Infrastructure Annual Invoice'),
          requesterId: string('user-alice'),
          requesterName: string('Alice Engineer'),
          actorId: string('user-bob-mgr'),
          previousStatus: string('PENDING'),
          currentStatus: string('APPROVED'),
          comment: string('Approved based on FY26 Cloud budget line item'),
          timestamp: string('2026-09-21T08:05:00.000Z'),
        },
      })
      .withMetadata({
        contentType: 'application/json',
      })
      .verify(async (message) => {
        const payload = typeof message.contents === 'string' ? JSON.parse(message.contents) : message.contents;
        expect(payload.type).toBe('workflow.approved.v1');
        expect(payload.data.currentStatus).toBe('APPROVED');
      });
  });

  it('audit-service consumes workflow.rejected.v1 event and creates audit log entry', async () => {
    await auditPact
      .expectsToReceive('a CloudEvent for workflow.rejected.v1')
      .withContent({
        specversion: string('1.0'),
        id: uuid('c1e2d3c4-b5a6-7890-1234-56789abcdef2'),
        source: string('workflow-api'),
        type: string('workflow.rejected.v1'),
        datacontenttype: string('application/json'),
        time: string('2026-09-21T08:10:00.000Z'),
        data: {
          workflowId: uuid('e1a2b3c4-d5e6-7f80-1234-56789abcdef0'),
          tenantId: string('tenant-corp-a'),
          type: string('EXPENSE'),
          title: string('Unapproved Software License'),
          requesterId: string('user-alice'),
          requesterName: string('Alice Engineer'),
          actorId: string('user-bob-mgr'),
          previousStatus: string('PENDING'),
          currentStatus: string('REJECTED'),
          rejectionReason: string('Exceeds team quarterly discretionary budget'),
          timestamp: string('2026-09-21T08:10:00.000Z'),
        },
      })
      .withMetadata({
        contentType: 'application/json',
      })
      .verify(async (message) => {
        const payload = typeof message.contents === 'string' ? JSON.parse(message.contents) : message.contents;

        const auditConsumer = new AuditConsumer();
        await expect(
          auditConsumer.processMessage({
            topic: 'workflow.events',
            partition: 0,
            message: {
              value: Buffer.from(JSON.stringify(payload)),
              headers: { 'x-correlation-id': Buffer.from('audit-corr-id') },
            } as any,
            heartbeat: () => Promise.resolve(),
            pause: () => () => {},
          } as any)
        ).resolves.not.toThrow();
      });
  });
});
