/**
 * Change Rehearsal — R08 Deterministic ID Generation
 *
 * All R08 IDs are:
 *   - Stable: the same logical object always produces the same ID
 *   - Deterministic: no randomness, no timestamps in the identity input
 *   - Content-derived: computed from semantic identity fields
 *
 * Uses the same SHA-256/hex approach as behavior/ids.ts.
 *
 * Owner: Reuben (engine)
 * Phase: R08
 */

import { deterministicId } from '../behavior/ids.js';

// ---------------------------------------------------------------------------
// RepairRequest ID
// ---------------------------------------------------------------------------

/**
 * Produce a stable ID for a RepairRequest.
 *
 * Identity is derived from: rehearsalRunId + differenceId.
 * These two fields uniquely identify a regression within a run.
 */
export function repairRequestId(rehearsalRunId: string, differenceId: string): string {
  return `repair-req-${deterministicId([rehearsalRunId, differenceId])}`;
}

// ---------------------------------------------------------------------------
// RepairPlan ID
// ---------------------------------------------------------------------------

/**
 * Produce a stable ID for a RepairPlan.
 *
 * Identity is derived from: requestId + rationale.
 * Different rationales for the same request produce different plan IDs.
 */
export function repairPlanId(requestId: string, rationale: string): string {
  return `repair-plan-${deterministicId([requestId, rationale])}`;
}

// ---------------------------------------------------------------------------
// RepairAction ID
// ---------------------------------------------------------------------------

/**
 * Produce a stable ID for a RepairAction.
 *
 * Identity is derived from: repairPlanId + sequence + operation + description.
 * The sequence is included so the same description at different positions
 * produces different action IDs.
 */
export function repairActionId(
  planId: string,
  sequence: number,
  operation: string,
  description: string,
): string {
  return `action-${deterministicId([planId, String(sequence), operation, description])}`;
}

// ---------------------------------------------------------------------------
// RehearsalRerunResult ID
// ---------------------------------------------------------------------------

/**
 * Produce a stable ID for a RehearsalRerunResult.
 *
 * Identity is derived from: repairPlanId + scenarioId + originalDifferenceId.
 * This ensures the same re-run request always maps to the same ID, enabling
 * deduplication and idempotent re-run storage.
 *
 * Note: rerunAt (timestamp) is NOT included in the ID because it is a
 * runtime value, not a semantic identity field.
 */
export function rerunResultId(
  repairPlanId: string,
  scenarioId: string,
  originalDifferenceId: string,
): string {
  return `rerun-${deterministicId([repairPlanId, scenarioId, originalDifferenceId])}`;
}
