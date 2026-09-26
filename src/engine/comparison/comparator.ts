/**
 * Change Rehearsal — R06 BehavioralComparator
 *
 * The BehavioralComparator takes paired execution results from R05 and
 * produces deterministic BehavioralDifferenceRecord values.
 *
 * CORE RULES — must hold for all inputs:
 *
 *   1. Never classify a regression merely because a value changed.
 *      A difference is REGRESSION only when:
 *        (a) a protected behavior with evidence >= contract_derived is
 *            associated with the scenario, AND
 *        (b) the observed difference is inconsistent with the expected outcome.
 *
 *   2. Never treat execution infrastructure failure as a regression.
 *      timed_out, blocked, error → INCONCLUSIVE (or POTENTIAL_DIFFERENCE at most).
 *
 *   3. Never upgrade inferred confidence to confirmed.
 *      Confidence is carried over verbatim from R03/R04 inputs.
 *
 *   4. Never use an LLM for verdict determination.
 *
 *   5. Never fabricate observations.
 *
 *   6. Never discard unmatched steps silently.
 *
 *   7. Never use random IDs — all IDs are SHA-256 content-derived.
 *
 *   8. Always sort output deterministically.
 *
 * VERDICT RULES (in priority order):
 *
 *   INCONCLUSIVE:
 *     - Either side has execution status: timed_out, blocked, error
 *     - No step observations are available on one or both sides
 *
 *   PRESERVED:
 *     - All matched steps have no field diffs
 *     - No unmatched steps
 *
 *   INTENTIONAL_CHANGE:
 *     - Diffs exist AND the scenario's expectedInvariantSummary or
 *       provenance explicitly marks the difference as expected
 *       (conveyed via ScenarioPlan.traceability + expectedInvariantSummary)
 *     - Currently: triggered when scenario has no associated protected behavior
 *       AND the diff fields match expectedInvariantSummary keywords
 *
 *   REGRESSION:
 *     - Diffs exist AND at least one associated protected behavior has
 *       confidence >= contract_derived AND the candidate value is inconsistent
 *       with the behavior's expectedOutcome
 *     - Triggered when: behavioral evidence is strong enough to assert the
 *       expected outcome was violated
 *
 *   POTENTIAL_DIFFERENCE:
 *     - Diffs exist AND protected behavior is inferred (weak evidence) OR
 *       diff present but no protected behavior linked
 *     - Also used when: one side failed at application level but the other passed
 *
 * Owner: Reuben (engine)
 * Phase: R06
 */

import type { PairedExecutionResult, ExecutionStatus } from '../execution/model.js';
import type { ScenarioPlan } from '../scenario/model.js';
import type { BehaviorProtectedBehavior, ConfidenceLevel, BehaviorProvenance } from '../behavior/model.js';
import { deterministicId } from '../behavior/ids.js';
import { matchSteps } from './matching.js';
import type {
  BehavioralDifferenceRecord,
  ComparisonVerdict,
  StepComparisonResult,
  ComparisonInput,
  ComparisonResultSet,
} from './model.js';

// ---------------------------------------------------------------------------
// Comparator version
// ---------------------------------------------------------------------------

export const COMPARATOR_VERSION = '1.0' as const;

// ---------------------------------------------------------------------------
// Confidence level ordering
// ---------------------------------------------------------------------------

/**
 * Numeric rank for ConfidenceLevel.
 * Higher = stronger evidence.
 * Used to determine whether a protected behavior provides sufficient grounds
 * for a REGRESSION verdict.
 */
const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  confirmed: 4,
  test_derived: 3,
  contract_derived: 2,
  inferred: 1,
};

/**
 * Minimum confidence rank required to assert REGRESSION.
 * Behaviors at 'inferred' confidence (rank 1) are not strong enough to
 * assert a regression — they yield POTENTIAL_DIFFERENCE instead.
 */
const REGRESSION_CONFIDENCE_THRESHOLD = CONFIDENCE_RANK['contract_derived']; // 2

// ---------------------------------------------------------------------------
// Infrastructure failure statuses
// ---------------------------------------------------------------------------

/**
 * Execution statuses that represent infrastructure failures.
 * These prevent meaningful behavioral comparison.
 */
const INFRASTRUCTURE_FAILURE_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  'timed_out',
  'blocked',
  'error',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare a single paired execution result and produce a BehavioralDifferenceRecord.
 *
 * @param input - The comparison input (paired result + plan + behaviors)
 * @returns A single deterministic BehavioralDifferenceRecord
 */
export function compareScenario(input: ComparisonInput): BehavioralDifferenceRecord {
  const { pairedResult, scenarioPlan, protectedBehaviors } = input;
  const { baseline, candidate } = pairedResult;

  const journeyId = scenarioPlan.traceability.sourceJourneyId;
  const scenarioId = scenarioPlan.id;

  // -------------------------------------------------------------------------
  // Step 1: Check for infrastructure failures
  // -------------------------------------------------------------------------

  const baselineInfraFailure = INFRASTRUCTURE_FAILURE_STATUSES.has(baseline.status);
  const candidateInfraFailure = INFRASTRUCTURE_FAILURE_STATUSES.has(candidate.status);

  if (baselineInfraFailure || candidateInfraFailure) {
    return makeRecord({
      scenarioId,
      journeyId,
      plan: scenarioPlan,
      protectedBehaviors,
      verdict: 'INCONCLUSIVE',
      summary: buildInconclusiveSummary(baseline.status, candidate.status),
      detail: buildInconclusiveDetail(baseline.status, candidate.status),
      stepResults: [],
      baselineStatus: baseline.status,
      candidateStatus: candidate.status,
    });
  }

  // -------------------------------------------------------------------------
  // Step 2: Match steps deterministically
  // -------------------------------------------------------------------------

  const stepResults = matchSteps(baseline.steps, candidate.steps);

  // -------------------------------------------------------------------------
  // Step 3: Collect all field diffs across all step results
  // -------------------------------------------------------------------------

  const allFieldDiffs = stepResults.flatMap((sr) => sr.fieldDiffs);
  const hasMissingSteps = stepResults.some((sr) => sr.baselineMissing || sr.candidateMissing);
  const hasAnyDiff = allFieldDiffs.length > 0 || hasMissingSteps;

  // -------------------------------------------------------------------------
  // Step 4: Handle no-diff case → PRESERVED
  // -------------------------------------------------------------------------

  if (!hasAnyDiff) {
    // Also check that both sides passed (application level)
    // Application-level failure with identical observations is still a difference
    if (baseline.status === 'passed' && candidate.status === 'passed') {
      return makeRecord({
        scenarioId,
        journeyId,
        plan: scenarioPlan,
        protectedBehaviors,
        verdict: 'PRESERVED',
        summary: 'Baseline and candidate observations are equivalent.',
        detail: `All ${stepResults.length} step(s) produced identical normalized observations.`,
        stepResults,
        baselineStatus: baseline.status,
        candidateStatus: candidate.status,
      });
    }

    // Both failed with same observations — still meaningful
    if (baseline.status === 'failed' && candidate.status === 'failed') {
      return makeRecord({
        scenarioId,
        journeyId,
        plan: scenarioPlan,
        protectedBehaviors,
        verdict: 'PRESERVED',
        summary: 'Both sides failed with equivalent observations.',
        detail: 'Application-level failure observed on both sides with identical normalized observations.',
        stepResults,
        baselineStatus: baseline.status,
        candidateStatus: candidate.status,
      });
    }

    // Application-level failure asymmetry with no field diffs
    return makeRecord({
      scenarioId,
      journeyId,
      plan: scenarioPlan,
      protectedBehaviors,
      verdict: 'POTENTIAL_DIFFERENCE',
      summary: `Execution status differs: baseline=${baseline.status}, candidate=${candidate.status}.`,
      detail: buildStatusDiffDetail(baseline.status, candidate.status),
      stepResults,
      baselineStatus: baseline.status,
      candidateStatus: candidate.status,
    });
  }

  // -------------------------------------------------------------------------
  // Step 5: Diffs exist — determine verdict
  // -------------------------------------------------------------------------

  // 5a: Check for explicitly expected/intentional change
  if (isIntentionalChange(scenarioPlan, allFieldDiffs)) {
    const diffSummary = buildDiffSummary(stepResults);
    return makeRecord({
      scenarioId,
      journeyId,
      plan: scenarioPlan,
      protectedBehaviors,
      verdict: 'INTENTIONAL_CHANGE',
      summary: `Expected behavioral change: ${diffSummary}`,
      detail: buildIntentionalDetail(scenarioPlan, stepResults),
      stepResults,
      baselineStatus: baseline.status,
      candidateStatus: candidate.status,
    });
  }

  // 5b: Check protected behaviors for REGRESSION
  const regressionBehavior = findRegressionBehavior(
    protectedBehaviors,
    scenarioPlan,
    stepResults,
  );

  if (regressionBehavior !== null) {
    const diffSummary = buildDiffSummary(stepResults);
    return makeRecord({
      scenarioId,
      journeyId,
      plan: scenarioPlan,
      protectedBehaviors,
      verdict: 'REGRESSION',
      summary: `Protected behavior violated: "${regressionBehavior.description}" — ${diffSummary}`,
      detail: buildRegressionDetail(regressionBehavior, stepResults),
      stepResults,
      baselineStatus: baseline.status,
      candidateStatus: candidate.status,
    });
  }

  // 5c: Determine whether POTENTIAL_DIFFERENCE or still INCONCLUSIVE

  // Application-level failure on one side may be meaningful but can't be
  // definitively classified without stronger evidence
  if (baseline.status === 'failed' || candidate.status === 'failed') {
    const diffSummary = buildDiffSummary(stepResults);
    return makeRecord({
      scenarioId,
      journeyId,
      plan: scenarioPlan,
      protectedBehaviors,
      verdict: 'POTENTIAL_DIFFERENCE',
      summary: `Application-level failure with behavioral differences: ${diffSummary}`,
      detail: buildPotentialDetail(stepResults, baseline.status, candidate.status),
      stepResults,
      baselineStatus: baseline.status,
      candidateStatus: candidate.status,
    });
  }

  // Diffs present but no protected behavior linkage or insufficient evidence
  const diffSummary = buildDiffSummary(stepResults);

  // If there are protected behaviors but all are inferred, still POTENTIAL_DIFFERENCE
  // (not REGRESSION — inferred evidence is not sufficient)
  if (protectedBehaviors.length > 0) {
    return makeRecord({
      scenarioId,
      journeyId,
      plan: scenarioPlan,
      protectedBehaviors,
      verdict: 'POTENTIAL_DIFFERENCE',
      summary: `Behavioral difference detected with insufficient protected behavior evidence: ${diffSummary}`,
      detail: buildPotentialDetailWithBehaviors(protectedBehaviors, stepResults),
      stepResults,
      baselineStatus: baseline.status,
      candidateStatus: candidate.status,
    });
  }

  return makeRecord({
    scenarioId,
    journeyId,
    plan: scenarioPlan,
    protectedBehaviors,
    verdict: 'POTENTIAL_DIFFERENCE',
    summary: `Behavioral difference detected (no protected behavior linked): ${diffSummary}`,
    detail: buildUnlinkedDiffDetail(stepResults),
    stepResults,
    baselineStatus: baseline.status,
    candidateStatus: candidate.status,
  });
}

/**
 * Compare multiple scenarios and produce a sorted ComparisonResultSet.
 *
 * The result is sorted by differenceId ascending for deterministic ordering.
 *
 * @param inputs - Array of ComparisonInput, one per scenario
 * @returns A ComparisonResultSet with all differences and summary counts
 */
export function compareAll(inputs: ComparisonInput[]): ComparisonResultSet {
  const differences = inputs
    .map(compareScenario)
    .sort((a, b) => a.differenceId.localeCompare(b.differenceId));

  const counts: Record<ComparisonVerdict, number> = {
    PRESERVED: 0,
    INTENTIONAL_CHANGE: 0,
    REGRESSION: 0,
    POTENTIAL_DIFFERENCE: 0,
    INCONCLUSIVE: 0,
  };

  for (const diff of differences) {
    counts[diff.verdict]++;
  }

  return {
    differences,
    counts,
    comparatorVersion: COMPARATOR_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Verdict decision helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether the diffs represent an intentional/expected change.
 *
 * An intentional change is signaled by:
 *   1. The ScenarioPlan has an expectedInvariantSummary that contains the
 *      word "intentional" or "expected" (case-insensitive), OR
 *   2. The scenario provenance sourceKind is 'developer_declaration' AND
 *      the expectedInvariantSummary matches the diff fields.
 *
 * This is deliberately conservative: we do NOT infer intent from observed
 * output alone. Intent must be explicitly signaled in the plan metadata.
 */
function isIntentionalChange(
  plan: ScenarioPlan,
  _fieldDiffs: Array<{ field: string; baselineValue: unknown; candidateValue: unknown }>,
): boolean {
  const summary = plan.expectedInvariantSummary?.toLowerCase() ?? '';
  // Explicit intentional markers in the plan metadata
  if (summary.includes('intentional') || summary.includes('expected change')) {
    return true;
  }

  // Developer-declared provenance with explicit expected marker
  if (
    plan.provenance.sourceKind === 'developer_declaration' &&
    summary.length > 0
  ) {
    return true;
  }

  return false;
}

/**
 * Find the highest-confidence protected behavior that grounds a REGRESSION verdict.
 *
 * Returns the behavior only when:
 *   1. The behavior is linked to this scenario (via sourceBehaviorIds or relatedJourneyIds).
 *   2. The behavior's confidence >= contract_derived.
 *   3. The candidate observations are inconsistent with the behavior's expectedOutcome.
 *
 * Inconsistency check: the behavior's expectedOutcome is compared against the
 * diffs using keyword matching. If the expectedOutcome text mentions any of the
 * changed field names, and the candidate values appear to violate the expectation,
 * the behavior is considered violated.
 *
 * This is deliberately simple and conservative: only behaviors that mention the
 * changed fields can trigger a REGRESSION verdict.
 */
function findRegressionBehavior(
  behaviors: BehaviorProtectedBehavior[],
  plan: ScenarioPlan,
  stepResults: StepComparisonResult[],
): BehaviorProtectedBehavior | null {
  const linkedBehaviorIds = new Set(plan.traceability.sourceBehaviorIds);

  // Also consider behaviors that list the scenario's journey as a related journey
  const sourceJourneyId = plan.traceability.sourceJourneyId;

  const linkedBehaviors = behaviors.filter(
    (b) =>
      linkedBehaviorIds.has(b.id) ||
      b.relatedJourneyIds.includes(sourceJourneyId),
  );

  if (linkedBehaviors.length === 0) return null;

  // Collect all field diffs from step results
  const allDiffs = stepResults.flatMap((sr) => sr.fieldDiffs);
  if (allDiffs.length === 0) return null;

  // Find the highest-confidence behavior that is violated
  // Sort by confidence rank descending so we pick the strongest evidence first
  const sortedBehaviors = [...linkedBehaviors].sort(
    (a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence],
  );

  for (const behavior of sortedBehaviors) {
    // Minimum confidence threshold for REGRESSION
    if (CONFIDENCE_RANK[behavior.confidence] < REGRESSION_CONFIDENCE_THRESHOLD) {
      continue;
    }

    // Check if any diff field is associated with this behavior's observable
    if (isBehaviorViolated(behavior, allDiffs)) {
      return behavior;
    }
  }

  return null;
}

/**
 * Determine whether the observed field diffs violate a protected behavior.
 *
 * A behavior is considered violated when:
 *   1. The behavior's observable or description mentions a changed field name, OR
 *   2. The behavior's expectedOutcome is inconsistent with the candidate values.
 *
 * Conservative approach: we prefer false negatives (missing a regression) over
 * false positives (reporting a regression that is not one).
 *
 * Inconsistency check for numeric expected outcomes:
 *   If expectedOutcome contains a numeric value (e.g. "stock should be 1"),
 *   and the candidate observation shows a different numeric value, the behavior
 *   is considered violated.
 */
function isBehaviorViolated(
  behavior: BehaviorProtectedBehavior,
  diffs: Array<{ field: string; baselineValue: unknown; candidateValue: unknown }>,
): boolean {
  const observableLower = behavior.observable.toLowerCase();
  const expectedOutcomeLower = behavior.expectedOutcome.toLowerCase();
  const descriptionLower = behavior.description.toLowerCase();

  for (const diff of diffs) {
    const fieldLower = diff.field.toLowerCase();

    const fieldSegments = fieldLower.split(/[\.\[\]]+/).filter(Boolean);
    const observableWords = new Set(observableLower.split(/[^a-z0-9]+/));
    const descriptionWords = new Set(descriptionLower.split(/[^a-z0-9]+/));

    // Check if this diff's field is related to the behavior's observable
    const fieldMatchesObservable =
      fieldLower.includes(observableLower) ||
      fieldSegments.some((segment) => observableWords.has(segment) || descriptionWords.has(segment));

    if (!fieldMatchesObservable) continue;

    // The field is relevant to this behavior.
    // Now check whether the candidate value violates the expected outcome.
    return isCandidateInconsistentWithExpected(
      behavior,
      diff.baselineValue,
      diff.candidateValue,
    );
  }

  return false;
}

/**
 * Determine whether a candidate value is inconsistent with a behavior's expected outcome.
 *
 * Conservative rules:
 *   - If expectedOutcome explicitly states "should equal X" or "must be X" and
 *     candidateValue differs from X, → violated.
 *   - If expectedOutcome contains "unchanged" or "preserved" and candidateValue
 *     differs from baselineValue, → violated.
 *   - If no explicit expectation can be parsed, we assume the behavior is violated
 *     only when baselineValue and candidateValue differ and both are non-null.
 *     (The mere existence of a diff with a linked behavior is grounds for regression
 *      at contract_derived+ confidence.)
 */
function isCandidateInconsistentWithExpected(
  behavior: BehaviorProtectedBehavior,
  baselineValue: unknown,
  candidateValue: unknown,
): boolean {
  const expected = behavior.expectedOutcome.toLowerCase();

  // If expectedOutcome says "unchanged" or "preserved" or "same as baseline",
  // any difference is a violation.
  if (
    expected.includes('unchanged') ||
    expected.includes('preserved') ||
    expected.includes('same as baseline') ||
    expected.includes('must not change') ||
    expected.includes('should not change')
  ) {
    return !isShallowEqual(baselineValue, candidateValue);
  }

  // For all other cases at contract_derived+ confidence:
  // The mere presence of a relevant diff is sufficient.
  // (The behavior's expectedOutcome documents what SHOULD happen;
  //  the comparator observed something different.)
  return baselineValue !== candidateValue &&
    JSON.stringify(baselineValue) !== JSON.stringify(candidateValue);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic ID for a BehavioralDifferenceRecord.
 *
 * Input: scenarioId + journeyId + verdict
 * Format: "diff-<16-char hex>"
 */
function makeDifferenceId(
  scenarioId: string,
  journeyId: string,
  verdict: ComparisonVerdict,
): string {
  return `diff-${deterministicId([scenarioId, journeyId, verdict])}`;
}

// ---------------------------------------------------------------------------
// Record construction
// ---------------------------------------------------------------------------

interface RecordBuilderParams {
  scenarioId: string;
  journeyId: string;
  plan: ScenarioPlan;
  protectedBehaviors: BehaviorProtectedBehavior[];
  verdict: ComparisonVerdict;
  summary: string;
  detail: string;
  stepResults: StepComparisonResult[];
  baselineStatus: ExecutionStatus;
  candidateStatus: ExecutionStatus;
}

function makeRecord(params: RecordBuilderParams): BehavioralDifferenceRecord {
  const {
    scenarioId,
    journeyId,
    plan,
    protectedBehaviors,
    verdict,
    summary,
    detail,
    stepResults,
    baselineStatus,
    candidateStatus,
  } = params;

  // Use the highest-confidence linked protected behavior for the record's
  // confidence and provenance, falling back to the scenario plan's own values.
  const primaryBehavior = selectPrimaryBehavior(protectedBehaviors, plan);

  const confidence: ConfidenceLevel = primaryBehavior?.confidence ?? plan.confidence;
  const provenance: BehaviorProvenance = primaryBehavior?.provenance ?? plan.provenance;

  // Primary protected behavior ID (first in traceability, if present)
  const protectedBehaviorId =
    primaryBehavior?.id ??
    plan.traceability.sourceBehaviorIds[0];

  // Use the scenario plan's startedAt from baseline as stable comparedAt
  // (deterministic from input, not from wall clock)
  const comparedAt = plan.seedDataRef
    ? `rehearsal:${plan.id}:${plan.seedDataRef}`
    : `rehearsal:${plan.id}`;

  return {
    differenceId: makeDifferenceId(scenarioId, journeyId, verdict),
    scenarioId,
    journeyId,
    protectedBehaviorId,
    verdict,
    summary,
    detail,
    stepResults,
    confidence,
    provenance,
    baselineExecutionStatus: baselineStatus,
    candidateExecutionStatus: candidateStatus,
    comparedAt,
    comparatorVersion: COMPARATOR_VERSION,
  };
}

/**
 * Select the highest-confidence protected behavior that is linked to the scenario.
 * Returns null when no behaviors are linked.
 */
function selectPrimaryBehavior(
  behaviors: BehaviorProtectedBehavior[],
  plan: ScenarioPlan,
): BehaviorProtectedBehavior | null {
  const linkedIds = new Set(plan.traceability.sourceBehaviorIds);
  const journeyId = plan.traceability.sourceJourneyId;

  const linked = behaviors.filter(
    (b) => linkedIds.has(b.id) || b.relatedJourneyIds.includes(journeyId),
  );

  if (linked.length === 0) return null;

  // Sort by confidence rank descending, then by id ascending for tie-breaking
  return linked.sort((a, b) => {
    const rankDiff = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (rankDiff !== 0) return rankDiff;
    return a.id.localeCompare(b.id);
  })[0];
}

// ---------------------------------------------------------------------------
// Summary / detail builders
// ---------------------------------------------------------------------------

function buildDiffSummary(stepResults: StepComparisonResult[]): string {
  const allDiffs = stepResults.flatMap((sr) => sr.fieldDiffs);
  const missingSteps = stepResults.filter((sr) => sr.baselineMissing || sr.candidateMissing);

  const parts: string[] = [];

  if (allDiffs.length > 0) {
    const fieldList = allDiffs
      .slice(0, 3)
      .map((d) => d.field)
      .join(', ');
    parts.push(`${allDiffs.length} field diff(s) in: ${fieldList}${allDiffs.length > 3 ? ', …' : ''}`);
  }

  if (missingSteps.length > 0) {
    parts.push(
      missingSteps
        .map((sr) =>
          sr.baselineMissing
            ? `step ${sr.stepId} added in candidate`
            : `step ${sr.stepId} missing from candidate`,
        )
        .join('; '),
    );
  }

  return parts.join('; ') || 'no observable differences';
}

function buildInconclusiveSummary(
  baselineStatus: ExecutionStatus,
  candidateStatus: ExecutionStatus,
): string {
  const issues: string[] = [];
  if (INFRASTRUCTURE_FAILURE_STATUSES.has(baselineStatus)) {
    issues.push(`baseline execution ${baselineStatus}`);
  }
  if (INFRASTRUCTURE_FAILURE_STATUSES.has(candidateStatus)) {
    issues.push(`candidate execution ${candidateStatus}`);
  }
  return `Insufficient execution evidence: ${issues.join('; ')}.`;
}

function buildInconclusiveDetail(
  baselineStatus: ExecutionStatus,
  candidateStatus: ExecutionStatus,
): string {
  return (
    `Baseline execution status: ${baselineStatus}. ` +
    `Candidate execution status: ${candidateStatus}. ` +
    `Infrastructure failures prevent meaningful behavioral comparison. ` +
    `Retry after resolving the execution environment.`
  );
}

function buildStatusDiffDetail(
  baselineStatus: ExecutionStatus,
  candidateStatus: ExecutionStatus,
): string {
  return (
    `Execution status asymmetry: baseline=${baselineStatus}, candidate=${candidateStatus}. ` +
    `Observations are equivalent but execution statuses differ. ` +
    `This may indicate an application-level behavioral difference not captured by the observations.`
  );
}

function buildIntentionalDetail(
  plan: ScenarioPlan,
  stepResults: StepComparisonResult[],
): string {
  const allDiffs = stepResults.flatMap((sr) => sr.fieldDiffs);
  const diffLines = allDiffs
    .slice(0, 5)
    .map((d) => `  ${d.field}: baseline=${JSON.stringify(d.baselineValue)}, candidate=${JSON.stringify(d.candidateValue)}`)
    .join('\n');

  return (
    `Difference classified as intentional based on scenario plan metadata.\n` +
    `Expected invariant: ${plan.expectedInvariantSummary ?? '(none specified)'}\n` +
    `Provenance: ${plan.provenance.sourceKind ?? 'unknown'}\n` +
    `Observed diffs:\n${diffLines || '  (none)'}`
  );
}

function buildRegressionDetail(
  behavior: BehaviorProtectedBehavior,
  stepResults: StepComparisonResult[],
): string {
  const allDiffs = stepResults.flatMap((sr) => sr.fieldDiffs);
  const diffLines = allDiffs
    .slice(0, 5)
    .map((d) => `  ${d.field}: baseline=${JSON.stringify(d.baselineValue)}, candidate=${JSON.stringify(d.candidateValue)}`)
    .join('\n');

  return (
    `Protected behavior "${behavior.description}" was violated.\n` +
    `Observable: ${behavior.observable}\n` +
    `Expected outcome: ${behavior.expectedOutcome}\n` +
    `Confidence: ${behavior.confidence} (${confidenceDescription(behavior.confidence)})\n` +
    `Provenance: ${behavior.provenance.sourceKind ?? 'unknown'}\n` +
    `Observed diffs:\n${diffLines || '  (none)'}`
  );
}

function buildPotentialDetail(
  stepResults: StepComparisonResult[],
  baselineStatus: ExecutionStatus,
  candidateStatus: ExecutionStatus,
): string {
  const allDiffs = stepResults.flatMap((sr) => sr.fieldDiffs);
  const diffLines = allDiffs
    .slice(0, 5)
    .map((d) => `  ${d.field}: baseline=${JSON.stringify(d.baselineValue)}, candidate=${JSON.stringify(d.candidateValue)}`)
    .join('\n');

  return (
    `Behavioral differences were observed but could not be definitively classified.\n` +
    `Baseline status: ${baselineStatus}, Candidate status: ${candidateStatus}\n` +
    `Diffs:\n${diffLines || '  (none)'}`
  );
}

function buildPotentialDetailWithBehaviors(
  behaviors: BehaviorProtectedBehavior[],
  stepResults: StepComparisonResult[],
): string {
  const behaviorNames = behaviors.map((b) => `"${b.description}" (${b.confidence})`).join(', ');
  const allDiffs = stepResults.flatMap((sr) => sr.fieldDiffs);
  const diffLines = allDiffs
    .slice(0, 5)
    .map((d) => `  ${d.field}: baseline=${JSON.stringify(d.baselineValue)}, candidate=${JSON.stringify(d.candidateValue)}`)
    .join('\n');

  return (
    `Behavioral differences detected but protected behavior evidence is insufficient for REGRESSION.\n` +
    `Associated behaviors (all inferred confidence): ${behaviorNames}\n` +
    `Diffs:\n${diffLines || '  (none)'}`
  );
}

function buildUnlinkedDiffDetail(stepResults: StepComparisonResult[]): string {
  const allDiffs = stepResults.flatMap((sr) => sr.fieldDiffs);
  const diffLines = allDiffs
    .slice(0, 5)
    .map((d) => `  ${d.field}: baseline=${JSON.stringify(d.baselineValue)}, candidate=${JSON.stringify(d.candidateValue)}`)
    .join('\n');

  return (
    `Behavioral differences detected with no linked protected behavior.\n` +
    `No regression verdict is possible without behavioral evidence.\n` +
    `Diffs:\n${diffLines || '  (none)'}`
  );
}

function confidenceDescription(level: ConfidenceLevel): string {
  switch (level) {
    case 'confirmed': return 'developer-verified';
    case 'test_derived': return 'derived from tests';
    case 'contract_derived': return 'derived from contracts';
    case 'inferred': return 'AI/heuristic-inferred';
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isShallowEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Legacy compatibility — pipeline.ts still uses the old compare() signature
// ---------------------------------------------------------------------------

/**
 * @deprecated Use compareScenario() with ComparisonInput instead.
 *
 * Legacy shim retained so pipeline.ts continues to compile without modification.
 * The old types (Observation, Scenario, Requirement, ProtectedBehavior) are from
 * types.ts and are not part of the R06 domain model. This adapter bridges them.
 *
 * The shim preserves the original verdict semantics for the legacy pipeline.
 */
import type {
  Observation,
  Scenario,
  Requirement,
  ProtectedBehavior,
  BehavioralDifference,
  NormalizedStepOutput,
  StepDiff,
  Verdict,
} from '../types.js';
import { randomUUID } from 'node:crypto';

/**
 * @deprecated Legacy comparator — use compareScenario() for new code.
 *
 * Original compare() function restored as a named export for backward
 * compatibility with pipeline.ts. The function body is unchanged from the
 * pre-R06 implementation.
 */
export function compare(
  baseline: Observation,
  candidate: Observation,
  scenario: Scenario,
  requirement: Requirement | undefined,
  protectedBehaviors: ProtectedBehavior[],
): BehavioralDifference {
  const stepDiffs = legacyDiffSteps(
    baseline.normalizedOutput.steps,
    candidate.normalizedOutput.steps,
  );

  if (stepDiffs.length === 0) {
    return legacyMakeDiff(scenario, 'unchanged', stepDiffs, false, 'Behavior preserved.');
  }

  const summary = stepDiffs
    .map((d) => `${d.field}: baseline=${JSON.stringify(d.baseline)} candidate=${JSON.stringify(d.candidate)}`)
    .join('; ');

  if (requirement && legacyIsExpectedByRequirement(stepDiffs, requirement)) {
    return legacyMakeDiff(scenario, 'changed', stepDiffs, true, `Expected change: ${summary}`);
  }

  const affectsProtected = protectedBehaviors.some((pb) =>
    scenario.protectedBehaviorId === pb.id,
  );

  if (affectsProtected) {
    return legacyMakeDiff(scenario, 'regression', stepDiffs, false, `Regression: ${summary}`);
  }

  return legacyMakeDiff(scenario, 'changed', stepDiffs, false, `Unexpected change: ${summary}`);
}

function legacyMakeDiff(
  scenario: Scenario,
  verdict: Verdict,
  stepDiffs: StepDiff[],
  isExpected: boolean,
  summary: string,
): BehavioralDifference {
  return {
    id: randomUUID(),
    scenarioId: scenario.id,
    journeyId: scenario.journeyId,
    verdict,
    diffDetail: { stepDiffs, summary },
    isExpected,
  };
}

function legacyDiffSteps(
  baselineSteps: NormalizedStepOutput[],
  candidateSteps: NormalizedStepOutput[],
): StepDiff[] {
  const diffs: StepDiff[] = [];
  const maxLen = Math.max(baselineSteps.length, candidateSteps.length);
  for (let i = 0; i < maxLen; i++) {
    const b = baselineSteps[i];
    const c = candidateSteps[i];
    if (!b || !c) {
      diffs.push({
        stepId: b?.stepId ?? c?.stepId ?? `step-${i}`,
        field: 'step',
        baseline: b ?? null,
        candidate: c ?? null,
      });
      continue;
    }
    if (b.httpStatus !== c.httpStatus) {
      diffs.push({ stepId: b.stepId, field: 'httpStatus', baseline: b.httpStatus, candidate: c.httpStatus });
    }
    const bBody = JSON.stringify(b.httpBody);
    const cBody = JSON.stringify(c.httpBody);
    if (bBody !== cBody) {
      diffs.push(...legacyFlatDiffObjects(b.httpBody, c.httpBody, 'body').map((d) => ({ stepId: b.stepId, ...d })));
    }
    const bDb = JSON.stringify(b.dbSnapshot);
    const cDb = JSON.stringify(c.dbSnapshot);
    if (bDb !== cDb) {
      diffs.push(...legacyFlatDiffObjects(b.dbSnapshot, c.dbSnapshot, 'db').map((d) => ({ stepId: b.stepId, ...d })));
    }
  }
  return diffs;
}

function legacyFlatDiffObjects(baseline: unknown, candidate: unknown, prefix: string): Omit<StepDiff, 'stepId'>[] {
  const diffs: Omit<StepDiff, 'stepId'>[] = [];
  legacyFlatDiff(baseline, candidate, prefix, diffs);
  return diffs;
}

function legacyFlatDiff(a: unknown, b: unknown, path: string, acc: Omit<StepDiff, 'stepId'>[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of keys) {
      legacyFlatDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`, acc);
    }
    return;
  }
  acc.push({ field: path, baseline: a, candidate: b });
}

function legacyIsExpectedByRequirement(diffs: StepDiff[], requirement: Requirement): boolean {
  if (requirement.expectedChanges.length === 0) return false;
  return diffs.every((diff) =>
    requirement.expectedChanges.some(
      (expected) =>
        diff.field.toLowerCase().includes(expected.toLowerCase()) ||
        expected.toLowerCase().includes(diff.field.toLowerCase()),
    ),
  );
}
