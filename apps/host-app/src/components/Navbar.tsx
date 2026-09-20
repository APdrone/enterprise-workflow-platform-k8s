import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth, PRESET_TENANTS, PRESET_USERS } from '../context/AuthContext.js';
import { useSSE } from '../context/SSEContext.js';
import { Layers, CheckSquare, Shield, Bell, Building2, UserCircle2, Radio } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { tenantId, setTenantId, currentUser, setCurrentUser, apiUrl } = useAuth();
  const { connected: sseConnected, unreadCount } = useSSE();
  const [apiOnline, setApiOnline] = useState<boolean>(true);

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(`${apiUrl}/health`);
        setApiOnline(res.ok);
      } catch {
        setApiOnline(false);
      }
    }
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return '#7c3aed';
      case 'finance_director':
        return '#0284c7';
      case 'dept_manager':
        return '#d97706';
      case 'team_lead':
      case 'approver':
        return '#059669';
      case 'requester':
      default:
        return '#2563eb';
    }
  };

  return (
    <header
      style={{
        backgroundColor: '#090d16',
        color: '#f8fafc',
        borderBottom: '1px solid #1e293b',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.25)',
      }}
    >
      <div
        style={{
          maxWidth: '1360px',
          margin: '0 auto',
          padding: '0 24px',
          minHeight: '70px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        {/* Brand & Main Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px', flexWrap: 'wrap' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '19px',
                boxShadow: '0 0 15px rgba(59, 130, 246, 0.4)',
              }}
            >
              W
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '16px', letterSpacing: '-0.02em', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Workflow Engine
                <span
                  title={apiOnline ? 'Backend API Online' : 'Backend API Offline'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '9999px',
                    backgroundColor: apiOnline ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: apiOnline ? '#34d399' : '#f87171',
                    border: `1px solid ${apiOnline ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  }}
                >
                  <span
                    style={{
                      width: '5px',
                      height: '5px',
                      borderRadius: '50%',
                      backgroundColor: apiOnline ? '#10b981' : '#ef4444',
                    }}
                  />
                  {apiOnline ? 'API LIVE' : 'OFFLINE'}
                </span>
                <span
                  title={sseConnected ? 'Server-Sent Events Live Stream Connected' : 'Reconnecting to SSE Stream...'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '9999px',
                    backgroundColor: sseConnected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                    color: sseConnected ? '#60a5fa' : '#fbbf24',
                    border: `1px solid ${sseConnected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                  }}
                >
                  <Radio size={9} className={sseConnected ? 'animate-pulse' : ''} />
                  {sseConnected ? 'SSE LIVE' : 'CONNECTING'}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Event-Driven Microservices Platform</div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <NavLink
              to="/expenses"
              data-testid="nav-expenses-link"
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                color: isActive ? '#ffffff' : '#94a3b8',
                backgroundColor: isActive ? '#1e293b' : 'transparent',
                border: isActive ? '1px solid #334155' : '1px solid transparent',
                transition: 'all 0.15s ease',
              })}
            >
              <Layers size={15} />
              Expenses
            </NavLink>

            <NavLink
              to="/approvals"
              data-testid="nav-approvals-link"
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                color: isActive ? '#ffffff' : '#94a3b8',
                backgroundColor: isActive ? '#1e293b' : 'transparent',
                border: isActive ? '1px solid #334155' : '1px solid transparent',
                transition: 'all 0.15s ease',
              })}
            >
              <CheckSquare size={15} />
              Approvals Inbox
            </NavLink>

            <NavLink
              to="/audit"
              data-testid="nav-audit-link"
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                color: isActive ? '#ffffff' : '#94a3b8',
                backgroundColor: isActive ? '#1e293b' : 'transparent',
                border: isActive ? '1px solid #334155' : '1px solid transparent',
                transition: 'all 0.15s ease',
              })}
            >
              <Shield size={15} />
              Audit Ledger
            </NavLink>

            <NavLink
              to="/notifications"
              data-testid="nav-notifications-link"
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                color: isActive ? '#ffffff' : '#94a3b8',
                backgroundColor: isActive ? '#1e293b' : 'transparent',
                border: isActive ? '1px solid #334155' : '1px solid transparent',
                position: 'relative',
                transition: 'all 0.15s ease',
              })}
            >
              <Bell size={15} />
              Notifications
              {unreadCount > 0 && (
                <span
                  style={{
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '1px 6px',
                    borderRadius: '9999px',
                    marginLeft: '4px',
                    boxShadow: '0 0 10px rgba(239, 68, 68, 0.5)',
                  }}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          </nav>
        </div>

        {/* Multi-Tenant Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Tenant Switcher */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#131c2e',
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid #1e293b',
            }}
          >
            <Building2 size={15} color="#60a5fa" />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                Active Tenant
              </span>
              <select
                data-testid="tenant-selector"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                style={{
                  backgroundColor: 'transparent',
                  color: '#f8fafc',
                  border: 'none',
                  outline: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {PRESET_TENANTS.map((t) => (
                  <option key={t.id} value={t.id} style={{ backgroundColor: '#0f172a' }}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* User / Persona Switcher */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              backgroundColor: '#131c2e',
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid #1e293b',
            }}
          >
            <UserCircle2 size={16} color="#94a3b8" />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                Active Persona
              </span>
              <select
                data-testid="user-selector"
                value={currentUser.id}
                onChange={(e) => {
                  const user = PRESET_USERS.find((u) => u.id === e.target.value);
                  if (user) setCurrentUser(user);
                }}
                style={{
                  backgroundColor: 'transparent',
                  color: '#f8fafc',
                  border: 'none',
                  outline: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {PRESET_USERS.map((u) => (
                  <option key={u.id} value={u.id} style={{ backgroundColor: '#0f172a' }}>
                    {u.name} — {u.title}
                  </option>
                ))}
              </select>
            </div>

            <span
              data-testid="user-role-badge"
              data-role={currentUser.role}
              style={{
                fontSize: '10px',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '6px',
                backgroundColor: getRoleBadgeColor(currentUser.role),
                color: '#ffffff',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {currentUser.role.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
