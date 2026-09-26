/**
 * Change Rehearsal — Shared Engine Types
 *
 * Single source of truth for all data structures used across the engine pipeline.
 * All modules import from here; no module defines its own local types that duplicate these.
 *
 * Owner: Reuben (engine)
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Top-level input to the engine entry point */
export interface RehearsalInput {
  repository: RepositoryRef;
  change: ChangeRef;
  requirement?: RequirementInput;
  options?: RehearsalOptions;
}

export interface RepositoryRef {
  /** Absolute or workspace-relative path to the local git repository */
  localPath: string;
}

export interface ChangeRef {
  /** Git ref for the pre-change version (e.g. "main", a commit SHA, or a branch name) */
  baseRef: string;
  /** Git ref for the post-change version */
  candidateRef: string;
  /** Optional GitHub PR number, used for PR comment posting */
  prNumber?: number;
}

export interface RequirementInput {
  text: string;
  source: 'free_text' | 'issue_link' | 'acceptance_criteria';
}

export interface RehearsalOptions {
  /**
   * Max wall-clock seconds allowed per scenario execution per side.
   * Default: 30
   */
  scenarioTimeoutSeconds?: number;
  /**
   * When true, skip LLM calls and use fixture-based journeys for deterministic execution.
   * Required for unit tests and CI.
   */
  deterministicMode?: boolean;
  /**
   * Repair loop: when provided, only these scenario IDs are re-executed.
   * All other scenarios carry forward their previous results.
   */
  scopedScenarioIds?: string[];
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface RepositoryContext {
  id: string;
  localPath: string;
  language: string;
  frameworks: string[];
  defaultBranch: string;
}

// ---------------------------------------------------------------------------
// Change / Diff
// ---------------------------------------------------------------------------

export interface Change {
  id: string;
  baseRef: string;
  candidateRef: string;
  prNumber?: number;
  diffSummary: DiffSummary;
  createdAt: string; // ISO 8601
}

export interface DiffSummary {
  filesChanged: FileDiff[];
  /** Top-level symbols (functions, classes, exports) that appear in the diff */
  symbolsChanged: SymbolRef[];
  insertions: number;
  deletions: number;
}

export interface FileDiff {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  /** Old path, only present when changeType === 'renamed' */
  oldPath?: string;
  hunks: Hunk[];
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Raw unified-diff text for the hunk */
  content: string;
}

export interface SymbolRef {
  file: string;
  name: string;
  kind: 'function' | 'class' | 'method' | 'variable' | 'export';
}

// ---------------------------------------------------------------------------
// Requirement / Intent
// ---------------------------------------------------------------------------

export interface Requirement {
  id: string;
  text: string;
  source: 'free_text' | 'issue_link' | 'acceptance_criteria';
  /** Phrases or patterns from the requirement that describe expected behavioral changes */
  expectedChanges: string[];
}

export interface IntentCompilerOutput {
  requirement: Requirement;
  journeys: Journey[];
  protectedBehaviors: ProtectedBehavior[];
  /** One-sentence summary of the expected change, used in the report */
  expectedChangeSummary: string;
}

// ---------------------------------------------------------------------------
// Journey and Steps
// ---------------------------------------------------------------------------

export type ConfidenceLevel = 'confirmed' | 'test_derived' | 'contract_derived' | 'inferred';

export interface Journey {
  id: string;
  changeId: string;
  name: string;
  description: string;
  type: 'user' | 'system' | 'api' | 'data';
  /**
   * Relative priority for ordering in reports.
   * Lower number = higher priority.
   */
  priority: number;
  source: 'requirement' | 'impact' | 'developer' | 'inferred';
  confidence: ConfidenceLevel;
  steps: JourneyStep[];
}

export interface JourneyStep {
  id: string;
  journeyId: string;
  /** 1-based execution order within the journey */
  sequence: number;
  actionType: 'http' | 'cli' | 'function' | 'db';
  input: StepInput;
  /** Non-binding hint for the comparator about what the expected outcome is */
  expectedHint?: string;
}

export type StepInput =
  | HttpStepInput
  | CliStepInput
  | FunctionStepInput
  | DbStepInput;

export interface HttpStepInput {
  kind: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface CliStepInput {
  kind: 'cli';
  command: string;
  args: string[];
}

export interface FunctionStepInput {
  kind: 'function';
  modulePath: string;
  exportName: string;
  args: unknown[];
}

export interface DbStepInput {
  kind: 'db';
  query: string;
  params?: unknown[];
}

// ---------------------------------------------------------------------------
// Protected Behavior
// ---------------------------------------------------------------------------

export interface ProtectedBehavior {
  id: string;
  changeId: string;
  description: string;
  /**
   * How this behavior was identified.
   * Confidence ordering: confirmed > test_derived > contract_derived > inferred
   * No downstream module may upgrade a behavior's confidence without explicit developer action.
   */
  source: ConfidenceLevel;
  confidence: ConfidenceLevel;
  workflowName: string;
  /** File paths or symbol names associated with this behavior */
  relatedCodeRefs: string[];
}

// ---------------------------------------------------------------------------
// Impact Analysis
// ---------------------------------------------------------------------------

export interface ImpactSet {
  affectedFiles: string[];
  affectedSymbols: SymbolRef[];
  affectedServices: string[];
  affectedWorkflows: string[];
  /**
   * Present when cross-service analysis is limited because no service map was provided
   * or the map is incomplete.
   */
  crossServiceWarning?: string;
}

export interface ServiceMap {
  services: Record<string, ServiceDefinition>;
}

export interface ServiceDefinition {
  /** Local port the service listens on */
  port?: number;
  dependsOn?: string[];
  /** Shell command to start the service */
  startCommand?: string;
  /** HTTP path to GET for health check (expects 2xx) */
  healthCheck?: string;
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export interface Scenario {
  id: string;
  journeyId: string;
  protectedBehaviorId?: string;
  requirementId?: string;
  steps: JourneyStep[];
  /** Prose description of the invariant being checked */
  expectedInvariantHint?: string;
  /**
   * Always true for MVP. Type-level guarantee that all scenarios must be
   * deterministically executable before entering the execution phase.
   */
  readonly deterministic: true;
  /**
   * Reference to the seed data fixture, e.g. "shopflow/inventory-3-units".
   * Resolved to fixtures/<seedDataRef>/seed.json at runtime.
   */
  seedDataRef: string;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type ExecutionSide = 'baseline' | 'candidate';

export interface RunnerConfig {
  side: ExecutionSide;
  /** Git ref to check out */
  ref: string;
  repositoryPath: string;
  serviceMap: ServiceMap;
  scenarioTimeoutSeconds: number;
}

export interface ServiceHandle {
  side: ExecutionSide;
  /** Base URL the service is reachable at, e.g. "http://localhost:3001" */
  baseUrl: string;
  pid?: number;
  containerId?: string;
}

export interface RawExecution {
  scenarioId: string;
  side: ExecutionSide;
  steps: RawStepResult[];
  startedAt: string; // ISO 8601
  completedAt: string; // ISO 8601
  buildStatus: 'success' | 'failure';
  buildError?: string;
}

export interface RawStepResult {
  stepId: string;
  status: 'success' | 'failure' | 'skipped';
  httpResponse?: RawHttpResponse;
  dbSnapshot?: Record<string, unknown>;
  stdout?: string;
  stderr?: string;
  durationMs: number;
}

export interface RawHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export interface Observation {
  id: string;
  rehearsalRunId: string;
  scenarioId: string;
  side: ExecutionSide;
  rawOutput: RawExecution;
  normalizedOutput: NormalizedOutput;
  capturedAt: string; // ISO 8601
}

export interface NormalizedOutput {
  steps: NormalizedStepOutput[];
}

export interface NormalizedStepOutput {
  stepId: string;
  status: 'success' | 'failure' | 'skipped';
  httpStatus?: number;
  /** Timestamps, trace IDs, and auto-increment IDs replaced with stable placeholders */
  httpBody?: unknown;
  /** Auth headers scrubbed; only non-sensitive headers retained */
  selectedHeaders?: Record<string, string>;
  dbSnapshot?: Record<string, unknown>;
  assertions?: AssertionResult[];
}

export interface AssertionResult {
  description: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
}

// ---------------------------------------------------------------------------
// Behavioral Comparison
// ---------------------------------------------------------------------------

/**
 * The four possible verdicts for a scenario comparison.
 *
 * unchanged          — baseline and candidate normalized outputs are identical
 * changed            — outputs differ; difference is expected per the requirement
 * regression         — outputs differ in a way that violates a protected behavior
 *                      and is not justified by the requirement
 * potentially_affected — impact analysis flagged this journey but no scenario exercised it
 * not_exercised      — no deterministic scenario could be constructed for this behavior
 */
export type Verdict =
  | 'unchanged'
  | 'changed'
  | 'regression'
  | 'potentially_affected'
  | 'not_exercised';

export interface BehavioralDifference {
  id: string;
  scenarioId: string;
  journeyId: string;
  verdict: Verdict;
  diffDetail: DiffDetail;
  /** True if the requirement explicitly accounts for this difference */
  isExpected: boolean;
}

export interface DiffDetail {
  stepDiffs: StepDiff[];
  /** One-sentence prose summary for the report */
  summary: string;
}

export interface StepDiff {
  stepId: string;
  /** JSON-path-like field description, e.g. "body.stock" */
  field: string;
  baseline: unknown;
  candidate: unknown;
}

export interface Regression {
  id: string;
  behavioralDifferenceId: string;
  protectedBehaviorId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface Evidence {
  id: string;
  behavioralDifferenceId: string;
  /** IDs of the Observation records supporting this verdict */
  observationRefs: string[];
  /** Absolute path to artifacts/<run-id>/ directory */
  storagePath: string;
  /** Relative file names within storagePath that constitute the artifact set */
  artifactRefs: string[];
}

// ---------------------------------------------------------------------------
// Run and Result
// ---------------------------------------------------------------------------

export interface RehearsalRun {
  id: string;
  changeId: string;
  startedAt: string; // ISO 8601
  completedAt?: string; // ISO 8601
  status: 'running' | 'completed' | 'failed';
  baselineBuildStatus: 'success' | 'failure' | 'pending';
  candidateBuildStatus: 'success' | 'failure' | 'pending';
}

/**
 * The complete typed result returned from runRehearsal().
 * This is the contract between the engine (Reuben) and the CLI/UX layer (Bhavesh).
 */
export interface RehearsalResult {
  run: RehearsalRun;
  change: Change;
  requirement?: Requirement;
  journeys: Journey[];
  protectedBehaviors: ProtectedBehavior[];
  scenarios: Scenario[];
  observations: Observation[];
  behavioralDifferences: BehavioralDifference[];
  regressions: Regression[];
  evidence: Evidence[];
  /** Absolute path to the artifacts directory for this run */
  artifactsDir: string;
}
