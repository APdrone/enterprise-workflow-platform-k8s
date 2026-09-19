# Workflow Platform — JS/TS Development Plan

> **Purpose**: Build a JS/TS equivalent of the Money Forward Workflow Platform — enough to run every test layer defined in [`test_readme.md`](./test_readme.md).
>
> **Companion Docs**: [`dev_readme.md`](./dev_readme.md) (Architecture) | [`test_readme.md`](./test_readme.md) (Test Strategy)

---

## Table of Contents

1. [What We Are Building & Why](#1-what-we-are-building--why)
2. [Technology Mapping (Kotlin → JS/TS)](#2-technology-mapping-kotlin--jsts)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Service-by-Service Design](#4-service-by-service-design)
   - 4a. [workflow-api (Core Backend)](#4a-workflow-api--core-backend)
   - 4b. [notification-service (Kafka Consumer)](#4b-notification-service--kafka-consumer)
   - 4c. [audit-service (Kafka Consumer)](#4c-audit-service--kafka-consumer)
   - 4d. [workflow-widget (React Micro-Frontend)](#4d-workflow-widget--react-micro-frontend)
   - 4e. [host-app (React Host Application)](#4e-host-app--react-host-application)
5. [API Contract Definitions](#5-api-contract-definitions)
6. [Kafka Topics & Event Schemas](#6-kafka-topics--event-schemas)
7. [Database Schema (PostgreSQL)](#7-database-schema-postgresql)
8. [Multi-Tenancy Design](#8-multi-tenancy-design)
9. [Infrastructure — Docker Compose](#9-infrastructure--docker-compose)
10. [Development Phases](#10-development-phases)
11. [Test Coverage Mapping](#11-test-coverage-mapping)
12. [Project Bootstrap Commands](#12-project-bootstrap-commands)

---

## 1. What We Are Building & Why

We are building a **simplified but structurally authentic** Workflow Platform using Node.js / TypeScript. It must be:

- **Real enough to break** — real Kafka, real PostgreSQL, real HTTP, real micro-frontend embedding
- **Simple enough to run locally** — Docker Compose brings up the whole stack in one command
- **Test-instrumented** — every component is designed with testability in mind from day one

### What it does (functionally)

A user from a **product team's host app** can:
1. Submit an expense/document for approval
2. A manager approves or rejects it
3. Other services (notification, audit) react to those events
4. The embedded approval widget shows live status

This is enough surface area to exercise **every layer** of our test pyramid.

### What we are deliberately NOT building

| Skipped | Reason |
|---|---|
| Real email / SMS notifications | Replaced by in-memory log — still Kafka consumer |
| OAuth / real SSO | Simple JWT-like token with `tenantId` in header |
| Kubernetes deployment | Docker Compose is enough for test purposes |
| Terraform IaC | Not needed for local testing |
| Real AWS services | Local equivalents via Docker (Kafka, Postgres, Schema Registry) |

---

## 2. Technology Mapping (Kotlin → JS/TS)

| Original (Money Forward) | Our JS/TS Equivalent | Why |
|---|---|---|
| Kotlin + Spring Boot | **Node.js + Fastify** | Fastest TS web framework; excellent plugin ecosystem |
| Spring Data / JPA | **Drizzle ORM** | TypeScript-native, lightweight, great with Postgres |
| Apache Kafka | **Apache Kafka + kafkajs** | Same Kafka — only the client library changes |
| Confluent Schema Registry | **Confluent Schema Registry (Docker)** | Same infrastructure, different Node.js client |
| React (micro-frontends) | **React + Vite + Custom Elements** | Same React; Vite for fast builds; Web Components for embedding |
| AWS RDS (PostgreSQL) | **PostgreSQL (Docker)** | Identical SQL dialect |
| Kubernetes | **Docker Compose** | Same isolation concepts, simpler local setup |
| ArgoCD | **Not needed (local only)** | CI/CD for local dev not required |
| CircleCI / GitHub Actions | **GitHub Actions (for tests)** | CI pipeline for automated test runs |

---

## 3. Monorepo Structure

We use an **npm workspaces monorepo** — no external monorepo tool needed.

```
workflow-platform/                        <- repo root
│
├── package.json                          <- workspace root (npm workspaces)
├── docker-compose.yml                    <- brings up ALL infrastructure
├── docker-compose.test.yml               <- test-specific overrides
├── .env.example                          <- environment variable template
├── .github/
│   └── workflows/
│       ├── test.yml                      <- main CI pipeline
│       └── schema-compatibility.yml     <- schema gate
│
├── packages/
│   ├── shared-types/                     <- shared TypeScript interfaces
│   │   ├── package.json
│   │   └── src/
│   │       ├── workflow.types.ts         <- Workflow, WorkflowStep, etc.
│   │       ├── events.types.ts           <- Kafka event payload types
│   │       └── api.types.ts              <- API request/response types
│   │
│   ├── shared-schemas/                   <- Shared JSON Schemas (for Ajv)
│   │   ├── package.json
│   │   └── src/
│   │       ├── workflow-created.schema.ts
│   │       ├── workflow-approved.schema.ts
│   │       └── workflow-rejected.schema.ts
│   │
│   └── test-utils/                       <- Shared test helpers & factories
│       ├── package.json
│       └── src/
│           ├── factories/
│           │   ├── workflow.factory.ts
│           │   └── tenant.factory.ts
│           ├── setup/
│           │   ├── containers.ts         <- Testcontainers setup
│           │   └── kafka-helpers.ts
│           └── correlation.ts
│
├── services/
│   ├── workflow-api/                     <- Core backend (Fastify + PostgreSQL + Kafka)
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── server.ts                 <- Fastify app entry point
│   │   │   ├── routes/
│   │   │   │   └── workflows.routes.ts
│   │   │   ├── handlers/
│   │   │   │   └── workflow.handler.ts
│   │   │   ├── db/
│   │   │   │   ├── schema.ts             <- Drizzle ORM schema
│   │   │   │   └── migrations/
│   │   │   ├── kafka/
│   │   │   │   └── producer.ts
│   │   │   ├── middleware/
│   │   │   │   └── tenant.middleware.ts  <- X-Tenant-ID extraction
│   │   │   └── plugins/
│   │   │       └── db.plugin.ts
│   │   └── tests/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── contracts/
│   │
│   ├── notification-service/             <- Kafka consumer (logs notifications)
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── consumer.ts
│   │       └── handlers/
│   │           ├── workflow-created.handler.ts
│   │           └── workflow-approved.handler.ts
│   │
│   └── audit-service/                   <- Kafka consumer (immutable audit log)
│       ├── package.json
│       ├── Dockerfile
│       └── src/
│           ├── consumer.ts
│           ├── db/
│           │   └── schema.ts             <- audit_logs table
│           └── handlers/
│               └── audit.handler.ts
│
├── apps/
│   ├── workflow-widget/                  <- React micro-frontend
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── main.tsx                  <- Web Component registration
│   │       ├── WorkflowWidget.tsx        <- Root component
│   │       ├── components/
│   │       │   ├── StatusBadge.tsx
│   │       │   ├── ApprovalForm.tsx
│   │       │   └── WorkflowTimeline.tsx
│   │       └── api/
│   │           └── workflow.client.ts    <- calls workflow-api
│   │
│   └── host-app/                        <- React host app (simulates product team)
│       ├── package.json
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── pages/
│           │   ├── ExpensePage.tsx       <- Embeds workflow-widget
│           │   └── ApprovalsPage.tsx
│           └── components/
│               └── WorkflowWidgetEmbed.tsx
│
└── tests/                               <- Cross-service tests (live outside services)
    ├── contracts/
    │   ├── consumer/                    <- Pact consumer contracts
    │   └── provider/                   <- Pact provider verification
    ├── schema/                          <- Ajv + Registry schema tests
    ├── integration/                     <- Cross-service integration tests
    ├── e2e/                             <- Playwright E2E tests
    ├── performance/                     <- k6 scripts
    └── security/                        <- Tenant isolation tests
```

---

## 4. Service-by-Service Design

---

### 4a. `workflow-api` — Core Backend

**Stack**: Node.js 22 + Fastify 5 + Drizzle ORM + PostgreSQL + kafkajs

**Responsibilities**:
- Expose REST API for workflow CRUD operations
- Enforce tenant isolation on every request
- Manage the workflow state machine
- Publish Kafka events on every state transition
- Provide API health/readiness endpoints for testing

**State Machine**:
```
                   submit()
[DRAFT] ──────────────────────────► [PENDING]
                                        │
                              ┌─────────┴──────────┐
                         approve()             reject()
                              │                     │
                              ▼                     ▼
                         [APPROVED]            [REJECTED]
```

**Environment Variables**:
```env
PORT=3001
DATABASE_URL=postgresql://user:pass@localhost:5432/workflow_db
KAFKA_BROKERS=localhost:9092
SCHEMA_REGISTRY_URL=http://localhost:8081
NODE_ENV=development
```

**Key Routes**:

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/api/v1/workflows` | Create a new workflow | X-Tenant-ID required |
| `GET` | `/api/v1/workflows` | List workflows for tenant | X-Tenant-ID required |
| `GET` | `/api/v1/workflows/:id` | Get a single workflow | X-Tenant-ID required |
| `PUT` | `/api/v1/workflows/:id/approve` | Approve a step | X-Tenant-ID + X-User-ID |
| `PUT` | `/api/v1/workflows/:id/reject` | Reject with reason | X-Tenant-ID + X-User-ID |
| `GET` | `/health` | Liveness probe | None |
| `GET` | `/ready` | Readiness probe (DB + Kafka) | None |

---

### 4b. `notification-service` — Kafka Consumer

**Stack**: Node.js 22 + kafkajs

**Responsibilities**:
- Consume `workflow.created`, `workflow.approved`, `workflow.rejected` events
- Log notifications (simulates sending email/Slack — no real notifications needed)
- Demonstrate idempotent processing — duplicate events must not create duplicate notifications

**Consumer Group**: `notification-service`

**Topics Subscribed**:
- `workflow.created`
- `workflow.approved`
- `workflow.rejected`

**Important**: Must handle the case where the service restarts and re-processes events — this is what the **idempotency test** in `test_readme.md` validates.

---

### 4c. `audit-service` — Kafka Consumer

**Stack**: Node.js 22 + kafkajs + PostgreSQL (Drizzle ORM)

**Responsibilities**:
- Consume ALL workflow events
- Write an **immutable** audit log row for each event
- Expose a GET endpoint for audit history: `GET /api/v1/audit/:workflowId`

**Why a separate service?** This mirrors the production architecture where audit is an independent concern with its own database — exactly what makes cross-service testing interesting.

---

### 4d. `workflow-widget` — React Micro-Frontend

**Stack**: React 19 + TypeScript + Vite + CSS Modules

**Built as a Web Component** using `customElements.define()` so it can be dropped into any host app regardless of the framework it uses.

**Components**:

| Component | Purpose |
|---|---|
| `<WorkflowWidget />` | Root — wraps everything, accepts `workflowId` and `tenantId` as props |
| `<StatusBadge />` | Shows PENDING / APPROVED / REJECTED with colour coding |
| `<ApprovalForm />` | Approve / Reject buttons for the current approver |
| `<WorkflowTimeline />` | Ordered list of steps with who approved each and when |

**Props / Custom Element Attributes**:
```html
<workflow-widget
  workflow-id="wf-abc-123"
  tenant-id="acme-corp"
  user-id="mgr-456"
  api-base-url="http://localhost:3001"
></workflow-widget>
```

**Build Output**: A single `workflow-widget.js` bundle that can be loaded via `<script>` tag in any host app.

---

### 4e. `host-app` — React Host Application

**Stack**: React 19 + TypeScript + Vite + React Router

**Purpose**: Simulates the kind of product team app that embeds the workflow widget. Provides enough UI surface for Playwright E2E tests.

**Pages**:

| Route | Page | Description |
|---|---|---|
| `/login` | Login Page | Simple form setting `tenantId` + `userId` in localStorage |
| `/expense/new` | New Expense | Form to submit an expense + embedded `<workflow-widget>` |
| `/expense/:id` | Expense Detail | Shows the expense + live workflow status widget |
| `/approvals` | Approvals Inbox | List of workflows awaiting the current user's approval |
| `/approvals/:id` | Approval Detail | Approve or reject a specific workflow |

---

## 5. API Contract Definitions

These are the **canonical request/response shapes** that Pact contracts will be tested against.

### `POST /api/v1/workflows`

**Request**:
```typescript
interface CreateWorkflowRequest {
  type: 'expense-approval' | 'document-submission';
  submittedBy: string;           // UUID of the submitter
  title: string;                 // Human-readable label
  steps: Array<{
    approver: string;            // UUID of the required approver
    order: number;               // 1-indexed step order
  }>;
  metadata?: Record<string, unknown>;
}
```

**Response `201`**:
```typescript
interface CreateWorkflowResponse {
  workflowId: string;            // UUID
  status: 'PENDING';
  type: string;
  submittedBy: string;
  tenantId: string;
  createdAt: string;             // ISO 8601
  steps: Array<{
    stepId: string;
    approver: string;
    order: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
  }>;
}
```

### `PUT /api/v1/workflows/:id/approve`

**Request**:
```typescript
interface ApproveWorkflowRequest {
  comment?: string;
}
```
**Headers required**: `X-Tenant-ID`, `X-User-ID`

**Response `200`**:
```typescript
interface WorkflowActionResponse {
  workflowId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  updatedAt: string;
}
```

### `GET /api/v1/workflows/:id`

**Response `200`**:
```typescript
interface WorkflowDetailResponse {
  workflowId: string;
  tenantId: string;
  type: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedBy: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  steps: Array<{
    stepId: string;
    approver: string;
    order: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    actedBy?: string;
    actedAt?: string;
    comment?: string;
  }>;
}
```

**Response `404`** (used for both "not found" AND "wrong tenant" — security by design):
```typescript
interface NotFoundResponse {
  error: 'NOT_FOUND';
  message: string;
}
```

---

## 6. Kafka Topics & Event Schemas

### Topic List

| Topic Name | Producer | Consumers | Retention |
|---|---|---|---|
| `workflow.created` | workflow-api | notification-service, audit-service | 7 days |
| `workflow.step.approved` | workflow-api | notification-service, audit-service | 7 days |
| `workflow.step.rejected` | workflow-api | notification-service, audit-service | 7 days |
| `workflow.approved` | workflow-api | notification-service, audit-service | 7 days |
| `workflow.rejected` | workflow-api | notification-service, audit-service | 7 days |

> **Topic naming convention**: `<domain>.<noun>.<verb>` — noun is the entity, verb is the past-tense action.

### Event Schemas

#### `workflow.created`
```typescript
interface WorkflowCreatedEvent {
  eventType: 'workflow.created';
  eventId: string;               // UUID — for idempotency checking
  workflowId: string;
  tenantId: string;
  type: string;
  submittedBy: string;
  title: string;
  stepCount: number;
  createdAt: string;             // ISO 8601
}
```

#### `workflow.approved` (whole workflow fully approved)
```typescript
interface WorkflowApprovedEvent {
  eventType: 'workflow.approved';
  eventId: string;
  workflowId: string;
  tenantId: string;
  approvedBy: string;            // UUID of the final approver
  approvedAt: string;            // ISO 8601
  metadata: {
    workflowType: string;
    totalSteps: number;
  };
}
```

#### `workflow.rejected`
```typescript
interface WorkflowRejectedEvent {
  eventType: 'workflow.rejected';
  eventId: string;
  workflowId: string;
  tenantId: string;
  rejectedBy: string;
  rejectedAt: string;
  reason?: string;
}
```

> **Kafka Message Key**: Always set to `tenantId:workflowId` — ensures all events for a given workflow land on the same partition (ordering guarantee).

---

## 7. Database Schema (PostgreSQL)

### `workflow-api` database — `workflow_db`

```sql
-- Workflows table
CREATE TABLE workflows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL,
  type          TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'PENDING',   -- PENDING | APPROVED | REJECTED
  title         TEXT        NOT NULL,
  submitted_by  TEXT        NOT NULL,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for tenant-scoped list queries
CREATE INDEX idx_workflows_tenant_id ON workflows(tenant_id);

-- Workflow steps table
CREATE TABLE workflow_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tenant_id     TEXT        NOT NULL,          -- denormalized for isolation checks
  approver      TEXT        NOT NULL,
  step_order    INTEGER     NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'PENDING',
  acted_by      TEXT,
  acted_at      TIMESTAMPTZ,
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_steps_workflow_id ON workflow_steps(workflow_id);
```

### `audit-service` database — `audit_db`

```sql
-- Immutable audit log
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      TEXT        NOT NULL UNIQUE,   -- idempotency key from event
  workflow_id   TEXT        NOT NULL,
  tenant_id     TEXT        NOT NULL,
  event_type    TEXT        NOT NULL,
  actor         TEXT,
  payload       JSONB       NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE on event_id prevents duplicate processing
CREATE INDEX idx_audit_logs_workflow_id ON audit_logs(workflow_id);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);
```

---

## 8. Multi-Tenancy Design

Every request to `workflow-api` **must** include `X-Tenant-ID`. The middleware extracts and validates it before any handler runs.

```
Request arrives
      │
      ▼
tenantMiddleware()
  - Check X-Tenant-ID header present → 400 if missing
  - Attach tenantId to request context
      │
      ▼
DB Query always includes WHERE tenant_id = $tenantId
  - Never queries without tenant scope
  - Returns 404 (not 403) for cross-tenant access — security by design
      │
      ▼
Kafka events always include tenantId in payload
  - Message key = tenantId:workflowId
  - Consumers filter by tenantId if needed
```

**Tenant test scenarios included in tests**:
- Missing `X-Tenant-ID` header → `400 Bad Request`
- Empty `X-Tenant-ID` → `400 Bad Request`
- Accessing another tenant's workflow → `404 Not Found` (not `403`)
- Listing workflows only returns current tenant's data

---

## 9. Infrastructure — Docker Compose

A single `docker-compose.yml` brings up the entire platform for development and integration testing.

### Services in Docker Compose

```yaml
# docker-compose.yml (abbreviated — full file generated in Phase 1)

services:

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: secret
    ports: ['5432:5432']
    volumes:
      - ./infra/init.sql:/docker-entrypoint-initdb.d/init.sql

  zookeeper:
    image: confluentinc/cp-zookeeper:7.6.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181

  kafka:
    image: confluentinc/cp-kafka:7.6.0
    depends_on: [zookeeper]
    ports: ['9092:9092']
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092

  schema-registry:
    image: confluentinc/cp-schema-registry:7.6.0
    depends_on: [kafka]
    ports: ['8081:8081']
    environment:
      SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: PLAINTEXT://kafka:9092
      SCHEMA_REGISTRY_HOST_NAME: schema-registry

  kafka-ui:
    image: provectuslabs/kafka-ui:latest    # visual Kafka topic inspector
    ports: ['8080:8080']
    environment:
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092
      KAFKA_CLUSTERS_0_SCHEMAREGISTRY: http://schema-registry:8081

  pact-broker:
    image: pactfoundation/pact-broker:latest
    ports: ['9292:9292']
    environment:
      PACT_BROKER_DATABASE_URL: postgresql://admin:secret@postgres/pact_db

  workflow-api:
    build: ./services/workflow-api
    ports: ['3001:3001']
    environment:
      DATABASE_URL: postgresql://admin:secret@postgres/workflow_db
      KAFKA_BROKERS: kafka:9092
      SCHEMA_REGISTRY_URL: http://schema-registry:8081
    depends_on: [postgres, kafka, schema-registry]

  notification-service:
    build: ./services/notification-service
    environment:
      KAFKA_BROKERS: kafka:9092
    depends_on: [kafka]

  audit-service:
    build: ./services/audit-service
    environment:
      DATABASE_URL: postgresql://admin:secret@postgres/audit_db
      KAFKA_BROKERS: kafka:9092
    depends_on: [postgres, kafka]

  host-app:
    build: ./apps/host-app
    ports: ['3000:3000']
    environment:
      VITE_API_BASE_URL: http://workflow-api:3001
    depends_on: [workflow-api]
```

### One-Command Start

```bash
docker compose up -d          # Start everything
docker compose logs -f workflow-api   # Follow a specific service
docker compose down -v        # Stop and clean up volumes
```

---

## 10. Development Phases

### Phase 1 — Foundation (Infrastructure + Shared Packages)
**Goal**: `docker compose up` works; shared types defined; monorepo running.

- [ ] Create monorepo root with npm workspaces
- [ ] Write `docker-compose.yml` with Postgres, Kafka, Zookeeper, Schema Registry, Kafka UI, Pact Broker
- [ ] Create `packages/shared-types` with all TypeScript interfaces
- [ ] Create `packages/shared-schemas` with Ajv JSON Schema definitions
- [ ] Create `packages/test-utils` with factories, Testcontainers setup, helpers
- [ ] Write `infra/init.sql` to create all databases on Postgres start

**Done when**: `docker compose up -d` runs clean; all packages compile.

---

### Phase 2 — Core API (`workflow-api`)
**Goal**: Full CRUD REST API with tenant isolation and Kafka publishing.

- [ ] Scaffold Fastify app with TypeScript
- [ ] Set up Drizzle ORM with PostgreSQL (workflow_db)
- [ ] Implement tenant middleware (`X-Tenant-ID` extraction + validation)
- [ ] Implement `POST /api/v1/workflows` (create + publish `workflow.created`)
- [ ] Implement `GET /api/v1/workflows` (list, tenant-scoped)
- [ ] Implement `GET /api/v1/workflows/:id` (get one, tenant-scoped)
- [ ] Implement `PUT /api/v1/workflows/:id/approve` (state machine + `workflow.approved` event)
- [ ] Implement `PUT /api/v1/workflows/:id/reject` (state machine + `workflow.rejected` event)
- [ ] Implement `GET /health` and `GET /ready`
- [ ] Dockerise the service

**Done when**: `curl -X POST localhost:3001/api/v1/workflows ...` returns `201` and the event appears in Kafka UI.

---

### Phase 3 — Event Consumers (`notification-service` + `audit-service`)
**Goal**: Two working Kafka consumers; audit log queryable via API.

- [ ] Scaffold `notification-service` with kafkajs consumer
- [ ] Implement handlers for `workflow.created`, `workflow.approved`, `workflow.rejected`
- [ ] Add idempotency guard (track processed `eventId` in memory / Redis set)
- [ ] Scaffold `audit-service` with kafkajs consumer + Drizzle ORM (audit_db)
- [ ] Implement `GET /api/v1/audit/:workflowId` endpoint in audit-service
- [ ] Dockerise both services

**Done when**: Approving a workflow via API produces a log line in notification-service and a row in audit_logs table.

---

### Phase 4 — React Micro-Frontend (`workflow-widget`)
**Goal**: Embeddable web component that shows live workflow status.

- [ ] Scaffold Vite + React + TypeScript project
- [ ] Build `WorkflowWidget` component (fetch status from `workflow-api`, poll every 5s)
- [ ] Build `StatusBadge` component
- [ ] Build `ApprovalForm` component (Approve / Reject buttons)
- [ ] Build `WorkflowTimeline` component
- [ ] Register as a Custom Element (`customElements.define('workflow-widget', ...)`)
- [ ] Build to a single UMD bundle (`workflow-widget.js`)

**Done when**: Dropping `<workflow-widget workflow-id="..." tenant-id="..."></workflow-widget>` into a plain HTML file shows the live workflow status.

---

### Phase 5 — Host Application (`host-app`)
**Goal**: A realistic React host app that embeds the widget and provides E2E test surfaces.

- [ ] Scaffold Vite + React + React Router project
- [ ] Build Login page (sets `tenantId` + `userId` in localStorage)
- [ ] Build Expense Submission page (form + embedded workflow widget)
- [ ] Build Expense Detail page (embedded widget showing current status)
- [ ] Build Approvals Inbox page (list of pending workflows)
- [ ] Build Approval Detail page (approve/reject with comment)
- [ ] Add `data-testid` attributes to all interactive elements

**Done when**: Can manually complete a full approval flow through the browser.

---

### Phase 6 — Test Suite Wiring
**Goal**: Every test layer from `test_readme.md` is running and passing.

- [ ] **Layer 0**: ESLint + TypeScript strict mode passes across all packages
- [ ] **Layer 1**: Vitest unit tests for shared-types factories and schema validators
- [ ] **Layer 2**: Pact consumer contract test for `workflow-api`
- [ ] **Layer 2**: Pact provider verification in `workflow-api`
- [ ] **Layer 3**: Pact MessagePact for `workflow.approved` event contract
- [ ] **Layer 3c**: Ajv JSON Schema tests for all event schemas
- [ ] **Layer 3c**: Confluent Schema Registry compatibility gate tests
- [ ] **Layer 4**: Supertest integration tests for all API endpoints
- [ ] **Layer 4**: Kafka idempotency integration test
- [ ] **Layer 4**: Tenant isolation integration test matrix
- [ ] **Layer 5**: Playwright E2E — full approval flow happy path
- [ ] **Layer 5**: Playwright E2E — widget embedding test
- [ ] **Layer 6**: k6 concurrent tenant load test script
- [ ] **Layer 7**: Cross-tenant security test matrix

**Done when**: `npx vitest run` is green; `npx playwright test` passes; k6 script runs to completion.

---

### Phase 7 — CI Pipeline
**Goal**: GitHub Actions runs the full pipeline on every PR.

- [ ] Write `.github/workflows/test.yml` with all test stages
- [ ] Write `.github/workflows/schema-compatibility.yml`
- [ ] Add Pact Broker publish step
- [ ] Add test result / coverage upload steps

---

## 11. Test Coverage Mapping

| Test Layer | Test File Location | Service Under Test | Infrastructure Needed |
|---|---|---|---|
| Static Analysis | All packages | All | None |
| Unit (factories/schemas) | `packages/test-utils/tests/` | shared-types, shared-schemas | None |
| API Contract (consumer) | `tests/contracts/consumer/` | workflow-api | None (Pact mock server) |
| API Contract (provider) | `tests/contracts/provider/` | workflow-api | workflow-api running |
| Kafka Event Contract | `tests/contracts/consumer/events/` | notification-service | None (Pact mock) |
| Schema Compatibility | `tests/schema/` | shared-schemas | Schema Registry (Docker) |
| Service Integration | `tests/integration/` | workflow-api, audit-service | Postgres + Kafka (Testcontainers) |
| E2E | `tests/e2e/` | host-app + workflow-api | Full Docker Compose stack |
| Performance | `tests/performance/` | workflow-api | Full Docker Compose stack |
| Security/Isolation | `tests/security/` | workflow-api | workflow-api running |

---

## 12. Project Bootstrap Commands

```bash
# 1. Clone / create the project root
mkdir workflow-platform && cd workflow-platform

# 2. Initialise the npm workspace root
npm init -y
# Edit package.json to add:
# "workspaces": ["packages/*", "services/*", "apps/*", "tests"]

# 3. Start infrastructure
docker compose up -d

# 4. Install all workspace dependencies
npm install

# 5. Build shared packages first (others depend on them)
npm run build --workspace=packages/shared-types
npm run build --workspace=packages/shared-schemas
npm run build --workspace=packages/test-utils

# 6. Run the API in dev mode (with hot reload)
npm run dev --workspace=services/workflow-api

# 7. Run tests
npm run test                            # all unit + integration tests (Vitest)
npx playwright test                     # E2E tests
npx vitest run tests/schema             # schema compatibility tests
k6 run tests/performance/concurrent-tenants.k6.js
```

---

## Open Questions / Decisions

> [!IMPORTANT]
> **Polling vs WebSocket for widget live updates**
> The `workflow-widget` can either poll the API every few seconds or use WebSockets for real-time updates. Polling is simpler to build and test. WebSocket adds realism. **Decision**: Start with 5-second polling; upgrade to WebSocket if needed.

> [!IMPORTANT]
> **Auth strategy for host-app**
> We need some form of identity so the approve/reject buttons know who the current user is. Options: (a) Simple `X-User-ID` header from localStorage (no real auth), (b) Basic JWT with no signature verification. **Decision**: `X-User-ID` from localStorage — keeps focus on Kafka/multi-tenancy testing, not auth.

> [!NOTE]
> **Pact Broker hosting**
> The Pact Broker runs in Docker Compose locally. For CI, we either (a) spin it up in the pipeline, or (b) use [PactFlow](https://pactflow.io) (free tier available). Either works.

---

*Companion documents: [`dev_readme.md`](./dev_readme.md) | [`test_readme.md`](./test_readme.md)*

*Last updated: September 2026*
