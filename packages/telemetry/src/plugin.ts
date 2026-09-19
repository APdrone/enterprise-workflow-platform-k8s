import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { getTracer, Span } from './tracer.js';
import { getMetrics } from './metrics.js';

declare module 'fastify' {
  interface FastifyRequest {
    span?: Span;
  }
}

export interface TelemetryPluginOptions {
  serviceName: string;
}

const telemetryPluginRaw: FastifyPluginAsync<TelemetryPluginOptions> = async (
  fastify: FastifyInstance,
  opts: TelemetryPluginOptions
) => {
  const serviceName = opts.serviceName || 'workflow-service';
  const tracer = getTracer(serviceName);
  const metrics = getMetrics(serviceName);

  // Expose Prometheus metrics endpoint
  fastify.get('/metrics', async (_, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return reply.send(metrics.toPrometheusFormat());
  });

  // Trace & Metric Hooks
  fastify.addHook('onRequest', async (request, reply) => {
    const route = request.routeOptions?.url || request.url.split('?')[0];

    // Skip trace generation for internal health & metrics polling to keep Jaeger clean
    if (route === '/metrics' || route === '/health' || route === '/ready' || route === '/') {
      return;
    }

    const parentTraceparent =
      (request.headers['traceparent'] as string) ||
      (request.headers['x-trace-id'] as string) ||
      null;

    const spanName = `${request.method} ${route}`;
    const span = tracer.startSpan(spanName, parentTraceparent);
    
    span.setAttribute('http.method', request.method);
    span.setAttribute('http.url', request.url);
    if (request.headers['x-tenant-id']) {
      span.setAttribute('tenant.id', request.headers['x-tenant-id'] as string);
    }

    request.span = span;

    // Inject traceparent into response headers
    reply.header('traceparent', span.toTraceparent());
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const durationSec = (reply.elapsedTime || 0) / 1000;
    const route = request.routeOptions?.url || request.url.split('?')[0];

    // Record metrics
    metrics.httpRequestsTotal.inc({
      method: request.method,
      route,
      status_code: reply.statusCode,
    });
    metrics.httpRequestDuration.observe({ method: request.method, route }, durationSec);

    // End span
    if (request.span) {
      request.span.setAttribute('http.status_code', reply.statusCode);
      if (reply.statusCode >= 400) {
        request.span.status = 'ERROR';
      }
      request.span.end();
    }
  });

  fastify.addHook('onError', async (request, _, error) => {
    if (request.span) {
      request.span.recordException(error);
    }
  });
};

export const telemetryPlugin = fp(telemetryPluginRaw, {
  name: 'workflow-telemetry',
});

