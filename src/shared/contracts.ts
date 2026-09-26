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
  run_id: string;
  change: ChangeSummary;
  requirement: RequirementSummary;
  intent: IntentSummary;
  journeys: Journey[];
  protected_behaviors: ProtectedBehavior[];
  behavioral_diff: BehavioralDiffRow[];
  regressions: Regression[];
  summary: ReportSummary;
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
//
// The Evidence Capsule is the portable proof of a completed rehearsal.
// It is a self-contained, JSON-serializable record of every piece of
// evidence required to understand and reproduce a behavioral change.
//
// SOURCE OF TRUTH: all verdict, confidence, error_code, changed, and
// observation values come directly from the rehearsal engine.  The UI
// must NEVER infer or overwrite these fields.
//
// SECURITY: the capsule must NOT contain secrets, tokens, credentials,
// or raw process environment variables.  Only intentional rehearsal
// evidence is included.
// ---------------------------------------------------------------------------

/**
 * Capsule-level metadata.
 * Identifies the artifact and when it was generated.
 */
export interface CapsuleMetadata {
  /** Semver-style capsule schema version, e.g. "1.0" */
  capsule_format_version: string;
  /** The rehearsal run that produced this capsule */
  run_id: string;
  /** ISO 8601 timestamp when the capsule was assembled */
  generated_at: string;
}

/**
 * The original developer requirement / intent.
 * Preserved verbatim from the submission.
 */
export interface CapsuleRequirement {
  text: string;
  source: "free_text" | "issue_link" | "acceptance_criteria";
}

/**
 * Repository and change context.
 * All values come from the rehearsal engine — never inferred by the UI.
 */
export interface CapsuleChangeContext {
  /** Git ref for the pre-change (baseline) side */
  base_ref: string;
  /** Git ref or working-tree description for the candidate (post-change) side */
  candidate_ref: string;
  /** Optional GitHub PR number when available from the engine */
  pr_number?: number;
  /** Human-readable summary of what changed (from engine diff analysis) */
  diff_summary?: string;
  /** Files identified as changed by the engine */
  affected_files?: string[];
}

/**
 * Rehearsal run information.
 */
export interface CapsuleRehearsalInfo {
  started_at: string;
  completed_at?: string;
  baseline_build_status?: BuildStatus;
  candidate_build_status?: BuildStatus;
}

/**
 * The affected journey selected for the capsule.
 * One capsule covers one journey (the primary affected journey).
 */
export interface CapsuleJourney {
  journey_id: string;
  journey_name: string;
  journey_description?: string;
  journey_type?: Journey["type"];
  journey_source?: JourneySource;
}

/**
 * Protected behavior linked to the capsule verdict.
 * Comes directly from the engine's ProtectedBehavior record.
 */
export interface CapsuleProtectedBehavior {
  id: string;
  description: string;
  /** Confidence level as classified by the engine */
  source: ConfidenceLevel;
  /** 0.0–1.0 numeric confidence score (F-02) */
  confidence: number;
  workflow_name?: string;
}

/**
 * Capsule-level verdict.
 * All fields are authoritative engine outputs — never UI-inferred.
 */
export interface CapsuleVerdict {
  /** Canonical per-journey verdict (F-01 vocabulary) */
  verdict: Verdict;
  /** Overall rehearsal result */
  final_verdict: FinalVerdict;
  /**
   * Numeric confidence 0.0–1.0 from the linked ProtectedBehavior (F-02).
   * Absent when no protected behavior is linked.
   */
  protected_behavior_confidence?: number;
  /** Confidence source enum from the linked ProtectedBehavior (F-02) */
  confidence_source?: ConfidenceLevel;
  /** Severity when a regression is present */
  severity?: Regression["severity"];
  /** Deterministic recommended action from the engine */
  recommended_action?: string;
}

/**
 * Behavioral evidence: the raw observations and engine-determined change flag.
 * `changed` is set ONLY by the rehearsal engine.
 */
export interface CapsuleBehavioralEvidence {
  /** Baseline-side observation */
  baseline_observation: Observation;
  /** Candidate-side observation */
  candidate_observation: Observation;
  /**
   * Engine-authoritative divergence flag (F-05 / B05 contract).
   * TRUE only when the engine determined that baseline and candidate diverged.
   * The UI must use this flag — not text comparison — to highlight divergence.
   */
  changed: boolean;
  /** Human-readable description of the observable difference (from engine) */
  diff_detail?: string;
  /**
   * Deterministic explanation derived from verdict + diff_detail.
   * NOT AI-generated.
   */
  explanation?: string;
}

/**
 * A single step within the capsule's journey replay.
 * Mirrors ReplayStepResult but is embedded directly in the capsule so the
 * capsule is self-contained without external references.
 */
export interface CapsuleReplayStep {
  step_id: string;
  sequence: number;
  name: string;
  action: string;
  expected_hint?: string;
  baseline_result: Observation | null;
  candidate_result: Observation | null;
  /** Canonical step-level verdict from the engine (F-01) */
  verdict: Verdict;
  confidence_source?: ConfidenceLevel;
  confidence_score?: number;
  /** Engine-authoritative divergence flag — TRUE only when engine detected divergence */
  changed: boolean;
  explanation?: string;
}

/**
 * Reproduction information.
 * Only includes steps/commands that the engine explicitly provided.
 * Never invented by the UI layer.
 */
export interface CapsuleReproduction {
  /** Ordered human-readable reproduction steps from the engine */
  steps: string[];
  /** Scenario ID when available */
  scenario_id?: string;
}

/**
 * Error / warning entry preserved from the rehearsal run.
 * Preserves machine-readable error_code alongside human-readable message (F-05).
 */
export interface CapsuleError {
  /** Machine-readable error code from the integration error contract (F-05) */
  error_code: string;
  /** Human-readable description */
  message: string;
  /** Optional structured detail from the engine */
  detail?: Record<string, unknown>;
}

/**
 * Evidence Capsule — B06
 *
 * The portable proof of a completed Change Rehearsal run.
 * Self-contained and JSON-serializable.
 *
 * Designed to be:
 *  - downloaded as a JSON artifact
 *  - attached to a pull request
 *  - stored as a CI artifact
 *  - inspected outside the UI
 *  - compared between runs
 *
 * The exported JSON must exactly represent the same object shown in the UI.
 * No display-only fields; no UI-inferred values.
 */
export interface EvidenceCapsule {
  /** Capsule identity and generation timestamp */
  metadata: CapsuleMetadata;
  /** Developer's original requirement (verbatim) */
  requirement: CapsuleRequirement;
  /** Repository and change context */
  change: CapsuleChangeContext;
  /** Rehearsal run information */
  rehearsal: CapsuleRehearsalInfo;
  /** The affected journey this capsule covers */
  journey: CapsuleJourney;
  /** Protected behavior that was evaluated */
  protected_behavior?: CapsuleProtectedBehavior;
  /** Canonical verdict — authoritative engine output */
  verdict: CapsuleVerdict;
  /** Behavioral evidence: observations + engine change flag */
  behavioral_evidence: CapsuleBehavioralEvidence;
  /** Ordered journey replay steps */
  replay_steps: CapsuleReplayStep[];
  /** Reproduction steps when the engine provided them */
  reproduction?: CapsuleReproduction;
  /** Errors and warnings from the rehearsal run */
  errors?: CapsuleError[];
}

/**
 * @deprecated  Use EvidenceCapsule (B06 canonical model) instead.
 *              This stub is retained only for backward-compatibility with
 *              any existing references.  It will be removed in a future release.
 */
export interface ReproductionRef {
  journey_id: string;
  regression_id?: string;
  steps: string[];
}
