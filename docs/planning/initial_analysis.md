Based on the Job Description for the **Staff / Senior Quality Engineer – Workflow Platform** at Money Forward, the team is building an internal **multi-tenant, enterprise workflow engine as a platform service**.

Instead of every individual SaaS product at Money Forward (e.g., Cloud Accounting, Expense, Payroll, Invoice) writing its own document routing, approval hierarchy, and sign-off logic, this centralized platform provides those capabilities out of the box.

---

## 1. High-Level Architecture Overview

The system is designed as a distributed, event-driven platform composed of four primary layers:

```
+-------------------------------------------------------------------------+
|                  Client Products (Host Applications)                    |
|   (Money Forward Expense, Invoice, Accounting, HR/Payroll, etc.)        |
+-------------------------------------------------------------------------+
       |                                                 |
       | Embeds UI                                       | API / Event calls
       v                                                 v
+-----------------------------+               +---------------------------+
| Micro-Frontend (React)      |               | API Gateway / Auth Layer  |
| - Approval widgets          |               | - Tenant ID validation    |
| - Document submission forms |               | - Role & Permission checks|
+-----------------------------+               +---------------------------+
               \                                            /
                \                                          /
                 v                                        v
+-------------------------------------------------------------------------+
|               Workflow Core Engine (Kotlin / Spring Boot)               |
|  - State Machine (Draft -> Submitted -> In Review -> Approved/Rejected) |
|  - Dynamic Route Evaluator (delegation, conditions, multi-step)         |
|  - Multi-Tenant Data Isolation Engine                                   |
|  - Audit Log & Event Emitter                                            |
+-------------------------------------------------------------------------+
       |                                                 ^
       | Emits State Changes                             | Consumes commands/
       v                                                 | external triggers
+-------------------------------------------------------------------------+
|                      Kafka Event Backbone                               |
|  - WorkflowEvents (Submitted, Approved, Rejected, Escalated)            |
|  - Outbox Pattern / Exactly-Once / At-Least-Once Delivery               |
+-------------------------------------------------------------------------+
       |                                                 |
       v                                                 v
+-----------------------------+               +---------------------------+
| Downstream Consumers        |               | Multi-Tenant Datastores   |
| - Notification service      |               | - Relational DB (Postgres)|
| - Audit & Compliance logs   |               | - Document/Attachment S3  |
| - Host App State Sync       |               | - Tenant isolation logic  |
+-----------------------------+               +---------------------------+

```

---

## 2. Core Architectural Building Blocks

### A. Presentation Layer: Micro-Frontends (React)

* **What it does:** Rather than product teams building approval forms from scratch, the platform team delivers embeddable UI components (e.g., an approval timeline drawer, document viewer, delegation modal).
* **Key Challenges:** Web component lifecycle inside host apps, CSS/style collisions, cross-frame messaging, version mismatches, and browser performance.

### B. Core Application Layer: Workflow Engine (Kotlin + Spring Boot)

* **State Machine & Rules Engine:** Handles complex routing logic (e.g., *"If amount > ¥1,000,000, require Branch Manager + CFO approval; else Manager only"*).
* **Multi-Tenancy:** Money Forward serves thousands of corporate clients. Every single query, cache key, and event must strictly enforce tenant isolation to avoid multi-tenant data bleed.
* **Idempotency & Concurrency:** Handles race conditions, such as two managers approving the same step simultaneously or network retries triggering duplicated state transitions.

### C. Asynchronous & Messaging Layer: Event-Driven (Apache Kafka)

* **Decoupled Integration:** When an invoice is approved, the Workflow Platform emits an event to Kafka (`InvoiceWorkflowApproved`). The host app (e.g., Accounting) listens and updates its financial ledgers.
* **Delivery Semantics & Failure Recovery:** Deals with out-of-order events, consumer lag, retry loops, dead-letter queues (DLQ), and schema evolution (Avro/Protobuf/JSON Schema).

### D. Infrastructure & Ops (AWS, Kubernetes, Terraform, ArgoCD)

* Containerized deployments on Kubernetes (EKS), automated via GitOps (ArgoCD / GitHub Actions), provisioned with Terraform.

---

## 3. Scope of Work for the Staff Quality Engineer

As a Staff IC, the role is **not** manual testing or writing simple unit tests; it focuses on **system-level resilience, contract testing, and testability architecture**:

| Focus Area | Engineering Scope & What You Will Own |
| --- | --- |
| **Contract & Integration Testing** | Implement consumer-driven contract tests (e.g., Pact) for REST APIs and Kafka event schemas so platform changes never break upstream/downstream services. |
| **Resilience & Chaos Engineering** | Validate partial network partitions, Kafka broker downtime, database failovers, and check that retries do not trigger duplicate approvals or cascading failures. |
| **Multi-Tenant Security & Isolation** | Design automated security assertions to prove that Tenant A can never read, approve, or alter Tenant B’s workflows or audit logs. |
| **Micro-Frontend Integration** | Build automated end-to-end suites (using tools like Playwright) verifying that embeddable React widgets cleanly integrate into different host applications. |
| **Performance & Bottleneck Analysis** | Run load/stress tests across distributed paths. Analyze Kubernetes metrics, distributed traces (APM), and database locks to pinpoint bottlenecks under high concurrency. |
| **Test Environments & Data Strategy** | Solve the platform test-data problem: How do product teams test against the workflow platform in staging without depending on fragile, shared databases? |

---

## 4. Key Takeaways for Interview Prep

1. **System Boundaries:** Emphasize how you test *between* systems (contract testing, asynchronous schema evolution, API backward compatibility).
2. **Failure Modes:** Be ready to talk about distributed systems edge cases: idempotency keys, race conditions, distributed transactions (Saga / Outbox patterns), and handling poisoned messages in Kafka.
3. **Multi-Tenancy:** Understand row-level security vs. schema-per-tenant isolation models and how to test for tenant leaks.
4. **Influence Without Authority:** Because this is a shared platform used across many Money Forward product teams, you will need to guide best practices and define release-readiness criteria across multiple engineering squads.


Here is a breakdown of the core components inside the **Workflow Core Engine (Kotlin / Spring Boot)**, explaining what each term means, how it works in practice, and what a Quality Engineer needs to test.

---

### 1. State Machine

#### What It Is

A state machine manages the lifecycle of an item (like an expense claim or an invoice). It guarantees that a document can only be in **one state at a time** and can only move to another state via **valid transitions triggered by defined events**.

#### Real-World Example

Consider an invoice workflow:

* **States:** `Draft` $\rightarrow$ `Pending_Approval` $\rightarrow$ `Under_Review` $\rightarrow$ `Approved` (or `Rejected` / `Canceled`).
* **Rule:** You cannot jump directly from `Draft` to `Approved` without going through `Pending_Approval`.
* **Invalid Action:** Once an invoice is in `Approved` state, a user cannot submit a `Cancel` action.

#### Key Edge Cases to Test

* **Invalid Transitions:** Can a user call the API to "Approve" a document that is still in `Draft`? The state machine must reject this with a `400 Bad Request` or `409 Conflict`.
* **Race Conditions (Double Approval):** If two managers click "Approve" at the exact same millisecond, does the engine process both, or does it use **optimistic locking** (`version` column in the DB) to process the first and safely reject the second?
* **Rollback on Error:** If state changes to `Approved` in memory but the database write fails, does the state cleanly roll back?

---

### 2. Dynamic Route Evaluator

#### What It Is

This is the business logic engine that inspects the document’s data, company policy, and organizational chart to decide: **"Who needs to approve this next?"**

Because every company has different rules, the routing logic cannot be hard-coded; it must be evaluated **dynamically** at runtime.

#### Real-World Example

Suppose a company sets up these rules:

1. If Expense $\le$ ¥10,000 $\rightarrow$ Line Manager only.
2. If Expense $>$ ¥10,000 and $\le$ ¥500,000 $\rightarrow$ Line Manager $\rightarrow$ Department Head.
3. If Expense $>$ ¥500,000 $\rightarrow$ Line Manager $\rightarrow$ Department Head $\rightarrow$ CFO.
4. **Delegation:** If the CFO is on leave, route to the Acting Deputy.

#### Key Edge Cases to Test

* **Boundary Values:** Exactly ¥10,000 vs. ¥10,001.
* **Delegation Loops & Circular Routing:** If Manager A delegates approvals to Manager B, and Manager B delegates to Manager A, does the evaluator enter an infinite loop or throw a validation error?
* **Empty Approver Lists:** What happens if a department currently has no assigned manager? Does the workflow crash, or does it route to an admin fallback queue?
* **Dynamic Attribute Changes:** If an employee changes departments *while* an expense claim is pending, does the evaluator route to the old manager or the new manager?

---

### 3. Multi-Tenant Data Isolation Engine

#### What It Is

Money Forward operates a B2B SaaS platform used by thousands of different companies (tenants). The multi-tenant engine guarantees that **Tenant A can never see, modify, or leak data into Tenant B’s space**, even though both share the same application servers, microservices, and database tables.

#### How It Works Architecturally

* **Tenant Context Injection:** When a request hits the API Gateway, the authentication token (JWT) is parsed to extract `tenant_id`.
* **Thread-Local / Reactive Context:** The `tenant_id` is propagated through Spring Boot's context.
* **Row-Level Isolation / Hibernate Filters:** Every database query automatically appends:
```sql
WHERE tenant_id = 'tenant-123'

```


even if the developer forgot to write it manually.

#### Key Edge Cases to Test

* **IDOR (Insecure Direct Object Reference):** If a user from Tenant A sends a request:
`POST /api/workflows/doc-999/approve` where `doc-999` belongs to Tenant B, the engine must return a `404 Not Found` (or `403 Forbidden`), not an approval.
* **Leaky Caches:** If Redis or in-memory caches are used, are the cache keys prefixed with the tenant ID (e.g., `tenant:123:workflow:999`), or does Tenant A's cache overwrite Tenant B's?
* **Kafka Message Isolation:** When consuming events from a shared Kafka topic, does the consumer verify that the event payload's tenant ID matches the expected execution context?

---

### 4. Audit Log & Event Emitter

#### What It Is

Financial and back-office applications are subject to strict legal and compliance standards (such as SOX, J-SOX, and tax audits). Every action taken must leave an **immutable paper trail**, and external systems must be informed in real time.

#### How It Works Architecturally

1. **Audit Log:** An append-only record of every state transition:
* *Who* did it (User ID, IP address).
* *What* was changed (Old State: `Pending` $\rightarrow$ New State: `Approved`).
* *When* it happened (UTC timestamp).
* *Why* (Approval comment, re-routing reason).


2. **Event Emitter (Transactional Outbox Pattern):**
* Emits events to Kafka so other services (e.g., Notification Service, Accounting Ledger) know what happened.
* To prevent a distributed inconsistency where the database saves the approval but Kafka goes down and drops the message, the engine writes the event to an **Outbox table** inside the same database transaction, which is then published to Kafka by a relay process.



#### Key Edge Cases to Test

* **Dual-Write Failures:** If the database commit succeeds but Kafka publication fails, does the event get lost, or does the Outbox pattern retry until published?
* **Tamper Proofing:** Can any API or internal user update or delete an existing audit log entry? (Audit logs must be strictly append-only).
* **At-Least-Once Delivery & Duplicates:** When Kafka re-delivers an event, can downstream services handle receiving the exact same `WorkflowApproved` event twice without applying double accounting credits?

---

### Summary of Component Interactions

| Component | Primary Question It Answers | Primary Risk If It Fails |
| --- | --- | --- |
| **State Machine** | *"Is this document allowed to move into this state?"* | Illegitimate approvals, skipped checkpoints, corrupted record states. |
| **Dynamic Route Evaluator** | *"Given the metadata and rules, who approves next?"* | Financial policy violations, unassigned or blocked approval chains. |
| **Multi-Tenant Engine** | *"Does this user belong to the company that owns this record?"* | Massive data leaks, regulatory penalties, critical security breach. |
| **Audit Log & Event Emitter** | *"Who changed what, and how do we notify downstream apps?"* | Compliance failure during audits; out-of-sync financial ledgers. |


When the JD states that this is a **"shared platform that lets Money Forward product teams add approval and document-submission workflows without building those capabilities from scratch,"** it refers to an internal **Platform as a Service (PaaS)** model for internal software teams.

Instead of individual SaaS product teams (Expense, Accounting, HR, Payroll, Invoicing) writing custom approval engines from the ground up, they treat this new system like an internal Stripe or AWS for workflows.

---

### The Problem: Why Companies Stop Building "From Scratch"

Money Forward offers over 40 distinct B2B SaaS products under its Cloud ERP suite. Nearly every enterprise back-office product requires approval workflows:

* **Expense:** Employee files a travel receipt $\rightarrow$ needs manager sign-off $\rightarrow$ finance team approves $\rightarrow$ payout.
* **Invoice:** Vendor sends a ¥2,000,000 bill $\rightarrow$ department head reviews $\rightarrow$ CFO signs off.
* **HR / Payroll:** Employee requests salary advance or paternity leave $\rightarrow$ HR team validates $\rightarrow$ CEO approves.
* **Accounting:** Journal entry adjustment $\rightarrow$ Senior Accountant verifies.

#### Without a shared platform (The "From Scratch" Anti-Pattern):

```
[MF Expense Team]    ---> Re-invents DB schema, writes approval logic, builds UI modals
[MF Invoice Team]    ---> Re-invents DB schema, writes approval logic, builds UI modals
[MF HR Team]         ---> Re-invents DB schema, writes approval logic, builds UI modals
[MF Accounting Team] ---> Re-invents DB schema, writes approval logic, builds UI modals

```

This causes major engineering and business issues:

1. **Massive Redundant Effort:** Four separate engineering teams waste months solving the exact same problems (state tracking, delegation rules, reminders, audit trails).
2. **Inconsistent User Experience:** A company using both Money Forward Expense and Money Forward Invoice sees two completely different approval screens, button behaviors, and notification styles.
3. **Compliance Risks:** Legal requirements (such as Japanese tax compliance and J-SOX audit trail requirements) must be independently implemented and vetted 4+ times, risking non-compliance if one team makes a mistake.
4. **Integration Silos:** A CEO using multiple products has to open 5 different tabs to approve 5 different items, rather than having a single unified approval inbox.

---

### What Money Forward Is Trying to Do: The Shared Platform Approach

They are building a **centralized, plug-and-play Workflow Platform** developed by a dedicated platform engineering team:

```
                  +-----------------------------------+
                  |  Central Workflow Platform Team   |
                  |  (The team this JD is hiring for) |
                  +-----------------------------------+
                                    |
          Provides reusable components & APIs to all product teams
                                    |
     +------------------------------+------------------------------+
     |                              |                              |
     v                              v                              v
[MF Expense]                 [MF Invoice]                 [MF HR / Payroll]
Uses platform for:           Uses platform for:           Uses platform for:
• Multi-level approval       • Vendor bill approval       • Leave/Promotion requests
• Embeds React UI drawer     • Embeds React UI drawer     • Embeds React UI drawer
• Listens to Kafka events    • Listens to Kafka events    • Listens to Kafka events

```

#### How a Product Team Uses It (Plug-and-Play):

1. **Frontend Integration:** The host product embeds the platform's **React Micro-Frontend** (e.g., an `<ApprovalTimeline documentId="..."/>` component). The host app writes zero UI code for rendering approval step histories or delegate buttons.
2. **Backend Configuration:** The host product registers its workflow via the platform's REST API:
* *"Create workflow template for Invoices: If total > ¥1M, route to Manager $\rightarrow$ Director $\rightarrow$ CFO."*


3. **Event Consumption:** When a manager hits "Approve", the platform executes the state change and emits a Kafka event (`WorkflowApproved`). The host app simply listens to that event and marks the document paid or posted.

---

### Comparison: "From Scratch" vs. "Platform"

| Dimension | Building From Scratch (Old Way) | Shared Workflow Platform (New Way) |
| --- | --- | --- |
| **Time to Market** | 3 to 6 months per product team to build basic workflow logic. | Days to integrate via pre-built APIs and UI widgets. |
| **Maintenance** | Every team fixes their own bugs, handles edge cases, and scales databases. | One platform team hardens, patches, and optimizes for the whole company. |
| **Audit & Legal Compliance** | Each app risks failing financial/tax audits if logging is incomplete. | Platform guarantees tamper-proof audit trails out of the box. |
| **End-User Experience** | Fragmented interfaces across the Money Forward ecosystem. | Unified design, consistent mobile/desktop behavior across all products. |
| **Future Capabilities (e.g., AI Agents)** | Every team would have to build custom AI approval bots independently. | The platform injects "Digital Worker" AI agents into the workflow engine once, instantly powering all products. |

---

### What This Means for Your QE Role

Because the product teams are now your **"internal customers"**, quality engineering changes fundamentally:

* **Breaking Changes Break Everyone:** If your platform releases a regression or alters an API payload format, you don't just break one feature—you break Money Forward Expense, Invoice, and HR simultaneously.
* **Consumer-Driven Contract Testing:** You must ensure that platform API contracts and Kafka message schemas maintain backward compatibility.
* **Host Application Compatibility:** Your automated testing needs to run inside realistic dummy host apps to verify that micro-frontends work smoothly without style clashes, security bypasses, or rendering failures.
* **Multi-Tenant Stress Testing:** Unlike a single-app service, this platform handles aggregated traffic spikes from dozens of applications concurrently.

When the JD states that this is a **"shared platform that lets Money Forward product teams add approval and document-submission workflows without building those capabilities from scratch,"** it refers to an internal **Platform as a Service (PaaS)** model for internal software teams.

Instead of individual SaaS product teams (Expense, Accounting, HR, Payroll, Invoicing) writing custom approval engines from the ground up, they treat this new system like an internal Stripe or AWS for workflows.

---

### The Problem: Why Companies Stop Building "From Scratch"

Money Forward offers over 40 distinct B2B SaaS products under its Cloud ERP suite. Nearly every enterprise back-office product requires approval workflows:

* **Expense:** Employee files a travel receipt $\rightarrow$ needs manager sign-off $\rightarrow$ finance team approves $\rightarrow$ payout.
* **Invoice:** Vendor sends a ¥2,000,000 bill $\rightarrow$ department head reviews $\rightarrow$ CFO signs off.
* **HR / Payroll:** Employee requests salary advance or paternity leave $\rightarrow$ HR team validates $\rightarrow$ CEO approves.
* **Accounting:** Journal entry adjustment $\rightarrow$ Senior Accountant verifies.

#### Without a shared platform (The "From Scratch" Anti-Pattern):

```
[MF Expense Team]    ---> Re-invents DB schema, writes approval logic, builds UI modals
[MF Invoice Team]    ---> Re-invents DB schema, writes approval logic, builds UI modals
[MF HR Team]         ---> Re-invents DB schema, writes approval logic, builds UI modals
[MF Accounting Team] ---> Re-invents DB schema, writes approval logic, builds UI modals

```

This causes major engineering and business issues:

1. **Massive Redundant Effort:** Four separate engineering teams waste months solving the exact same problems (state tracking, delegation rules, reminders, audit trails).
2. **Inconsistent User Experience:** A company using both Money Forward Expense and Money Forward Invoice sees two completely different approval screens, button behaviors, and notification styles.
3. **Compliance Risks:** Legal requirements (such as Japanese tax compliance and J-SOX audit trail requirements) must be independently implemented and vetted 4+ times, risking non-compliance if one team makes a mistake.
4. **Integration Silos:** A CEO using multiple products has to open 5 different tabs to approve 5 different items, rather than having a single unified approval inbox.

---

### What Money Forward Is Trying to Do: The Shared Platform Approach

They are building a **centralized, plug-and-play Workflow Platform** developed by a dedicated platform engineering team:

```
                  +-----------------------------------+
                  |  Central Workflow Platform Team   |
                  |  (The team this JD is hiring for) |
                  +-----------------------------------+
                                    |
          Provides reusable components & APIs to all product teams
                                    |
     +------------------------------+------------------------------+
     |                              |                              |
     v                              v                              v
[MF Expense]                 [MF Invoice]                 [MF HR / Payroll]
Uses platform for:           Uses platform for:           Uses platform for:
• Multi-level approval       • Vendor bill approval       • Leave/Promotion requests
• Embeds React UI drawer     • Embeds React UI drawer     • Embeds React UI drawer
• Listens to Kafka events    • Listens to Kafka events    • Listens to Kafka events

```

#### How a Product Team Uses It (Plug-and-Play):

1. **Frontend Integration:** The host product embeds the platform's **React Micro-Frontend** (e.g., an `<ApprovalTimeline documentId="..."/>` component). The host app writes zero UI code for rendering approval step histories or delegate buttons.
2. **Backend Configuration:** The host product registers its workflow via the platform's REST API:
* *"Create workflow template for Invoices: If total > ¥1M, route to Manager $\rightarrow$ Director $\rightarrow$ CFO."*


3. **Event Consumption:** When a manager hits "Approve", the platform executes the state change and emits a Kafka event (`WorkflowApproved`). The host app simply listens to that event and marks the document paid or posted.

---

### Comparison: "From Scratch" vs. "Platform"

| Dimension | Building From Scratch (Old Way) | Shared Workflow Platform (New Way) |
| --- | --- | --- |
| **Time to Market** | 3 to 6 months per product team to build basic workflow logic. | Days to integrate via pre-built APIs and UI widgets. |
| **Maintenance** | Every team fixes their own bugs, handles edge cases, and scales databases. | One platform team hardens, patches, and optimizes for the whole company. |
| **Audit & Legal Compliance** | Each app risks failing financial/tax audits if logging is incomplete. | Platform guarantees tamper-proof audit trails out of the box. |
| **End-User Experience** | Fragmented interfaces across the Money Forward ecosystem. | Unified design, consistent mobile/desktop behavior across all products. |
| **Future Capabilities (e.g., AI Agents)** | Every team would have to build custom AI approval bots independently. | The platform injects "Digital Worker" AI agents into the workflow engine once, instantly powering all products. |

---

### What This Means for Your QE Role

Because the product teams are now your **"internal customers"**, quality engineering changes fundamentally:

* **Breaking Changes Break Everyone:** If your platform releases a regression or alters an API payload format, you don't just break one feature—you break Money Forward Expense, Invoice, and HR simultaneously.
* **Consumer-Driven Contract Testing:** You must ensure that platform API contracts and Kafka message schemas maintain backward compatibility.
* **Host Application Compatibility:** Your automated testing needs to run inside realistic dummy host apps to verify that micro-frontends work smoothly without style clashes, security bypasses, or rendering failures.
* **Multi-Tenant Stress Testing:** Unlike a single-app service, this platform handles aggregated traffic spikes from dozens of applications concurrently.

You have the core concept down, but there are a few important nuances—specifically around **sync vs. async boundaries**, who acts as the **producer vs. consumer**, and how actions loop back.

Here is the exact breakdown of how these pieces connect:

---

### 1. Is the Form Submission & Route Decision Sync or Async?

It is typically a **hybrid**:

* **Synchronous validation & handoff:**
When the user clicks "Submit", the browser sends a synchronous HTTP `POST` to the Workflow backend. The backend synchronously validates the data (e.g., checks permissions, validates required fields, verifies that the template exists).
* **Where the route decision happens:**
* **Option A (Synchronous Route Evaluation - Most Common):** If the routing rules and org charts are stored locally in the platform's database, the State Machine evaluates the first step **immediately/synchronously** during that API call. It saves the workflow in `PENDING_APPROVAL_STEP_1` and returns `201 Created` with the workflow ID to the frontend. The frontend displays: *"Submitted successfully! Next approver: Jane Doe"*.
* **Option B (Asynchronous Route Evaluation - Heavy Workflows):** If evaluating the path requires querying multiple external microservices (e.g., checking external HR budgets or complex dynamic org trees), the initial API call immediately returns `202 Accepted` (`status: INITIALIZING`), and a background worker evaluates the route asynchronously.



In standard enterprise platforms like Money Forward, **Option A** is the standard for fast user feedback.

---

### 2. Is the Workflow Engine the Kafka Producer?

**Yes.**
Once the State Machine commits the new state to the database, it **produces (publishes)** an event to Kafka.

* **Producer:** Workflow Core Engine.
* **Topic:** e.g., `workflow-events`.
* **Payload:**
```json
{
  "eventType": "WORKFLOW_STEP_PENDING",
  "workflowId": "wf_12345",
  "tenantId": "corp_abc",
  "requiredApproverId": "user_manager_99",
  "stepNumber": 1
}

```



---

### 3. Who Consumes that Kafka Event?

**Multiple downstream services consume this event concurrently**, including:

1. **Notification Service:** Reads the event $\rightarrow$ sends a push notification, Slack message, or email to `user_manager_99` saying *"You have a new expense report to approve"*.
2. **Host SaaS Application (e.g., MF Expense):** Reads the event $\rightarrow$ updates its internal document badge from `Draft` to `Under Review`.
3. **Unified Tasks / Approvals Inbox Service:** Reads the event $\rightarrow$ adds this pending task to the manager’s global to-do list across all Money Forward apps.

---

### 4. How Does the Manager Approve? Does it Go Through Kafka Again?

When the manager clicks "Approve", the request **does NOT go directly into Kafka first**.

#### The Approval Flow:

1. **Direct Synchronous API Call:**
The manager opens the approval page (which embeds the workflow UI) and clicks **"Approve"**. The UI makes a direct synchronous `POST /api/v1/workflows/wf_12345/approve` call directly to the **Workflow Engine**.
* *Why?* Because the manager needs **instant feedback** (e.g., "Approval recorded", or "Error: Someone else already approved/rejected this"). If this went via Kafka, the UI would have to poll or wait on WebSockets to know if the click worked.


2. **State Machine Updates:**
The State Machine picks up the call, validates that this user has permission to approve Step 1, transitions the state, and records the audit log.
* Since this workflow has **2 approvals**, it moves the state to `PENDING_APPROVAL_STEP_2` (e.g., the Department Director).


3. **Engine Produces a New Event to Kafka:**
The Workflow Engine produces another event to Kafka: `WORKFLOW_STEP_1_APPROVED` and `WORKFLOW_STEP_2_PENDING`.
4. **Notification Service & Others React Again:**
The Notification service reads the new event and pings the Step 2 approver (Director).

---

### Summary of the Flow Cycle

```
[Employee Submits Form]
         │
         ▼ (Sync HTTP POST)
[Workflow State Machine] ──(Saves Step 1)──► [Database]
         │
         ▼ (Produces to Kafka)
      [Kafka] ──► [Notification Service] ──► Pings Approver 1
         │
         ▼ (Approver 1 clicks Approve)
         │ (Sync HTTP POST)
[Workflow State Machine] ──(Advances to Step 2)──► [Database]
         │
         ▼ (Produces to Kafka)
      [Kafka] ──► [Notification Service] ──► Pings Approver 2
         │
         ▼ (Approver 2 clicks Approve)
         │ (Sync HTTP POST)
[Workflow State Machine] ──(Marks Complete)──► [Database]
         │
         ▼ (Produces to Kafka)
      [Kafka] ──► [Host App / Expense] ──► Triggers Bank Payout & Accounting

```

### Why This Architecture Matters for a Quality Engineer

* **Sync APIs** require testing **concurrency, response times, and HTTP error codes** (e.g., two people clicking Approve at the same time).
* **Kafka Event Streams** require testing **eventual consistency, schema contracts, out-of-order delivery, and at-least-once delivery duplicates** (e.g., ensuring a Kafka replay doesn't trigger the notification or payout twice).