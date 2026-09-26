/**
 * Change Rehearsal — R05 Execution Validation
 *
 * Pure, deterministic validation functions for R05 execution domain types.
 * No side effects, no I/O, no randomness.
 *
 * Validates:
 *   - ExecutionTarget fields
 *   - ScenarioPlan suitability for execution (delegates to scenario/validation.ts)
 *
 * Functions throw EngineError with typed codes on invalid state so the
 * executor can propagate errors cleanly without try/catch in hot paths.
 *
 * Owner: Reuben (engine)
 * Phase: R05
 */

import type { ScenarioPlan } from '../scenario/model.js';
import type { ExecutionTarget } from './model.js';
import { validateScenarioPlan as validatePlan } from '../scenario/validation.js';
import { EngineError } from '../errors.js';

// ---------------------------------------------------------------------------
// ExecutionTarget validation
// ---------------------------------------------------------------------------

/** Valid ExecutionSide values */
const VALID_SIDES = new Set<string>(['baseline', 'candidate']);

/**
 * Validate an ExecutionTarget.
 *
 * Throws EngineError('SCENARIO_INVALID') if the target is malformed.
 * This is intentional: an invalid target means the executor cannot proceed.
 */
export function validateExecutionTarget(target: ExecutionTarget): void {
  if (!target || typeof target !== 'object') {
    throw new EngineError(
      'SCENARIO_INVALID',
      'ExecutionTarget must be a non-null object',
    );
  }

  if (!VALID_SIDES.has(target.kind)) {
    throw new EngineError(
      'SCENARIO_INVALID',
      `ExecutionTarget.kind must be 'baseline' or 'candidate', got: ${String(target.kind)}`,
    );
  }

  if (typeof target.revision !== 'string' || target.revision.trim().length === 0) {
    throw new EngineError(
      'SCENARIO_INVALID',
      `ExecutionTarget.revision must be a non-empty string, got: ${String(target.revision)}`,
    );
  }

  if (
    target.serviceBaseUrl !== undefined &&
    (typeof target.serviceBaseUrl !== 'string' || target.serviceBaseUrl.trim().length === 0)
  ) {
    throw new EngineError(
      'SCENARIO_INVALID',
      `ExecutionTarget.serviceBaseUrl must be a non-empty string when provided`,
    );
  }
}

// ---------------------------------------------------------------------------
// ScenarioPlan validation for execution
// ---------------------------------------------------------------------------

/**
 * Validate that a ScenarioPlan is suitable for execution.
 *
 * Delegates to the R04 scenario validation and adds an execution-specific check:
 *   - plan.deterministic must be true (type-level guarantee, checked at runtime)
 *
 * Throws EngineError('SCENARIO_NOT_DETERMINISTIC') or EngineError('SCENARIO_INVALID').
 */
export function validateScenarioPlan(plan: ScenarioPlan): void {
  if (!plan || typeof plan !== 'object') {
    throw new EngineError(
      'SCENARIO_INVALID',
      'ScenarioPlan must be a non-null object',
    );
  }

  // Runtime check for the type-level deterministic guarantee
  if (plan.deterministic !== true) {
    throw new EngineError(
      'SCENARIO_NOT_DETERMINISTIC',
      `ScenarioPlan '${plan.id ?? '<unknown>'}' does not carry deterministic: true`,
    );
  }

  // Delegate to R04 validation for full field checks
  const result = validatePlan(plan);
  if (!result.valid) {
    throw new EngineError(
      'SCENARIO_INVALID',
      `ScenarioPlan '${plan.id}' failed validation: ${result.errors.join('; ')}`,
    );
  }
}
