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
  /** Only present when status === "failed" */
  error?: string;
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
