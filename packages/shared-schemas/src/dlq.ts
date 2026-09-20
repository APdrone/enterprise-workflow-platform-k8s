import { DLQErrorType, DLQHeaders } from '@workflow/shared-types';

export const TOPIC_WORKFLOW_EVENTS = 'workflow.events';
export const TOPIC_WORKFLOW_RETRY = 'workflow.events.retry';
export const TOPIC_WORKFLOW_DLQ = 'workflow.events.dlq';

export const MAX_RETRY_COUNT = 3;

/**
 * Calculates exponential backoff delay based on retry attempt
 */
export function calculateBackoffDelay(retryCount: number, baseMs: number = 500, maxMs: number = 10000): number {
  const delay = baseMs * Math.pow(2, retryCount);
  return Math.min(delay, maxMs);
}

/**
 * Builds standard diagnostic headers for DLQ & Retry topics
 */
export function buildResilienceHeaders(options: {
  errorType: DLQErrorType;
  errorMessage: string;
  retryCount: number;
  originalTopic: string;
  tenantId?: string;
  correlationId?: string;
  traceparent?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'x-original-topic': options.originalTopic,
    'x-retry-count': String(options.retryCount),
    'x-error-type': options.errorType,
    'x-error-message': options.errorMessage.substring(0, 1000), // Protect against huge stack dumps
    'x-failed-at': new Date().toISOString(),
  };

  if (options.tenantId) {
    headers['tenant-id'] = options.tenantId;
  }
  if (options.correlationId) {
    headers['x-correlation-id'] = options.correlationId;
  }
  if (options.traceparent) {
    headers['traceparent'] = options.traceparent;
  }

  return headers;
}
