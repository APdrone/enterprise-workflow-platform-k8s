export interface MetricLabels {
  [key: string]: string | number;
}

export class Counter {
  private values = new Map<string, number>();

  public inc(labels: MetricLabels = {}, value = 1): void {
    const key = JSON.stringify(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  public getEntries(): { labels: MetricLabels; value: number }[] {
    return Array.from(this.values.entries()).map(([key, value]) => ({
      labels: JSON.parse(key),
      value,
    }));
  }
}

export class Gauge {
  private values = new Map<string, number>();

  public set(labels: MetricLabels = {}, value: number): void {
    const key = JSON.stringify(labels);
    this.values.set(key, value);
  }

  public inc(labels: MetricLabels = {}, value = 1): void {
    const key = JSON.stringify(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  public dec(labels: MetricLabels = {}, value = 1): void {
    const key = JSON.stringify(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current - value);
  }

  public getEntries(): { labels: MetricLabels; value: number }[] {
    return Array.from(this.values.entries()).map(([key, value]) => ({
      labels: JSON.parse(key),
      value,
    }));
  }
}

export class Histogram {
  private counts = new Map<string, number>();
  private sums = new Map<string, number>();

  public observe(labels: MetricLabels = {}, value: number): void {
    const key = JSON.stringify(labels);
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
    this.sums.set(key, (this.sums.get(key) || 0) + value);
  }

  public getEntries(): { labels: MetricLabels; count: number; sum: number }[] {
    return Array.from(this.counts.keys()).map((key) => ({
      labels: JSON.parse(key),
      count: this.counts.get(key) || 0,
      sum: this.sums.get(key) || 0,
    }));
  }
}

export class MetricsRegistry {
  // HTTP Metrics
  public httpRequestsTotal = new Counter();
  public httpRequestDuration = new Histogram();
  public activeRequests = new Counter();

  // Kafka Messaging Metrics
  public kafkaEventsPublished = new Counter();
  public kafkaEventsConsumed = new Counter();
  public dlqMessagesTotal = new Counter();

  // Transactional Outbox Resilience Metrics
  public outboxUnpublishedEvents = new Gauge();
  public outboxRelayDuration = new Histogram();

  // Database Connection Pool Metrics
  public pgPoolActiveConnections = new Gauge();
  public pgPoolIdleConnections = new Gauge();
  public pgPoolWaitingClients = new Gauge();

  // Workflow Domain KPIs
  public workflowCreatedTotal = new Counter();
  public workflowCompletedTotal = new Counter();

  private serviceName: string;
  private startTime = Date.now();

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  private formatLabels(labels: MetricLabels): string {
    const allLabels = { service: this.serviceName, ...labels };
    const pairs = Object.entries(allLabels).map(([k, v]) => `${k}="${v}"`);
    return pairs.length > 0 ? `{${pairs.join(',')}}` : '';
  }

  /**
   * Render Prometheus Text Exposition Format
   */
  public toPrometheusFormat(): string {
    const lines: string[] = [];

    // Uptime & Memory
    lines.push('# HELP process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds{service="${this.serviceName}"} ${Math.floor((Date.now() - this.startTime) / 1000)}`);

    lines.push('# HELP nodejs_memory_heap_used_bytes V8 heap memory used in bytes');
    lines.push('# TYPE nodejs_memory_heap_used_bytes gauge');
    lines.push(`nodejs_memory_heap_used_bytes{service="${this.serviceName}"} ${process.memoryUsage().heapUsed}`);

    // HTTP Requests Total
    lines.push('# HELP http_requests_total Total number of HTTP requests processed');
    lines.push('# TYPE http_requests_total counter');
    const httpEntries = this.httpRequestsTotal.getEntries();
    if (httpEntries.length === 0) {
      lines.push(`http_requests_total{service="${this.serviceName}"} 0`);
    } else {
      for (const { labels, value } of httpEntries) {
        lines.push(`http_requests_total${this.formatLabels(labels)} ${value}`);
      }
    }

    // HTTP Request Duration
    lines.push('# HELP http_request_duration_seconds HTTP request duration in seconds');
    lines.push('# TYPE http_request_duration_seconds summary');
    for (const { labels, count, sum } of this.httpRequestDuration.getEntries()) {
      lines.push(`http_request_duration_seconds_count${this.formatLabels(labels)} ${count}`);
      lines.push(`http_request_duration_seconds_sum${this.formatLabels(labels)} ${sum.toFixed(4)}`);
    }

    // Kafka Events Published
    lines.push('# HELP kafka_events_published_total Total Kafka events published');
    lines.push('# TYPE kafka_events_published_total counter');
    const kafkaPubEntries = this.kafkaEventsPublished.getEntries();
    if (kafkaPubEntries.length === 0) {
      lines.push(`kafka_events_published_total{service="${this.serviceName}"} 0`);
    } else {
      for (const { labels, value } of kafkaPubEntries) {
        lines.push(`kafka_events_published_total${this.formatLabels(labels)} ${value}`);
      }
    }

    // Kafka Events Consumed
    lines.push('# HELP kafka_events_consumed_total Total Kafka events consumed');
    lines.push('# TYPE kafka_events_consumed_total counter');
    const kafkaConsEntries = this.kafkaEventsConsumed.getEntries();
    if (kafkaConsEntries.length === 0) {
      lines.push(`kafka_events_consumed_total{service="${this.serviceName}"} 0`);
    } else {
      for (const { labels, value } of kafkaConsEntries) {
        lines.push(`kafka_events_consumed_total${this.formatLabels(labels)} ${value}`);
      }
    }

    // DLQ Messages
    lines.push('# HELP dlq_messages_total Total poison pills and failed messages routed to Dead Letter Queue');
    lines.push('# TYPE dlq_messages_total counter');
    const dlqEntries = this.dlqMessagesTotal.getEntries();
    if (dlqEntries.length === 0) {
      lines.push(`dlq_messages_total{service="${this.serviceName}"} 0`);
    } else {
      for (const { labels, value } of dlqEntries) {
        lines.push(`dlq_messages_total${this.formatLabels(labels)} ${value}`);
      }
    }

    // Outbox Unpublished Events Gauge
    lines.push('# HELP outbox_unpublished_events_total Current backlog of unpublished outbox events in database');
    lines.push('# TYPE outbox_unpublished_events_total gauge');
    const outboxEntries = this.outboxUnpublishedEvents.getEntries();
    if (outboxEntries.length === 0) {
      lines.push(`outbox_unpublished_events_total{service="${this.serviceName}"} 0`);
    } else {
      for (const { labels, value } of outboxEntries) {
        lines.push(`outbox_unpublished_events_total${this.formatLabels(labels)} ${value}`);
      }
    }

    // Outbox Relay Duration
    lines.push('# HELP outbox_relay_duration_seconds Time taken by outbox worker to dispatch batch to Kafka');
    lines.push('# TYPE outbox_relay_duration_seconds summary');
    for (const { labels, count, sum } of this.outboxRelayDuration.getEntries()) {
      lines.push(`outbox_relay_duration_seconds_count${this.formatLabels(labels)} ${count}`);
      lines.push(`outbox_relay_duration_seconds_sum${this.formatLabels(labels)} ${sum.toFixed(4)}`);
    }

    // Database Connection Pool
    lines.push('# HELP pg_pool_active_connections Current active in-use PostgreSQL connections');
    lines.push('# TYPE pg_pool_active_connections gauge');
    const pgActive = this.pgPoolActiveConnections.getEntries();
    if (pgActive.length === 0) {
      lines.push(`pg_pool_active_connections{service="${this.serviceName}"} 0`);
    } else {
      for (const { labels, value } of pgActive) {
        lines.push(`pg_pool_active_connections${this.formatLabels(labels)} ${value}`);
      }
    }

    lines.push('# HELP pg_pool_idle_connections Current idle PostgreSQL connections ready for use');
    lines.push('# TYPE pg_pool_idle_connections gauge');
    const pgIdle = this.pgPoolIdleConnections.getEntries();
    if (pgIdle.length === 0) {
      lines.push(`pg_pool_idle_connections{service="${this.serviceName}"} 0`);
    } else {
      for (const { labels, value } of pgIdle) {
        lines.push(`pg_pool_idle_connections${this.formatLabels(labels)} ${value}`);
      }
    }

    lines.push('# HELP pg_pool_waiting_clients Number of queries queued waiting for an available DB connection');
    lines.push('# TYPE pg_pool_waiting_clients gauge');
    const pgWaiting = this.pgPoolWaitingClients.getEntries();
    if (pgWaiting.length === 0) {
      lines.push(`pg_pool_waiting_clients{service="${this.serviceName}"} 0`);
    } else {
      for (const { labels, value } of pgWaiting) {
        lines.push(`pg_pool_waiting_clients${this.formatLabels(labels)} ${value}`);
      }
    }

    // Workflow Domain KPIs
    lines.push('# HELP workflow_created_total Total workflows initiated');
    lines.push('# TYPE workflow_created_total counter');
    const wfCreated = this.workflowCreatedTotal.getEntries();
    if (wfCreated.length === 0) {
      lines.push(`workflow_created_total{service="${this.serviceName}"} 0`);
    } else {
      for (const { labels, value } of wfCreated) {
        lines.push(`workflow_created_total${this.formatLabels(labels)} ${value}`);
      }
    }

    lines.push('# HELP workflow_completed_total Total workflows finalized');
    lines.push('# TYPE workflow_completed_total counter');
    const wfCompleted = this.workflowCompletedTotal.getEntries();
    if (wfCompleted.length === 0) {
      lines.push(`workflow_completed_total{service="${this.serviceName}"} 0`);
    } else {
      for (const { labels, value } of wfCompleted) {
        lines.push(`workflow_completed_total${this.formatLabels(labels)} ${value}`);
      }
    }

    return lines.join('\n') + '\n';
  }
}

const registries = new Map<string, MetricsRegistry>();

export function getMetrics(serviceName: string): MetricsRegistry {
  if (!registries.has(serviceName)) {
    registries.set(serviceName, new MetricsRegistry(serviceName));
  }
  return registries.get(serviceName)!;
}

