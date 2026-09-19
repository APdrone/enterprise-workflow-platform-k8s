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
        HostApp["🖥️ Host Web App (Port 8080 / 5173)\nReact + Vite Dashboard"]
        Widget["🧩 Workflow Widget (Port 3003)\nFramework-Agnostic Web Component (Shadow DOM)"]
    end

    subgraph API["Workflow Gateway & Core Service"]
        WFAPI["⚙️ Workflow API (Port 3000)\nFastify + State Machine Engine"]
        OutboxRelay["🔄 Transactional Outbox Relay\n(Immediate Dispatch + 1s Resilience Poller)"]
    end

    subgraph DB["Database Layer (PostgreSQL 16)"]
        WFDB[("🗄️ workflow_db\n(workflows, workflow_steps, outbox_events, idempotency_keys)")]
        AuditDB[("🗄️ audit_db\n(audit_events immutable ledger)")]
    end

    subgraph Messaging["Distributed Event Stream (Apache Kafka)"]
        Broker["📨 Kafka Broker (Port 9092)\nTopic: workflow.events (3 Partitions)"]
        KafkaUI["📊 Kafka UI (Port 8085)\nTopic & Consumer Group Inspector"]
    end

    subgraph Consumers["Downstream Microservices"]
        NotifSvc["🔔 Notification Service (Port 3001)\nIdempotent Alerts Consumer & Query API"]
        AuditSvc["📜 Audit Service (Port 3002)\nCloudEvents 1.0 Compliance Consumer & API"]
    end

    subgraph Observability["Observability & Distributed Tracing"]
        Jaeger["🔭 Jaeger Tracing (Port 16686 / OTLP 4318)\nEnd-to-End Multi-Span Waterfall Graphs"]
        Prometheus["📈 Prometheus Server (Port 9090)\nMetrics Scraping (/metrics)"]
    end

    HostApp -->|REST API + Tenant Headers| WFAPI
    Widget -->|Custom Events & REST| WFAPI
    WFAPI -->|1. Atomic Transaction (Workflow + Outbox)| WFDB
    WFDB -->|2. Poll Unpublished Events| OutboxRelay
    OutboxRelay -->|3. Publish CloudEvent with traceparent| Broker
    Broker -->|Consume workflow.events| NotifSvc
    Broker -->|Consume workflow.events| AuditSvc
    AuditSvc -->|Persist Audit Record| AuditDB
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

1. **Transactional Outbox Pattern (Dual-Write Resilience)**:
   - Workflow state updates and outbound CloudEvents are committed in a **single atomic PostgreSQL ACID transaction**.
   - Zero event loss during Kafka outages: API returns `200 OK` immediately while events accumulate safely in `outbox_events` (`published = false`).
   - The Outbox Relay automatically drains the backlog with exponential backoff once Kafka recovers.
2. **End-to-End Distributed Tracing (W3C TraceContext)**:
   - Root HTTP span initialized on `POST /api/v1/workflows/:id/approve` or `submit`.
   - `traceparent` (`00-{traceId}-{spanId}-01`) persisted into outbox records and injected into Kafka message headers.
   - `audit-service` and `notification-service` consumers extract the header to attach child spans (`parentSpanId`), forming unified 3-service trace graphs in **Jaeger UI**.
3. **Multi-Tier Dynamic Approval Hierarchy**:
   - Dynamic threshold evaluation based on expense amount:
     - **< $10,000**: Single-tier (`Team Lead`).
     - **$10,000 – $100,000**: Two-tier (`Team Lead` $\rightarrow$ `Dept Manager`).
     - **> $100,000**: Three-tier (`Team Lead` $\rightarrow$ `Dept Manager` $\rightarrow$ `Finance Director`).
4. **Multi-Tenant Security & Isolation**:
   - Strict tenant boundary enforcement (`x-tenant-id` header validation).
   - SQL query scoping (`WHERE tenant_id = :tenantId`) and Kafka message partition keys (`tenantId:workflowId`).
5. **Idempotency & Concurrent Conflict Protection**:
   - Native `idempotency-key` header pre-handler caches and deduplicates requests (`x-idempotent-replay: true`).
6. **Microfrontend Web Component (`<workflow-widget>`)**:
   - Zero-dependency custom element encapsulated in Shadow DOM, embeddable inside any host application (React, Angular, Vue, or Vanilla HTML).

---

## 📂 Repository Layout

```text
.
├── apps/
│   ├── host-app/               # React 18 + Vite host dashboard (Approvals Inbox, Expenses, Audit, Alerts)
│   └── workflow-widget/        # Framework-agnostic Web Component (<workflow-widget>) in Shadow DOM
├── services/
│   ├── workflow-api/           # Core Fastify API: State machine, Outbox Relay, Delegations & Idempotency
│   ├── notification-service/   # Kafka consumer service with in-memory store and alerts API
│   └── audit-service/          # Kafka consumer service persisting immutable CloudEvents to audit_db
├── packages/
│   ├── shared-schemas/         # Zod schemas & CloudEvents 1.0 contract validators
│   ├── shared-types/           # Shared TypeScript domain types and DTO interfaces
│   ├── telemetry/              # OpenTelemetry OTLP tracer, Prometheus metrics & Fastify global plugin
│   └── test-utils/             # Shared testing helpers, DB reset & Kafka mocks
├── k8s/                        # Kubernetes manifests & 1-click local scripts
│   ├── 00-namespace.yaml       # Namespace workflow-platform
│   ├── 01-configmaps-secrets.yaml # Global environment variables & OTLP exporter endpoints
│   ├── 02-postgres.yaml        # PostgreSQL StatefulSet & PVC storage
│   ├── 03-kafka.yaml           # Apache Kafka Broker & Zookeeper
│   ├── 04-workflow-api.yaml    # Workflow API Deployment, Service & HPA
│   ├── 05-notification-service.yaml # Notification Service Deployment & Service
│   ├── 06-audit-service.yaml   # Audit Service Deployment & Service
│   ├── 07-host-app.yaml        # Host React App NGINX Deployment & Service
│   ├── 08-observability.yaml   # Jaeger Tracing, Prometheus Server & Kafka UI
│   └── local/                  # Local cluster setup, fast hot-reloads & port-forwards
├── tests/                      # Automated test suite (Unit, Pact Contracts, Integration, Security)
├── docker-compose.yml          # Local Docker Compose multi-container stack
└── playwright.config.ts        # Playwright E2E browser test configuration
```

---

## 📚 Documentation Sitemap

All comprehensive guides, runbooks, and deep-dive technical documents are organized inside the [`docs/`](./docs) directory:

| Document | Purpose |
|---|---|
| 🗺️ **[System Architecture & Tracing](./docs/ARCHITECTURE.md)** | Visual sequence diagrams, multi-tier state machine flows, CloudEvents schemas, and W3C context propagation. |
| 🚀 **[Execution & Testing Runbook](./docs/RUN_GUIDE.md)** | Step-by-step commands to run the platform, manual UI testing ($120k expense), negative test cases, and outbox chaos experiments. |
| 🧪 **[Testing Strategy & Pyramid](./docs/TESTING_STRATEGY.md)** | Test pyramid breakdown (Vitest unit tests, Pact contract verification, Playwright E2E tests, k6 load tests). |
| 🌐 **[Kubernetes Deployment Guide](./docs/KUBERNETES_DEPLOYMENT.md)** | Kubernetes manifests, Kind/k3d multi-node clusters, rolling restarts, and fault-tolerance guides. |
| 🛠️ **[Developer Overview](./docs/DEVELOPMENT.md)** | Platform overview, microservices boundaries, domain model, and architectural principles. |
| ❓ **[Architecture & Troubleshooting FAQ](./docs/FAQ.md)** | Frequently asked questions regarding Outbox Relay mechanics, broker recovery, and failure modes. |

---

## ⚡ Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+ or v22+)
- [Docker Desktop](https://www.docker.com/) (with Kubernetes enabled) or [k3d](https://k3d.io/) / [Kind](https://kind.sigs.k8s.io/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)

### 1. Install Dependencies & Build Packages
```bash
npm install
npm run build
```

### 2. Deploy to Kubernetes (1-Click)
```powershell
# Deploy all microservices, Kafka, Postgres, Jaeger, and Prometheus
powershell -ExecutionPolicy Bypass -File ./k8s/local/deploy-local.ps1
```

### 3. Start Port-Forward Tunnels
```powershell
powershell -ExecutionPolicy Bypass -File ./k8s/local/start-port-forwards.ps1
```

---

## 🌐 Active Service Endpoints

| Component / Tool | Port (Local / K8s) | Working URL | Description |
|---|---|---|---|
| **Host Application (React + Vite)** | `8080` / `5173` | [http://localhost:8080](http://localhost:8080) | Main UI: Expenses, Approvals Inbox, Audit Log, Notifications |
| **Workflow API** | `3000` | [http://localhost:3000/ready](http://localhost:3000/ready) | Fastify REST API, State Machine & Outbox Relay |
| **Notification Service** | `3001` | [http://localhost:3001/health](http://localhost:3001/health) | Kafka consumer & notifications query API |
| **Audit Service** | `3002` | [http://localhost:3002/health](http://localhost:3002/health) | Kafka consumer & immutable audit trail REST API |
| **Kafka Web UI** | `8085` | [http://localhost:8085](http://localhost:8085) | Real-time topic inspector & consumer group lag monitor |
| **Jaeger Distributed Tracing** | `16686` | [http://localhost:16686](http://localhost:16686) | End-to-end distributed trace explorer (OTLP on `:4318`) |
| **Prometheus Server** | `9090` | [http://localhost:9090](http://localhost:9090) | Prometheus metrics scraper & query interface |
| **PostgreSQL Database** | `5433` | `localhost:5433` | Databases: `workflow_db`, `audit_db` (User: `postgres`, Pass: `postgres`) |

---

## ⚡ Fast Hot-Reload & Redeployment Shortcuts

| Command / Shortcut | Target | Duration | Description |
|---|---|---|---|
| `npm run k8s:reload:ui` | Frontend (`host-app`) | **~3 seconds** | Syncs compiled Vite bundle directly into running NGINX pods via `kubectl cp` with zero downtime. |
| `npm run k8s:reload:api` | Backend (`workflow-api`) | **~15 seconds** | Rebuilds TypeScript backend, loads into containerd, and triggers rolling restart. |
| `npm run k8s:reload` | Full Cluster | **~45 seconds** | Rebuilds all services (`host-app`, `workflow-api`, `notification-service`, `audit-service`). |
| `npm run k8s:reset:data` | Fast Data Wipe | **~1 second** | Truncates all PostgreSQL tables and purges the Kafka topic for a clean test run. |

---

## 🧪 Automated Test Suite

```bash
# Run all unit and integration tests across workspaces
npm test

# Run contract compatibility tests (Pact / Schema Validation)
npm run test:pact

# Run end-to-end browser tests
npm run test:e2e
```

---

## 📄 License
MIT License. Created as a reference blueprint for enterprise event-driven systems, distributed observability, and resilient microservices.

