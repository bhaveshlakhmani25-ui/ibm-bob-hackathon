/**
 * Change Rehearsal — Shared API/Data Contracts
 *
 * This file is the single source of truth for all types shared between:
 *   - Bhavesh's CLI/product layer (consumer)
 *   - Reuben's rehearsal engine (producer)
 *
 * Neither side modifies this file unilaterally. Changes require agreement.
 * Both branches import from here.
 *
 * Corresponds to: docs/BHAVESH_IMPLEMENTATION_PLAN.md §4
 */

// ---------------------------------------------------------------------------
// 4.1  POST /api/rehearsals
// ---------------------------------------------------------------------------

export interface StartRehearsalRequest {
  /** Absolute or relative path to the repository on disk */
  repo_path: string;
  /** Git ref for the baseline (e.g. "main") */
  base_ref: string;
  /** Git ref for the candidate (e.g. "feature/product-cache") */
  candidate_ref: string;
  /** Free-text developer intent / requirement */
  requirement?: string;
  /** Optional GitHub PR number */
  pr_number?: number;
}

export interface StartRehearsalResponse {
  run_id: string;
  status: "started" | "queued";
  started_at: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// 4.2  GET /api/rehearsals/:run_id/status
// ---------------------------------------------------------------------------

export type RunStatus = "running" | "completed" | "failed" | "build_failed";

export type RehearsalPhase =
  | "loading_repository"
  | "extracting_change"
  | "compiling_journeys"
  | "analyzing_impact"
  | "resolving_protected_behaviors"
  | "planning_scenarios"
  | "running_baseline"
  | "running_candidate"
  | "comparing"
  | "generating_report"
  | "completed";

export type BuildStatus = "pending" | "success" | "failed";

export interface RehearsalStatusResponse {
  run_id: string;
  status: RunStatus;
  /** The pipeline stage currently executing */
  phase: RehearsalPhase;
  started_at: string;
  completed_at?: string;
  baseline_build_status: BuildStatus;
  candidate_build_status: BuildStatus;
  /** Only present when status === "failed" or "build_failed". Human-readable description. */
  error?: string;
  /**
   * Machine-readable error code from the integration error contract.
   * Aligns with error-contract.schema.json `error_code` enum.
   * Only present when status === "failed" or "build_failed".
   */
  error_code?: string;
}

// ---------------------------------------------------------------------------
// 4.3  GET /api/rehearsals/:run_id/report
// ---------------------------------------------------------------------------

export interface ChangeSummary {
  base_ref: string;
  candidate_ref: string;
  pr_number?: number;
  /** Human-readable description of what changed */
  diff_summary: string;
  affected_files: string[];
}

export interface RequirementSummary {
  text: string;
  source: "free_text" | "issue_link" | "acceptance_criteria";
}

export interface IntentSummary {
  /** e.g. "Improve Product API response time" */
  description: string;
  /** e.g. ["Product API response path gains caching"] */
  expected_changes: string[];
}

export interface JourneyStep {
  id: string;
  sequence: number;
  action_type: "http" | "cli" | "function" | "db";
  /** Human-readable, e.g. "Update inventory to 3" */
  description: string;
  input: Record<string, unknown>;
  expected_hint?: string;
}

export type ConfidenceLevel =
  | "confirmed"
  | "test_derived"
  | "contract_derived"
  | "inferred";

export type JourneySource =
  | "requirement"
  | "impact"
  | "developer"
  | "inferred";

export interface Journey {
  id: string;
  name: string;
  description: string;
  type: "user" | "system" | "api" | "data";
  source: JourneySource;
  confidence: ConfidenceLevel;
  steps: JourneyStep[];
}

export interface ProtectedBehavior {
  id: string;
  description: string;
  source: ConfidenceLevel;
  /** 0.0–1.0 */
  confidence: number;
  workflow_name?: string;
  related_code_refs: string[];
}

export type Verdict =
  | "preserved"
  | "intentional_change"
  | "regression"
  | "potentially_affected"
  | "not_exercised";

export interface BehavioralDiffRow {
  journey_id: string;
  journey_name: string;
  verdict: Verdict;
  protected_behavior_id?: string;
  protected_behavior_source?: ConfidenceLevel;
  /** 0.0–1.0 numeric confidence score from the associated ProtectedBehavior. Absent when no protected behavior is linked. */
  protected_behavior_confidence?: number;
  is_expected_change: boolean;
  scenario_id?: string;
  /** Null when verdict is not_exercised or potentially_affected */
  evidence_id?: string;
}

export interface Observation {
  side: "baseline" | "candidate";
  raw_output: string;
  normalized_output: Record<string, unknown>;
  captured_at: string;
}

export interface RegressionEvidence {
  scenario_id: string;
  baseline_observation: Observation;
  candidate_observation: Observation;
  reproduction_steps: string[];
  affected_files: string[];
}

export interface Regression {
  id: string;
  behavioral_difference_id: string;
  journey_id: string;
  journey_name: string;
  protected_behavior_id: string;
  protected_behavior_description: string;
  severity: "critical" | "high" | "medium" | "low";
  recommended_action: string;
  evidence: RegressionEvidence;
}

export type FinalVerdict =
  | "ready_to_merge"
  | "review_required"
  | "build_failed";

export interface ReportSummary {
  total_journeys: number;
  total_scenarios: number;
  preserved: number;
  intentional_changes: number;
  regressions: number;
  not_exercised: number;
  potentially_affected: number;
  verdict: FinalVerdict;
}

export interface RehearsalReport {
  rehearsal_run_id: string;
  change: ChangeSummary;
  requirement: RequirementSummary;
  intent: IntentSummary;
  journeys: Journey[];
  protected_behaviors: ProtectedBehavior[];
  behavioral_diff_rows: BehavioralDiffRow[];
  regressions: Regression[];
  summary: ReportSummary;
  capsule_ref?: {
    json_path: string;
    markdown_path: string;
  };
  generated_at: string;
}

// ---------------------------------------------------------------------------
// 4.4  GET /api/rehearsals/:run_id/evidence/:evidence_id
// ---------------------------------------------------------------------------

export interface EvidenceDetail {
  evidence_id: string;
  scenario_id: string;
  journey: Journey;
  protected_behavior?: ProtectedBehavior;
  requirement?: RequirementSummary;
  baseline_observation: Observation;
  candidate_observation: Observation;
  /** Human-readable description of the observable difference */
  diff_detail: string;
  reproduction_steps: string[];
  affected_files: string[];
  recommended_action?: string;
}

// ---------------------------------------------------------------------------
// 4.4a  GET /api/rehearsals/:run_id/journey-replay/:journey_id
//
// B05 — Journey Replay
//
// Returns a step-by-step replay of a single journey execution, pairing the
// baseline and candidate results per step so the developer can pinpoint the
// exact divergence.
//
// This is a PURELY ADDITIVE model. It does NOT replace BehavioralDiffRow.
// ---------------------------------------------------------------------------

/**
 * The result of executing a single JourneyStep on both baseline and candidate.
 *
 * Uses the existing Observation and Verdict types from §4.3.
 * `changed` is the authoritative flag set by the rehearsal engine — the UI
 * must not infer a divergence from text differences alone.
 */
export interface ReplayStepResult {
  /** Matches JourneyStep.id */
  step_id: string;
  /** 1-based display order (matches JourneyStep.sequence) */
  sequence: number;
  /** Human-readable step name (from JourneyStep.description) */
  name: string;
  /** The action exercised at this step */
  action: string;
  /** Expected / protected behavior hint if available */
  expected_hint?: string;
  /** Baseline side observation (null when step was not exercised on baseline) */
  baseline_result: Observation | null;
  /** Candidate side observation (null when step was not exercised on candidate) */
  candidate_result: Observation | null;
  /** Canonical verdict from the rehearsal engine for this step */
  verdict: Verdict;
  /** Confidence source from the associated ProtectedBehavior, if linked */
  confidence_source?: ConfidenceLevel;
  /** Numeric confidence 0.0–1.0 */
  confidence_score?: number;
  /**
   * Set by the rehearsal engine. TRUE only when the engine determined baseline
   * and candidate diverged for this step. The UI must use this flag — not a
   * text comparison — to highlight the divergence.
   */
  changed: boolean;
  /**
   * Deterministic explanation derived from verdict + diff_detail.
   * NOT AI-generated. Summarises what the engine found (e.g. "stock: 3 → 10").
   */
  explanation?: string;
}

/**
 * Full journey replay for a single journey.
 *
 * Returned by GET /api/rehearsals/:run_id/journey-replay/:journey_id.
 * Wraps the existing Journey with per-step ReplayStepResult pairs.
 */
export interface JourneyReplayDetail {
  /** The rehearsal run this replay belongs to */
  run_id: string;
  /** Original journey definition */
  journey: Journey;
  /** Overall verdict for the journey replay (from JourneyReplay.verdict) */
  overall_verdict: Verdict;
  /** Confidence source for the overall journey verdict */
  confidence_source?: ConfidenceLevel;
  /** Numeric confidence 0.0–1.0 */
  confidence_score?: number;
  /** Ordered replay results, one per JourneyStep */
  steps: ReplayStepResult[];
}

// ---------------------------------------------------------------------------
// 4.5  POST /api/rehearsals/:run_id/rerun
// ---------------------------------------------------------------------------

export interface RerunRequest {
  /** New commit ref after the developer's fix */
  candidate_ref: string;
  /** Default: "affected_only" */
  scope?: "affected_only" | "full";
}

export interface RerunResponse {
  new_run_id: string;
  parent_run_id: string;
  status: "started";
  /** Journey IDs being re-run in scoped mode */
  scoped_journey_ids: string[];
}

// ---------------------------------------------------------------------------
// 4.6  GET /api/rehearsals/:run_id/capsule
// ---------------------------------------------------------------------------

export interface EvidenceCapsule extends RehearsalReport {
  capsule_format_version: string; // e.g. "1.0"
  reproduction_refs: ReproductionRef[];
}

export interface ReproductionRef {
  journey_id: string;
  regression_id?: string;
  steps: string[];
}
