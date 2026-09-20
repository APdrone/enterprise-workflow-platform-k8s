import { pgTable, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

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

export const dlqMessages = pgTable('dlq_messages', {
  id: text('id').primaryKey(),
  originalTopic: text('original_topic').notNull(),
  originalKey: text('original_key'),
  payload: jsonb('payload').notNull(),
  errorType: text('error_type').notNull(),
  errorMessage: text('error_message').notNull(),
  retryCount: integer('retry_count').notNull().default(0),
  tenantId: text('tenant_id'),
  workflowId: text('workflow_id'),
  headers: jsonb('headers'),
  status: text('status').notNull().default('DEAD_LETTERED'),
  failedAt: timestamp('failed_at', { withTimezone: true }).notNull(),
  replayedAt: timestamp('replayed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditEventRecord = typeof auditEvents.$inferSelect;
export type InsertAuditEventRecord = typeof auditEvents.$inferInsert;
export type DLQMessageRecord = typeof dlqMessages.$inferSelect;
export type InsertDLQMessageRecord = typeof dlqMessages.$inferInsert;

