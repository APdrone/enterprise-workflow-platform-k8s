import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

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

export interface TraceContextStore {
  span?: Span;
  traceparent?: string;
  tenantId?: string;
}

export const traceStorage = new AsyncLocalStorage<TraceContextStore>();

export function runWithTraceContext<T>(
  context: TraceContextStore,
  fn: () => T
): T {
  return traceStorage.run(context, fn);
}

export function getActiveTraceContext(): TraceContextStore | undefined {
  return traceStorage.getStore();
}

export function getActiveSpan(): Span | undefined {
  return traceStorage.getStore()?.span;
}

export function getActiveTraceparent(): string | undefined {
  const store = traceStorage.getStore();
  return store?.traceparent || store?.span?.toTraceparent();
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
                    kind: span.name.startsWith('db:') ? 3 : 1, // SPAN_KIND_CLIENT (3) for DB, SPAN_KIND_INTERNAL (1) for general
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

/**
 * Extract SQL operation name from SQL text
 */
export function extractSqlOperation(sql: string): string {
  if (!sql || typeof sql !== 'string') return 'QUERY';
  const trimmed = sql.trim().replace(/^--.*$/gm, '').trim();
  const firstWord = trimmed.split(/\s+/)[0]?.toUpperCase() || 'QUERY';
  const validOps = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SET', 'SHOW'];
  return validOps.includes(firstWord) ? firstWord : 'QUERY';
}

/**
 * Automatically instrument a pg.Pool or pg.Client instance to generate child DB spans for Jaeger/OTLP
 */
export function instrumentPgPool(
  pool: any,
  options: { serviceName?: string; dbName?: string } = {}
): void {
  if (!pool || pool.__isTracingInstrumented) return;
  pool.__isTracingInstrumented = true;

  const serviceName = options.serviceName || 'workflow-platform';
  const dbName = options.dbName || 'postgres';
  const tracer = getTracer(serviceName);

  // Wrap pool.query
  if (typeof pool.query === 'function') {
    const originalPoolQuery = pool.query.bind(pool);
    pool.query = function (this: any, ...args: any[]) {
      const parentTraceparent = getActiveTraceparent();
      let queryText = '';
      if (typeof args[0] === 'string') {
        queryText = args[0];
      } else if (args[0] && typeof args[0].text === 'string') {
        queryText = args[0].text;
      }

      const op = extractSqlOperation(queryText);
      const span = tracer.startSpan(`db:${op}`, parentTraceparent);
      span.setAttribute('db.system', 'postgresql');
      span.setAttribute('db.name', dbName);
      span.setAttribute('db.operation', op);
      span.setAttribute('db.statement', queryText.length > 500 ? queryText.slice(0, 500) + '...' : queryText);

      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'function') {
        const cb = lastArg;
        args[args.length - 1] = function (err: any, res: any) {
          if (err) span.recordException(err);
          span.end();
          return cb(err, res);
        };
        return originalPoolQuery.apply(this, args);
      }

      const resultPromise = originalPoolQuery.apply(this, args);
      if (resultPromise && typeof resultPromise.then === 'function') {
        return resultPromise
          .then((res: any) => {
            span.end();
            return res;
          })
          .catch((err: any) => {
            span.recordException(err);
            span.end();
            throw err;
          });
      }
      span.end();
      return resultPromise;
    };
  }

  // Wrap client queries on pool.connect
  if (typeof pool.connect === 'function') {
    const originalConnect = pool.connect.bind(pool);
    pool.connect = async function (this: any, ...connectArgs: any[]) {
      const client = await originalConnect.apply(this, connectArgs);
      if (client && !client.__isTracingInstrumented && typeof client.query === 'function') {
        client.__isTracingInstrumented = true;
        const originalClientQuery = client.query.bind(client);
        client.query = function (this: any, ...args: any[]) {
          const parentTraceparent = getActiveTraceparent();
          let queryText = '';
          if (typeof args[0] === 'string') {
            queryText = args[0];
          } else if (args[0] && typeof args[0].text === 'string') {
            queryText = args[0].text;
          }

          const op = extractSqlOperation(queryText);
          const span = tracer.startSpan(`db:${op}`, parentTraceparent);
          span.setAttribute('db.system', 'postgresql');
          span.setAttribute('db.name', dbName);
          span.setAttribute('db.operation', op);
          span.setAttribute('db.statement', queryText.length > 500 ? queryText.slice(0, 500) + '...' : queryText);

          const lastArg = args[args.length - 1];
          if (typeof lastArg === 'function') {
            const cb = lastArg;
            args[args.length - 1] = function (err: any, res: any) {
              if (err) span.recordException(err);
              span.end();
              return cb(err, res);
            };
            return originalClientQuery.apply(this, args);
          }

          const resultPromise = originalClientQuery.apply(this, args);
          if (resultPromise && typeof resultPromise.then === 'function') {
            return resultPromise
              .then((res: any) => {
                span.end();
                return res;
              })
              .catch((err: any) => {
                span.recordException(err);
                span.end();
                throw err;
              });
          }
          span.end();
          return resultPromise;
        };
      }
      return client;
    };
  }
}

/**
 * Explicit helper to trace any asynchronous database query/transaction
 */
export async function traceDbQuery<T>(
  options: {
    serviceName?: string;
    dbName?: string;
    statement: string;
    operation?: string;
    parentTraceparent?: string;
  },
  fn: () => Promise<T>
): Promise<T> {
  const serviceName = options.serviceName || 'workflow-platform';
  const tracer = getTracer(serviceName);
  const parentTraceparent = options.parentTraceparent || getActiveTraceparent();
  const op = options.operation || extractSqlOperation(options.statement);

  const span = tracer.startSpan(`db:${op}`, parentTraceparent);
  span.setAttribute('db.system', 'postgresql');
  span.setAttribute('db.name', options.dbName || 'postgres');
  span.setAttribute('db.operation', op);
  span.setAttribute('db.statement', options.statement);

  try {
    const result = await fn();
    return result;
  } catch (err: any) {
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

const tracerInstances = new Map<string, Tracer>();

export function getTracer(serviceName: string): Tracer {
  if (!tracerInstances.has(serviceName)) {
    tracerInstances.set(serviceName, new Tracer(serviceName));
  }
  return tracerInstances.get(serviceName)!;
}

