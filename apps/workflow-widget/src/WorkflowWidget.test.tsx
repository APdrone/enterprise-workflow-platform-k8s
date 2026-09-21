import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowWidget } from './WorkflowWidget.js';
import { Workflow } from '@workflow/shared-types';

describe('WorkflowWidget Component Unit & Interaction Tests', () => {
  const mockTenantId = 'tenant-corp-a';
  const mockWorkflowId = 'wf-test-101';
  const mockRequesterId = 'user-alice';
  const mockApproverId = 'user-bob';

  const mockDraftWorkflow: Workflow = {
    id: mockWorkflowId,
    tenantId: mockTenantId,
    type: 'EXPENSE',
    title: 'Cloud Infrastructure Upgrade',
    description: 'Procurement of AWS reserved instances',
    amount: 8500,
    currency: 'USD',
    requesterId: mockRequesterId,
    requesterName: 'Alice Johnson',
    status: 'DRAFT',
    currentStepOrder: 1,
    totalSteps: 1,
    steps: [
      {
        id: 'step-1',
        workflowId: mockWorkflowId,
        tenantId: mockTenantId,
        stepOrder: 1,
        stepRole: 'TEAM_LEAD',
        status: 'PENDING',
        policy: 'ALL_MUST_APPROVE',
        createdAt: new Date().toISOString(),
      },
    ],
    metadata: { department: 'Engineering' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('Initial Rendering & Status Badges', () => {
    it('renders workflow header details correctly (title, amount, status)', () => {
      render(
        <WorkflowWidget
          workflowId={mockWorkflowId}
          tenantId={mockTenantId}
          userId={mockRequesterId}
          userName="Alice Johnson"
          userRole="EMPLOYEE"
          initialMockWorkflow={mockDraftWorkflow}
        />
      );

      expect(screen.getByText('Cloud Infrastructure Upgrade')).toBeInTheDocument();
      expect(screen.getByText(/8,500/)).toBeInTheDocument();
      expect(screen.getByTestId('workflow-status-badge')).toHaveTextContent(/Draft/i);
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    it('renders step progress timeline with correct role labels', () => {
      render(
        <WorkflowWidget
          workflowId={mockWorkflowId}
          tenantId={mockTenantId}
          userId={mockRequesterId}
          initialMockWorkflow={mockDraftWorkflow}
        />
      );

      expect(screen.getByText('Team Lead')).toBeInTheDocument();
    });
  });

  describe('Role-Based Action Buttons', () => {
    it('displays "Submit for Approval" and "Cancel" buttons for the requester when status is DRAFT', () => {
      render(
        <WorkflowWidget
          workflowId={mockWorkflowId}
          tenantId={mockTenantId}
          userId={mockRequesterId}
          userRole="requester"
          initialMockWorkflow={mockDraftWorkflow}
        />
      );

      const submitBtn = screen.getByTestId('submit-workflow-btn');
      expect(submitBtn).toBeInTheDocument();
      expect(submitBtn).toHaveTextContent(/Submit for Approval/i);

      const cancelBtn = screen.getByTestId('cancel-workflow-btn');
      expect(cancelBtn).toBeInTheDocument();
    });

    it('displays "Approve" and "Reject" buttons for designated approver when status is PENDING', () => {
      const pendingWorkflow: Workflow = {
        ...mockDraftWorkflow,
        status: 'PENDING',
      };

      render(
        <WorkflowWidget
          workflowId={mockWorkflowId}
          tenantId={mockTenantId}
          userId={mockApproverId}
          userRole="team_lead"
          initialMockWorkflow={pendingWorkflow}
        />
      );

      const approveBtn = screen.getByTestId('approve-workflow-btn');
      expect(approveBtn).toBeInTheDocument();
      expect(approveBtn).toHaveTextContent(/Approve/i);

      const rejectBtn = screen.getByTestId('reject-workflow-btn');
      expect(rejectBtn).toBeInTheDocument();
      expect(rejectBtn).toHaveTextContent(/Reject/i);
    });
  });

  describe('Rejection Modal & Validation', () => {
    it('opens rejection modal when Reject button is clicked and requires a non-empty reason', async () => {
      const pendingWorkflow: Workflow = {
        ...mockDraftWorkflow,
        status: 'PENDING',
      };

      render(
        <WorkflowWidget
          workflowId={mockWorkflowId}
          tenantId={mockTenantId}
          userId={mockApproverId}
          userRole="team_lead"
          initialMockWorkflow={pendingWorkflow}
        />
      );

      const rejectBtn = screen.getByTestId('reject-workflow-btn');
      fireEvent.click(rejectBtn);

      // Rejection dialog should appear
      expect(screen.getByText(/Decline & Reject Workflow/i)).toBeInTheDocument();
      const reasonInput = screen.getByTestId('rejection-reason-input');
      expect(reasonInput).toBeInTheDocument();

      // Submit reject without reason - confirm button remains disabled
      const confirmRejectBtn = screen.getByTestId('reject-confirm-btn');
      expect(confirmRejectBtn).toBeDisabled();

      // Provide reason
      fireEvent.change(reasonInput, { target: { value: 'Exceeds budget limit' } });
      expect(confirmRejectBtn).not.toBeDisabled();
    });
  });


  describe('Terminal Workflow States', () => {
    it('displays APPROVED completion banner when workflow status is APPROVED', () => {
      const approvedWorkflow: Workflow = {
        ...mockDraftWorkflow,
        status: 'APPROVED',
        currentStepOrder: 2,
        steps: [
          {
            id: 'step-1',
            workflowId: mockWorkflowId,
            tenantId: mockTenantId,
            stepOrder: 1,
            stepRole: 'TEAM_LEAD',
            status: 'APPROVED',
            policy: 'ALL_MUST_APPROVE',
            actedBy: mockApproverId,
            actedAt: new Date().toISOString(),
          },
        ],
      };

      render(
        <WorkflowWidget
          workflowId={mockWorkflowId}
          tenantId={mockTenantId}
          userId={mockRequesterId}
          initialMockWorkflow={approvedWorkflow}
        />
      );

      expect(screen.getByTestId('workflow-status-badge')).toHaveTextContent(/Approved/i);
      expect(screen.queryByTestId('submit-workflow-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('approve-workflow-btn')).not.toBeInTheDocument();
    });

    it('displays REJECTED badge with reason when workflow status is REJECTED', () => {
      const rejectedWorkflow: Workflow = {
        ...mockDraftWorkflow,
        status: 'REJECTED',
        rejectionReason: 'Exceeds Q3 allocated budget',
      };

      render(
        <WorkflowWidget
          workflowId={mockWorkflowId}
          tenantId={mockTenantId}
          userId={mockRequesterId}
          initialMockWorkflow={rejectedWorkflow}
        />
      );

      expect(screen.getByTestId('workflow-status-badge')).toHaveTextContent(/Rejected/i);
      expect(screen.getByText(/Exceeds Q3 allocated budget/i)).toBeInTheDocument();
    });
  });
});
