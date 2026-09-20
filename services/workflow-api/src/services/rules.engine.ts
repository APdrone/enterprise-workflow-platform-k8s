import { v4 as uuidv4 } from 'uuid';
import { eq, and, desc } from 'drizzle-orm';
import {
  CreateWorkflowDTO,
  CreateWorkflowRuleDTO,
  WorkflowRule,
  RuleStepDefinition,
  ApprovalPolicy,
} from '@workflow/shared-types';
import { db } from '../db/client.js';
import { workflowRules } from '../db/schema.js';

export interface GeneratedStep {
  id: string;
  workflowId: string;
  tenantId: string;
  stepOrder: number;
  stepRole: string;
  approverId?: string | null;
  status: string;
  policy: ApprovalPolicy;
  parallelGroup?: string | null;
}

export class RulesEngineService {
  /**
   * Evaluates active tenant rules and generates workflow steps (sequential or parallel)
   */
  async evaluateSteps(
    tenantId: string,
    workflowId: string,
    dto: CreateWorkflowDTO
  ): Promise<GeneratedStep[]> {
    // 1. If explicit custom steps are provided in the payload, use them directly
    if (dto.customSteps && dto.customSteps.length > 0) {
      return dto.customSteps.map((s, idx) => ({
        id: uuidv4(),
        workflowId,
        tenantId,
        stepOrder: s.stepOrder || idx + 1,
        stepRole: s.stepRole || 'GENERAL_APPROVER',
        approverId: s.approverId || null,
        status: 'PENDING',
        policy: s.policy || 'ALL_MUST_APPROVE',
        parallelGroup: s.parallelGroup || null,
      }));
    }

    const workflowType = dto.type || 'EXPENSE';
    const amount = Number(dto.amount || 0);
    const department = dto.department || (dto.metadata?.department as string | undefined);

    // 2. Query configured rules for this tenant and workflow type
    try {
      const activeRules = await db
        .select()
        .from(workflowRules)
        .where(
          and(
            eq(workflowRules.tenantId, tenantId),
            eq(workflowRules.workflowType, workflowType),
            eq(workflowRules.active, true)
          )
        )
        .orderBy(desc(workflowRules.priority));

      // Find the highest-priority rule that matches the criteria
      for (const rule of activeRules) {
        const min = rule.minAmount !== null && rule.minAmount !== undefined ? Number(rule.minAmount) : null;
        const max = rule.maxAmount !== null && rule.maxAmount !== undefined ? Number(rule.maxAmount) : null;

        if (min !== null && amount < min) continue;
        if (max !== null && amount > max) continue;
        if (rule.department && rule.department.trim() !== '') {
          if (!department || department.toLowerCase() !== rule.department.toLowerCase()) continue;
        }

        // Rule matches! Expand rule steps
        const rawSteps = rule.steps as RuleStepDefinition[];
        if (Array.isArray(rawSteps) && rawSteps.length > 0) {
          return rawSteps.map((s, idx) => ({
            id: uuidv4(),
            workflowId,
            tenantId,
            stepOrder: s.stepOrder || idx + 1,
            stepRole: s.stepRole || 'GENERAL_APPROVER',
            approverId: s.approverId || null,
            status: 'PENDING',
            policy: s.policy || 'ALL_MUST_APPROVE',
            parallelGroup: s.parallelGroup || null,
          }));
        }
      }
    } catch (err: any) {
      console.warn('[workflow-api] Error reading dynamic rules from database, falling back to default matrix:', err.message);
    }

    // 3. Fallback to default matrix with tiered & parallel logic
    return this.generateDefaultMatrixSteps(workflowId, tenantId, dto);
  }

  /**
   * Default approval matrix (Tier 1: <10k, Tier 2: 10k-100k, Tier 3: >100k with parallel director review)
   */
  private generateDefaultMatrixSteps(
    workflowId: string,
    tenantId: string,
    dto: CreateWorkflowDTO
  ): GeneratedStep[] {
    const amount = Number(dto.amount || 0);

    // Tier 1: Small (< 10,000) -> Single Team Lead
    if (amount < 10000) {
      return [
        {
          id: uuidv4(),
          workflowId,
          tenantId,
          stepOrder: 1,
          stepRole: 'TEAM_LEAD',
          approverId: dto.approverId || null,
          status: 'PENDING',
          policy: 'ALL_MUST_APPROVE',
          parallelGroup: null,
        },
      ];
    }

    // Tier 2: Mid-level (10,000 - 100,000) -> Step 1: Team Lead, Step 2: Dept Manager
    if (amount <= 100000) {
      return [
        {
          id: uuidv4(),
          workflowId,
          tenantId,
          stepOrder: 1,
          stepRole: 'TEAM_LEAD',
          approverId: dto.approverId || null,
          status: 'PENDING',
          policy: 'ALL_MUST_APPROVE',
          parallelGroup: null,
        },
        {
          id: uuidv4(),
          workflowId,
          tenantId,
          stepOrder: 2,
          stepRole: 'DEPT_MANAGER',
          approverId: null,
          status: 'PENDING',
          policy: 'ALL_MUST_APPROVE',
          parallelGroup: null,
        },
      ];
    }

    // Tier 3: High-value (> 100,000) -> Step 1: Team Lead, Step 2: Parallel Review (Dept Manager + Finance Director)
    return [
      {
        id: uuidv4(),
        workflowId,
        tenantId,
        stepOrder: 1,
        stepRole: 'TEAM_LEAD',
        approverId: dto.approverId || null,
        status: 'PENDING',
        policy: 'ALL_MUST_APPROVE',
        parallelGroup: null,
      },
      {
        id: uuidv4(),
        workflowId,
        tenantId,
        stepOrder: 2,
        stepRole: 'DEPT_MANAGER',
        approverId: null,
        status: 'PENDING',
        policy: 'ALL_MUST_APPROVE',
        parallelGroup: 'dept-finance-parallel',
      },
      {
        id: uuidv4(),
        workflowId,
        tenantId,
        stepOrder: 2,
        stepRole: 'FINANCE_DIRECTOR',
        approverId: null,
        status: 'PENDING',
        policy: 'ALL_MUST_APPROVE',
        parallelGroup: 'dept-finance-parallel',
      },
    ];
  }

  // --- Rule Management CRUD APIs ---

  async listRules(tenantId: string, workflowType?: string): Promise<WorkflowRule[]> {
    const conditions: any[] = [eq(workflowRules.tenantId, tenantId)];
    if (workflowType) {
      conditions.push(eq(workflowRules.workflowType, workflowType));
    }

    const records = await db
      .select()
      .from(workflowRules)
      .where(and(...conditions))
      .orderBy(desc(workflowRules.priority), desc(workflowRules.createdAt));

    return records.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      workflowType: r.workflowType as any,
      name: r.name,
      description: r.description || undefined,
      minAmount: r.minAmount !== null ? Number(r.minAmount) : undefined,
      maxAmount: r.maxAmount !== null ? Number(r.maxAmount) : undefined,
      department: r.department || undefined,
      priority: r.priority,
      steps: (r.steps as RuleStepDefinition[]) || [],
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async createRule(tenantId: string, dto: CreateWorkflowRuleDTO): Promise<WorkflowRule> {
    const id = uuidv4();
    const now = new Date();

    await db.insert(workflowRules).values({
      id,
      tenantId,
      workflowType: dto.workflowType || 'EXPENSE',
      name: dto.name,
      description: dto.description || null,
      minAmount: dto.minAmount !== undefined ? dto.minAmount.toString() : null,
      maxAmount: dto.maxAmount !== undefined ? dto.maxAmount.toString() : null,
      department: dto.department || null,
      priority: dto.priority || 0,
      steps: dto.steps as any,
      active: dto.active !== undefined ? dto.active : true,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      tenantId,
      workflowType: dto.workflowType || 'EXPENSE',
      name: dto.name,
      description: dto.description,
      minAmount: dto.minAmount,
      maxAmount: dto.maxAmount,
      department: dto.department,
      priority: dto.priority || 0,
      steps: dto.steps,
      active: dto.active !== undefined ? dto.active : true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async getRuleById(tenantId: string, ruleId: string): Promise<WorkflowRule | null> {
    const records = await db
      .select()
      .from(workflowRules)
      .where(and(eq(workflowRules.id, ruleId), eq(workflowRules.tenantId, tenantId)))
      .limit(1);

    if (records.length === 0) return null;
    const r = records[0];

    return {
      id: r.id,
      tenantId: r.tenantId,
      workflowType: r.workflowType as any,
      name: r.name,
      description: r.description || undefined,
      minAmount: r.minAmount !== null ? Number(r.minAmount) : undefined,
      maxAmount: r.maxAmount !== null ? Number(r.maxAmount) : undefined,
      department: r.department || undefined,
      priority: r.priority,
      steps: (r.steps as RuleStepDefinition[]) || [],
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async deleteRule(tenantId: string, ruleId: string): Promise<boolean> {
    const res = await db
      .delete(workflowRules)
      .where(and(eq(workflowRules.id, ruleId), eq(workflowRules.tenantId, tenantId)));

    return true;
  }
}

export const rulesEngineService = new RulesEngineService();
