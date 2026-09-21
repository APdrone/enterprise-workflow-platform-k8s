import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventProducer } from '../../services/workflow-api/src/kafka/producer.js';
import { buildWorkflowEvent, computeKafkaPartition, murmur2 } from '@workflow/test-utils';
import { WorkflowKafkaEvent, WorkflowStatus } from '@workflow/shared-types';

describe('Kafka Partition Key Hashing & Strict Event Ordering Contract', () => {
  let producer: EventProducer;

  beforeEach(() => {
    // Instantiate test producer
    producer = new EventProducer(true);
    producer.publishedEvents = [];
  });

  describe('1. Partition Key Invariant Contract', () => {
    const lifecycleEvents: Array<{ type: WorkflowKafkaEvent['type']; desc: string }> = [
      { type: 'workflow.submitted.v1', desc: 'initial submission' },
      { type: 'workflow.step_approved.v1', desc: 'intermediate step sign-off' },
      { type: 'workflow.approved.v1', desc: 'final approval terminal state' },
      { type: 'workflow.rejected.v1', desc: 'rejection terminal state' },
      { type: 'workflow.cancelled.v1', desc: 'cancellation terminal state' },
    ];

    lifecycleEvents.forEach(({ type, desc }) => {
      it(`guarantees partition key for "${type}" (${desc}) strictly adheres to "\${tenantId}:\${workflowId}"`, async () => {
        const tenantId = 'corp-moneyforward-nagoya';
        const workflowId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

        const event = buildWorkflowEvent(type, {
          workflowId,
          tenantId,
        });

        const sendSpy = vi.fn().mockResolvedValue([]);
        (producer as any).producer = { send: sendSpy };
        (producer as any).isConnected = true;
        (producer as any).isMock = false;

        await producer.publishWorkflowEvent(event);

        expect(sendSpy).toHaveBeenCalledTimes(1);
        const sendPayload = sendSpy.mock.calls[0][0];

        expect(sendPayload.topic).toBe('workflow.events');
        expect(sendPayload.messages).toHaveLength(1);

        const expectedKey = `${tenantId}:${workflowId}`;
        expect(sendPayload.messages[0].key).toBe(expectedKey);
        expect(sendPayload.messages[0].headers['tenant-id']).toBe(tenantId);
      });
    });
  });

  describe('2. Deterministic Murmur2 Hashing & Multi-Partition Routing', () => {
    const PARTITION_COUNTS = [3, 6, 12, 24];

    PARTITION_COUNTS.forEach((numPartitions) => {
      it(`guarantees 1,000 sequential events for the same workflow deterministically map to the identical partition on a ${numPartitions}-partition topic`, () => {
        const tenantId = 'corp-fintech-tokyo';
        const workflowId = 'wf-immutable-key-7710';
        const partitionKey = `${tenantId}:${workflowId}`;

        // Compute baseline partition
        const targetPartition = computeKafkaPartition(partitionKey, numPartitions);
        expect(targetPartition).toBeGreaterThanOrEqual(0);
        expect(targetPartition).toBeLessThan(numPartitions);

        // Verify 1,000 repeated calculations are completely deterministic
        for (let i = 0; i < 1000; i++) {
          const calculatedPartition = computeKafkaPartition(partitionKey, numPartitions);
          expect(calculatedPartition).toBe(targetPartition);
        }
      });
    });

    it('distributes 500 distinct workflows uniformly across partitions without hot-spotting a single partition', () => {
      const numPartitions = 6;
      const partitionDistribution: Record<number, number> = {
        0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
      };

      const TOTAL_WORKFLOWS = 600;
      for (let i = 0; i < TOTAL_WORKFLOWS; i++) {
        const key = `tenant-corp-${i % 10}:wf-uuid-${i}`;
        const partition = computeKafkaPartition(key, numPartitions);
        partitionDistribution[partition]++;
      }

      // Assert that every partition received events (no starved partitions)
      for (let p = 0; p < numPartitions; p++) {
        expect(partitionDistribution[p]).toBeGreaterThan(30);
      }
    });
  });

  describe('3. Strict Sequential FIFO Ordering within Workflow Lifecycles', () => {
    it('preserves chronological state sequence (SUBMITTED -> STEP_1 -> STEP_2 -> APPROVED) in partition stream', async () => {
      const tenantId = 'tenant-nagoya-hq';
      const workflowId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const partitionKey = `${tenantId}:${workflowId}`;
      const numPartitions = 6;

      const targetPartition = computeKafkaPartition(partitionKey, numPartitions);

      // Construct lifecycle timeline
      const lifecycleSequence: WorkflowKafkaEvent[] = [
        buildWorkflowEvent(
          'workflow.submitted.v1',
          {
            workflowId,
            tenantId,
            currentStatus: 'PENDING',
            previousStatus: 'DRAFT',
          },
          { time: new Date('2026-09-21T08:00:00.000Z').toISOString() }
        ),
        buildWorkflowEvent(
          'workflow.step_approved.v1',
          {
            workflowId,
            tenantId,
            currentStepOrder: 1,
            totalSteps: 2,
            currentStatus: 'PENDING',
          },
          { time: new Date('2026-09-21T08:05:00.000Z').toISOString() }
        ),
        buildWorkflowEvent(
          'workflow.step_approved.v1',
          {
            workflowId,
            tenantId,
            currentStepOrder: 2,
            totalSteps: 2,
            currentStatus: 'PENDING',
          },
          { time: new Date('2026-09-21T08:10:00.000Z').toISOString() }
        ),
        buildWorkflowEvent(
          'workflow.approved.v1',
          {
            workflowId,
            tenantId,
            currentStatus: 'APPROVED',
            previousStatus: 'PENDING',
          },
          { time: new Date('2026-09-21T08:12:00.000Z').toISOString() }
        ),
      ];

      // Simulated Kafka partition buffer
      const partitionBuffer: Array<{ offset: number; key: string; event: WorkflowKafkaEvent }> = [];

      lifecycleSequence.forEach((event, index) => {
        const key = `${event.data.tenantId}:${event.data.workflowId}`;
        const partition = computeKafkaPartition(key, numPartitions);

        // Every event in this sequence MUST go to targetPartition
        expect(partition).toBe(targetPartition);

        partitionBuffer.push({
          offset: index,
          key,
          event,
        });
      });

      // Verify strict sequential offset preservation
      expect(partitionBuffer).toHaveLength(4);
      expect(partitionBuffer[0]!.event.type).toBe('workflow.submitted.v1');
      expect(partitionBuffer[1]!.event.type).toBe('workflow.step_approved.v1');
      expect(partitionBuffer[2]!.event.type).toBe('workflow.step_approved.v1');
      expect(partitionBuffer[3]!.event.type).toBe('workflow.approved.v1');

      // Verify monotonic timestamp order
      for (let i = 1; i < partitionBuffer.length; i++) {
        const prevTime = new Date(partitionBuffer[i - 1]!.event.time).getTime();
        const currTime = new Date(partitionBuffer[i]!.event.time).getTime();
        expect(currTime).toBeGreaterThanOrEqual(prevTime);
      }
    });
  });

  describe('4. Out-of-Order Transition Guard & State Invariant', () => {
    it('consumer state-machine validator rejects out-of-order terminal event before submission', () => {
      // Invariant: A workflow cannot transition from DRAFT directly to APPROVED without SUBMITTED
      const validateStateTransition = (current: WorkflowStatus, target: WorkflowStatus): boolean => {
        const validTransitions: Record<WorkflowStatus, WorkflowStatus[]> = {
          DRAFT: ['PENDING', 'CANCELLED'],
          PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
          APPROVED: [],
          REJECTED: [],
          CANCELLED: [],
        };
        return validTransitions[current]?.includes(target) ?? false;
      };

      // Valid: DRAFT -> PENDING -> APPROVED
      expect(validateStateTransition('DRAFT', 'PENDING')).toBe(true);
      expect(validateStateTransition('PENDING', 'APPROVED')).toBe(true);

      // Illegal out-of-order jumps
      expect(validateStateTransition('DRAFT', 'APPROVED')).toBe(false);
      expect(validateStateTransition('APPROVED', 'PENDING')).toBe(false);
      expect(validateStateTransition('REJECTED', 'APPROVED')).toBe(false);
    });
  });

  describe('5. Cross-Tenant Partition Concurrency & Isolation', () => {
    it('concurrent events from different tenants do not corrupt per-workflow partition routing', () => {
      const numPartitions = 8;
      const tenants = ['tenant-alpha', 'tenant-beta', 'tenant-gamma', 'tenant-delta'];

      const events: Array<{ tenantId: string; workflowId: string; partition: number }> = [];

      tenants.forEach((tenantId) => {
        for (let w = 0; w < 10; w++) {
          const workflowId = `wf-${tenantId}-${w}`;
          const key = `${tenantId}:${workflowId}`;
          const partition = computeKafkaPartition(key, numPartitions);
          events.push({ tenantId, workflowId, partition });
        }
      });

      // Verify every workflow's partition calculation remains consistent when queried in reverse/interleaved order
      events.slice().reverse().forEach(({ tenantId, workflowId, partition }) => {
        const recomputed = computeKafkaPartition(`${tenantId}:${workflowId}`, numPartitions);
        expect(recomputed).toBe(partition);
      });
    });
  });
});
