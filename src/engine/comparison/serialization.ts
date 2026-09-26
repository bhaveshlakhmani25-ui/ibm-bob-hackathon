/**
 * Change Rehearsal — R06 Comparison Serialization and Validation
 *
 * Deterministic serialization and deserialization for comparison domain model.
 *
 * Requirements:
 *   - Stable field order: normalized on serialization
 *   - Stable collection ordering: differences sorted by differenceId ascending
 *   - Round-trip fidelity: deserialize(serialize(x)) deep-equals x
 *   - Invalid input → typed EngineError (never an unhandled throw)
 *   - Schema version in envelope for future migration
 *   - No randomness injected during serialization
 *
 * Owner: Reuben (engine)
 * Phase: R06
 */

import type {
  BehavioralDifferenceRecord,
  ComparisonResultSet,
  ComparisonVerdict,
  StepComparisonResult,
  ObservationFieldDiff,
} from './model.js';
import { EngineError } from '../errors.js';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Increment when the serialized format changes in a breaking way. */
export const COMPARISON_SCHEMA_VERSION = '1.0';

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

export interface SerializedDifferenceRecord {
  schemaVersion: string;
  record: BehavioralDifferenceRecord;
}

export interface SerializedComparisonResultSet {
  schemaVersion: string;
  resultSet: ComparisonResultSet;
}

// ---------------------------------------------------------------------------
// Valid value sets
// ---------------------------------------------------------------------------

export const VALID_VERDICTS: ReadonlySet<ComparisonVerdict> = new Set([
  'PRESERVED',
  'INTENTIONAL_CHANGE',
  'REGRESSION',
  'POTENTIAL_DIFFERENCE',
  'INCONCLUSIVE',
]);

export const VALID_EXECUTION_STATUSES = new Set([
  'passed',
  'failed',
  'blocked',
  'timed_out',
  'error',
]);

export const VALID_CONFIDENCE_LEVELS = new Set([
  'confirmed',
  'test_derived',
  'contract_derived',
  'inferred',
]);

// ---------------------------------------------------------------------------
// Validation
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

/**
 * Validate a BehavioralDifferenceRecord.
 * Returns a ValidationResult rather than throwing, so callers can
 * decide whether to collect or immediately surface errors.
 */
export function validateDifferenceRecord(record: unknown): ValidationResult {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return fail(['BehavioralDifferenceRecord must be a plain object']);
  }

  const r = record as Record<string, unknown>;
  const errors: string[] = [];
  const ctx = `record "${r['differenceId'] ?? '(no id)'}"`;

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
  } else if (!VALID_VERDICTS.has(r['verdict'] as ComparisonVerdict)) {
    errors.push(
      `${ctx}.verdict "${r['verdict']}" is not a valid ComparisonVerdict ` +
      `(must be one of: ${[...VALID_VERDICTS].join(', ')})`,
    );
  }

  if (!isNonEmptyString(r['summary'])) {
    errors.push(`${ctx}.summary must be a non-empty string`);
  }

  if (!isNonEmptyString(r['detail'])) {
    errors.push(`${ctx}.detail must be a non-empty string`);
  }

  if (!Array.isArray(r['stepResults'])) {
    errors.push(`${ctx}.stepResults must be an array`);
  }

  if (!isNonEmptyString(r['confidence'])) {
    errors.push(`${ctx}.confidence must be a non-empty string`);
  } else if (!VALID_CONFIDENCE_LEVELS.has(r['confidence'] as string)) {
    errors.push(
      `${ctx}.confidence "${r['confidence']}" is not a valid ConfidenceLevel`,
    );
  }

  if (r['provenance'] === null || typeof r['provenance'] !== 'object') {
    errors.push(`${ctx}.provenance must be an object`);
  }

  if (!isNonEmptyString(r['baselineExecutionStatus'])) {
    errors.push(`${ctx}.baselineExecutionStatus must be a non-empty string`);
  } else if (!VALID_EXECUTION_STATUSES.has(r['baselineExecutionStatus'] as string)) {
    errors.push(`${ctx}.baselineExecutionStatus "${r['baselineExecutionStatus']}" is not a valid ExecutionStatus`);
  }

  if (!isNonEmptyString(r['candidateExecutionStatus'])) {
    errors.push(`${ctx}.candidateExecutionStatus must be a non-empty string`);
  } else if (!VALID_EXECUTION_STATUSES.has(r['candidateExecutionStatus'] as string)) {
    errors.push(`${ctx}.candidateExecutionStatus "${r['candidateExecutionStatus']}" is not a valid ExecutionStatus`);
  }

  if (!isNonEmptyString(r['comparedAt'])) {
    errors.push(`${ctx}.comparedAt must be a non-empty string`);
  }

  if (r['comparatorVersion'] !== COMPARISON_SCHEMA_VERSION) {
    errors.push(
      `${ctx}.comparatorVersion must be "${COMPARISON_SCHEMA_VERSION}", got "${r['comparatorVersion']}"`,
    );
  }

  return errors.length === 0 ? ok() : fail(errors);
}

/**
 * Validate a ComparisonResultSet.
 */
export function validateComparisonResultSet(value: unknown): ValidationResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(['ComparisonResultSet must be a plain object']);
  }

  const v = value as Record<string, unknown>;
  const errors: string[] = [];

  if (!Array.isArray(v['differences'])) {
    errors.push('ComparisonResultSet.differences must be an array');
  } else {
    for (let i = 0; i < (v['differences'] as unknown[]).length; i++) {
      const result = validateDifferenceRecord((v['differences'] as unknown[])[i]);
      if (!result.valid) {
        errors.push(...result.errors.map((e) => `differences[${i}]: ${e}`));
      }
    }
  }

  if (v['counts'] === null || typeof v['counts'] !== 'object') {
    errors.push('ComparisonResultSet.counts must be an object');
  }

  if (v['comparatorVersion'] !== COMPARISON_SCHEMA_VERSION) {
    errors.push(
      `ComparisonResultSet.comparatorVersion must be "${COMPARISON_SCHEMA_VERSION}", got "${v['comparatorVersion']}"`,
    );
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a BehavioralDifferenceRecord to a deterministic JSON string.
 * Fields are normalized to a stable order; stepResults are sorted by stepId.
 */
export function serializeDifferenceRecord(record: BehavioralDifferenceRecord): string {
  const normalized = normalizeDifferenceRecord(record);
  const envelope: SerializedDifferenceRecord = {
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    record: normalized,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a BehavioralDifferenceRecord from a JSON string.
 *
 * @throws EngineError if input is invalid
 */
export function deserializeDifferenceRecord(raw: string): BehavioralDifferenceRecord {
  const parsed = safeParse(raw);
  assertObject(parsed, 'difference record envelope');

  const envelope = parsed as Record<string, unknown>;
  assertSchemaVersion(envelope['schemaVersion']);

  const result = validateDifferenceRecord(envelope['record']);
  if (!result.valid) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      `Deserialized difference record failed validation: ${result.errors.join('; ')}`,
    );
  }

  return envelope['record'] as BehavioralDifferenceRecord;
}

/**
 * Serialize a ComparisonResultSet to a deterministic JSON string.
 * Differences are sorted by differenceId ascending.
 */
export function serializeComparisonResultSet(resultSet: ComparisonResultSet): string {
  const normalized: ComparisonResultSet = {
    differences: [...resultSet.differences]
      .sort((a, b) => a.differenceId.localeCompare(b.differenceId))
      .map(normalizeDifferenceRecord),
    counts: { ...resultSet.counts },
    comparatorVersion: COMPARISON_SCHEMA_VERSION,
  };

  const envelope: SerializedComparisonResultSet = {
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    resultSet: normalized,
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a ComparisonResultSet from a JSON string.
 *
 * @throws EngineError if input is invalid
 */
export function deserializeComparisonResultSet(raw: string): ComparisonResultSet {
  const parsed = safeParse(raw);
  assertObject(parsed, 'comparison result set envelope');

  const envelope = parsed as Record<string, unknown>;
  assertSchemaVersion(envelope['schemaVersion']);

  const result = validateComparisonResultSet(envelope['resultSet']);
  if (!result.valid) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      `Deserialized comparison result set failed validation: ${result.errors.join('; ')}`,
    );
  }

  return envelope['resultSet'] as ComparisonResultSet;
}

// ---------------------------------------------------------------------------
// Normalization helpers (stable field order + sorted collections)
// ---------------------------------------------------------------------------

function normalizeDifferenceRecord(r: BehavioralDifferenceRecord): BehavioralDifferenceRecord {
  return {
    differenceId: r.differenceId,
    scenarioId: r.scenarioId,
    journeyId: r.journeyId,
    ...(r.protectedBehaviorId !== undefined ? { protectedBehaviorId: r.protectedBehaviorId } : {}),
    verdict: r.verdict,
    summary: r.summary,
    detail: r.detail,
    stepResults: [...r.stepResults]
      .sort((a, b) => {
        if (a.sequence !== b.sequence) return a.sequence - b.sequence;
        return a.stepId.localeCompare(b.stepId);
      })
      .map(normalizeStepResult),
    confidence: r.confidence,
    provenance: {
      confidence: r.provenance.confidence,
      ...(r.provenance.sourceRef !== undefined ? { sourceRef: r.provenance.sourceRef } : {}),
      ...(r.provenance.sourceKind !== undefined ? { sourceKind: r.provenance.sourceKind } : {}),
    },
    baselineExecutionStatus: r.baselineExecutionStatus,
    candidateExecutionStatus: r.candidateExecutionStatus,
    comparedAt: r.comparedAt,
    comparatorVersion: COMPARISON_SCHEMA_VERSION,
  };
}

function normalizeStepResult(sr: StepComparisonResult): StepComparisonResult {
  return {
    stepId: sr.stepId,
    sequence: sr.sequence,
    baselineStatus: sr.baselineStatus,
    candidateStatus: sr.candidateStatus,
    fieldDiffs: [...sr.fieldDiffs]
      .sort((a, b) => a.field.localeCompare(b.field))
      .map(normalizeFieldDiff),
    baselineMissing: sr.baselineMissing,
    candidateMissing: sr.candidateMissing,
  };
}

function normalizeFieldDiff(d: ObservationFieldDiff): ObservationFieldDiff {
  return {
    field: d.field,
    baselineValue: d.baselineValue,
    candidateValue: d.candidateValue,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      `Failed to parse comparison JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function assertObject(value: unknown, context: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      `Expected an object for ${context}, got ${Array.isArray(value) ? 'array' : typeof value}`,
    );
  }
}

function assertSchemaVersion(version: unknown): void {
  if (version !== COMPARISON_SCHEMA_VERSION) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      `Unsupported comparison schema version "${String(version)}". Expected "${COMPARISON_SCHEMA_VERSION}".`,
    );
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
