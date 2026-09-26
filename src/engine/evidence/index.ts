/**
 * Change Rehearsal — R07 Evidence Module Public API
 *
 * Single entry point for all R07 evidence capsule functionality.
 *
 * Usage:
 *   import { buildCapsule, buildReport } from './engine/evidence/index.js';
 *   import type { EvidenceCapsule, EvidenceRecord } from './engine/evidence/index.js';
 *
 * Owner: Reuben (engine)
 * Phase: R07
 */

// ---------------------------------------------------------------------------
// Domain model
// ---------------------------------------------------------------------------

export type {
  EvidenceCapsule,
  EvidenceRecord,
  ObservationSnapshot,
  ScenarioSummary,
  JourneyRef,
  BehaviorRef,
  CapsuleSummary,
} from './model.js';

export { EVIDENCE_CAPSULE_SCHEMA_VERSION } from './model.js';

// ---------------------------------------------------------------------------
// Capsule builder
// ---------------------------------------------------------------------------

export { buildCapsule, makeCapsuleId } from './capsule.js';
export type { CapsuleInput } from './capsule.js';

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

export { buildReport, mapVerdict, unmapVerdict } from './report.js';
export type { ReportInput } from './report.js';

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export {
  serializeCapsuleToJson,
  deserializeCapsuleFromJson,
  serializeCapsuleToMarkdown,
} from './serialization.js';

export type { SerializedEvidenceCapsule } from './serialization.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export {
  validateCapsule,
  validateEvidenceRecord,
  validateCapsuleRef,
  assertValidCapsule,
  VALID_COMPARISON_VERDICTS,
  VALID_CONFIDENCE_LEVELS,
} from './validation.js';

export type { CapsuleValidationResult } from './validation.js';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export { CapsuleStore, CAPSULE_JSON_FILENAME, CAPSULE_MARKDOWN_FILENAME } from './store.js';
