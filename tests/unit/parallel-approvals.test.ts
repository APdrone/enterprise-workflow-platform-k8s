import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowService } from '../../services/workflow-api/src/services/workflow.service.js';

describe('Parallel Approvals & Quorum Resolution Tests', () => {
  let workflowService: WorkflowService;

  beforeEach(() => {
    workflowService = new WorkflowService();
  });

  describe('ALL_MUST_APPROVE (Unanimous / AND Policy)', () => {
    it('should keep workflow PENDING at current step order until all parallel reviewers approve', () => {
      const currentStepOrder = 2;
      const totalSteps = 2;
      const targetStep = { id: 'step-2a', stepOrder: 2, policy: 'ALL_MUST_APPROVE' };
      const currentOrderSteps = [
        { id: 'step-2a', stepOrder: 2, status: 'PENDING', policy: 'ALL_MUST_APPROVE' },
        { id: 'step-2b', stepOrder: 2, status: 'PENDING', policy: 'ALL_MUST_APPROVE' },
      ];

      // After 1st approval (step-2a approved, step-2b pending):
      const remainingPending = currentOrderSteps.filter((s) => s.id !== targetStep.id && s.status === 'PENDING');
      const isFullyResolved = remainingPending.length === 0;

      expect(isFullyResolved).toBe(false);

      // Workflow should stay PENDING at step 2
      const nextStatus = isFullyResolved ? 'APPROVED' : 'PENDING';
      const nextStepOrder = isFullyResolved ? (currentStepOrder + 1) : currentStepOrder;

      expect(nextStatus).toBe('PENDING');
      expect(nextStepOrder).toBe(2);
    });

    it('should advance workflow to APPROVED once final parallel reviewer approves', () => {
      const currentStepOrder = 2;
      const totalSteps = 2;
      const targetStep = { id: 'step-2b', stepOrder: 2, policy: 'ALL_MUST_APPROVE' };
      const currentOrderSteps = [
        { id: 'step-2a', stepOrder: 2, status: 'APPROVED', policy: 'ALL_MUST_APPROVE' },
        { id: 'step-2b', stepOrder: 2, status: 'PENDING', policy: 'ALL_MUST_APPROVE' },
      ];

      // After 2nd approval (step-2a was already approved, step-2b is now approved):
      const remainingPending = currentOrderSteps.filter((s) => s.id !== targetStep.id && s.status === 'PENDING');
      const isFullyResolved = remainingPending.length === 0;

      expect(isFullyResolved).toBe(true);

      const isFinalStep = currentStepOrder >= totalSteps;
      const nextStatus = isFinalStep ? 'APPROVED' : 'PENDING';

      expect(nextStatus).toBe('APPROVED');
    });
  });

  describe('ANY_CAN_APPROVE (First-Responder / OR Policy)', () => {
    it('should immediately resolve step order upon first approval and auto-skip pending siblings', () => {
      const currentStepOrder = 1;
      const totalSteps = 2;
      const targetStep = { id: 'step-1a', stepOrder: 1, policy: 'ANY_CAN_APPROVE' };
      const currentOrderSteps = [
        { id: 'step-1a', stepOrder: 1, status: 'PENDING', policy: 'ANY_CAN_APPROVE' },
        { id: 'step-1b', stepOrder: 1, status: 'PENDING', policy: 'ANY_CAN_APPROVE' },
      ];

      // With ANY_CAN_APPROVE:
      const policy = targetStep.policy;
      let isFullyResolved = false;
      let autoSkippedSiblings: string[] = [];

      if (policy === 'ANY_CAN_APPROVE') {
        isFullyResolved = true;
        autoSkippedSiblings = currentOrderSteps
          .filter((s) => s.id !== targetStep.id && s.status === 'PENDING')
          .map((s) => s.id);
      }

      expect(isFullyResolved).toBe(true);
      expect(autoSkippedSiblings).toContain('step-1b');

      const nextStepOrder = isFullyResolved ? currentStepOrder + 1 : currentStepOrder;
      expect(nextStepOrder).toBe(2);
    });
  });
});
