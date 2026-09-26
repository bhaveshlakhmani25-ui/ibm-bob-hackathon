/**
 * Change Rehearsal — R08 RepairRequest / RepairPlan Validation
 *
 * Validates R08 domain objects.
 * Returns a ValidationResult (valid/errors) — never throws.
 *
 * Follows the same pattern as behavior/validation.ts and scenario/validation.ts.
 *
 * Owner: Reuben (engine)
 * Phase: R08
 */

import type {
  RepairRequest,
  RepairPlan,
  RepairAction,
  RehearsalRerunResult,
  RepairStatus,
  RepairActionOperation,
  RerunOutcome,
} from './model.js';
import { VALID_REPAIR_STATUSES, VALID_REPAIR_ACTION_OPERATIONS, VALID_RERUN_OUTCOMES } from './model.js';

// ---------------------------------------------------------------------------
// ValidationResult
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// RepairRequest validation
// ---------------------------------------------------------------------------

/**
 * Validate a RepairRequest object.
 *
 * Checks:
 *   - requestId is a non-empty string
 *   - rehearsalRunId is a non-empty string
 *   - differenceId is a non-empty string
 *   - scenarioId is a non-empty string
 *   - originalVerdict is a valid ComparisonVerdict
 *   - reason is a non-empty string
 *   - detail is a non-empty string
 *   - createdAt is a non-empty string
 */
export function validateRepairRequest(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['RepairRequest must be a plain object'] };
  }

  const r = value as Record<string, unknown>;

  if (typeof r['requestId'] !== 'string' || r['requestId'].trim() === '') {
    errors.push('requestId must be a non-empty string');
  }
  if (typeof r['rehearsalRunId'] !== 'string' || r['rehearsalRunId'].trim() === '') {
    errors.push('rehearsalRunId must be a non-empty string');
  }
  if (typeof r['differenceId'] !== 'string' || r['differenceId'].trim() === '') {
    errors.push('differenceId must be a non-empty string');
  }
  if (typeof r['scenarioId'] !== 'string' || r['scenarioId'].trim() === '') {
    errors.push('scenarioId must be a non-empty string');
  }
  if (typeof r['reason'] !== 'string' || r['reason'].trim() === '') {
    errors.push('reason must be a non-empty string');
  }
  if (typeof r['detail'] !== 'string' || r['detail'].trim() === '') {
    errors.push('detail must be a non-empty string');
  }
  if (typeof r['createdAt'] !== 'string' || r['createdAt'].trim() === '') {
    errors.push('createdAt must be a non-empty string');
  }

  const validVerdicts = new Set([
    'PRESERVED', 'INTENTIONAL_CHANGE', 'REGRESSION',
    'POTENTIAL_DIFFERENCE', 'INCONCLUSIVE',
  ]);
  if (typeof r['originalVerdict'] !== 'string' || !validVerdicts.has(r['originalVerdict'] as string)) {
    errors.push(`originalVerdict must be one of: ${[...validVerdicts].join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// RepairAction validation
// ---------------------------------------------------------------------------

/**
 * Validate a RepairAction object.
 */
export function validateRepairAction(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['RepairAction must be a plain object'] };
  }

  const a = value as Record<string, unknown>;

  if (typeof a['actionId'] !== 'string' || a['actionId'].trim() === '') {
    errors.push('actionId must be a non-empty string');
  }
  if (typeof a['sequence'] !== 'number' || !Number.isInteger(a['sequence']) || (a['sequence'] as number) < 1) {
    errors.push('sequence must be a positive integer');
  }
  if (
    typeof a['operation'] !== 'string' ||
    !VALID_REPAIR_ACTION_OPERATIONS.has(a['operation'] as RepairActionOperation)
  ) {
    errors.push(`operation must be one of: ${[...VALID_REPAIR_ACTION_OPERATIONS].join(', ')}`);
  }
  if (typeof a['description'] !== 'string' || a['description'].trim() === '') {
    errors.push('description must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// RepairPlan validation
// ---------------------------------------------------------------------------

/**
 * Validate a RepairPlan object.
 */
export function validateRepairPlan(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['RepairPlan must be a plain object'] };
  }

  const p = value as Record<string, unknown>;

  if (typeof p['repairPlanId'] !== 'string' || p['repairPlanId'].trim() === '') {
    errors.push('repairPlanId must be a non-empty string');
  }
  if (typeof p['requestId'] !== 'string' || p['requestId'].trim() === '') {
    errors.push('requestId must be a non-empty string');
  }
  if (typeof p['targetDifferenceId'] !== 'string' || p['targetDifferenceId'].trim() === '') {
    errors.push('targetDifferenceId must be a non-empty string');
  }
  if (!Array.isArray(p['actions'])) {
    errors.push('actions must be an array');
  } else {
    for (let i = 0; i < (p['actions'] as unknown[]).length; i++) {
      const actionResult = validateRepairAction((p['actions'] as unknown[])[i]);
      if (!actionResult.valid) {
        errors.push(...actionResult.errors.map((e) => `actions[${i}]: ${e}`));
      }
    }
  }
  if (typeof p['rationale'] !== 'string' || p['rationale'].trim() === '') {
    errors.push('rationale must be a non-empty string');
  }
  if (
    typeof p['status'] !== 'string' ||
    !VALID_REPAIR_STATUSES.has(p['status'] as RepairStatus)
  ) {
    errors.push(`status must be one of: ${[...VALID_REPAIR_STATUSES].join(', ')}`);
  }
  if (typeof p['createdAt'] !== 'string' || p['createdAt'].trim() === '') {
    errors.push('createdAt must be a non-empty string');
  }
  if (typeof p['updatedAt'] !== 'string' || p['updatedAt'].trim() === '') {
    errors.push('updatedAt must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// RehearsalRerunResult validation
// ---------------------------------------------------------------------------

/**
 * Validate a RehearsalRerunResult object.
 */
export function validateRerunResult(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['RehearsalRerunResult must be a plain object'] };
  }

  const r = value as Record<string, unknown>;

  if (typeof r['rerunId'] !== 'string' || r['rerunId'].trim() === '') {
    errors.push('rerunId must be a non-empty string');
  }
  if (typeof r['repairPlanId'] !== 'string' || r['repairPlanId'].trim() === '') {
    errors.push('repairPlanId must be a non-empty string');
  }
  if (typeof r['requestId'] !== 'string' || r['requestId'].trim() === '') {
    errors.push('requestId must be a non-empty string');
  }
  if (typeof r['originalDifferenceId'] !== 'string' || r['originalDifferenceId'].trim() === '') {
    errors.push('originalDifferenceId must be a non-empty string');
  }
  if (typeof r['scenarioId'] !== 'string' || r['scenarioId'].trim() === '') {
    errors.push('scenarioId must be a non-empty string');
  }
  if (
    typeof r['outcome'] !== 'string' ||
    !VALID_RERUN_OUTCOMES.has(r['outcome'] as RerunOutcome)
  ) {
    errors.push(`outcome must be one of: ${[...VALID_RERUN_OUTCOMES].join(', ')}`);
  }
  if (typeof r['outcomeDetail'] !== 'string' || r['outcomeDetail'].trim() === '') {
    errors.push('outcomeDetail must be a non-empty string');
  }
  if (typeof r['rerunAt'] !== 'string' || r['rerunAt'].trim() === '') {
    errors.push('rerunAt must be a non-empty string');
  }

  const validVerdicts = new Set([
    'PRESERVED', 'INTENTIONAL_CHANGE', 'REGRESSION',
    'POTENTIAL_DIFFERENCE', 'INCONCLUSIVE',
  ]);
  if (
    typeof r['originalVerdict'] !== 'string' ||
    !validVerdicts.has(r['originalVerdict'] as string)
  ) {
    errors.push(`originalVerdict must be one of: ${[...validVerdicts].join(', ')}`);
  }

  if (
    r['newVerdict'] !== undefined &&
    (typeof r['newVerdict'] !== 'string' || !validVerdicts.has(r['newVerdict'] as string))
  ) {
    errors.push(`newVerdict must be one of: ${[...validVerdicts].join(', ')}`);
  }

  if (
    r['scenarioPlanRef'] === null ||
    typeof r['scenarioPlanRef'] !== 'object' ||
    Array.isArray(r['scenarioPlanRef'])
  ) {
    errors.push('scenarioPlanRef must be a plain object');
  } else {
    const ref = r['scenarioPlanRef'] as Record<string, unknown>;
    if (typeof ref['id'] !== 'string' || ref['id'].trim() === '') {
      errors.push('scenarioPlanRef.id must be a non-empty string');
    }
    if (typeof ref['name'] !== 'string' || ref['name'].trim() === '') {
      errors.push('scenarioPlanRef.name must be a non-empty string');
    }
    if (typeof ref['seedDataRef'] !== 'string' || ref['seedDataRef'].trim() === '') {
      errors.push('scenarioPlanRef.seedDataRef must be a non-empty string');
    }
  }

  return { valid: errors.length === 0, errors };
}
