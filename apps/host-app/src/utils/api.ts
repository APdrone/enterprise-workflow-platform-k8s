import { tracedFetch, createTracedHeaders, generateTraceparent, generateCorrelationId } from '@workflow/telemetry/client';

export { tracedFetch, createTracedHeaders, generateTraceparent, generateCorrelationId };

/**
 * Standard headers builder for host-app with W3C traceparent & tenant headers
 */
export function buildAuthHeaders(
  tenantId: string,
  user?: { id: string; name: string; role?: string },
  customHeaders: Record<string, string> = {}
): Record<string, string> {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    ...customHeaders,
  };

  if (user) {
    base['x-user-id'] = user.id;
    base['x-user-name'] = user.name;
  }

  return createTracedHeaders(base, { tenantId });
}
