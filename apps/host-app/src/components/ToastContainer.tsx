import React from 'react';
import { useSSE } from '../context/SSEContext.js';
import { Bell, CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toast, dismissToast } = useSSE();

  if (!toast) return null;

  const getIcon = () => {
    switch (toast.type) {
      case 'workflow.approved.v1':
        return <CheckCircle2 size={20} color="#10b981" />;
      case 'workflow.rejected.v1':
        return <XCircle size={20} color="#ef4444" />;
      case 'workflow.step_approved.v1':
        return <Info size={20} color="#3b82f6" />;
      case 'workflow.submitted.v1':
        return <Bell size={20} color="#8b5cf6" />;
      default:
        return <AlertTriangle size={20} color="#f59e0b" />;
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        maxWidth: '420px',
        width: 'calc(100% - 48px)',
        backgroundColor: '#0f172a',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '16px 20px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '14px',
        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div style={{ marginTop: '2px', flexShrink: 0 }}>{getIcon()}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '14px', color: '#f8fafc', marginBottom: '4px' }}>
          {toast.title}
        </div>
        <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.4 }}>
          {toast.body}
        </div>
      </div>
      <button
        onClick={dismissToast}
        style={{
          background: 'none',
          border: 'none',
          color: '#64748b',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '4px',
        }}
        title="Dismiss alert"
      >
        <X size={16} />
      </button>
    </div>
  );
};
