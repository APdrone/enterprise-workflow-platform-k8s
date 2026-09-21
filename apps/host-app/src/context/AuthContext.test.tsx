import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth, PRESET_USERS, PRESET_TENANTS } from './AuthContext.js';

const TestConsumer: React.FC = () => {
  const { tenantId, setTenantId, currentUser, setCurrentUser } = useAuth();
  return (
    <div>
      <span data-testid="current-tenant">{tenantId}</span>
      <span data-testid="current-user">{currentUser.name}</span>
      <button
        data-testid="switch-tenant-btn"
        onClick={() => setTenantId('tenant-corp-b')}
      >
        Switch Tenant
      </button>
      <button
        data-testid="switch-user-btn"
        onClick={() => setCurrentUser(PRESET_USERS[1])}
      >
        Switch User
      </button>
    </div>
  );
};

describe('AuthContext & Multi-Tenant Context Provider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('provides default tenant (corp-a) and default user (Alice Johnson)', () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('current-tenant')).toHaveTextContent('tenant-corp-a');
    expect(screen.getByTestId('current-user')).toHaveTextContent('Alice Johnson');
  });

  it('switches tenant and persists selection to localStorage', () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    fireEvent.click(screen.getByTestId('switch-tenant-btn'));

    expect(screen.getByTestId('current-tenant')).toHaveTextContent('tenant-corp-b');
    expect(localStorage.getItem('workflow_tenant_id')).toBe('tenant-corp-b');
  });

  it('switches user persona and persists selection to localStorage', () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    fireEvent.click(screen.getByTestId('switch-user-btn'));

    expect(screen.getByTestId('current-user')).toHaveTextContent('Bob Smith');
    expect(localStorage.getItem('workflow_user_id')).toBe('user-bob');
  });
});
