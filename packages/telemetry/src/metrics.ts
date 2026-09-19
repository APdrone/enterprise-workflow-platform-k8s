export interface MetricLabels {
  [key: string]: string | number;
}

class Counter {
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

class Histogram {
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
  public httpRequestsTotal = new Counter();
  public httpRequestDuration = new Histogram();
  public kafkaEventsPublished = new Counter();
  public kafkaEventsConsumed = new Counter();
  public activeRequests = new Counter();

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
    for (const { labels, value } of this.httpRequestsTotal.getEntries()) {
      lines.push(`http_requests_total${this.formatLabels(labels)} ${value}`);
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
    for (const { labels, value } of this.kafkaEventsPublished.getEntries()) {
      lines.push(`kafka_events_published_total${this.formatLabels(labels)} ${value}`);
    }

    // Kafka Events Consumed
    lines.push('# HELP kafka_events_consumed_total Total Kafka events consumed');
    lines.push('# TYPE kafka_events_consumed_total counter');
    for (const { labels, value } of this.kafkaEventsConsumed.getEntries()) {
      lines.push(`kafka_events_consumed_total${this.formatLabels(labels)} ${value}`);
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
