import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StructuredLogger, getLogger } from '@workflow/telemetry';

describe('StructuredLogger Unit Tests', () => {
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats log entries with standard JSON schema and service metadata', () => {
    const logger = new StructuredLogger('workflow-api', {}, 'info');
    logger.info('Test information message', { customKey: 'customValue' });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0]);

    expect(parsed.service).toBe('workflow-api');
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('Test information message');
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.context?.customKey).toBe('customValue');
  });

  it('injects trace_id, span_id, and tenant_id into root level fields', () => {
    const logger = new StructuredLogger('audit-service', {
      traceId: 'trace-1234567890abcdef',
      spanId: 'span-abcdef12',
      tenantId: 'tenant-corp-a',
      correlationId: 'corr-xyz-789',
      workflowId: 'wf-999',
    });

    logger.info('Processing workflow audit entry');

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0]);

    expect(parsed.trace_id).toBe('trace-1234567890abcdef');
    expect(parsed.span_id).toBe('span-abcdef12');
    expect(parsed.tenant_id).toBe('tenant-corp-a');
    expect(parsed.correlation_id).toBe('corr-xyz-789');
    expect(parsed.workflow_id).toBe('wf-999');
  });

  it('creates child logger inheriting parent context and extending with additional fields', () => {
    const rootLogger = new StructuredLogger('notification-service', {
      tenantId: 'tenant-acme',
    });

    const childLogger = rootLogger.child({
      traceId: 'trace-nested-999',
      recipientId: 'user-bob',
    });

    childLogger.info('Notification sent successfully');

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0]);

    expect(parsed.tenant_id).toBe('tenant-acme');
    expect(parsed.trace_id).toBe('trace-nested-999');
    expect(parsed.context?.recipientId).toBe('user-bob');
  });

  it('serializes Error objects with stack traces on error logs', () => {
    const logger = new StructuredLogger('workflow-api');
    const testError = new Error('Database connection failed');

    logger.error('Failed to execute query', { retryCount: 3 }, testError);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('Failed to execute query');
    expect(parsed.error?.name).toBe('Error');
    expect(parsed.error?.message).toBe('Database connection failed');
    expect(parsed.error?.stack).toBeDefined();
    expect(parsed.context?.retryCount).toBe(3);
  });
});
