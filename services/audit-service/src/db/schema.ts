import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  eventType: text('event_type').notNull(),
  actorId: text('actor_id').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditEventRecord = typeof auditEvents.$inferSelect;
export type InsertAuditEventRecord = typeof auditEvents.$inferInsert;
