import { WorkflowKafkaEvent } from '@workflow/shared-types';

export interface PublishedKafkaRecord {
  topic: string;
  messages: Array<{
    key?: string | Buffer | null;
    value: string | Buffer | null;
    headers?: Record<string, any>;
  }>;
}

export class MockKafkaProducer {
  public publishedRecords: PublishedKafkaRecord[] = [];
  public isConnected: boolean = false;

  async connect(): Promise<void> {
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  async send(record: PublishedKafkaRecord): Promise<void> {
    this.publishedRecords.push(record);
  }

  getPublishedEvents(): WorkflowKafkaEvent[] {
    const events: WorkflowKafkaEvent[] = [];
    for (const record of this.publishedRecords) {
      for (const msg of record.messages) {
        if (msg.value) {
          const str = typeof msg.value === 'string' ? msg.value : msg.value.toString('utf-8');
          try {
            events.push(JSON.parse(str));
          } catch {
            // ignore non-json
          }
        }
      }
    }
    return events;
  }

  clear(): void {
    this.publishedRecords = [];
  }
}
