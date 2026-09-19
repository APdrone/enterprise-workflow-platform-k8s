import crypto from 'crypto';

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: string;
  parentSpanId?: string;
}

export interface Span {
  name: string;
  context: SpanContext;
  startTime: number;
  durationMs?: number;
  attributes: Record<string, string | number | boolean>;
  status: 'OK' | 'ERROR';
  error?: string;
  end: () => void;
  setAttribute: (key: string, value: string | number | boolean) => void;
  recordException: (err: Error) => void;
  toTraceparent: () => string;
}

export class Tracer {
  private serviceName: string;
  private otlpEndpoint: string;
  private isEnabled: boolean;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.otlpEndpoint =
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      process.env.JAEGER_ENDPOINT ||
      'http://localhost:4318/v1/traces';
    this.isEnabled = process.env.ENABLE_TRACING !== 'false';
  }

  /**
   * Parse W3C TraceContext traceparent string
   * Format: 00-{traceId:32}-{spanId:16}-{traceFlags:2}
   */
  public parseTraceparent(traceparent?: string): SpanContext | null {
    if (!traceparent) return null;
    const parts = traceparent.split('-');
    if (parts.length < 4 || parts[0] !== '00') return null;
    return {
      traceId: parts[1],
      parentSpanId: parts[2],
      spanId: parts[2],
      traceFlags: parts[3],
    };
  }

  /**
   * Create a new trace span
   */
  public startSpan(name: string, parentTraceparent?: string | null): Span {
    const parentContext = this.parseTraceparent(parentTraceparent || undefined);
    const traceId = parentContext ? parentContext.traceId : crypto.randomBytes(16).toString('hex');
    const spanId = crypto.randomBytes(8).toString('hex');
    const traceFlags = parentContext ? parentContext.traceFlags : '01';

    const context: SpanContext = {
      traceId,
      spanId,
      traceFlags,
      parentSpanId: parentContext ? parentContext.spanId : undefined,
    };

    const startTime = Date.now();
    const attributes: Record<string, string | number | boolean> = {
      'service.name': this.serviceName,
    };

    let status: 'OK' | 'ERROR' = 'OK';
    let errorMessage: string | undefined;

    const span: Span = {
      name,
      context,
      startTime,
      attributes,
      status,
      setAttribute: (key: string, value: string | number | boolean) => {
        attributes[key] = value;
      },
      recordException: (err: Error) => {
        status = 'ERROR';
        errorMessage = err.message;
        attributes['error'] = true;
        attributes['error.message'] = err.message;
      },
      toTraceparent: () => `00-${traceId}-${spanId}-${traceFlags}`,
      end: () => {
        span.durationMs = Date.now() - startTime;
        span.status = status;
        span.error = errorMessage;
        this.exportSpan(span);
      },
    };

    return span;
  }

  /**
   * Asynchronously send span to OTLP / Jaeger exporter
   */
  private async exportSpan(span: Span): Promise<void> {
    if (!this.isEnabled) return;

    try {
      const payload = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: this.serviceName } },
              ],
            },
            scopeSpans: [
              {
                scope: { name: 'workflow-tracer', version: '1.0.0' },
                spans: [
                  {
                    traceId: span.context.traceId,
                    spanId: span.context.spanId,
                    parentSpanId: span.context.parentSpanId,
                    name: span.name,
                    kind: 1, // SPAN_KIND_INTERNAL
                    startTimeUnixNano: `${span.startTime}000000`,
                    endTimeUnixNano: `${Date.now()}000000`,
                    attributes: Object.entries(span.attributes).map(([key, val]) => ({
                      key,
                      value:
                        typeof val === 'number'
                          ? { intValue: Math.round(val) }
                          : typeof val === 'boolean'
                          ? { boolValue: val }
                          : { stringValue: String(val) },
                    })),
                    status: {
                      code: span.status === 'OK' ? 1 : 2,
                      message: span.error,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      // Fire and forget trace export
      fetch(this.otlpEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {
        // Silently ignore if collector / Jaeger is not actively reachable
      });
    } catch {
      // Ignored to never crash applications on tracing failures
    }
  }
}

export function getTracer(serviceName: string): Tracer {
  return new Tracer(serviceName);
}
