import { v4 as uuidv4 } from 'uuid';
import { eq, and, desc, count, asc } from 'drizzle-orm';
import {
  Workflow,
  WorkflowStatus,
  WorkflowStep,
  CreateWorkflowDTO,
  SubmitWorkflowDTO,
  ApproveWorkflowDTO,
  RejectWorkflowDTO,
  CancelWorkflowDTO,
  ListWorkflowsQuery,
  PaginatedWorkflowsResponse,
  WorkflowKafkaEvent,
} from '@workflow/shared-types';
import { db } from '../db/client.js';
import { workflows, workflowSteps, outboxEvents } from '../db/schema.js';
import { outboxRelayService } from './outbox.relay.js';
import { delegationService } from './delegation.service.js';
import { rulesEngineService } from './rules.engine.js';

export class WorkflowService {
  async createWorkflow(
    tenantId: string,
    requesterId: string,
    requesterName: string,
    dto: CreateWorkflowDTO
  ): Promise<Workflow> {
    const id = uuidv4();
    const now = new Date();

    // 1. Evaluate steps using the Rules Engine (Dynamic Matrix & Parallel Rules)
    const stepsToCreate = await rulesEngineService.evaluateSteps(tenantId, id, dto);

    // Calculate total distinct step levels
    const maxStepOrder = stepsToCreate.reduce((max, s) => Math.max(max, s.stepOrder), 1);

    const newRecord = {
      id,
      tenantId,
      type: dto.type || 'EXPENSE',
      title: dto.title,
      description: dto.description || null,
      amount: dto.amount !== undefined ? dto.amount.toString() : null,
      currency: dto.currency || 'USD',
      requesterId,
      requesterName,
      status: 'DRAFT',
      approverId: dto.approverId || null,
      currentStepOrder: 1,
      totalSteps: maxStepOrder,
      rejectionReason: null,
      metadata: dto.metadata || (dto.department ? { department: dto.department } : {}),
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(workflows).values(newRecord as any);

    if (stepsToCreate.length > 0) {
      try {
        await db.insert(workflowSteps).values(
          stepsToCreate.map((s) => ({
            id: s.id,
            workflowId: s.workflowId,
            tenantId: s.tenantId,
            stepOrder: s.stepOrder,
            stepRole: s.stepRole,
            approverId: s.approverId || null,
            status: s.status as any,
            policy: s.policy || 'ALL_MUST_APPROVE',
            parallelGroup: s.parallelGroup || null,
            createdAt: now,
          })) as any
        );
      } catch (err) {
        console.error('[workflow-api] Error inserting workflow steps:', err);
      }
    }

    const createdWorkflow = await this.getWorkflowById(tenantId, id);
    return createdWorkflow!;
  }

  async listWorkflows(
    tenantId: string,
    query: ListWorkflowsQuery
  ): Promise<PaginatedWorkflowsResponse> {
    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const conditions = [eq(workflows.tenantId, tenantId)];

    if (query.status) {
      conditions.push(eq(workflows.status, query.status));
    }
    if (query.requesterId) {
      conditions.push(eq(workflows.requesterId, query.requesterId));
    }

    const whereClause = and(...conditions);

    const records = await db
      .select()
      .from(workflows)
      .where(whereClause)
      .orderBy(desc(workflows.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRes = await db
      .select({ count: count() })
      .from(workflows)
      .where(whereClause);

    const total = Number(totalRes[0]?.count || 0);

    const workflowList = await Promise.all(
      records.map(async (r) => {
        const steps = await this.getStepsForWorkflow(r.tenantId, r.id);
        return this.mapRecordToWorkflow(r, steps);
      })
    );

    return {
      workflows: workflowList,
      total,
      limit,
      offset,
    };
  }

  async getWorkflowById(tenantId: string, workflowId: string): Promise<Workflow | null> {
    const records = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)))
      .limit(1);

    if (records.length === 0) {
      return null;
    }

    const steps = await this.getStepsForWorkflow(tenantId, workflowId);
    return this.mapRecordToWorkflow(records[0], steps);
  }

  private async getStepsForWorkflow(tenantId: string, workflowId: string): Promise<WorkflowStep[]> {
    const stepRecords = await db
      .select()
      .from(workflowSteps)
      .where(and(eq(workflowSteps.workflowId, workflowId), eq(workflowSteps.tenantId, tenantId)))
      .orderBy(asc(workflowSteps.stepOrder), asc(workflowSteps.createdAt));

    return stepRecords.map((s) => ({
      id: s.id,
      workflowId: s.workflowId,
      tenantId: s.tenantId,
      stepOrder: s.stepOrder,
      stepRole: s.stepRole,
      approverId: s.approverId || undefined,
      status: s.status as any,
      policy: (s.policy as any) || 'ALL_MUST_APPROVE',
      parallelGroup: s.parallelGroup || undefined,
      actedBy: s.actedBy || undefined,
      actedAt: s.actedAt ? s.actedAt.toISOString() : undefined,
      comment: s.comment || undefined,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async submitWorkflow(
    tenantId: string,
    actorId: string,
    actorName: string,
    workflowId: string,
    dto: SubmitWorkflowDTO,
    traceparent?: string
  ): Promise<Workflow> {
    const existing = await this.getWorkflowById(tenantId, workflowId);
    if (!existing) {
      const error: any = new Error(`Workflow with ID ${workflowId} not found in tenant`);
      error.statusCode = 404;
      error.code = 'WORKFLOW_NOT_FOUND';
      throw error;
    }

    if (existing.status !== 'DRAFT') {
      const error: any = new Error(
        `Cannot submit workflow in '${existing.status}' status. Only DRAFT workflows can be submitted.`
      );
      error.statusCode = 422;
      error.code = 'INVALID_STATE_TRANSITION';
      throw error;
    }

    const now = new Date();

    // Outbox Event
    const eventId = uuidv4();
    const event: WorkflowKafkaEvent = {
      id: eventId,
      source: 'workflow-api',
      specversion: '1.0',
      type: 'workflow.submitted.v1',
      time: now.toISOString(),
      datacontenttype: 'application/json',
      data: {
        workflowId: existing.id,
        tenantId: existing.tenantId,
        type: existing.type,
        title: existing.title,
        amount: existing.amount,
        currency: existing.currency,
        requesterId: existing.requesterId,
        requesterName: existing.requesterName,
        actorId,
        previousStatus: 'DRAFT',
        currentStatus: 'PENDING',
        currentStepOrder: existing.currentStepOrder || 1,
        totalSteps: existing.totalSteps || 1,
        comment: dto.comment,
        timestamp: now.toISOString(),
        metadata: existing.metadata,
      },
    };

    // Atomic DB write (Workflow state + Outbox record)
    await db
      .update(workflows)
      .set({
        status: 'PENDING',
        updatedAt: now,
      })
      .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)));

    await outboxRelayService.saveToOutbox(tenantId, workflowId, event, db, traceparent);

    // Relay immediately asynchronously
    outboxRelayService.relayEventImmediately(eventId).catch((e) =>
      console.warn('[workflow-api] Relay immediate dispatch deferred to background:', e.message)
    );

    return (await this.getWorkflowById(tenantId, workflowId))!;
  }

  async approveWorkflow(
    tenantId: string,
    actorId: string,
    actorName: string,
    workflowId: string,
    dto: ApproveWorkflowDTO,
    traceparent?: string
  ): Promise<Workflow> {
    const existing = await this.getWorkflowById(tenantId, workflowId);
    if (!existing) {
      const error: any = new Error(`Workflow with ID ${workflowId} not found in tenant`);
      error.statusCode = 404;
      error.code = 'WORKFLOW_NOT_FOUND';
      throw error;
    }

    if (existing.status !== 'PENDING') {
      const error: any = new Error(
        `Cannot approve workflow in '${existing.status}' status. Only PENDING workflows can be approved.`
      );
      error.statusCode = 422;
      error.code = 'INVALID_STATE_TRANSITION';
      throw error;
    }

    const currentStepOrder = existing.currentStepOrder || 1;
    const totalSteps = existing.totalSteps || 1;
    const allSteps = existing.steps || [];

    // Find all steps at currentStepOrder
    const currentOrderSteps = allSteps.filter((s) => s.stepOrder === currentStepOrder);
    if (currentOrderSteps.length === 0) {
      const error: any = new Error(`No active steps found at order ${currentStepOrder}`);
      error.statusCode = 422;
      error.code = 'INVALID_STATE';
      throw error;
    }

    // Identify the specific step being approved
    let targetStep: WorkflowStep | undefined;
    if (dto.stepId) {
      targetStep = currentOrderSteps.find((s) => s.id === dto.stepId);
    } else {
      // Find matching step by approverId or first pending step at this order
      targetStep = currentOrderSteps.find((s) => s.status === 'PENDING' && (s.approverId === actorId || !s.approverId));
      if (!targetStep) {
        targetStep = currentOrderSteps.find((s) => s.status === 'PENDING');
      }
    }

    if (!targetStep || targetStep.status !== 'PENDING') {
      const error: any = new Error('No pending step available for approval by this actor.');
      error.statusCode = 422;
      error.code = 'NO_PENDING_STEP';
      throw error;
    }

    // Check delegation / authorization
    const authCheck = await delegationService.isAuthorizedApprover(
      tenantId,
      actorId,
      targetStep.approverId || existing.approverId
    );

    const now = new Date();

    // 1. Mark this target step as APPROVED
    await db
      .update(workflowSteps)
      .set({
        status: 'APPROVED',
        actedBy: actorId,
        actedAt: now,
        delegatedFrom: authCheck.isDelegated ? authCheck.delegatedFrom : null,
        comment: dto.comment || null,
      })
      .where(and(eq(workflowSteps.id, targetStep.id), eq(workflowSteps.tenantId, tenantId)));

    // 2. Evaluate Parallel Quorum for currentStepOrder
    const policy = targetStep.policy || 'ALL_MUST_APPROVE';
    let isCurrentOrderFullyResolved = false;

    if (policy === 'ANY_CAN_APPROVE') {
      // First-responder policy: One approval satisfies the whole step order!
      isCurrentOrderFullyResolved = true;

      // Auto-skip other pending sibling steps in the same stepOrder
      const otherSiblingSteps = currentOrderSteps.filter((s) => s.id !== targetStep!.id && s.status === 'PENDING');
      for (const sibling of otherSiblingSteps) {
        await db
          .update(workflowSteps)
          .set({
            status: 'SKIPPED',
            actedBy: 'SYSTEM',
            actedAt: now,
            comment: `Auto-skipped: Sibling step approved by ${actorId} (ANY_CAN_APPROVE policy)`,
          })
          .where(and(eq(workflowSteps.id, sibling.id), eq(workflowSteps.tenantId, tenantId)));
      }
    } else {
      // ALL_MUST_APPROVE policy: Check if ALL sibling steps are now APPROVED
      const remainingPendingSiblings = currentOrderSteps.filter(
        (s) => s.id !== targetStep!.id && s.status === 'PENDING'
      );
      isCurrentOrderFullyResolved = remainingPendingSiblings.length === 0;
    }

    // 3. Determine next workflow state
    let nextStatus: WorkflowStatus = existing.status;
    let nextStepOrder = currentStepOrder;
    let eventType: string;

    if (isCurrentOrderFullyResolved) {
      const isFinalStep = currentStepOrder >= totalSteps;
      if (isFinalStep) {
        nextStatus = 'APPROVED';
        eventType = 'workflow.approved.v1';
      } else {
        nextStatus = 'PENDING';
        nextStepOrder = currentStepOrder + 1;
        eventType = 'workflow.step_approved.v1';
      }
    } else {
      // Parallel step approved, but waiting for remaining parallel reviewers
      nextStatus = 'PENDING';
      nextStepOrder = currentStepOrder;
      eventType = 'workflow.step_approved.v1';
    }

    // 4. Update workflow record
    await db
      .update(workflows)
      .set({
        status: nextStatus,
        approverId: nextStatus === 'APPROVED' ? actorId : existing.approverId,
        currentStepOrder: nextStepOrder,
        updatedAt: now,
      })
      .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)));

    // 5. Create Outbox event
    const eventId = uuidv4();
    const event: WorkflowKafkaEvent = {
      id: eventId,
      source: 'workflow-api',
      specversion: '1.0',
      type: eventType as any,
      time: now.toISOString(),
      datacontenttype: 'application/json',
      data: {
        workflowId: existing.id,
        tenantId: existing.tenantId,
        type: existing.type,
        title: existing.title,
        amount: existing.amount,
        currency: existing.currency,
        requesterId: existing.requesterId,
        requesterName: existing.requesterName,
        actorId,
        previousStatus: 'PENDING',
        currentStatus: nextStatus as any,
        currentStepOrder,
        totalSteps,
        stepRole: targetStep.stepRole,
        isDelegated: authCheck.isDelegated,
        delegatedFrom: authCheck.delegatedFrom,
        comment: dto.comment,
        timestamp: now.toISOString(),
        metadata: {
          ...existing.metadata,
          policy,
          parallelGroup: targetStep.parallelGroup,
          stepId: targetStep.id,
          stepResolved: isCurrentOrderFullyResolved,
        },
      },
    };

    await outboxRelayService.saveToOutbox(tenantId, workflowId, event, db, traceparent);

    outboxRelayService.relayEventImmediately(eventId).catch((e) =>
      console.warn('[workflow-api] Relay immediate dispatch deferred:', e.message)
    );

    return (await this.getWorkflowById(tenantId, workflowId))!;
  }

  async rejectWorkflow(
    tenantId: string,
    actorId: string,
    actorName: string,
    workflowId: string,
    dto: RejectWorkflowDTO,
    traceparent?: string
  ): Promise<Workflow> {
    const existing = await this.getWorkflowById(tenantId, workflowId);
    if (!existing) {
      const error: any = new Error(`Workflow with ID ${workflowId} not found in tenant`);
      error.statusCode = 404;
      error.code = 'WORKFLOW_NOT_FOUND';
      throw error;
    }

    if (existing.status !== 'PENDING') {
      const error: any = new Error(
        `Cannot reject workflow in '${existing.status}' status. Only PENDING workflows can be rejected.`
      );
      error.statusCode = 422;
      error.code = 'INVALID_STATE_TRANSITION';
      throw error;
    }

    if (!dto.reason || dto.reason.trim() === '') {
      const error: any = new Error('Rejection reason is required.');
      error.statusCode = 400;
      error.code = 'REASON_REQUIRED';
      throw error;
    }

    const currentStepOrder = existing.currentStepOrder || 1;
    const currentSteps = existing.steps?.filter((s) => s.stepOrder === currentStepOrder) || [];
    
    // Target step
    let targetStep = dto.stepId
      ? currentSteps.find((s) => s.id === dto.stepId)
      : currentSteps.find((s) => s.status === 'PENDING');

    const authCheck = await delegationService.isAuthorizedApprover(
      tenantId,
      actorId,
      targetStep?.approverId || existing.approverId
    );

    const now = new Date();

    // 1. Mark target step as REJECTED
    if (targetStep) {
      await db
        .update(workflowSteps)
        .set({
          status: 'REJECTED',
          actedBy: actorId,
          actedAt: now,
          delegatedFrom: authCheck.isDelegated ? authCheck.delegatedFrom : null,
          comment: dto.reason,
        })
        .where(and(eq(workflowSteps.id, targetStep.id), eq(workflowSteps.tenantId, tenantId)));
    }

    // 2. Mark any other pending parallel steps as SKIPPED
    const otherPending = currentSteps.filter((s) => s.id !== targetStep?.id && s.status === 'PENDING');
    for (const step of otherPending) {
      await db
        .update(workflowSteps)
        .set({
          status: 'SKIPPED',
          actedBy: 'SYSTEM',
          actedAt: now,
          comment: `Auto-skipped: Parallel step rejected by ${actorId}`,
        })
        .where(and(eq(workflowSteps.id, step.id), eq(workflowSteps.tenantId, tenantId)));
    }

    // 3. Update workflow to REJECTED
    await db
      .update(workflows)
      .set({
        status: 'REJECTED',
        approverId: actorId,
        rejectionReason: dto.reason,
        updatedAt: now,
      })
      .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)));

    // 4. Outbox event
    const eventId = uuidv4();
    const event: WorkflowKafkaEvent = {
      id: eventId,
      source: 'workflow-api',
      specversion: '1.0',
      type: 'workflow.rejected.v1',
      time: now.toISOString(),
      datacontenttype: 'application/json',
      data: {
        workflowId: existing.id,
        tenantId: existing.tenantId,
        type: existing.type,
        title: existing.title,
        amount: existing.amount,
        currency: existing.currency,
        requesterId: existing.requesterId,
        requesterName: existing.requesterName,
        actorId,
        previousStatus: 'PENDING',
        currentStatus: 'REJECTED',
        currentStepOrder,
        totalSteps: existing.totalSteps || 1,
        rejectionReason: dto.reason,
        timestamp: now.toISOString(),
        metadata: existing.metadata,
      },
    };

    await outboxRelayService.saveToOutbox(tenantId, workflowId, event, db, traceparent);

    outboxRelayService.relayEventImmediately(eventId).catch((e) =>
      console.warn('[workflow-api] Relay immediate dispatch deferred:', e.message)
    );

    return (await this.getWorkflowById(tenantId, workflowId))!;
  }

  async cancelWorkflow(
    tenantId: string,
    actorId: string,
    actorName: string,
    workflowId: string,
    dto: CancelWorkflowDTO,
    traceparent?: string
  ): Promise<Workflow> {
    const existing = await this.getWorkflowById(tenantId, workflowId);
    if (!existing) {
      const error: any = new Error(`Workflow with ID ${workflowId} not found in tenant`);
      error.statusCode = 404;
      error.code = 'WORKFLOW_NOT_FOUND';
      throw error;
    }

    if (existing.status !== 'DRAFT' && existing.status !== 'PENDING') {
      const error: any = new Error(
        `Cannot cancel workflow in '${existing.status}' status. Only DRAFT or PENDING workflows can be cancelled.`
      );
      error.statusCode = 422;
      error.code = 'INVALID_STATE_TRANSITION';
      throw error;
    }

    const now = new Date();
    await db
      .update(workflows)
      .set({
        status: 'CANCELLED',
        updatedAt: now,
      })
      .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)));

    const eventId = uuidv4();
    const event: WorkflowKafkaEvent = {
      id: eventId,
      source: 'workflow-api',
      specversion: '1.0',
      type: 'workflow.cancelled.v1',
      time: now.toISOString(),
      datacontenttype: 'application/json',
      data: {
        workflowId: existing.id,
        tenantId: existing.tenantId,
        type: existing.type,
        title: existing.title,
        amount: existing.amount,
        currency: existing.currency,
        requesterId: existing.requesterId,
        requesterName: existing.requesterName,
        actorId,
        previousStatus: existing.status,
        currentStatus: 'CANCELLED',
        comment: dto.reason,
        timestamp: now.toISOString(),
        metadata: existing.metadata,
      },
    };

    await outboxRelayService.saveToOutbox(tenantId, workflowId, event, db, traceparent);

    outboxRelayService.relayEventImmediately(eventId).catch((e) =>
      console.warn('[workflow-api] Relay immediate dispatch deferred:', e.message)
    );

    return (await this.getWorkflowById(tenantId, workflowId))!;
  }

  async deleteWorkflowsByTenant(tenantId: string): Promise<number> {
    await db.delete(workflowSteps).where(eq(workflowSteps.tenantId, tenantId));
    await db.delete(outboxEvents).where(eq(outboxEvents.tenantId, tenantId));
    const result = await db.delete(workflows).where(eq(workflows.tenantId, tenantId));
    return result.rowCount || 0;
  }

  private mapRecordToWorkflow(record: any, steps?: WorkflowStep[]): Workflow {
    return {
      id: record.id,
      tenantId: record.tenantId || record.tenant_id,
      type: record.type,
      title: record.title,
      description: record.description || undefined,
      amount: record.amount ? Number(record.amount) : undefined,
      currency: record.currency || 'USD',
      requesterId: record.requesterId || record.requester_id,
      requesterName: record.requesterName || record.requester_name,
      status: record.status,
      approverId: record.approverId || record.approver_id || undefined,
      currentStepOrder: record.currentStepOrder || record.current_step_order || 1,
      totalSteps: record.totalSteps || record.total_steps || 1,
      steps: steps || [],
      rejectionReason: record.rejectionReason || record.rejection_reason || undefined,
      metadata: record.metadata || {},
      createdAt:
        record.createdAt instanceof Date
          ? record.createdAt.toISOString()
          : record.created_at instanceof Date
          ? record.created_at.toISOString()
          : record.createdAt || record.created_at,
      updatedAt:
        record.updatedAt instanceof Date
          ? record.updatedAt.toISOString()
          : record.updated_at instanceof Date
          ? record.updated_at.toISOString()
          : record.updatedAt || record.updated_at,
    };
  }
}

export const workflowService = new WorkflowService();
