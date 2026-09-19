import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { NotificationRecord } from '@workflow/shared-types';
import {
  Bell,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ArrowRightCircle,
  Send,
  Clock,
  User,
  Filter,
  CheckCheck,
} from 'lucide-react';

export const NotificationsPage: React.FC = () => {
  const { tenantId, currentUser, notificationApiUrl } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterMode, setFilterMode] = useState<'all' | 'mine'>('all');

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${notificationApiUrl}/api/v1/notifications?tenantId=${tenantId}`);
      const json = await res.json();
      if (json.success && json.data) {
        setNotifications(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [notificationApiUrl, tenantId]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 4000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const isRelevantToMe = (n: NotificationRecord) => {
    if (n.recipientId === currentUser.id) return true;
    if (
      (n.recipientId === 'approver-team' || n.recipientId === 'next-approver-team') &&
      currentUser.role !== 'requester'
    ) {
      return true;
    }
    return false;
  };

  const displayedNotifications = notifications.filter((n) => {
    if (filterMode === 'mine') {
      return isRelevantToMe(n);
    }
    return true;
  });

  const getNotifStyle = (type: string) => {
    switch (type) {
      case 'SUBMITTED':
        return {
          bg: '#eff6ff',
          text: '#1d4ed8',
          border: '#bfdbfe',
          icon: <Send size={16} color="#2563eb" />,
          label: 'Submitted',
        };
      case 'STEP_APPROVED':
        return {
          bg: '#fef3c7',
          text: '#b45309',
          border: '#fde68a',
          icon: <ArrowRightCircle size={16} color="#d97706" />,
          label: 'Step Approved',
        };
      case 'APPROVED':
        return {
          bg: '#ecfdf5',
          text: '#047857',
          border: '#a7f3d0',
          icon: <CheckCircle size={16} color="#059669" />,
          label: 'Fully Approved',
        };
      case 'REJECTED':
        return {
          bg: '#fef2f2',
          text: '#b91c1c',
          border: '#fecaca',
          icon: <AlertCircle size={16} color="#dc2626" />,
          label: 'Rejected',
        };
      default:
        return {
          bg: '#f8fafc',
          text: '#475569',
          border: '#e2e8f0',
          icon: <Bell size={16} color="#64748b" />,
          label: type,
        };
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
            System Notifications
          </h1>
          <p style={{ fontSize: '14px', color: '#64748b', marginTop: '2px' }}>
            Real-time alerts dispatched from Kafka consumer for <strong>{tenantId}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            data-testid="refresh-notifications-btn"
            onClick={fetchNotifications}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="card">
        {/* Filter Toolbar */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#fafafa',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bell size={18} color="#2563eb" />
            <span style={{ fontWeight: 600, fontSize: '15px' }}>
              Notification Feed ({displayedNotifications.length})
            </span>
          </div>

          <div style={{ display: 'flex', gap: '6px', backgroundColor: '#e2e8f0', padding: '3px', borderRadius: '8px' }}>
            <button
              onClick={() => setFilterMode('all')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: filterMode === 'all' ? '#ffffff' : 'transparent',
                color: filterMode === 'all' ? '#0f172a' : '#64748b',
                boxShadow: filterMode === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              All Events ({notifications.length})
            </button>
            <button
              onClick={() => setFilterMode('mine')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: filterMode === 'mine' ? '#ffffff' : 'transparent',
                color: filterMode === 'mine' ? '#0f172a' : '#64748b',
                boxShadow: filterMode === 'mine' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Relevant to {currentUser.name} ({notifications.filter(isRelevantToMe).length})
            </button>
          </div>
        </div>

        {/* Content Body */}
        {loading && notifications.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
            <RefreshCw size={24} className="spin" style={{ marginBottom: '12px', color: '#2563eb' }} />
            <div>Checking Kafka Notification feed...</div>
          </div>
        ) : displayedNotifications.length === 0 ? (
          <div
            data-testid="empty-notifications-state"
            style={{ padding: '64px 24px', textAlign: 'center', color: '#64748b' }}
          >
            <CheckCheck size={40} color="#94a3b8" style={{ marginBottom: '12px' }} />
            <div style={{ fontWeight: 600, fontSize: '16px', color: '#1e293b' }}>
              No notifications matching current filter
            </div>
            <p style={{ fontSize: '14px', marginTop: '4px', maxWidth: '440px', margin: '8px auto 0' }}>
              {filterMode === 'mine'
                ? `No alerts addressed to ${currentUser.name} (${currentUser.role}). Switch to "All Events" to view all cluster events.`
                : 'When workflows are submitted, reviewed, or approved, Kafka events trigger notifications here.'}
            </p>
          </div>
        ) : (
          <div data-testid="notifications-list" style={{ padding: '4px 0' }}>
            {displayedNotifications.map((n) => {
              const s = getNotifStyle(n.type);
              const forMe = isRelevantToMe(n);

              return (
                <div
                  key={n.id}
                  data-testid={`notification-item-${n.id}`}
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '16px',
                    backgroundColor: forMe ? '#fbfdff' : '#ffffff',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  {/* Event Type Icon badge */}
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '10px',
                      backgroundColor: s.bg,
                      border: `1px solid ${s.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: '2px',
                    }}
                  >
                    {s.icon}
                  </div>

                  {/* Main Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        marginBottom: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: '14px',
                            color: '#0f172a',
                          }}
                        >
                          {n.title}
                        </span>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: s.bg,
                            color: s.text,
                            border: `1px solid ${s.border}`,
                            textTransform: 'uppercase',
                          }}
                        >
                          {s.label}
                        </span>
                        {forMe && (
                          <span
                            style={{
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 700,
                              backgroundColor: '#dbeafe',
                              color: '#1e40af',
                            }}
                          >
                            FOR YOU
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: '12px',
                          color: '#94a3b8',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          flexShrink: 0,
                        }}
                      >
                        <Clock size={12} />
                        {new Date(n.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: '13px',
                        color: '#334155',
                        lineHeight: 1.5,
                        marginBottom: '8px',
                      }}
                    >
                      {n.body}
                    </div>

                    <div
                      style={{
                        fontSize: '12px',
                        color: '#64748b',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <User size={13} color="#94a3b8" />
                        Target Recipient: <strong style={{ color: '#0f172a' }}>{n.recipientId}</strong>
                      </span>
                      {n.workflowId && (
                        <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: '11px' }}>
                          ID: {n.workflowId.slice(0, 13)}...
                        </span>
                      )}
                    </div>
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
