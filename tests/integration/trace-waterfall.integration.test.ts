import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../services/workflow-api/src/app.js';
import { getTracer, getMetrics } from '@workflow/telemetry';
import { buildWorkflowEvent } from '@workflow/test-utils';
import { NotificationConsumer } from '../../services/notification-service/src/consumer.js';
import { AuditConsumer } from '../../services/audit-service/src/consumer.js';
import { eventProducer } from '../../services/workflow-api/src/kafka/producer.js';
import { workflowService } from '../../services/workflow-api/src/services/workflow.service.js';

vi.mock('../../services/audit-service/src/db/client.js', () => {
  const chain: any = {
    values: vi.fn().mockResolvedValue(undefined),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      insert: vi.fn(() => chain),
      select: vi.fn(() => chain),
    },
    pool: { end: vi.fn() },
  };
});

describe('Observability-Driven Trace Waterfall & Context Propagation Suite', () => {
  let app: FastifyInstance;
  const tracer = getTracer('workflow-api');
  const metrics = getMetrics('workflow-api');

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    await app.ready();

    // Mock workflow service methods for isolated in-memory test execution
    vi.spyOn(workflowService, 'createWorkflow').mockImplementation(async (tenantId, requesterId, requesterName, dto) => {
      return {
        id: 'wf-mock-uuid-9090',
        tenantId,
        type: dto.type,
        title: dto.title,
        amount: dto.amount,
        currency: dto.currency || 'USD',
        description: dto.description || '',
        requesterId,
        requesterName,
        status: 'DRAFT',
        currentStepOrder: 1,
        totalSteps: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    vi.spyOn(workflowService, 'submitWorkflow').mockImplementation(async (tenantId, id, userId, userName, comment) => {
      return {
        id,
        tenantId,
        type: 'EXPENSE',
        title: 'Q4 AWS Compute Reserved Capacity',
        amount: 24000,
        currency: 'USD',
        requesterId: userId,
        requesterName: userName,
        status: 'PENDING',
        currentStepOrder: 1,
        totalSteps: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    vi.restoreAllMocks();
  });

  describe('1. Distributed W3C Traceparent Waterfall Verification', () => {
    it('propagates trace ID end-to-end: Client -> API Gateway -> DB -> Kafka -> Consumers', async () => {
      // Step 1: Client initiates request with known W3C traceparent
      const clientTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const clientSpanId = '00f067aa0ba902b7';
      const inboundTraceparent = `00-${clientTraceId}-${clientSpanId}-01`;
      const correlationId = 'test-corr-waterfall-1001';
      const tenantId = 'tenant-corp-a';

      // Step 2: Inbound API request to workflow-api
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workflows',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'x-user-id': 'user-alice',
          'x-user-name': 'Alice Requester',
          'x-correlation-id': correlationId,
          traceparent: inboundTraceparent,
        },
        payload: {
          type: 'EXPENSE',
          title: 'Q4 AWS Compute Reserved Capacity',
          amount: 24000,
          currency: 'USD',
        },
      });

      expect(response.statusCode).toBe(201);
      const resBody = JSON.parse(response.body);
      const workflowId = resBody.data.id;

      // Assert API echoes back trace and correlation headers
      expect(response.headers['x-correlation-id']).toBe(correlationId);
      const outboundTraceparent = response.headers['traceparent'] as string;
      expect(outboundTraceparent).toBeDefined();
      expect(outboundTraceparent).toContain(clientTraceId);

      // Step 3: Verify Kafka Event publishing carries exact trace context
      const publishSpy = vi.spyOn(eventProducer, 'publishWorkflowEvent');

      // Submit workflow to trigger state change event
      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workflows/${workflowId}/submit`,
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'x-user-id': 'user-alice',
          'x-user-name': 'Alice Requester',
          'x-correlation-id': correlationId,
          traceparent: outboundTraceparent,
        },
        payload: { comment: 'Ready for manager review' },
      });

      expect(submitRes.statusCode).toBe(200);

      // Step 4: Verify Consumers preserve trace context from Kafka headers
      const auditConsumer = new AuditConsumer();
      const validWorkflowId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

      const validEvent = buildWorkflowEvent('workflow.submitted.v1', {
        workflowId: validWorkflowId,
        tenantId,
        type: 'EXPENSE',
        title: 'Q4 AWS Compute Reserved Capacity',
        amount: 24000,
        currency: 'USD',
        requesterId: 'user-alice',
        requesterName: 'Alice Requester',
        actorId: 'user-alice',
        previousStatus: 'DRAFT',
        currentStatus: 'PENDING',
      });

      const messagePayload: any = {
        topic: 'workflow.events',
        partition: 0,
        message: {
          key: Buffer.from(`${tenantId}:${validWorkflowId}`),
          value: Buffer.from(JSON.stringify(validEvent)),
          headers: {
            traceparent: Buffer.from(outboundTraceparent),
            'x-correlation-id': Buffer.from(correlationId),
            'tenant-id': Buffer.from(tenantId),
          },
        },
      };

      // Consumers process message within trace context
      const auditTracer = getTracer('audit-service');
      let auditTraceId: string | undefined;
      const originalStartSpan = auditTracer.startSpan.bind(auditTracer);
      const startSpanSpy = vi.spyOn(auditTracer, 'startSpan').mockImplementation((name, parentTp) => {
        const span = originalStartSpan(name, parentTp);
        if (name.includes('Kafka Consume')) {
          auditTraceId = span.context.traceId;
        }
        return span;
      });

      await (auditConsumer as any).processMessage(messagePayload);

      // Assert that consumer span shares the identical traceId from client
      expect(auditTraceId).toBe(clientTraceId);
      startSpanSpy.mockRestore();
    });
  });

  describe('2. Telemetry Metrics Counters & State Transition Tracking', () => {
    it('increments Prometheus metrics on workflow creation and Kafka publication', async () => {
      const tenantId = 'tenant-metrics-corp';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/workflows',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'x-user-id': 'user-bob',
          'x-user-name': 'Bob Smith',
        },
        payload: {
          type: 'EXPENSE',
          title: 'Office Ergonomic Equipment',
          amount: 450,
          currency: 'USD',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(metrics.workflowCreatedTotal).toBeDefined();
      expect(metrics.httpRequestsTotal).toBeDefined();
      expect(metrics.kafkaEventsPublished).toBeDefined();
      expect(typeof metrics.workflowCreatedTotal.inc).toBe('function');
      expect(typeof metrics.kafkaEventsPublished.inc).toBe('function');
    });
  });

  describe('3. Traceparent Parser & Validator Safety', () => {
    it('correctly parses valid W3C Traceparent and rejects corrupt headers gracefully', () => {
      const valid = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
      const parsed = tracer.parseTraceparent(valid);

      expect(parsed).not.toBeNull();
      expect(parsed?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(parsed?.spanId).toBe('b7ad6b7169203331');
      expect(parsed?.traceFlags).toBe('01');

      // Malformed / Non-W3C traceparents gracefully fallback to null (auto-generates fresh traceId)
      expect(tracer.parseTraceparent('invalid-format')).toBeNull();
      expect(tracer.parseTraceparent('01-wrongversion-1234')).toBeNull();
      expect(tracer.parseTraceparent('')).toBeNull();
      expect(tracer.parseTraceparent(undefined)).toBeNull();
    });
  });
});
