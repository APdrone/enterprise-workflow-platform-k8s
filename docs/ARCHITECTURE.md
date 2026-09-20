# Workflow Platform — Architecture & End-to-End Workflow Walkthrough

This document provides a comprehensive, visual, step-by-step walkthrough of the **Event-Driven Multi-Tenant Workflow Platform**. It explains the system architecture, transactional resilience, security model, and detailed end-to-end user flows for all supported business scenarios.

---

## 1. System Architecture Overview

The platform is designed as an event-driven, multi-tenant microservices ecosystem. It decouples synchronous HTTP requests (Fastify) from asynchronous event handlers (Notification and Audit services) via **Apache Kafka** partitioned by tenant and workflow ID, with a **Transactional Outbox** pattern guaranteeing zero message loss.

```mermaid
%%{init: {'theme': 'dark', 'flowchart': {'useMaxWidth': false, 'htmlLabels': true, 'nodeSpacing': 40, 'rankSpacing': 40}, 'themeVariables': {'fontSize': '16px', 'fontFamily': 'Inter, sans-serif'}}}%%
flowchart TB
    subgraph Frontend["Frontend Layer"]
        HostApp["Host React Application (Port 5173)\nMulti-Step Expenses, Approvals, Audit & Notifications"]
        Widget["Workflow Widget Web Component (Port 3003)\nEncapsulated Multi-Step State Machine UI"]
        HostApp -->|Embeds| Widget
    end

    subgraph API_Layer["API Gateway & Core Service"]
        TenantMW["Tenant & Correlation Middleware\n(x-tenant-id, x-correlation-id, x-user-id)"]
        IdempMW["Idempotency Middleware\n(Idempotency-Key deduplication)"]
        WorkflowAPI["Workflow API Service (Fastify, Port 3000)\nDynamic Multi-Step Engine & Delegations"]
        Widget -->|REST HTTP + Headers| TenantMW
        HostApp -->|REST HTTP + Headers| TenantMW
        TenantMW --> IdempMW
        IdempMW --> WorkflowAPI
    end

    subgraph Persistence["Storage, Outbox & Messaging"]
        PostgresWorkflow[("PostgreSQL: workflow_db\n(workflows, workflow_steps, delegations, outbox_events)")]
        OutboxRelay["Outbox Relay Service\nBackground Reliable Publisher"]
        KafkaCluster{{"Apache Kafka Broker (Port 9092)\nTopic: workflow.events\nKey: tenantId:workflowId"}}
        SchemaRegistry["Schema Registry (Port 8081)\nCloudEvents 1.0 JSON Schemas"]

        WorkflowAPI -->|Transactional ACID Writes| PostgresWorkflow
        PostgresWorkflow -.->|Poll Unpublished Events| OutboxRelay
        OutboxRelay -->|Publish CloudEvents| KafkaCluster
        KafkaCluster -.->|Validate Schema| SchemaRegistry
    end

    subgraph Consumers["Asynchronous Event Consumers"]
        NotifService["Notification Service (Port 3001)\nConsumer Group: notification-service-group\nDeduplication & Alert Dispatcher"]
        AuditService["Audit Service (Port 3002)\nConsumer Group: audit-service-group\nImmutable Compliance Ledger"]
        PostgresAudit[("PostgreSQL: audit_db\n(audit_events table)")]

        KafkaCluster -->|Consume with traceparent| NotifService
        KafkaCluster -->|Consume with traceparent| AuditService
        AuditService -->|Persist Idempotently| PostgresAudit
    end

    subgraph Observability["Observability & Tracing Infrastructure"]
        Jaeger["Jaeger Tracing UI (Port 16686)\nOTLP HTTP Exporter (:4318)"]
        Prometheus["Prometheus Server (Port 9090)\nScrapes GET /metrics (:3000, :3001, :3002)"]
        KafkaUI["Kafka UI (Port 8085)"]
        PactBroker["Pact Broker (Port 9292)"]

        WorkflowAPI -.->|Export Spans (OTLP)| Jaeger
        NotifService -.->|Export Spans (OTLP)| Jaeger
        AuditService -.->|Export Spans (OTLP)| Jaeger
        Prometheus -.->|Scrape /metrics| WorkflowAPI
        Prometheus -.->|Scrape /metrics| NotifService
        Prometheus -.->|Scrape /metrics| AuditService
        KafkaCluster -.-> KafkaUI
    end

    HostApp -.->|Poll Notifications| NotifService
    HostApp -.->|Query Audit Trail| AuditService
```

---

## 2. Dynamic Multi-Step Workflow State Machine

The platform supports both single-step and tiered multi-step approval hierarchies based on financial thresholds (e.g. `< 10,000` = Team Lead; `10,000 - 100,000` = Team Lead $\rightarrow$ Dept Manager; `> 100,000` = Team Lead $\rightarrow$ Dept Manager $\rightarrow$ Finance Director) or custom step definitions:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': {'fontSize': '16px', 'fontFamily': 'Inter, sans-serif'}}}%%
stateDiagram-v2
    [*] --> DRAFT : Create Workflow (Generates Steps)
    DRAFT --> PENDING_STEP_1 : Submit for Review
    DRAFT --> CANCELLED : Cancel Request
    
    state "PENDING (Step 1: Team Lead)" as PENDING_STEP_1
    state "PENDING (Step 2: Dept Manager)" as PENDING_STEP_2
    state "PENDING (Step 3: Finance Director)" as PENDING_STEP_3

    PENDING_STEP_1 --> PENDING_STEP_2 : Approve Step 1 (workflow.step_approved.v1)
    PENDING_STEP_2 --> PENDING_STEP_3 : Approve Step 2 (workflow.step_approved.v1)
    PENDING_STEP_3 --> APPROVED : Approve Final Step (workflow.approved.v1)
    
    PENDING_STEP_1 --> APPROVED : Single-Step Workflow Approved
    
    PENDING_STEP_1 --> REJECTED : Reject with Reason (workflow.rejected.v1)
    PENDING_STEP_2 --> REJECTED : Reject with Reason (workflow.rejected.v1)
    PENDING_STEP_3 --> REJECTED : Reject with Reason (workflow.rejected.v1)

    PENDING_STEP_1 --> CANCELLED : Cancel by Requester
    
    APPROVED --> [*]
    REJECTED --> [*]
    CANCELLED --> [*]
```

---

## 3. End-to-End User Flows by Scenario

---

### 🟢 Case 1: Multi-Step Approval Flow (Happy Path)

**Business Goal**: An employee submits a major infrastructure expense ($150,000). The platform enforces a 3-step approval chain (Team Lead $\rightarrow$ Dept Manager $\rightarrow$ Finance Director).

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Requester (Alice)
    actor Bob as Team Lead (Bob)
    actor Charlie as Dept Manager (Charlie)
    actor Diana as Finance Director (Diana)
    participant API as Workflow API (:3000)
    participant DB as PostgreSQL (workflow_db)
    participant Outbox as Outbox Relay Worker
    participant Kafka as Kafka (workflow.events)
    participant Notif as Notification Service (:3001)
    participant Audit as Audit Service (:3002)

    Note over Alice,API: Phase 1: Creation & Submission
    Alice->>API: POST /api/v1/workflows (Amount: $150,000)
    API->>DB: INSERT workflow + 3 workflow_steps
    Alice->>API: POST /api/v1/workflows/:id/submit
    API->>DB: UPDATE status='PENDING' + INSERT outbox_events(submitted)
    API-->>Outbox: Trigger immediate dispatch
    Outbox->>Kafka: Publish CloudEvent (workflow.submitted.v1)
    Kafka->>Notif: Dispatch notification to Team Lead (Bob)
    Kafka->>Audit: Append submitted event to audit_events

    Note over Bob,API: Phase 2: Step 1 Approval (Team Lead)
    Bob->>API: POST /api/v1/workflows/:id/approve
    API->>DB: UPDATE step_1='APPROVED', currentStep=2 + INSERT outbox(step_approved)
    Outbox->>Kafka: Publish CloudEvent (workflow.step_approved.v1)
    Kafka->>Notif: Dispatch alert to Dept Manager (Charlie)
    Kafka->>Audit: Append step 1 approved event to audit_events (Actor: Bob, Role: TEAM_LEAD)

    Note over Charlie,API: Phase 3: Step 2 Approval (Dept Manager)
    Charlie->>API: POST /api/v1/workflows/:id/approve
    API->>DB: UPDATE step_2='APPROVED', currentStep=3 + INSERT outbox(step_approved)
    Outbox->>Kafka: Publish CloudEvent (workflow.step_approved.v1)
    Kafka->>Notif: Dispatch alert to Finance Director (Diana)
    Kafka->>Audit: Append step 2 approved event to audit_events (Actor: Charlie, Role: DEPT_MANAGER)

    Note over Diana,API: Phase 4: Final Step Approval (Finance Director)
    Diana->>API: POST /api/v1/workflows/:id/approve
    API->>DB: UPDATE step_3='APPROVED', status='APPROVED' + INSERT outbox(approved)
    Outbox->>Kafka: Publish CloudEvent (workflow.approved.v1)
    Kafka->>Notif: Dispatch final approval alert to Alice
    Kafka->>Audit: Append final approved event to immutable ledger (Actor: Diana, Role: FINANCE_DIRECTOR)
```

---

### 🟡 Case 2: Out-of-Office Delegation & Proxy Approval

**Business Goal**: Manager Bob is out of office and delegates approval authority to Proxy Colleague Eve.

```mermaid
sequenceDiagram
    autonumber
    actor Bob as Delegator (Bob)
    actor Eve as Proxy Approver (Eve)
    participant API as Workflow API
    participant DelSvc as Delegation Service
    participant DB as PostgreSQL
    participant Outbox as Outbox Relay

    Bob->>API: POST /api/v1/delegations (delegator: Bob, delegatee: Eve, validFrom: today, validUntil: +14d)
    API->>DB: INSERT delegations record
    
    Note over Eve,API: Pending request assigned to Bob
    Eve->>API: POST /api/v1/workflows/:id/approve (x-user-id: Eve)
    API->>DelSvc: isAuthorizedApprover(tenant, actor: Eve, targetApprover: Bob)
    DelSvc->>DB: Query active delegations within valid date range
    DelSvc-->>API: Authorized = true (isDelegated: true, delegatedFrom: Bob)
    API->>DB: UPDATE workflow_steps (acted_by: Eve, delegated_from: Bob, status: APPROVED)
    API->>DB: INSERT outbox_events (isDelegated: true, delegatedFrom: Bob)
    API-->>Eve: 200 OK (Approved via delegation)
```

---

### 🔒 Case 3: Dual-Write Resilience (Transactional Outbox Pattern)

**Business Goal**: Guarantee that database state changes and Kafka events are 100% consistent, even during network splits or Kafka broker crashes.

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant API as Workflow API
    participant DB as PostgreSQL
    participant Relay as Background Outbox Relay
    participant Kafka as Apache Kafka Broker

    Client->>API: POST /api/v1/workflows/:id/approve
    rect rgb(20, 50, 80)
        Note over API,DB: Single Atomic Database Transaction
        API->>DB: BEGIN TRANSACTION
        API->>DB: UPDATE workflows SET status='APPROVED'
        API->>DB: INSERT INTO outbox_events (payload: CloudEvent, published: FALSE)
        API->>DB: COMMIT TRANSACTION
    end
    API-->>Client: 200 OK (Immediate responsive client return)
    
    Note over Relay,Kafka: Kafka Broker Temporarily Down (Simulated Chaos)
    Relay->>DB: SELECT * FROM outbox_events WHERE published=FALSE
    Relay--xKafka: Attempt publish -> Connection Timeout!
    Relay->>DB: UPDATE outbox_events SET retry_count=retry_count+1, last_error='ECONNREFUSED'
    
    Note over Relay,Kafka: Kafka Recovers -> Outbox Drains
    Relay->>Kafka: Retry publish -> SUCCESS
    Relay->>DB: UPDATE outbox_events SET published=TRUE, published_at=NOW()
```

---

### 🛡️ Case 4: Idempotency Key & Concurrent Conflict Protection

**Business Goal**: Prevent duplicate financial approvals or double-submissions caused by client retries or network double-clicks.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant IdempMW as Idempotency Middleware
    participant DB as PostgreSQL (idempotency_keys)
    participant API as Workflow Engine

    Client->>IdempMW: POST /api/v1/workflows/:id/approve (Idempotency-Key: "idemp-001")
    IdempMW->>DB: INSERT idempotency_keys (key: "idemp-001", status: "PROCESSING")
    IdempMW->>API: Proceed to workflow state transition
    API-->>IdempMW: Returns 200 OK (data: Workflow)
    IdempMW->>DB: UPDATE idempotency_keys (status: "COMPLETED", response_body: Workflow)
    IdempMW-->>Client: 200 OK

    Note over Client,IdempMW: Duplicate / Retried Request with same Idempotency-Key
    Client->>IdempMW: POST /api/v1/workflows/:id/approve (Idempotency-Key: "idemp-001")
    IdempMW->>DB: SELECT * FROM idempotency_keys WHERE key="idemp-001"
    IdempMW-->>Client: 200 OK (x-idempotent-replay: true, Cached Body from DB)
```

---

### 📡 Case 5: Real-Time Live Sync (Server-Sent Events / SSE)

**Business Goal**: Instant, zero-polling reactive UI updates for approvers and requesters across browser tabs.

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Requester (Browser A)
    actor Bob as Approver (Browser B)
    participant HostApp as Host React UI
    participant NotifSvc as Notification Service (:3001)
    participant WFAPI as Workflow API (:3000)
    participant Kafka as Kafka Broker

    Alice->>NotifSvc: GET /api/v1/stream?tenantId=tenant-corp-a&userId=user-alice (SSE Connection)
    Bob->>NotifSvc: GET /api/v1/stream?tenantId=tenant-corp-a&userId=user-bob (SSE Connection)
    NotifSvc-->>Alice: Handshake { type: "connected", clientId: "..." }
    NotifSvc-->>Bob: Handshake { type: "connected", clientId: "..." }

    Note over Alice,WFAPI: Alice submits a new expense workflow
    Alice->>WFAPI: POST /api/v1/workflows/:id/submit
    WFAPI->>Kafka: Publish workflow.submitted.v1
    Kafka->>NotifSvc: Consume workflow.submitted.v1
    NotifSvc->>NotifSvc: SSEManager.broadcast(tenant-corp-a, event)
    NotifSvc-->>Bob: SSE event: workflow.submitted.v1 (Instant push!)
    Note over Bob: UI displays live Toast Popup & increments Approval Inbox badge without page refresh
```

---

### 🚨 Case 6: Kafka Dead Letter Queue (DLQ) & Poison-Pill Isolation

**Business Goal**: Prevent malformed messages or schema violations from blocking consumer group partitions or halting downstream workflow processing.

```mermaid
sequenceDiagram
    autonumber
    participant BadActor as Producer / Legacy Client
    participant Kafka as Kafka Broker
    participant AuditSvc as Audit Service Consumer
    participant AuditDB as PostgreSQL (audit_db)
    participant Admin as System Administrator

    BadActor->>Kafka: Publish malformed / invalid event to workflow.events
    Kafka->>AuditSvc: Consume message
    AuditSvc->>AuditSvc: Validate JSON Schema / Payload
    Note over AuditSvc: Schema validation error detected!
    AuditSvc->>Kafka: Route immediately to workflow.events.dlq (x-error-type: SCHEMA_VALIDATION_ERROR)
    AuditSvc->>AuditDB: Persist into dlq_messages table (status: DEAD_LETTERED)
    Note over AuditSvc: Main consumer partition continues processing next messages with zero lag

    Note over Admin,AuditSvc: Operator inspection & replay
    Admin->>AuditSvc: GET /api/v1/dlq/messages?status=DEAD_LETTERED
    Admin->>AuditSvc: POST /api/v1/dlq/replay/:id
    AuditSvc->>Kafka: Re-publish clean payload to workflow.events
    AuditSvc->>AuditDB: UPDATE dlq_messages SET status='REPLAYED'
```

---

### 🔀 Case 7: Configurable Workflow Rules & Parallel Approvals (AND/OR Quorums)

**Business Goal**: Tenant-configurable multi-approver routing supporting both unanimous AND quorums and first-responder OR quorums.

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Requester
    actor Legal as Legal Approver (User 1)
    actor Sec as Security Approver (User 2)
    participant WFAPI as Workflow API
    participant RulesEngine as Dynamic Rules Engine
    participant DB as PostgreSQL (workflow_db)

    Alice->>WFAPI: POST /api/v1/workflows (Type: ACCESS, Amount: 0)
    WFAPI->>RulesEngine: evaluateSteps(tenantId, ACCESS)
    RulesEngine->>DB: Query active workflow_rules for tenant
    RulesEngine-->>WFAPI: Generate 2 Parallel Steps (StepOrder: 1, Policy: ALL_MUST_APPROVE)
    Alice->>WFAPI: POST /api/v1/workflows/:id/submit

    Note over Legal,WFAPI: Legal Approves Step 1A
    Legal->>WFAPI: POST /api/v1/workflows/:id/approve (stepId: 1A)
    WFAPI->>DB: UPDATE workflow_steps SET status='APPROVED' WHERE id=1A
    WFAPI->>WFAPI: Evaluate Quorum: Step 1B is still PENDING -> Workflow remains PENDING
    WFAPI-->>Legal: 200 OK (Workflow status: PENDING)

    Note over Sec,WFAPI: Security Approves Step 1B
    Sec->>WFAPI: POST /api/v1/workflows/:id/approve (stepId: 1B)
    WFAPI->>DB: UPDATE workflow_steps SET status='APPROVED' WHERE id=1B
    WFAPI->>WFAPI: Evaluate Quorum: All parallel steps approved! -> Workflow transitions to APPROVED
    WFAPI-->>Sec: 200 OK (Workflow status: APPROVED)
```

---

### 🛡️ Case 8: PostgreSQL Row-Level Security (RLS) Database Hardening

**Business Goal**: Engine-level tenant isolation preventing cross-tenant data access even if application queries omit `WHERE tenant_id = ...`.

```mermaid
sequenceDiagram
    autonumber
    actor Attacker as Attacker (Tenant Beta)
    participant API as Workflow API
    participant ClientPool as PostgreSQL Connection Pool (withTenantContext)
    participant Postgres as PostgreSQL Engine (RLS Enforced)

    Attacker->>API: Malicious API Call (x-tenant-id: tenant-beta)
    API->>ClientPool: withTenantContext("tenant-beta", callback)
    ClientPool->>Postgres: BEGIN TRANSACTION
    ClientPool->>Postgres: SELECT set_config('app.current_tenant_id', 'tenant-beta', true)
    
    Note over ClientPool,Postgres: Attempt to query or insert Tenant Alpha data
    ClientPool->>Postgres: INSERT INTO workflows (id, tenant_id='tenant-alpha', ...)
    Postgres--xClientPool: ERROR: new row violates row-level security policy for table "workflows"
    ClientPool->>Postgres: ROLLBACK
    Postgres-->>API: 403 Forbidden / Security Violation
```

---

## 4. Multi-Tenant Security & Isolation Architecture

Every API request is evaluated under strict multi-layer tenant boundary enforcement:
1. **Header Ingestion**: `x-tenant-id` header is extracted and validated in `tenantMiddleware`. Missing header results in `400 MISSING_TENANT_ID`.
2. **PostgreSQL Row-Level Security (RLS)**: `FORCE ROW LEVEL SECURITY` enforced across all tables. Queries and mutations execute within scoped transactions using `withTenantContext` with `app.current_tenant_id`.
3. **Application Query Scoping**: All SQL queries include explicit `WHERE tenant_id = :tenantId`.
4. **Kafka Partition Keys**: All Kafka event messages are keyed by `tenantId:workflowId` ensuring strict ordering per tenant workflow partition.
5. **Consumer Deduplication**: `notification-service` and `audit-service` enforce tenant-scoped idempotency tables to ignore duplicate event deliveries.

---

## 5. Immutable Audit Trail & CloudEvents Compliance Lifecycle

Every action across a workflow's lifecycle is published as a versioned **CloudEvents 1.0** record, validated against JSON Schemas, and persisted to `audit_db.audit_events`:

| Event Type | Trigger | Key Data Fields | Audit UI Badge & Details |
|---|---|---|---|
| `workflow.submitted.v1` | Employee submits draft | `workflowId`, `tenantId`, `amount`, `requesterId`, `requesterName` | Shows initial submission timestamp & requester |
| `workflow.step_approved.v1` | Approver reviews intermediate step | `workflowId`, `actorId`, `currentStepOrder`, `totalSteps`, `stepRole`, `comment`, `isDelegated` | `Step X of Y (ROLE)` badge + approver comment |
| `workflow.approved.v1` | Final approver completes workflow | `workflowId`, `actorId`, `currentStepOrder`, `totalSteps`, `stepRole`, `comment` | Final `APPROVED` badge + approver comment |
| `workflow.rejected.v1` | Approver rejects workflow | `workflowId`, `actorId`, `currentStepOrder`, `rejectionReason` | `REJECTED` badge + mandatory rejection reason |
| `workflow.cancelled.v1` | Requester cancels request | `workflowId`, `actorId`, `comment` | `CANCELLED` badge + cancellation note |

---

## 6. End-to-End Distributed Tracing & W3C Context Propagation

Distributed tracing connects client browser user actions, synchronous Fastify HTTP APIs, asynchronous PostgreSQL/Drizzle database queries, and Apache Kafka consumers into unified end-to-end trace graphs:

```mermaid
sequenceDiagram
    autonumber
    actor Client as Web Browser / Host App
    participant API as workflow-api (Fastify :3000)
    participant DB as PostgreSQL (workflow_db)
    participant Outbox as Outbox Relay
    participant Kafka as Kafka Broker (workflow.events)
    participant Audit as audit-service (Consumer :3002)
    participant Notif as notification-service (Consumer :3001)
    participant Jaeger as Jaeger OTLP Collector (:4318)

    Client->>Client: Generate W3C TraceContext (traceparent: 00-1fa908e3...-3e99ec29...-01)<br/>Attach x-correlation-id: req-mu9em...
    Client->>API: POST /api/v1/workflows/:id/approve (with traceparent & tenant headers)
    Note over API: Fastify Telemetry Plugin binds trace context<br/>Root Span: POST /api/v1/workflows/:id/approve
    
    API->>DB: Execute SQL Update via Drizzle (AsyncLocalStorage Context)
    Note over API,DB: Child Span: db.query (db.system: postgresql, db.operation: UPDATE)
    DB-->>API: Row updated + Outbox record inserted
    
    API->>Outbox: Outbox event prepared with traceparent header
    API->>Jaeger: Export HTTP Root Span + Child DB Spans (OTLP)
    API-->>Client: 200 OK (Exposed Headers: traceparent, x-correlation-id)

    Outbox->>Kafka: Publish event with Kafka Header `traceparent` & `correlationId`
    
    par Kafka Consumer: Audit Service
        Kafka->>Audit: Consume workflow.step_approved.v1
        Note over Audit: Read Kafka Header `traceparent`<br/>Start Child Span (parentSpanId: "3e99ec29...")
        Audit->>Audit: Persist to audit_events (Child DB Span: db.query INSERT)
        Audit->>Jaeger: Export Consumer Span + DB Child Span
    and Kafka Consumer: Notification Service
        Kafka->>Notif: Consume workflow.step_approved.v1
        Note over Notif: Read Kafka Header `traceparent`<br/>Start Child Span (parentSpanId: "3e99ec29...")
        Notif->>Notif: Create in-app notification & broadcast SSE
        Notif->>Jaeger: Export Consumer Span
    end

    Note over Jaeger: Unified Multi-Service Trace Tree Formed! (5+ Spans across Browser, API, DB & Consumers)
```

---

## 7. Live Service Endpoints & Management Matrix

| Component / Tool | Port (Local / K8s) | Working URL | Description |
|---|---|---|---|
| **Host Application (React + Vite)** | `5173` / `8080` | [http://localhost:8080](http://localhost:8080) | Main UI: Real-Time SSE Sync, Expenses, Parallel Approvals, Audit Log & W3C Tracing |
| **Workflow API** | `3000` | [http://localhost:3000/ready](http://localhost:3000/ready) | Fastify REST API: Dynamic Rules (`/api/v1/rules`), Deep Probes (`/health/live`, `/health/ready`) & Outbox Relay |
| **Notification Service** | `3001` | [http://localhost:3001/health](http://localhost:3001/health) | Kafka consumer, alerts API & SSE live stream (`/api/v1/stream`) |
| **Audit Service** | `3002` | [http://localhost:3002/health](http://localhost:3002/health) | Kafka consumer, immutable audit trail & DLQ Replay API (`/api/v1/dlq/messages`) |
| **Grafana Dashboards** | `3005` | [http://localhost:3005](http://localhost:3005) | Provisioned Dashboards: System Health, DB Pool & Outbox Reliability |
| **Kafka Web UI** | `8085` | [http://localhost:8085](http://localhost:8085) | Real-time Kafka topic inspector, DLQ monitor & consumer group lag viewer |
| **Jaeger Distributed Tracing** | `16686` | [http://localhost:16686](http://localhost:16686) | Visual distributed trace explorer (OTLP receiver on `:4318`) with DB query spans |
| **Prometheus Server** | `9090` | [http://localhost:9090](http://localhost:9090) | Prometheus metrics dashboard & alerting rules (scrapes `/metrics`) |
| **PostgreSQL Database** | `5433` | `localhost:5433` | Databases: `workflow_db`, `audit_db` (RLS Enforced, User: `postgres`, Pass: `postgres`) |

---

## 8. Fast Kubernetes Redeployment & Hot-Reload Shortcuts

| Command / Shortcut | Target | Duration | Description |
|---|---|---|---|
| `npm run k8s:reload:ui` | Frontend (`host-app`) | **~3 seconds** | Compiles Vite locally and syncs directly into running NGINX pods via `kubectl cp` with zero downtime |
| `npm run k8s:reload:api` | Backend (`workflow-api`) | **~15 seconds** | Rebuilds TypeScript backend, imports into containerd, and triggers rolling restart |
| `npm run k8s:reload` | Full Cluster | **~45 seconds** | Rebuilds all services (`host-app`, `workflow-api`, `notification-service`, `audit-service`) and restarts pods |
| `.\k8s\local\start-port-forwards.ps1` | All Port-Forwards | **~1 second** | Starts background tunnels for all microservices, UI, Grafana, Kafka UI, and PostgreSQL |
| `.\k8s\local\stop-port-forwards.ps1` | All Port-Forwards | **~1 second** | Stops all active `kubectl port-forward` background processes cleanly |

---

## 9. Data Cleanup & Testing Reset (Start Afresh)

| Command / Script | Scope | Downtime | What Gets Cleared |
|---|---|---|---|
| `npm run k8s:reset:data`<br>`.\k8s\local\reset-data.ps1`<br>`./k8s/local/reset-data.sh` | **Fast Reset** | **~1s (Instant)** | Truncates all tables in `workflow_db` and `audit_db`, and automatically purges Kafka topic (`workflow.events`) messages. |
| `npm run k8s:reset:hard`<br>`.\k8s\local\reset-data.ps1 -HardReset`<br>`./k8s/local/reset-data.sh --hard` | **Hard Reset** | **~15s** | Deletes `postgres-pvc`, wipes disk volume, re-applies manifests with fresh databases, and restarts backend services. |
| `docker compose down -v` | **Compose Reset** | **~5s** | Drops all Docker volumes (`postgres-data`, `kafka-data`) for fresh local Docker Compose startup. |

---

## 10. Verification & Test Suite Summary

The entire platform architecture is validated with automated tests:
* **Contract Tests**: Fastify route OpenAPI/Pact contracts and CloudEvents JSON Schema validation (`schema-compatibility.test.ts`).
* **Unit Tests**: Multi-step state machine, dynamic rules engine, parallel quorum evaluation, SSE manager, outbox relay logic, StructuredLogger, DB query spans, client W3C tracing, and Deep Health probes.
* **Integration Tests**: Kafka consumer message processing, DLQ poison-pill isolation, and idempotency deduplication (`kafka-events.test.ts`, `kafka-dlq.integration.test.ts`, `workflow-lifecycle.integration.test.ts`).
* **Security Tests**: Multi-tenant isolation test matrix and PostgreSQL Row-Level Security (RLS) enforcement suite (`tenant-isolation.test.ts`, `postgres-rls.test.ts`).

Run the automated test suite with:
```bash
npm test
```
*(95 tests passed across 19 test suites).*


