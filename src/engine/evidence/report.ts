/**
 * Change Rehearsal — R07 Regression Report Builder
 *
 * Builds a developer-readable RehearsalReport from an EvidenceCapsule.
 *
 * Contract compliance:
 *   - Uses F-04 field names: rehearsal_run_id, behavioral_diff_rows, capsule_ref
 *   - behavioral_diff_rows uses lower_snake_case verdict values from F-04 Verdict type
 *   - capsule_ref shape matches report-contract.schema.json
 *   - R06 verdicts are preserved exactly — never reinterpreted by R07
 *
 * Verdict mapping (ComparisonVerdict → F-04 Verdict):
 *   PRESERVED           → "preserved"
 *   INTENTIONAL_CHANGE  → "intentional_change"
 *   REGRESSION          → "regression"
 *   POTENTIAL_DIFFERENCE → "potentially_affected"
 *   INCONCLUSIVE        → "not_exercised"  (closest F-04 equivalent for unresolved)
 *
 * Owner: Reuben (engine)
 * Phase: R07
 */

import type { EvidenceCapsule, EvidenceRecord } from './model.js';
import type { ComparisonVerdict } from '../comparison/model.js';
import type {
  RehearsalReport,
  BehavioralDiffRow,
  Verdict,
  Regression,
  ReportSummary,
  FinalVerdict,
  RegressionEvidence,
  Observation,
  ProtectedBehavior,
  ConfidenceLevel,
  Journey,
  JourneyStep,
} from '../../shared/contracts.js';

// ---------------------------------------------------------------------------
// Verdict mapping
// ---------------------------------------------------------------------------

/**
 * Map a R06 ComparisonVerdict to an F-04 Verdict.
 *
 * R07 rule: the R06 verdict is preserved exactly.
 * This is a terminology translation only — not a reinterpretation.
 */
export function mapVerdict(cv: ComparisonVerdict): Verdict {
  switch (cv) {
    case 'PRESERVED':
      return 'preserved';
    case 'INTENTIONAL_CHANGE':
      return 'intentional_change';
    case 'REGRESSION':
      return 'regression';
    case 'POTENTIAL_DIFFERENCE':
      return 'potentially_affected';
    case 'INCONCLUSIVE':
      return 'not_exercised';
    default: {
      const _exhaustive: never = cv;
      return 'not_exercised';
    }
  }
}

/**
 * Map an F-04 Verdict back to ComparisonVerdict.
 * Used for round-trip tests.
 */
export function unmapVerdict(v: Verdict): ComparisonVerdict {
  switch (v) {
    case 'preserved':
      return 'PRESERVED';
    case 'intentional_change':
      return 'INTENTIONAL_CHANGE';
    case 'regression':
      return 'REGRESSION';
    case 'potentially_affected':
      return 'POTENTIAL_DIFFERENCE';
    case 'not_exercised':
      return 'INCONCLUSIVE';
    default: {
      const _exhaustive: never = v;
      return 'INCONCLUSIVE';
    }
  }
}

// ---------------------------------------------------------------------------
// FinalVerdict determination
// ---------------------------------------------------------------------------

function buildFinalVerdict(capsule: EvidenceCapsule): FinalVerdict {
  const { regressions, executionFailures } = capsule.summary;
  if (executionFailures > 0) return 'build_failed';
  if (regressions > 0) return 'review_required';
  return 'ready_to_merge';
}

// ---------------------------------------------------------------------------
// BehavioralDiffRow builder
// ---------------------------------------------------------------------------

function buildDiffRow(
  record: EvidenceRecord,
  capsule: EvidenceCapsule,
): BehavioralDiffRow {
  // Find the behavior ref for this evidence record (if any)
  const behaviorRef = record.protectedBehaviorId
    ? capsule.behaviorRefs.find((b) => b.behaviorId === record.protectedBehaviorId)
    : undefined;

  // Find the journey ref
  const journeyRef = capsule.journeyRefs.find((j) => j.journeyId === record.journeyId);

  // Confidence level comes from the evidence record (from R06, originally from R03)
  const confidenceLevel = record.confidence;

  const row: BehavioralDiffRow = {
    journey_id: record.journeyId,
    journey_name: journeyRef?.journeyName ?? record.journeyId,
    verdict: mapVerdict(record.verdict), // R06 verdict preserved exactly
    is_expected_change: record.verdict === 'INTENTIONAL_CHANGE',
    scenario_id: record.scenarioId,
    evidence_id: record.evidenceId,
    ...(behaviorRef !== undefined
      ? {
          protected_behavior_id: behaviorRef.behaviorId,
          protected_behavior_source: behaviorRef.confidence as ConfidenceLevel,
          protected_behavior_confidence: confidenceLevelToScore(behaviorRef.confidence),
        }
      : {}),
  };

  return row;
}

/**
 * Convert a ConfidenceLevel string to the numeric 0.0–1.0 score used in ProtectedBehavior.
 */
function confidenceLevelToScore(level: string): number {
  switch (level) {
    case 'confirmed': return 1.0;
    case 'test_derived': return 0.75;
    case 'contract_derived': return 0.5;
    case 'inferred': return 0.25;
    default: return 0.0;
  }
}

// ---------------------------------------------------------------------------
// Regression builder
// ---------------------------------------------------------------------------

function buildRegressionEntry(
  record: EvidenceRecord,
  capsule: EvidenceCapsule,
  index: number,
): Regression {
  const behaviorRef = record.protectedBehaviorId
    ? capsule.behaviorRefs.find((b) => b.behaviorId === record.protectedBehaviorId)
    : undefined;

  const journeyRef = capsule.journeyRefs.find((j) => j.journeyId === record.journeyId);

  // Build the observations for the RegressionEvidence
  const baselineObs: Observation = {
    side: 'baseline',
    raw_output: JSON.stringify(record.baselineObservations),
    normalized_output: buildNormalizedOutput(record.baselineObservations),
    captured_at: new Date().toISOString(),
  };

  const candidateObs: Observation = {
    side: 'candidate',
    raw_output: JSON.stringify(record.candidateObservations),
    normalized_output: buildNormalizedOutput(record.candidateObservations),
    captured_at: new Date().toISOString(),
  };

  // Build field-level diff description
  const fieldDiffDescriptions = record.fieldDiffs.map(
    (fd) => `${fd.field}: baseline=${JSON.stringify(fd.baselineValue)}, candidate=${JSON.stringify(fd.candidateValue)}`,
  );

  const evidence: RegressionEvidence = {
    scenario_id: record.scenarioId,
    baseline_observation: baselineObs,
    candidate_observation: candidateObs,
    reproduction_steps: fieldDiffDescriptions,
    affected_files: [],
  };

  return {
    id: `regression-${record.evidenceId}-${index}`,
    behavioral_difference_id: record.differenceId,
    journey_id: record.journeyId,
    journey_name: journeyRef?.journeyName ?? record.journeyId,
    protected_behavior_id: behaviorRef?.behaviorId ?? '',
    protected_behavior_description: behaviorRef?.description ?? record.reason,
    severity: 'high', // default severity — R07 does not calculate this
    recommended_action: 'Review the behavioral difference and verify the change is intentional.',
    evidence,
  };
}

/**
 * Build a normalized_output Record from ObservationSnapshots.
 * Only includes normalized (scrubbed) values — never raw sensitive values.
 */
function buildNormalizedOutput(
  snapshots: import('./model.js').ObservationSnapshot[],
): Record<string, unknown> {
  if (snapshots.length === 0) return {};
  return {
    steps: snapshots.map((s) => ({
      stepId: s.stepId,
      sequence: s.sequence,
      status: s.status,
      observations: s.observations.map((o) => ({
        kind: o.kind,
        normalizedValue: o.normalizedValue,
        source: o.source,
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// ReportSummary builder
// ---------------------------------------------------------------------------

function buildReportSummary(
  capsule: EvidenceCapsule,
  finalVerdict: FinalVerdict,
): ReportSummary {
  const { summary } = capsule;
  return {
    total_journeys: capsule.journeyRefs.length,
    total_scenarios: summary.totalScenarios,
    preserved: summary.preserved,
    intentional_changes: summary.intentionalChanges,
    regressions: summary.regressions,
    not_exercised: summary.inconclusive,
    potentially_affected: summary.potentialDifferences,
    verdict: finalVerdict,
  };
}

// ---------------------------------------------------------------------------
// Report Input
// ---------------------------------------------------------------------------

export interface ReportInput {
  capsule: EvidenceCapsule;
  /** Relative path where the JSON capsule will be stored (for capsule_ref) */
  jsonPath: string;
  /** Relative path where the Markdown report will be stored (for capsule_ref) */
  markdownPath: string;
  /** Change summary for the report */
  changeSummary?: {
    base_ref: string;
    candidate_ref: string;
    pr_number?: number;
    diff_summary: string;
    affected_files: string[];
  };
  /** Requirement summary for the report */
  requirement?: {
    text: string;
    source: 'free_text' | 'issue_link' | 'acceptance_criteria';
  };
  /** Intent summary for the report */
  intent?: {
    description: string;
    expected_changes: string[];
  };
  /** ISO 8601 timestamp for generated_at. Defaults to now. */
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// Public API — buildReport
// ---------------------------------------------------------------------------

/**
 * Build a RehearsalReport from an EvidenceCapsule.
 *
 * The report conforms to the F-04 shared contracts.ts RehearsalReport interface:
 *   - rehearsal_run_id  (not run_id)
 *   - behavioral_diff_rows  (not behavioral_diff)
 *   - capsule_ref with json_path + markdown_path
 *
 * R06 verdicts are preserved exactly via mapVerdict().
 */
export function buildReport(input: ReportInput): RehearsalReport {
  const { capsule, jsonPath, markdownPath, generatedAt = new Date().toISOString() } = input;

  const finalVerdict = buildFinalVerdict(capsule);

  // Build behavioral_diff_rows from evidence records
  // Sort by evidenceId ascending for deterministic ordering
  const sortedRecords = [...capsule.evidenceRecords].sort((a, b) =>
    a.evidenceId.localeCompare(b.evidenceId),
  );

  const behavioralDiffRows: BehavioralDiffRow[] = sortedRecords.map((record) =>
    buildDiffRow(record, capsule),
  );

  // Build regression entries (only for REGRESSION verdicts)
  const regressionEntries: Regression[] = sortedRecords
    .filter((r) => r.verdict === 'REGRESSION')
    .map((r, i) => buildRegressionEntry(r, capsule, i));

  // Build summary
  const summary = buildReportSummary(capsule, finalVerdict);

  // Build protected_behaviors for the report
  const protectedBehaviors: ProtectedBehavior[] = capsule.behaviorRefs.map((b) => ({
    id: b.behaviorId,
    description: b.description,
    source: b.confidence,
    confidence: confidenceLevelToScore(b.confidence),
    related_code_refs: [],
  }));

  // Build journeys for the report (lightweight, from capsule journey refs)
  const journeys: Journey[] = capsule.journeyRefs.map((jr) => ({
    id: jr.journeyId,
    name: jr.journeyName,
    description: jr.description,
    type: 'api',
    source: 'requirement',
    confidence: 'inferred',
    steps: [] as JourneyStep[],
  }));

  const changeSummary = input.changeSummary ?? {
    base_ref: 'baseline',
    candidate_ref: 'candidate',
    diff_summary: capsule.changeSummary,
    affected_files: [],
  };

  const requirement = input.requirement ?? {
    text: capsule.requirementSummary ?? capsule.changeSummary,
    source: 'free_text' as const,
  };

  const intent = input.intent ?? {
    description: capsule.changeSummary,
    expected_changes: [],
  };

  return {
    rehearsal_run_id: capsule.rehearsalRunId,  // F-04 field name preserved
    change: changeSummary,
    requirement,
    intent,
    journeys,
    protected_behaviors: protectedBehaviors,
    behavioral_diff_rows: behavioralDiffRows,  // F-04 field name preserved
    regressions: regressionEntries,
    summary,
    capsule_ref: {                              // F-04 field name preserved
      json_path: jsonPath,
      markdown_path: markdownPath,
    },
    generated_at: generatedAt,
  };
}
