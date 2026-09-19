# Money Forward — Workflow Platform: Architecture & Developer Overview

> **Source Reference**: [Senior Quality Engineer, Workflow Platform, Nagoya — Money Forward](https://japan-dev.com/jobs/money-forward/money-forward-staff-quality-engineer-workflow-platform-nagoya-w8wrbo)
>
> This document breaks down the platform architecture described in the job listing. It is intended to be shared with engineers, QA professionals, or anyone who wants to understand what this system is, how it works, and how the pieces fit together.

---

## Table of Contents

1. [What Is This Platform?](#1-what-is-this-platform)
2. [Why Does It Exist? (The Problem It Solves)](#2-why-does-it-exist)
3. [High-Level Architecture Overview](#3-high-level-architecture-overview)
4. [Backend — Kotlin + Spring Framework](#4-backend--kotlin--spring-framework)
5. [Frontend — React Micro-Frontends](#5-frontend--react-micro-frontends)
6. [Messaging & Event Architecture — Kafka](#6-messaging--event-architecture--kafka)
7. [Infrastructure — AWS + Kubernetes + Terraform](#7-infrastructure--aws--kubernetes--terraform)
8. [CI/CD Pipeline — CircleCI, GitHub Actions, ArgoCD](#8-cicd-pipeline--circleci-github-actions-argocd)
9. [Multi-Tenancy Design](#9-multi-tenancy-design)
10. [Quality Engineering Landscape](#10-quality-engineering-landscape)
11. [AI Transformation (AX) Direction](#11-ai-transformation-ax-direction)
12. [Tech Stack Summary](#12-tech-stack-summary)
13. [Glossary](#13-glossary)

---

## 1. What Is This Platform?

The **Money Forward Workflow Platform** is a **shared internal platform** built to allow different Money Forward product teams to plug in **approval workflows and document-submission workflows** without building that functionality themselves from scratch.

Think of it as an internal platform-as-a-service (PaaS) layer — other teams within the company integrate with it, rather than reinventing the wheel every time they need "someone approves X before Y happens."

**Real-world examples of what this platform enables:**
- Employee expense claim approvals
- Document submission and sign-off routing
- Multi-step delegation and permission-based approval chains
- Auditable state transitions (a full history of who did what, when)

---

## 2. Why Does It Exist?

Without a shared platform like this, every product team at Money Forward would have to independently build:
- Their own approval engine
- Their own notification and event system
- Their own permissions and delegation model
- Their own audit logging

This leads to duplicated effort, inconsistent behaviour, and bugs that are hard to track across teams. The Workflow Platform **centralises** this complexity, so product teams just integrate and get it for free.

---

## 3. High-Level Architecture Overview

```
+--------------------------------------------------------------------------+
|                      Money Forward Product Teams                          |
|  (Each team's app embeds the Workflow micro-frontend and calls the API)   |
+-------------+--------------------------------------+---------------------+
              | REST API calls                        | Kafka Events
              v                                       v
+-------------------------+              +--------------------------------+
|   Workflow Platform API  |<----------->|   Kafka Event Bus (Topics)     |
|   (Kotlin / Spring)      |             |  - workflow.created             |
|                          |             |  - workflow.approved            |
|  - Approval Engine       |             |  - workflow.rejected            |
|  - Delegation Logic      |             |  - step.completed               |
|  - Tenant Isolation      |             +--------------------------------+
|  - Audit Logging         |
+------------+------------+
             |
             v
+--------------------------------------------------------+
|              AWS + Kubernetes Cluster                   |
|  +--------------+  +--------------+  +--------------+  |
|  |  Service Pod |  |  Service Pod |  |  Service Pod |  |
|  |  (Tenant A)  |  |  (Tenant B)  |  |  (Tenant C)  |  |
|  +--------------+  +--------------+  +--------------+  |
|               Managed via Terraform + ArgoCD            |
+--------------------------------------------------------+
              ^
              | Embedded Web Components
+---------------------------------------------------------+
|            React Micro-Frontends                         |
|  (Embedded into each host product app's UI)              |
|  - Approval status widgets                               |
|  - Submission forms                                      |
|  - Task inbox / queue views                              |
+---------------------------------------------------------+
```

> **Key Takeaway**: The platform exposes REST APIs and publishes/consumes Kafka events. Product teams embed its micro-frontends into their own UIs and call its APIs. Everything runs on Kubernetes in AWS, managed by Terraform, and deployed via ArgoCD.

---

## 4. Backend — Kotlin + Spring Framework

### Technology
- **Language**: Kotlin
- **Framework**: Spring Framework (Spring Boot + Spring Web + Spring Data)

### Why Kotlin?
Kotlin is a modern JVM language with null-safety built in, concise syntax, and excellent interoperability with Java. It's widely used in enterprise backend services, particularly in Asia-Pacific tech companies.

### What the Backend Does

The backend is the **core engine** of the platform. It handles:

| Responsibility | Description |
|---|---|
| **Approval Routing** | Determines who needs to approve a workflow step based on delegation rules |
| **State Machine** | Tracks the lifecycle of each workflow (pending → in-review → approved/rejected) |
| **Tenant Isolation** | Ensures data for Tenant A is never visible to Tenant B |
| **REST API Layer** | Exposes endpoints for product teams to create, query, and manage workflows |
| **Event Publishing** | Publishes domain events to Kafka when workflow state changes |
| **Audit Logging** | Records every state transition with timestamps and actor identities |

### Typical API Contract (Conceptual)

```http
POST /api/v1/workflows
Content-Type: application/json
X-Tenant-ID: acme-corp

{
  "type": "expense-approval",
  "submittedBy": "user-123",
  "steps": [
    { "approver": "manager-456", "order": 1 },
    { "approver": "finance-789", "order": 2 }
  ],
  "payload": { ... }
}
```

---

## 5. Frontend — React Micro-Frontends

### Technology
- **Framework**: React
- **Pattern**: Micro-frontends (MFE) as **embedded web components**

### What Are Micro-Frontends?

Micro-frontends apply the microservices concept to the frontend. Instead of one large React app, the Workflow Platform ships **small, self-contained UI components** that can be embedded inside any host application (another team's product UI).

### How It Works in Practice

```
Host App (Product Team's React/Angular/Vue App)
|
+-- <ProductHeader />
+-- <ProductContent />
|
+-- <WorkflowApprovalWidget />  <- Embedded from Workflow Platform MFE
    |   (Loaded as a Web Component or Module Federation)
    |
    +-- Internally calls Workflow Platform API
```

### Why This Architecture?
- Product teams don't need to rebuild approval UI — they just drop in the widget
- The Workflow team owns and updates the widget independently
- Host apps don't need to know the internals of the workflow system

### Challenges This Creates for QA
- The widget must behave correctly across many different host app environments
- Host app and embedded component may have conflicting CSS, JavaScript versions, or routing
- Testing requires validating the **integration boundary**, not just the component in isolation

---

## 6. Messaging & Event Architecture — Kafka

### Technology
- **Message Broker**: Apache Kafka
- **Pattern**: Event-driven / asynchronous messaging

### Why Kafka?
Kafka provides a durable, high-throughput, ordered event log. It is ideal for a workflow platform because:
- Multiple downstream consumers can react to the same workflow event (e.g., send notification, update a dashboard, trigger a downstream process)
- Events are retained, so consumers can replay or catch up after downtime
- It decouples the Workflow Platform from product teams — teams subscribe to events rather than polling the API

### Key Event Flow

```
User submits expense claim
        |
        v
Workflow Platform creates workflow record (DB)
        |
        v
Publishes event: workflow.created -> Kafka Topic
        |
        +---> Notification Service (sends email to approver)
        +---> Analytics Service (updates dashboards)
        +---> Audit Service (records immutable log entry)

Approver clicks Approve
        |
        v
Workflow Platform updates state
        |
        v
Publishes event: workflow.approved -> Kafka Topic
        |
        +---> Product Team's Service (unlocks next step in their flow)
```

### Critical QA Concerns with Kafka

| Concern | Description |
|---|---|
| **Ordering** | Are events processed in the correct sequence? |
| **Idempotency** | If an event is delivered twice, does the consumer handle duplicates safely? |
| **Schema Compatibility** | When the event schema changes, do existing consumers break? |
| **Retry Behaviour** | What happens when a consumer fails — does it retry correctly or enter an infinite loop? |

---

## 7. Infrastructure — AWS + Kubernetes + Terraform

### Technologies
- **Cloud Provider**: AWS
- **Container Orchestration**: Kubernetes (K8s)
- **Infrastructure as Code**: Terraform

### Infrastructure Breakdown

```
AWS Account
|
+-- VPC (Virtual Private Cloud)
|   +-- Public Subnets (Load Balancers)
|   +-- Private Subnets (Kubernetes Nodes)
|
+-- EKS (Elastic Kubernetes Service)
|   +-- Namespace: tenant-a
|   |   +-- Workflow Platform Pods (Tenant A)
|   +-- Namespace: tenant-b
|   |   +-- Workflow Platform Pods (Tenant B)
|   +-- Namespace: platform-core
|       +-- Kafka, Monitoring, Ingress
|
+-- RDS / Aurora (Database per Tenant or Shared with Row-Level Security)
+-- MSK (Amazon Managed Streaming for Kafka)
+-- S3 (Document Storage)
```

### Terraform
Terraform defines all infrastructure as code — the entire cloud setup can be recreated from scratch by running `terraform apply`. This enables:
- Consistent environments (dev = staging = production structurally)
- Disaster recovery
- Auditability of infrastructure changes through version control

### Why Kubernetes?
Kubernetes manages the containerised backend services. It handles:
- **Auto-scaling** — more traffic means more pods are spun up automatically
- **Self-healing** — crashed pods are automatically restarted
- **Rolling deployments** — new versions are deployed with zero downtime
- **Tenant isolation** — Namespaces and Network Policies separate tenant workloads

---

## 8. CI/CD Pipeline — CircleCI, GitHub Actions, ArgoCD

### Technologies
- **Build & Test Pipelines**: CircleCI, GitHub Actions
- **GitOps Deployment**: ArgoCD

### How the Pipeline Works

```
Developer pushes code to GitHub
        |
        v
GitHub Actions triggers (unit tests, linting, build)
        |
        v
CircleCI runs integration tests, contract tests, performance tests
        |
        v
Docker image is built and pushed to container registry
        |
        v
ArgoCD detects new image tag in Git config repo
        |
        v
ArgoCD applies change to Kubernetes cluster
        |
        v
New version running in production (rolling deployment)
```

### ArgoCD (GitOps)
ArgoCD follows the **GitOps model**: the desired state of the cluster is stored in a Git repository. ArgoCD continuously syncs the live cluster to match what's in Git. This means:
- Every deployment is traceable to a Git commit
- Rolling back is just reverting a Git commit
- No manual `kubectl` commands are needed in production

---

## 9. Multi-Tenancy Design

### What is Multi-Tenancy?
The Workflow Platform serves **multiple product teams** (tenants) from a single deployed system. Tenants must be **completely isolated** from each other — Tenant A's workflow data must never be accessible to Tenant B.

### Isolation Strategies

| Layer | Isolation Mechanism |
|---|---|
| **API** | `X-Tenant-ID` header validated on every request; requests rejected if tenant context is missing |
| **Database** | Separate schemas per tenant, or row-level security (RLS) with a `tenant_id` column on every table |
| **Kubernetes** | Separate namespaces per tenant with network policies restricting cross-namespace traffic |
| **Kafka** | Separate Kafka topics per tenant, or single topics with tenant-keyed messages |

### Why Multi-Tenancy is a QA Challenge
- A bug in tenant isolation is a **security vulnerability**, not just a functional defect
- Tests must explicitly verify that **cross-tenant data leakage cannot happen**
- Performance of one tenant must not degrade another (the "noisy neighbour" problem)

---

## 10. Quality Engineering Landscape

This section maps the QA concerns the platform creates — the core context for the Senior Quality Engineer role described in the JD.

### Test Pyramid for This Platform

```
+------------------------------------------------------------+
|  System-Level / End-to-End Tests (Playwright)               |
|  Full approval workflow: submit -> approve -> complete       |
+------------------------------------------------------------+
+------------------------------------------------------------+
|  Service Integration Tests                                  |
|  API + Kafka round-trips, multi-service flows               |
+------------------------------------------------------------+
+------------------------------------------------------------+
|  Contract Tests (Consumer-Driven Contract Testing)          |
|  Verify API + Kafka event schemas between producer/consumer  |
+------------------------------------------------------------+
+------------------------------------------------------------+
|  Unit Tests (Kotlin / React)                                |
|  Business logic: routing rules, state machine, calculations  |
+------------------------------------------------------------+
```

### Critical Quality Risk Areas

| Risk Area | Description |
|---|---|
| **Tenant Isolation Breach** | One tenant's data leaking to another |
| **Event Ordering Failure** | Workflow steps processed out of order |
| **Schema Breaking Change** | Updated Kafka message breaks a consumer |
| **Partial Failure in Multi-Service Flow** | Service A succeeds but Service B fails mid-workflow — is state consistent? |
| **Performance Degradation at Scale** | Platform slows under concurrent tenant load |
| **Micro-Frontend Compatibility** | Workflow widget breaks in a host app due to JS version or CSS conflicts |
| **Retry Storms** | Failed consumer retries cause cascading overload |

---

## 11. AI Transformation (AX) Direction

Money Forward is undergoing an **AI Transformation** strategy they call **"from Cloud to AI"** (AX). The goal is to build **"Digital Workers"** — AI agents that can autonomously execute tasks that currently require human involvement.

In the context of the Workflow Platform, this could mean:
- AI agents that auto-approve low-risk workflows based on historical patterns
- AI-assisted routing (suggesting the right approver based on context)
- Automated document validation before human review

This is a longer-term strategic direction, but engineers on this platform should understand that the architecture may need to accommodate AI agent actors as participants in workflows — not just human approvers.

---

## 12. Tech Stack Summary

| Category | Technology |
|---|---|
| **Backend Language** | Kotlin |
| **Backend Framework** | Spring Framework (Spring Boot) |
| **Frontend Framework** | React |
| **Frontend Pattern** | Micro-frontends / Web Components |
| **Messaging** | Apache Kafka |
| **API Style** | REST |
| **Cloud Provider** | AWS |
| **Container Orchestration** | Kubernetes (EKS) |
| **Infrastructure as Code** | Terraform |
| **CI Build & Test** | CircleCI, GitHub Actions |
| **CD / Deployment** | ArgoCD (GitOps) |
| **Browser Test Automation** | Playwright |
| **Deployment Model** | Multi-tenant, cloud-native |

---

## 13. Glossary

| Term | Plain English Explanation |
|---|---|
| **Micro-frontend (MFE)** | A small, independently deployed UI component embedded into a larger host application |
| **Kafka** | A message bus / event streaming platform — services publish events to it and other services subscribe to receive them |
| **Multi-tenancy** | A single deployed system that serves multiple independent customers (tenants) with complete data isolation between them |
| **Kubernetes (K8s)** | A system for automatically managing, scaling, and restarting containerised applications |
| **GitOps** | A deployment model where the desired state of infrastructure is stored in Git; changes to Git automatically trigger deployments |
| **ArgoCD** | A GitOps tool that continuously syncs a Kubernetes cluster to match the state defined in a Git repository |
| **Terraform** | A tool for defining cloud infrastructure as code — you describe what you want, Terraform creates it |
| **Contract Testing** | Tests that verify two services agree on the format/schema of the messages they exchange |
| **Idempotency** | A property where doing an operation multiple times produces the same result as doing it once — critical for safe message retries |
| **Tenant Isolation** | Technical guarantees that one tenant's data, actions, and performance cannot affect another tenant |
| **AX (AI Transformation)** | Money Forward's strategic initiative to build AI agents (Digital Workers) that can autonomously handle tasks |
| **Rolling Deployment** | A deployment strategy where new app versions replace old ones gradually, pod by pod, to avoid downtime |
| **EKS** | Amazon Elastic Kubernetes Service — AWS's managed Kubernetes offering |
| **MSK** | Amazon Managed Streaming for Kafka — AWS's managed Kafka service |

---

*Document prepared from the job description: [Senior Quality Engineer, Workflow Platform, Nagoya at Money Forward](https://japan-dev.com/jobs/money-forward/money-forward-staff-quality-engineer-workflow-platform-nagoya-w8wrbo)*

*Last updated: September 2026*
