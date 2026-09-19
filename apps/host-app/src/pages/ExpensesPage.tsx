import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { Workflow, CreateWorkflowDTO } from '@workflow/shared-types';
import { WorkflowWidget } from '@workflow/workflow-widget';
import { PlusCircle, RefreshCw, DollarSign, Calendar, FileText, ChevronRight } from 'lucide-react';

export const ExpensesPage: React.FC = () => {
  const { tenantId, currentUser, apiUrl } = useAuth();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  // Form State
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [title, setTitle] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [description, setDescription] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/workflows`, {
        headers: {
          'x-tenant-id': tenantId,
          'x-user-id': currentUser.id,
          'x-user-name': currentUser.name,
        },
      });
      const json = await res.json();
      if (json.success && json.data) {
        const list: Workflow[] = json.data.workflows || [];
        setWorkflows(list);
        if (list.length > 0 && !selectedWorkflowId) {
          setSelectedWorkflowId(list[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, tenantId, currentUser, selectedWorkflowId]);

  useEffect(() => {
    fetchWorkflows();
  }, [tenantId]); // Re-fetch on tenant switch

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setCreating(true);
    try {
      const parsedAmount = parseFloat(amount) || 0;
      const payload: CreateWorkflowDTO = {
        type: 'EXPENSE',
        title: title.trim(),
        amount: parsedAmount,
        currency,
        description: description.trim() || undefined,
        metadata: { department: 'Engineering' },
      };

      const res = await fetch(`${apiUrl}/api/v1/workflows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'x-user-id': currentUser.id,
          'x-user-name': currentUser.name,
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (json.success && json.data) {
        setShowCreateModal(false);
        setTitle('');
        setDescription('');
        setAmount('');
        await fetchWorkflows();
        setSelectedWorkflowId(json.data.id);
      }
    } catch (err) {
      console.error('Failed to create workflow:', err);
    } finally {
      setCreating(false);
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'badge-draft';
      case 'PENDING': return 'badge-pending';
      case 'APPROVED': return 'badge-approved';
      case 'REJECTED': return 'badge-rejected';
      case 'CANCELLED': return 'badge-cancelled';
      default: return 'badge-draft';
    }
  };

  const renderStatusBadge = (w: Workflow) => {
    if (w.status === 'PENDING' && w.totalSteps && w.totalSteps > 1) {
      return (
        <span className="badge badge-pending">
          PENDING (Step {w.currentStepOrder || 1}/{w.totalSteps})
        </span>
      );
    }
    return (
      <span className={`badge ${getStatusClass(w.status)}`}>
        {w.status}
      </span>
    );
  };

  return (
    <div>
      {/* Page Header */}
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
            Expense Reimbursements
          </h1>
          <p style={{ fontSize: '14px', color: '#64748b' }}>
            Submit, track, and manage business expense workflows for {tenantId}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            data-testid="refresh-expenses-btn"
            onClick={fetchWorkflows}
            className="btn btn-secondary"
            title="Refresh List"
          >
            <RefreshCw size={16} />
            Refresh
          </button>

          <button
            data-testid="new-expense-btn"
            onClick={() => setShowCreateModal(true)}
            className="btn btn-primary"
          >
            <PlusCircle size={16} />
            New Expense Request
          </button>
        </div>
      </div>

      {/* Main Grid: List on Left, Workflow Widget on Right */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(360px, 1.2fr) minmax(340px, 1fr)',
          gap: '24px',
          alignItems: 'start',
        }}
      >
        {/* Left: Workflows Table / List */}
        <div className="card">
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid #e2e8f0',
              fontWeight: 600,
              fontSize: '15px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Tenant Workflows ({workflows.length})</span>
          </div>

          {loading ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
              Loading workflows...
            </div>
          ) : workflows.length === 0 ? (
            <div data-testid="empty-expenses-state" style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
              <FileText size={36} color="#94a3b8" style={{ marginBottom: '12px' }} />
              <div style={{ fontWeight: 600, fontSize: '16px', color: '#1e293b' }}>No expense requests found</div>
              <p style={{ fontSize: '14px', marginTop: '4px' }}>Click "New Expense Request" to create one.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table" data-testid="expenses-table">
                <thead>
                  <tr>
                    <th>Title & ID</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {workflows.map((w) => {
                    const isSelected = selectedWorkflowId === w.id;
                    return (
                      <tr
                        key={w.id}
                        data-testid={`workflow-row-${w.id}`}
                        onClick={() => setSelectedWorkflowId(w.id)}
                        style={{
                          cursor: 'pointer',
                          backgroundColor: isSelected ? '#eff6ff' : undefined,
                        }}
                      >
                        <td>
                          <div style={{ fontWeight: 600, color: '#1e293b' }}>{w.title}</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>{w.id.substring(0, 8)}...</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#047857' }}>
                            {w.currency || '$'} {w.amount?.toLocaleString() || 0}
                          </div>
                        </td>
                        <td>
                          {renderStatusBadge(w)}
                        </td>
                        <td>
                          <ChevronRight size={16} color={isSelected ? '#2563eb' : '#94a3b8'} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Embedded Workflow Widget */}
        <div>
          {selectedWorkflowId ? (
            <WorkflowWidget
              workflowId={selectedWorkflowId}
              apiUrl={apiUrl}
              tenantId={tenantId}
              userId={currentUser.id}
              userName={currentUser.name}
              userRole={currentUser.role as any}
              onStatusChange={() => {
                fetchWorkflows();
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
              Select a workflow from the list to view its status and actions.
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div
          data-testid="create-expense-modal"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '28px',
              width: '100%',
              maxWidth: '520px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <h3 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 700 }}>
              Create New Expense Request
            </h3>

            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Expense Title *
                </label>
                <input
                  data-testid="expense-title-input"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. AWS Cloud Summit Tickets"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Amount *
                  </label>
                  <input
                    data-testid="expense-amount-input"
                    type="number"
                    step="0.01"
                    required
                    placeholder="e.g. 12000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '14px',
                    }}
                  />
                  <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    Routing: &lt;10k (1 step), 10k-100k (2 steps), &gt;100k (3 steps)
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Currency
                  </label>
                  <select
                    data-testid="expense-currency-select"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '14px',
                    }}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="JPY">JPY (¥)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Description / Business Justification
                </label>
                <textarea
                  data-testid="expense-desc-input"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain why this expense is required..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  data-testid="cancel-create-btn"
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-create-btn"
                  disabled={creating || !title.trim() || !amount}
                  className="btn btn-primary"
                >
                  {creating ? 'Creating...' : 'Create Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
