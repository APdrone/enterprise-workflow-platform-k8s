import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { AuditEventRecord } from '@workflow/shared-types';
import { Shield, Clock, Search, FileJson, CheckCircle } from 'lucide-react';

export const AuditPage: React.FC = () => {
  const { tenantId, auditApiUrl, apiUrl, currentUser } = useAuth();
  const [workflows, setWorkflows] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Fetch recent workflows for the dropdown
  useEffect(() => {
    async function loadWorkflowList() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/workflows`, {
          headers: {
            'x-tenant-id': tenantId,
            'x-user-id': currentUser.id,
            'x-user-name': currentUser.name,
          },
        });
        const json = await res.json();
        if (json.success && json.data?.workflows) {
          const list = json.data.workflows.map((w: any) => ({ id: w.id, title: w.title }));
          setWorkflows(list);
          if (list.length > 0 && !selectedWorkflowId) {
            setSelectedWorkflowId(list[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load workflow list for audit:', err);
      }
    }
    loadWorkflowList();
  }, [tenantId, apiUrl, currentUser]);

  const fetchAuditTrail = useCallback(async (wfId: string) => {
    if (!wfId) return;
    setLoading(true);
    try {
      const res = await fetch(`${auditApiUrl}/api/v1/audit/${wfId}`, {
        headers: {
          'x-tenant-id': tenantId,
        },
      });
      const json = await res.json();
      if (json.success && json.data) {
        setAuditEvents(json.data.events || []);
      } else {
        setAuditEvents([]);
      }
    } catch (err) {
      console.error('Failed to fetch audit events:', err);
      setAuditEvents([]);
    } finally {
      setLoading(false);
    }
  }, [auditApiUrl, tenantId]);

  useEffect(() => {
    if (selectedWorkflowId) {
      fetchAuditTrail(selectedWorkflowId);
    }
  }, [selectedWorkflowId, fetchAuditTrail]);

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
          Compliance & Audit Trail
        </h1>
        <p style={{ fontSize: '14px', color: '#64748b' }}>
          Immutable event ledger from the Audit Service for tenant {tenantId}
        </p>
      </div>

      {/* Selector & Search Header */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          marginBottom: '24px',
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '280px' }}>
          <Search size={16} color="#64748b" />
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>
            Select Workflow:
          </label>
          <select
            data-testid="audit-workflow-select"
            value={selectedWorkflowId}
            onChange={(e) => setSelectedWorkflowId(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              outline: 'none',
            }}
          >
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title} ({w.id.substring(0, 8)}...)
              </option>
            ))}
          </select>
        </div>

        <button
          data-testid="refresh-audit-btn"
          onClick={() => fetchAuditTrail(selectedWorkflowId)}
          className="btn btn-secondary"
        >
          Refresh Audit Trail
        </button>
      </div>

      {/* Timeline view */}
      <div className="card" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={18} color="#2563eb" />
          Event Lifecycle Log ({auditEvents.length} events)
        </h3>

        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
            Fetching audit trail from audit-service...
          </div>
        ) : auditEvents.length === 0 ? (
          <div
            data-testid="empty-audit-state"
            style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}
          >
            No audit records captured yet for workflow ID: {selectedWorkflowId || 'none'}
          </div>
        ) : (
          <div
            data-testid="audit-timeline"
            style={{
              position: 'relative',
              paddingLeft: '32px',
              borderLeft: '2px solid #e2e8f0',
              marginLeft: '12px',
            }}
          >
            {auditEvents.map((evt) => {
              const isExpanded = expandedEventId === evt.id;
              return (
                <div
                  key={evt.id}
                  data-testid={`audit-event-${evt.eventType}`}
                  style={{
                    position: 'relative',
                    marginBottom: '24px',
                  }}
                >
                  {/* Timeline dot */}
                  <div
                    style={{
                      position: 'absolute',
                      left: '-41px',
                      top: '0px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: '#2563eb',
                      border: '3px solid #ffffff',
                      boxShadow: '0 0 0 2px #93c5fd',
                    }}
                  />

                  <div
                    style={{
                      backgroundColor: '#f8fafc',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      padding: '16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '6px',
                      }}
                    >
                      <span
                        data-testid="audit-event-type-badge"
                        style={{
                          fontWeight: 700,
                          fontSize: '13px',
                          color: '#1e40af',
                          fontFamily: 'monospace',
                        }}
                      >
                        {evt.eventType}
                      </span>
                      <span style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={12} />
                        {new Date(evt.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <div style={{ fontSize: '13px', color: '#334155', marginBottom: '8px' }}>
                      Actor: <strong>{evt.actorId}</strong> • Tenant: <strong>{evt.tenantId}</strong>
                      {evt.payload?.currentStepOrder && (
                        <span style={{ marginLeft: '12px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#e0f2fe', color: '#0369a1', fontSize: '12px', fontWeight: 600 }}>
                          Step {evt.payload.currentStepOrder} of {evt.payload.totalSteps || evt.payload.currentStepOrder} ({evt.payload.stepRole || 'APPROVER'})
                        </span>
                      )}
                    </div>
                    {evt.payload?.comment && (
                      <div style={{ fontSize: '12px', color: '#475569', backgroundColor: '#ffffff', padding: '6px 10px', borderRadius: '4px', border: '1px solid #e2e8f0', marginBottom: '10px', fontStyle: 'italic' }}>
                        💬 "{evt.payload.comment}"
                      </div>
                    )}

                    <button
                      data-testid={`toggle-payload-btn-${evt.id}`}
                      onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: 0,
                        cursor: 'pointer',
                      }}
                    >
                      <FileJson size={14} />
                      {isExpanded ? 'Hide Raw Payload' : 'View Raw CloudEvent Payload'}
                    </button>

                    {isExpanded && (
                      <pre
                        data-testid="audit-raw-payload"
                        style={{
                          marginTop: '10px',
                          padding: '12px',
                          backgroundColor: '#0f172a',
                          color: '#38bdf8',
                          borderRadius: '6px',
                          fontSize: '11px',
                          overflowX: 'auto',
                          fontFamily: 'monospace',
                        }}
                      >
                        {JSON.stringify(evt.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
