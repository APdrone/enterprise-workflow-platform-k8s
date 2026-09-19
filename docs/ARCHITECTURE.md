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

## 4. Multi-Tenant Security & Isolation Architecture

Every API request is evaluated under strict tenant boundary enforcement:
1. **Request Ingestion**: `x-tenant-id` header is extracted and validated in `tenantMiddleware`. Missing header results in `400 MISSING_TENANT_ID`.
2. **Data Partitioning**: All SQL queries include mandatory `WHERE tenant_id = :tenantId`.
3. **Kafka Partition Keys**: All Kafka event messages are keyed by `tenantId:workflowId` ensuring strict ordering per tenant workflow partition.
4. **Consumer Deduplication**: `notification-service` and `audit-service` enforce tenant-scoped idempotency tables to ignore duplicate event deliveries.

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

Distributed tracing connects asynchronous microservices communicating via HTTP and Apache Kafka into unified end-to-end trace graphs:

```mermaid
sequenceDiagram
    autonumber
    actor Client as Web UI / Client
    participant API as workflow-api (HTTP)
    participant Outbox as Outbox Relay
    participant Kafka as Kafka Broker (workflow.events)
    participant Audit as audit-service (Consumer)
    participant Notif as notification-service (Consumer)
    participant Jaeger as Jaeger OTLP Collector (:4318)

    Client->>API: POST /api/v1/workflows/:id/approve
    Note over API: Start Root Span (traceId: "1fa908e3...", spanId: "3e99ec29...")
    API->>Outbox: Save to outbox (traceparent: "00-1fa908e3...-3e99ec29...-01")
    API->>Jaeger: Export HTTP Root Span (34ms)
    API-->>Client: 200 OK (Header: traceparent: 00-1fa908e3...)

    Outbox->>Kafka: Publish event with Kafka Header `traceparent`
    
    par Kafka Consumer: Audit Service
        Kafka->>Audit: Consume workflow.step_approved.v1
        Note over Audit: Read Kafka Header `traceparent`<br/>Start Child Span (parentSpanId: "3e99ec29...")
        Audit->>Audit: Persist to audit_events
        Audit->>Jaeger: Export Child Span (52ms)
    and Kafka Consumer: Notification Service
        Kafka->>Notif: Consume workflow.step_approved.v1
        Note over Notif: Read Kafka Header `traceparent`<br/>Start Child Span (parentSpanId: "3e99ec29...")
        Notif->>Notif: Create in-app notification
        Notif->>Jaeger: Export Child Span (3ms)
    end

    Note over Jaeger: Unified Multi-Service Trace Tree Formed! (3 Spans across 3 microservices)
```

### Trace Span Hierarchy in Jaeger:
When viewing an approval or submission trace in Jaeger UI (`http://localhost:16686`):
1. **Root Span**: `workflow-api` &rarr; `POST /api/v1/workflows/:id/approve`
2. **Child Span A**: `audit-service` &rarr; `Kafka Consume: workflow.step_approved.v1` (linked via `parentSpanId`)
3. **Child Span B**: `notification-service` &rarr; `Kafka Consume: workflow.step_approved.v1` (linked via `parentSpanId`)

---

## 7. Live Service Endpoints & Management Matrix

| Component / Tool | Port (Local / K8s) | Working URL | Description |
|---|---|---|---|
| **Host Application (React + Vite)** | `5173` / `8080` | [http://localhost:5173](http://localhost:5173) | Main UI: Multi-step Expense management, Approvals inbox, Audit log, Notifications |
| **Workflow Widget Playground** | `3003` | [http://localhost:3003](http://localhost:3003) | Standalone demo page for `<workflow-widget>` Web Component |
| **Workflow API** | `3000` | [http://localhost:3000/ready](http://localhost:3000/ready) | Fastify REST API: Multi-step state machine, Outbox relay, Delegations & Idempotency |
| **Notification Service** | `3001` | [http://localhost:3001/health](http://localhost:3001/health) | Kafka event consumer & multi-step notification query API |
| **Audit Service** | `3002` | [http://localhost:3002/health](http://localhost:3002/health) | Kafka event consumer & immutable audit trail REST API |
| **Kafka Web UI** | `8085` | [http://localhost:8085](http://localhost:8085) | Real-time Kafka topic inspector, consumer group lag monitor & message viewer |
| **Jaeger Distributed Tracing** | `16686` | [http://localhost:16686](http://localhost:16686) | Visual distributed trace explorer (OTLP receiver on `:4318`) |
| **Prometheus Server** | `9090` | [http://localhost:9090](http://localhost:9090) | Prometheus metrics dashboard (scrapes `/metrics`) |
| **PostgreSQL Database** | `5433` | `localhost:5433` | Databases: `workflow_db`, `audit_db`, `pact_db` (User: `postgres`, Pass: `postgres`) |
| **Pact Broker** | `9292` | [http://localhost:9292](http://localhost:9292) | Consumer-Driven Contract testing broker |

---

## 8. Fast Kubernetes Redeployment & Hot-Reload Shortcuts

| Command / Shortcut | Target | Duration | Description |
|---|---|---|---|
| `npm run k8s:reload:ui` | Frontend (`host-app`) | **~3 seconds** | Compiles Vite locally and syncs directly into running NGINX pods via `kubectl cp` with zero downtime |
| `npm run k8s:reload:api` | Backend (`workflow-api`) | **~15 seconds** | Rebuilds TypeScript backend, imports into containerd, and triggers rolling restart |
| `npm run k8s:reload` | Full Cluster | **~45 seconds** | Rebuilds all services (`host-app`, `workflow-api`, `notification-service`, `audit-service`) and restarts pods |
| `.\k8s\local\start-port-forwards.ps1` | All Port-Forwards | **~1 second** | Starts background tunnels for all 8 microservices, UI, Kafka UI, and PostgreSQL |
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
* **Unit Tests**: Multi-step state machine, dynamic threshold routing, outbox relay logic, and delegation checks (`workflow.state-machine.test.ts`, `outbox.relay.test.ts`).
* **Integration Tests**: Kafka consumer message processing, schema validation, and idempotency deduplication (`kafka-events.test.ts`, `workflow-lifecycle.integration.test.ts`).
* **Security Tests**: Multi-tenant isolation test matrix (`tenant-isolation.test.ts`).

Run the automated test suite with:
```bash
npm run test
```

