import { describe, it, expect } from 'vitest';
import { MetricsRegistry, Counter, Gauge, Histogram, getMetrics } from '@workflow/telemetry';

describe('Enhanced Telemetry Metrics Unit Tests', () => {
  it('Counter increments values correctly with labels', () => {
    const counter = new Counter();
    counter.inc({ status: 'ok' }, 1);
    counter.inc({ status: 'ok' }, 2);
    counter.inc({ status: 'error' }, 1);

    const entries = counter.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.labels.status === 'ok')?.value).toBe(3);
    expect(entries.find((e) => e.labels.status === 'error')?.value).toBe(1);
  });

  it('Gauge supports set, inc, and dec operations', () => {
    const gauge = new Gauge();
    gauge.set({ queue: 'outbox' }, 10);
    gauge.inc({ queue: 'outbox' }, 5);
    gauge.dec({ queue: 'outbox' }, 3);

    const entries = gauge.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe(12);
  });

  it('Histogram tracks observation counts and sums', () => {
    const histogram = new Histogram();
    histogram.observe({ operation: 'relay' }, 0.05);
    histogram.observe({ operation: 'relay' }, 0.15);

    const entries = histogram.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(2);
    expect(entries[0].sum).toBeCloseTo(0.20, 2);
  });

  it('MetricsRegistry renders Prometheus text format with outbox, DLQ, and DB pool gauges', () => {
    const registry = new MetricsRegistry('workflow-api');

    // Populate outbox metrics
    registry.outboxUnpublishedEvents.set({}, 42);
    registry.outboxRelayDuration.observe({}, 0.125);

    // Populate DLQ metrics
    registry.dlqMessagesTotal.inc({ error_type: 'UNPARSEABLE_JSON' }, 3);
    registry.dlqMessagesTotal.inc({ error_type: 'SCHEMA_VALIDATION_ERROR' }, 1);

    // Populate DB pool metrics
    registry.pgPoolActiveConnections.set({}, 5);
    registry.pgPoolIdleConnections.set({}, 5);
    registry.pgPoolWaitingClients.set({}, 0);

    // Populate Workflow domain KPIs
    registry.workflowCreatedTotal.inc({ tenant: 'tenant-corp-a', workflow_type: 'EXPENSE' }, 7);
    registry.workflowCompletedTotal.inc({ tenant: 'tenant-corp-a', status: 'APPROVED' }, 5);

    const output = registry.toPrometheusFormat();

    // Verify Prometheus lines
    expect(output).toContain('# TYPE outbox_unpublished_events_total gauge');
    expect(output).toContain('outbox_unpublished_events_total{service="workflow-api"} 42');

    expect(output).toContain('# TYPE outbox_relay_duration_seconds summary');
    expect(output).toContain('outbox_relay_duration_seconds_count{service="workflow-api"} 1');
    expect(output).toContain('outbox_relay_duration_seconds_sum{service="workflow-api"} 0.1250');

    expect(output).toContain('# TYPE dlq_messages_total counter');
    expect(output).toContain('dlq_messages_total{service="workflow-api",error_type="UNPARSEABLE_JSON"} 3');
    expect(output).toContain('dlq_messages_total{service="workflow-api",error_type="SCHEMA_VALIDATION_ERROR"} 1');

    expect(output).toContain('# TYPE pg_pool_active_connections gauge');
    expect(output).toContain('pg_pool_active_connections{service="workflow-api"} 5');

    expect(output).toContain('# TYPE workflow_created_total counter');
    expect(output).toContain('workflow_created_total{service="workflow-api",tenant="tenant-corp-a",workflow_type="EXPENSE"} 7');
  });
});
