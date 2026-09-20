import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Observability Configs & Dashboard Integrity Tests', () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('validates Prometheus alert_rules.yml structure and thresholds', () => {
    const alertRulesPath = path.join(rootDir, 'infra/alert_rules.yml');
    expect(fs.existsSync(alertRulesPath)).toBe(true);

    const content = fs.readFileSync(alertRulesPath, 'utf-8');
    expect(content).toContain('name: workflow_platform_alerts');
    expect(content).toContain('alert: HighHttpErrorRate');
    expect(content).toContain('alert: OutboxBacklogHigh');
    expect(content).toContain('alert: DeadLetterQueueSurge');
    expect(content).toContain('alert: ServiceDown');
    expect(content).toContain('outbox_unpublished_events_total > 50');
    expect(content).toContain('dlq_messages_total');
  });

  it('validates Grafana datasource provisioning config', () => {
    const dsPath = path.join(rootDir, 'infra/grafana/provisioning/datasources/prometheus.yml');
    expect(fs.existsSync(dsPath)).toBe(true);

    const content = fs.readFileSync(dsPath, 'utf-8');
    expect(content).toContain('type: prometheus');
    expect(content).toContain('url: http://prometheus:9090');
  });

  it('validates Grafana dashboard JSON schema and panel configurations', () => {
    const dashboardPath = path.join(rootDir, 'infra/grafana/dashboards/workflow-overview.json');
    expect(fs.existsSync(dashboardPath)).toBe(true);

    const json = JSON.parse(fs.readFileSync(dashboardPath, 'utf-8'));
    expect(json.uid).toBe('workflow-platform-overview');
    expect(json.title).toBe('Workflow Platform — Operations Overview');
    expect(Array.isArray(json.panels)).toBe(true);

    const titles = json.panels.map((p: any) => p.title);
    expect(titles).toContain('HTTP Performance & Golden Signals (RED)');
    expect(titles).toContain('Transactional Outbox Backlog (Gauge)');
    expect(titles).toContain('Kafka Event Throughput (Publish vs Consume)');
    expect(titles).toContain('DLQ Poison Pills & Failures Total');
    expect(titles).toContain('PostgreSQL Connection Pool Status');
  });
});
