import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RulesEngineService } from '../../services/workflow-api/src/services/rules.engine.js';
import { CreateWorkflowDTO } from '@workflow/shared-types';
import { db } from '../../services/workflow-api/src/db/client.js';

vi.mock('../../services/workflow-api/src/db/client.js', () => {
  const createChain = (result: any = []) => {
    const chain: any = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn(),
      values: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      returning: vi.fn().mockResolvedValue(result),
      then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(result).catch(reject),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.offset.mockReturnValue(chain);
    chain.set.mockReturnValue(chain);
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => createChain([])),
      insert: vi.fn(() => createChain()),
      update: vi.fn(() => createChain()),
    },
    pool: { end: vi.fn() },
  };
});

describe('RulesEngineService Unit Tests', () => {
  let rulesEngine: RulesEngineService;

  beforeEach(() => {
    rulesEngine = new RulesEngineService();
    vi.clearAllMocks();
  });


  describe('Default Tier Step Generation', () => {
    it('should generate single Team Lead step for low amount (< 10000)', async () => {
      const dto: CreateWorkflowDTO = {
        type: 'EXPENSE',
        title: 'Team Coffee',
        amount: 250,
      };

      const steps = await rulesEngine.evaluateSteps('tenant-corp-a', 'wf-test-1', dto);
      expect(steps.length).toBe(1);
      expect(steps[0].stepOrder).toBe(1);
      expect(steps[0].stepRole).toBe('TEAM_LEAD');
      expect(steps[0].policy).toBe('ALL_MUST_APPROVE');
      expect(steps[0].parallelGroup).toBeNull();
    });

    it('should generate 2 sequential steps for mid-tier amount (10000 - 100000)', async () => {
      const dto: CreateWorkflowDTO = {
        type: 'EXPENSE',
        title: 'Hardware Upgrade',
        amount: 45000,
      };

      const steps = await rulesEngine.evaluateSteps('tenant-corp-a', 'wf-test-2', dto);
      expect(steps.length).toBe(2);
      expect(steps[0].stepRole).toBe('TEAM_LEAD');
      expect(steps[0].stepOrder).toBe(1);
      expect(steps[1].stepRole).toBe('DEPT_MANAGER');
      expect(steps[1].stepOrder).toBe(2);
    });

    it('should generate parallel approval steps for high-tier amount (> 100000)', async () => {
      const dto: CreateWorkflowDTO = {
        type: 'EXPENSE',
        title: 'Cloud Infrastructure Contract',
        amount: 250000,
      };

      const steps = await rulesEngine.evaluateSteps('tenant-corp-a', 'wf-test-3', dto);
      expect(steps.length).toBe(3);
      expect(steps[0].stepRole).toBe('TEAM_LEAD');
      expect(steps[0].stepOrder).toBe(1);

      // Step 2 has 2 parallel reviewers: Dept Manager + Finance Director
      const step2Roles = steps.filter((s) => s.stepOrder === 2);
      expect(step2Roles.length).toBe(2);
      expect(step2Roles.map((s) => s.stepRole)).toContain('DEPT_MANAGER');
      expect(step2Roles.map((s) => s.stepRole)).toContain('FINANCE_DIRECTOR');
      expect(step2Roles[0].parallelGroup).toBe('dept-finance-parallel');
    });
  });

  describe('Explicit Custom Steps', () => {
    it('should preserve custom steps and approval policies provided in payload', async () => {
      const dto: CreateWorkflowDTO = {
        type: 'PURCHASE_ORDER',
        title: 'Server Rack Order',
        amount: 50000,
        customSteps: [
          {
            stepOrder: 1,
            stepRole: 'SECURITY_OFFICER',
            policy: 'ANY_CAN_APPROVE',
            parallelGroup: 'grp-sec',
          },
          {
            stepOrder: 1,
            stepRole: 'LEGAL_COUNSEL',
            policy: 'ANY_CAN_APPROVE',
            parallelGroup: 'grp-sec',
          },
          {
            stepOrder: 2,
            stepRole: 'FINANCE_DIRECTOR',
            policy: 'ALL_MUST_APPROVE',
          },
        ],
      };

      const steps = await rulesEngine.evaluateSteps('tenant-corp-a', 'wf-custom-1', dto);
      expect(steps.length).toBe(3);
      expect(steps[0].stepRole).toBe('SECURITY_OFFICER');
      expect(steps[0].policy).toBe('ANY_CAN_APPROVE');
      expect(steps[1].stepRole).toBe('LEGAL_COUNSEL');
      expect(steps[2].stepRole).toBe('FINANCE_DIRECTOR');
      expect(steps[2].stepOrder).toBe(2);
    });
  });

  describe('Tenant-Scoped Dynamic Database Rules Evaluation', () => {
    it('should evaluate custom dynamic rule configured in database when conditions match', async () => {
      const mockRule = {
        id: 'rule-custom-99',
        tenantId: 'tenant-corp-a',
        ruleName: 'Engineering High-Cost Software',
        workflowType: 'PURCHASE_ORDER',
        minAmount: '5000',
        maxAmount: '50000',
        department: 'Engineering',
        priority: 10,
        isActive: true,
        steps: [
          { stepOrder: 1, stepRole: 'ENG_ARCHITECT', policy: 'ALL_MUST_APPROVE' },
          { stepOrder: 2, stepRole: 'CTO', policy: 'ALL_MUST_APPROVE' },
        ],
      };

      const chain: any = {
        from: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn().mockResolvedValue([mockRule]),
      };
      chain.from.mockReturnValue(chain);
      chain.where.mockReturnValue(chain);

      vi.spyOn(db, 'select').mockReturnValue(chain);

      const dto: CreateWorkflowDTO = {
        type: 'PURCHASE_ORDER',
        title: 'Datadog Enterprise License',
        amount: 15000,
        department: 'Engineering',
      };


      const steps = await rulesEngine.evaluateSteps('tenant-corp-a', 'wf-dyn-1', dto);
      expect(steps.length).toBe(2);
      expect(steps[0].stepRole).toBe('ENG_ARCHITECT');
      expect(steps[0].stepOrder).toBe(1);
      expect(steps[1].stepRole).toBe('CTO');
      expect(steps[1].stepOrder).toBe(2);
    });
  });
});

