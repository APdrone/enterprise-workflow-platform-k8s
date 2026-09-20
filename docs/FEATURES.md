# 🌟 Enterprise Workflow Platform — Feature Catalog & Capabilities Reference

This document provides a comprehensive, structured catalog of all features, capabilities, and design patterns implemented across the **Event-Driven Multi-Tenant Workflow Platform**.

---

## Table of Contents
1. [Multi-Tier Dynamic Approval Engine](#1-multi-tier-dynamic-approval-engine)
2. [Out-of-Office & Proxy Delegation](#2-out-of-office--proxy-delegation)
3. [Transactional Outbox & Dual-Write Resilience](#3-transactional-outbox--dual-write-resilience)
4. [Kafka Event Streaming & CloudEvents 1.0](#4-kafka-event-streaming--cloudevents-10)
5. [End-to-End Distributed Tracing (W3C TraceContext)](#5-end-to-end-distributed-tracing-w3c-tracecontext)
6. [Multi-Tenancy & Data Isolation](#6-multi-tenancy--data-isolation)
7. [Idempotency & Concurrency Protection](#7-idempotency--concurrency-protection)
8. [Microfrontends & Web Component Architecture](#8-microfrontends--web-component-architecture)
9. [Downstream Microservices (Audit & Notifications)](#9-downstream-microservices-audit--notifications)
10. [Observability & Infrastructure Monitoring](#10-observability--infrastructure-monitoring)
11. [Kubernetes, Cloud-Native DevOps & Hot-Reloads](#11-kubernetes-cloud-native-devops--hot-reloads)
12. [Multi-Layer Quality Engineering & Automated Testing](#12-multi-layer-quality-engineering--automated-testing)

---

## 1. Multi-Tier Dynamic Approval & Configurable Rules Engine

The core workflow engine implements a resilient, deterministic finite state machine (FSM) supporting dynamic threshold-based approval chains and tenant-configurable routing matrices:

* **Tenant-Scoped Dynamic Rules Engine**:
  * Define and prioritize custom workflow matrices matching by `workflowType`, amount range (`minAmount`, `maxAmount`), and `department`.
  * Highest priority rule matches first; seamless fallback to standard tiered matrix if no custom rule applies.
* **Parallel Approval Quorums (AND / OR Groups)**:
  * **AND Quorum (`ALL_MUST_APPROVE`)**: Requires unanimous approval across all sibling approvers in the same step order before advancing the workflow.
  * **OR Quorum (`ANY_CAN_APPROVE`)**: First-responder policy where the first approval satisfies the step order and automatically transitions remaining sibling steps to `SKIPPED`.
* **Dynamic Financial Threshold Routing (Default Matrix)**:
  * **Tier 1 ($<\$10,000$)**: Single-step approval by `Team Lead` (`user-bob`).
  * **Tier 2 ($\$10,000 - \$100,000$)**: Two-tier approval chain (`Team Lead` $\rightarrow$ `Dept Manager` / `user-carol`).
  * **Tier 3 ($>\$100,000$)**: Multi-reviewer parallel approval chain (`Team Lead` $\rightarrow$ `Dept Manager` $\rightarrow$ Parallel Review by `Finance Director` and `VP Approval`).
* **Custom Step Hierarchy Support**:
  * Ability to supply explicit `customSteps` array during workflow creation with `parallelGroup` and `policy` definitions.
* **Deterministic Lifecycle States**:
  * `DRAFT` $\rightarrow$ `PENDING` $\rightarrow$ `APPROVED` | `REJECTED` | `CANCELLED`.
* **Step-Level State Tracking**:
  * Intermediate steps track `stepOrder`, `stepRole`, `approverId`, `status` (`PENDING`, `APPROVED`, `REJECTED`, `SKIPPED`), `policy`, `parallelGroup`, `actedBy`, `actedAt`, and `comment`.
* **Mandatory Rejection Auditing**:
  * Rejections require an explicit `reason` string, recorded in both the workflow record and the downstream immutable audit log, with automatic skipping of pending parallel sibling steps.
* **Requester Cancellation**:
  * Requesters can voluntarily cancel pending workflows before finalization.

---

## 2. Out-of-Office & Proxy Delegation

Enables designated approvers to delegate approval authority to a proxy during leaves or absences:

* **Time-Bounded Delegation Rules**:
  * Delegations define `delegatorId`, `delegateeId`, `validFrom`, `validUntil`, and an optional `reason`.
* **Real-Time Authority Validation**:
  * When an approver submits an action, the engine checks active delegations in PostgreSQL within the valid timestamp window.
* **Proxy Action Attribution**:
  * Audit logs and workflow step records explicitly record both the actual actor (`actedBy`) and the original approver (`delegatedFrom`), ensuring non-repudiation.

---

## 3. Transactional Outbox & Dual-Write Resilience

Guarantees 100% data consistency between PostgreSQL state mutations and Kafka event streaming without distributed two-phase commit (2PC) overhead:

* **Single Atomic ACID Transaction**:
  * Workflow updates and outbound CloudEvents are inserted into `outbox_events` in the same database transaction.
* **Zero Event Loss During Kafka Outages**:
  * If Kafka brokers crash or encounter network timeouts, API requests succeed with `200 OK`, while unpublished events (`published = false`) safely accumulate in PostgreSQL.
* **Reliable Outbox Relay Background Worker**:
  * Background worker polls unpublished outbox records, dispatches them to Kafka, updates `retry_count` upon failures, and marks records `published = true` once acknowledged.

---

## 4. Kafka Event Streaming & CloudEvents 1.0

Event-driven backbone connecting asynchronous consumers via standard messaging patterns:

* **CloudEvents 1.0 Specification Compliance**:
  * All events adhere to standard CloudEvents envelopes (`id`, `source`, `specversion: "1.0"`, `type`, `time`, `datacontenttype: "application/json"`, `data`).
* **Runtime JSON Schema Validation**:
  * Pre-serialization validation using shared schemas in `packages/shared-schemas`.
* **Guaranteed Per-Workflow Ordering**:
  * All Kafka records are keyed by `tenantId:workflowId`, ensuring strict in-order processing within tenant partitions on the `workflow.events` topic.
* **Domain Event Types**:
  * `workflow.submitted.v1`
  * `workflow.step_approved.v1`
  * `workflow.approved.v1`
  * `workflow.rejected.v1`
  * `workflow.cancelled.v1`

---

## 5. End-to-End Distributed Tracing (W3C TraceContext)

* **OpenTelemetry End-to-End Distributed Tracing**:
  * Distributed context propagation following W3C `traceparent` specifications across all services (`workflow-api`, `notification-service`, `audit-service`).
  * Fastify API initializes root HTTP span and returns `traceparent` header.
  * Outbox Relay embeds `traceparent` into Kafka record headers.
  * `audit-service` and `notification-service` consumers extract the trace header and spawn child spans linked to the root span (`parentSpanId`).
* **Database Query Spans & AsyncLocalStorage Context Propagation**:
  * Low-level PostgreSQL connection pool query interception (`instrumentPgPool`) capturing exact query latency, `db.system = "postgresql"`, `db.operation`, `db.statement`, and `db.name`.
  * Node.js `AsyncLocalStorage` (`traceStorage`) propagates active HTTP request and Kafka consumer spans to child database queries executed through Drizzle ORM and `pg.Pool`.
  * Explicit helper `traceDbQuery` for nested database transactions and queries.
* **Frontend W3C Traceparent Inception**:
  * Browser client applications (`host-app` and `workflow-widget`) generate root W3C `traceparent` headers (`00-{32 hex traceId}-{16 hex spanId}-01`) and correlation IDs (`x-correlation-id`) at the exact point of user interaction.
  * `tracedFetch` and `createTracedHeaders` utilities in `@workflow/telemetry/client` propagate client traces across all REST mutations and queries.
  * Complete lifecycle visibility: **Browser User Click $\rightarrow$ Fastify HTTP Gateway $\rightarrow$ PostgreSQL Query Execution $\rightarrow$ Transactional Outbox Relay $\rightarrow$ Apache Kafka $\rightarrow$ Audit/Notification Consumers**.
* **Jaeger Tracing Visualization**:
  * Complete multi-tier waterfall view in Jaeger UI showing exact latencies across browser dispatch, HTTP handling, database query execution, Kafka queueing, and consumer persistence.

---

## 6. Multi-Tenancy, Data Isolation & PostgreSQL Row-Level Security (RLS)

Strict defense-in-depth multi-tenant security architecture designed to prevent data leakage at both the application and database engine layers:

* **PostgreSQL Row-Level Security (RLS) Enforcement**:
  * All tenant-partitioned database tables (`workflows`, `workflow_steps`, `workflow_rules`, `delegations`, `idempotency_keys`, `outbox_events`, `audit_events`, `dlq_messages`) have RLS **enabled and forced** (`FORCE ROW LEVEL SECURITY`).
  * Dynamic policies check `tenant_id = current_setting('app.current_tenant_id', true)` with `WITH CHECK` constraints blocking unauthorized cross-tenant writes at the PostgreSQL kernel level.
  * Transaction-scoped helpers (`withTenantContext`) use `set_config(..., true)` to prevent connection pool session variable leakage.
* **Header-Based Boundary Enforcement**:
  * Mandatory `x-tenant-id` header validated on all API endpoints via `tenantMiddleware`. Missing headers immediately return `400 MISSING_TENANT_ID`.
* **Database Query Scoping**:
  * All SQL queries explicitly filter by `WHERE tenant_id = :tenantId`.
* **Kafka Message Partitioning**:
  * Kafka events partitioned by tenant ID to isolate tenant stream processing.
* **Consumer-Side Tenant Scoping**:
  * Downstream services isolate audit logs and notifications strictly within tenant boundaries.

---

## 7. Idempotency & Concurrency Protection

Prevents duplicate financial executions caused by network retries, double-clicks, or delayed client timeouts:

* **`Idempotency-Key` Header Middleware**:
  * Tracks request keys in the `idempotency_keys` table with statuses (`PROCESSING`, `COMPLETED`, `FAILED`).
* **Cached Response Replay**:
  * Duplicate incoming requests with the same key return the cached response with `x-idempotent-replay: true` header without re-executing state mutations.

---

## 8. Microfrontends & Web Component Architecture

Decoupled frontend architecture providing both a full-featured management shell and embeddable widgets:

* **Host Shell Application (`apps/host-app`)** (Port `5173` / `8080`):
  * Built with React 18, TypeScript, and Vite.
  * Features a Tenant Switcher, Role Selector, Expense Creation Form, Approvals Inbox, Audit Trail Timeline, and Live Alert Notifications.
* **Standalone Web Component (`apps/workflow-widget`)** (Port `3003`):
  * Zero-dependency custom element `<workflow-widget>` compiled with Shadow DOM encapsulation.
  * Can be embedded into any external host application (React, Angular, Vue, or Vanilla HTML) via standard HTML attributes.

---

## 9. Downstream Microservices (Audit & Notifications)

Specialized asynchronous microservices consuming domain events from Kafka:

* **Audit Service (`services/audit-service`)** (Port `3002`):
  * Consumes `workflow.events` and writes immutable event records to `audit_db.audit_events`.
  * Exposes REST endpoints to query chronological audit histories with actor attribution.
* **Notification Service (`services/notification-service`)** (Port `3001`):
  * Consumes `workflow.events`, performs message deduplication, and generates targeted in-app alerts.
  * Exposes REST endpoints for the Host App to fetch unread/read notifications.

---

## 10. Observability & Infrastructure Monitoring

The platform provides a telemetry and monitoring stack deployed alongside all services:

### 10.1 Current Telemetry Implementation
* **Distributed Tracing (W3C TraceContext & Jaeger)**:
  * OpenTelemetry-compatible tracing via custom tracer with OTLP HTTP span exporter (`:4318` / UI `:16686`).
  * End-to-end W3C `traceparent` propagation across Fastify HTTP requests, Transactional Outbox metadata, and Kafka record headers.
  * Downstream consumer span correlation in `notification-service` and `audit-service`.
* **Prometheus Metrics Scrapes (`:9090`)**:
  * Custom Prometheus text exposition registry in `packages/telemetry`.
  * Exposes HTTP RED metrics (Rate: `http_requests_total`, Duration: `http_request_duration_seconds`, Error statuses).
  * Kafka throughput counters (`kafka_events_published_total`, `kafka_events_consumed_total`).
  * Process memory and uptime metrics (`nodejs_memory_heap_used_bytes`, `process_uptime_seconds`).
* **Kafka Cluster Inspection (`:8085`)**:
  * Kafka UI for real-time inspection of topics (`workflow.events`, `workflow.events.retry`, `workflow.events.dlq`), partition offsets, consumer group lag, and payload schemas.

### 10.2 Observability Architecture & Improvement Roadmap
The following enhancements outline the target observability maturity model for enterprise production readiness:

| Pillar | Current Implementation | Enhancement Roadmap |
| :--- | :--- | :--- |
| **Distributed Tracing** | HTTP boundary and Kafka consumer spans exported to Jaeger. | • **Database Spans**: Instrument PostgreSQL queries (Drizzle ORM / `pg`) to capture SQL query durations as child spans.<br>• **Async Context**: Integrate `AsyncLocalStorage` for automatic trace context propagation without manual argument passing.<br>• **Frontend Inception**: Have the Web Component and Host App initiate root W3C traces for user actions. |
| **Metrics & Dashboards** | Prometheus scraping basic RED and Kafka event counters. | • **Grafana Dashboards**: Pre-provisioned dashboards for Service RED metrics, Kafka consumer lag, and Outbox throughput.<br>• **Outbox & DLQ Telemetry**: Export `outbox_unpublished_events_total` (gauge) and `dlq_messages_total{error_type}`.<br>• **Connection Pool Metrics**: Track PostgreSQL active/idle connections and waiting query queues.<br>• **Workflow Domain KPIs**: Workflow completion cycle times, approval turnaround time, and rejection rates per tenant. |
| **Structured Logging** | Fastify logging in API; `console.log` in downstream workers. | • **Unified Structured Logging**: Standardize on structured JSON logging (Pino) across all microservices.<br>• **Trace-to-Log Correlation**: Automatically inject `trace_id`, `span_id`, `tenant_id`, and `correlation_id` into log context for instant pivot between Jaeger traces and container logs. |
| **Health Probes** | Shallow `/health` endpoint returning `{ status: 'ok' }`. | • **Liveness vs Readiness Probes**: Split into `/health/live` (process responsiveness) and `/health/ready` (deep dependency check validating active DB ping `SELECT 1` and Kafka broker metadata). |
| **Alerting & SLOs** | No automated alert rule evaluation. | • **Prometheus Alert Rules**: Automated alerts for high 5xx error rates (>1%), growing Outbox backlogs, DLQ poison-pill surges, and consumer disconnects. |

---

## 11. Kubernetes, Cloud-Native DevOps & Hot-Reloads

Production-grade Kubernetes manifests and local development automation:

* **Kubernetes Manifests (`k8s/`)**:
  * Namespace isolation, ConfigMaps, Secrets, PostgreSQL StatefulSet, Kafka Broker, Deployments, Services, and HPAs.
* **1-Click Local Scripts**:
  * `deploy-local.ps1` / `deploy-local.sh`: Complete cluster deployment.
  * `start-port-forwards.ps1` / `stop-port-forwards.ps1`: Automated tunnel management.
* **Fast Redeployment & Hot-Reload Shortcuts**:
  * `npm run k8s:reload:ui` (~3s zero-downtime Vite sync directly into running NGINX pods).
  * `npm run k8s:reload:api` (~15s TypeScript compile and rolling container restart).
* **Instant Data Cleanup**:
  * `npm run k8s:reset:data` (~1s table truncation and Kafka topic purge for fresh test runs).

---

## 12. Multi-Layer Quality Engineering & Automated Testing

Comprehensive test pyramid validating reliability, contracts, and security:

* **Unit & State Machine Tests**:
  * Multi-step state transitions, threshold calculations, and outbox relay retries (`workflow.state-machine.test.ts`, `outbox.relay.test.ts`).
* **Contract Tests (Pact & Schemas)**:
  * Consumer-driven contracts between services and CloudEvents schema compatibility (`schema-compatibility.test.ts`).
* **Integration Tests**:
  * Kafka consumer event processing, message deduplication, and outbox-to-Kafka pipelines.
* **Security & Isolation Tests**:
  * Multi-tenant boundary verification and cross-tenant data leakage tests (`tenant-isolation.test.ts`).
* **End-to-End Browser Tests**:
  * Playwright automated browser tests simulating complete multi-tier expense creation, approvals, and audit trail verification.
