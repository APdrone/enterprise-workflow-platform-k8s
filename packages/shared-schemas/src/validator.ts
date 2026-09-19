import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import workflowSubmittedSchema from './schemas/workflow.submitted.v1.json' with { type: 'json' };
import workflowApprovedSchema from './schemas/workflow.approved.v1.json' with { type: 'json' };
import workflowStepApprovedSchema from './schemas/workflow.step_approved.v1.json' with { type: 'json' };
import workflowRejectedSchema from './schemas/workflow.rejected.v1.json' with { type: 'json' };
import workflowCancelledSchema from './schemas/workflow.cancelled.v1.json' with { type: 'json' };
import auditEventSchema from './schemas/audit.event.v1.json' with { type: 'json' };

const ajv = new (Ajv as any)({
  allErrors: true,
  strict: false,
});
(addFormats as any)(ajv);

const schemas: Record<string, object> = {
  'workflow.submitted.v1': workflowSubmittedSchema,
  'workflow.approved.v1': workflowApprovedSchema,
  'workflow.step_approved.v1': workflowStepApprovedSchema,
  'workflow.rejected.v1': workflowRejectedSchema,
  'workflow.cancelled.v1': workflowCancelledSchema,
  'audit.event.v1': auditEventSchema,
};

const validators: Record<string, ValidateFunction> = {};

for (const [key, schema] of Object.entries(schemas)) {
  validators[key] = ajv.compile(schema);
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateEvent(eventType: string, data: unknown): ValidationResult {
  const validator = validators[eventType];
  if (!validator) {
    return {
      valid: false,
      errors: [`No schema registered for event type: ${eventType}`],
    };
  }

  const valid = validator(data);
  if (!valid) {
    return {
      valid: false,
      errors: validator.errors?.map((err: any) => `${err.instancePath} ${err.message}`) || ['Unknown validation error'],
    };
  }

  return { valid: true };
}

export {
  workflowSubmittedSchema,
  workflowApprovedSchema,
  workflowStepApprovedSchema,
  workflowRejectedSchema,
  workflowCancelledSchema,
  auditEventSchema,
  schemas,
  ajv,
};
