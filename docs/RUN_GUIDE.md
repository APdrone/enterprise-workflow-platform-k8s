# Workflow Platform — Run & Execution Guide

This document provides step-by-step instructions to run, develop, interact with, and test the **Workflow Platform** microservices and frontend applications in both **Local Development Mode** and **Multi-Node Kubernetes Mode**.

---

## 📋 Table of Contents

1. [Prerequisites](#-prerequisites)
2. [Deployment & Execution Modes](#-deployment--execution-modes)
   - [Mode 1: Local Development (Docker Compose + Monorepo Dev)](#mode-1-local-development-docker-compose--monorepo-dev)
   - [Mode 2: Multi-Node Kubernetes Cluster](#mode-2-multi-node-kubernetes-cluster)
3. [Service Endpoints & Access URLs](#-service-endpoints--access-urls)
4. [Individual Service CLI Commands](#-individual-service-cli-commands)
5. [Interactive Manual Testing Guide (UI Walkthrough)](#-interactive-manual-testing-guide-ui-walkthrough)
   - [Step-by-Step Multi-Tier Approval Walkthrough ($120k Example)](#1-step-by-step-multi-tier-approval-walkthrough-120000-example)
   - [Approvals Inbox Experience](#2-approvals-inbox-experience-httplocalhost8080approvals)
   - [Kafka UI Event Inspection (JSON Payloads)](#3-kafka-ui-event-inspection-httplocalhost8085)
   - [Distributed Tracing in Jaeger](#4-distributed-tracing-in-jaeger-httplocalhost16686)
   - [Prometheus Metrics Inspection](#5-prometheus-metrics-inspection-httplocalhost9090)
6. [API Usage & Examples (Multi-Step & Delegation)](#-api-usage--examples-multi-step--delegation)
7. [Manual Verification Scenarios (All Platform Enhancements)](#-manual-verification-scenarios-all-platform-enhancements)
   - [Scenario 1: Real-Time Live Sync (Server-Sent Events)](#scenario-1-real-time-live-sync-server-sent-events)
   - [Scenario 2: Kafka Dead Letter Queue (DLQ) & Consumer Resilience](#scenario-2-kafka-dead-letter-queue-dlq--consumer-resilience)
   - [Scenario 3: Configurable Workflow Rules & Parallel Approvals (AND/OR Quorums)](#scenario-3-configurable-workflow-rules--parallel-approvals-andor-quorums)
   - [Scenario 4: PostgreSQL Row-Level Security (RLS) Database Hardening](#scenario-4-postgresql-row-level-security-rls-database-hardening)
8. [Automated Testing Guide](#-automated-testing-guide)
   - [Unit, Contract & Integration Tests (Vitest)](#1-run-unit-contract--integration-tests-vitest)
   - [End-to-End Tests (Playwright)](#2-run-end-to-end-automated-tests-playwright)
   - [Performance & Load Tests (k6)](#3-run-performance--load-tests-k6)
9. [Teardown & Cleanup](#-teardown--cleanup)

---

## 📋 Prerequisites

Ensure the following tools are installed on your machine:
- **Node.js**: `v22.x` (or `v20.x+`)
- **npm**: `v10.x+`
- **Docker & Docker Compose**: (for Postgres, Kafka, Zookeeper, Kafka UI, and Pact Broker)
- **kubectl**: for Kubernetes deployment mode
- *(Optional)* **k6**: for running performance load tests (`winget install k6` / `brew install k6` / [k6.io](https://k6.io/))

---

## 🚀 Deployment & Execution Modes

### Mode 1: Local Development (Docker Compose + Monorepo Dev)

Recommended for day-to-day development, rapid iteration, and debugging with hot-reloading.

#### 1. Install Monorepo Dependencies
From the repository root (`d:\Testing\microservices\full-stack-app\workflow-platform-k8s`):
```bash
npm install
```

#### 2. Start Supporting Infrastructure (Docker)
Start Postgres (with `workflow_db`, `audit_db`, `pact_db`), Apache Kafka, Zookeeper, Kafka UI, Pact Broker, **Jaeger Tracing**, and **Prometheus**:
```bash
docker compose up -d
```
> Wait ~10 seconds on first run for Kafka, Postgres, and Jaeger health checks to become green.

#### 3. Build Monorepo Workspaces
Compile all shared packages, schemas, and applications:
```bash
npm run build
```

#### 4. Start All Microservices & Applications Concurrently
```bash
npm run dev
```

#### 5. Hot-Reloading & Cache Invalidation for Linked Packages
When modifying TypeScript definitions in `@workflow/shared-types` or components in `@workflow/workflow-widget`, Vite pre-bundles workspace dependencies in `.vite/deps`:
* **Restart Dev Server**: Stop Terminals running `npm run dev:widget` or `npm run dev:host` (`Ctrl + C`) and restart them (`npm run dev:widget`, `npm run dev:host`).
* **Browser Cache Invalidation**: Perform a hard refresh in your browser (**`Ctrl + Shift + R`** on Windows/Linux or **`Cmd + Shift + R`** on macOS) to ensure latest script bundles are loaded.

---

### Mode 2: Multi-Node Kubernetes Cluster

Recommended for validating production readiness, zero-downtime deployments, horizontal pod scaling, and network policies.

#### 1. Deploy Manifests to Kubernetes Cluster
* **Option A: 1-Click Automated Script (Recommended)**
  * **PowerShell (Windows)**:
    ```powershell
    .\k8s\local\deploy-local.ps1 -ClusterType existing
    ```
    *(Use `-ClusterType kind` or `-ClusterType k3d` to spin up a fresh multi-node cluster).*
  * **Bash (Linux / macOS / WSL)**:
    ```bash
    ./k8s/local/deploy-local.sh existing
    ```

* **Option B: Native Declarative Kustomize**
  ```bash
  kubectl apply -k k8s/
  ```

#### 2. Verify Pod Health Across Cluster Nodes
Check that all pods across all services are in `1/1 Running` state:
```bash
kubectl get pods -n workflow-platform -o wide
```

#### 3. Start Port-Forwarding Tunnels
* **⚡ 1-Click Automated Port-Forwards (Recommended)**:
  * **Windows PowerShell**:
    ```powershell
    .\k8s\local\start-port-forwards.ps1
    ```
  * **Linux / macOS / WSL (Bash)**:
    ```bash
    ./k8s/local/start-port-forwards.sh
    ```

* **Manual Port-Forwards (Alternative)**:
  ```bash
  kubectl port-forward -n workflow-platform svc/host-app 8080:80
  kubectl port-forward -n workflow-platform svc/workflow-api 3000:3000
  kubectl port-forward -n workflow-platform svc/notification-service 3001:3001
  kubectl port-forward -n workflow-platform svc/audit-service 3002:3002
  kubectl port-forward -n workflow-platform svc/grafana 3005:3005
  kubectl port-forward -n workflow-platform svc/jaeger 16686:16686
  kubectl port-forward -n workflow-platform svc/prometheus 9090:9090
  kubectl port-forward -n workflow-platform svc/kafka-ui 8085:8085
  kubectl port-forward -n workflow-platform svc/postgres 5433:5432
  ```

#### 4. Updating & Redeploying Changes to Kubernetes (Fast Iteration & Shortcuts)
When you modify local code and want to see updates reflected immediately in your Kubernetes environment:

* **⚡ Ultra-Fast Frontend Reload (~3–5 seconds)**:
  Use this when updating React components, CSS, or the Workflow Web Component. It compiles Vite assets locally and syncs them directly into running NGINX pods in real-time with zero downtime and no container rebuild overhead:
  ```bash
  npm run k8s:reload:ui
  ```
  *(Or run `.\k8s\local\redeploy-local.ps1 -Target ui` on Windows / `./k8s/local/redeploy-local.sh ui` on Linux/macOS).*

* **⚡ Backend API Reload**:
  Use this when modifying Node/Fastify API services:
  ```bash
  npm run k8s:reload:api
  ```

* **⚡ Full Stack Rebuild & Rolling Restart**:
  Use this when modifying Dockerfiles, environment variables, or all services simultaneously:
  ```bash
  npm run k8s:reload
  # OR
  .\k8s\local\redeploy-local.ps1 -Target all   # Windows PowerShell
  ./k8s/local/redeploy-local.sh all           # Linux / macOS / WSL
  ```

> [!TIP]
> **Why is `k8s:reload:ui` so fast?**
> A full Docker build re-runs `npm ci` inside containers and waits for Kubernetes rolling pod replacement timeouts. `k8s:reload:ui` builds the Vite bundles locally in <3s and syncs them directly into active pods via `kubectl cp` in <1s. After running, simply do a hard browser refresh (**`Ctrl + Shift + R`**).

#### 5. Data Cleanup & Testing Reset (Start Afresh)
When you have created test expenses, approvals, and audit records and want to wipe all test data to start fresh:

* **⚡ Fast Table & Kafka Reset (~1–2 seconds - Zero Downtime)**:
  Wipes all rows in `workflows`, `workflow_steps`, `delegations`, `idempotency_keys`, `outbox_events`, `audit_events`, and purges Kafka topic messages (`workflow.events`) without restarting pods:
  ```bash
  npm run k8s:reset:data
  # OR
  .\k8s\local\reset-data.ps1            # Windows PowerShell
  ./k8s/local/reset-data.sh             # Linux / macOS / WSL
  ```

* **🌐 Resetting Kafka UI Manually (Optional)**:
  You can also purge messages directly from the Kafka UI web console:
  1. Open Kafka UI at [http://localhost:8085](http://localhost:8085).
  2. Click **Topics** $\rightarrow$ **`workflow.events`** $\rightarrow$ **Messages**.
  3. Click **Purge Messages** (or go to Topic Settings $\rightarrow$ **Delete Topic**).

* **💣 Hard Reset (Wipe PVC Volume & Fresh Database Initialization)**:
  Deletes the Postgres PersistentVolumeClaim, triggers automatic database re-initialization, and re-runs migration scripts:
  ```bash
  npm run k8s:reset:hard
  # OR
  .\k8s\local\reset-data.ps1 -HardReset # Windows PowerShell
  ./k8s/local/reset-data.sh --hard      # Linux / macOS / WSL
  ```

* **🐳 Docker Compose Mode Reset**:
  If running locally via Docker Compose:
  ```bash
  docker compose down -v   # Removes all volumes including postgres-data and kafka-data
  docker compose up -d
  ```

---

## 🌐 Service Endpoints & Access URLs

| Component / Tool | Port (Local / K8s) | Working URL | Description |
|---|---|---|---|
| **Host Application (React + Vite)** | `5173` / `8080` | [http://localhost:8080](http://localhost:8080) | Main UI: Real-Time SSE Sync, Expenses, Parallel Approvals, Audit Log & W3C Tracing |
| **Workflow Widget Preview** | `3003` | [http://localhost:3003](http://localhost:3003) | Standalone demo page for `<workflow-widget>` Web Component |
| **Workflow API** | `3000` | [http://localhost:3000/ready](http://localhost:3000/ready) | Fastify REST API: Multi-step state machine, Deep Health Probes, Outbox relay, Delegations & RLS |
| **Notification Service** | `3001` | [http://localhost:3001/health](http://localhost:3001/health) | Kafka event consumer, alerts API & SSE live stream (`/api/v1/stream`) |
| **Audit Service** | `3002` | [http://localhost:3002/health](http://localhost:3002/health) | Kafka event consumer & immutable audit trail REST API |
| **Grafana Dashboards** | `3005` | [http://localhost:3005](http://localhost:3005) | Provisioned Dashboards: System Health, DB Pool & Outbox Reliability |
| **Jaeger Tracing UI** | `16686` | [http://localhost:16686](http://localhost:16686) | Visual distributed trace explorer (OTLP receiver on `:4318`) with DB Query Spans |
| **Prometheus Server** | `9090` | [http://localhost:9090](http://localhost:9090) | Prometheus metrics dashboard & alerting rules (scrapes `/metrics`) |
| **Kafka UI** | `8085` | [http://localhost:8085](http://localhost:8085) | Web UI for inspecting Kafka topics, partitions, consumer groups, and messages |
| **Pact Broker** | `9292` | [http://localhost:9292](http://localhost:9292) | Consumer-Driven Contract testing broker |
| **PostgreSQL** | `5433` | `localhost:5433` | Databases: `workflow_db`, `audit_db`, `pact_db` (User: `postgres`, Pass: `postgres`) |

---

## 🛠️ Individual Service CLI Commands

To run microservices in separate terminal windows:

```bash
# Terminal 1 — Workflow REST API (Port 3000)
npm run dev:api

# Terminal 2 — Notification Consumer Service (Port 3001)
npm run dev:notification

# Terminal 3 — Audit Consumer Service (Port 3002)
npm run dev:audit

# Terminal 4 — Workflow Web Component Widget (Port 3003)
npm run dev:widget

# Terminal 5 — Host React Dashboard (Port 5173)
npm run dev:host
```

---

## 💡 Interactive Manual Testing Guide (UI Walkthrough)

### 1. Step-by-Step Multi-Tier Approval Walkthrough ($120,000 Example)

This walkthrough demonstrates the end-to-end multi-step workflow lifecycle for a **$120,000 expense** requiring a 3-tier financial approval chain (Team Lead $\rightarrow$ Dept Manager $\rightarrow$ Finance Director).

```
   [ Alice Johnson: Submit Draft ($120k) ]
                      │
                      ▼
   [ Step 1: Bob Smith (Team Lead) ] ────────► emits: workflow.step_approved.v1
                      │
                      ▼
   [ Step 2: Carol White (Dept Manager) ] ───► emits: workflow.step_approved.v1
                      │
                      ▼
   [ Step 3: Diana Prince (Finance Dir) ] ───► emits: workflow.approved.v1
```

1. **Step 1 — Create & Submit Draft (as Alice Johnson)**:
   - Open the Host Application at [http://localhost:8080](http://localhost:8080) (or `http://localhost:5173` in local dev mode).
   - Ensure **Tokyo Holdings (Tenant A)** and **Alice Johnson — Requester** are selected in the top navigation bar.
   - Click **"New Expense Request"**, enter:
     - **Title**: `"Global Cloud Infrastructure Expansion"`
     - **Category**: `EXPENSE`
     - **Amount**: `120000`
   - Click **"Create Draft"** $\rightarrow$ Click on the newly created request $\rightarrow$ Click **"Submit for Approval"**.
   - **Visual Stepper**: Notice the 3-step approval timeline appears:
     - `Step 1: Team Lead` 🟡 **PENDING**
     - `Step 2: Dept Manager` ⚪ **WAITING**
     - `Step 3: Finance Director` ⚪ **WAITING**

2. **Step 2 — Approvals Inbox & Step 1 Review (as Bob Smith)**:
   - Switch the active persona to **Bob Smith — Team Lead (Step 1 Approver)**.
   - Navigate to the **Approvals Inbox** at [http://localhost:8080/approvals](http://localhost:8080/approvals) (or click the **Approvals Inbox** tab in the navbar).
   - Select `"Global Cloud Infrastructure Expansion"` from the pending requests list on the left.
   - Notice the interactive approval panel on the right:
     - Bob sees the green **"Approve Step 1 (Team Lead)"** button enabled.
     - *(Role Enforcement Test)*: If you switch persona to **Carol White** or **Diana Prince**, notice the action button displays a warning banner indicating that Step 1 specifically requires the `Team Lead` role.
   - Switch back to **Bob Smith**, type comment `"Approved for architecture scope"`, and click **"Approve Step 1"**.
   - **Result**: Step 1 turns 🟢 **APPROVED**, Step 2 turns 🟡 **PENDING**.

3. **Step 3 — Step 2 Review (as Carol White)**:
   - Switch active persona to **Carol White — Dept Manager (Step 2 Approver)**.
   - In the **Approvals Inbox** ([http://localhost:8080/approvals](http://localhost:8080/approvals)), select the expense.
   - Carol now sees **"Approve Step 2 (Dept Manager)"** enabled.
   - Enter comment `"Department budget verified"`, and click **"Approve Step 2"**.
   - **Result**: Step 2 turns 🟢 **APPROVED**, Step 3 turns 🟡 **PENDING**.

4. **Step 4 — Final Approval (as Diana Prince)**:
   - Switch active persona to **Diana Prince — Finance Director (Step 3 Approver)**.
   - In the **Approvals Inbox** ([http://localhost:8080/approvals](http://localhost:8080/approvals)), select the expense.
   - Diana sees the final **"Approve Request"** button enabled.
   - Enter comment `"Executive finance sign-off complete"`, and click **"Approve Request"**.
   - **Result**: Entire workflow status changes to 🟢 **APPROVED**.

---

### 2. Negative & Edge Case Testing Scenarios

These scenarios validate that the system strictly enforces security boundaries, business invariants, idempotency, and transactional resilience:

#### ❌ Scenario A: Unauthorized Approver / Role Enforcement Violation
* **Objective**: Ensure that users cannot sign off on approval steps outside of their designated organizational role.
* **Test in UI**:
  1. As **Alice Johnson (Requester)**, submit a new expense request.
  2. Switch persona to **Carol White (Dept Manager)** or stay as **Alice Johnson**.
  3. Navigate to **Approvals Inbox** (`http://localhost:8080/approvals`) and select the request.
  4. **Expected Observation**: 
     - The approval button displays an alert: *"You do not have the required role (team_lead) to approve Step 1"*.
     - Action buttons are strictly disabled for unauthorized personas.
* **Test via API / Curl**:
  ```powershell
  # Attempting to approve Step 1 using a non-Team Lead persona (Carol White)
  curl.exe -s -X POST "http://localhost:3000/api/v1/workflows/<WORKFLOW_ID>/approve" `
    -H "Content-Type: application/json" `
    -H "x-tenant-id: tenant-corp-a" `
    -H "x-user-id: user-carol" `
    -H "x-user-name: Carol White" `
    -d '{"comment": "Trying to bypass team lead"}'
  ```
  **Expected Response**: `403 FORBIDDEN` (`USER_NOT_AUTHORIZED_APPROVER`).

---

#### ❌ Scenario B: Invalid State Transitions (Double Approval / Illegal Transitions)
* **Objective**: Ensure state machine invariants cannot be bypassed.
* **Case 1: Approving a DRAFT without submitting**:
  ```powershell
  # Create draft
  $wf = (Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/v1/workflows" -Method Post `
    -Headers @{"x-tenant-id"="tenant-corp-a";"x-user-id"="user-alice";"x-user-name"="Alice Johnson";"Content-Type"="application/json"} `
    -Body (@{title="Direct Approve Test"; amount=5000}|ConvertTo-Json)).data;
  
  # Attempt immediate approval on DRAFT
  Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/v1/workflows/$($wf.id)/approve" -Method Post `
    -Headers @{"x-tenant-id"="tenant-corp-a";"x-user-id"="user-bob";"x-user-name"="Bob Smith";"Content-Type"="application/json"} `
    -Body (@{comment="Approving draft"}|ConvertTo-Json);
  ```
  **Expected Response**: `422 Unprocessable Entity`:
  ```json
  {
    "success": false,
    "error": {
      "code": "INVALID_STATE_TRANSITION",
      "message": "Cannot approve workflow in 'DRAFT' status. Only PENDING workflows can be approved."
    }
  }
  ```
* **Case 2: Re-approving an already APPROVED workflow**:
  Attempting to approve a completed workflow returns `422 INVALID_STATE_TRANSITION` (`Cannot approve workflow in 'APPROVED' status`).

---

#### ❌ Scenario C: Rejection Flow & Mandatory Reason Validation
* **Objective**: Verify that rejections require an explicit justification and terminate subsequent steps immediately.
* **Test in UI**:
  1. As **Alice Johnson**, create and submit an expense of `$120,000`.
  2. Switch to **Bob Smith (Team Lead)**, open the request in **Approvals Inbox**.
  3. Click **"Reject"** without typing a reason $\rightarrow$ Form blocks submission with validation error: *"Rejection reason is required"*.
  4. Type reason `"Exceeds quarterly budget allocation"` and click **"Confirm Rejection"**.
* **Resulting Observations**:
  - Workflow status turns 🔴 **REJECTED**.
  - Subsequent steps (Dept Manager & Finance Director) are immediately halted.
  - **Kafka UI** ([http://localhost:8085](http://localhost:8085)): Emits `workflow.rejected.v1` CloudEvent containing the `rejectionReason`.
  - **Audit Log** ([http://localhost:8080/audit](http://localhost:8080/audit)): Displays `WORKFLOW_REJECTED` with Bob Smith's rejection comment.
  - **Notifications** ([http://localhost:8080/notifications](http://localhost:8080/notifications)): Alice receives an alert: *"Workflow Rejected: Global Cloud Infrastructure Expansion — Exceeds quarterly budget allocation"*.

---

#### ❌ Scenario D: Multi-Tenant Data Isolation Breach Attempt
* **Objective**: Guarantee that Tenant B cannot read, submit, approve, or modify any workflow belonging to Tenant A.
* **Test via API / Curl**:
  ```powershell
  # Attempt to view Tenant A's workflow while authenticated as Tenant B
  curl.exe -i -X GET "http://localhost:3000/api/v1/workflows/<TENANT_A_WORKFLOW_ID>" `
    -H "x-tenant-id: tenant-corp-b" `
    -H "x-user-id: user-charlie" `
    -H "x-user-name: Charlie Brown"
  ```
  **Expected Response**: `404 Not Found`:
  ```json
  {
    "success": false,
    "error": {
      "code": "WORKFLOW_NOT_FOUND",
      "message": "Workflow <TENANT_A_WORKFLOW_ID> not found"
    }
  }
  ```
  *(Even though the record exists in the database, tenant filtering `WHERE tenant_id = 'tenant-corp-b'` prevents data leakage)*.

---

#### ❌ Scenario E: Duplicate Submission & Idempotency Key Conflict
* **Objective**: Prevent duplicate financial approvals or charges caused by network double-clicks or client retries.
* **Test via API / Curl**:
  ```powershell
  $idempKey = [System.Guid]::NewGuid().ToString();
  $headers = @{
    "Content-Type" = "application/json";
    "x-tenant-id" = "tenant-corp-a";
    "x-user-id" = "user-bob";
    "x-user-name" = "Bob Smith";
    "idempotency-key" = $idempKey;
  };

  # Request 1: Initial Approval
  $res1 = Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/v1/workflows/<WORKFLOW_ID>/approve" `
    -Method Post -Headers $headers -Body (@{comment="First click"}|ConvertTo-Json);
  Write-Output "Status 1: $($res1.StatusCode), Replayed: $($res1.Headers['x-idempotent-replay'])";

  # Request 2: Immediate retry with same idempotency-key
  $res2 = Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/v1/workflows/<WORKFLOW_ID>/approve" `
    -Method Post -Headers $headers -Body (@{comment="Second double-click"}|ConvertTo-Json);
  Write-Output "Status 2: $($res2.StatusCode), Replayed: $($res2.Headers['x-idempotent-replay'])";
  ```
  **Expected Observation**:
  - Request 1: `200 OK`, `x-idempotent-replay: (none)` (State transitioned, outbox event created).
  - Request 2: `200 OK`, `x-idempotent-replay: true` (Cached response returned directly from `idempotency_keys` table; **no double-transition and no duplicate Kafka event published**).

---

#### 🔄 Scenario F: Transactional Outbox Relay Resilience (Kafka Outage Simulation & Auto-Drain)
* **Objective**: Prove that state changes are 100% resilient to message broker outages without data loss (Dual-Write guarantee).
* **Architecture Under Test**:
  ```
  [ Client Request ] ──► [ Workflow API ] ──(Atomic DB Transaction)──► [ workflows: UPDATED ]
                                                                       [ outbox_events: published=false ]
  
  (Kafka Down)   ──► Outbox Relay retries in background (logs retry_count)
  (Kafka Recovers) ─► Outbox Relay auto-drains queue ──► [ Kafka: workflow.events ] ──► [ Consumers ]
  ```

* **Step-by-Step Hands-On Test**:

  **1. Simulate Kafka Broker Crash / Outage**:
  Temporarily scale down Kafka to 0 replicas in Kubernetes:
  ```powershell
  kubectl scale deployment kafka -n workflow-platform --replicas=0
  ```

  **2. Perform Workflow Actions during the Outage**:
  Submit or approve an expense request while Kafka is completely down:
  ```powershell
  $body = @{ title = "Outbox Chaos Test-2"; amount = 60000; type = "EXPENSE" } | ConvertTo-Json;
  $headers = @{ "Content-Type" = "application/json"; "x-tenant-id" = "tenant-corp-a"; "x-user-id" = "user-alice"; "x-user-name" = "Alice Johnson" };
  $wf = (Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/v1/workflows" -Method Post -Headers $headers -Body $body).data;
  
  # Submit for review while Kafka is offline
  $sub = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/v1/workflows/$($wf.id)/submit" -Method Post -Headers $headers -Body (@{comment="Submitting during outage-2"}|ConvertTo-Json);
  Write-Output "HTTP Status: Success=$($sub.success), Workflow Status=$($sub.data.status)";
  ```
  *(Notice: The API returns `200 OK` immediately! The user experience is not blocked by third-party broker downtime)*.

  **3. Inspect the PostgreSQL Outbox Backlog**:
  Verify that the event was securely queued in the database:
  ```powershell
  kubectl exec -i -n workflow-platform postgres-0 -- psql -U postgres -d workflow_db -c "SELECT id, event_type, published, retry_count, last_error FROM outbox_events WHERE published = false;"
  ```
  **Expected Output**:
  ```
                    id                  |       event_type      | published | retry_count |         last_error
  --------------------------------------+-----------------------+-----------+-------------+-----------------------------
   3f12a87b-48c2-411a-9821-39c878b201a4 | workflow.submitted.v1 | f         |           3 | Connection error / timeout
  ```

  **4. Restore Apache Kafka**:
  Scale Kafka back up:
  ```powershell
  kubectl scale deployment kafka -n workflow-platform --replicas=1
  kubectl rollout status deployment/kafka -n workflow-platform
  ```

  **5. Verify Automatic Queue Drainage & Zero Message Loss**:
  Wait ~3 seconds for the background Outbox Relay worker to poll and drain:
  ```powershell
  kubectl exec -i -n workflow-platform postgres-0 -- psql -U postgres -d workflow_db -c "SELECT id, event_type, published, published_at FROM outbox_events ORDER BY created_at DESC LIMIT 1;"
  ```
  **Expected Output**:
  ```
                    id                  |       event_type      | published |         published_at
  --------------------------------------+-----------------------+-----------+-------------------------------
   3f12a87b-48c2-411a-9821-39c878b201a4 | workflow.submitted.v1 | t         | 2026-09-19 11:10:45.123456+00
  ```
  - **Kafka UI** ([http://localhost:8085](http://localhost:8085)): Shows the event successfully published.
  - **Audit Log** ([http://localhost:8080/audit](http://localhost:8080/audit)) & **Notifications** ([http://localhost:8080/notifications](http://localhost:8080/notifications)): Processed normally with zero data loss.

---

### 3. Approvals Inbox Experience ([http://localhost:8080/approvals](http://localhost:8080/approvals))

The Approvals Inbox is tailored for management personnel to view and sign off on pending workflows across their department:

* **Pending Queue**: Displays all workflows currently in `PENDING` state scoped to the active tenant.
* **Role-Aware Action Guard**: If an employee with the `requester` role visits `/approvals`, a banner alerts them that they must switch to an authorized approver persona.
* **Embedded Web Component**: Uses the standalone `<workflow-widget>` embedded inside React, communicating over custom browser events (`workflow-state-changed`).
* **Rejection Support**: Any authorized approver can click **"Reject"** with a mandatory reason, immediately stopping subsequent steps and setting the workflow to `REJECTED`.

---

### 4. Kafka UI Event Inspection ([http://localhost:8085](http://localhost:8085))

Open **Kafka UI** at [http://localhost:8085](http://localhost:8085) $\rightarrow$ click **Topics** $\rightarrow$ click **`workflow.events`** $\rightarrow$ select the **Messages** tab.

For the **$120,000 3-step workflow**, Kafka UI displays the following 4 versioned **CloudEvents 1.0** messages in exact sequential order:

#### Message 1: `workflow.submitted.v1` (Submission)
```json
{
  "specversion": "1.0",
  "id": "e4b986a1-0f8c-4f12-9c32-a5e12f9b10c1",
  "source": "/services/workflow-api",
  "type": "workflow.submitted.v1",
  "datacontenttype": "application/json",
  "time": "2026-09-19T10:00:00.120Z",
  "data": {
    "workflowId": "694a57ce-dca5-4f11-920c-6c7f34e3a69e",
    "tenantId": "tenant-corp-a",
    "title": "Global Cloud Infrastructure Expansion",
    "type": "EXPENSE",
    "amount": 120000,
    "requesterId": "user-alice",
    "requesterName": "Alice Johnson",
    "submittedAt": "2026-09-19T10:00:00.000Z"
  }
}
```

#### Message 2: `workflow.step_approved.v1` (Step 1 Sign-Off — Bob Smith)
```json
{
  "specversion": "1.0",
  "id": "7a3f81e2-54b1-4c91-9e11-b8f219ac40e2",
  "source": "/services/workflow-api",
  "type": "workflow.step_approved.v1",
  "datacontenttype": "application/json",
  "time": "2026-09-19T10:01:15.340Z",
  "data": {
    "workflowId": "694a57ce-dca5-4f11-920c-6c7f34e3a69e",
    "tenantId": "tenant-corp-a",
    "title": "Global Cloud Infrastructure Expansion",
    "actorId": "user-bob",
    "actorName": "Bob Smith",
    "currentStepOrder": 1,
    "totalSteps": 3,
    "stepRole": "team_lead",
    "comment": "Approved for architecture scope",
    "isDelegated": false,
    "approvedAt": "2026-09-19T10:01:15.000Z"
  }
}
```

#### Message 3: `workflow.step_approved.v1` (Step 2 Sign-Off — Carol White)
```json
{
  "specversion": "1.0",
  "id": "9c12b84a-71d3-4a81-8b22-f19c432ba981",
  "source": "/services/workflow-api",
  "type": "workflow.step_approved.v1",
  "datacontenttype": "application/json",
  "time": "2026-09-19T10:02:30.820Z",
  "data": {
    "workflowId": "694a57ce-dca5-4f11-920c-6c7f34e3a69e",
    "tenantId": "tenant-corp-a",
    "title": "Global Cloud Infrastructure Expansion",
    "actorId": "user-carol",
    "actorName": "Carol White",
    "currentStepOrder": 2,
    "totalSteps": 3,
    "stepRole": "dept_manager",
    "comment": "Department budget verified",
    "isDelegated": false,
    "approvedAt": "2026-09-19T10:02:30.000Z"
  }
}
```

#### Message 4: `workflow.approved.v1` (Step 3 Final Approval — Diana Prince)
```json
{
  "specversion": "1.0",
  "id": "3d90fc12-65a1-4321-91ef-a1109bc48e77",
  "source": "/services/workflow-api",
  "type": "workflow.approved.v1",
  "datacontenttype": "application/json",
  "time": "2026-09-19T10:03:45.910Z",
  "data": {
    "workflowId": "694a57ce-dca5-4f11-920c-6c7f34e3a69e",
    "tenantId": "tenant-corp-a",
    "title": "Global Cloud Infrastructure Expansion",
    "actorId": "user-diana",
    "actorName": "Diana Prince",
    "currentStepOrder": 3,
    "totalSteps": 3,
    "stepRole": "finance_director",
    "comment": "Executive finance sign-off complete",
    "isDelegated": false,
    "approvedAt": "2026-09-19T10:03:45.000Z"
  }
}
```

---

### 5. Distributed Tracing in Jaeger ([http://localhost:16686](http://localhost:16686))

Open [http://localhost:16686](http://localhost:16686) in your browser:
1. Select **Service**: `workflow-api` or `audit-service`.
2. Click **Find Traces** $\rightarrow$ select the trace for `POST /api/v1/workflows/:id/approve`.

#### What You Will Observe:
* **End-to-End Span Hierarchy**:
  ```
  [workflow-api] POST /api/v1/workflows/:id/approve
    ├── [postgres] BEGIN TRANSACTION
    ├── [postgres] UPDATE workflow_steps SET status='APPROVED'
    ├── [postgres] INSERT INTO outbox_events (workflow.step_approved.v1)
    ├── [postgres] COMMIT TRANSACTION
    │
    └── [outbox-relay] Kafka Publish: workflow.step_approved.v1 (Partition Key: tenant-corp-a:694a57ce)
          ├── [audit-service] Kafka Consume: workflow.step_approved.v1
          │     └── [postgres] INSERT INTO audit_events
          │
          └── [notification-service] Kafka Consume: workflow.step_approved.v1
                └── [notification-store] Dispatch in-memory alert to 'next-approver-team'
  ```
* **W3C Context Propagation**: Trace IDs and `traceparent` headers are seamlessly injected into Kafka record headers and extracted downstream by consumer microservices.
* **Span Attributes**: `tenant.id = "tenant-corp-a"`, `workflow.id = "694a57ce..."`, `workflow.step = "1"`, `http.status_code = 200`.

---

### 6. Prometheus Metrics Inspection ([http://localhost:9090](http://localhost:9090))

Open [http://localhost:9090](http://localhost:9090) $\rightarrow$ go to **Graph** or **Table** view and query the following metrics:

| PromQL Query | What It Measures | Expected Observation for $120k Workflow |
|---|---|---|
| `workflow_state_transitions_total` | Total state machine transitions | Increments for `from="DRAFT", to="PENDING"`, and intermediate step transitions up to `to="APPROVED"` |
| `kafka_events_published_total` | Events written to Kafka by Outbox Relay | +1 for `workflow.submitted.v1`, +2 for `workflow.step_approved.v1`, +1 for `workflow.approved.v1` |
| `kafka_events_consumed_total{service="audit-service"}` | Events consumed by Audit Service | +4 events consumed with `status="processed"` |
| `kafka_events_consumed_total{service="notification-service"}` | Alerts dispatched by Notification Service | +4 events consumed and formatted for UI feed |
| `http_requests_total{status_code="200"}` | API traffic per tenant | Shows active request counts labeled with `tenant="tenant-corp-a"` |
| `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` | P95 API Latency | Real-time 95th percentile latency across Fastify endpoints (< 15ms) |

---

## 📡 API Usage & Curl Examples (Multi-Step & Delegation)

### 1. Create a Multi-Step Expense (Dynamic Amount Routing)
Expenses above ¥100,000 / $100,000 automatically require 3 levels of approval (Team Lead $\rightarrow$ Dept Manager $\rightarrow$ Finance Director):
```bash
curl -X POST http://localhost:3000/api/v1/workflows \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-corp-a" \
  -H "x-user-id: emp-101" \
  -H "x-user-name: Alice Johnson" \
  -H "Idempotency-Key: idemp-req-001" \
  -d '{
    "type": "EXPENSE",
    "title": "Annual AWS Enterprise Support Contract",
    "amount": 150000,
    "currency": "USD"
  }'
```

### 2. Submit for Approval
```bash
curl -X POST http://localhost:3000/api/v1/workflows/<WORKFLOW_ID>/submit \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-corp-a" \
  -H "x-user-id: emp-101" \
  -H "x-user-name: Alice Johnson" \
  -d '{ "comment": "Urgent contract renewal" }'
```

### 3. Step 1 Approval (Team Lead)
```bash
curl -X POST http://localhost:3000/api/v1/workflows/<WORKFLOW_ID>/approve \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-corp-a" \
  -H "x-user-id: lead-001" \
  -H "x-user-name: Lead Bob" \
  -d '{ "comment": "Step 1 approved: verified team need" }'
```
*Notice: Workflow status remains `PENDING`, `currentStepOrder` advances to `2`, and a `workflow.step_approved.v1` CloudEvent is relayed to Kafka.*

### 4. Setup Out-of-Office Delegation
Delegate manager approval authority to a proxy colleague:
```bash
curl -X POST http://localhost:3000/api/v1/delegations \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-corp-a" \
  -d '{
    "delegatorId": "manager-002",
    "delegateeId": "proxy-user-005",
    "validFrom": "2026-09-01T00:00:00Z",
    "validUntil": "2026-10-01T00:00:00Z",
    "reason": "On paternity leave"
  }'
```

### 5. Proxy Approval via Delegation
Proxy user approves on behalf of `manager-002`:
```bash
curl -X POST http://localhost:3000/api/v1/workflows/<WORKFLOW_ID>/approve \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: tenant-corp-a" \
  -H "x-user-id: proxy-user-005" \
  -H "x-user-name: Proxy Colleague" \
  -d '{ "comment": "Step 2 approved as delegate for manager" }'
```

---

## 🎯 Manual Verification Scenarios (All Platform Enhancements)

This section contains dedicated, copy-paste test scenarios covering all 4 platform enhancements with dual PowerShell and Bash/cURL commands.

---

### Scenario 1: Real-Time Live Sync (Server-Sent Events)

**Objective**: Verify that workflow state changes, approvals, and alerts instantly propagate to connected web clients with zero polling latency.

#### Method A: Multi-Browser Tab Verification
1. Open **Tab 1** at [http://localhost:8080](http://localhost:8080) and set persona to **Bob Martinez (Approver / Team Lead)** on the **Approvals** page.
2. Open **Tab 2** (or an Incognito window) at [http://localhost:8080](http://localhost:8080) and set persona to **Alice Johnson (Requester)** on the **Expenses** page.
3. In **Tab 2**, create and submit an expense of `$500.00`.
4. **Observe Tab 1**:
   - The Approvals inbox badge updates immediately.
   - A live toast notification popup appears in the top-right corner with zero page refreshes or polling lag.

#### Method B: CLI SSE Stream Handshake Test
**PowerShell:**
```powershell
# Open live SSE stream for tenant-corp-a
$req = [System.Net.HttpWebRequest]::Create("http://localhost:3001/api/v1/stream?tenantId=tenant-corp-a&userId=user-bob")
$resp = $req.GetResponse()
$stream = $resp.GetResponseStream()
$reader = New-Object System.IO.StreamReader($stream)
$reader.ReadLine()
$reader.ReadLine()
$resp.Close()
```

**Bash / cURL:**
```bash
curl -N -s "http://localhost:3001/api/v1/stream?tenantId=tenant-corp-a&userId=user-bob" | head -n 5
```

**Expected Output:**
```json
data: {"type":"connected","clientId":"client-...","timestamp":"..."}
```

---

### Scenario 2: Kafka Dead Letter Queue (DLQ) & Consumer Resilience

**Objective**: Verify that malformed poison-pill messages or schema violations are safely isolated to `workflow.events.dlq` without blocking main consumer processing partitions, and can be inspected/replayed via REST API.

#### Step 1: Inject a Poison Pill into Kafka (`workflow.events`)
**PowerShell (inside pod):**
```powershell
kubectl exec -n workflow-platform $(kubectl get pods -n workflow-platform -l app=workflow-api -o jsonpath="{.items[0].metadata.name}") -- node -e '
import("kafkajs").then(async ({ Kafka }) => {
  const kafka = new Kafka({ clientId: "test-poison", brokers: ["kafka:9092"] });
  const producer = kafka.producer();
  await producer.connect();
  await producer.send({
    topic: "workflow.events",
    messages: [{ key: "poison-key", value: "THIS IS MALFORMED NON-JSON POISON PILL" }]
  });
  await producer.disconnect();
  console.log("Poison pill injected.");
});'
```

**Bash / Git Bash (inside pod):**
```bash
kubectl exec -n workflow-platform $(kubectl get pods -n workflow-platform -l app=workflow-api -o jsonpath="{.items[0].metadata.name}") -- node -e '
import("kafkajs").then(async ({ Kafka }) => {
  const kafka = new Kafka({ clientId: "test-poison", brokers: ["kafka:9092"] });
  const producer = kafka.producer();
  await producer.connect();
  await producer.send({
    topic: "workflow.events",
    messages: [{ key: "poison-key", value: "THIS IS MALFORMED NON-JSON POISON PILL" }]
  });
  await producer.disconnect();
  console.log("Poison pill injected.");
});'
```

#### Step 2: Query Dead-Lettered Messages from Audit Service
**PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3002/api/v1/dlq/messages?limit=5" -Method Get | ConvertTo-Json -Depth 5
```

**Bash / cURL:**
```bash
curl -s http://localhost:3002/api/v1/dlq/messages?limit=5 | jq .
```

**Expected Output:**
```json
{
  "success": true,
  "data": {
    "total": 1,
    "messages": [
      {
        "id": "...",
        "originalTopic": "workflow.events",
        "errorType": "UNPARSEABLE_JSON",
        "status": "DEAD_LETTERED"
      }
    ]
  }
}
```

#### Step 3: Replay Message from DLQ
**PowerShell:**
```powershell
$dlqId = "<DLQ_RECORD_ID>"
Invoke-RestMethod -Uri "http://localhost:3002/api/v1/dlq/replay/$dlqId" -Method Post | ConvertTo-Json
```

**Bash / cURL:**
```bash
curl -X POST "http://localhost:3002/api/v1/dlq/replay/<DLQ_RECORD_ID>"
```

---

### Scenario 3: Configurable Workflow Rules & Parallel Approvals (AND/OR Quorums)

**Objective**: Verify dynamic tenant matrix configuration and multi-reviewer parallel quorum evaluation.

#### Step 1: Create a Dynamic Parallel Approval Rule
**PowerShell:**
```powershell
$rulePayload = @'
{
  "name": "Security and Legal Dual Approval Gate",
  "workflowType": "ACCESS",
  "minAmount": 0,
  "priority": 10,
  "steps": [
    { "stepOrder": 1, "name": "Legal Review", "approverRole": "LEGAL", "policy": "ALL_MUST_APPROVE", "parallelGroup": "gate-1" },
    { "stepOrder": 1, "name": "Security Review", "approverRole": "SECURITY", "policy": "ALL_MUST_APPROVE", "parallelGroup": "gate-1" }
  ]
}
'@

Invoke-RestMethod -Uri "http://localhost:3000/api/v1/rules" -Method Post -Headers @{"x-tenant-id"="tenant-corp-a"} -ContentType "application/json" -Body $rulePayload | ConvertTo-Json -Depth 5
```

**Bash / cURL:**
```bash
curl -s -X POST http://localhost:3000/api/v1/rules \
  -H "x-tenant-id: tenant-corp-a" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Security and Legal Dual Approval Gate",
    "workflowType": "ACCESS",
    "minAmount": 0,
    "priority": 10,
    "steps": [
      { "stepOrder": 1, "name": "Legal Review", "approverRole": "LEGAL", "policy": "ALL_MUST_APPROVE", "parallelGroup": "gate-1" },
      { "stepOrder": 1, "name": "Security Review", "approverRole": "SECURITY", "policy": "ALL_MUST_APPROVE", "parallelGroup": "gate-1" }
    ]
  }'
```

#### Step 2: Submit Workflow Matching Dynamic Rule
**PowerShell:**
```powershell
$wf = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/workflows" -Method Post -Headers @{"x-tenant-id"="tenant-corp-a"; "x-user-id"="user-alice"; "x-user-name"="Alice"} -ContentType "application/json" -Body '{"title":"Production Kubernetes Access","type":"ACCESS","amount":0}'
$wfId = $wf.data.id

# Submit
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/workflows/$wfId/submit" -Method Post -Headers @{"x-tenant-id"="tenant-corp-a"; "x-user-id"="user-alice"; "x-user-name"="Alice"} -ContentType "application/json" -Body '{"comment":"Access required"}' | ConvertTo-Json -Depth 5
```

**Bash / cURL:**
```bash
WF_RESP=$(curl -s -X POST http://localhost:3000/api/v1/workflows \
  -H "x-tenant-id: tenant-corp-a" \
  -H "x-user-id: user-alice" \
  -H "x-user-name: Alice" \
  -H "Content-Type: application/json" \
  -d '{"title":"Production Kubernetes Access","type":"ACCESS","amount":0}')

WF_ID=$(echo $WF_RESP | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

curl -s -X POST "http://localhost:3000/api/v1/workflows/${WF_ID}/submit" \
  -H "x-tenant-id: tenant-corp-a" \
  -H "x-user-id: user-alice" \
  -H "x-user-name: Alice" \
  -H "Content-Type: application/json" \
  -d '{"comment":"Access required"}'
```

#### Step 3: Approve Step 1A (Workflow Stays in PENDING)
**PowerShell:**
```powershell
# First parallel approval
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/workflows/$wfId/approve" -Method Post -Headers @{"x-tenant-id"="tenant-corp-a"; "x-user-id"="user-legal-1"; "x-user-role"="LEGAL"} -ContentType "application/json" -Body '{"stepId":"<STEP_1A_ID>","comment":"Legal cleared"}' | ConvertTo-Json -Depth 5
```

#### Step 4: Approve Step 1B (Quorum Reached -> Transitions to APPROVED)
**PowerShell:**
```powershell
# Second parallel approval
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/workflows/$wfId/approve" -Method Post -Headers @{"x-tenant-id"="tenant-corp-a"; "x-user-id"="user-sec-1"; "x-user-role"="SECURITY"} -ContentType "application/json" -Body '{"stepId":"<STEP_1B_ID>","comment":"Security cleared"}' | ConvertTo-Json -Depth 5
```

---

### Scenario 4: PostgreSQL Row-Level Security (RLS) Database Hardening

**Objective**: Verify database engine-level isolation and WITH CHECK constraint enforcement against cross-tenant attacks.

#### Step 1: Attempt Illegal Cross-Tenant Insert (Expect Engine Rejection)
**PowerShell:**
```powershell
kubectl exec -n workflow-platform postgres-0 -- psql -U app_user -d workflow_db -c "BEGIN; SELECT set_config('app.current_tenant_id', 'tenant-corp-a', true); INSERT INTO workflows (id, tenant_id, type, title, requester_id, requester_name, status) VALUES ('wf-illegal-test', 'tenant-corp-b', 'EXPENSE', 'Cross Tenant Hack', 'user-1', 'Attacker', 'DRAFT'); COMMIT;"
```

**Bash / Git Bash:**
```bash
kubectl exec -n workflow-platform postgres-0 -- psql -U app_user -d workflow_db -c "BEGIN; SELECT set_config('app.current_tenant_id', 'tenant-corp-a', true); INSERT INTO workflows (id, tenant_id, type, title, requester_id, requester_name, status) VALUES ('wf-illegal-test', 'tenant-corp-b', 'EXPENSE', 'Cross Tenant Hack', 'user-1', 'Attacker', 'DRAFT'); COMMIT;"
```

**Expected PostgreSQL Error:**
```
ERROR:  new row violates row-level security policy for table "workflows"
```

#### Step 2: Query Workflows (Verify Isolation)
**PowerShell:**
```powershell
kubectl exec -n workflow-platform postgres-0 -- psql -U app_user -d workflow_db -c "BEGIN; SELECT set_config('app.current_tenant_id', 'tenant-corp-a', true); SELECT tenant_id, count(*) FROM workflows GROUP BY tenant_id; COMMIT;"
```

**Bash / Git Bash:**
```bash
kubectl exec -n workflow-platform postgres-0 -- psql -U app_user -d workflow_db -c "BEGIN; SELECT set_config('app.current_tenant_id', 'tenant-corp-a', true); SELECT tenant_id, count(*) FROM workflows GROUP BY tenant_id; COMMIT;"
```

**Expected Result:**
```
   tenant_id   | count 
---------------+-------
 tenant-corp-a |     5
---

### Scenario 5: End-to-End Distributed Tracing & W3C Trace Context Propagation

**Objective**: Verify that user actions from the browser automatically generate W3C `traceparent` and correlation headers, create child database spans in Fastify, and propagate across Kafka to consumers in Jaeger.

#### Step 1: Submit an Expense or Step Approval in the Browser
1. Open [http://localhost:8080/expenses](http://localhost:8080/expenses) in your browser.
2. Create or select a workflow, and click **Submit for Approval** or **Approve Request**.
3. In DevTools **Network $\rightarrow$ Headers**, verify outgoing request headers:
   - `traceparent: 00-<trace_id>-<span_id>-01`
   - `x-correlation-id: req-...`
   - `x-tenant-id: tenant-corp-a`

#### Step 2: Query Jaeger for Trace Graph & DB Query Spans
**Browser:** Open Jaeger UI at [http://localhost:16686/search](http://localhost:16686/search), select service **`workflow-api`**, and click **Find Traces**.
- Observe the full trace waterfall showing:
  - `POST /api/v1/workflows/:id/submit` (HTTP Span)
  - `db.query` (Child span tracking PostgreSQL execution latency & SQL statement)
  - `kafka.produce` & downstream consumer spans.

**CLI Inspection:**
```bash
curl -s "http://localhost:16686/api/traces?service=workflow-api&limit=1"
```

---

### Scenario 6: Deep Health & Readiness Probes

**Objective**: Verify that `/health/live` and `/health/ready` report true process and dependency health (PostgreSQL connection pool and Kafka cluster reachability).

#### Method A: Test Liveness Probe (`/health/live`)
```bash
curl -s http://localhost:3000/health/live
```
**Expected Output:**
```json
{
  "status": "ok",
  "service": "workflow-api",
  "timestamp": "2026-09-20T05:43:01.834Z",
  "uptimeSeconds": 120
}
```

#### Method B: Test Deep Readiness Probe (`/health/ready`)
```bash
curl -s http://localhost:3000/health/ready
```
**Expected Output:**
```json
{
  "status": "ready",
  "service": "workflow-api",
  "checks": {
    "database": "connected",
    "kafka": "connected"
  }
}
```

---

### Scenario 7: Prometheus Metrics, Alerts & Provisioned Grafana Dashboards

**Objective**: Inspect PostgreSQL pool connection metrics, Outbox backlog gauges, and active Prometheus alerting rules.

#### Method A: Query Prometheus Pool & Outbox Metrics
```bash
# Query active PostgreSQL pool connections
curl -s "http://localhost:9090/api/v1/query?query=sum(pg_pool_active_connections)+by+(service)"

# Query outbox backlog count
curl -s "http://localhost:9090/api/v1/query?query=workflow_outbox_backlog_count"

# Query Kafka DLQ messages
curl -s "http://localhost:9090/api/v1/query?query=kafka_dlq_messages_total"
```

#### Method B: Open Provisioned Grafana Dashboards
1. Navigate to Grafana at [http://localhost:3005](http://localhost:3005).
2. Open **Dashboards** $\rightarrow$ **Workflow Platform - System Health & Business Performance**.
3. View real-time graphs for HTTP throughput, DB Connection Pool Saturation, Outbox Lag, and DLQ Message Counts.

---

## 🧪 Automated Testing Guide

### 1. Run Unit, Contract & Integration Tests (Vitest)
Executes multi-step state machine unit tests, transactional outbox tests, CloudEvent schema compatibility tests, and consumer idempotency tests:
```bash
npm run test
```

### 2. Run End-to-End Automated Tests (Playwright)
Executes multi-tenant isolation tests and complete end-to-end workflow lifecycle journeys:
```bash
# First time setup (if Playwright browsers not installed):
npx playwright install chromium

# Run E2E tests:
npm run test:e2e
```
To run tests interactively with UI mode:
```bash
npx playwright test --ui
```

### 3. Run Performance & Load Tests (k6)
Simulates concurrent users creating, submitting, and listing workflows:
```bash
k6 run tests/perf/k6-workflow-load.js
```

---

## 🧹 Teardown & Cleanup

### Stop Kubernetes Deployment:
```bash
# 1. Stop all background port-forward tunnels
.\k8s\local\stop-port-forwards.ps1    # PowerShell (Windows)
./k8s/local/stop-port-forwards.sh     # Bash (Linux/macOS)

# 2. Delete all Kubernetes resources and namespace
kubectl delete -k k8s/
```

### Stop Local Docker Compose:
```bash
docker compose down -v
```

### Destroy Local Kubernetes Cluster (if created with kind/k3d):
```bash
# For Kind:
kind delete cluster --name workflow-multi-node

# For k3d:
k3d cluster delete workflow-cluster
```
