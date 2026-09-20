import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useSSE } from '../context/SSEContext.js';
import { Workflow } from '@workflow/shared-types';
import { WorkflowWidget } from '@workflow/workflow-widget';
import { buildAuthHeaders, tracedFetch } from '../utils/api.js';
import { CheckCircle2, Clock, RefreshCw, AlertCircle } from 'lucide-react';

export const ApprovalsPage: React.FC = () => {
  const { tenantId, currentUser, apiUrl } = useAuth();
  const { refreshSignal } = useSSE();
  const [pendingWorkflows, setPendingWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  const fetchPendingWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tracedFetch(`${apiUrl}/api/v1/workflows?status=PENDING`, {
        headers: buildAuthHeaders(tenantId, currentUser),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const list: Workflow[] = json.data.workflows || [];
        setPendingWorkflows(list);
        if (list.length > 0 && !selectedWorkflowId) {
          setSelectedWorkflowId(list[0].id);
        } else if (list.length === 0) {
          setSelectedWorkflowId(null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch pending approvals:', err);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, tenantId, currentUser, selectedWorkflowId]);

  useEffect(() => {
    fetchPendingWorkflows();
  }, [tenantId, refreshSignal]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
            Approvals Inbox
          </h1>
          <p style={{ fontSize: '14px', color: '#64748b' }}>
            Pending requests requiring management sign-off for {tenantId}
          </p>
        </div>

        <button
          data-testid="refresh-approvals-btn"
          onClick={fetchPendingWorkflows}
          className="btn btn-secondary"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {currentUser.role === 'requester' && (
        <div
          data-testid="approver-role-warning"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 16px',
            backgroundColor: '#fffbeb',
            border: '1px solid #fef3c7',
            borderRadius: '8px',
            color: '#b45309',
            fontSize: '13px',
            marginBottom: '20px',
          }}
        >
          <AlertCircle size={18} />
          <span>
            You are logged in with the <strong>requester</strong> role. Switch to an <strong>approver</strong> or <strong>admin</strong> persona in the header to approve or reject items.
          </span>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(360px, 1.2fr) minmax(340px, 1fr)',
          gap: '24px',
          alignItems: 'start',
        }}
      >
        {/* Left: Pending Workflows List */}
        <div className="card">
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid #e2e8f0',
              fontWeight: 600,
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Clock size={18} color="#b45309" />
            <span>Pending Approvals ({pendingWorkflows.length})</span>
          </div>

          {loading ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
              Loading pending items...
            </div>
          ) : pendingWorkflows.length === 0 ? (
            <div
              data-testid="empty-approvals-state"
              style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}
            >
              <CheckCircle2 size={36} color="#10b981" style={{ marginBottom: '12px' }} />
              <div style={{ fontWeight: 600, fontSize: '16px', color: '#1e293b' }}>
                All caught up!
              </div>
              <p style={{ fontSize: '14px', marginTop: '4px' }}>
                There are no pending approvals for this tenant.
              </p>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table" data-testid="approvals-table">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Requester</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingWorkflows.map((w) => {
                    const isSelected = selectedWorkflowId === w.id;
                    return (
                      <tr
                        key={w.id}
                        data-testid={`approval-row-${w.id}`}
                        onClick={() => setSelectedWorkflowId(w.id)}
                        style={{
                          cursor: 'pointer',
                          backgroundColor: isSelected ? '#eff6ff' : undefined,
                        }}
                      >
                        <td>
                          <div style={{ fontWeight: 600, color: '#1e293b' }}>{w.title}</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>{w.type} • {w.id.substring(0, 8)}</div>
                        </td>
                        <td>
                          <div style={{ fontSize: '13px', color: '#334155' }}>{w.requesterName}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#047857' }}>
                            {w.currency || '$'} {w.amount?.toLocaleString() || 0}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Embedded Workflow Widget for Action */}
        <div>
          {selectedWorkflowId ? (
            <WorkflowWidget
              workflowId={selectedWorkflowId}
              apiUrl={apiUrl}
              tenantId={tenantId}
              userId={currentUser.id}
              userName={currentUser.name}
              userRole={currentUser.role}
              onStatusChange={() => {
                fetchPendingWorkflows();
              }}
            />
          ) : (
            <div
              className="card"
              style={{
                padding: '48px 24px',
                textAlign: 'center',
                color: '#64748b',
              }}
            >
              Select a pending approval from the list to review and decide.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
