/**
 * Change Rehearsal — R05 Execution Domain Model
 *
 * Defines the typed execution model used by the RehearsalExecutor.
 *
 * IMPORTANT BOUNDARY:
 *   ExecutionStatus describes what happened during execution only.
 *   It does NOT carry a behavioral verdict.
 *   A failed execution is NOT automatically a regression — that determination
 *   belongs to R06 (BehavioralComparator).
 *
 * Relationship to existing types:
 *   - ExecutionTarget replaces the ad-hoc RunnerConfig + ExecutionSide combination.
 *   - ScenarioExecutionResult is richer than RawExecution (carries run metadata,
 *     typed status, and step-level observations).
 *   - StepExecutionResult is richer than RawStepResult (carries typed Observation
 *     alongside the raw response data).
 *   - Both are designed so R06 can diff a baseline result against a candidate result
 *     without inspecting the executor's internals.
 *
 * Owner: Reuben (engine)
 * Phase: R05
 */

import type { ExecutionSide } from '../types.js';

// Re-export ExecutionSide so execution-layer consumers can import it here.
export type { ExecutionSide };

// ---------------------------------------------------------------------------
// ExecutionTarget
// ---------------------------------------------------------------------------

/**
 * Identifies one side of a rehearsal execution (baseline or candidate).
 *
 * The executor accepts two ExecutionTargets — one per side — and runs the
 * same ScenarioPlan against each. The only intentional difference between
 * the two executions is the target revision/environment.
 *
 * Environment configuration is injected here rather than hard-coded so tests
 * can supply synthetic targets and production can supply real git refs.
 */
export interface ExecutionTarget {
  /** Whether this is the baseline (pre-change) or candidate (post-change) side */
  kind: ExecutionSide;
  /**
   * The git ref or revision identifier for this side.
   * Examples: "main", "abc1234", "feature/inventory-cache"
   */
  revision: string;
  /**
   * Optional environment identifier (e.g. "ci-sandbox", "local").
   * Used for logging and metadata; does not affect execution logic.
   */
  environmentId?: string;
  /**
   * Optional base URL for the service under test.
   * When provided, the HTTP adapter uses this instead of a default.
   * Example: "http://localhost:3001"
   */
  serviceBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// ExecutionStatus
// ---------------------------------------------------------------------------

/**
 * Execution status for a scenario or step.
 *
 * Describes the EXECUTION OUTCOME only.
 * This is explicitly NOT a behavioral verdict (no "regression" value).
 *
 *   passed       — all steps completed; execution infrastructure succeeded
 *   failed       — one or more steps returned an application-level failure
 *                  (e.g. HTTP 4xx/5xx, assertion mismatch)
 *   blocked      — the environment was unavailable; no steps could run
 *   timed_out    — the scenario exceeded its timeout budget
 *   error        — an execution infrastructure error occurred (not application logic)
 */
export type ExecutionStatus = 'passed' | 'failed' | 'blocked' | 'timed_out' | 'error';

// ---------------------------------------------------------------------------
// Normalized Observation (R05)
// ---------------------------------------------------------------------------

/**
 * A single normalized observation captured during step execution.
 *
 * Normalization is explicit and deterministic:
 *   - Unstable values (timestamps, UUIDs, request IDs) are replaced with stable placeholders
 *   - Sensitive values (auth headers, secrets) are redacted
 *   - Meaningful business values (e.g. inventory quantity) are PRESERVED verbatim
 *
 * The `kind` field tells R06 what type of observation this is so it can apply
 * appropriate comparison logic.
 */
export interface NormalizedObservation {
  /** Classification of what was observed */
  kind:
    | 'http_response'   // HTTP status + body + selected headers
    | 'db_snapshot'     // Database state after the step
    | 'stdout'          // Process standard output
    | 'stderr'          // Process standard error
    | 'function_result' // Return value of a function call
    | 'custom';         // Adapter-defined extension point
  /**
   * The raw observed value (before normalization).
   * May contain unstable values — do NOT use for comparison.
   */
  value: unknown;
  /**
   * The normalized observed value (after normalization).
   * Safe for deterministic comparison by R06.
   * Meaningful business values (quantities, codes, names) are preserved.
   */
  normalizedValue: unknown;
  /**
   * Human-readable description of where this observation came from.
   * Example: "GET /products/1 → HTTP 200"
   */
  source: string;
  /** Additional structured metadata (e.g. HTTP status code, table name) */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// StepExecutionResult
// ---------------------------------------------------------------------------

/**
 * The result of executing a single scenario step.
 *
 * Contains enough deterministic information for R06 to compare baseline and
 * candidate step results without re-running anything.
 *
 * Partial evidence is preserved: if this step failed, earlier step results
 * are still present in the parent ScenarioExecutionResult.steps array.
 */
export interface StepExecutionResult {
  /** ID of the ScenarioPlanStep this result corresponds to */
  stepId: string;
  /** 1-based execution order (mirrors ScenarioPlanStep.sequence) */
  sequence: number;
  /** Execution outcome for this step */
  status: ExecutionStatus;
  /** Wall-clock milliseconds spent executing this step */
  durationMs: number;
  /** Observations captured during this step (may be empty on error/blocked) */
  observations: NormalizedObservation[];
  /**
   * Structured error information when status is 'error', 'timed_out', or 'blocked'.
   * NOT set for application-level failures (use observations for those).
   */
  executionError?: ExecutionError;
}

// ---------------------------------------------------------------------------
// ExecutionError
// ---------------------------------------------------------------------------

/**
 * Structured execution infrastructure error.
 *
 * Distinguishes infrastructure failures from application-level failures.
 * An ExecutionError does NOT automatically constitute a behavioral regression.
 *
 * error codes:
 *   ADAPTER_ERROR       — adapter raised an unexpected exception
 *   TIMEOUT             — step exceeded its timeout budget
 *   ENV_UNAVAILABLE     — service/environment could not be reached
 *   INVALID_STEP        — step definition is malformed or unsupported
 */
export interface ExecutionError {
  code: 'ADAPTER_ERROR' | 'TIMEOUT' | 'ENV_UNAVAILABLE' | 'INVALID_STEP';
  message: string;
  /** Original exception message, if available */
  cause?: string;
}

// ---------------------------------------------------------------------------
// RunMetadata
// ---------------------------------------------------------------------------

/**
 * Metadata about a single scenario execution run.
 */
export interface RunMetadata {
  /** ID of the parent RehearsalRun */
  rehearsalRunId: string;
  /** The execution target this run was performed against */
  target: ExecutionTarget;
  /**
   * Seed data fixture reference used for this run.
   * Mirrors ScenarioPlan.seedDataRef.
   */
  seedDataRef: string;
  /** Number of steps attempted (including failures) */
  stepsAttempted: number;
  /** Number of steps that completed with status 'passed' */
  stepsPassed: number;
  /** Number of steps that completed with status 'failed' */
  stepsFailed: number;
  /** Additional key-value pairs for logging / diagnostics */
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ScenarioExecutionResult
// ---------------------------------------------------------------------------

/**
 * The complete result of executing one ScenarioPlan against one ExecutionTarget.
 *
 * This is the primary output of the RehearsalExecutor.
 * R06 receives one ScenarioExecutionResult for the baseline side and one for
 * the candidate side, then compares them to produce a BehavioralDifference.
 *
 * Design note:
 *   `status` reflects execution health only.
 *   A scenario with status 'failed' may still have produced partial observations
 *   that R06 can use. Nothing is thrown away.
 */
export interface ScenarioExecutionResult {
  /** Stable run identifier (runtime-generated, unique per execution) */
  runId: string;
  /** ID of the ScenarioPlan that was executed */
  scenarioId: string;
  /** The target (baseline or candidate) this was executed against */
  target: ExecutionTarget;
  /**
   * Overall execution status.
   * Derived from step statuses: worst-case aggregation.
   * Does NOT encode behavioral verdict.
   */
  status: ExecutionStatus;
  /** ISO 8601 timestamp when execution started */
  startedAt: string;
  /** ISO 8601 timestamp when execution completed (or was abandoned) */
  completedAt: string;
  /** Total wall-clock milliseconds (completedAt − startedAt) */
  durationMs: number;
  /** Step results in execution order (sequence ascending) */
  steps: StepExecutionResult[];
  /** Run metadata for logging, diagnostics, and R06 traceability */
  metadata: RunMetadata;
}

// ---------------------------------------------------------------------------
// PairedExecutionResult
// ---------------------------------------------------------------------------

/**
 * The paired baseline + candidate results for a single ScenarioPlan.
 *
 * This is the unit of input consumed by the R06 comparator.
 * Both sides executed the same ScenarioPlan; the only intended difference
 * is the target revision.
 */
export interface PairedExecutionResult {
  /** ID of the ScenarioPlan that was executed on both sides */
  scenarioId: string;
  /** Baseline execution result */
  baseline: ScenarioExecutionResult;
  /** Candidate execution result */
  candidate: ScenarioExecutionResult;
}
