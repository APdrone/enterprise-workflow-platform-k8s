import React, { createContext, useContext, useState, useEffect } from 'react';

export type UserRole =
  | 'requester'
  | 'team_lead'
  | 'dept_manager'
  | 'finance_director'
  | 'approver'
  | 'admin';

export interface UserProfile {
  id: string;
  name: string;
  role: UserRole;
  title: string;
}

export interface TenantInfo {
  id: string;
  name: string;
}

export const PRESET_TENANTS: TenantInfo[] = [
  { id: 'tenant-corp-a', name: 'Tokyo Holdings (Tenant A)' },
  { id: 'tenant-corp-b', name: 'Kyoto Robotics (Tenant B)' },
  { id: 'tenant-corp-c', name: 'Nagoya Logistics (Tenant C)' },
];

export const PRESET_USERS: UserProfile[] = [
  { id: 'user-alice', name: 'Alice Johnson', role: 'requester', title: 'Requester (Employee)' },
  { id: 'user-bob', name: 'Bob Smith', role: 'team_lead', title: 'Team Lead (Step 1 Approver)' },
  { id: 'user-carol', name: 'Carol White', role: 'dept_manager', title: 'Dept Manager (Step 2 Approver)' },
  { id: 'user-diana', name: 'Diana Prince', role: 'finance_director', title: 'Finance Director (Step 3 Approver)' },
  { id: 'user-admin', name: 'Admin User', role: 'admin', title: 'Super Admin (All Steps)' },
];

interface AuthContextType {
  tenantId: string;
  setTenantId: (id: string) => void;
  currentUser: UserProfile;
  setCurrentUser: (user: UserProfile) => void;
  apiUrl: string;
  auditApiUrl: string;
  notificationApiUrl: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenantId, setTenantIdState] = useState<string>(() => {
    return localStorage.getItem('workflow_tenant_id') || 'tenant-corp-a';
  });

  const [currentUser, setCurrentUserState] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('workflow_user_id');
    const matched = PRESET_USERS.find((u) => u.id === saved);
    return matched || PRESET_USERS[0];
  });

  const apiUrl = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000';
  const notificationApiUrl = (import.meta as any).env?.VITE_NOTIF_API_URL || 'http://localhost:3001';
  const auditApiUrl = (import.meta as any).env?.VITE_AUDIT_API_URL || 'http://localhost:3002';

  const setTenantId = (id: string) => {
    setTenantIdState(id);
    localStorage.setItem('workflow_tenant_id', id);
  };

  const setCurrentUser = (user: UserProfile) => {
    setCurrentUserState(user);
    localStorage.setItem('workflow_user_id', user.id);
  };

  return (
    <AuthContext.Provider
      value={{
        tenantId,
        setTenantId,
        currentUser,
        setCurrentUser,
        apiUrl,
        auditApiUrl,
        notificationApiUrl,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
