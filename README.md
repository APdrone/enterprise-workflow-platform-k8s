# 🚀 Enterprise Event-Driven Workflow Platform & Microservices Testing Blueprint

[![Kubernetes](https://img.shields.io/badge/Kubernetes-1.28+-326CE5?style=flat&logo=kubernetes&logoColor=white)](https://kubernetes.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Apache Kafka](https://img.shields.io/badge/Apache%20Kafka-7.6-231F20?style=flat&logo=apachekafka&logoColor=white)](https://kafka.apache.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-Tracing%20%26%20Metrics-F5A800?style=flat&logo=opentelemetry&logoColor=black)](https://opentelemetry.io/)
[![Jaeger](https://img.shields.io/badge/Jaeger-Distributed%20Tracing-60D0E4?style=flat&logo=jaeger&logoColor=black)](https://www.jaegertracing.io/)
[![Prometheus](https://img.shields.io/badge/Prometheus-Monitoring-E6522C?style=flat&logo=prometheus&logoColor=white)](https://prometheus.io/)
[![Fastify](https://img.shields.io/badge/Fastify-5.1+-000000?style=flat&logo=fastify&logoColor=white)](https://www.fastify.io/)
[![React](https://img.shields.io/badge/React-18.3+-61DAFB?style=flat&logo=react&logoColor=black)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.4+-646CFF?style=flat&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-E2E%20Testing-2EAD33?style=flat&logo=playwright&logoColor=white)](https://playwright.dev/)
[![Pact](https://img.shields.io/badge/Pact-Contract%20Testing-E4405F?style=flat&logo=pact&logoColor=white)](https://pact.io/)

A production-grade, event-driven microservices platform engineered for **multi-tier enterprise workflow orchestration**, **dual-write transactional outbox reliability**, **W3C distributed context propagation**, **multi-tenant data isolation**, and **multi-layer automated testing** (Unit, Pact Contracts, Integration, Chaos & E2E).

---

## 🌟 Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Frontend["Frontend & Microfrontends Layer"]
        HostApp["🖥️ Host Web App (Port 8080 / 5173)\nReact + Vite Dashboard (SSE Live Sync Context)"]
        Widget["🧩 Workflow Widget (Port 3003)\nFramework-Agnostic Web Component (Shadow DOM)"]
    end

    subgraph API["Workflow Gateway & Core Service"]
        WFAPI["⚙️ Workflow API (Port 3000)\nFastify + State Machine + Dynamic Rules Engine"]
        OutboxRelay["🔄 Transactional Outbox Relay\n(Immediate Dispatch + 1s Resilience Poller)"]
    end

    subgraph DB["Database Layer (PostgreSQL 16 + RLS Hardening)"]
        WFDB[("🗄️ workflow_db (RLS Enabled)\n(workflows, workflow_steps, workflow_rules, outbox_events, idempotency_keys)")]
        AuditDB[("🗄️ audit_db (RLS Enabled)\n(audit_events immutable ledger, dlq_messages)")]
    end

    subgraph Messaging["Distributed Event Stream (Apache Kafka)"]
        Broker["📨 Kafka Broker (Port 9092)\nTopics: workflow.events, workflow.events.retry, workflow.events.dlq"]
        KafkaUI["📊 Kafka UI (Port 8085)\nTopic, DLQ & Consumer Group Inspector"]
    end

    subgraph Consumers["Downstream Microservices"]
        NotifSvc["🔔 Notification Service (Port 3001)\nSSE Real-Time Broadcaster & Idempotent Alerts Consumer"]
        AuditSvc["📜 Audit Service (Port 3002)\nCloudEvents Consumer, DLQ Sink & Replay API"]
    end

    subgraph Observability["Observability & Distributed Tracing"]
        Jaeger["🔭 Jaeger Tracing (Port 16686 / OTLP 4318)\nEnd-to-End Multi-Span Waterfall Graphs"]
        Prometheus["📈 Prometheus Server (Port 9090)\nMetrics Scraping (/metrics)"]
    end

    HostApp -->|REST API + Tenant Headers| WFAPI
    Widget -->|Custom Events & REST| WFAPI
    HostApp <-->|SSE Stream (/api/v1/stream)| NotifSvc
    WFAPI -->|1. Atomic Transaction with RLS Scoping| WFDB
    WFDB -->|2. Poll Unpublished Events| OutboxRelay
    OutboxRelay -->|3. Publish CloudEvent with traceparent| Broker
    Broker -->|Consume workflow.events| NotifSvc
    Broker -->|Consume workflow.events| AuditSvc
    Broker -.->|Poison Pills / Retry Exhaustion| Broker
    AuditSvc -->|Persist Audit Record| AuditDB
    AuditSvc -->|Dead-Letter Sink| AuditDB
    Broker -.->|Inspect Partitions & Lag| KafkaUI

    WFAPI -.->|OTLP HTTP Trace Export| Jaeger
    AuditSvc -.->|OTLP Child Span Export| Jaeger
    NotifSvc -.->|OTLP Child Span Export| Jaeger
    Prometheus -.->|Scrape /metrics| WFAPI
    Prometheus -.->|Scrape /metrics| AuditSvc
    Prometheus -.->|Scrape /metrics| NotifSvc
```

---

## 🎯 Key Architectural Capabilities

1. **Real-Time Live Sync (Server-Sent Events / SSE)**:
   - Zero-polling instant reactivity: State changes, approvals, and submissions stream directly to connected web clients via `GET /api/v1/stream`.
   - Multi-tenant connection management with 20s heartbeat keep-alives and live toast notifications.
2. **Kafka Dead Letter Queue (DLQ) & Consumer Resilience**:
   - Resilient multi-topic topology: `workflow.events` $\rightarrow$ `workflow.events.retry` (3 exponential backoff retries) $\rightarrow$ `workflow.events.dlq`.
   - Poison-pill isolation: Malformed JSON or schema-violating events are intercepted and routed to DLQ without blocking consumer partitions.
   - DLQ persistence & replay REST APIs (`GET /api/v1/dlq/messages`, `POST /api/v1/dlq/replay/:id`).
3. **Strict Kafka Partition Routing & Event Ordering (Murmur2 Hashing)**:
   - Deterministic partition key routing (`${tenantId}:${workflowId}`) adhering to Apache Kafka's 32-bit Murmur2 hashing algorithm.
   - Preserves strict monotonic FIFO ordering for sequential lifecycle transitions (`SUBMITTED` $\rightarrow$ `STEP_APPROVED` $\rightarrow$ `APPROVED`) across multi-partition topics.
4. **Tenant-Aware Rate Limiting & Noisy Neighbor Protection**:
   - In-memory sliding-window token bucket rate limiter (`rateLimitMiddleware`) enforcing per-tenant request quotas.
   - Emits standard RFC rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`) and returns HTTP 429 (`RATE_LIMIT_EXCEEDED`) for abusive tenants while safeguarding innocent tenants' p95 latency.
5. **Configurable Workflow Rules & Parallel Approvals (AND/OR Quorums)**:
   - Tenant-scoped dynamic rules engine (`workflow_rules` table and `/api/v1/rules` API) supporting priority-based rule matching by workflow type, amount thresholds, and department.
   - **`ALL_MUST_APPROVE` (AND Quorum)**: Unanimous multi-reviewer approval required on the same step order.
   - **`ANY_CAN_APPROVE` (OR Quorum)**: First-responder approval auto-skips sibling parallel steps.
   - Automatic parallel reviewer dispatch (`Finance Director` + `VP Approval`) for high-value requests (> $100k).
6. **Database Security Hardening & Connection Pool Hygiene (PostgreSQL RLS)**:
   - Hardware/engine-level tenant isolation: `FORCE ROW LEVEL SECURITY` on all tenant-scoped tables.
   - Dynamic session policy (`app.current_tenant_id`) with `WITH CHECK` constraints physically blocking unauthorized cross-tenant writes at the database kernel level.
   - Connection pool transaction helper `withTenantContext` with transaction-local `is_local=true` scoping, guaranteeing zero context leakage or connection poisoning across pooled physical connections.
7. **Transactional Outbox Pattern (Dual-Write Resilience)**:
   - Workflow state updates and outbound CloudEvents are committed in a **single atomic PostgreSQL ACID transaction**.
   - Zero event loss during Kafka outages: API returns `200 OK` immediately while events accumulate safely in `outbox_events` (`published = false`).
   - The Outbox Relay automatically drains the backlog with exponential backoff once Kafka recovers.
8. **End-to-End Distributed Tracing & Trace Waterfall Verification (W3C TraceContext)**:
   - Root HTTP span initialized on API actions and propagated via W3C `traceparent` headers through PostgreSQL Outbox records and Kafka headers to downstream consumer child spans in **Jaeger UI**.
   - Verified trace waterfall integrity across distributed microservice boundaries.
9. **Idempotency & Concurrent Conflict Protection**:
   - Native `idempotency-key` header pre-handler caches and deduplicates requests (`x-idempotent-replay: true`).
10. **Microfrontend Web Component (`<workflow-widget>`) & Error Boundary Isolation**:
    - Zero-dependency custom element encapsulated in Shadow DOM, embeddable inside any host application (React, Angular, Vue, or Vanilla HTML).
    - Bi-directional event bus contract (`workflow-status-change`, `workflow-error`) and graceful error boundary degradation preventing host application crashes during backend API dropouts.
11. **Workflow SLA Time-Travel & Escalation State Machine**:
    - Deterministic clock manipulation (`vi.useFakeTimers`) for approval step SLA timeouts (48h escalation from `TEAM_LEAD` to `DEPARTMENT_MANAGER`) and 30-day draft TTL auto-cancellation.
12. **Automated Accessibility (a11y) WCAG 2.1 AA Auditing**:
    - Automated Axe compliance scans (`@axe-core/playwright`) auditing host dashboards, modal dialogs, and embedded widgets.

---

## 🏗️ Implementation & Core Subsystems Breakdown

### 1. 🖥️ Microfrontends Layer (Host & Remotes)
The UI is split into independently buildable, deployable, and embeddable frontend applications:
* **Host Application ([`apps/host-app`](./apps/host-app))** (Port `8080` / `5173`):
  * **Role**: Primary shell & dashboard application built with React 18, TypeScript, and Vite.
  * **Features**: Multi-tenant context switcher, user role selector, multi-step expense creator, approvals inbox, audit log timeline, and live notification alerts.
* **Remote Widget ([`apps/workflow-widget`](./apps/workflow-widget))** (Port `3003`):
  * **Role**: Framework-agnostic Web Component (`<workflow-widget>`) compiled with custom Shadow DOM encapsulation via [`web-component.tsx`](./apps/workflow-widget/src/web-component.tsx).
  * **Integration**: Embeddable in any web application with standard HTML attributes (`tenant-id`, `api-url`, `user-id`, `workflow-id`).

### 2. 📨 Kafka Messaging Layer Details
Asynchronous, distributed event streaming powered by Apache Kafka and the **CloudEvents 1.0 specification**:
* **Broker & Ports**: Kafka Broker on port `9092` (with Schema Registry on `:8081` and Kafka UI on `:8085`).
* **Topic**: `workflow.events` (partitioned for high throughput and horizontal scalability).
* **Partition Key**: `tenantId:workflowId` (guarantees strict per-workflow message ordering within tenant partitions).
* **Tracing Context**: Injects standard W3C `traceparent` headers into Kafka records for end-to-end distributed tracing across microservices.
* **Schema Validation**: Runtime schema enforcement with CloudEvents JSON schemas ([`packages/shared-schemas`](./packages/shared-schemas)).
* **Published Event Types** ([`packages/shared-types`](./packages/shared-types/src/events.types.ts)):
  * `workflow.submitted.v1` — Workflow draft submitted for multi-tier review.
  * `workflow.step_approved.v1` — Intermediate step approved; advances to next tier.
  * `workflow.approved.v1` — Final step approved; workflow marked as completed.
  * `workflow.rejected.v1` — Workflow rejected with mandatory reason.
  * `workflow.cancelled.v1` — Workflow cancelled by requester.
* **Consumer Groups**:
  * `notification-service-group`: Consumes events to generate targeted in-app alerts.
  * `audit-service-group`: Consumes events to maintain an immutable compliance log.

### 3. ⚙️ Backend (BE) Microservices
All backend services are built with **Fastify, Node.js, and TypeScript**:
* **[`services/workflow-api`](./services/workflow-api)** (Port `3000`):
  * Core workflow orchestration engine, dynamic multi-tier threshold state machine, and delegation validation.
  * Contains the **Transactional Outbox Relay** background worker for zero-data-loss publishing.
  * Middleware: Tenant isolation (`x-tenant-id`), Correlation ID (`x-correlation-id`), and Idempotency deduplication (`Idempotency-Key`).
* **[`services/notification-service`](./services/notification-service)** (Port `3001`):
  * Dedicated event consumer that processes workflow lifecycle transitions and stores role-targeted alerts.
  * Provides REST query endpoints for host UI notifications.
* **[`services/audit-service`](./services/audit-service)** (Port `3002`):
  * Immutable audit ledger consumer that writes all CloudEvents to `audit_db`.
  * Provides query APIs for full compliance lifecycle and actor tracking.

### 4. 🏢 Tenants & Roles (Multi-Tenancy & RBAC)
* **Tenant Isolation**:
  * Logical isolation enforced via mandatory `x-tenant-id` HTTP request headers.
  * All database queries scoped with `WHERE tenant_id = :tenantId`.
  * **Demo Presets**: `tenant-corp-a` (Tokyo Holdings), `tenant-corp-b` (Kyoto Robotics), `tenant-corp-c` (Nagoya Logistics).
* **Role-Based Access Control (RBAC)**:
  * **`requester` (`user-alice`)**: Submits expense claims and workflow requests.
  * **`team_lead` (`user-bob`)**: Step 1 Approver (handles amounts $\le \$10,000$).
  * **`dept_manager` (`user-carol`)**: Step 2 Approver (handles amounts $>\$10,000$ and $\le \$100,000$).
  * **`finance_director` (`user-diana`)**: Step 3 Approver (handles major expenses $>\$100,000$).
  * **`admin` (`user-admin`)**: Super admin with global override across all steps.
* **Delegation / Proxy Approver Support**:
  * Approvers can grant temporary approval authority to delegatees with `validFrom` and `validUntil` date ranges.

### 5. 🗄️ Database & Persistence Layer (PostgreSQL 16 + RLS)
PostgreSQL 16 managed with **Drizzle ORM** (Port `5433` / Database `workflow_db`, `audit_db`) with **Row-Level Security (RLS)** strictly enforced on all multi-tenant tables:
* **Databases**:
  * `workflow_db`: Operational database for `workflow-api`.
  * `audit_db`: Dedicated append-only compliance & DLQ database for `audit-service`.
  * `pact_db`: Pact Broker storage for contract test verification.
* **Key Tables** ([`services/workflow-api/src/db/schema.ts`](./services/workflow-api/src/db/schema.ts)):
  * `workflows`: Stores workflow metadata, amount, current state, current step order, total steps (RLS enabled).
  * `workflow_steps`: Stores multi-step approval chain, designated roles, approvers, action timestamps, comments, `policy` (`ALL_MUST_APPROVE`/`ANY_CAN_APPROVE`), and `parallel_group` (RLS enabled).
  * `workflow_rules`: Stores dynamic routing matrices, tenant-scoped thresholds, priority, and step definitions (RLS enabled).
  * `delegations`: Stores active out-of-office delegation rules (RLS enabled).
  * `idempotency_keys`: Stores request hashes, processing status, and cached response payloads (RLS enabled).
  * `outbox_events`: Stores unpublished CloudEvents, publication status (`published = false/true`), and retry counts (RLS enabled).
  * `audit_events` (in `audit_db`): Stores immutable CloudEvent payloads, actors, event types, and timestamps (RLS enabled).
  * `dlq_messages` (in `audit_db`): Stores dead-lettered events, error types, stack traces, retry counts, and replay status (RLS enabled).

---

## 📂 Repository Layout

```text
.
├── apps/
│   ├── host-app/               # React 18 + Vite host dashboard (SSE Live Sync, Inbox, Expenses, Audit, Alerts)
│   └── workflow-widget/        # Framework-agnostic Web Component (<workflow-widget>) with Parallel Step Cards
├── services/
│   ├── workflow-api/           # Core Fastify API: State machine, Rules Engine, Outbox Relay, Delegations, Rate Limiting & RLS
│   ├── notification-service/   # SSE live streaming hub (/api/v1/stream) and role-targeted alert consumer
│   └── audit-service/          # Kafka consumer service persisting immutable CloudEvents & DLQ sink/replay API
├── packages/
│   ├── shared-schemas/         # Zod schemas, DLQ resilience headers & CloudEvents 1.0 contract validators
│   ├── shared-types/           # Shared TypeScript domain types, Parallel Quorum policies & DTO interfaces
│   ├── telemetry/              # OpenTelemetry OTLP tracer, Prometheus metrics & Fastify global plugin
│   └── test-utils/             # Kafka Murmur2 partitioner, Shared testing helpers, DB reset & Kafka mocks
├── k8s/                        # Kubernetes manifests & 1-click local scripts
│   ├── 00-namespace.yaml       # Namespace workflow-platform
│   ├── 01-configmaps-secrets.yaml # Global environment variables & OTLP exporter endpoints
│   ├── 02-postgres.yaml        # PostgreSQL StatefulSet & PVC storage
│   ├── 03-kafka.yaml           # Apache Kafka Broker & Zookeeper (Topics: workflow.events, retry, dlq)
│   ├── 04-workflow-api.yaml    # Workflow API Deployment, Service & HPA
│   ├── 05-notification-service.yaml # Notification Service Deployment & Service
│   ├── 06-audit-service.yaml   # Audit Service Deployment & Service
│   ├── 07-host-app.yaml        # Host React App NGINX Deployment & Service
│   ├── 08-observability.yaml   # Jaeger Tracing, Prometheus Server & Kafka UI
│   └── local/                  # Local cluster setup, fast hot-reloads & port-forwards
├── tests/                      # Automated test suite (140+ tests across 30+ suites)
│   ├── contract/               # Kafka partition ordering, CloudEvents schemas & Consumer/Provider Pact CDCT
│   ├── unit/                   # State machine, rules engine, rate limiter, SLA time-travel & telemetry tests
│   ├── integration/            # Trace waterfall, outbox relay, DLQ resilience & live PostgreSQL RLS tests
│   ├── security/               # PostgreSQL pool leak guard, tenant isolation & IDOR tests
│   ├── perf/                   # k6 workflow load & multi-tenant noisy neighbor isolation benchmarks
│   └── e2e/                    # Playwright user journeys, MFE event bus, error boundary & Axe a11y audits
├── docker-compose.yml          # Local Docker Compose multi-container stack
├── playwright.config.ts        # Playwright E2E browser test configuration
└── pacts/                      # Generated Pact Consumer-Driven Contract JSON specifications
```

---

## 🧪 Automated Testing Pyramid & CI/CD Pipelines

The platform implements an **8-Layer Quality Engineering & Testing Pyramid** integrated with **GitHub Actions CI/CD pipelines** for developer fast feedback and release gatekeeping:

```
                              ▲
                             / \     Tier 8: Performance SLAs & Noisy Neighbor (k6 - P95 < 100ms)
                            /   \    Tier 7: End-to-End User Journeys, MFE & a11y (Playwright + Axe)
                           /     \   Tier 6: Trace Waterfall & Service Integration (Testcontainers)
                          /       \  Tier 5: Tenant Security Matrix & Pool Leak Guard (Vitest)
                         /         \ Tier 4: Consumer-Driven Contracts & Kafka Ordering (Pact & Murmur2)
                        /           \Tier 3: Frontend Component & Hook Suite (React Testing Lib + JSDOM)
                       /             \Tier 2: Microservice Unit Logic, SLA Time-Travel & Rate Limits (Vitest)
                      /_______________\Tier 1: Static Type Safety & Compilation (TypeScript Strict)
```

### 🏃 Developer Commands & Fast Feedback Loop

| Command | Purpose | Speed | When to Run |
|---|---|---|---|
| `npm run check:fast` | Monorepo Typecheck + Unit + React Component tests (69 tests) | **~3s** | Before every commit |
| `npm run check:all` | Typecheck + Unit + Contract + Pact + Security tests (134 tests) | **~8s** | Before opening a PR |
| `npm run test:watch` | Vitest interactive live test runner | **Instant** | During active feature development |
| `npm test` | Runs all automated test suites across the monorepo | **~9s** | Full workspace validation |
| `npm run test:unit` | Service state machines, rules engine, rate limiter & SLA escalation tests | **~1s** | Backend logic iteration |
| `npm run test:contract` | Kafka partition ordering, Fastify routes & CloudEvents 1.0 schemas | **~1s** | API & event schema changes |
| `npm run test:pact` | Generates & verifies HTTP & Kafka MessagePact contracts | **~3s** | Cross-service contract verification |
| `npm run pact:can-i-deploy` | Queries Pact Broker matrix (`dev` / `qa` / `prod`) | **~1s** | Deployment compatibility check |
| `npm run test:security` | Tenant isolation, DB pool leak guard & PostgreSQL RLS kernel policy tests | **~1s** | Security & multi-tenant changes |
| `npm run test:integration` | End-to-end trace waterfall, DLQ resilience & outbox loop tests | **~3s** | Distributed subsystem changes |
| `npm run test:e2e` | Playwright browser journeys, MFE error boundary & WCAG a11y tests | **~15s** | Full frontend-to-backend validation |
| `npm run test:perf` | k6 workflow load test script enforcing P95 SLA thresholds | **~50s** | Performance benchmarking |
| `npm run test:perf:noisy-neighbor` | k6 multi-scenario load test (Flooder throttle vs SLA-guaranteed tenant) | **~30s** | Multi-tenant isolation benchmarking |

---

### 🔄 CI/CD Pipeline Architecture

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

---

## 📄 License
MIT License. Created as a reference blueprint for enterprise event-driven systems, distributed observability, and resilient microservices.

