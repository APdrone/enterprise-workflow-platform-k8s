import React, { useState, useEffect, useCallback } from 'react';
import { Workflow, WorkflowStatus, WorkflowStep } from '@workflow/shared-types';
import { createTracedHeaders } from '@workflow/telemetry/client';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Send, 
  Ban, 
  AlertTriangle, 
  RefreshCw, 
  Sparkles, 
  UserCheck, 
  ShieldAlert, 
  ArrowRight, 
  Users 
} from 'lucide-react';

export interface WorkflowWidgetProps {
  workflowId: string;
  apiUrl?: string;
  tenantId: string;
  userId: string;
  userName?: string;
  userRole?: string;
  initialMockWorkflow?: Workflow;
  onStatusChange?: (status: WorkflowStatus, workflow: Workflow) => void;
  onError?: (error: Error) => void;
}

const DEFAULT_MOCK_WORKFLOW: Workflow = {
  id: 'wf-demo-8942',
  tenantId: 'tenant-corp-a',
  type: 'EXPENSE',
  title: 'Q3 Enterprise Architecture Conference & Travel',
  description: 'Flight tickets, lodging, and conference pass for team in Tokyo.',
  amount: 12000.0,
  currency: 'USD',
  requesterId: 'user-alice',
  requesterName: 'Alice Johnson',
  status: 'DRAFT',
  currentStepOrder: 1,
  totalSteps: 2,
  steps: [
    {
      id: 'step-1',
      workflowId: 'wf-demo-8942',
      tenantId: 'tenant-corp-a',
      stepOrder: 1,
      stepRole: 'TEAM_LEAD',
      status: 'PENDING',
      policy: 'ALL_MUST_APPROVE',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'step-2a',
      workflowId: 'wf-demo-8942',
      tenantId: 'tenant-corp-a',
      stepOrder: 2,
      stepRole: 'DEPT_MANAGER',
      status: 'PENDING',
      policy: 'ALL_MUST_APPROVE',
      parallelGroup: 'mgmt-review',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'step-2b',
      workflowId: 'wf-demo-8942',
      tenantId: 'tenant-corp-a',
      stepOrder: 2,
      stepRole: 'FINANCE_DIRECTOR',
      status: 'PENDING',
      policy: 'ALL_MUST_APPROVE',
      parallelGroup: 'mgmt-review',
      createdAt: new Date().toISOString(),
    },
  ],
  metadata: { department: 'Platform Engineering', costCenter: 'ENG-104' },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const WorkflowWidget: React.FC<WorkflowWidgetProps> = ({
  workflowId,
  apiUrl = 'http://localhost:3000',
  tenantId,
  userId,
  userName = 'User',
  userRole = 'requester',
  initialMockWorkflow,
  onStatusChange,
  onError,
}) => {
  const [workflow, setWorkflow] = useState<Workflow | null>(initialMockWorkflow || null);
  const [loading, setLoading] = useState<boolean>(!initialMockWorkflow);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMockMode, setIsMockMode] = useState<boolean>(!!initialMockWorkflow);
  const [showRejectModal, setShowRejectModal] = useState<boolean>(false);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [comment, setComment] = useState<string>('');

  const fetchWorkflow = useCallback(async () => {
    if (isMockMode) return;
    if (!workflowId || !tenantId) {
      setWorkflow(DEFAULT_MOCK_WORKFLOW);
      setIsMockMode(true);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${apiUrl}/api/v1/workflows/${workflowId}`, {
        headers: createTracedHeaders({
          'x-tenant-id': tenantId,
          'x-user-id': userId,
          'x-user-name': userName || '',
        }, { tenantId }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText || 'Unable to fetch workflow'}`);
      }

      const json = await res.json();
      if (json.success && json.data) {
        setWorkflow(json.data);
        setErrorMsg(null);
      } else {
        throw new Error(json.error?.message || 'Workflow not found');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to fetch workflow from server');
      if (onError) onError(err);
    } finally {
      setLoading(false);
    }
  }, [workflowId, apiUrl, tenantId, userId, userName, isMockMode, onError]);

  useEffect(() => {
    if (!initialMockWorkflow) {
      setLoading(true);
      fetchWorkflow();
      
      const handleLiveUpdate = (e: Event) => {
        const customEvt = e as CustomEvent;
        if (!customEvt.detail?.workflowId || customEvt.detail?.workflowId === workflowId) {
          fetchWorkflow();
        }
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('workflow:state_changed', handleLiveUpdate);
      }

      const interval = setInterval(fetchWorkflow, 30000);
      return () => {
        clearInterval(interval);
        if (typeof window !== 'undefined') {
          window.removeEventListener('workflow:state_changed', handleLiveUpdate);
        }
      };
    }
  }, [fetchWorkflow, initialMockWorkflow, workflowId]);

  const formatStepRoleName = (role?: string) => {
    switch (role) {
      case 'TEAM_LEAD': return 'Team Lead';
      case 'DEPT_MANAGER': return 'Dept Manager';
      case 'FINANCE_DIRECTOR': return 'Finance Director';
      case 'SECURITY_OFFICER': return 'Security Officer';
      case 'LEGAL_COUNSEL': return 'Legal Counsel';
      case 'GENERAL_APPROVER': return 'Manager';
      default: return role || 'Approver';
    }
  };

  // Check authorization for a specific step
  const checkUserCanApproveStep = useCallback((step: WorkflowStep) => {
    if (workflow?.status !== 'PENDING') return false;
    if (userRole === 'admin') return true;
    if (step.approverId && (step.approverId === userId || step.approverId === userName)) return true;

    const role = step.stepRole;
    if (role === 'TEAM_LEAD' && (userRole === 'team_lead' || userRole === 'approver')) return true;
    if (role === 'DEPT_MANAGER' && (userRole === 'dept_manager' || userRole === 'approver')) return true;
    if (role === 'FINANCE_DIRECTOR' && (userRole === 'finance_director' || userRole === 'approver')) return true;
    if (role === 'SECURITY_OFFICER' && (userRole === 'security_officer' || userRole === 'approver')) return true;
    if (role === 'LEGAL_COUNSEL' && (userRole === 'legal_counsel' || userRole === 'approver')) return true;
    if (role === 'GENERAL_APPROVER' && (userRole === 'approver' || userRole === 'dept_manager' || userRole === 'team_lead')) return true;
    return false;
  }, [workflow?.status, userRole, userId, userName]);

  // Current pending steps at active step order
  const currentStepOrder = workflow?.currentStepOrder || 1;
  const currentPendingSteps = workflow?.steps?.filter(
    (s) => s.stepOrder === currentStepOrder && s.status === 'PENDING'
  ) || [];

  const approvableSteps = currentPendingSteps.filter(checkUserCanApproveStep);
  const primaryApprovableStep = approvableSteps[0];
  const canApproveCurrentStep = approvableSteps.length > 0;
  const isRequester = userRole === 'requester' || userRole === 'admin' || userId === workflow?.requesterId;

  const executeAction = async (action: 'submit' | 'approve' | 'reject' | 'cancel', payload: any = {}) => {
    setActionLoading(true);
    setErrorMsg(null);

    // Mock Mode fallback
    if (isMockMode && workflow) {
      setTimeout(() => {
        let newStatus: WorkflowStatus = workflow.status;
        let nextStepOrder = workflow.currentStepOrder || 1;
        const totalSteps = workflow.totalSteps || 1;
        const steps = workflow.steps ? [...workflow.steps] : [];

        if (action === 'submit') {
          newStatus = 'PENDING';
        } else if (action === 'approve') {
          const stepToApprove = primaryApprovableStep || steps.find((s) => s.stepOrder === nextStepOrder && s.status === 'PENDING');
          if (stepToApprove) {
            const idx = steps.findIndex((s) => s.id === stepToApprove.id);
            if (idx >= 0) {
              steps[idx] = {
                ...steps[idx],
                status: 'APPROVED',
                actedBy: userName,
                actedAt: new Date().toISOString(),
              };
            }
          }

          // Check remaining pending steps at this order
          const remaining = steps.filter((s) => s.stepOrder === nextStepOrder && s.status === 'PENDING');
          if (remaining.length === 0) {
            if (nextStepOrder < totalSteps) {
              nextStepOrder += 1;
              newStatus = 'PENDING';
            } else {
              newStatus = 'APPROVED';
            }
          }
        } else if (action === 'reject') {
          newStatus = 'REJECTED';
        } else if (action === 'cancel') {
          newStatus = 'CANCELLED';
        }

        const updated: Workflow = {
          ...workflow,
          status: newStatus,
          currentStepOrder: nextStepOrder,
          steps,
          rejectionReason: payload.reason,
          updatedAt: new Date().toISOString(),
        };

        setWorkflow(updated);
        setShowRejectModal(false);
        setRejectionReason('');
        setComment('');
        setActionLoading(false);

        if (onStatusChange) {
          onStatusChange(updated.status, updated);
        }
      }, 300);
      return;
    }

    try {
      const res = await fetch(`${apiUrl}/api/v1/workflows/${workflowId}/${action}`, {
        method: 'POST',
        headers: createTracedHeaders({
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'x-user-id': userId,
          'x-user-name': userName || '',
        }, { tenantId }),
        body: JSON.stringify({
          ...payload,
          stepId: primaryApprovableStep?.id,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || `Action ${action} failed`);
      }

      const updatedWorkflow: Workflow = json.data;
      setWorkflow(updatedWorkflow);
      setShowRejectModal(false);
      setRejectionReason('');
      setComment('');

      if (onStatusChange) {
        onStatusChange(updatedWorkflow.status, updatedWorkflow);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
      if (onError) onError(err);
    } finally {
      setActionLoading(false);
    }
  };

  const activateMockMode = () => {
    setWorkflow(DEFAULT_MOCK_WORKFLOW);
    setIsMockMode(true);
    setErrorMsg(null);
    setLoading(false);
  };

  const getStatusBadge = (wf: Workflow) => {
    if (wf.status === 'PENDING') {
      const isMultiStep = (wf.totalSteps || 1) > 1;
      return (
        <span
          data-testid="workflow-status-badge"
          data-status="PENDING"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '9999px',
            fontSize: '12px',
            fontWeight: 700,
            backgroundColor: '#fef3c7',
            color: '#b45309',
            border: '1px solid #fde68a',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#d97706',
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }}
          />
          {isMultiStep ? `Pending: Step ${wf.currentStepOrder || 1}` : 'Pending Review'}
        </span>
      );
    }

    const config: Record<WorkflowStatus, { bg: string; text: string; label: string; border: string }> = {
      DRAFT: { bg: '#f1f5f9', text: '#475569', label: 'Draft', border: '#cbd5e1' },
      PENDING: { bg: '#fef3c7', text: '#b45309', label: 'Pending Review', border: '#fde68a' },
      APPROVED: { bg: '#dcfce7', text: '#15803d', label: 'Approved', border: '#bbf7d0' },
      REJECTED: { bg: '#fee2e2', text: '#b91c1c', label: 'Rejected', border: '#fecaca' },
      CANCELLED: { bg: '#f3f4f6', text: '#6b7280', label: 'Cancelled', border: '#e5e7eb' },
    };

    const c = config[wf.status] || config.DRAFT;

    return (
      <span
        data-testid="workflow-status-badge"
        data-status={wf.status}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          borderRadius: '9999px',
          fontSize: '12px',
          fontWeight: 700,
          backgroundColor: c.bg,
          color: c.text,
          border: `1px solid ${c.border}`,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: c.text,
          }}
        />
        {c.label}
      </span>
    );
  };

  // Group steps by stepOrder for parallel visualization
  const groupedSteps = (workflow?.steps || []).reduce<Record<number, WorkflowStep[]>>((acc, step) => {
    const order = step.stepOrder || 1;
    if (!acc[order]) acc[order] = [];
    acc[order].push(step);
    return acc;
  }, {});

  const stepOrderKeys = Object.keys(groupedSteps).map(Number).sort((a, b) => a - b);

  if (loading && !workflow) {
    return (
      <div
        data-testid="workflow-widget-loading"
        style={{
          padding: '36px 24px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          textAlign: 'center',
          color: '#64748b',
          fontFamily: "'Inter', -apple-system, sans-serif",
          boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        }}
      >
        <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', marginBottom: '12px', color: '#3b82f6' }} />
        <div style={{ fontWeight: 600, color: '#1e293b' }}>Loading workflow details...</div>
        <div style={{ fontSize: '13px', marginTop: '4px' }}>Connecting to {apiUrl}</div>
      </div>
    );
  }

  if (errorMsg && !workflow) {
    return (
      <div
        data-testid="workflow-widget-error"
        style={{
          padding: '24px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #fecaca',
          fontFamily: "'Inter', -apple-system, sans-serif",
          boxShadow: '0 10px 25px -5px rgba(239, 68, 68, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '16px' }}>
          <div
            style={{
              padding: '8px',
              backgroundColor: '#fee2e2',
              borderRadius: '8px',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: '#991b1b' }}>
              Workflow Service Disconnected
            </h4>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
              Could not fetch workflow from <code>{apiUrl}</code>. Make sure the API server is running with <code>npm run dev</code> or switch to interactive preview mode.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
          <button
            onClick={() => {
              setLoading(true);
              setErrorMsg(null);
              fetchWorkflow();
            }}
            style={{
              padding: '8px 14px',
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              color: '#475569',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={14} />
            Retry
          </button>

          <button
            data-testid="enable-mock-mode-btn"
            onClick={activateMockMode}
            style={{
              padding: '8px 16px',
              backgroundColor: '#2563eb',
              border: 'none',
              borderRadius: '6px',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Sparkles size={14} />
            Load Interactive Demo Widget
          </button>
        </div>
      </div>
    );
  }

  if (!workflow) return null;

  return (
    <div
      data-testid="workflow-widget-container"
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.06)',
        fontFamily: "'Inter', -apple-system, sans-serif",
        color: '#0f172a',
      }}
    >
      {/* Mock Mode Banner */}
      {isMockMode && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            padding: '8px 12px',
            marginBottom: '16px',
            fontSize: '12px',
            color: '#1e40af',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
            <Sparkles size={14} />
            Interactive Mock Preview Mode (In-Memory State Machine)
          </span>
          <span style={{ fontSize: '11px', color: '#3b82f6' }}>Role: <strong>{userRole}</strong></span>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '1px solid #f1f5f9',
          paddingBottom: '16px',
          marginBottom: '16px',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Workflow Request
            </span>
            <span style={{ color: '#cbd5e1' }}>•</span>
            <span style={{ fontSize: '12px', color: '#475569', fontFamily: 'monospace' }}>
              <span data-testid="workflow-id-display">{workflow.id}</span>
            </span>
          </div>
          <h3
            data-testid="workflow-title-display"
            style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a', lineHeight: 1.3 }}
          >
            {workflow.title}
          </h3>
          {workflow.description && (
            <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
              {workflow.description}
            </p>
          )}
        </div>
        <div>
          {getStatusBadge(workflow)}
        </div>
      </div>

      {/* Multi-Step & Parallel Timeline Stepper */}
      {stepOrderKeys.length > 0 && (
        <div
          data-testid="workflow-stepper-container"
          style={{
            backgroundColor: '#f8fafc',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '20px',
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Approval Hierarchy ({stepOrderKeys.length} Level{stepOrderKeys.length > 1 ? 's' : ''})
            </span>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Current: <strong>Step {workflow.currentStepOrder || 1} of {workflow.totalSteps || stepOrderKeys.length}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'stretch', gap: '8px', overflowX: 'auto', padding: '4px 0' }}>
            {stepOrderKeys.map((order, orderIdx) => {
              const stepsAtOrder = groupedSteps[order];
              const isParallel = stepsAtOrder.length > 1;
              const allApproved = stepsAtOrder.every((s) => s.status === 'APPROVED');
              const anyApproved = stepsAtOrder.some((s) => s.status === 'APPROVED');
              const anyRejected = stepsAtOrder.some((s) => s.status === 'REJECTED');
              const isCurrent = workflow.status === 'PENDING' && order === (workflow.currentStepOrder || 1);

              let borderColor = '#cbd5e1';
              let bgColor = '#ffffff';

              if (allApproved || (stepsAtOrder[0]?.policy === 'ANY_CAN_APPROVE' && anyApproved)) {
                borderColor = '#86efac';
                bgColor = '#f0fdf4';
              } else if (isCurrent) {
                borderColor = '#f59e0b';
                bgColor = '#fffbeb';
              } else if (anyRejected) {
                borderColor = '#fca5a5';
                bgColor = '#fef2f2';
              }

              return (
                <React.Fragment key={`order-${order}`}>
                  <div
                    data-testid={`step-node-${order}`}
                    style={{
                      flex: 1,
                      minWidth: isParallel ? '220px' : '150px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: `1.5px solid ${borderColor}`,
                      backgroundColor: bgColor,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: isCurrent ? '#b45309' : allApproved ? '#16a34a' : '#64748b' }}>
                        Step {order}
                      </span>
                      {isParallel && (
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: '#e0e7ff',
                            color: '#3730a3',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <Users size={10} />
                          {stepsAtOrder[0]?.policy === 'ANY_CAN_APPROVE' ? 'PARALLEL (OR)' : 'PARALLEL (AND)'}
                        </span>
                      )}
                    </div>

                    {/* Step Reviewer Items */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {stepsAtOrder.map((step) => {
                        const isStepApproved = step.status === 'APPROVED';
                        const isStepPending = step.status === 'PENDING';
                        const isStepSkipped = step.status === 'SKIPPED';
                        const isStepRejected = step.status === 'REJECTED';

                        return (
                          <div
                            key={step.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              backgroundColor: isStepApproved ? '#dcfce7' : isStepPending && isCurrent ? '#fef3c7' : '#f1f5f9',
                              fontSize: '12px',
                            }}
                          >
                            <span style={{ fontWeight: 600, color: '#1e293b' }}>
                              {formatStepRoleName(step.stepRole)}
                            </span>
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                color: isStepApproved ? '#15803d' : isStepPending ? '#b45309' : isStepSkipped ? '#64748b' : '#b91c1c',
                              }}
                            >
                              {isStepApproved ? '✓ APPROVED' : isStepPending ? (isCurrent ? 'PENDING' : 'WAITING') : isStepSkipped ? 'SKIPPED' : 'REJECTED'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {orderIdx < stepOrderKeys.length - 1 && (
                    <ArrowRight size={16} color="#94a3b8" style={{ flexShrink: 0, alignSelf: 'center' }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Details Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px',
          marginBottom: '20px',
          backgroundColor: '#f8fafc',
          padding: '16px',
          borderRadius: '10px',
          border: '1px solid #f1f5f9',
        }}
      >
        <div>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
            Category
          </span>
          <div data-testid="workflow-type-display" style={{ fontSize: '13px', fontWeight: 600, marginTop: '2px', color: '#1e293b' }}>
            {workflow.type}
          </div>
        </div>

        {workflow.amount !== undefined && (
          <div>
            <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
              Amount
            </span>
            <div data-testid="workflow-amount-display" style={{ fontSize: '14px', fontWeight: 700, color: '#059669', marginTop: '2px' }}>
              {workflow.currency || '$'} {workflow.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
        )}

        <div>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
            Requester
          </span>
          <div data-testid="workflow-requester-display" style={{ fontSize: '13px', fontWeight: 500, marginTop: '2px', color: '#1e293b' }}>
            {workflow.requesterName}
          </div>
        </div>

        <div>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
            Last Update
          </span>
          <div data-testid="workflow-updated-display" style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
            {new Date(workflow.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {/* Role Authorization / Waiting Notice */}
      {workflow.status === 'PENDING' && !canApproveCurrentStep && (
        <div
          data-testid="step-permission-banner"
          style={{
            padding: '12px 16px',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '10px',
            marginBottom: '16px',
            color: '#b45309',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <ShieldAlert size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>Step {currentStepOrder} Approval Required:</strong> Pending decision from{' '}
            <strong>{currentPendingSteps.map((s) => formatStepRoleName(s.stepRole)).join(' & ')}</strong>. You are currently logged in as{' '}
            <strong>{userName}</strong> ({userRole}). Switch active persona in the header bar to review.
          </div>
        </div>
      )}

      {/* Rejection notice if rejected */}
      {workflow.status === 'REJECTED' && workflow.rejectionReason && (
        <div
          data-testid="rejection-reason-display"
          style={{
            padding: '14px 16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '10px',
            marginBottom: '16px',
            color: '#991b1b',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}
        >
          <XCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong style={{ display: 'block', marginBottom: '2px' }}>Rejection Notice:</strong>
            {workflow.rejectionReason}
          </div>
        </div>
      )}

      {/* Action Buttons & Interactions */}
      <div
        data-testid="workflow-action-buttons-group"
        style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          borderTop: '1px solid #f1f5f9',
          paddingTop: '16px',
        }}
      >
        {/* DRAFT -> SUBMIT */}
        {workflow.status === 'DRAFT' && isRequester && (
          <button
            data-testid="submit-workflow-btn"
            disabled={actionLoading}
            onClick={() => executeAction('submit', { comment })}
            style={{
              padding: '9px 18px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: actionLoading ? 'not-allowed' : 'pointer',
              opacity: actionLoading ? 0.7 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
            }}
          >
            <Send size={14} />
            {actionLoading ? 'Submitting...' : 'Submit for Approval'}
          </button>
        )}

        {/* PENDING -> APPROVE / REJECT */}
        {workflow.status === 'PENDING' && canApproveCurrentStep && (
          <>
            <button
              data-testid="reject-workflow-btn"
              disabled={actionLoading}
              onClick={() => setShowRejectModal(true)}
              style={{
                padding: '9px 16px',
                backgroundColor: '#ffffff',
                color: '#dc2626',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: actionLoading ? 'not-allowed' : 'pointer',
                opacity: actionLoading ? 0.7 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <XCircle size={14} />
              Reject Request
            </button>

            <button
              data-testid="approve-workflow-btn"
              disabled={actionLoading}
              onClick={() => executeAction('approve', { comment })}
              style={{
                padding: '9px 18px',
                backgroundColor: '#16a34a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: actionLoading ? 'not-allowed' : 'pointer',
                opacity: actionLoading ? 0.7 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 4px rgba(22, 163, 74, 0.2)',
              }}
            >
              <CheckCircle size={14} />
              {actionLoading
                ? 'Processing...'
                : primaryApprovableStep
                ? `Approve as ${formatStepRoleName(primaryApprovableStep.stepRole)}`
                : 'Approve Request'}
            </button>
          </>
        )}

        {/* DRAFT or PENDING -> CANCEL */}
        {(workflow.status === 'DRAFT' || workflow.status === 'PENDING') && isRequester && (
          <button
            data-testid="cancel-workflow-btn"
            disabled={actionLoading}
            onClick={() => executeAction('cancel', { reason: 'User cancelled request' })}
            style={{
              padding: '9px 16px',
              backgroundColor: '#ffffff',
              color: '#64748b',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontWeight: 500,
              fontSize: '13px',
              cursor: actionLoading ? 'not-allowed' : 'pointer',
              opacity: actionLoading ? 0.7 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Ban size={14} />
            Cancel
          </button>
        )}
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div
          data-testid="reject-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            data-testid="reject-modal"
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '24px',
              width: '100%',
              maxWidth: '440px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            }}
          >
            <h4 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 700, color: '#991b1b' }}>
              Decline & Reject Workflow
            </h4>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
              Please provide a clear reason for rejecting this request. This will be published to the compliance audit trail.
            </p>
            <textarea
              data-testid="rejection-reason-input"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Budget limit exceeded for Q3 conference allowance..."
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                boxSizing: 'border-box',
                marginBottom: '16px',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                data-testid="reject-cancel-btn"
                onClick={() => setShowRejectModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
              <button
                data-testid="reject-confirm-btn"
                disabled={!rejectionReason.trim() || actionLoading}
                onClick={() => executeAction('reject', { reason: rejectionReason })}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: !rejectionReason.trim() || actionLoading ? 'not-allowed' : 'pointer',
                  opacity: !rejectionReason.trim() || actionLoading ? 0.6 : 1,
                }}
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
