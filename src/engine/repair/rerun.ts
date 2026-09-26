/**
 * Change Rehearsal — R08 Re-run Orchestration
 *
 * Implements deterministic re-run logic that wraps the existing R05 executor
 * and R06 comparator to verify whether a repair resolved a behavioral regression.
 *
 * SAFETY BOUNDARIES:
 *   - R08 does NOT duplicate R05 execution logic — it calls RehearsalExecutor directly.
 *   - R08 does NOT duplicate R06 comparison logic — it calls compareScenario directly.
 *   - R08 does NOT automatically modify repository files.
 *   - R08 does NOT treat execution failure as a regression.
 *   - R08 does NOT treat a successful execution as proof of behavioral correctness.
 *   - outcome='resolved' requires R06 to produce a non-REGRESSION verdict for
 *     the same scenario — a successful execution alone is NOT sufficient.
 *
 * Re-run algorithm:
 *   1. Validate the RepairPlan and ScenarioPlan inputs.
 *   2. Execute baseline + candidate using the SAME ScenarioPlan via R05.
 *   3. Compare using the existing R06 compareScenario().
 *   4. Inspect the new verdict against the original verdict.
 *   5. Classify as: resolved / still_failing / inconclusive / execution_failed.
 *   6. Return a RehearsalRerunResult with full traceability.
 *
 * Owner: Reuben (engine)
 * Phase: R08
 */

import type { ScenarioPlan } from '../scenario/model.js';
import type { BehaviorProtectedBehavior } from '../behavior/model.js';
import type { ExecutionTarget } from '../execution/model.js';
import type { RehearsalExecutor } from '../execution/executor.js';
import type { ComparisonInput, BehavioralDifferenceRecord } from '../comparison/model.js';
import { compareScenario, compareAll } from '../comparison/comparator.js';
import type { RepairPlan, RehearsalRerunResult, RerunOutcome } from './model.js';
import { rerunResultId } from './ids.js';
import { EngineError } from '../errors.js';

// ---------------------------------------------------------------------------
// RerunInput
// ---------------------------------------------------------------------------

/**
 * Input required to perform a deterministic re-run for a repair plan.
 */
export interface RerunInput {
  /**
   * The RepairPlan being verified.
   * Must have status 'applied' to proceed with re-run.
   */
  repairPlan: RepairPlan;

  /**
   * The SAME ScenarioPlan that was used in the original rehearsal.
   * R08 reuses this plan — it does not generate a new one.
   */
  scenarioPlan: ScenarioPlan;

  /**
   * Protected behaviors associated with this scenario.
   * Passed verbatim to R06 compareScenario.
   */
  protectedBehaviors: BehaviorProtectedBehavior[];

  /**
   * The R05 executor instance to use for re-execution.
   * R08 calls executor.executeScenarioPair() — no duplication.
   */
  executor: RehearsalExecutor;

  /**
   * The baseline execution target for the re-run.
   */
  baselineTarget: ExecutionTarget;

  /**
   * The candidate execution target for the re-run.
   * This should reflect the post-repair state of the candidate.
   */
  candidateTarget: ExecutionTarget;

  /**
   * The ID of the original R06 BehavioralDifferenceRecord being addressed.
   * Used for traceability and to classify the re-run outcome.
   */
  originalDifferenceId: string;

  /**
   * Parent rehearsal run ID for R05 metadata traceability.
   */
  rehearsalRunId: string;
}

// ---------------------------------------------------------------------------
// performRerun
// ---------------------------------------------------------------------------

/**
 * Execute a deterministic re-run to verify whether a repair resolved a regression.
 *
 * Algorithm:
 *   1. Validate inputs.
 *   2. Execute both sides using the existing R05 executor (same ScenarioPlan).
 *   3. Compare using the existing R06 compareScenario.
 *   4. Classify outcome based on new verdict vs original verdict.
 *   5. Return RehearsalRerunResult with full traceability.
 *
 * Outcome classification:
 *   resolved        — new verdict is NOT REGRESSION (and execution succeeded)
 *   still_failing   — new verdict is still REGRESSION
 *   inconclusive    — new verdict is INCONCLUSIVE (or POTENTIAL_DIFFERENCE without regression behavior link)
 *   execution_failed — R05 executor produced error/blocked/timed_out on either side
 *
 * @throws EngineError('SCENARIO_EXECUTION_FAILED') if executor raises unexpectedly
 */
export async function performRerun(input: RerunInput): Promise<RehearsalRerunResult> {
  const {
    repairPlan,
    scenarioPlan,
    protectedBehaviors,
    executor,
    baselineTarget,
    candidateTarget,
    originalDifferenceId,
    rehearsalRunId,
  } = input;

  const rerunAt = new Date().toISOString();

  // Step 1: Execute both sides using the SAME ScenarioPlan via R05.
  // This reuses the existing RehearsalExecutor — no duplication.
  let pairedResult;
  try {
    pairedResult = await executor.executeScenarioPair(
      scenarioPlan,
      baselineTarget,
      candidateTarget,
      rehearsalRunId,
    );
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : String(err);
    return {
      rerunId: rerunResultId(repairPlan.repairPlanId, scenarioPlan.id, originalDifferenceId),
      repairPlanId: repairPlan.repairPlanId,
      requestId: repairPlan.requestId,
      originalDifferenceId,
      scenarioId: scenarioPlan.id,
      originalVerdict: 'REGRESSION', // Known regression triggered the request
      newComparisonResult: undefined,
      newVerdict: undefined,
      outcome: 'execution_failed',
      outcomeDetail: `Executor threw unexpectedly during re-run: ${detail}`,
      scenarioPlanRef: {
        id: scenarioPlan.id,
        name: scenarioPlan.name,
        seedDataRef: scenarioPlan.seedDataRef,
      },
      rerunAt,
    };
  }

  // Step 2: Classify infrastructure failures before invoking R06.
  // execution_failed = infrastructure failure prevented meaningful comparison.
  const baselineStatus = pairedResult.baseline.status;
  const candidateStatus = pairedResult.candidate.status;
  const infrastructureFailureStatuses = new Set(['error', 'blocked', 'timed_out']);

  if (
    infrastructureFailureStatuses.has(baselineStatus) ||
    infrastructureFailureStatuses.has(candidateStatus)
  ) {
    return {
      rerunId: rerunResultId(repairPlan.repairPlanId, scenarioPlan.id, originalDifferenceId),
      repairPlanId: repairPlan.repairPlanId,
      requestId: repairPlan.requestId,
      originalDifferenceId,
      scenarioId: scenarioPlan.id,
      originalVerdict: 'REGRESSION',
      newComparisonResult: undefined,
      newVerdict: undefined,
      outcome: 'execution_failed',
      outcomeDetail:
        `Re-run execution failed: baseline=${baselineStatus}, candidate=${candidateStatus}. ` +
        'Infrastructure failure prevents behavioral comparison.',
      scenarioPlanRef: {
        id: scenarioPlan.id,
        name: scenarioPlan.name,
        seedDataRef: scenarioPlan.seedDataRef,
      },
      rerunAt,
    };
  }

  // Step 3: Compare using the existing R06 compareScenario — no duplication.
  const comparisonInput: ComparisonInput = {
    pairedResult,
    scenarioPlan,
    protectedBehaviors,
  };
  const newDiff = compareScenario(comparisonInput);
  const newResultSet = compareAll([comparisonInput]);
  const newVerdict = newDiff.verdict;

  // Step 4: Classify outcome based on new verdict.
  const outcome = classifyOutcome(newVerdict);
  const outcomeDetail = buildOutcomeDetail(
    outcome,
    newVerdict,
    originalDifferenceId,
    newDiff,
  );

  return {
    rerunId: rerunResultId(repairPlan.repairPlanId, scenarioPlan.id, originalDifferenceId),
    repairPlanId: repairPlan.repairPlanId,
    requestId: repairPlan.requestId,
    originalDifferenceId,
    scenarioId: scenarioPlan.id,
    originalVerdict: 'REGRESSION',
    newComparisonResult: newResultSet,
    newVerdict,
    outcome,
    outcomeDetail,
    scenarioPlanRef: {
      id: scenarioPlan.id,
      name: scenarioPlan.name,
      seedDataRef: scenarioPlan.seedDataRef,
    },
    rerunAt,
  };
}

// ---------------------------------------------------------------------------
// classifyOutcome
// ---------------------------------------------------------------------------

/**
 * Classify the re-run outcome from a new R06 verdict.
 *
 * Rules:
 *   - 'REGRESSION'           → still_failing (original regression is still present)
 *   - 'INCONCLUSIVE'         → inconclusive (cannot determine)
 *   - 'POTENTIAL_DIFFERENCE' → inconclusive (uncertain; cannot confirm resolved)
 *   - 'PRESERVED'            → resolved (no behavioral difference detected)
 *   - 'INTENTIONAL_CHANGE'   → resolved (difference is now expected/accounted for)
 */
export function classifyOutcome(
  newVerdict: import('../comparison/model.js').ComparisonVerdict,
): RerunOutcome {
  switch (newVerdict) {
    case 'REGRESSION':
      return 'still_failing';
    case 'INCONCLUSIVE':
    case 'POTENTIAL_DIFFERENCE':
      return 'inconclusive';
    case 'PRESERVED':
    case 'INTENTIONAL_CHANGE':
      return 'resolved';
    default:
      return 'inconclusive';
  }
}

// ---------------------------------------------------------------------------
// buildOutcomeDetail
// ---------------------------------------------------------------------------

function buildOutcomeDetail(
  outcome: RerunOutcome,
  newVerdict: import('../comparison/model.js').ComparisonVerdict,
  originalDifferenceId: string,
  diff: BehavioralDifferenceRecord,
): string {
  switch (outcome) {
    case 'resolved':
      return (
        `Re-run R06 comparison produced verdict '${newVerdict}' for scenario '${diff.scenarioId}'. ` +
        `Original regression (${originalDifferenceId}) resolved — no longer detected. ` +
        `Repair verified by deterministic re-run.`
      );
    case 'still_failing':
      return (
        `Re-run R06 comparison still produces REGRESSION for scenario '${diff.scenarioId}'. ` +
        `Original regression (${originalDifferenceId}) persists. ` +
        `Reason: ${diff.summary}`
      );
    case 'inconclusive':
      return (
        `Re-run R06 comparison produced verdict '${newVerdict}' for scenario '${diff.scenarioId}'. ` +
        `Cannot determine whether original regression (${originalDifferenceId}) is resolved. ` +
        `Detail: ${diff.detail}`
      );
    case 'execution_failed':
      return `Execution failed; cannot classify outcome for ${originalDifferenceId}.`;
  }
}
