# Workflow Platform — Gap Analysis

> **Purpose**: Documents the delta between the architectural intent ([`initial_analysis.md`](./initial_analysis.md)), the development plan ([`dev_readme.md`](./dev_readme.md) + [`development_plan.md`](./development_plan.md)), and the current live implementation.
>
> **Companion docs**: [`dev_readme.md`](./dev_readme.md) · [`test_readme.md`](./test_readme.md) · [`development_plan.md`](./development_plan.md)

---

## Table of Contents

1. [What Was Planned vs. What Was Built](#1-what-was-planned-vs-what-was-built)
2. [State Machine Delta](#2-state-machine-delta)
3. [API Routes Delta](#3-api-routes-delta)
4. [Kafka Event Schema Delta](#4-kafka-event-schema-delta)
5. [Database Schema Delta](#5-database-schema-delta)
6. [Infrastructure Delta](#6-infrastructure-delta)
7. [Making the Application Test-Ready](#7-making-the-application-test-ready)
8. [Test Implementation Steps](#8-test-implementation-steps)
9. [JD Alignment Gaps — What Would Make This a Stronger Candidate System](#9-jd-alignment-gaps--what-would-make-this-a-stronger-candidate-system)
10. [Money Forward (Nagoya) Staff/Senior QE JD Alignment & Scope of Improvement](#10-money-forward-nagoya-staffsenior-qe-jd-alignment--scope-of-improvement)

---

## 1. What Was Planned vs. What Was Built

### Services

| Service | Plan | Status | Notes |
|---|---|---|---|
| `workflow-api` | Core Fastify API + state machine | ✅ Complete | All CRUD + state transitions implemented |
| `notification-service` | Kafka consumer, log notifications | ✅ Complete | In-memory `notificationStore` for test inspection |
| `audit-service` | Kafka consumer + DB + REST endpoint | ✅ Complete | Idempotency via Postgres unique constraint |
| `workflow-widget` | React Web Component | 🟡 Scaffolded | Built but not fully integrated with live API |
| `host-app` | React host app with expense pages | 🟡 Scaffolded | UI present, full flow needs wiring |
| `packages/shared-types` | Shared TypeScript interfaces | ✅ Complete | Used across all services |
| `packages/shared-schemas` | Ajv JSON schemas | ✅ Complete | Validates every Kafka publish and consume |
| `packages/test-utils` | Factories + helpers | ✅ Complete | `event.factory.ts`, `workflow.factory.ts` |

### Technology Stack

| Dimension | Plan | Implementation | Match |
|---|---|---|---|
| Backend | Node.js + Fastify + TypeScript | Node.js + Fastify + TypeScript | ✅ |
| ORM | Drizzle ORM | Drizzle ORM | ✅ |
| Messaging | kafkajs | kafkajs | ✅ |
| Event format | JSON Schema (Ajv) | **CloudEvents 1.0** + JSON Schema | 🔄 Improved |
| Frontend | React + Vite + Custom Elements | React + Vite (scaffolded) | 🟡 |
| Database | PostgreSQL via Docker | PostgreSQL via Docker | ✅ |
| Schema Registry | Confluent Schema Registry (Docker) | **Missing from docker-compose.yml** | ❌ |
| CI/CD | GitHub Actions | `.github/workflows/` present | ✅ |

---

## 2. State Machine Delta

### Planned
```
[DRAFT] ──submit()──► [PENDING]
                           │
                  approve() / reject()
                           │
                [APPROVED] / [REJECTED]
```

### Implemented

```
              create()              submit()
[created] ──────────────► [DRAFT] ──────────► [PENDING]
                                                   │
                    ┌──────────────────────────────┤
               approve()                       reject()
                    │                              │
                    ▼                              ▼
              [APPROVED]                      [REJECTED]

[DRAFT | PENDING] ──cancel()──► [CANCELLED]
```

**Key Changes from Plan:**
- ✅ Explicit `/submit` step added — DRAFT is now a creation-only state before submission
- ✅ `CANCELLED` terminal state added (from DRAFT or PENDING)
- ✅ Invalid transitions return `422 INVALID_STATE_TRANSITION`
- ✅ Rejection requires a non-empty reason (enforced in service)
- ❌ No multi-step state (e.g., `PENDING_STEP_1`, `PENDING_STEP_2`) — single approver only

---

## 3. API Routes Delta

| Method | Path | Plan | Implemented | Status |
|---|---|---|---|---|
| `POST` | `/api/v1/workflows` | Create workflow | Create workflow (→ DRAFT) | ✅ |
| `GET` | `/api/v1/workflows` | List (tenant-scoped) | List (tenant-scoped, paginated) | ✅ |
| `GET` | `/api/v1/workflows/:id` | Get one | Get one | ✅ |
| `POST` | `/api/v1/workflows/:id/submit` | ❌ Not in plan | DRAFT → PENDING | 🆕 Added |
| `POST` | `/api/v1/workflows/:id/approve` | `PUT` in plan | Approve → APPROVED | 🔄 Method changed |
| `POST` | `/api/v1/workflows/:id/reject` | `PUT` in plan | Reject with reason → REJECTED | 🔄 Method changed |
| `POST` | `/api/v1/workflows/:id/cancel` | ❌ Not in plan | Cancel → CANCELLED | 🆕 Added |
| `GET` | `/health` | Health probe | ✅ Implemented | ✅ |
| `GET` | `/ready` | Readiness probe (DB + Kafka) | ❌ **Missing** | ❌ |
| `GET` | `/` | Not in plan | Service info endpoint | 🆕 Added |

**Response shape note**: All responses are wrapped as `{ success: boolean, data: {...} }` — this differs from the flat shapes in `dev_readme.md` and `test_readme.md` examples.

---

## 4. Kafka Event Schema Delta

| Dimension | Plan | Implementation |
|---|---|---|
| **Topic strategy** | Multiple topics: `workflow.created`, `workflow.approved`, ... | **Single topic `workflow.events`** |
| **Payload format** | Flat JSON object | **CloudEvents 1.0** envelope (`id`, `source`, `specversion`, `type`, `time`, `data`) |
| **Events defined** | `workflow.created`, `workflow.step.approved`, `workflow.approved`, `workflow.rejected` | `workflow.submitted.v1`, `workflow.approved.v1`, `workflow.rejected.v1`, `workflow.cancelled.v1` |
| **Partition key** | `tenantId:workflowId` | ✅ `tenantId:workflowId` |
| **Compression** | Not specified | ✅ GZIP |
| **Schema validation** | Before publish | ✅ `validateEvent()` runs before every `publishWorkflowEvent()` |
| **Step-level events** | `workflow.step.approved` (multi-step) | ❌ Not implemented |

**Actual event shape published to `workflow.events`:**
```json
{
  "id": "<uuid>",
  "source": "workflow-api",
  "specversion": "1.0",
  "type": "workflow.approved.v1",
  "time": "2026-09-17T15:30:00.000Z",
  "datacontenttype": "application/json",
  "data": {
    "workflowId": "wf-abc-123",
    "tenantId": "acme-corp",
    "type": "EXPENSE",
    "title": "Team offsite",
    "actorId": "mgr-456",
    "previousStatus": "PENDING",
    "currentStatus": "APPROVED",
    "timestamp": "2026-09-17T15:30:00.000Z"
  }
}
```

---

## 5. Database Schema Delta

### Plan defined

```sql
workflows(id, tenant_id, type, status, title, submitted_by, metadata, created_at, updated_at)
workflow_steps(id, workflow_id, tenant_id, approver, step_order, status, acted_by, acted_at, comment)
audit_logs(id, event_id, workflow_id, tenant_id, event_type, actor, payload, recorded_at)
```

### Actual implementation

**`workflow-api` — `workflow_db`**:

| Column | Plan | Implemented |
|---|---|---|
| `id`, `tenant_id`, `type`, `status`, `title`, `metadata`, `created_at`, `updated_at` | ✅ | ✅ |
| `amount`, `currency` | ❌ Not in plan | ✅ Added |
| `requester_id`, `requester_name` | ❌ Not in plan (`submitted_by` was planned) | ✅ Added (richer domain model) |
| `approver_id`, `rejection_reason`, `description` | ❌ Not in plan | ✅ Added |
| `workflow_steps` table | ✅ Planned | ❌ **Not implemented** |

**`audit-service` — `audit_db`**: `audit_events` table — equivalent to planned `audit_logs`, with CloudEvents `id` as the idempotency key.

---

## 6. Infrastructure Delta

| Component | Plan | Actual | Status |
|---|---|---|---|
| PostgreSQL (port 5432) | ✅ | Port **5433** exposed externally | ✅ |
| Zookeeper | ✅ | ✅ | ✅ |
| Kafka | ✅ | Dual listeners: `9092` (external), `29092` (internal) | ✅ |
| **Schema Registry** (port 8081) | ✅ | ❌ **Not in docker-compose.yml** | ❌ |
| Kafka UI | ✅ (port 8080) | ✅ Port **8085** | ✅ |
| Pact Broker | ✅ (port 9292) | ✅ | ✅ |
| `workflow-api` in compose | ✅ | ❌ Runs via `npm run dev` only | ❌ |
| `notification-service` in compose | ✅ | ❌ | ❌ |
| `audit-service` in compose | ✅ | ❌ | ❌ |
| `host-app` in compose | ✅ | ❌ | ❌ |

> [!WARNING]
> Application services have individual `Dockerfile`s but are **not wired into `docker-compose.yml`**. Only infrastructure services run in compose. This means the full stack cannot be started with a single `docker compose up` command, which blocks CI integration tests and E2E tests.

---

## 7. Making the Application Test-Ready

> **Priority focus**: These are infrastructure and application changes — not test code — that must be in place before any test layer can reliably run.

---

### 7.1 Wire Application Services into Docker Compose

**Why**: Without this, Layers 4 (integration), 5 (E2E), 6 (performance), and 7 (security) cannot start reliably in CI. The Playwright config at [`playwright.config.ts`](./playwright.config.ts) already expects services on ports 3000, 3001, 3002, and 5173 — they need to be startable from compose.

Add to [`docker-compose.yml`](./docker-compose.yml):

```yaml
  workflow-api:
    build: ./services/workflow-api
    container_name: workflow-api
    ports:
      - "3000:3000"
    environment:
      PORT: 3000
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/workflow_db
      KAFKA_BROKERS: kafka:29092
    depends_on:
      postgres: { condition: service_healthy }
      kafka:    { condition: service_healthy }

  notification-service:
    build: ./services/notification-service
    container_name: workflow-notification
    ports:
      - "3001:3001"
    environment:
      KAFKA_BROKERS: kafka:29092
      KAFKA_GROUP_ID: notification-service-group
    depends_on: [kafka]

  audit-service:
    build: ./services/audit-service
    container_name: workflow-audit
    ports:
      - "3002:3002"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/audit_db
      KAFKA_BROKERS: kafka:29092
      KAFKA_GROUP_ID: audit-service-group
    depends_on:
      postgres: { condition: service_healthy }
      kafka:    { condition: service_healthy }

  host-app:
    build: ./apps/host-app
    container_name: workflow-host-app
    ports:
      - "5173:5173"
    environment:
      VITE_API_BASE_URL: http://workflow-api:3000
    depends_on: [workflow-api]
```

Also add Kafka health check so `depends_on` works reliably:
```yaml
  kafka:
    healthcheck:
      test: ["CMD-SHELL", "kafka-topics --bootstrap-server kafka:29092 --list"]
      interval: 10s
      timeout: 10s
      retries: 10
      start_period: 30s
```

---

### 7.2 Add Schema Registry to Docker Compose

**Why**: The `packages/shared-schemas` validator already uses Ajv locally. Schema Registry is needed for `tests/contract/schema/` registry round-trip tests and the CI schema compatibility gate.

Add to [`docker-compose.yml`](./docker-compose.yml):

```yaml
  schema-registry:
    image: confluentinc/cp-schema-registry:7.6.0
    container_name: workflow-schema-registry
    depends_on:
      kafka: { condition: service_healthy }
    ports:
      - "8081:8081"
    environment:
      SCHEMA_REGISTRY_HOST_NAME: schema-registry
      SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: PLAINTEXT://kafka:29092
      SCHEMA_REGISTRY_LISTENERS: http://0.0.0.0:8081
```

---

### 7.3 Add `GET /ready` Readiness Endpoint to `workflow-api`

**Why**: Testcontainers, Docker Compose `healthcheck`, and Playwright's `webServer.url` all need a reliable readiness signal before tests start hitting the API. Without this, tests get race-condition failures on startup.

Add to [`workflow.routes.ts`](./services/workflow-api/src/routes/workflow.routes.ts):

```typescript
fastify.get('/ready', async (_, reply) => {
  try {
    // Verify DB is reachable
    await db.execute(sql`SELECT 1`);
    return reply.send({
      status: 'ready',
      db: 'ok',
      kafka: eventProducer.isConnected ? 'ok' : 'degraded',
    });
  } catch (err) {
    return reply.status(503).send({ status: 'not ready', error: (err as Error).message });
  }
});
```

Also add the Docker Compose health check for `workflow-api`:
```yaml
  workflow-api:
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/ready || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

---

### 7.4 Standardise API Response Shape

**Why**: `test_readme.md` integration test examples expect flat responses (e.g. `create.body.workflowId`). The implementation wraps everything in `{ success: true, data: { id, ... } }`. Every test that uses `supertest` or `axios` against the real API will fail unless this is documented clearly and test examples are aligned.

**Decision — two options:**

**Option A** *(recommended)*: Keep `{ success, data }` wrapper (more robust for error handling) and update all test examples in `test_readme.md` to match:
```typescript
// Correct for current implementation:
const workflowId = create.body.data.id;   // not create.body.workflowId
```

**Option B**: Add a `?envelope=false` query param for test clients that want flat responses.

---

### 7.5 Fix Port Mismatch: `workflow-api` on Port 3000 vs. 3001

**Why**: The [`playwright.config.ts`](./playwright.config.ts) `webServer` block starts `npm run dev:api` on port **3000**, but the development plan and `test_readme.md` integration test examples point at **`http://localhost:3001`**. The k6 script defaults to port `3000`. This inconsistency will cause tests to fail silently.

**Fix**: Standardise on port **3000** for `workflow-api` across all configs and test docs:
- [`playwright.config.ts`](./playwright.config.ts) — already uses 3000 ✅
- [`k6-workflow-load.js`](./tests/perf/k6-workflow-load.js) — already uses 3000 via `API_URL` ✅
- [`test_readme.md`](./test_readme.md) integration examples — reference port 8080/3001, need updating

---

### 7.6 Add ESLint and Prettier Configuration

**Why**: The project has TypeScript configured but no ESLint or Prettier. Without linting, async/await bugs (missed `await`, floating promises) won't be caught until runtime — especially painful in test code.

```bash
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier eslint-config-prettier
```

Create `.eslintrc.json` at repo root:
```json
{
  "parser": "@typescript-eslint/parser",
  "parserOptions": { "project": "./tsconfig.base.json" },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "no-console": "warn"
  }
}
```

---

### 7.7 Strengthen TypeScript Strictness

**Why**: Two flags catch the most common test-code bugs. Neither is currently enabled in [`tsconfig.base.json`](./tsconfig.base.json).

```json
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

`noUncheckedIndexedAccess` forces `steps[0]?.approver` instead of `steps[0].approver` — prevents test factories from silently producing `undefined`.

---

### 7.8 Add `X-Correlation-ID` Propagation

**Why**: When running integration or E2E tests, you need to trace a specific test's requests through API logs and Kafka events. Without a correlation ID, debugging a failing test in CI requires guesswork.

Update [`tenant.middleware.ts`](./services/workflow-api/src/middleware/tenant.middleware.ts):
```typescript
import { v4 as uuidv4 } from 'uuid';

// Add to FastifyRequest declaration:
interface FastifyRequest {
  correlationId: string;
}

// In middleware:
request.correlationId = (request.headers['x-correlation-id'] as string) || uuidv4();
```

Pass `correlationId` through to Kafka event headers and log lines.

---

### 7.9 Add Admin Cleanup Endpoint for Test Data Teardown

**Why**: `test_readme.md` §13 specifies that each test creates its own data and **cleans up in `afterAll`**. Without a delete endpoint, tests accumulate data across runs, causing false positives in list/count assertions.

```typescript
// Protected by X-Admin-Token header
fastify.delete('/api/v1/admin/tenants/:tenantId/workflows', async (request, reply) => {
  const adminToken = request.headers['x-admin-token'];
  if (adminToken !== process.env.ADMIN_TOKEN) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  await db.delete(workflows).where(eq(workflows.tenantId, request.params.tenantId));
  return reply.send({ success: true, deleted: true });
});
```

---

## 8. Test Implementation Steps

> The steps in this section are **test code** to write once the application is ready (§7 above completed). They are ordered by the test pyramid — cheapest layers first.

---

### 8.1 Layer 0 — Static Analysis

Add to `.github/workflows/test.yml`:
```yaml
- name: Type Check
  run: npx tsc --noEmit
- name: Lint
  run: npx eslint 'services/**/*.ts' 'packages/**/*.ts' 'tests/**/*.ts'
```

---

### 8.2 Layer 1 — Expand Unit Tests

Current: 4 tests in [`tests/unit/workflow.state-machine.test.ts`](./tests/unit/workflow.state-machine.test.ts).

Add:
- `cancel()` from DRAFT and PENDING → CANCELLED
- `cancel()` from APPROVED → throws `INVALID_STATE_TRANSITION`
- Factory unit tests in `tests/unit/factories.test.ts`
- Schema validator error message tests in `tests/unit/schema-validator.test.ts`

---

### 8.3 Layer 2 — API Contract Tests (Pact)

**Not yet implemented.** These are the highest-value missing tests.

```bash
npm install -D @pact-foundation/pact supertest @types/supertest
```

Create:
- `tests/contract/api/workflow-api.consumer.pact.ts` — consumer contract (important: response has `{ success, data }` wrapper and `id` not `workflowId`)
- `tests/contract/api/workflow-api.provider.pact.ts` — provider verification (with `stateHandlers` that seed DRAFT workflows)

Key difference from `test_readme.md` examples — the create response returns `DRAFT` not `PENDING`:
```typescript
.willRespondWith({
  status: 201,
  body: { success: like(true), data: { id: uuid(), status: string('DRAFT') } }
})
```

---

### 8.4 Layer 3a — Kafka Event Contracts (Pact MessagePact)

**Not yet implemented.**

Create `tests/contract/kafka/workflow-events.consumer.pact.ts`.

Key difference from `test_readme.md` examples — events use the **CloudEvents 1.0 envelope**:
```typescript
.withContent({
  id:           uuid(),
  source:       string('workflow-api'),
  specversion:  string('1.0'),
  type:         string('workflow.approved.v1'),
  data: {
    workflowId:     uuid(),
    tenantId:       string(),
    currentStatus:  string('APPROVED'),
    previousStatus: string('PENDING'),
  }
})
```

---

### 8.5 Layer 3b — Schema Registry Compatibility Gate

After adding Schema Registry to compose (§7.2):

```bash
npm install -D @kafkajs/confluent-schema-registry
```

Create `tests/contract/schema/registry.schema.test.ts` and `.github/workflows/schema-compatibility.yml` — triggers on changes to `packages/shared-schemas/src/**`.

---

### 8.6 Layer 4 — Supertest API Integration Tests

**Not yet implemented** (only Kafka consumer integration tests exist).

Create `tests/integration/api/workflow-api.integration.test.ts`:

```typescript
// Full lifecycle: create → submit → approve → verify audit
const create = await request('http://localhost:3000')
  .post('/api/v1/workflows')
  .set('x-tenant-id', 'tenant-x').set('x-user-id', 'user-1')
  .send({ title: 'Office supplies', type: 'EXPENSE' })
  .expect(201);

const id = create.body.data.id;   // ← note: .data.id not .workflowId

await request('http://localhost:3000')
  .post(`/api/v1/workflows/${id}/submit`)
  .set('x-tenant-id', 'tenant-x').set('x-user-id', 'user-1')
  .expect(200);

await request('http://localhost:3000')
  .post(`/api/v1/workflows/${id}/approve`)
  .set('x-tenant-id', 'tenant-x').set('x-user-id', 'mgr-1')
  .expect(200);
```

Create `tests/integration/api/tenant-isolation.test.ts` — cross-tenant 404 matrix.

---

### 8.7 Layer 5 — Playwright E2E (Expand)

Current: 2 scenarios in [`tests/e2e/workflow-lifecycle.spec.ts`](./tests/e2e/workflow-lifecycle.spec.ts).

Add:
- `tests/e2e/widget-embedding.spec.ts` — verify widget renders without console errors in host app
- Firefox project in [`playwright.config.ts`](./playwright.config.ts)
- JUnit reporter (`['junit', { outputFile: 'test-results/e2e.xml' }]`) for CI artifact upload

---

### 8.8 Layer 6 — k6 Performance (Expand)

Current: [`tests/perf/k6-workflow-load.js`](./tests/perf/k6-workflow-load.js) — basic ramp-up.

Add:
- Named `scenarios` with `ramping-vus` executor and Trend metrics
- `tests/perf/kafka-retry-storm.k6.js` — 1000 events/second to test consumer lag

---

### 8.9 Layer 7 — Security / Tenant Isolation Test Suite

**Not yet a dedicated test file.** Create `tests/security/tenant-isolation.test.ts` with the full cross-tenant matrix:
```typescript
const TENANTS = ['tenant-alpha', 'tenant-beta', 'tenant-gamma'];

for (const ownerTenant of TENANTS) {
  for (const attackerTenant of TENANTS.filter(t => t !== ownerTenant)) {
    it(`${attackerTenant} cannot read ${ownerTenant} workflows`, ...)
    it(`${attackerTenant} cannot list ${ownerTenant} workflows`, ...)
    it(`${attackerTenant} cannot approve ${ownerTenant} workflow`, ...)
  }
}
```

---

## 9. JD Alignment Gaps — What Would Make This a Stronger Candidate System

> The [`dev_readme.md`](./dev_readme.md) describes the real Money Forward Workflow Platform with specific capabilities mentioned in the JD. The current implementation is a simplified but structurally authentic proxy. These gaps represent what would need to be built to make it a **production-grade platform** as described in the JD.

---

### 9.1 Multi-Step Approval Chains (High Impact)

**JD reference**: *"Multi-step delegation and permission-based approval chains"*, *"Dynamic Route Evaluator"*

**Current**: Single approver only. Workflow goes `DRAFT → PENDING → APPROVED/REJECTED` with one actor.

**What's needed**:
- `workflow_steps` table with `step_order`, `approver`, `status`, `acted_by`, `acted_at`
- State machine advances step-by-step: `PENDING_STEP_1 → PENDING_STEP_2 → FULLY_APPROVED`
- Step-level Kafka events: `workflow.step.approved.v1`, `workflow.step.rejected.v1`
- Dynamic approver routing (e.g., rule: *"if amount > ¥500,000, require CFO approval"*)

**Why it matters for QE**: Multi-step chains create the most interesting edge cases — out-of-order approvals, race conditions when two approvers act simultaneously, and step escalation.

---

### 9.2 Transactional Outbox Pattern (High Impact)

**JD reference**: *"Outbox Pattern / Exactly-Once / At-Least-Once Delivery"*

**Current**: Workflow state is saved to DB first, then Kafka is published in the same code block. If Kafka goes down between the DB write and the publish call, the event is silently lost.

**What's needed**:
- `outbox_events` table in `workflow_db`
- Every state transition writes a row to `outbox_events` inside the **same DB transaction** as the workflow update
- A separate relay process reads unpublished outbox rows and publishes them to Kafka
- On successful Kafka ack, mark the outbox row as `published`

**Why it matters for QE**: This is the primary resilience test surface. Chaos tests that kill Kafka mid-write should still produce eventual consistency — the outbox relay retries automatically.

---

### 9.3 Delegation Logic

**JD reference**: *"Delegation: If the CFO is on leave, route to the Acting Deputy"*

**Current**: No delegation concept exists. Approvers are static UUIDs assigned at workflow creation.

**What's needed**:
- `delegations` table: `(delegator_id, delegate_id, valid_from, valid_until, tenant_id)`
- Route Evaluator checks active delegations before assigning the next approver
- Delegation loop detection (A delegates to B, B delegates to A → error)

**Why it matters for QE**: Boundary value tests on delegation validity periods and circular delegation detection are key interview-relevant test scenarios from the JD.

---

### 9.4 Real Multi-Tenancy Hardening

**JD reference**: *"Multi-Tenant Data Isolation Engine"*, *"Leaky Caches"*, *"Kafka Message Isolation"*

**Current**: Tenant isolation is correctly implemented at the DB query level. No additional hardening layers exist.

**What would elevate it**:
- Row-level security enforced at the PostgreSQL level (`CREATE POLICY`) as a defence-in-depth layer, so even a developer mistake in application code cannot leak data
- Kafka consumer validates `tenantId` in event payload matches the expected consumer context
- Audit-service verifies that each `audit_event` row's `tenantId` matches the workflow it references (cross-reference check)

---

### 9.5 Workflow Template / Configuration API

**JD reference**: *"The host product registers its workflow via the platform's REST API: 'Create workflow template for Invoices: If total > ¥1M, route to Manager → Director → CFO'"*

**Current**: Workflow type, steps, and approvers are supplied at creation time by the caller. There is no pre-registered template system.

**What's needed**:
- `workflow_templates` table: defines named routing rules per workflow type per tenant
- `POST /api/v1/templates` — product teams register their approval rules once
- `POST /api/v1/workflows` — caller supplies only `type` + `payload`; the engine evaluates the template to determine steps dynamically

**Why it matters for QE**: Template versioning, backward compatibility of template changes mid-workflow, and tenant-scoped template isolation are rich testing surfaces.

---

### 9.6 Immutable Audit Log Hardening

**JD reference**: *"Tamper Proofing: Can any API or internal user update or delete an existing audit log entry?"*

**Current**: Audit events are stored in `audit_events` with a unique `id`. No PostgreSQL-level protection against deletion or update exists.

**What would elevate it**:
- PostgreSQL `REVOKE UPDATE, DELETE ON audit_events FROM workflow_app_user;` — application user cannot mutate audit rows at the DB level
- Expose `GET /api/v1/audit/:workflowId` with tenant-scoped read-only access
- Add a tamper-proof hash chain (each row's hash includes the previous row's hash — like a blockchain for compliance)

---

### 9.7 Observability / OpenTelemetry

**JD reference**: *"Cloud-native performance analysis. Experience combining load-testing results with metrics, logs, and traces from Kubernetes-based systems"*

**Current**: Services use `console.log` for logging. No structured logs, no traces, no metrics.

**What's needed**:
- Structured JSON logging with `pino` (Fastify's native logger)
- `X-Correlation-ID` propagation through all services (§7.8 above)
- OpenTelemetry SDK for distributed tracing (span per API request, Kafka publish, DB query)
- Prometheus metrics endpoint (`/metrics`) — request rate, p95 latency, Kafka consumer lag

**Why it matters for QE**: The JD explicitly calls for combining load test results with Kubernetes metrics and distributed traces. Without observability, performance tests produce numbers but no root-cause insight.

---

### 9.8 Micro-Frontend Full Integration

**JD reference**: *"Micro-frontend integration testing"*, *"Embeddable React widgets"*

**Current**: `workflow-widget` and `host-app` are scaffolded but the widget is not fully wired to the live API. The Playwright E2E tests reference `data-testid` selectors that assume a complete UI.

**What's needed**:
- `workflow-widget` fully polls `GET /api/v1/workflows/:id` and renders live status
- Approve/Reject buttons in widget call the API directly with tenant/user context
- Widget registered as a proper `customElements.define('workflow-widget', ...)` Web Component
- `host-app` loads the widget JS bundle and embeds it on the expense detail page

---

### 9.9 CI/CD Pipeline — Full 5-Stage Pipeline

**JD reference**: *"CI/CD pipeline. CircleCI, GitHub Actions, ArgoCD"*

**Current**: `.github/workflows/` directory exists but pipeline stages are not fully defined.

**What's needed** (from `test_readme.md` §11):

```
Stage 1 (< 5 min):   tsc + ESLint + Vitest unit + schema compat
Stage 2 (< 10 min):  Pact consumer contracts + Kafka MessagePact
Stage 3 (< 15 min):  Supertest integration + tenant isolation matrix
Stage 4 (< 20 min):  Playwright E2E (main branch only)
Stage 5 (release):   k6 performance + security isolation matrix
```

---

### Summary: Gaps by Priority

| Gap | JD Alignment | Effort | Priority |
|---|---|---|---|
| Multi-step approval chains | 🔴 Core feature of the JD | High | 1 |
| Transactional Outbox pattern | 🔴 Explicitly named in JD | Medium | 2 |
| Full 5-stage CI/CD pipeline | 🔴 JD mentions CircleCI + ArgoCD | Low | 3 |
| Micro-frontend full integration | 🟠 JD focuses on MFE testing | Medium | 4 |
| Delegation logic | 🟠 JD's Dynamic Route Evaluator | High | 5 |
| OpenTelemetry observability | 🟠 JD: combine load tests + traces | Medium | 6 |
| Workflow template / config API | 🟠 JD: product teams register rules | High | 7 |
| Immutable audit log hardening | 🟡 JD: tamper-proof audit trails | Low | 8 |
| PostgreSQL row-level security | 🟡 Defence-in-depth isolation | Low | 9 |

---

## 10. Money Forward (Nagoya) Staff/Senior QE JD Alignment & Scope of Improvement

> **Reference**: [Senior Quality Engineer, Workflow Platform, Nagoya at Money Forward in Japan](https://japan-dev.com/jobs/money-forward/money-forward-staff-quality-engineer-workflow-platform-nagoya-w8wrbo)  
> **Role Scope**: Staff IC leading quality engineering for a shared workflow & approval platform used across Money Forward SaaS products (e.g. Cloud Expense, Invoice, Payroll).

### 10.1 Alignment Scorecard

| Dimension | Money Forward JD Requirement | Current Implementation Status | Alignment Score |
|---|---|---|:---:|
| **Platform Architecture** | Multi-tenant shared workflow platform for B2B SaaS products | Fastify microservices (`workflow-api`, `notification-service`, `audit-service`), Kafka, PostgreSQL | 🟢 **85%** |
| **Workflow Engine Domain** | Approval routing, multi-step chains, delegation, financial thresholds, immutable audit trails | Single-approver state machine (`DRAFT → PENDING → APPROVED/REJECTED/CANCELLED`) | 🟡 **50%** |
| **Micro-Frontend (MFE)** | Embeddable React widget integrated into host applications | Scaffolded React Web Component (`workflow-widget`) + `host-app` | 🟡 **55%** |
| **Distributed Resilience** | Event-driven contracts, delivery semantics, idempotency, failure recovery | CloudEvents 1.0, consumer idempotency table, schema validation | 🟢 **70%** |
| **Performance & Observability** | Load testing + Kubernetes telemetry + OpenTelemetry distributed tracing | k6 script present, K8s manifests present, but lacking OTel trace propagation | 🟡 **45%** |
| **CI/CD Quality Gates** | Multi-stage CI pipeline, contract verification, release readiness | GitHub Actions with unit/lint/integration, but lacks staged quality gates & Pact broker | 🟡 **60%** |
| **AI Transformation (AX)** | AI-driven QA, autonomous digital workers / approval assistants | Not yet implemented | 🔴 **10%** |

---

### 10.2 Architectural & Functional Gaps (FinTech SaaS Reality)

#### 1. Multi-Step & Threshold-Based Approval Chains
* **Money Forward Context**: Products like *Money Forward Cloud Expense* enforce tiered corporate approval rules based on amount thresholds (e.g., `< ¥10,000` = Team Lead only, `¥10,000 - ¥100,000` = Dept Manager, `> ¥100,000` = Finance Director).
* **Current State**: Workflows have single-step approval only.
* **Scope of Improvement**:
  - Implement multi-stage states (`PENDING_L1`, `PENDING_L2`, `APPROVED`).
  - Introduce payload-driven routing rule evaluation.
  - Add test suites for partial approvals, rejection step rollback, and conditional step skips.

#### 2. Out-of-Office Delegation & Proxy Approvers
* **Money Forward Context**: Corporate users designate temporary proxy approvers with explicit time windows and audit attribution.
* **Current State**: Workflows only validate direct approver IDs.
* **Scope of Improvement**:
  - Implement delegation mapping with expiry (`valid_until`).
  - Add security test matrix ensuring proxy approvers cannot act outside their delegated scope or cross tenant boundaries.

#### 3. Transactional Outbox Pattern for Dual-Write Consistency
* **Money Forward Context**: The JD specifically requires resilience against partial failures in event-driven systems.
* **Current State**: State written to DB followed by direct `kafka.send()`. If the process crashes or Kafka is temporarily unavailable, state drift occurs.
* **Scope of Improvement**:
  - Write events to an `outbox` table in the same Postgres transaction.
  - Implement an outbox publisher / CDC worker with at-least-once delivery guarantees.
  - Add resilience/chaos tests verifying recovery when Kafka dies between DB write and dispatch.

---

### 10.3 Micro-Frontend (MFE) Testing & Integration

#### 1. Web Component Custom Events Protocol
* **Money Forward Context**: The platform provides embeddable React widgets consumed by diverse SaaS host applications.
* **Current State**: React widget scaffolded; boundary communication is not fully wired.
* **Scope of Improvement**:
  - Standardize Custom Events across Shadow DOM boundaries (`workflow:approved`, `workflow:state-changed`).
  - Create Playwright tests validating host app reactivity without full page reload.
  - Implement CSS isolation and token injection validation.

---

### 10.4 Cloud-Native Observability & Chaos Engineering

#### 1. OpenTelemetry Distributed Tracing (W3C TraceContext)
* **Money Forward Context**: The JD highlights combining load testing with metrics, logs, and traces from Kubernetes to find bottlenecks.
* **Current State**: Plain console logs without trace propagation across Kafka headers.
* **Scope of Improvement**:
  - Inject OpenTelemetry SDK into all services.
  - Propagate `traceparent` and `X-Correlation-ID` across HTTP and Kafka record headers.
  - Correlate k6 load test client spans with server-side DB queries and Kafka consumer lag.

#### 2. Chaos & Failure Mode Validation
* **Scope of Improvement**:
  - Automate Kafka broker partition rebalancing / disconnect tests.
  - Implement Dead Letter Queue (DLQ) routing for corrupted/poison-pill payloads.
  - Test exponential backoff with jitter to eliminate thundering herd risks on service restarts.

---

### 10.5 AI Transformation (Money Forward AX Vision) Alignment

Money Forward is shifting *"from Cloud to AI"* to create "Digital Workers" (autonomous AI agents executing back-office tasks):

1. **AI Agent Approval Verification Suite**:
   - Automated integration tests for autonomous AI approval agents (verifying high-confidence standard expenses are approved automatically while borderline items escalate to human review).
2. **Synthetic Multi-Tenant Test Data Generator**:
   - Automated generation of realistic multi-tenant expense hierarchies, receipts, and edge-case amounts.
3. **LLM-Assisted Flaky Test Triage**:
   - CI utility that analyzes test run artifacts and categorizes failure root causes (system defect vs. network timing vs. environmental flake).

---

### 10.6 Prioritized Implementation Roadmap

1. **Phase 1 (Core Engine & Resilience)**: Multi-step approval chain + Transactional Outbox pattern + DLQ handling.
2. **Phase 2 (Observability & Perf)**: OpenTelemetry trace propagation across HTTP & Kafka + k6 trace correlation.
3. **Phase 3 (MFE & Playwright)**: Custom Event protocol + Shadow DOM Playwright E2E suite.
4. **Phase 4 (CI/CD Quality Gates)**: Staged GitHub Actions workflow + automated release-readiness report generation.
5. **Phase 5 (AI Transformation Showcase)**: AI Agent routing test scenarios & synthetic test data generation.

---

*Last updated: September 2026*

*Companion documents: [`dev_readme.md`](./dev_readme.md) · [`test_readme.md`](./test_readme.md) · [`development_plan.md`](./development_plan.md)*
