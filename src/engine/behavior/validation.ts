/**
 * Change Rehearsal — Behavior Domain Validation (R03)
 *
 * Pure, deterministic validation functions for the behavior domain model.
 * No side effects, no I/O, no randomness.
 *
 * Validation rules:
 * - Required fields must be non-empty strings (or non-empty arrays where applicable)
 * - Confidence values must be one of the four valid ConfidenceLevel literals
 * - Provenance sourceKind must be a valid BehaviorSourceKind when present
 * - Journey steps must be non-empty, each with valid sequence and kind
 * - Step sequences must be 1-based and contiguous (no gaps, no duplicates)
 * - ProtectedBehavior relatedJourneyIds must be an array (may be empty at registration time)
 * - IDs must be non-empty strings
 *
 * All functions return a ValidationResult rather than throwing, so callers
 * can decide whether to collect or immediately surface errors.
 * The registry uses these functions to throw EngineError on invalid input.
 *
 * Owner: Reuben (engine)
 * Phase: R03
 */

import type {
  BehaviorJourney,
  BehaviorJourneyStep,
  BehaviorProtectedBehavior,
  BehaviorProvenance,
  ConfidenceLevel,
  BehaviorJourneyStepKind,
  BehaviorSourceKind,
  BehaviorSeverity,
} from './model.js';

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(errors: string[]): ValidationResult {
  return { valid: false, errors };
}

function combine(...results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap((r) => r.errors);
  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// Allowed value sets (used in validation)
// ---------------------------------------------------------------------------

export const VALID_CONFIDENCE_LEVELS: ReadonlySet<ConfidenceLevel> = new Set([
  'confirmed',
  'test_derived',
  'contract_derived',
  'inferred',
]);

export const VALID_STEP_KINDS: ReadonlySet<BehaviorJourneyStepKind> = new Set([
  'http',
  'auth',
  'db',
  'ui',
  'service_call',
  'state_transition',
  'function',
]);

export const VALID_SOURCE_KINDS: ReadonlySet<BehaviorSourceKind> = new Set([
  'test',
  'contract',
  'requirement',
  'developer_declaration',
  'inference',
]);

export const VALID_SEVERITIES: ReadonlySet<BehaviorSeverity> = new Set([
  'critical',
  'high',
  'medium',
  'low',
]);

// ---------------------------------------------------------------------------
// Provenance validation
// ---------------------------------------------------------------------------

export function validateProvenance(
  prov: unknown,
  context: string,
): ValidationResult {
  if (prov === null || typeof prov !== 'object') {
    return fail([`${context}.provenance must be an object`]);
  }

  const p = prov as Record<string, unknown>;
  const errors: string[] = [];

  if (!isNonEmptyString(p['confidence'])) {
    errors.push(`${context}.provenance.confidence must be a non-empty string`);
  } else if (!VALID_CONFIDENCE_LEVELS.has(p['confidence'] as ConfidenceLevel)) {
    errors.push(
      `${context}.provenance.confidence "${p['confidence']}" is not a valid ConfidenceLevel ` +
      `(must be one of: ${[...VALID_CONFIDENCE_LEVELS].join(', ')})`,
    );
  }

  if (p['sourceRef'] !== undefined && !isNonEmptyString(p['sourceRef'])) {
    errors.push(`${context}.provenance.sourceRef must be a non-empty string when present`);
  }

  if (p['sourceKind'] !== undefined) {
    if (!isNonEmptyString(p['sourceKind'])) {
      errors.push(`${context}.provenance.sourceKind must be a non-empty string when present`);
    } else if (!VALID_SOURCE_KINDS.has(p['sourceKind'] as BehaviorSourceKind)) {
      errors.push(
        `${context}.provenance.sourceKind "${p['sourceKind']}" is not a valid BehaviorSourceKind ` +
        `(must be one of: ${[...VALID_SOURCE_KINDS].join(', ')})`,
      );
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// Journey Step validation
// ---------------------------------------------------------------------------

export function validateJourneyStep(
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

  if (typeof s['sequence'] !== 'number' || !Number.isInteger(s['sequence']) || s['sequence'] < 1) {
    errors.push(`${context}.sequence must be a positive integer (1-based)`);
  }

  if (!isNonEmptyString(s['kind'])) {
    errors.push(`${context}.kind must be a non-empty string`);
  } else if (!VALID_STEP_KINDS.has(s['kind'] as BehaviorJourneyStepKind)) {
    errors.push(
      `${context}.kind "${s['kind']}" is not a valid BehaviorJourneyStepKind ` +
      `(must be one of: ${[...VALID_STEP_KINDS].join(', ')})`,
    );
  }

  if (!isNonEmptyString(s['description'])) {
    errors.push(`${context}.description must be a non-empty string`);
  }

  if (s['input'] !== undefined && (typeof s['input'] !== 'object' || s['input'] === null || Array.isArray(s['input']))) {
    errors.push(`${context}.input must be a plain object when present`);
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// Journey validation
// ---------------------------------------------------------------------------

export function validateJourney(journey: unknown): ValidationResult {
  if (journey === null || typeof journey !== 'object') {
    return fail(['journey must be an object']);
  }

  const j = journey as Record<string, unknown>;
  const errors: string[] = [];
  const ctx = `journey "${j['id'] ?? '(no id)'}"`;

  if (!isNonEmptyString(j['id'])) {
    errors.push(`${ctx}.id must be a non-empty string`);
  }

  if (!isNonEmptyString(j['name'])) {
    errors.push(`${ctx}.name must be a non-empty string`);
  }

  if (!isNonEmptyString(j['description'])) {
    errors.push(`${ctx}.description must be a non-empty string`);
  }

  if (j['entryPoint'] !== undefined && !isNonEmptyString(j['entryPoint'])) {
    errors.push(`${ctx}.entryPoint must be a non-empty string when present`);
  }

  if (!isNonEmptyString(j['confidence'])) {
    errors.push(`${ctx}.confidence must be a non-empty string`);
  } else if (!VALID_CONFIDENCE_LEVELS.has(j['confidence'] as ConfidenceLevel)) {
    errors.push(
      `${ctx}.confidence "${j['confidence']}" is not a valid ConfidenceLevel ` +
      `(must be one of: ${[...VALID_CONFIDENCE_LEVELS].join(', ')})`,
    );
  }

  if (j['tags'] !== undefined) {
    if (!Array.isArray(j['tags'])) {
      errors.push(`${ctx}.tags must be an array when present`);
    } else {
      for (let i = 0; i < (j['tags'] as unknown[]).length; i++) {
        if (!isNonEmptyString((j['tags'] as unknown[])[i])) {
          errors.push(`${ctx}.tags[${i}] must be a non-empty string`);
        }
      }
    }
  }

  if (j['affectedAreas'] !== undefined) {
    if (!Array.isArray(j['affectedAreas'])) {
      errors.push(`${ctx}.affectedAreas must be an array when present`);
    } else {
      for (let i = 0; i < (j['affectedAreas'] as unknown[]).length; i++) {
        if (!isNonEmptyString((j['affectedAreas'] as unknown[])[i])) {
          errors.push(`${ctx}.affectedAreas[${i}] must be a non-empty string`);
        }
      }
    }
  }

  // Validate provenance
  const provResult = validateProvenance(j['provenance'], ctx);
  errors.push(...provResult.errors);

  // Validate steps
  if (!Array.isArray(j['steps']) || (j['steps'] as unknown[]).length === 0) {
    errors.push(`${ctx}.steps must be a non-empty array`);
  } else {
    const steps = j['steps'] as unknown[];
    for (let i = 0; i < steps.length; i++) {
      const stepResult = validateJourneyStep(steps[i], `${ctx}.steps[${i}]`);
      errors.push(...stepResult.errors);
    }

    // Check sequences are 1-based and contiguous
    const validSteps = steps.filter(
      (s): s is BehaviorJourneyStep =>
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

// ---------------------------------------------------------------------------
// ProtectedBehavior validation
// ---------------------------------------------------------------------------

export function validateProtectedBehavior(behavior: unknown): ValidationResult {
  if (behavior === null || typeof behavior !== 'object') {
    return fail(['protectedBehavior must be an object']);
  }

  const b = behavior as Record<string, unknown>;
  const errors: string[] = [];
  const ctx = `protectedBehavior "${b['id'] ?? '(no id)'}"`;

  if (!isNonEmptyString(b['id'])) {
    errors.push(`${ctx}.id must be a non-empty string`);
  }

  if (!isNonEmptyString(b['description'])) {
    errors.push(`${ctx}.description must be a non-empty string`);
  }

  if (!isNonEmptyString(b['observable'])) {
    errors.push(`${ctx}.observable must be a non-empty string`);
  }

  if (!isNonEmptyString(b['expectedOutcome'])) {
    errors.push(`${ctx}.expectedOutcome must be a non-empty string`);
  }

  if (!isNonEmptyString(b['confidence'])) {
    errors.push(`${ctx}.confidence must be a non-empty string`);
  } else if (!VALID_CONFIDENCE_LEVELS.has(b['confidence'] as ConfidenceLevel)) {
    errors.push(
      `${ctx}.confidence "${b['confidence']}" is not a valid ConfidenceLevel ` +
      `(must be one of: ${[...VALID_CONFIDENCE_LEVELS].join(', ')})`,
    );
  }

  // Validate provenance
  const provResult = validateProvenance(b['provenance'], ctx);
  errors.push(...provResult.errors);

  // relatedJourneyIds must be an array (may be empty)
  if (!Array.isArray(b['relatedJourneyIds'])) {
    errors.push(`${ctx}.relatedJourneyIds must be an array`);
  } else {
    for (let i = 0; i < (b['relatedJourneyIds'] as unknown[]).length; i++) {
      if (!isNonEmptyString((b['relatedJourneyIds'] as unknown[])[i])) {
        errors.push(`${ctx}.relatedJourneyIds[${i}] must be a non-empty string`);
      }
    }
  }

  if (b['severity'] !== undefined) {
    if (!isNonEmptyString(b['severity'])) {
      errors.push(`${ctx}.severity must be a non-empty string when present`);
    } else if (!VALID_SEVERITIES.has(b['severity'] as BehaviorSeverity)) {
      errors.push(
        `${ctx}.severity "${b['severity']}" is not a valid BehaviorSeverity ` +
        `(must be one of: ${[...VALID_SEVERITIES].join(', ')})`,
      );
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
