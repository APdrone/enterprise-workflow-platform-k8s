import { describe, it, expect, vi } from 'vitest';
import {
  generateRandomHex,
  generateTraceparent,
  generateCorrelationId,
  createTracedHeaders,
  tracedFetch,
  getTracer,
} from '@workflow/telemetry';

describe('Frontend W3C Traceparent Inception & Client Tracing Unit Tests', () => {
  describe('Hex & Random Generation', () => {
    it('generates random hex strings of exact length', () => {
      const hex16 = generateRandomHex(16);
      const hex32 = generateRandomHex(32);

      expect(hex16).toHaveLength(16);
      expect(hex32).toHaveLength(32);
      expect(/^[0-9a-f]+$/i.test(hex16)).toBe(true);
      expect(/^[0-9a-f]+$/i.test(hex32)).toBe(true);
    });
  });

  describe('W3C Traceparent Generation', () => {
    it('generates valid W3C TraceContext traceparent structure', () => {
      const trace = generateTraceparent();

      expect(trace.version).toBe('00');
      expect(trace.traceFlags).toBe('01');
      expect(trace.traceId).toHaveLength(32);
      expect(trace.spanId).toHaveLength(16);

      // Total traceparent format: 00-{32 hex}-{16 hex}-{2 hex} = 55 characters
      expect(trace.traceparent).toHaveLength(55);
      expect(trace.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    });

    it('generates unique trace and span IDs across calls', () => {
      const trace1 = generateTraceparent();
      const trace2 = generateTraceparent();

      expect(trace1.traceId).not.toBe(trace2.traceId);
      expect(trace1.spanId).not.toBe(trace2.spanId);
      expect(trace1.traceparent).not.toBe(trace2.traceparent);
    });

    it('is seamlessly parsed by backend Tracer', () => {
      const clientTrace = generateTraceparent();
      const backendTracer = getTracer('workflow-api');

      const parsed = backendTracer.parseTraceparent(clientTrace.traceparent);
      expect(parsed).not.toBeNull();
      expect(parsed?.traceId).toBe(clientTrace.traceId);
      expect(parsed?.spanId).toBe(clientTrace.spanId);
      expect(parsed?.traceFlags).toBe('01');

      // Backend root span inherits the client's trace ID
      const serverSpan = backendTracer.startSpan('HTTP POST /api/v1/workflows', clientTrace.traceparent);
      expect(serverSpan.context.traceId).toBe(clientTrace.traceId);
      expect(serverSpan.context.parentSpanId).toBe(clientTrace.spanId);
    });
  });

  describe('Correlation ID Generation', () => {
    it('generates correlation IDs with default and custom prefix', () => {
      const defaultId = generateCorrelationId();
      const customId = generateCorrelationId('client-tx');

      expect(defaultId.startsWith('req-')).toBe(true);
      expect(customId.startsWith('client-tx-')).toBe(true);
    });
  });

  describe('createTracedHeaders', () => {
    it('attaches W3C traceparent, correlation ID, and tenant ID to headers', () => {
      const headers = createTracedHeaders(
        { 'Content-Type': 'application/json' },
        { tenantId: 'tenant-corp-a' }
      );

      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['x-tenant-id']).toBe('tenant-corp-a');
      expect(headers['traceparent']).toBeDefined();
      expect(headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(headers['x-correlation-id']).toBeDefined();
    });

    it('preserves existing traceparent and correlation ID if already set', () => {
      const customTrace = '00-11112222333344445555666677778888-aaaabbbbccccdddd-01';
      const customCorr = 'custom-correlation-999';

      const headers = createTracedHeaders({
        traceparent: customTrace,
        'x-correlation-id': customCorr,
      });

      expect(headers['traceparent']).toBe(customTrace);
      expect(headers['x-correlation-id']).toBe(customCorr);
    });
  });

  describe('tracedFetch Client Wrapper', () => {
    it('invokes global fetch with injected W3C trace headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
      globalThis.fetch = mockFetch;

      await tracedFetch('http://localhost:3000/api/v1/workflows', {
        method: 'GET',
        tenantId: 'tenant-corp-b',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('http://localhost:3000/api/v1/workflows');
      expect(callArgs[1].headers['x-tenant-id']).toBe('tenant-corp-b');
      expect(callArgs[1].headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(callArgs[1].headers['x-correlation-id']).toBeDefined();
    });
  });
});
