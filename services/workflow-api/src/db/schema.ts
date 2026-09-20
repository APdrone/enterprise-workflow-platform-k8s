import { pgTable, text, timestamp, numeric, jsonb, pgEnum, integer, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

export const workflowStatusEnum = pgEnum('workflow_status', [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);

export const workflowTypeEnum = pgEnum('workflow_type', [
  'EXPENSE',
  'LEAVE',
  'PURCHASE_ORDER',
  'GENERIC',
]);

export const workflows = pgTable('workflows', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  type: text('type').notNull().default('EXPENSE'),
  title: text('title').notNull(),
  description: text('description'),
  amount: numeric('amount', { precision: 12, scale: 2 }),
  currency: text('currency').default('USD'),
  requesterId: text('requester_id').notNull(),
  requesterName: text('requester_name').notNull(),
  status: text('status').notNull().default('DRAFT'),
  approverId: text('approver_id'),
  currentStepOrder: integer('current_step_order').notNull().default(1),
  totalSteps: integer('total_steps').notNull().default(1),
  rejectionReason: text('rejection_reason'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowSteps = pgTable('workflow_steps', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  stepOrder: integer('step_order').notNull().default(1),
  stepRole: text('step_role').notNull().default('GENERAL_APPROVER'),
  approverId: text('approver_id'),
  status: text('status').notNull().default('PENDING'),
  policy: text('policy').notNull().default('ALL_MUST_APPROVE'), // 'ALL_MUST_APPROVE' | 'ANY_CAN_APPROVE'
  parallelGroup: text('parallel_group'),
  actedBy: text('acted_by'),
  actedAt: timestamp('acted_at', { withTimezone: true }),
  delegatedFrom: text('delegated_from'),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowRules = pgTable('workflow_rules', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  workflowType: text('workflow_type').notNull().default('EXPENSE'),
  name: text('name').notNull(),
  description: text('description'),
  minAmount: numeric('min_amount', { precision: 12, scale: 2 }),
  maxAmount: numeric('max_amount', { precision: 12, scale: 2 }),
  department: text('department'),
  priority: integer('priority').notNull().default(0),
  steps: jsonb('steps').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const delegations = pgTable('delegations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  delegatorId: text('delegator_id').notNull(),
  delegateeId: text('delegatee_id').notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
  validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
  reason: text('reason'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  key: text('key').notNull(),
  statusCode: integer('status_code'),
  responseBody: jsonb('response_body'),
  status: text('status').notNull().default('PROCESSING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  workflowId: text('workflow_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  published: boolean('published').notNull().default(false),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkflowRecord = typeof workflows.$inferSelect;
export type InsertWorkflowRecord = typeof workflows.$inferInsert;
export type WorkflowStepRecord = typeof workflowSteps.$inferSelect;
export type InsertWorkflowStepRecord = typeof workflowSteps.$inferInsert;
export type WorkflowRuleRecord = typeof workflowRules.$inferSelect;
export type InsertWorkflowRuleRecord = typeof workflowRules.$inferInsert;
export type DelegationRecord = typeof delegations.$inferSelect;
export type IdempotencyRecord = typeof idempotencyKeys.$inferSelect;
export type OutboxEventRecord = typeof outboxEvents.$inferSelect;
