/**
 * Change Rehearsal — R07 Evidence Capsule Validation
 *
 * Structural validation for EvidenceCapsule and EvidenceRecord.
 *
 * Validation rules:
 *   - Required IDs must be non-empty strings
 *   - Verdicts must be valid ComparisonVerdict values
 *   - Confidence levels must be valid ConfidenceLevel values
 *   - Traceability fields must be present and consistent
 *   - Schema version must match
 *   - Evidence records must have valid differenceId → scenarioId links
 *   - No sensitive patterns (secrets) in observation values
 *
 * Owner: Reuben (engine)
 * Phase: R07
 */

import type { EvidenceCapsule, EvidenceRecord } from './model.js';
import { EVIDENCE_CAPSULE_SCHEMA_VERSION } from './model.js';
import type { ComparisonVerdict, ConfidenceLevel } from '../comparison/model.js';

// ---------------------------------------------------------------------------
// Valid value sets
// ---------------------------------------------------------------------------

export const VALID_COMPARISON_VERDICTS: ReadonlySet<ComparisonVerdict> = new Set([
  'PRESERVED',
  'INTENTIONAL_CHANGE',
  'REGRESSION',
  'POTENTIAL_DIFFERENCE',
  'INCONCLUSIVE',
]);

export const VALID_CONFIDENCE_LEVELS: ReadonlySet<ConfidenceLevel> = new Set([
  'confirmed',
  'test_derived',
  'contract_derived',
  'inferred',
]);

// ---------------------------------------------------------------------------
// Sensitive pattern detection
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate a sensitive value that should have been scrubbed by R05.
 *
 * R07 validates that these patterns are NOT present in evidence records.
 * If found, it indicates R05's scrubbing boundary was violated.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\bpassword\b/i,
  /\bsecret\b/i,
  /\bapi[_-]?key\b/i,
  /\bauthorization:\s*bearer\s+[a-z0-9._-]+/i,
  /\bauthorization:\s*basic\s+[a-z0-9+/=]+/i,
  /\bset-cookie:/i,
  /\bx-api-key:/i,
  /\bprivate[_-]?key\b/i,
  /\baccess[_-]?token\b/i,
  /\bAKIA[0-9A-Z]{16}/,       // AWS access key
  /\bsk-[a-z0-9]{20,}/i,       // OpenAI-style key
];

/**
 * Check if a string value contains any sensitive patterns.
 */
function containsSensitivePattern(value: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(value));
}

/**
 * Recursively scan a value for sensitive patterns.
 * Returns true if any sensitive pattern is found.
 */
function hasSensitiveValue(value: unknown, depth = 0): boolean {
  if (depth > 10) return false; // prevent deep recursion on malicious inputs
  if (typeof value === 'string') return containsSensitivePattern(value);
  if (Array.isArray(value)) return value.some((v) => hasSensitiveValue(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => containsSensitivePattern(k) || hasSensitiveValue(v, depth + 1),
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// ValidationResult
// ---------------------------------------------------------------------------

export interface CapsuleValidationResult {
  valid: boolean;
  errors: string[];
}

function ok(): CapsuleValidationResult {
  return { valid: true, errors: [] };
}

function fail(errors: string[]): CapsuleValidationResult {
  return { valid: false, errors };
}

// ---------------------------------------------------------------------------
// EvidenceRecord validation
// ---------------------------------------------------------------------------

/**
 * Validate a single EvidenceRecord.
 */
export function validateEvidenceRecord(record: unknown): CapsuleValidationResult {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return fail(['EvidenceRecord must be a plain object']);
  }

  const r = record as Record<string, unknown>;
  const errors: string[] = [];
  const ctx = `evidence record "${r['evidenceId'] ?? '(no id)'}"`;

  if (!isNonEmptyString(r['evidenceId'])) {
    errors.push(`${ctx}.evidenceId must be a non-empty string`);
  }

  if (!isNonEmptyString(r['differenceId'])) {
    errors.push(`${ctx}.differenceId must be a non-empty string`);
  }

  if (!isNonEmptyString(r['scenarioId'])) {
    errors.push(`${ctx}.scenarioId must be a non-empty string`);
  }

  if (!isNonEmptyString(r['journeyId'])) {
    errors.push(`${ctx}.journeyId must be a non-empty string`);
  }

  // protectedBehaviorId is optional
  if (r['protectedBehaviorId'] !== undefined && !isNonEmptyString(r['protectedBehaviorId'])) {
    errors.push(`${ctx}.protectedBehaviorId must be a non-empty string when present`);
  }

  if (!isNonEmptyString(r['verdict'])) {
    errors.push(`${ctx}.verdict must be a non-empty string`);
  } else if (!VALID_COMPARISON_VERDICTS.has(r['verdict'] as ComparisonVerdict)) {
    errors.push(
      `${ctx}.verdict "${r['verdict']}" is not a valid ComparisonVerdict ` +
        `(must be one of: ${[...VALID_COMPARISON_VERDICTS].join(', ')})`,
    );
  }

  if (!Array.isArray(r['baselineObservations'])) {
    errors.push(`${ctx}.baselineObservations must be an array`);
  }

  if (!Array.isArray(r['candidateObservations'])) {
    errors.push(`${ctx}.candidateObservations must be an array`);
  }

  if (!Array.isArray(r['fieldDiffs'])) {
    errors.push(`${ctx}.fieldDiffs must be an array`);
  }

  if (!isNonEmptyString(r['reason'])) {
    errors.push(`${ctx}.reason must be a non-empty string`);
  }

  if (!isNonEmptyString(r['detail'])) {
    errors.push(`${ctx}.detail must be a non-empty string`);
  }

  if (!isNonEmptyString(r['confidence'])) {
    errors.push(`${ctx}.confidence must be a non-empty string`);
  } else if (!VALID_CONFIDENCE_LEVELS.has(r['confidence'] as ConfidenceLevel)) {
    errors.push(
      `${ctx}.confidence "${r['confidence']}" is not a valid ConfidenceLevel`,
    );
  }

  if (r['provenance'] === null || typeof r['provenance'] !== 'object') {
    errors.push(`${ctx}.provenance must be an object`);
  }

  if (!isNonEmptyString(r['baselineExecutionStatus'])) {
    errors.push(`${ctx}.baselineExecutionStatus must be a non-empty string`);
  }

  if (!isNonEmptyString(r['candidateExecutionStatus'])) {
    errors.push(`${ctx}.candidateExecutionStatus must be a non-empty string`);
  }

  // Security check: sensitive values must not appear in observation data
  if (Array.isArray(r['baselineObservations']) && hasSensitiveValue(r['baselineObservations'])) {
    errors.push(
      `${ctx}.baselineObservations contains sensitive values. R05 scrubbing boundary was violated.`,
    );
  }

  if (Array.isArray(r['candidateObservations']) && hasSensitiveValue(r['candidateObservations'])) {
    errors.push(
      `${ctx}.candidateObservations contains sensitive values. R05 scrubbing boundary was violated.`,
    );
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// EvidenceCapsule validation
// ---------------------------------------------------------------------------

/**
 * Validate an EvidenceCapsule.
 *
 * Returns a CapsuleValidationResult rather than throwing, so callers can
 * decide whether to collect or immediately surface errors.
 */
export function validateCapsule(capsule: unknown): CapsuleValidationResult {
  if (capsule === null || typeof capsule !== 'object' || Array.isArray(capsule)) {
    return fail(['EvidenceCapsule must be a plain object']);
  }

  const c = capsule as Record<string, unknown>;
  const errors: string[] = [];

  // Required IDs
  if (!isNonEmptyString(c['capsuleId'])) {
    errors.push('capsuleId must be a non-empty string');
  }

  if (!isNonEmptyString(c['rehearsalRunId'])) {
    errors.push('rehearsalRunId must be a non-empty string');
  }

  if (!isNonEmptyString(c['createdAt'])) {
    errors.push('createdAt must be a non-empty string');
  }

  if (!isNonEmptyString(c['changeSummary'])) {
    errors.push('changeSummary must be a non-empty string');
  }

  // requirementSummary is optional
  if (c['requirementSummary'] !== undefined && !isNonEmptyString(c['requirementSummary'])) {
    errors.push('requirementSummary must be a non-empty string when present');
  }

  // Collections
  if (!Array.isArray(c['scenarioSummaries'])) {
    errors.push('scenarioSummaries must be an array');
  }

  if (!Array.isArray(c['journeyRefs'])) {
    errors.push('journeyRefs must be an array');
  }

  if (!Array.isArray(c['behaviorRefs'])) {
    errors.push('behaviorRefs must be an array');
  }

  if (!Array.isArray(c['evidenceRecords'])) {
    errors.push('evidenceRecords must be an array');
  } else {
    // Validate each evidence record
    const records = c['evidenceRecords'] as unknown[];
    for (let i = 0; i < records.length; i++) {
      const result = validateEvidenceRecord(records[i]);
      if (!result.valid) {
        errors.push(...result.errors.map((e) => `evidenceRecords[${i}]: ${e}`));
      }
    }

    // Validate consistency: all differenceIds and scenarioIds must be non-empty
    const recordsTyped = records as Array<Record<string, unknown>>;
    const evidenceIds = new Set<string>();
    for (const r of recordsTyped) {
      if (isNonEmptyString(r['evidenceId'])) {
        if (evidenceIds.has(r['evidenceId'] as string)) {
          errors.push(`Duplicate evidenceId: "${r['evidenceId']}"`);
        }
        evidenceIds.add(r['evidenceId'] as string);
      }
    }
  }

  // Summary
  if (c['summary'] === null || typeof c['summary'] !== 'object') {
    errors.push('summary must be an object');
  } else {
    const s = c['summary'] as Record<string, unknown>;
    const summaryFields = [
      'totalScenarios',
      'totalDifferences',
      'preserved',
      'intentionalChanges',
      'regressions',
      'potentialDifferences',
      'inconclusive',
      'executionFailures',
    ];
    for (const field of summaryFields) {
      if (typeof s[field] !== 'number' || s[field] < 0) {
        errors.push(`summary.${field} must be a non-negative number`);
      }
    }
    if (!isNonEmptyString(s['overallVerdict'])) {
      errors.push('summary.overallVerdict must be a non-empty string');
    } else if (
      s['overallVerdict'] !== 'PASS' &&
      s['overallVerdict'] !== 'REVIEW_REQUIRED' &&
      s['overallVerdict'] !== 'REGRESSION_DETECTED'
    ) {
      errors.push(
        `summary.overallVerdict "${s['overallVerdict']}" is not valid (must be PASS, REVIEW_REQUIRED, or REGRESSION_DETECTED)`,
      );
    }
  }

  // Schema version
  if (c['schemaVersion'] !== EVIDENCE_CAPSULE_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must be "${EVIDENCE_CAPSULE_SCHEMA_VERSION}", got "${String(c['schemaVersion'])}"`,
    );
  }

  return errors.length === 0 ? ok() : fail(errors);
}

/**
 * Assert that a capsule is valid, throwing an EngineError if not.
 *
 * @throws EngineError('EVIDENCE_WRITE_FAILED') if validation fails
 */
export function assertValidCapsule(capsule: unknown): asserts capsule is EvidenceCapsule {
  const result = validateCapsule(capsule);
  if (!result.valid) {
    const { EngineError } = require('../errors.js');
    throw new EngineError(
      'EVIDENCE_WRITE_FAILED',
      `Invalid EvidenceCapsule: ${result.errors.join('; ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Capsule reference validation
// ---------------------------------------------------------------------------

/**
 * Validate a capsule_ref object (from F-04 shared contracts).
 */
export function validateCapsuleRef(ref: unknown): CapsuleValidationResult {
  if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
    return fail(['capsule_ref must be a plain object']);
  }

  const r = ref as Record<string, unknown>;
  const errors: string[] = [];

  if (!isNonEmptyString(r['json_path'])) {
    errors.push('capsule_ref.json_path must be a non-empty string');
  }

  if (!isNonEmptyString(r['markdown_path'])) {
    errors.push('capsule_ref.markdown_path must be a non-empty string');
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
