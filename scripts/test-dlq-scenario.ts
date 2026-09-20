import { Kafka } from 'kafkajs';
import crypto from 'node:crypto';

async function run() {
  const brokers = (process.env.KAFKA_BROKERS || 'kafka.workflow-platform.svc.cluster.local:9092').split(',');
  const kafka = new Kafka({
    clientId: 'dlq-tester',
    brokers,
  });

  const producer = kafka.producer();
  try {
    await producer.connect();
    console.log('✅ Connected to Kafka broker');

    // 1. Send Poison Pill #1: Corrupt unparseable JSON
    console.log('\n--- Step 1: Sending Unparseable JSON Poison Pill ---');
    await producer.send({
      topic: 'workflow.events',
      messages: [
        {
          key: 'test-bad-json-key',
          value: 'MALFORMED NON-JSON STRING {{{[[[ INVALID',
        },
      ],
    });
    console.log('📤 Sent unparseable poison pill to workflow.events');

    // 2. Send Poison Pill #2: Schema Violation (Missing CloudEvent fields)
    console.log('\n--- Step 2: Sending Schema-Violating Poison Pill ---');
    await producer.send({
      topic: 'workflow.events',
      messages: [
        {
          key: 'test-bad-schema-key',
          value: JSON.stringify({
            someRandomField: 'where is the cloudevents envelope?',
            amount: 99999,
          }),
        },
      ],
    });
    console.log('📤 Sent schema violation poison pill to workflow.events');

    // Wait 2 seconds for consumers to process and route to DLQ
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 3. Send Valid Event: Proving consumer is NOT blocked!
    const validWorkflowId = crypto.randomUUID();
    const validEventId = crypto.randomUUID();
    console.log(`\n--- Step 3: Sending Valid Workflow Event (${validWorkflowId}) ---`);
    await producer.send({
      topic: 'workflow.events',
      messages: [
        {
          key: `tenant-corp-a:${validWorkflowId}`,
          value: JSON.stringify({
            id: validEventId,
            source: 'workflow-api',
            specversion: '1.0',
            type: 'workflow.submitted.v1',
            time: new Date().toISOString(),
            datacontenttype: 'application/json',
            data: {
              workflowId: validWorkflowId,
              tenantId: 'tenant-corp-a',
              type: 'EXPENSE',
              title: 'Unblocked Verification Expense',
              amount: 120,
              currency: 'USD',
              requesterId: 'user-emp-1',
              requesterName: 'Alice Johnson',
              actorId: 'user-emp-1',
              previousStatus: 'DRAFT',
              currentStatus: 'PENDING',
              timestamp: new Date().toISOString(),
            },
          }),
        },
      ],
    });
    console.log('📤 Sent valid CloudEvent to workflow.events');
    console.log('✨ Completed test injection!');
  } catch (err) {
    console.error('Error in DLQ scenario tester:', err);
  } finally {
    await producer.disconnect();
  }
}

run();
