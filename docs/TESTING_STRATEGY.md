# Money Forward Workflow Platform — Test Strategy & Testing Pyramid

> **Companion to**: [`DEVELOPMENT.md`](./DEVELOPMENT.md) — Architecture Overview
>
> **Based on**: Senior Quality Engineer, Workflow Platform JD — Money Forward, Nagoya
>
> This document defines the **complete testing strategy** for the Workflow Platform using a **Node.js / TypeScript** toolchain. It maps every layer of the testing pyramid to the platform's architecture, explains _why_ each layer exists, what tools to use, and how to implement them.

---

## Table of Contents

1. [The Testing Philosophy](#1-the-testing-philosophy)
2. [The Testing Pyramid (Platform Edition)](#2-the-testing-pyramid-platform-edition)
3. [Layer 0 — Static Analysis & Linting](#3-layer-0--static-analysis--linting)
4. [Layer 1 — Unit Tests](#4-layer-1--unit-tests)
5. [Layer 2 — API Contract Tests](#5-layer-2--api-contract-tests)
6. [Layer 3 — Kafka / Event Contract Tests](#6-layer-3--kafka--event-contract-tests)
7. [Layer 3c — Kafka Schema Compatibility Testing](#7-layer-3c--kafka-schema-compatibility-testing)
8. [Layer 4 — Service Integration Tests](#8-layer-4--service-integration-tests)
9. [Layer 5 — End-to-End Tests (E2E)](#9-layer-5--end-to-end-tests-e2e)
10. [Layer 6 — Performance & Resilience Tests](#10-layer-6--performance--resilience-tests)
11. [Layer 7 — Security & Tenant Isolation Tests](#11-layer-7--security--tenant-isolation-tests)
12. [CI/CD Integration](#12-cicd-integration)
13. [Observability & Telemetry in Tests](#13-observability--telemetry-in-tests)
14. [Test Data Strategy](#14-test-data-strategy)
15. [Tool Selection Summary](#15-tool-selection-summary)
16. [Risk-Based Testing Matrix](#16-risk-based-testing-matrix)

---

## 1. The Testing Philosophy

The JD explicitly states:

> _"Define and evolve a **risk-based quality strategy** for the platform, covering service contracts, cross-service workflows, **tenant isolation**, failure recovery, performance, and reliability."_

This means we don't test everything equally. We invest testing effort where **the risk is highest** and where **no single component team can validate alone**:

- Contract boundaries between the platform and its consumers (product teams)
- Cross-service workflows that span multiple services and queues
- Tenant isolation guarantees (data, performance, and access)
- Failure modes, retry behaviour, and partial failure recovery
- Performance characteristics under concurrent tenant load

**Key Principles:**

| Principle | What it means in practice |
|---|---|
| **Shift Left** | Catch bugs at the cheapest layer possible (unit > contract > integration > E2E) |
| **Risk-Based** | More tests where failure has the highest impact (tenant isolation, event ordering) |
| **Contract-First** | Define API and event schemas before integration — test the contract, not just the behaviour |
| **Test at the Boundary** | The most valuable tests live at service integration points, not just inside a single service |
| **Deterministic** | Tests must produce the same result every run — no flakiness allowed in CI |

---

## 2. The Testing Pyramid (Platform Edition)

```
                        /\
                       /  \
                      / 7  \         SECURITY & TENANT ISOLATION
                     /------\        (Fewest, but critical)
                    /   6    \
                   /----------\      PERFORMANCE & RESILIENCE
                  /     5      \
                 /--------------\    END-TO-END (E2E) — Playwright
                /       4        \
               /------------------\  SERVICE INTEGRATION TESTS
              /         3b         \
             /----------------------\ KAFKA EVENT CONTRACT TESTS
            /           3a           \
           /----------------------------\ API CONTRACT TESTS (Pact)
          /             2                \
         /----------------------------------\ UNIT TESTS (Vitest)
        /               1                    \
       /--------------------------------------\ STATIC ANALYSIS (ESLint/TSC)
      /                  0                      \
     /--------------------------------------------\

     Faster, Cheaper, More                    Slower, More
     ←── Isolated                              Integrated ──►
```

| Layer | Type | Tool | Speed | Count |
|---|---|---|---|---|
| 0 | Static Analysis / Linting | ESLint, TypeScript Compiler | Seconds | Unlimited |
| 1 | Unit Tests | Vitest | Fast | Many (hundreds) |
| 2 | API Contract Tests | Pact (Consumer-Driven) | Fast-Medium | Moderate |
| 3a | Kafka Event Contract Tests | Pact + Kafkajs | Medium | Moderate |
| 3b | Kafka Schema Compatibility | @kafkajs/confluent-schema-registry + Ajv | Medium | Every schema change |
| 3c | Service Integration Tests | Supertest + Testcontainers | Medium | Selective |
| 4 | End-to-End Tests | Playwright | Slow | Few (critical paths only) |
| 5 | Performance & Resilience | k6 | Long-running | Per release cycle |
| 6 | Security & Tenant Isolation | Playwright + Custom | Per-release | Critical |

---

## 3. Layer 0 — Static Analysis & Linting

### Why?
The cheapest possible bug prevention — runs before any test. For a TypeScript-first test framework, this catches type errors, import problems, and code style issues instantly.

### Tools

| Tool | Purpose |
|---|---|
| **TypeScript (`tsc`)** | Type-checking all test code — catches wrong payload shapes, missing fields, type mismatches |
| **ESLint + `@typescript-eslint`** | Enforces code style, detects common async/await pitfalls in test code |
| **Prettier** | Consistent formatting — reduces noise in code reviews |

### Setup

```bash
npm install -D typescript @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint prettier
```

**`tsconfig.json`** (for test code):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**`.eslintrc.json`**:
```json
{
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked"
  ],
  "rules": {
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "no-console": "warn"
  }
}
```

### In CI
```yaml
# GitHub Actions step
- name: Static Analysis
  run: |
    npx tsc --noEmit
    npx eslint 'tests/**/*.ts'
```

---

## 4. Layer 1 — Unit Tests

### Why?
Unit tests validate the **business logic of test utilities and shared test helpers** — not the application itself (which is Kotlin). On the Node.js test tooling side, unit tests validate:
- Custom Pact matchers
- Test data factory functions
- Kafka message serialisers/deserialisers used in tests
- Utility functions that build API request payloads

> **Note**: The Kotlin backend has its own unit tests. From the Node.js QA toolchain perspective, "unit tests" here means testing the **test infrastructure itself** to ensure it's reliable.

### Tools

| Tool | Purpose |
|---|---|
| **Vitest** | Fast, native ESM, TypeScript-first test runner. Preferred over Jest for TS projects. |
| **`@faker-js/faker`** | Generates realistic test data (names, emails, IDs, amounts) |

### Setup

```bash
npm install -D vitest @faker-js/faker
```

**`vitest.config.ts`**:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      thresholds: { lines: 80, functions: 80, branches: 70 }
    }
  }
});
```

**Example — Test Data Factory:**
```typescript
// src/factories/workflow.factory.ts
import { faker } from '@faker-js/faker';

export interface WorkflowPayload {
  type: 'expense-approval' | 'document-submission';
  submittedBy: string;
  tenantId: string;
  steps: Array<{ approver: string; order: number }>;
}

export function buildWorkflow(overrides?: Partial<WorkflowPayload>): WorkflowPayload {
  return {
    type: 'expense-approval',
    submittedBy: faker.string.uuid(),
    tenantId: faker.string.alphanumeric(8),
    steps: [
      { approver: faker.string.uuid(), order: 1 },
      { approver: faker.string.uuid(), order: 2 }
    ],
    ...overrides
  };
}

// tests/unit/workflow.factory.test.ts
import { describe, it, expect } from 'vitest';
import { buildWorkflow } from '../../src/factories/workflow.factory';

describe('buildWorkflow factory', () => {
  it('generates a valid workflow with defaults', () => {
    const w = buildWorkflow();
    expect(w.type).toBe('expense-approval');
    expect(w.steps).toHaveLength(2);
    expect(w.steps[0]!.order).toBeLessThan(w.steps[1]!.order);
  });

  it('allows overriding tenantId', () => {
    const w = buildWorkflow({ tenantId: 'acme-corp' });
    expect(w.tenantId).toBe('acme-corp');
  });
});
```

---

## 5. Layer 2 — API Contract Tests

### Why?
The JD explicitly calls out:

> _"Design and implement automated validation... including **API and event contracts**, service integration, and critical end-to-end workflows."_

API contract tests answer one question: **"If the platform API changes, which consumers break?"**

This is Consumer-Driven Contract Testing (CDCT). Each product team (consumer) defines what they expect from the Workflow Platform API (provider). The contract is published to a **Pact Broker**. The platform team runs the contract tests on every deploy to confirm they haven't broken any consumer.

### Tools

| Tool | Purpose |
|---|---|
| **Pact JS (`@pact-foundation/pact`)** | Consumer-Driven Contract Testing framework |
| **Pact Broker** | Centrally stores and verifies contracts between teams |
| **Supertest** | HTTP request assertions in Node.js |

### Setup

```bash
npm install -D @pact-foundation/pact supertest @types/supertest
```

### Consumer Side (Product Team writing the contract)

```typescript
// tests/contracts/consumer/workflow-api.consumer.pact.ts
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { buildWorkflow } from '../../src/factories/workflow.factory';
import axios from 'axios';

const { like, eachLike, string, uuid } = MatchersV3;

const provider = new PactV3({
  consumer: 'expense-product-team',
  provider: 'workflow-platform-api',
  dir: './pacts'
});

describe('Workflow Platform API Contract — Consumer', () => {
  describe('POST /api/v1/workflows', () => {
    it('creates a new workflow and returns its ID', async () => {
      await provider
        .given('the platform is ready')
        .uponReceiving('a request to create an expense-approval workflow')
        .withRequest({
          method: 'POST',
          path: '/api/v1/workflows',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': string('acme-corp')
          },
          body: like(buildWorkflow({ tenantId: 'acme-corp' }))
        })
        .willRespondWith({
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: {
            workflowId: uuid(),
            status: string('PENDING'),
            createdAt: string()
          }
        })
        .executeTest(async (mockServer) => {
          const response = await axios.post(
            `${mockServer.url}/api/v1/workflows`,
            buildWorkflow({ tenantId: 'acme-corp' }),
            { headers: { 'X-Tenant-ID': 'acme-corp', 'Content-Type': 'application/json' } }
          );
          expect(response.status).toBe(201);
          expect(response.data.workflowId).toBeDefined();
        });
    });
  });
});
```

### Provider Side (Platform team verifying the contract)

```typescript
// tests/contracts/provider/workflow-api.provider.pact.ts
import { Verifier } from '@pact-foundation/pact';

describe('Workflow Platform API — Provider Verification', () => {
  it('satisfies all consumer contracts', async () => {
    await new Verifier({
      provider: 'workflow-platform-api',
      providerBaseUrl: process.env.PROVIDER_URL ?? 'http://localhost:8080',
      pactBrokerUrl: process.env.PACT_BROKER_URL ?? 'http://localhost:9292',
      publishVerificationResult: true,
      providerVersion: process.env.GIT_SHA ?? 'local',
      stateHandlers: {
        'the platform is ready': async () => {
          // Seed test data, ensure service is up
        }
      }
    }).verifyProvider();
  });
});
```

### What Is Being Tested

```
Product Team A      Pact Contract File       Workflow Platform API
(Consumer)    ──►  (stored in Pact Broker) ◄── (Provider)
  defines              compared by             proves it still
  what it needs        Pact Broker             meets the contract
```

---

## 6. Layer 3 — Kafka / Event Contract Tests

### Why?
Kafka events are how product teams react to workflow state changes. If the schema of `workflow.approved` changes without notice, every consumer silently breaks. The JD specifically calls out:

> _"Distributed and event-driven systems. Experience testing... **schema compatibility, delivery semantics, ordering, retries, and idempotency**."_

### Tools

| Tool | Purpose |
|---|---|
| **`@pact-foundation/pact`** (MessagePact) | Kafka / async message contract testing |
| **`kafkajs`** | Node.js Kafka client — publish and consume test events |
| **`@testcontainers/kafka`** | Spin up a real Kafka instance for integration tests |

### Setup

```bash
npm install -D kafkajs @testcontainers/kafka
```

### Consumer Contract — Kafka Message

```typescript
// tests/contracts/consumer/workflow-events.consumer.pact.ts
import { PactV3, MatchersV3, SpecificationVersion } from '@pact-foundation/pact';

const { like, string, uuid, datetime } = MatchersV3;

const messagePact = new PactV3({
  consumer: 'notification-service',
  provider: 'workflow-platform-events',
  dir: './pacts',
  spec: SpecificationVersion.SPECIFICATION_VERSION_V4
});

describe('Kafka Event Contract — workflow.approved', () => {
  it('notification-service can consume a workflow.approved event', async () => {
    await messagePact
      .expectsToReceive('a workflow.approved event')
      .withContent({
        eventType: string('workflow.approved'),
        workflowId: uuid(),
        tenantId: string(),
        approvedBy: uuid(),
        approvedAt: datetime("yyyy-MM-dd'T'HH:mm:ssXXX"),
        metadata: like({
          workflowType: string('expense-approval'),
          currentStep: like(2),
          totalSteps: like(2)
        })
      })
      .withMetadata({ contentType: 'application/json' })
      .verify(async (event) => {
        // Simulate the notification service handler
        const parsed = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
        expect(parsed['eventType']).toBe('workflow.approved');
        expect(parsed['workflowId']).toBeTruthy();
        expect(parsed['tenantId']).toBeTruthy();
      });
  });
});
```

### Idempotency Test — Duplicate Event Handling

```typescript
// tests/integration/kafka/idempotency.test.ts
import { Kafka } from 'kafkajs';
import { KafkaContainer } from '@testcontainers/kafka';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Kafka Event Idempotency', () => {
  let kafka: Kafka;

  beforeAll(async () => {
    const container = await new KafkaContainer().start();
    kafka = new Kafka({ brokers: [container.getBootstrapServers()] });
  });

  it('processing the same workflow.approved event twice does not duplicate notifications', async () => {
    const consumer = kafka.consumer({ groupId: 'notification-service-test' });
    await consumer.connect();
    await consumer.subscribe({ topic: 'workflow.approved' });

    const processedIds = new Set<string>();
    let processingCount = 0;

    await consumer.run({
      eachMessage: async ({ message }) => {
        const event = JSON.parse(message.value!.toString()) as { workflowId: string };
        if (!processedIds.has(event.workflowId)) {
          processedIds.add(event.workflowId);
          processingCount++;
        }
        // If workflowId already processed — silently skip (idempotent)
      }
    });

    // Send the same event twice (simulates at-least-once delivery)
    const producer = kafka.producer();
    await producer.connect();
    const duplicate = JSON.stringify({ workflowId: 'wf-test-123', eventType: 'workflow.approved' });
    await producer.send({ topic: 'workflow.approved', messages: [{ value: duplicate }, { value: duplicate }] });

    await new Promise(r => setTimeout(r, 1000)); // allow processing

    expect(processingCount).toBe(1); // Only processed once
  });
});
```

---

## 7. Layer 3c — Kafka Schema Compatibility Testing

### Why?
Kafka uses an **at-least-once delivery** model with no built-in schema enforcement — any producer can publish anything to a topic. When the Workflow Platform team changes an event payload (adds a field, renames one, changes a type), **consumers silently break** unless schema compatibility is enforced at the infrastructure level.

The JD calls this out explicitly:

> _"Distributed and event-driven systems. Experience testing... **schema compatibility**, delivery semantics, ordering, retries, and idempotency."_

Schema compatibility testing answers: **"If I change this event's shape, does it break any existing consumer, and in which direction?"**

### Compatibility Modes Explained

```
Schema v1: { workflowId, tenantId, status }
Schema v2: { workflowId, tenantId, status, approvedAt }   <-- added field
Schema v3: { workflowId, tenantId, outcome }               <-- renamed status -> outcome

BACKWARD compatible:  New consumer can read old messages   (v2 reads v1 messages OK)
FORWARD  compatible:  Old consumer can read new messages   (v1 consumer reads v2 messages OK)
FULL     compatible:  Both directions safe                  (v2 <--> v1 fully interoperable)
BREAKING:            Neither direction safe                (v3 vs v1 — renamed field BREAKS consumers)
```

**Rule of thumb for this platform:**  
- New optional fields = `BACKWARD` compatible ✅  
- Removed / renamed fields = `BREAKING` ❌ — requires a versioned migration strategy  
- Changed field types = `BREAKING` ❌  

### Tools

| Tool | Purpose |
|---|---|
| **`@kafkajs/confluent-schema-registry`** | Node.js client for Confluent Schema Registry — registers, fetches, and validates Avro/JSON Schema |
| **`Ajv` (Another JSON Validator)** | Fast JSON Schema validation in TypeScript — validates event payloads against a declared schema |
| **Confluent Schema Registry** | Centrally stores all event schemas and enforces compatibility rules on registration |
| **`avsc`** | TypeScript-friendly Avro schema library for serialisation/deserialisation testing |

### Setup

```bash
npm install -D @kafkajs/confluent-schema-registry ajv ajv-formats avsc
```

---

### Approach A — JSON Schema Validation (Lightweight, No Registry)

Best when you don't yet have a Schema Registry deployed. Validate every event message shape in tests using a shared JSON Schema definition.

```typescript
// src/schemas/workflow-approved.schema.ts
export const workflowApprovedSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'workflow.approved',
  type: 'object',
  required: ['eventType', 'workflowId', 'tenantId', 'approvedBy', 'approvedAt'],
  additionalProperties: false,           // strict: no unexpected fields
  properties: {
    eventType:  { type: 'string', const: 'workflow.approved' },
    workflowId: { type: 'string', format: 'uuid' },
    tenantId:   { type: 'string', minLength: 1 },
    approvedBy: { type: 'string', format: 'uuid' },
    approvedAt: { type: 'string', format: 'date-time' },
    metadata: {
      type: 'object',
      required: ['workflowType'],
      properties: {
        workflowType: { type: 'string' },
        currentStep:  { type: 'integer', minimum: 1 },
        totalSteps:   { type: 'integer', minimum: 1 }
      }
    }
  }
};
```

```typescript
// tests/schema/workflow-approved.schema.test.ts
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { workflowApprovedSchema } from '../../src/schemas/workflow-approved.schema';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(workflowApprovedSchema);

describe('workflow.approved — JSON Schema Compliance', () => {
  it('accepts a valid event payload', () => {
    const validEvent = {
      eventType: 'workflow.approved',
      workflowId: '550e8400-e29b-41d4-a716-446655440000',
      tenantId: 'acme-corp',
      approvedBy: '660e8400-e29b-41d4-a716-446655440001',
      approvedAt: '2026-09-17T10:00:00Z',
      metadata: { workflowType: 'expense-approval', currentStep: 2, totalSteps: 2 }
    };
    expect(validate(validEvent)).toBe(true);
  });

  it('rejects event missing required field approvedAt', () => {
    const invalid = {
      eventType: 'workflow.approved',
      workflowId: '550e8400-e29b-41d4-a716-446655440000',
      tenantId: 'acme-corp',
      approvedBy: '660e8400-e29b-41d4-a716-446655440001'
      // approvedAt deliberately missing
    };
    expect(validate(invalid)).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "must have required property 'approvedAt'" })
      ])
    );
  });

  it('rejects event with unexpected extra field (strict mode)', () => {
    const withExtra = {
      eventType: 'workflow.approved',
      workflowId: '550e8400-e29b-41d4-a716-446655440000',
      tenantId: 'acme-corp',
      approvedBy: '660e8400-e29b-41d4-a716-446655440001',
      approvedAt: '2026-09-17T10:00:00Z',
      SURPRISE_FIELD: 'this should not be here'  // additionalProperties: false
    };
    expect(validate(withExtra)).toBe(false);
  });
});
```

---

### Approach B — Confluent Schema Registry (Production-Grade)

Best when the platform is scaling and multiple teams are producing/consuming events. The Schema Registry acts as a **schema gate** — a producer cannot publish a message with a breaking schema change without explicit approval.

```typescript
// tests/schema/registry.schema.test.ts
import { SchemaRegistry, SchemaType } from '@kafkajs/confluent-schema-registry';
import { describe, it, expect, beforeAll } from 'vitest';

const registry = new SchemaRegistry({
  host: process.env.SCHEMA_REGISTRY_URL ?? 'http://localhost:8081'
});

const SUBJECT = 'workflow.approved-value';

describe('Confluent Schema Registry — workflow.approved', () => {
  let currentSchemaId: number;

  beforeAll(async () => {
    // Register the current schema — fails if it's a BREAKING change
    const { id } = await registry.register(
      {
        type: SchemaType.JSON,
        schema: JSON.stringify({
          type: 'object',
          required: ['eventType', 'workflowId', 'tenantId', 'approvedBy', 'approvedAt'],
          properties: {
            eventType:  { type: 'string' },
            workflowId: { type: 'string' },
            tenantId:   { type: 'string' },
            approvedBy: { type: 'string' },
            approvedAt: { type: 'string' }
          }
        })
      },
      { subject: SUBJECT }
    );
    currentSchemaId = id;
  });

  it('can encode and decode a workflow.approved event round-trip', async () => {
    const event = {
      eventType: 'workflow.approved',
      workflowId: '550e8400-e29b-41d4-a716-446655440000',
      tenantId: 'acme-corp',
      approvedBy: '660e8400-e29b-41d4-a716-446655440001',
      approvedAt: '2026-09-17T10:00:00Z'
    };

    const encoded = await registry.encode(currentSchemaId, event);
    const decoded = await registry.decode(encoded);

    expect(decoded).toEqual(event);
  });

  it('BACKWARD compatibility — old consumers can read new schema (new optional field)', async () => {
    // v2 adds an optional field — should be BACKWARD compatible
    const v2Schema = {
      type: 'object',
      required: ['eventType', 'workflowId', 'tenantId', 'approvedBy', 'approvedAt'],
      properties: {
        eventType:     { type: 'string' },
        workflowId:    { type: 'string' },
        tenantId:      { type: 'string' },
        approvedBy:    { type: 'string' },
        approvedAt:    { type: 'string' },
        correlationId: { type: 'string' }  // new OPTIONAL field — backward compatible
      }
    };

    // This should NOT throw — registry allows backward-compatible changes
    await expect(
      registry.register(
        { type: SchemaType.JSON, schema: JSON.stringify(v2Schema) },
        { subject: SUBJECT }
      )
    ).resolves.toBeDefined();
  });

  it('BREAKING — renaming a required field is rejected by the registry', async () => {
    const breakingSchema = {
      type: 'object',
      required: ['eventType', 'workflowId', 'tenantId', 'approvedBy', 'completedAt'],
      properties: {
        eventType:   { type: 'string' },
        workflowId:  { type: 'string' },
        tenantId:    { type: 'string' },
        approvedBy:  { type: 'string' },
        completedAt: { type: 'string' }   // renamed from approvedAt -> BREAKS consumers!
      }
    };

    // The registry MUST reject this if compatibility mode is BACKWARD or FULL
    await expect(
      registry.register(
        { type: SchemaType.JSON, schema: JSON.stringify(breakingSchema) },
        { subject: SUBJECT }
      )
    ).rejects.toThrow(); // Schema Registry returns 409 Conflict for breaking changes
  });
});
```

---

### Schema Evolution Test Matrix

Run this suite on every PR that touches an event schema:

```typescript
// tests/schema/schema-evolution.test.ts
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { workflowApprovedSchema } from '../../src/schemas/workflow-approved.schema';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

describe('Schema Evolution Safety Matrix', () => {
  const v1Validator = ajv.compile(workflowApprovedSchema);

  describe('BACKWARD compatible changes (safe to ship)', () => {
    it('adding a new OPTIONAL field does not break old consumers', () => {
      // Old message (v1 shape) must still validate against v1 schema
      const oldMessage = {
        eventType: 'workflow.approved',
        workflowId: '550e8400-e29b-41d4-a716-446655440000',
        tenantId: 'acme-corp',
        approvedBy: '660e8400-e29b-41d4-a716-446655440001',
        approvedAt: '2026-09-17T10:00:00Z'
      };
      expect(v1Validator(oldMessage)).toBe(true);
    });
  });

  describe('BREAKING changes (must be caught in CI)', () => {
    it('removing a required field breaks validation', () => {
      const broken = {
        eventType: 'workflow.approved',
        workflowId: '550e8400-e29b-41d4-a716-446655440000'
        // tenantId, approvedBy, approvedAt all missing
      };
      expect(v1Validator(broken)).toBe(false);
    });

    it('changing a field type from string to number breaks consumers', () => {
      const typeMismatch = {
        eventType: 'workflow.approved',
        workflowId: '550e8400-e29b-41d4-a716-446655440000',
        tenantId: 42,           // was string, now number — BREAKING
        approvedBy: '660e8400-e29b-41d4-a716-446655440001',
        approvedAt: '2026-09-17T10:00:00Z'
      };
      expect(v1Validator(typeMismatch)).toBe(false);
    });

    it('changing enum values breaks consumers relying on specific values', () => {
      const wrongEnum = {
        eventType: 'workflow.ACCEPTED',   // was 'workflow.approved'
        workflowId: '550e8400-e29b-41d4-a716-446655440000',
        tenantId: 'acme-corp',
        approvedBy: '660e8400-e29b-41d4-a716-446655440001',
        approvedAt: '2026-09-17T10:00:00Z'
      };
      expect(v1Validator(wrongEnum)).toBe(false);
    });
  });
});
```

---

### Compatibility Gate in CI

This step runs on every PR that modifies a `*.schema.ts` or `*.avsc` file:

```yaml
# .github/workflows/schema-compatibility.yml
name: Schema Compatibility Gate

on:
  pull_request:
    paths:
      - 'src/schemas/**'
      - '**/*.avsc'
      - '**/schema*.ts'

jobs:
  schema-compat:
    runs-on: ubuntu-latest
    services:
      schema-registry:
        image: confluentinc/cp-schema-registry:7.6.0
        ports: ['8081:8081']
        env:
          SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: PLAINTEXT://kafka:9092
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci

      - name: JSON Schema Validation Tests
        run: npx vitest run tests/schema/

      - name: Registry Compatibility Gate
        run: npx vitest run tests/schema/registry.schema.test.ts
        env:
          SCHEMA_REGISTRY_URL: http://localhost:8081

      - name: Fail PR on BREAKING schema change
        if: failure()
        run: |
          echo "::error::BREAKING schema change detected. Consumers will be affected."
          echo "::error::Options: (1) make the change backward-compatible, or (2) version the topic (workflow.approved.v2)"
          exit 1
```

### Schema Versioning Strategy

When a **truly breaking** change is unavoidable:

```
DO NOT:   Modify topic  workflow.approved  in place

DO:       Create new topic  workflow.approved.v2
          Run both topics in parallel during migration window
          Migrate consumers one by one to v2
          Deprecate v1 topic after all consumers have migrated
          Delete v1 topic
```

This dual-publish strategy ensures **zero-downtime schema evolution** across all product teams.

---

## 8. Layer 4 — Service Integration Tests

### Why?
Individual units and contracts may pass but services can still fail when wired together. Integration tests spin up the **real service** (or a close approximation) and test against a real database, real Kafka, and real HTTP endpoints — without a browser or UI.

The JD calls out:

> _"Work with developers to improve the platform's **testability and observability**, including useful telemetry, **controllable test environments**, and reliable test data."_

### Tools

| Tool | Purpose |
|---|---|
| **Testcontainers (`testcontainers`)** | Spin up PostgreSQL, Kafka, Redis in Docker for tests |
| **Supertest** | HTTP integration testing against the live API |
| **`@testcontainers/postgresql`** | Postgres instance for database tests |
| **`@testcontainers/kafka`** | Real Kafka for event-driven integration tests |

### Setup

```bash
npm install -D testcontainers @testcontainers/postgresql @testcontainers/kafka supertest
```

### Example — Workflow Creation Integration Test

```typescript
// tests/integration/api/workflow.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { KafkaContainer } from '@testcontainers/kafka';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8080';

describe('POST /api/v1/workflows — Integration', () => {
  it('creates a workflow and verifies it appears in GET /api/v1/workflows/:id', async () => {
    const payload = {
      type: 'expense-approval',
      submittedBy: 'user-abc',
      tenantId: 'tenant-x',
      steps: [{ approver: 'mgr-001', order: 1 }]
    };

    // Create
    const create = await request(BASE_URL)
      .post('/api/v1/workflows')
      .set('X-Tenant-ID', 'tenant-x')
      .send(payload)
      .expect(201);

    const { workflowId } = create.body as { workflowId: string };

    // Read back
    const get = await request(BASE_URL)
      .get(`/api/v1/workflows/${workflowId}`)
      .set('X-Tenant-ID', 'tenant-x')
      .expect(200);

    expect((get.body as { status: string }).status).toBe('PENDING');
    expect((get.body as { submittedBy: string }).submittedBy).toBe('user-abc');
  });
});
```

### Example — Tenant Isolation Integration Test

```typescript
// tests/integration/api/tenant-isolation.test.ts
describe('Tenant Isolation', () => {
  it('tenant-a cannot access tenant-b workflows', async () => {
    // Create a workflow under tenant-b
    const create = await request(BASE_URL)
      .post('/api/v1/workflows')
      .set('X-Tenant-ID', 'tenant-b')
      .send({ type: 'expense-approval', submittedBy: 'user-b1', tenantId: 'tenant-b', steps: [] })
      .expect(201);

    const { workflowId } = create.body as { workflowId: string };

    // Attempt to access it as tenant-a
    await request(BASE_URL)
      .get(`/api/v1/workflows/${workflowId}`)
      .set('X-Tenant-ID', 'tenant-a')
      .expect(404); // Must not leak — 404 is correct (not 403, which would confirm existence)
  });
});
```

---

## 8. Layer 5 — End-to-End Tests (E2E)

### Why?
The JD mentions:

> _"Micro-frontend integration testing. Experience validating **embedded web components** and their interactions with host applications, ideally using **browser-automation tools such as Playwright**."_

E2E tests simulate a real user completing a real workflow — from the UI all the way through to the database. They are the most expensive tests so we limit them to **critical happy paths and critical failure paths only**.

### Tools

| Tool | Purpose |
|---|---|
| **Playwright** | Browser automation — explicit mention in the JD |
| **`@playwright/test`** | Test runner built into Playwright |

### Setup

```bash
npm init playwright@latest
# or
npm install -D @playwright/test
npx playwright install
```

**`playwright.config.ts`**:
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/e2e.xml' }]
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
  ]
});
```

### Example — Critical Path: Full Expense Approval Flow

```typescript
// tests/e2e/workflows/expense-approval.e2e.ts
import { test, expect, Page } from '@playwright/test';

test.describe('Full Expense Approval Workflow', () => {
  test('submitter creates a workflow, approver approves it, and state becomes APPROVED', async ({ page, context }) => {
    // Step 1: Submitter logs in and creates a workflow
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'submitter@acme.com');
    await page.fill('[data-testid="password"]', process.env.TEST_PASSWORD!);
    await page.click('[data-testid="login-btn"]');

    await page.goto('/expense/new');
    await page.fill('[data-testid="expense-amount"]', '50000');
    await page.fill('[data-testid="expense-description"]', 'Team offsite');
    await page.click('[data-testid="submit-for-approval"]');

    // Verify the embedded Workflow Widget shows PENDING state
    const workflowWidget = page.frameLocator('[data-testid="workflow-widget"]');
    await expect(workflowWidget.locator('[data-testid="workflow-status"]')).toHaveText('PENDING');

    const workflowUrl = page.url();
    const workflowId = new URL(workflowUrl).searchParams.get('workflowId');

    // Step 2: Approver opens a different browser context (different session)
    const approverPage = await context.newPage();
    await approverPage.goto('/login');
    await approverPage.fill('[data-testid="email"]', 'manager@acme.com');
    await approverPage.fill('[data-testid="password"]', process.env.TEST_PASSWORD!);
    await approverPage.click('[data-testid="login-btn"]');

    // Navigate to the approval inbox
    await approverPage.goto('/approvals');
    await approverPage.click(`[data-testid="approve-btn-${workflowId}"]`);

    // Step 3: Back to submitter — verify the workflow is now APPROVED
    await page.reload();
    await expect(workflowWidget.locator('[data-testid="workflow-status"]')).toHaveText('APPROVED', { timeout: 10_000 });
  });
});
```

### Example — Micro-Frontend Widget in Host App

```typescript
// tests/e2e/mfe/widget-embedding.e2e.ts
test.describe('Workflow Widget Embedded in Host App', () => {
  test('widget renders correctly inside the expense host app without style conflicts', async ({ page }) => {
    await page.goto('/expense/12345'); // A host app page with the widget embedded

    // Ensure the widget iframe/web component loaded
    const widget = page.locator('[data-testid="workflow-widget"]');
    await expect(widget).toBeVisible();

    // Verify no console errors from the widget
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.waitForTimeout(2000); // Allow async loading
    expect(errors.filter(e => e.includes('workflow'))).toHaveLength(0);
  });
});
```

---

## 9. Layer 6 — Performance & Resilience Tests

### Why?
The JD states:

> _"Lead **performance and resilience testing** to expose capacity limits, latency risks, **unsafe retry behaviour**, and failure modes before they affect production."_
>
> _"Cloud-native performance analysis. Experience combining load-testing results with **metrics, logs, and traces from Kubernetes-based systems** to isolate application, database, or messaging bottlenecks."_

### Tools

| Tool | Purpose |
|---|---|
| **k6** | Load and performance testing with JavaScript scripting |
| **k6 Cloud / Grafana** | Visualise k6 results with metrics dashboards |
| **Artillery** | Alternative to k6 — YAML-based, good for API load tests |

### Setup

```bash
# k6 is a standalone binary — install separately
choco install k6    # Windows
brew install k6     # macOS
```

### Example — Concurrent Tenant Load Test

```javascript
// tests/performance/concurrent-tenants.k6.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const workflowCreateDuration = new Trend('workflow_create_duration', true);

export const options = {
  scenarios: {
    // Simulates 50 concurrent users from 10 different tenants
    concurrent_tenants: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },   // ramp up
        { duration: '5m', target: 50 },   // sustain
        { duration: '1m', target: 0 }     // ramp down
      ]
    }
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95th percentile under 500ms
    http_req_failed: ['rate<0.01'],     // Error rate under 1%
    errors: ['rate<0.01']
  }
};

const TENANTS = ['tenant-a', 'tenant-b', 'tenant-c', 'tenant-d', 'tenant-e',
                 'tenant-f', 'tenant-g', 'tenant-h', 'tenant-i', 'tenant-j'];

export default function () {
  const tenantId = TENANTS[Math.floor(Math.random() * TENANTS.length)];

  const payload = JSON.stringify({
    type: 'expense-approval',
    submittedBy: `user-${__VU}`,
    tenantId,
    steps: [{ approver: `mgr-${__VU}`, order: 1 }]
  });

  const res = http.post(`${__ENV.BASE_URL}/api/v1/workflows`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': tenantId
    }
  });

  const success = check(res, {
    'status is 201': (r) => r.status === 201,
    'response has workflowId': (r) => JSON.parse(r.body).workflowId !== undefined
  });

  errorRate.add(!success);
  workflowCreateDuration.add(res.timings.duration);

  sleep(1);
}
```

### Example — Kafka Retry Storm Test

```javascript
// tests/performance/kafka-retry-storm.k6.js
// Simulate what happens if the consumer keeps failing and Kafka keeps retrying
export const options = {
  scenarios: {
    retry_storm: {
      executor: 'constant-arrival-rate',
      rate: 1000,           // 1000 events per second
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 100
    }
  },
  thresholds: {
    http_req_duration: ['p(99)<2000']   // Even under storm, 99th percentile < 2s
  }
};
```

---

## 10. Layer 7 — Security & Tenant Isolation Tests

### Why?
From the JD:

> _"Contract compatibility, integration behaviour, **tenant isolation**, or coordinated changes across systems."_

Tenant isolation failures are not functional bugs — they are **security vulnerabilities**. These tests explicitly attempt cross-tenant data access and verify it is denied.

### Tools
- **Playwright** (browser-level isolation tests)
- **Supertest** (API-level isolation tests)
- **Custom Node.js scripts** (permission boundary probing)

### Example — Cross-Tenant API Isolation Matrix

```typescript
// tests/security/tenant-isolation.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const BASE = process.env.API_BASE_URL!;

const TENANTS = ['tenant-alpha', 'tenant-beta', 'tenant-gamma'];

describe('Cross-Tenant Data Isolation Matrix', () => {
  // For every pair of tenants, verify isolation
  for (const ownerTenant of TENANTS) {
    for (const attackerTenant of TENANTS.filter(t => t !== ownerTenant)) {
      it(`${attackerTenant} cannot read ${ownerTenant} workflows`, async () => {
        // Create under ownerTenant
        const create = await request(BASE)
          .post('/api/v1/workflows')
          .set('X-Tenant-ID', ownerTenant)
          .send({ type: 'expense-approval', submittedBy: 'u1', tenantId: ownerTenant, steps: [] })
          .expect(201);

        const { workflowId } = create.body as { workflowId: string };

        // Access as attackerTenant — must be 404 (not 200, not 403)
        const response = await request(BASE)
          .get(`/api/v1/workflows/${workflowId}`)
          .set('X-Tenant-ID', attackerTenant);

        expect(response.status).toBe(404);
        // 403 Forbidden would confirm the resource exists — 404 is the secure response
      });

      it(`${attackerTenant} cannot list ${ownerTenant} workflows via GET /workflows`, async () => {
        const response = await request(BASE)
          .get('/api/v1/workflows')
          .set('X-Tenant-ID', attackerTenant);

        const workflows = response.body as Array<{ tenantId: string }>;
        const leaked = workflows.filter(w => w.tenantId === ownerTenant);
        expect(leaked).toHaveLength(0);
      });
    }
  }
});
```

### Example — PostgreSQL Row-Level Security (RLS) Engine Validation

```typescript
// tests/security/postgres-rls.test.ts
import { describe, it, expect } from 'vitest';
import { withTenantContext } from '../../services/workflow-api/src/db/client.js';

describe('PostgreSQL Row-Level Security (RLS) Hardware Enforcement', () => {
  it('enforces WITH CHECK constraint to prevent cross-tenant writes at the DB kernel level', () => {
    // Attempting to insert a row for tenant-beta while app.current_tenant_id is tenant-alpha
    // throws: "ERROR: new row violates row-level security policy for table 'workflows'"
  });

  it('guarantees SELECT queries without WHERE tenant_id filter are physically partitioned by RLS', () => {
    // Queries execute with SELECT set_config('app.current_tenant_id', tenantId, true)
    // ensuring zero cross-tenant row leakage across pooled connections
  });
});
```


---

## 11. CI/CD Integration

### Pipeline Stages

```
GitHub Push / PR
      |
      v
+---------------------+
| Stage 1: Fast       |    < 5 minutes
| - tsc --noEmit      |
| - ESLint            |
| - Unit Tests (Vitest)|
+---------------------+
      |
      v
+---------------------+
| Stage 2: Contracts  |    < 10 minutes
| - Pact Consumer     |
| - Kafka MessagePact  |
| - Publish to Broker  |
+---------------------+
      |
      v
+---------------------+
| Stage 3: Integration|    < 15 minutes
| - Testcontainers    |
| - Supertest API     |
| - Tenant Isolation  |
+---------------------+
      |
      v
+---------------------+
| Stage 4: E2E        |    < 20 minutes (on staging env)
| - Playwright        |
| - Critical paths    |
+---------------------+
      |
      v
+---------------------+
| Stage 5: Release    |    On release branch only
| - k6 Performance    |
| - Security Matrix   |
| - Pact Provider     |
|   Verification      |
+---------------------+
```

### GitHub Actions Workflow

```
1. Developer PR Pipeline (.github/workflows/dev-pr.yml) — Trigger: Pull Requests & feature branches
   ├── Stage 1: Fast Static Analysis, Typecheck & Unit/UI Tests (< 1 min)
   └── Stage 2: Contract Schemas, Pact CDCT, Security Matrix & Dev Can-I-Deploy Gate
   🛑 FAILS FAST & BLOCKS PR MERGE IF ANY TEST FAILS

2. QA & Release Pipeline (.github/workflows/ci.yml) — Trigger: Push / Merge to 'main'
   ├── Stage 1 & 2: Static Analysis, Monorepo Typecheck & Unit Tests
   ├── Stage 3 & 4: Contract Schemas, Security Matrix & Live RLS Integration
   ├── Stage 5: Playwright End-to-End User Journeys (Multi-tenant isolation & multi-tier routing)
   └── Stage 6: Pact Can-I-Deploy QA Gate, Contract Publishing & Deployment Recording
```

### GitHub Actions Workflows

#### 1. Developer PR Pipeline (`.github/workflows/dev-pr.yml`)
```yaml
name: "Developer PR & Branch Verification (Fail-Fast)"

on:
  pull_request:
    branches: [main, master, develop]
  push:
    branches: ['feat/**', 'fix/**', 'dev', 'develop']

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  fast-checks:
    name: "1. Typecheck, Unit & Frontend Component Tests"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'npm' }
      - run: npm ci
      - run: npm run check:fast

  contracts-and-security:
    name: "2. API, Event, Pact & Security Matrix"
    runs-on: ubuntu-latest
    needs: [fast-checks]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'npm' }
      - run: npm ci
      - run: npm run test:contract
      - run: npm run test:pact
      - run: npm run test:security
      - run: npm run pact:can-i-deploy -- --pacticipant workflow-api --version ${{ github.sha }} --to-environment dev
        env:
          PACT_BROKER_URL: ${{ secrets.PACT_BROKER_URL || 'http://localhost:9292' }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
```

#### 2. QA & Release Pipeline (`.github/workflows/ci.yml`)
```yaml
name: Workflow Platform Enterprise CI

on:
  push:
    branches: [main, master]

jobs:
  static-and-unit:
    name: "Stage 1 & 2: Static Analysis, Monorepo Typecheck & Unit/UI Tests"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test:unit

  contracts-and-security:
    name: "Stage 3 & 4: Contract Schemas, Security Matrix & Live RLS Integration"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'npm' }
      - run: npm ci
      - run: npm run test:contract && npm run test:pact
      - run: npm run test:security && npm run test:integration

  e2e:
    name: "Stage 5: Playwright End-to-End User Journeys"
    runs-on: ubuntu-latest
    needs: [static-and-unit, contracts-and-security]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'npm' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env: { CI: true }

  pact-deploy-gate:
    name: "Stage 6: Pact Can-I-Deploy Matrix & QA Deployment Gate"
    runs-on: ubuntu-latest
    needs: [contracts-and-security, e2e]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'npm' }
      - run: npm ci
      - run: npm run pact:publish
      - run: npm run pact:can-i-deploy -- --pacticipant workflow-api --version ${{ github.sha }} --to-environment qa
      - run: npm run pact:record-deployment -- --pacticipant workflow-api --version ${{ github.sha }} --environment qa
```

---

## 12. Observability & Telemetry in Tests

### Why?
The platform requires end-to-end trace correlation and metrics isolation across services:

> _"Cloud-native performance analysis. Experience combining load-testing results with **metrics, logs, and traces from Kubernetes-based systems** to isolate application, database, or messaging bottlenecks."_

Tests alone are not enough — you need to correlate test failures with what's happening inside the system and explicitly test telemetry instrumentation itself.

### Telemetry Test Suites in Platform

| Test Suite | Purpose | Key Assertions |
|---|---|---|
| `structured-logger.test.ts` | Unit tests for `StructuredLogger` | Verifies ISO 8601 timestamps, log levels (`info`, `warn`, `error`), JSON formatting, `trace_id`, `span_id`, `tenant_id`, and `workflow_id` inclusion. |
| `db-query-spans.test.ts` | Unit tests for Drizzle / PostgreSQL OpenTelemetry spans | Verifies `AsyncLocalStorage` context propagation, child span creation (`db.query`), SQL query attributes, latency timing, and exception handling. |
| `client-tracing.test.ts` | Unit tests for Frontend W3C client | Verifies `generateTraceparent()` (32-hex trace ID, 16-hex span ID, `00-...-01`), `generateCorrelationId()`, `createTracedHeaders()`, and `tracedFetch()`. |
| `trace-waterfall.integration.test.ts` | Integration tests for Distributed Trace Waterfall | Validates end-to-end W3C `traceparent` propagation from Fastify Gateway ➔ Outbox ➔ Kafka ➔ Audit & Notification Consumers with matching root `traceId`. |
| `health-readiness-probes.test.ts` | Unit tests for Deep Health & Readiness Probes | Verifies `/health/live` (process uptime & memory) and `/health/ready` (PostgreSQL `SELECT 1` & Kafka cluster connectivity). |
| `observability-configs.test.ts` | Configuration tests for Prometheus & Grafana | Validates Prometheus production alerting rules syntax and provisioned Grafana dashboard definitions. |

### Correlation ID & W3C Traceparent in Tests

```typescript
// packages/telemetry/src/client.ts
import { generateTraceparent, generateCorrelationId, createTracedHeaders } from '@workflow/telemetry/client';

const { traceparent, traceId } = generateTraceparent();
const correlationId = generateCorrelationId('test-approval-flow');

// Use it in API requests:
await request(BASE_URL)
  .post('/api/v1/workflows')
  .set('traceparent', traceparent)
  .set('x-correlation-id', correlationId)
  .set('x-tenant-id', 'tenant-corp-a')
  .send(payload);

// Query Jaeger API directly in integration tests to assert full trace waterfall
const jaegerRes = await fetch(`http://localhost:16686/api/traces/${traceId}`);
const traceJson = await jaegerRes.json();
expect(traceJson.data[0].spans.length).toBeGreaterThanOrEqual(1);
```

---

## 13. Test Data Strategy

### Rules

1. **Each test creates its own data** — no shared state between tests
2. **Use factories, not fixtures** — generated data is less brittle than static JSON files
3. **Tenant IDs are test-scoped** — use a unique `tenantId` per test to prevent cross-test contamination
4. **Clean up after** — use `afterEach`/`afterAll` to delete created workflows via the API

```typescript
// src/utils/test-tenant.ts
import { faker } from '@faker-js/faker';

export function createTestTenantId(): string {
  return `test-${faker.string.alphanumeric(8).toLowerCase()}`;
}

// In tests:
describe('Workflow API', () => {
  const tenantId = createTestTenantId(); // Unique per describe block

  afterAll(async () => {
    // Clean up all workflows for this test tenant
    await request(BASE_URL)
      .delete(`/api/v1/tenants/${tenantId}/workflows`)
      .set('X-Admin-Token', process.env.ADMIN_TOKEN!);
  });
});
```

---

## 14. Tool Selection Summary

| Category | Tool | Why Chosen |
|---|---|---|
| **Test Runner** | **Vitest** | Native TypeScript support, fast, compatible with ESM, good coverage tooling |
| **E2E Browser Tests** | **Playwright** | Explicitly mentioned in JD; multi-browser, stable, great for embedded components |
| **Accessibility (a11y)** | **@axe-core/playwright** | Automated WCAG 2.1 AA audits across host app, widget, and modal dialogs |
| **API Contract Tests** | **Pact JS** | Industry standard for Consumer-Driven Contract Testing; has broker for multi-team usage |
| **Kafka Event Tests** | **Pact JS (MessagePact) + kafkajs** | Same contract framework extended to async messages |
| **Kafka Partitioning** | **Murmur2 Hashing Algorithm** | Strict partition routing guarantee (`${tenantId}:${workflowId}`) for in-order delivery |
| **Integration HTTP Testing** | **Supertest / Fastify .inject()** | Lightweight, pairs naturally with Vitest, great for API integration testing |
| **Real Services in Tests** | **Testcontainers** | Spins up real Postgres/Kafka/Redis in Docker — no mocking needed |
| **Performance / Load** | **k6** | Multi-scenario load scripts, noisy-neighbor flood testing, Grafana native |
| **Static Analysis** | **TypeScript + ESLint** | Catches type/contract mismatches in test code before runtime |
| **Test Data** | **@faker-js/faker** | Realistic data generation; avoids hardcoded values |
| **CI Pipeline** | **GitHub Actions + CircleCI** | Both mentioned in JD; GHA for PR feedback, CircleCI for heavier test stages |
| **Deployment Verification** | **ArgoCD + Playwright smoke tests** | Post-deploy smoke test triggered by ArgoCD health check |

---

## 15. Risk-Based Testing Matrix

Based on the JD responsibilities and platform architecture:

| Risk | Severity | Test Layer | Tool / Test Suite | Frequency |
|---|---|---|---|---|
| Tenant data leakage | 🔴 Critical | Security + Integration | `postgres-rls.test.ts`, `tenant-isolation.test.ts` | Every PR |
| DB Connection Pool Context Poisoning | 🔴 Critical | Security | `postgres-pool-leak.test.ts` | Every PR |
| Kafka schema breaking change | 🔴 Critical | Event Contract | `workflow-events.consumer.pact.test.ts`, `schema-compatibility.test.ts` | Every PR |
| API contract broken for consumer | 🔴 Critical | API Contract | `workflow-api.consumer.pact.test.ts`, `workflow-api.provider.pact.test.ts` | Every PR |
| Event ordering failure / Race conditions | 🔴 Critical | Contract | `kafka-partition-ordering.contract.test.ts` (Murmur2) | Every PR |
| Noisy Neighbor / Platform DDoS | 🟠 High | Performance | `k6-noisy-neighbor.js` (429 Throttling) | Every release |
| Micro-frontend widget crashes host app | 🟠 High | E2E | `mfe-integration.spec.ts` (Playwright Error Boundary) | Every PR |
| Workflow SLA breach & missed escalation | 🟠 High | Unit / State Machine | `workflow-sla-escalation.test.ts` (Fake Timers) | Every PR |
| Broken Distributed Trace Waterfall | 🟠 High | Integration / Observability | `trace-waterfall.integration.test.ts` | Every PR |
| WCAG Accessibility Non-compliance | 🟡 Medium | E2E / a11y | `accessibility.spec.ts` (`@axe-core/playwright`) | Every PR |
| CI pipeline flakiness | 🟡 Medium | All layers | Vitest retries & Playwright tracing | Continuously |
| AI agent actor misbehaviour (future) | 🔵 Low-Future | E2E | Playwright | When AX features ship |

---

*Document prepared by the QA team for the Money Forward Workflow Platform.*

*Companion document: [`DEVELOPMENT.md`](./DEVELOPMENT.md) — Full Architecture Overview*

*Last updated: September 2026*
