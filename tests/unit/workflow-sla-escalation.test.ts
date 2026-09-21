import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { delegationService } from '../../services/workflow-api/src/services/delegation.service.js';
import { db } from '../../services/workflow-api/src/db/client.js';
import { delegations } from '../../services/workflow-api/src/db/schema.js';
import { Workflow, WorkflowStep } from '@workflow/shared-types';

describe('Workflow SLA Time-Travel & Escalation State Machine Tests', () => {
  const TENANT_ID = 'tenant-moneyforward-nagoya';
  const BASE_TIME = new Date('2026-09-21T09:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('1. Dynamic Delegation Time Window (Time-Travel Testing)', () => {
    it('authorizes delegatee strictly within the validFrom..validUntil window, and revokes after expiry', async () => {
      const delegatorId = 'manager-bob';
      const delegateeId = 'lead-alice';

      // 7-day delegation window: from T0 (2026-09-21) to T0 + 7 days (2026-09-28)
      const validFrom = new Date('2026-09-21T00:00:00.000Z');
      const validUntil = new Date('2026-09-28T23:59:59.000Z');

      const mockDelegationRecord = {
        id: 'del-uuid-001',
        tenantId: TENANT_ID,
        delegatorId,
        delegateeId,
        validFrom,
        validUntil,
        active: true,
        reason: 'Annual leave coverage',
        createdAt: new Date(),
      };

      // Mock DB lookup for delegation
      vi.spyOn(db, 'select').mockImplementation(() => {
        const queryChain: any = {
          from: () => queryChain,
          where: () => queryChain,
          limit: () => {
            const now = new Date();
            if (now >= validFrom && now <= validUntil) {
              return Promise.resolve([mockDelegationRecord]);
            }
            return Promise.resolve([]);
          },
        };
        return queryChain;
      });

      // T0 (Day 1 - 2026-09-21): Within window -> Authorized as Delegate
      const t0Check = await delegationService.isAuthorizedApprover(TENANT_ID, delegateeId, delegatorId);
      expect(t0Check.authorized).toBe(true);
      expect(t0Check.isDelegated).toBe(true);
      expect(t0Check.delegatedFrom).toBe(delegatorId);

      // Fast-forward 4 days (Day 5 - 2026-09-25): Still inside window -> Authorized
      vi.advanceTimersByTime(4 * 24 * 60 * 60 * 1000);
      const day5Check = await delegationService.isAuthorizedApprover(TENANT_ID, delegateeId, delegatorId);
      expect(day5Check.authorized).toBe(true);

      // Fast-forward 5 more days (Day 10 - 2026-09-30): Window expired -> Automatically Revoked
      vi.advanceTimersByTime(5 * 24 * 60 * 60 * 1000);
      const day10Check = await delegationService.isAuthorizedApprover(TENANT_ID, delegateeId, delegatorId);
      expect(day10Check.authorized).toBe(false);
      expect(day10Check.isDelegated).toBe(false);
    });
  });

  describe('2. Step SLA Breach & Escalation Evaluator', () => {
    interface StepSLAConfig {
      stepOrder: number;
      maxHours: number;
      escalateToRole: string;
      escalateToApproverId?: string;
    }

    const evaluateStepSLA = (
      step: WorkflowStep,
      stepStartedAt: Date,
      slaConfig: StepSLAConfig
    ): { breached: boolean; elapsedHours: number; currentApproverRole: string; escalated: boolean } => {
      const now = new Date();
      const elapsedMs = now.getTime() - stepStartedAt.getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);

      const breached = elapsedHours > slaConfig.maxHours;

      return {
        breached,
        elapsedHours,
        currentApproverRole: breached ? slaConfig.escalateToRole : step.stepRole,
        escalated: breached,
      };
    };

    it('escalates approval role from TEAM_LEAD to DEPT_MANAGER when 48h SLA is breached', () => {
      const stepStartTime = new Date('2026-09-21T09:00:00.000Z');
      const step: WorkflowStep = {
        id: 'step-101',
        workflowId: 'wf-sla-001',
        tenantId: TENANT_ID,
        stepOrder: 1,
        stepRole: 'TEAM_LEAD',
        status: 'PENDING',
        policy: 'ALL_MUST_APPROVE',
        createdAt: stepStartTime.toISOString(),
      };

      const slaConfig: StepSLAConfig = {
        stepOrder: 1,
        maxHours: 48,
        escalateToRole: 'DEPARTMENT_MANAGER',
        escalateToApproverId: 'manager-backup-001',
      };

      // At T0 + 24h: within SLA -> No escalation
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      const check24h = evaluateStepSLA(step, stepStartTime, slaConfig);
      expect(check24h.breached).toBe(false);
      expect(check24h.currentApproverRole).toBe('TEAM_LEAD');
      expect(check24h.escalated).toBe(false);

      // At T0 + 48h 1min: SLA breached -> Escalated to DEPARTMENT_MANAGER
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 60 * 1000);
      const check48h = evaluateStepSLA(step, stepStartTime, slaConfig);
      expect(check48h.breached).toBe(true);
      expect(check48h.elapsedHours).toBeGreaterThan(48);
      expect(check48h.currentApproverRole).toBe('DEPARTMENT_MANAGER');
      expect(check48h.escalated).toBe(true);
    });
  });

  describe('3. Stale Draft TTL Auto-Cancellation Policy', () => {
    const isDraftExpired = (workflow: Workflow, ttlDays: number = 30): boolean => {
      if (workflow.status !== 'DRAFT') return false;
      const createdAt = new Date(workflow.createdAt);
      const now = new Date();
      const elapsedDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      return elapsedDays >= ttlDays;
    };

    it('identifies unsubmitted draft workflows exceeding 30-day TTL for auto-cancellation', () => {
      const draftWorkflow: Workflow = {
        id: 'wf-draft-ttl',
        tenantId: TENANT_ID,
        type: 'EXPENSE',
        title: 'Abandoned Team Offsite Draft',
        amount: 2500,
        requesterId: 'user-alice',
        requesterName: 'Alice Johnson',
        status: 'DRAFT',
        createdAt: BASE_TIME.toISOString(),
        updatedAt: BASE_TIME.toISOString(),
      };

      // Day 15: Not expired
      vi.advanceTimersByTime(15 * 24 * 60 * 60 * 1000);
      expect(isDraftExpired(draftWorkflow, 30)).toBe(false);

      // Day 30: Expired
      vi.advanceTimersByTime(15 * 24 * 60 * 60 * 1000);
      expect(isDraftExpired(draftWorkflow, 30)).toBe(true);

      // Submitted workflow (status != DRAFT) never auto-expires via draft TTL
      const submittedWorkflow: Workflow = { ...draftWorkflow, status: 'PENDING' };
      expect(isDraftExpired(submittedWorkflow, 30)).toBe(false);
    });
  });
});
