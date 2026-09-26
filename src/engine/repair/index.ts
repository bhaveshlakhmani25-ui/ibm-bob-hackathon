/**
 * Change Rehearsal — R08 Repair / Re-run Module Barrel Export
 *
 * Public API for the R08 repair and re-run workflow.
 *
 * Owner: Reuben (engine)
 * Phase: R08
 */

// Domain model
export type {
  RepairStatus,
  RepairActionOperation,
  RepairAction,
  RepairRequest,
  RepairPlan,
  RerunOutcome,
  RehearsalRerunResult,
} from './model.js';
export {
  REPAIR_SCHEMA_VERSION,
  VALID_REPAIR_STATUSES,
  VALID_REPAIR_ACTION_OPERATIONS,
  VALID_RERUN_OUTCOMES,
} from './model.js';

// Deterministic ID generation
export {
  repairRequestId,
  repairPlanId,
  repairActionId,
  rerunResultId,
} from './ids.js';

// Validation
export {
  validateRepairRequest,
  validateRepairPlan,
  validateRepairAction,
  validateRerunResult,
} from './validation.js';
export type { ValidationResult } from './validation.js';

// Serialization
export {
  serializeRepairRequest,
  deserializeRepairRequest,
  serializeRepairPlan,
  deserializeRepairPlan,
  serializeRerunResult,
  deserializeRerunResult,
} from './serialization.js';
export type {
  SerializedRepairRequest,
  SerializedRepairPlan,
  SerializedRerunResult,
} from './serialization.js';

// Re-run orchestration
export { performRerun, classifyOutcome } from './rerun.js';
export type { RerunInput } from './rerun.js';
