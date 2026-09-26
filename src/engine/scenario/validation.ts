/**
 * Change Rehearsal — Scenario Domain Validation (R04)
 *
 * Pure, deterministic validation functions for the scenario domain model.
 * No side effects, no I/O, no randomness.
 *
 * Validation rules:
 * - Required fields must be non-empty strings (or non-empty arrays where applicable)
 * - Confidence values must be one of the four valid ConfidenceLevel literals
 * - Step sequences must be 1-based and contiguous (no gaps, no duplicates)
 * - Step IDs must be unique within a plan
 * - Traceability must be present with a non-empty sourceJourneyId
 * - Preconditions array must be present (may be empty)
 * - Steps array must be non-empty
 * - seedDataRef must be a non-empty string
 * - deterministic must be true
 *
 * All functions return ValidationResult rather than throwing, so callers can
 * decide whether to collect or immediately surface errors.
 * The generator uses these to throw EngineError on invalid state.
 *
 * Owner: Reuben (engine)
 * Phase: R04
 */

import type {
  ScenarioPlan,
  ScenarioPlanStep,
  ScenarioPlanStepKind,
  ScenarioPrecondition,
  ScenarioTraceability,
} from './model.js';
import { VALID_CONFIDENCE_LEVELS } from '../behavior/validation.js';

// Re-export ValidationResult from behavior/validation so callers have a single import.
export type { ValidationResult } from '../behavior/validation.js';
import type { ValidationResult } from '../behavior/validation.js';

// ---------------------------------------------------------------------------
// Allowed value sets
// ---------------------------------------------------------------------------

export const VALID_STEP_PLAN_KINDS: ReadonlySet<ScenarioPlanStepKind> = new Set([
  'http',
  'auth',
  'db',
  'ui',
  'service_call',
  'state_transition',
  'function',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(errors: string[]): ValidationResult {
  return { valid: false, errors };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Traceability validation
// ---------------------------------------------------------------------------

export function validateTraceability(
  traceability: unknown,
  context: string,
): ValidationResult {
  if (traceability === null || typeof traceability !== 'object') {
    return fail([`${context}.traceability must be an object`]);
  }

  const t = traceability as Record<string, unknown>;
  const errors: string[] = [];

  if (!isNonEmptyString(t['sourceJourneyId'])) {
    errors.push(`${context}.traceability.sourceJourneyId must be a non-empty string`);
  }

  if (!isNonEmptyString(t['sourceJourneyName'])) {
    errors.push(`${context}.traceability.sourceJourneyName must be a non-empty string`);
  }

  if (!Array.isArray(t['sourceBehaviorIds'])) {
    errors.push(`${context}.traceability.sourceBehaviorIds must be an array`);
  } else {
    for (let i = 0; i < (t['sourceBehaviorIds'] as unknown[]).length; i++) {
      if (!isNonEmptyString((t['sourceBehaviorIds'] as unknown[])[i])) {
        errors.push(`${context}.traceability.sourceBehaviorIds[${i}] must be a non-empty string`);
      }
    }
  }

  if (!Array.isArray(t['sourceStepIds'])) {
    errors.push(`${context}.traceability.sourceStepIds must be an array`);
  } else {
    for (let i = 0; i < (t['sourceStepIds'] as unknown[]).length; i++) {
      if (!isNonEmptyString((t['sourceStepIds'] as unknown[])[i])) {
        errors.push(`${context}.traceability.sourceStepIds[${i}] must be a non-empty string`);
      }
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// Precondition validation
// ---------------------------------------------------------------------------

export function validatePrecondition(
  precondition: unknown,
  context: string,
): ValidationResult {
  if (precondition === null || typeof precondition !== 'object') {
    return fail([`${context} must be an object`]);
  }

  const p = precondition as Record<string, unknown>;
  const errors: string[] = [];

  if (!isNonEmptyString(p['description'])) {
    errors.push(`${context}.description must be a non-empty string`);
  }

  if (p['seedDataRef'] !== undefined && !isNonEmptyString(p['seedDataRef'])) {
    errors.push(`${context}.seedDataRef must be a non-empty string when present`);
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// ScenarioPlanStep validation
// ---------------------------------------------------------------------------

export function validateScenarioPlanStep(
  step: unknown,
  context: string,
): ValidationResult {
  if (step === null || typeof step !== 'object') {
    return fail([`${context} must be an object`]);
  }

  const s = step as Record<string, unknown>;
  const errors: string[] = [];

  if (!isNonEmptyString(s['id'])) {
    errors.push(`${context}.id must be a non-empty string`);
  }

  if (
    typeof s['sequence'] !== 'number' ||
    !Number.isInteger(s['sequence']) ||
    s['sequence'] < 1
  ) {
    errors.push(`${context}.sequence must be a positive integer (1-based)`);
  }

  if (!isNonEmptyString(s['kind'])) {
    errors.push(`${context}.kind must be a non-empty string`);
  } else if (!VALID_STEP_PLAN_KINDS.has(s['kind'] as ScenarioPlanStepKind)) {
    errors.push(
      `${context}.kind "${s['kind']}" is not a valid ScenarioPlanStepKind ` +
      `(must be one of: ${[...VALID_STEP_PLAN_KINDS].join(', ')})`,
    );
  }

  if (!isNonEmptyString(s['description'])) {
    errors.push(`${context}.description must be a non-empty string`);
  }

  if (
    s['input'] !== undefined &&
    (typeof s['input'] !== 'object' || s['input'] === null || Array.isArray(s['input']))
  ) {
    errors.push(`${context}.input must be a plain object when present`);
  }

  if (!isNonEmptyString(s['sourceStepId'])) {
    errors.push(`${context}.sourceStepId must be a non-empty string`);
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// ScenarioPlan validation
// ---------------------------------------------------------------------------

export function validateScenarioPlan(plan: unknown): ValidationResult {
  if (plan === null || typeof plan !== 'object') {
    return fail(['scenarioPlan must be an object']);
  }

  const p = plan as Record<string, unknown>;
  const errors: string[] = [];
  const ctx = `scenarioPlan "${p['id'] ?? '(no id)'}"`;

  if (!isNonEmptyString(p['id'])) {
    errors.push(`${ctx}.id must be a non-empty string`);
  }

  if (!isNonEmptyString(p['name'])) {
    errors.push(`${ctx}.name must be a non-empty string`);
  }

  if (!isNonEmptyString(p['description'])) {
    errors.push(`${ctx}.description must be a non-empty string`);
  }

  if (!isNonEmptyString(p['confidence'])) {
    errors.push(`${ctx}.confidence must be a non-empty string`);
  } else if (!VALID_CONFIDENCE_LEVELS.has(p['confidence'] as ScenarioPlan['confidence'])) {
    errors.push(
      `${ctx}.confidence "${p['confidence']}" is not a valid ConfidenceLevel ` +
      `(must be one of: ${[...VALID_CONFIDENCE_LEVELS].join(', ')})`,
    );
  }

  if (!isNonEmptyString(p['seedDataRef'])) {
    errors.push(`${ctx}.seedDataRef must be a non-empty string`);
  }

  if (p['deterministic'] !== true) {
    errors.push(`${ctx}.deterministic must be true`);
  }

  // Validate traceability
  const traceResult = validateTraceability(p['traceability'], ctx);
  errors.push(...traceResult.errors);

  // Validate provenance
  if (p['provenance'] === null || typeof p['provenance'] !== 'object') {
    errors.push(`${ctx}.provenance must be an object`);
  } else {
    const prov = p['provenance'] as Record<string, unknown>;
    if (!isNonEmptyString(prov['confidence'])) {
      errors.push(`${ctx}.provenance.confidence must be a non-empty string`);
    } else if (!VALID_CONFIDENCE_LEVELS.has(prov['confidence'] as ScenarioPlan['confidence'])) {
      errors.push(`${ctx}.provenance.confidence "${prov['confidence']}" is not a valid ConfidenceLevel`);
    }
  }

  // Validate preconditions
  if (!Array.isArray(p['preconditions'])) {
    errors.push(`${ctx}.preconditions must be an array`);
  } else {
    for (let i = 0; i < (p['preconditions'] as unknown[]).length; i++) {
      const result = validatePrecondition((p['preconditions'] as unknown[])[i], `${ctx}.preconditions[${i}]`);
      errors.push(...result.errors);
    }
  }

  // Validate steps
  if (!Array.isArray(p['steps']) || (p['steps'] as unknown[]).length === 0) {
    errors.push(`${ctx}.steps must be a non-empty array`);
  } else {
    const steps = p['steps'] as unknown[];

    for (let i = 0; i < steps.length; i++) {
      const result = validateScenarioPlanStep(steps[i], `${ctx}.steps[${i}]`);
      errors.push(...result.errors);
    }

    // Check sequences are 1-based and contiguous
    const validSteps = steps.filter(
      (s): s is ScenarioPlanStep =>
        s !== null &&
        typeof s === 'object' &&
        typeof (s as Record<string, unknown>)['sequence'] === 'number',
    );
    const sequences = validSteps.map((s) => s.sequence).sort((a, b) => a - b);
    for (let i = 0; i < sequences.length; i++) {
      if (sequences[i] !== i + 1) {
        errors.push(
          `${ctx}.steps sequences must be 1-based and contiguous (found: [${sequences.join(', ')}])`,
        );
        break;
      }
    }

    // Check for duplicate step IDs
    const stepIds = validSteps
      .map((s) => (s as unknown as Record<string, unknown>)['id'])
      .filter(isNonEmptyString);
    const seenStepIds = new Set<string>();
    for (const sid of stepIds) {
      if (seenStepIds.has(sid)) {
        errors.push(`${ctx} has duplicate step id "${sid}"`);
      }
      seenStepIds.add(sid);
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}
