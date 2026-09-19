export function createTestTenantId(prefix: string = 'tenant'): string {
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${rand}`;
}

export function createTestUserId(role: 'requester' | 'approver' | 'admin' = 'requester'): string {
  const rand = Math.random().toString(36).substring(2, 8);
  return `user-${role}-${rand}`;
}
