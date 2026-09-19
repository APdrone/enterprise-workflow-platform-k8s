import { describe, it, expect } from 'vitest';
import { validateEvent } from '../../packages/shared-schemas/src/validator.js';
import { buildWorkflowEvent } from '../../packages/test-utils/src/factories/event.factory.js';

describe('Kafka Event Schema Validation & Compatibility Tests', () => {
  it('validates a correct workflow.submitted.v1 event payload', () => {
    const event = buildWorkflowEvent('workflow.submitted.v1');
    const result = validateEvent('workflow.submitted.v1', event);

    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('validates a correct workflow.approved.v1 event payload', () => {
    const event = buildWorkflowEvent('workflow.approved.v1');
    const result = validateEvent('workflow.approved.v1', event);

    expect(result.valid).toBe(true);
  });

  it('validates a correct workflow.rejected.v1 event payload with rejectionReason', () => {
    const event = buildWorkflowEvent('workflow.rejected.v1', {
      rejectionReason: 'Exceeds department quarterly budget ceiling',
    });
    const result = validateEvent('workflow.rejected.v1', event);

    expect(result.valid).toBe(true);
  });

  it('fails validation when mandatory CloudEvent envelope fields are missing', () => {
    const event: any = buildWorkflowEvent('workflow.submitted.v1');
    delete event.specversion; // Missing CloudEvents specversion

    const result = validateEvent('workflow.submitted.v1', event);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]).toContain('must have required property');
  });

  it('fails validation when mandatory workflow data fields are missing', () => {
    const event: any = buildWorkflowEvent('workflow.submitted.v1');
    delete event.data.tenantId; // Missing tenantId

    const result = validateEvent('workflow.submitted.v1', event);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('maintains backward compatibility: allows optional metadata payload extensions', () => {
    const event = buildWorkflowEvent('workflow.submitted.v1', {
      metadata: {
        costCenter: 'CC-908',
        projectCode: 'PROJ-ALPHA',
        customTag: 12345,
      },
    });

    const result = validateEvent('workflow.submitted.v1', event);
    expect(result.valid).toBe(true);
  });
});
