import { describe, it, expect } from 'vitest';
import { buildAuthHeaders, generateTraceparent, generateCorrelationId } from './api.js';

describe('Host App API Utilities & W3C Telemetry Inception', () => {
  it('buildAuthHeaders creates mandatory tenant headers and W3C traceparent headers', () => {
    const headers = buildAuthHeaders('tenant-corp-a', { id: 'user-alice', name: 'Alice Johnson' });

    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-tenant-id']).toBe('tenant-corp-a');
    expect(headers['x-user-id']).toBe('user-alice');
    expect(headers['x-user-name']).toBe('Alice Johnson');
    expect(headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(headers['x-correlation-id']).toMatch(/^req-[a-z0-9]+-[a-f0-9]{8}$/);
  });

  it('generateTraceparent produces standard compliant 55-character W3C context object', () => {
    const ctx = generateTraceparent();
    expect(ctx.version).toBe('00');
    expect(ctx.traceId).toHaveLength(32);
    expect(ctx.spanId).toHaveLength(16);
    expect(ctx.traceFlags).toBe('01');
    expect(ctx.traceparent).toHaveLength(55);
    expect(ctx.traceparent.startsWith('00-')).toBe(true);
    expect(ctx.traceparent.endsWith('-01')).toBe(true);
  });

  it('generateCorrelationId produces valid prefixed correlation token', () => {
    const correlationId = generateCorrelationId('req');
    expect(correlationId.startsWith('req-')).toBe(true);
    expect(correlationId).toMatch(/^req-[a-z0-9]+-[a-f0-9]{8}$/);
  });
});
