/**
 * Change Rehearsal — R07 Evidence Capsule Builder
 *
 * Transforms deterministic R05/R06 evidence into a compact EvidenceCapsule.
 *
 * Core guarantees:
 *   - R07 NEVER changes R06 verdicts — preserved exactly.
 *   - R07 NEVER invents observations — all evidence traces to R05/R06 inputs.
 *   - R07 NEVER invents protected behavior — provenance preserved verbatim.
 *   - Capsule IDs are deterministic (content-derived, no randomness).
 *   - Secrets remain scrubbed — R05 normalization boundary is respected.
 *   - Same inputs → same capsule (deterministic ordering throughout).
 *
 * Owner: Reuben (engine)
 * Phase: R07
 */

import { createHash } from 'node:crypto';
import type {
  EvidenceCapsule,
  EvidenceRecord,
  ObservationSnapshot,
  ScenarioSummary,
  JourneyRef,
  BehaviorRef,
  CapsuleSummary,
} from './model.js';
import { EVIDENCE_CAPSULE_SCHEMA_VERSION } from './model.js';
import type { BehavioralDifferenceRecord, ComparisonVerdict } from '../comparison/model.js';
import type { PairedExecutionResult, StepExecutionResult } from '../execution/model.js';
import type { ScenarioPlan } from '../scenario/model.js';
import type { BehaviorProtectedBehavior } from '../behavior/model.js';

// ---------------------------------------------------------------------------
// Capsule Input
// ---------------------------------------------------------------------------

/**
 * The full set of inputs required by the CapsuleBuilder to produce an EvidenceCapsule.
 *
 * Mirrors the pipeline hand-off: R05 PairedExecutionResults + R06 differences.
 */
export interface CapsuleInput {
  /** The rehearsal run identifier */
  rehearsalRunId: string;

  /** Human-readable summary of what changed (from change analysis) */
  changeSummary: string;

  /** Human-readable summary of the requirement (optional) */
  requirementSummary?: string;

  /** All paired execution results from R05 (one per scenario) */
  pairedResults: PairedExecutionResult[];

  /** All behavioral difference records from R06 */
  differences: BehavioralDifferenceRecord[];

  /** Scenario plans from R04 (used for metadata and traceability) */
  scenarioPlans: ScenarioPlan[];

  /** Protected behaviors from R03 (used for metadata and traceability) */
  protectedBehaviors: BehaviorProtectedBehavior[];

  /**
   * Journey metadata map.
   * Keys are journey IDs; values carry name and description.
   * Used to populate JourneyRef entries without requiring Journey model changes.
   */
  journeyMetadata?: Map<string, { journeyId: string; name: string; description: string }>;

  /** ISO 8601 timestamp for the capsule's createdAt field. Defaults to now. */
  createdAt?: string;

  /** Additional metadata to attach to the capsule */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Deterministic ID
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic capsule ID from the rehearsal run ID and the
 * sorted list of difference IDs.
 *
 * The same set of differences always produces the same capsule ID.
 */
export function makeCapsuleId(rehearsalRunId: string, differenceIds: string[]): string {
  const sortedIds = [...differenceIds].sort();
  const canonical = [rehearsalRunId, ...sortedIds].join('\x00');
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
  return `capsule-${hex}`;
}

/**
 * Produce a deterministic evidence record ID from differenceId + scenarioId.
 */
function makeEvidenceId(differenceId: string, scenarioId: string): string {
  const canonical = [differenceId, scenarioId].join('\x00');
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
  return `evidence-${hex}`;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

/**
 * Extract ObservationSnapshot array from a list of StepExecutionResults.
 *
 * Preserves only the normalized (scrubbed) observations from R05.
 * Never exposes raw sensitive values.
 */
function extractObservationSnapshots(steps: StepExecutionResult[]): ObservationSnapshot[] {
  return [...steps]
    .sort((a, b) => a.sequence - b.sequence)
    .map((step) => ({
      stepId: step.stepId,
      sequence: step.sequence,
      status: step.status,
      // Only normalized observations — raw values stay in R05's domain
      observations: step.observations.map((obs) => ({
        kind: obs.kind,
        // Only include normalizedValue, NOT the raw .value field
        // This preserves the R05 scrubbing boundary.
        value: obs.normalizedValue,
        normalizedValue: obs.normalizedValue,
        source: obs.source,
        ...(obs.metadata !== undefined ? { metadata: obs.metadata } : {}),
      })),
    }));
}

// ---------------------------------------------------------------------------
// Evidence Record Builder
// ---------------------------------------------------------------------------

/**
 * Build a single EvidenceRecord from a BehavioralDifferenceRecord and
 * the corresponding PairedExecutionResult.
 *
 * R06 verdict is preserved exactly — never reinterpreted.
 * Baseline/candidate observations come directly from R05.
 */
function buildEvidenceRecord(
  diff: BehavioralDifferenceRecord,
  paired: PairedExecutionResult | undefined,
): EvidenceRecord {
  const evidenceId = makeEvidenceId(diff.differenceId, diff.scenarioId);

  // Extract all field-level diffs from all step results
  const fieldDiffs = diff.stepResults.flatMap((sr) => sr.fieldDiffs);

  // Find the primary step (first step with field diffs, or first step overall)
  const primaryStep =
    diff.stepResults.find((sr) => sr.fieldDiffs.length > 0) ?? diff.stepResults[0];

  // Baseline and candidate observations from R05 PairedExecutionResult
  // If paired is not provided (e.g. unexercised scenario), use empty arrays
  const baselineObservations: ObservationSnapshot[] = paired
    ? extractObservationSnapshots(paired.baseline.steps)
    : [];
  const candidateObservations: ObservationSnapshot[] = paired
    ? extractObservationSnapshots(paired.candidate.steps)
    : [];

  return {
    evidenceId,
    differenceId: diff.differenceId,
    scenarioId: diff.scenarioId,
    journeyId: diff.journeyId,
    ...(primaryStep !== undefined ? { primaryStepId: primaryStep.stepId } : {}),
    ...(diff.protectedBehaviorId !== undefined
      ? { protectedBehaviorId: diff.protectedBehaviorId }
      : {}),
    verdict: diff.verdict, // PRESERVED EXACTLY — R07 never changes R06 verdicts
    baselineObservations,
    candidateObservations,
    // Sort field diffs by field name for deterministic ordering
    fieldDiffs: [...fieldDiffs].sort((a, b) => a.field.localeCompare(b.field)),
    reason: diff.summary,
    detail: diff.detail,
    confidence: diff.confidence, // PRESERVED verbatim
    provenance: diff.provenance, // PRESERVED verbatim
    baselineExecutionStatus: diff.baselineExecutionStatus,
    candidateExecutionStatus: diff.candidateExecutionStatus,
  };
}

// ---------------------------------------------------------------------------
// Scenario Summary Builder
// ---------------------------------------------------------------------------

function buildScenarioSummary(plan: ScenarioPlan): ScenarioSummary {
  return {
    scenarioId: plan.id,
    name: plan.name,
    description: plan.description,
    confidence: plan.confidence,
    journeyId: plan.traceability.sourceJourneyId,
    behaviorIds: [...plan.traceability.sourceBehaviorIds].sort(),
  };
}

// ---------------------------------------------------------------------------
// Journey Ref Builder
// ---------------------------------------------------------------------------

/**
 * Build JourneyRef entries from differences and journey metadata.
 *
 * Deduplicates by journeyId. Sorted by journeyId ascending.
 */
function buildJourneyRefs(
  differences: BehavioralDifferenceRecord[],
  journeyMetadata: Map<string, { journeyId: string; name: string; description: string }>,
): JourneyRef[] {
  const seen = new Map<string, JourneyRef>();

  for (const diff of differences) {
    if (!seen.has(diff.journeyId)) {
      const meta = journeyMetadata.get(diff.journeyId);
      seen.set(diff.journeyId, {
        journeyId: diff.journeyId,
        journeyName: meta?.name ?? diff.journeyId,
        description: meta?.description ?? '',
      });
    }
  }

  return [...seen.values()].sort((a, b) => a.journeyId.localeCompare(b.journeyId));
}

// ---------------------------------------------------------------------------
// Behavior Ref Builder
// ---------------------------------------------------------------------------

/**
 * Build BehaviorRef entries from the protected behaviors linked to scenarios.
 *
 * Deduplicates by behaviorId. Sorted by behaviorId ascending.
 */
function buildBehaviorRefs(
  differences: BehavioralDifferenceRecord[],
  protectedBehaviors: BehaviorProtectedBehavior[],
): BehaviorRef[] {
  const linkedIds = new Set(
    differences
      .map((d) => d.protectedBehaviorId)
      .filter((id): id is string => id !== undefined),
  );

  const behaviorMap = new Map(protectedBehaviors.map((b) => [b.id, b]));
  const refs: BehaviorRef[] = [];

  for (const id of [...linkedIds].sort()) {
    const behavior = behaviorMap.get(id);
    if (behavior) {
      refs.push({
        behaviorId: behavior.id,
        description: behavior.description,
        confidence: behavior.confidence,
        provenance: behavior.provenance,
      });
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Capsule Summary Builder
// ---------------------------------------------------------------------------

function buildCapsuleSummary(
  differences: BehavioralDifferenceRecord[],
  pairedResults: PairedExecutionResult[],
): CapsuleSummary {
  const counts: Record<ComparisonVerdict, number> = {
    PRESERVED: 0,
    INTENTIONAL_CHANGE: 0,
    REGRESSION: 0,
    POTENTIAL_DIFFERENCE: 0,
    INCONCLUSIVE: 0,
  };

  for (const diff of differences) {
    counts[diff.verdict] = (counts[diff.verdict] ?? 0) + 1;
  }

  const executionFailures = pairedResults.filter(
    (p) =>
      p.baseline.status === 'error' ||
      p.baseline.status === 'blocked' ||
      p.candidate.status === 'error' ||
      p.candidate.status === 'blocked',
  ).length;

  const overallVerdict: CapsuleSummary['overallVerdict'] =
    counts.REGRESSION > 0
      ? 'REGRESSION_DETECTED'
      : counts.POTENTIAL_DIFFERENCE > 0 ||
          counts.INCONCLUSIVE > 0 ||
          executionFailures > 0
        ? 'REVIEW_REQUIRED'
        : 'PASS';

  return {
    totalScenarios: pairedResults.length,
    totalDifferences: differences.length,
    preserved: counts.PRESERVED,
    intentionalChanges: counts.INTENTIONAL_CHANGE,
    regressions: counts.REGRESSION,
    potentialDifferences: counts.POTENTIAL_DIFFERENCE,
    inconclusive: counts.INCONCLUSIVE,
    executionFailures,
    overallVerdict,
  };
}

// ---------------------------------------------------------------------------
// Public API — buildCapsule
// ---------------------------------------------------------------------------

/**
 * Build a deterministic EvidenceCapsule from R05/R06 evidence.
 *
 * R07 contract:
 *   - Does NOT execute scenarios.
 *   - Does NOT compare baseline and candidate.
 *   - Does NOT generate new regression verdicts.
 *   - Presents and preserves R06 verdicts exactly.
 *
 * The same inputs always produce the same capsule (excluding createdAt).
 */
export function buildCapsule(input: CapsuleInput): EvidenceCapsule {
  const {
    rehearsalRunId,
    changeSummary,
    requirementSummary,
    pairedResults,
    differences,
    scenarioPlans,
    protectedBehaviors,
    createdAt = new Date().toISOString(),
    metadata,
  } = input;

  // Build a lookup map for paired results (keyed by scenarioId)
  const pairedMap = new Map(pairedResults.map((p) => [p.scenarioId, p]));

  // Build journey metadata from scenario plans if not provided
  const journeyMeta: Map<string, { journeyId: string; name: string; description: string }> =
    input.journeyMetadata ??
    new Map(
      scenarioPlans.map((plan) => [
        plan.traceability.sourceJourneyId,
        {
          journeyId: plan.traceability.sourceJourneyId,
          name: plan.traceability.sourceJourneyName,
          description: plan.description,
        },
      ]),
    );

  // Sort differences deterministically (by differenceId ascending)
  const sortedDifferences = [...differences].sort((a, b) =>
    a.differenceId.localeCompare(b.differenceId),
  );

  // Build evidence records — one per difference
  const evidenceRecords = sortedDifferences.map((diff) =>
    buildEvidenceRecord(diff, pairedMap.get(diff.scenarioId)),
  );

  // Sort scenario summaries by scenarioId ascending
  const scenarioSummaries = [...scenarioPlans]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(buildScenarioSummary);

  // Build journey and behavior refs
  const journeyRefs = buildJourneyRefs(sortedDifferences, journeyMeta);
  const behaviorRefs = buildBehaviorRefs(sortedDifferences, protectedBehaviors);

  // Build summary
  const summary = buildCapsuleSummary(sortedDifferences, pairedResults);

  // Deterministic capsule ID (not dependent on createdAt)
  const capsuleId = makeCapsuleId(
    rehearsalRunId,
    sortedDifferences.map((d) => d.differenceId),
  );

  return {
    capsuleId,
    rehearsalRunId,
    createdAt, // runtime timestamp — allowed for metadata; not used for ID
    changeSummary,
    ...(requirementSummary !== undefined ? { requirementSummary } : {}),
    scenarioSummaries,
    journeyRefs,
    behaviorRefs,
    evidenceRecords,
    summary,
    schemaVersion: EVIDENCE_CAPSULE_SCHEMA_VERSION,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
