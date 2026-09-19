import { v4 as uuidv4 } from 'uuid';
import { eq, and, lte, gte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { delegations, DelegationRecord } from '../db/schema.js';
import { Delegation, CreateDelegationDTO } from '@workflow/shared-types';

export class DelegationService {
  async createDelegation(
    tenantId: string,
    dto: CreateDelegationDTO
  ): Promise<Delegation> {
    const id = uuidv4();
    const now = new Date();

    const record = {
      id,
      tenantId,
      delegatorId: dto.delegatorId,
      delegateeId: dto.delegateeId,
      validFrom: new Date(dto.validFrom),
      validUntil: new Date(dto.validUntil),
      reason: dto.reason || null,
      active: true,
      createdAt: now,
    };

    await db.insert(delegations).values(record as any);

    return this.mapRecordToDelegation(record);
  }

  async isAuthorizedApprover(
    tenantId: string,
    actorId: string,
    targetApproverId?: string | null
  ): Promise<{ authorized: boolean; isDelegated: boolean; delegatedFrom?: string }> {
    // If no specific approver is required or actor is the direct approver
    if (!targetApproverId || actorId === targetApproverId) {
      return { authorized: true, isDelegated: false };
    }

    const now = new Date();

    // Check for active, valid delegation
    const activeDelegations = await db
      .select()
      .from(delegations)
      .where(
        and(
          eq(delegations.tenantId, tenantId),
          eq(delegations.delegatorId, targetApproverId),
          eq(delegations.delegateeId, actorId),
          eq(delegations.active, true),
          lte(delegations.validFrom, now),
          gte(delegations.validUntil, now)
        )
      )
      .limit(1);

    if (activeDelegations.length > 0) {
      return { authorized: true, isDelegated: true, delegatedFrom: targetApproverId };
    }

    return { authorized: false, isDelegated: false };
  }

  async listDelegations(tenantId: string, delegatorId?: string): Promise<Delegation[]> {
    const conditions = [eq(delegations.tenantId, tenantId)];
    if (delegatorId) {
      conditions.push(eq(delegations.delegatorId, delegatorId));
    }

    const records = await db
      .select()
      .from(delegations)
      .where(and(...conditions));

    return records.map(this.mapRecordToDelegation);
  }

  private mapRecordToDelegation(record: any): Delegation {
    return {
      id: record.id,
      tenantId: record.tenantId || record.tenant_id,
      delegatorId: record.delegatorId || record.delegator_id,
      delegateeId: record.delegateeId || record.delegatee_id,
      validFrom: record.validFrom instanceof Date ? record.validFrom.toISOString() : record.valid_from,
      validUntil: record.validUntil instanceof Date ? record.validUntil.toISOString() : record.valid_until,
      reason: record.reason || undefined,
      active: record.active,
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.created_at,
    };
  }
}

export const delegationService = new DelegationService();
