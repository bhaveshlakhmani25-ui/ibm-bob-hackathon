/**
 * Change Rehearsal — Deterministic ID Generation for Scenario Domain (R04)
 *
 * All IDs in the scenario domain must be:
 *   - Stable: the same logical object always produces the same ID
 *   - Deterministic: no randomness, no timestamps, no UUID v4
 *   - Content-derived: computed from the object's semantic identity fields
 *
 * Strategy: reuse deterministicId() from behavior/ids.ts (SHA-256 + hex prefix).
 * This ensures the same hashing strategy is used throughout the engine.
 *
 * Owner: Reuben (engine)
 * Phase: R04
 */

import { deterministicId } from '../behavior/ids.js';

// ---------------------------------------------------------------------------
// ScenarioPlan ID
// ---------------------------------------------------------------------------

/**
 * Produce a stable ID for a ScenarioPlan.
 *
 * Identity is derived from: sourceJourneyId + optional sourceBehaviorId + seedDataRef.
 * Including seedDataRef ensures two plans for the same journey but different fixtures
 * are distinct.
 *
 * The prefix "scenario-" makes IDs readable in logs and artifacts.
 */
export function scenarioPlanId(
  sourceJourneyId: string,
  seedDataRef: string,
  sourceBehaviorId?: string,
): string {
  const parts = [sourceJourneyId, seedDataRef];
  if (sourceBehaviorId) parts.push(sourceBehaviorId);
  return `scenario-${deterministicId(parts)}`;
}

// ---------------------------------------------------------------------------
// ScenarioPlanStep ID
// ---------------------------------------------------------------------------

/**
 * Produce a stable ID for a ScenarioPlanStep.
 *
 * Identity is derived from: parentScenarioId + sequence + kind + description.
 * Mirrors journeyStepId() from behavior/ids.ts.
 * The sequence is included so the same description at different positions
 * produces different step IDs.
 *
 * The prefix "sstep-" (scenario-step) distinguishes these from journey step IDs
 * ("step-") without ambiguity in logs.
 */
export function scenarioPlanStepId(
  parentScenarioId: string,
  sequence: number,
  kind: string,
  description: string,
): string {
  const parts = [parentScenarioId, String(sequence), kind, description];
  return `sstep-${deterministicId(parts)}`;
}
