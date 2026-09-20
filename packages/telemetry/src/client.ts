/**
 * Browser & Universal Client W3C Trace Context Utilities
 * Generates and propagates W3C TraceContext headers directly from frontend user actions
 */

/**
 * Generate cryptographically random hex characters (Browser & Node.js compatible)
 */
export function generateRandomHex(length: number): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(Math.ceil(length / 2));
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, length);
  }
  let result = '';
  while (result.length < length) {
    result += Math.random().toString(16).substring(2);
  }
  return result.slice(0, length);
}

export interface W3CTraceContext {
  version: string;
  traceId: string;
  spanId: string;
  traceFlags: string;
  traceparent: string;
}

/**
 * Generate W3C TraceContext traceparent string
 * Spec: 00-{traceId:32}-{spanId:16}-{traceFlags:2}
 */
export function generateTraceparent(): W3CTraceContext {
  const version = '00';
  const traceId = generateRandomHex(32);
  const spanId = generateRandomHex(16);
  const traceFlags = '01'; // sampled
  const traceparent = `${version}-${traceId}-${spanId}-${traceFlags}`;
  return { version, traceId, spanId, traceFlags, traceparent };
}

/**
 * Generate unique correlation ID
 */
export function generateCorrelationId(prefix = 'req'): string {
  return `${prefix}-${Date.now().toString(36)}-${generateRandomHex(8)}`;
}

/**
 * Inject W3C traceparent and correlation ID into HTTP headers
 */
export function createTracedHeaders(
  existingHeaders: Record<string, string> | Headers = {},
  options: { tenantId?: string; correlationId?: string; traceparent?: string } = {}
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Copy existing headers
  if (typeof Headers !== 'undefined' && existingHeaders instanceof Headers) {
    existingHeaders.forEach((val, key) => {
      headers[key] = val;
    });
  } else if (existingHeaders && typeof existingHeaders === 'object') {
    Object.assign(headers, existingHeaders);
  }

  // Inject traceparent if not already present
  if (!headers['traceparent'] && !headers['Traceparent']) {
    headers['traceparent'] = options.traceparent || generateTraceparent().traceparent;
  }

  // Inject correlation ID if not present
  if (!headers['x-correlation-id'] && !headers['X-Correlation-Id']) {
    headers['x-correlation-id'] = options.correlationId || generateCorrelationId();
  }

  // Inject tenant ID if provided
  if (options.tenantId && !headers['x-tenant-id']) {
    headers['x-tenant-id'] = options.tenantId;
  }

  return headers;
}

/**
 * Universal traced fetch wrapper that automatically attaches W3C traceparent headers
 */
export async function tracedFetch(
  input: RequestInfo | URL,
  init: RequestInit & { tenantId?: string; correlationId?: string } = {}
): Promise<Response> {
  const { tenantId, correlationId, ...requestInit } = init;
  const headers = createTracedHeaders(requestInit.headers as any, { tenantId, correlationId });
  return fetch(input, {
    ...requestInit,
    headers,
  });
}
