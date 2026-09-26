/**
 * Change Rehearsal — R06 BehavioralComparator Public API
 *
 * Single entry point for all R06 comparison functionality.
 *
 * Usage:
 *   import { compareScenario, compareAll } from './engine/comparison/index.js';
 *   import type { BehavioralDifferenceRecord, ComparisonInput } from './engine/comparison/index.js';
 *
 * Owner: Reuben (engine)
 * Phase: R06
 */

// ---------------------------------------------------------------------------
// Core comparator
// ---------------------------------------------------------------------------

export { compareScenario, compareAll, COMPARATOR_VERSION } from './comparator.js';

// ---------------------------------------------------------------------------
// Domain model types
// ---------------------------------------------------------------------------

export type {
  ComparisonVerdict,
  BehavioralDifferenceRecord,
  ObservationFieldDiff,
  StepComparisonResult,
  ComparisonInput,
  ComparisonResultSet,
} from './model.js';

// ---------------------------------------------------------------------------
// Matching utilities
// ---------------------------------------------------------------------------

export { matchSteps, compareStepObservations, extractFieldDiffs } from './matching.js';

// ---------------------------------------------------------------------------
// Serialization and validation
// ---------------------------------------------------------------------------

export {
  COMPARISON_SCHEMA_VERSION,
  VALID_VERDICTS,
  VALID_EXECUTION_STATUSES,
  VALID_CONFIDENCE_LEVELS,
  validateDifferenceRecord,
  validateComparisonResultSet,
  serializeDifferenceRecord,
  deserializeDifferenceRecord,
  serializeComparisonResultSet,
  deserializeComparisonResultSet,
} from './serialization.js';

export type {
  ValidationResult,
  SerializedDifferenceRecord,
  SerializedComparisonResultSet,
} from './serialization.js';
