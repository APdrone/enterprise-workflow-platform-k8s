import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateBackoffDelay,
  buildResilienceHeaders,
  MAX_RETRY_COUNT,
  TOPIC_WORKFLOW_EVENTS,
  TOPIC_WORKFLOW_RETRY,
  TOPIC_WORKFLOW_DLQ,
  validateEvent,
} from '@workflow/shared-schemas';

describe('Kafka DLQ & Resilience Layer Unit Tests', () => {
  describe('Exponential Backoff & Delay Calculations', () => {
    it('should calculate exponential backoff correctly', () => {
      expect(calculateBackoffDelay(0)).toBe(500);
      expect(calculateBackoffDelay(1)).toBe(1000);
      expect(calculateBackoffDelay(2)).toBe(2000);
      expect(calculateBackoffDelay(3)).toBe(4000);
    });

    it('should cap exponential backoff at maximum configured ms', () => {
      const delay = calculateBackoffDelay(10, 500, 5000);
      expect(delay).toBe(5000);
    });
  });

  describe('Resilience Headers Building', () => {
    it('should correctly format resilience headers with original topic and error type', () => {
      const headers = buildResilienceHeaders({
        originalTopic: TOPIC_WORKFLOW_EVENTS,
        retryCount: 1,
        errorType: 'SCHEMA_VALIDATION_ERROR',
        errorMessage: 'Invalid property requesterId',
        tenantId: 'tenant-omega',
        correlationId: 'corr-12345',
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      });

      expect(headers['x-original-topic']).toBe(TOPIC_WORKFLOW_EVENTS);
      expect(headers['x-retry-count']).toBe('1');
      expect(headers['x-error-type']).toBe('SCHEMA_VALIDATION_ERROR');
      expect(headers['x-error-message']).toBe('Invalid property requesterId');
      expect(headers['tenant-id']).toBe('tenant-omega');
      expect(headers['x-correlation-id']).toBe('corr-12345');
      expect(headers['traceparent']).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
      expect(headers['x-failed-at']).toBeDefined();
    });

    it('should truncate overly long error messages to 1000 chars', () => {
      const hugeError = 'A'.repeat(2500);
      const headers = buildResilienceHeaders({
        originalTopic: TOPIC_WORKFLOW_EVENTS,
        retryCount: 0,
        errorType: 'UNPARSEABLE_JSON',
        errorMessage: hugeError,
      });

      expect(headers['x-error-message'].length).toBe(1000);
    });
  });

  describe('Schema Validation & Poison Pill Detection', () => {
    it('should reject malformed event lacking required CloudEvents envelope', () => {
      const malformed = {
        foo: 'bar',
        something: 123,
      };

      const res = validateEvent('workflow.submitted.v1', malformed as any);
      expect(res.valid).toBe(false);
      expect(res.errors).toBeDefined();
    });

    it('should reject event with invalid data payload', () => {
      const invalidEvent = {
        id: '11111111-1111-1111-1111-111111111111',
        source: 'workflow-api',
        specversion: '1.0',
        type: 'workflow.submitted.v1',
        time: new Date().toISOString(),
        datacontenttype: 'application/json',
        data: {
          workflowId: '22222222-2222-2222-2222-222222222222',
          // Missing tenantId, requesterId, etc.
        },
      };

      const res = validateEvent('workflow.submitted.v1', invalidEvent as any);
      expect(res.valid).toBe(false);
      expect(res.errors?.length).toBeGreaterThan(0);
    });

    it('should accept properly formatted CloudEvents workflow event', () => {
      const validEvent = {
        id: '11111111-1111-1111-1111-111111111111',
        source: 'workflow-api',
        specversion: '1.0',
        type: 'workflow.submitted.v1',
        time: new Date().toISOString(),
        datacontenttype: 'application/json',
        data: {
          workflowId: '22222222-2222-2222-2222-222222222222',
          tenantId: 'tenant-test',
          type: 'EXPENSE',
          title: 'Team Dinner',
          amount: 150,
          currency: 'USD',
          requesterId: 'user-alice',
          requesterName: 'Alice Johnson',
          actorId: 'user-alice',
          previousStatus: 'DRAFT',
          currentStatus: 'PENDING',
          timestamp: new Date().toISOString(),
        },
      };

      const res = validateEvent('workflow.submitted.v1', validEvent as any);
      expect(res.valid).toBe(true);
    });
  });

  describe('Retry & Escalation Threshold Constants', () => {
    it('should define standard retry topic and dead letter queue topic constants', () => {
      expect(TOPIC_WORKFLOW_EVENTS).toBe('workflow.events');
      expect(TOPIC_WORKFLOW_RETRY).toBe('workflow.events.retry');
      expect(TOPIC_WORKFLOW_DLQ).toBe('workflow.events.dlq');
      expect(MAX_RETRY_COUNT).toBe(3);
    });
  });
});
