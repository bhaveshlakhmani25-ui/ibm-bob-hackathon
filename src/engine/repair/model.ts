/**
 * Change Rehearsal — R08 Repair / Re-run Domain Model
 *
 * Defines the typed model for the repair-and-re-run workflow that follows
 * an R06 behavioral regression.
 *
 * Design constraints:
 *   - R08 does NOT change R06 verdict semantics.
 *   - R08 does NOT change R07 evidence semantics.
 *   - R08 does NOT automatically modify repository files.
 *   - "applied" status does NOT imply "verified".
 *   - "verified" requires the re-run R06 comparison to no longer identify
 *     the original regression/difference as a regression.
 *   - Deterministic IDs: content-derived, no randomness.
 *   - No secrets or credentials serialized.
 *   - No LLM dependency.
 *   - No external API calls.
 *
 * Traceability chain:
 *   original difference (R06)
 *     → repair request
 *       → repair plan
 *         → re-run (R05 + R06)
 *           → new comparison result
 *             → verification status
 *
 * Owner: Reuben (engine)
 * Phase: R08
 */

import type { ComparisonVerdict, ConfidenceLevel, BehaviorProvenance } from '../comparison/model.js';
import type { ComparisonResultSet, BehavioralDifferenceRecord } from '../comparison/model.js';
import type { ScenarioPlan } from '../scenario/model.js';

// Re-export for downstream consumers staying within the repair domain.
export type { ComparisonVerdict, ConfidenceLevel, BehaviorProvenance };

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Increment when the repair domain format changes in a breaking way. */
export const REPAIR_SCHEMA_VERSION = '1.0' as const;

// ---------------------------------------------------------------------------
// RepairStatus
// ---------------------------------------------------------------------------

/**
 * The lifecycle status of a RepairPlan.
 *
 * Status transitions:
 *   proposed  → applied  → verified (if re-run no longer shows the original regression)
 *   proposed  → applied  → not_verified (if re-run still shows the original regression)
 *   proposed  → rejected (developer chose not to apply)
 *   proposed  → applied  → failed (re-run encountered execution failure; cannot verify)
 *
 * IMPORTANT:
 *   "applied"  means the developer indicated the repair was applied.
 *   "verified" requires deterministic re-run confirmation via R05/R06.
 *              It must NOT be set merely because execution succeeded.
 */
export type RepairStatus =
  | 'proposed'      // Repair plan created but not yet applied
  | 'applied'       // Developer indicated the repair was applied (NOT yet verified)
  | 'rejected'      // Developer chose not to apply this repair
  | 'verified'      // Re-run R06 comparison no longer identifies the original regression
  | 'failed'        // Re-run encountered execution failure; cannot verify
  | 'not_verified'; // Re-run completed but the original regression is still present

// ---------------------------------------------------------------------------
// RepairActionOperation
// ---------------------------------------------------------------------------

/**
 * The type of operation a repair action represents.
 *
 * Operations are expressed as structured data, not free-form shell commands.
 * R08 produces a plan; a developer or integration layer applies it.
 */
export type RepairActionOperation =
  | 'replace_value'   // Replace a specific value in a file
  | 'insert_lines'    // Insert lines at a file location
  | 'delete_lines'    // Delete lines at a file location
  | 'invalidate_cache'// Invalidate a named cache (description-level only)
  | 'config_change'   // Change a configuration value
  | 'note';           // Informational/guidance note (no file mutation)

// ---------------------------------------------------------------------------
// RepairAction
// ---------------------------------------------------------------------------

/**
 * A single structured repair action within a RepairPlan.
 *
 * Actions are PROPOSALS — R08 does not execute them automatically.
 * The developer (or a future integration layer) applies them.
 *
 * Safety invariant:
 *   R08 must NOT automatically modify arbitrary repository files.
 *   RepairAction.operation describes the INTENT; the actor decides whether to apply.
 */
export interface RepairAction {
  /**
   * Stable, deterministic identifier for this action.
   * Format: "action-<hex>" derived from (repairPlanId + sequence + operation + target).
   */
  actionId: string;

  /** 1-based execution order of this action within the plan */
  sequence: number;

  /** The type of operation this action represents */
  operation: RepairActionOperation;

  /**
   * File or resource path this action targets.
   * Undefined for 'note' and 'invalidate_cache' operations that have no file target.
   */
  targetPath?: string;

  /**
   * Human-readable description of what this action does.
   * Always present.
   */
  description: string;

  /**
   * The content/value that is EXPECTED to be present before this action is applied.
   * Used for pre-condition checking — if the file does not contain this value,
   * applying the action may be unsafe.
   * Optional: not all actions have a verifiable pre-condition.
   */
  expectedOldValue?: string;

  /**
   * The content/value that should be written as part of this action.
   * For 'note' and 'invalidate_cache' operations this is a guidance string only.
   */
  proposedNewValue?: string;
}

// ---------------------------------------------------------------------------
// RepairRequest
// ---------------------------------------------------------------------------

/**
 * A request to produce a repair plan for a specific behavioral regression.
 *
 * Created when R06 identifies a REGRESSION and R07 packages the evidence.
 * The repair request identifies the regression with enough context for a
 * developer (or future AI integration layer) to propose a repair.
 *
 * R08 does NOT require an LLM to process a RepairRequest.
 * A deterministic repair plan can be constructed from the structural data alone.
 */
export interface RepairRequest {
  /**
   * Stable, deterministic identifier for this repair request.
   * Format: "repair-req-<hex>" derived from (rehearsalRunId + differenceId).
   */
  requestId: string;

  /** ID of the rehearsal run where the regression was detected */
  rehearsalRunId: string;

  /**
   * ID of the R06 BehavioralDifferenceRecord that triggered this request.
   * Primary link in the traceability chain.
   */
  differenceId: string;

  /** ID of the scenario that produced the regression */
  scenarioId: string;

  /**
   * ID of the protected behavior that was violated.
   * Undefined when the scenario has no directly linked protected behavior.
   */
  protectedBehaviorId?: string;

  /** The R06 verdict that prompted this repair request */
  originalVerdict: ComparisonVerdict;

  /**
   * One-sentence prose reason from R06 (BehavioralDifferenceRecord.summary).
   * Carries the human-readable context for what was wrong.
   */
  reason: string;

  /**
   * Detailed reasoning from R06 (BehavioralDifferenceRecord.detail).
   * Carries the full technical context for what was wrong.
   */
  detail: string;

  /**
   * Reference to the R07 evidence record that documented this regression.
   * Undefined when no evidence record was produced (e.g. inconclusive run).
   */
  evidenceRef?: string;

  /** ISO 8601 timestamp when this repair request was created */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// RepairPlan
// ---------------------------------------------------------------------------

/**
 * A structured repair proposal for a behavioral regression.
 *
 * A RepairPlan is a PROPOSAL. It is not verified until the deterministic
 * re-run (RehearsalRerunResult) confirms the original regression no longer exists.
 *
 * Status lifecycle:
 *   proposed → applied → verified | not_verified | failed
 *   proposed → rejected
 *
 * IDs are deterministic: derived from (requestId + sorted action descriptions).
 */
export interface RepairPlan {
  /**
   * Stable, deterministic identifier for this repair plan.
   * Format: "repair-plan-<hex>" derived from (requestId + rationale).
   */
  repairPlanId: string;

  /**
   * The repair request that prompted this plan.
   * Primary link in the traceability chain.
   */
  requestId: string;

  /**
   * The ID of the R06 BehavioralDifferenceRecord this plan addresses.
   * Duplicated from the RepairRequest for direct access.
   */
  targetDifferenceId: string;

  /**
   * Structured repair actions in the proposed execution order.
   * May be empty when the plan is informational/guidance-only.
   */
  actions: RepairAction[];

  /**
   * Human-readable rationale for this repair approach.
   * Describes WHY this set of actions addresses the regression.
   */
  rationale: string;

  /**
   * Current lifecycle status.
   * Default: 'proposed'
   */
  status: RepairStatus;

  /** ISO 8601 timestamp when this plan was created */
  createdAt: string;

  /**
   * ISO 8601 timestamp when the status was last changed.
   * Equals createdAt when status is still 'proposed'.
   */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// RerunOutcome
// ---------------------------------------------------------------------------

/**
 * The outcome of a re-run attempt.
 *
 * Semantics:
 *   resolved          — R06 no longer reports the original regression/difference
 *                       on the same scenario after the repair was applied.
 *                       This is the ONLY path to RepairStatus='verified'.
 *   still_failing     — R06 still reports the original regression/difference.
 *                       Repair did not fix the behavioral issue.
 *   inconclusive      — Execution ran but there is insufficient evidence to
 *                       determine whether the regression is resolved.
 *                       (e.g. R06 verdict is INCONCLUSIVE)
 *   execution_failed  — The re-run executor could not produce comparable observations
 *                       for at least one side. Not a behavioral verdict.
 *                       A failed execution is NOT automatically a regression.
 */
export type RerunOutcome =
  | 'resolved'          // Original regression no longer present
  | 'still_failing'     // Original regression still present
  | 'inconclusive'      // Cannot determine — evidence insufficient
  | 'execution_failed'; // Infrastructure failure prevented comparison

// ---------------------------------------------------------------------------
// Valid value sets (for validation and serialization)
// ---------------------------------------------------------------------------

export const VALID_REPAIR_STATUSES: ReadonlySet<RepairStatus> = new Set([
  'proposed',
  'applied',
  'rejected',
  'verified',
  'failed',
  'not_verified',
]);

export const VALID_REPAIR_ACTION_OPERATIONS: ReadonlySet<RepairActionOperation> = new Set([
  'replace_value',
  'insert_lines',
  'delete_lines',
  'invalidate_cache',
  'config_change',
  'note',
]);

export const VALID_RERUN_OUTCOMES: ReadonlySet<RerunOutcome> = new Set([
  'resolved',
  'still_failing',
  'inconclusive',
  'execution_failed',
]);

// ---------------------------------------------------------------------------
// RehearsalRerunResult
// ---------------------------------------------------------------------------

/**
 * The result of executing a deterministic re-run for a specific repair plan.
 *
 * The re-run:
 *   1. Uses the SAME ScenarioPlan as the original rehearsal (reuse, not duplication).
 *   2. Executes baseline and candidate through the existing R05 executor.
 *   3. Compares results using the existing R06 comparator.
 *   4. Preserves the original difference for traceability.
 *   5. Produces a new comparison result.
 *   6. Reports whether the original behavioral difference remains.
 *
 * Safety invariant:
 *   outcome='resolved' requires the R06 comparison verdict to NOT be REGRESSION
 *   for the original differenceId scenario.
 *   A successful execution alone does NOT constitute 'resolved'.
 */
export interface RehearsalRerunResult {
  /**
   * Stable, deterministic identifier for this re-run result.
   * Format: "rerun-<hex>" derived from (repairPlanId + rerunAt).
   */
  rerunId: string;

  /** ID of the RepairPlan that prompted this re-run */
  repairPlanId: string;

  /** ID of the RepairRequest for complete traceability */
  requestId: string;

  /**
   * ID of the R06 BehavioralDifferenceRecord from the ORIGINAL run.
   * Preserved for traceability — this is what we are trying to fix.
   */
  originalDifferenceId: string;

  /** ID of the ScenarioPlan that was re-run (same as original) */
  scenarioId: string;

  /**
   * The verdict from the ORIGINAL R06 comparison.
   * Preserved verbatim — R08 never modifies R06 verdicts.
   */
  originalVerdict: ComparisonVerdict;

  /**
   * The R06 comparison result from THIS re-run.
   * Contains the new BehavioralDifferenceRecord for the re-run scenario.
   * Undefined when outcome is 'execution_failed'.
   */
  newComparisonResult?: ComparisonResultSet;

  /**
   * The new R06 verdict for the same scenario after the repair.
   * Undefined when outcome is 'execution_failed'.
   */
  newVerdict?: ComparisonVerdict;

  /** The outcome of this re-run */
  outcome: RerunOutcome;

  /**
   * Human-readable explanation of the outcome.
   * Includes why it was classified as resolved/still_failing/inconclusive/execution_failed.
   */
  outcomeDetail: string;

  /**
   * The ScenarioPlan that was re-used (reference, not a copy).
   * Confirms the same plan was used — key for reuse validation.
   */
  scenarioPlanRef: Pick<ScenarioPlan, 'id' | 'name' | 'seedDataRef'>;

  /** ISO 8601 timestamp when this re-run was performed */
  rerunAt: string;
}
