# Change Rehearsal — Backend / Engine Architecture

> **Branch:** `reuben/backend-ai`  
> **Owner:** Reuben  
> **Status:** Design — not yet built  
> **First implementation target:** one complete deterministic rehearsal path (ShopFlow caching regression)

---

## 1. Guiding Principle

> **AI proposes; deterministic execution verifies.**

LLM reasoning may infer intent, journeys, protected behaviors, and scenarios.  
Deterministic tooling executes, captures, normalizes, compares, and persists evidence.  
Every verdict must be traceable to a recorded observation — never to an LLM statement alone.

---

## 2. Pipeline Overview

```
CLI / API input
      │
      ▼
┌─────────────────────┐
│  Repository Loader  │  opens repo at base + candidate refs
└─────────┬───────────┘
          │ RepositoryContext
          ▼
┌─────────────────────┐
│  Change Extractor   │  structured diff, affected symbols
└─────────┬───────────┘
          │ Change
          ▼
┌──────────────────────────┐
│ Intent → Journey Compiler│  requirement → journeys + protected behaviors
└─────────┬────────────────┘
          │ Journey[], ProtectedBehavior[]
          ▼
┌─────────────────────┐
│  Impact Analyzer    │  call graph + service map → affected workflows
└─────────┬───────────┘
          │ ImpactSet
          ▼
┌───────────────────────────┐
│ Protected Behavior Resolver│ merges test/contract/inferred/confirmed sources
└─────────┬─────────────────┘
          │ ProtectedBehavior[]  (with confidence)
          ▼
┌──────────────────────────┐
│ Journey / Scenario Planner│  journeys → deterministic Scenario[]
└─────────┬────────────────┘
          │ Scenario[]
          ▼
┌───────────────────────┐
│ Rehearsal Orchestrator│  coordinates baseline + candidate execution
└──────┬────────┬───────┘
       │        │
       ▼        ▼
  Baseline   Candidate
   Runner     Runner
       │        │
       └───┬────┘
           │ RawExecution[]
           ▼
┌──────────────────────┐
│ Observation Collector│  normalize + scrub noise
└──────────┬───────────┘
           │ Observation[]
           ▼
┌──────────────────────┐
│ Behavioral Comparator│  diff + verdict per scenario
└──────┬───────────────┘
       │ BehavioralDifference[]
       ▼
┌──────────────────────┐
│   Evidence Store     │  persist all artifacts to run directory
└──────────────────────┘
       │
       ▼
  (Bhavesh owns from here)
  Behavioral Diff renderer
  Evidence Capsule packager
```

---

## 3. Module Boundaries

Each module is a **pure TypeScript function or class** that:
- accepts a typed input
- returns a typed output (or throws a typed `EngineError`)
- has no hidden side effects beyond `EvidenceStore` writes where documented

```
src/engine/
├── types.ts                    # all shared types and enums (single source of truth)
├── pipeline.ts                 # top-level orchestrator — wires all modules together
├── repository/
│   ├── loader.ts               # RepositoryLoader
│   └── loader.test.ts
├── change/
│   ├── extractor.ts            # ChangeExtractor
│   └── extractor.test.ts
├── intent/
│   ├── compiler.ts             # IntentJourneyCompiler (LLM-backed, output frozen before use)
│   ├── prompts.ts              # prompt templates
│   └── compiler.test.ts
├── impact/
│   ├── analyzer.ts             # ImpactAnalyzer
│   ├── service-map.ts          # service map loader/validator
│   └── analyzer.test.ts
├── behavior/
│   ├── resolver.ts             # ProtectedBehaviorResolver
│   └── resolver.test.ts
├── scenario/
│   ├── planner.ts              # ScenarioPlanner
│   └── planner.test.ts
├── execution/
│   ├── orchestrator.ts         # RehearsalOrchestrator
│   ├── runner.ts               # BaselineRunner + CandidateRunner (same class, different config)
│   ├── collector.ts            # ObservationCollector
│   ├── normalizer.ts           # noise normalization
│   └── orchestrator.test.ts
├── comparison/
│   ├── comparator.ts           # BehavioralComparator
│   ├── classifier.ts           # regression classification
│   └── comparator.test.ts
├── store/
│   ├── evidence-store.ts       # EvidenceStore
│   └── evidence-store.test.ts
├── fixtures/
│   └── shopflow/               # ShopFlow synthetic test fixture
│       ├── README.md
│       ├── baseline/           # pre-caching version
│       └── candidate/          # post-caching version (with bug)
└── errors.ts                   # EngineError hierarchy
```

**Contract with Bhavesh (CLI/UX layer):**  
The engine exposes one entry point: `runRehearsal(input: RehearsalInput): Promise<RehearsalResult>`.  
Bhavesh's CLI calls this function and receives a `RehearsalResult` containing a `RehearsalRun`, `BehavioralDifference[]`, `Evidence[]`, and enough metadata to render a report or capsule.

---

## 4. Shared Type Definitions (`types.ts`)

All types are defined once in `src/engine/types.ts` and imported everywhere.

### 4.1 Inputs

```typescript
/** Top-level input to the engine */
export interface RehearsalInput {
  repository: RepositoryRef;
  change: ChangeRef;
  requirement?: RequirementInput;
  options?: RehearsalOptions;
}

export interface RepositoryRef {
  /** Absolute path to local git repository */
  localPath: string;
}

export interface ChangeRef {
  baseRef: string;       // git ref, e.g. "main" or a commit SHA
  candidateRef: string;  // git ref, e.g. a branch name or commit SHA
  prNumber?: number;
}

export interface RequirementInput {
  text: string;
  source: 'free_text' | 'issue_link' | 'acceptance_criteria';
}

export interface RehearsalOptions {
  /** Max wall-clock seconds per scenario execution side. Default: 30 */
  scenarioTimeoutSeconds?: number;
  /** Bypass LLM and use fixture-based journeys (for deterministic tests) */
  deterministicMode?: boolean;
  /** Re-run only these scenario IDs (repair loop) */
  scopedScenarioIds?: string[];
}
```

### 4.2 Repository Context

```typescript
export interface RepositoryContext {
  id: string;
  localPath: string;
  language: string;
  frameworks: string[];
  defaultBranch: string;
}
```

### 4.3 Change

```typescript
export interface Change {
  id: string;
  baseRef: string;
  candidateRef: string;
  prNumber?: string;
  diffSummary: DiffSummary;
  createdAt: string; // ISO 8601
}

export interface DiffSummary {
  filesChanged: FileDiff[];
  symbolsChanged: SymbolRef[];
  insertions: number;
  deletions: number;
}

export interface FileDiff {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: Hunk[];
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string; // unified diff text
}

export interface SymbolRef {
  file: string;
  name: string;
  kind: 'function' | 'class' | 'method' | 'variable' | 'export';
}
```

### 4.4 Requirement / Intent

```typescript
export interface Requirement {
  id: string;
  text: string;
  source: 'free_text' | 'issue_link' | 'acceptance_criteria';
  expectedChanges: string[];
}

export interface IntentCompilerOutput {
  requirement: Requirement;
  journeys: Journey[];
  protectedBehaviors: ProtectedBehavior[];
  expectedChangeSummary: string;
}
```

### 4.5 Journey and Steps

```typescript
export interface Journey {
  id: string;
  changeId: string;
  name: string;
  description: string;
  type: 'user' | 'system' | 'api' | 'data';
  priority: number;
  source: 'requirement' | 'impact' | 'developer' | 'inferred';
  confidence: ConfidenceLevel;
  steps: JourneyStep[];
}

export interface JourneyStep {
  id: string;
  journeyId: string;
  sequence: number;
  actionType: 'http' | 'cli' | 'function' | 'db';
  input: StepInput;
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
```

### 4.6 Protected Behavior

```typescript
export type ConfidenceLevel = 'confirmed' | 'test_derived' | 'contract_derived' | 'inferred';

export interface ProtectedBehavior {
  id: string;
  changeId: string;
  description: string;
  source: ConfidenceLevel;
  confidence: ConfidenceLevel; // same field, kept for readability
  workflowName: string;
  relatedCodeRefs: string[];
}
```

### 4.7 Impact Analysis

```typescript
export interface ImpactSet {
  affectedFiles: string[];
  affectedSymbols: SymbolRef[];
  affectedServices: string[];
  affectedWorkflows: string[];
  crossServiceWarning?: string;
}

export interface ServiceMap {
  services: Record<string, ServiceDefinition>;
}

export interface ServiceDefinition {
  port?: number;
  dependsOn?: string[];
  startCommand?: string;
  healthCheck?: string;
}
```

### 4.8 Scenario

```typescript
export interface Scenario {
  id: string;
  journeyId: string;
  protectedBehaviorId?: string;
  requirementId?: string;
  steps: JourneyStep[];
  expectedInvariantHint?: string;
  deterministic: true; // always true for MVP
  seedDataRef: string;
}
```

### 4.9 Execution

```typescript
export type ExecutionSide = 'baseline' | 'candidate';

export interface RunnerConfig {
  side: ExecutionSide;
  ref: string;
  repositoryPath: string;
  serviceMap: ServiceMap;
  scenarioTimeoutSeconds: number;
}

export interface RawExecution {
  scenarioId: string;
  side: ExecutionSide;
  steps: RawStepResult[];
  startedAt: string;
  completedAt: string;
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
```

### 4.10 Observations

```typescript
export interface Observation {
  id: string;
  rehearsalRunId: string;
  scenarioId: string;
  side: ExecutionSide;
  rawOutput: RawExecution;
  normalizedOutput: NormalizedOutput;
  capturedAt: string;
}

export interface NormalizedOutput {
  steps: NormalizedStepOutput[];
}

export interface NormalizedStepOutput {
  stepId: string;
  status: 'success' | 'failure' | 'skipped';
  httpStatus?: number;
  httpBody?: unknown; // timestamps, IDs scrubbed
  selectedHeaders?: Record<string, string>; // auth headers scrubbed
  dbSnapshot?: Record<string, unknown>;
  assertions?: AssertionResult[];
}

export interface AssertionResult {
  description: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
}
```

### 4.11 Comparison and Verdicts

```typescript
export type Verdict = 'unchanged' | 'changed' | 'regression' | 'potentially_affected' | 'not_exercised';

export interface BehavioralDifference {
  id: string;
  scenarioId: string;
  journeyId: string;
  verdict: Verdict;
  diffDetail: DiffDetail;
  isExpected: boolean; // true if requirement accounts for the difference
}

export interface DiffDetail {
  stepDiffs: StepDiff[];
  summary: string;
}

export interface StepDiff {
  stepId: string;
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
```

### 4.12 Evidence and Run Result

```typescript
export interface Evidence {
  id: string;
  behavioralDifferenceId: string;
  observationRefs: string[];
  storagePath: string;
  artifactRefs: string[];
}

export interface RehearsalRun {
  id: string;
  changeId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  baselineBuildStatus: 'success' | 'failure' | 'pending';
  candidateBuildStatus: 'success' | 'failure' | 'pending';
}

/** The full typed result returned to the CLI layer */
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
  /** Absolute path to artifacts/<run-id>/ */
  artifactsDir: string;
}
```

---

## 5. Module Interfaces

### 5.1 RepositoryLoader

```typescript
// src/engine/repository/loader.ts

interface RepositoryLoader {
  load(ref: RepositoryRef): Promise<RepositoryContext>;
}
```

**Responsibilities:**
- Verify path exists and is a git repository
- Detect language and framework (package.json → Node.js, requirements.txt → Python, etc.)
- Return `RepositoryContext` with `localPath`, `language`, `frameworks`, `defaultBranch`

**Failure:** throws `EngineError` with `code: 'REPOSITORY_NOT_FOUND'` or `'UNSUPPORTED_LANGUAGE'`

---

### 5.2 ChangeExtractor

```typescript
// src/engine/change/extractor.ts

interface ChangeExtractor {
  extract(repo: RepositoryContext, changeRef: ChangeRef): Promise<Change>;
}
```

**Responsibilities:**
- Run `git diff <baseRef>..<candidateRef>` and parse unified diff
- Extract `FileDiff[]` with hunks
- Extract changed symbols using regex/AST heuristics (MVP: regex is sufficient)
- Populate `DiffSummary`

**Failure:** throws `EngineError` with `code: 'GIT_DIFF_FAILED'`

---

### 5.3 IntentJourneyCompiler

```typescript
// src/engine/intent/compiler.ts

interface IntentJourneyCompiler {
  compile(
    change: Change,
    requirement: RequirementInput | undefined,
    repo: RepositoryContext
  ): Promise<IntentCompilerOutput>;
}
```

**Responsibilities:**
- If `deterministicMode` is set, return fixture-based journeys from `fixtures/shopflow/journeys.json`
- Otherwise, call LLM with the diff summary + requirement, parse response into `Journey[]` + `ProtectedBehavior[]`
- LLM output is always validated against the schema before use — never passed raw to downstream
- Set `confidence: 'inferred'` on all LLM-derived outputs; human confirmation upgrades to `'confirmed'`

**Key invariant:** output is a frozen typed structure before any downstream module uses it.

---

### 5.4 ImpactAnalyzer

```typescript
// src/engine/impact/analyzer.ts

interface ImpactAnalyzer {
  analyze(
    change: Change,
    repo: RepositoryContext,
    serviceMap: ServiceMap,
    journeys: Journey[]
  ): Promise<ImpactSet>;
}
```

**Responsibilities:**
- Within-service: grep/AST walk changed symbols to find call sites
- Cross-service: consult `ServiceMap` to flag dependent services
- Return `ImpactSet` with `affectedFiles`, `affectedSymbols`, `affectedServices`, `affectedWorkflows`
- If service map is absent, set `crossServiceWarning`

---

### 5.5 ProtectedBehaviorResolver

```typescript
// src/engine/behavior/resolver.ts

interface ProtectedBehaviorResolver {
  resolve(
    change: Change,
    impact: ImpactSet,
    intentOutput: IntentCompilerOutput,
    repo: RepositoryContext
  ): Promise<ProtectedBehavior[]>;
}
```

**Responsibilities:**
- Merge behaviors from four sources: `confirmed` (developer YAML), `test_derived` (existing tests), `contract_derived` (OpenAPI/JSON Schema), `inferred` (LLM/intent compiler)
- Enforce the confidence ordering: never upgrade source without explicit developer action
- Deduplicate by `workflowName`

---

### 5.6 ScenarioPlanner

```typescript
// src/engine/scenario/planner.ts

interface ScenarioPlanner {
  plan(
    journeys: Journey[],
    protectedBehaviors: ProtectedBehavior[],
    impact: ImpactSet
  ): Promise<Scenario[]>;
}
```

**Responsibilities:**
- Convert each `Journey` with its `JourneyStep[]` into a `Scenario` with `seedDataRef`
- Mark `deterministic: true` — for MVP this is a type-level guarantee
- If a journey cannot be mapped to a deterministic scenario, create a `BehavioralDifference` with `verdict: 'not_exercised'` immediately
- For MVP, seed data for ShopFlow journeys is bundled as JSON fixtures

---

### 5.7 RehearsalOrchestrator

```typescript
// src/engine/execution/orchestrator.ts

interface RehearsalOrchestrator {
  run(
    scenarios: Scenario[],
    change: Change,
    repo: RepositoryContext,
    serviceMap: ServiceMap,
    options: RehearsalOptions
  ): Promise<{
    run: RehearsalRun;
    rawExecutions: RawExecution[];
  }>;
}
```

**Responsibilities:**
- Create `RehearsalRun` record with unique ID
- Start baseline service at `baseRef` and candidate service at `candidateRef`
- For each scenario: run against baseline, then run against candidate
- If `scopedScenarioIds` is set (repair loop), only run those scenarios
- Collect `RawExecution[]`
- Tear down services after all scenarios complete

**Execution isolation (MVP):**
- Use `child_process.spawn` to start the service with environment variables pointing to seed data
- No Docker for MVP (complexity), but services are given a clean working directory copy per run
- If Docker is available and `DOCKER_AVAILABLE=true`, use disposable containers (future upgrade)
- Timeout enforced via `AbortController` per scenario

---

### 5.8 Runner

```typescript
// src/engine/execution/runner.ts

interface Runner {
  startService(config: RunnerConfig): Promise<ServiceHandle>;
  runScenario(handle: ServiceHandle, scenario: Scenario): Promise<RawExecution>;
  stopService(handle: ServiceHandle): Promise<void>;
}

interface ServiceHandle {
  side: ExecutionSide;
  baseUrl: string;
  pid?: number;
  containerId?: string;
}
```

**Responsibilities:**
- Check out the correct git ref into a temp directory (or use worktrees)
- Apply seed data (copy fixture JSON to expected path)
- Start service, wait for health check
- Execute each `JourneyStep` in sequence, capturing `RawStepResult`
- Stop and clean up

---

### 5.9 ObservationCollector + Normalizer

```typescript
// src/engine/execution/collector.ts

interface ObservationCollector {
  collect(
    rehearsalRunId: string,
    rawExecution: RawExecution
  ): Observation;
}

// src/engine/execution/normalizer.ts

interface Normalizer {
  normalize(raw: RawExecution): NormalizedOutput;
}
```

**Normalizer strips:**
- ISO timestamps → `"<timestamp>"`
- UUID/trace IDs → `"<id>"`
- Auto-increment integer IDs in bodies → `"<id>"`
- `Authorization`, `X-Api-Key`, `Cookie` headers → `"<scrubbed>"`
- `password`, `token`, `secret` fields in JSON bodies → `"<scrubbed>"`

The normalizer is pure and stateless — a given `RawExecution` always produces the same `NormalizedOutput`.

---

### 5.10 BehavioralComparator

```typescript
// src/engine/comparison/comparator.ts

interface BehavioralComparator {
  compare(
    baselineObs: Observation,
    candidateObs: Observation,
    scenario: Scenario,
    requirement: Requirement | undefined,
    protectedBehaviors: ProtectedBehavior[]
  ): BehavioralDifference;
}
```

**Algorithm:**
1. Deep-compare `normalizedOutput` step by step
2. If identical → `verdict: 'unchanged'`
3. If different:
   a. Check if the difference is in `requirement.expectedChanges` → `verdict: 'changed'`, `isExpected: true`
   b. Check if the affected field is covered by a `ProtectedBehavior` → `verdict: 'regression'`
   c. Otherwise → `verdict: 'changed'`, `isExpected: false`
4. Fill `diffDetail.stepDiffs` with field-level diffs

**No LLM involvement in comparison** — purely structural.

---

### 5.11 RegressionClassifier

```typescript
// src/engine/comparison/classifier.ts

interface RegressionClassifier {
  classify(
    diff: BehavioralDifference,
    protectedBehaviors: ProtectedBehavior[]
  ): Regression | null;
}
```

**Returns a `Regression`** when:
- `diff.verdict === 'regression'`
- Maps to a `ProtectedBehavior`
- Sets `severity` based on `confidence` level of the protected behavior
- Sets `recommendedAction` (e.g. "Fix caching to respect inventory updates")

---

### 5.12 EvidenceStore

```typescript
// src/engine/store/evidence-store.ts

interface EvidenceStore {
  /** Write all artifacts for this run to artifacts/<runId>/ */
  persist(result: Partial<RehearsalResult>): Promise<Evidence[]>;
  /** Read a previously persisted run */
  read(runId: string): Promise<RehearsalResult>;
}
```

**Storage layout:**
```
artifacts/
└── <run-id>/
    ├── run.json                  # RehearsalRun
    ├── change.json               # Change
    ├── requirement.json          # Requirement (if provided)
    ├── journeys.json             # Journey[]
    ├── protected-behaviors.json  # ProtectedBehavior[]
    ├── scenarios.json            # Scenario[]
    ├── observations/
    │   ├── baseline-<scenario-id>.json
    │   └── candidate-<scenario-id>.json
    ├── diffs.json                # BehavioralDifference[]
    ├── regressions.json          # Regression[]
    └── evidence.json             # Evidence[]
```

All files are UTF-8 JSON. No binary formats. No external database for MVP.

---

## 6. Pipeline Wiring (`pipeline.ts`)

```typescript
// src/engine/pipeline.ts

export async function runRehearsal(input: RehearsalInput): Promise<RehearsalResult> {
  // 1. Load repository
  // 2. Extract change
  // 3. Compile intent + journeys
  // 4. Analyze impact
  // 5. Resolve protected behaviors
  // 6. Plan scenarios
  // 7. Orchestrate execution (baseline + candidate)
  // 8. Collect + normalize observations
  // 9. Compare observations
  // 10. Classify regressions
  // 11. Persist evidence
  // 12. Return RehearsalResult
}
```

The pipeline is **linear** for MVP. Each step receives the output of the previous step as its typed input. No shared mutable state.

---

## 7. Error Handling

All engine errors use a typed hierarchy:

```typescript
// src/engine/errors.ts

export class EngineError extends Error {
  constructor(
    public code: EngineErrorCode,
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export type EngineErrorCode =
  | 'REPOSITORY_NOT_FOUND'
  | 'UNSUPPORTED_LANGUAGE'
  | 'GIT_DIFF_FAILED'
  | 'INTENT_COMPILER_FAILED'
  | 'LLM_RESPONSE_INVALID'
  | 'SCENARIO_NOT_DETERMINISTIC'
  | 'SERVICE_START_FAILED'
  | 'SERVICE_HEALTH_CHECK_TIMEOUT'
  | 'SCENARIO_EXECUTION_TIMEOUT'
  | 'SCENARIO_EXECUTION_FAILED'
  | 'OBSERVATION_NORMALIZATION_FAILED'
  | 'EVIDENCE_WRITE_FAILED'
  | 'RUN_NOT_FOUND';
```

**Error handling rules:**
- Build failures → recorded in `RehearsalRun.baselineBuildStatus` / `candidateBuildStatus`, not thrown
- Scenario generation failure → `BehavioralDifference` with `verdict: 'not_exercised'`, not thrown
- LLM failure → fall through to deterministic fixture mode if available, else throw `INTENT_COMPILER_FAILED`
- IO failures → always throw `EngineError` with the appropriate code

---

## 8. API Contract (with CLI / Bhavesh layer)

The engine is a TypeScript library. The CLI layer imports `runRehearsal` directly.

For a potential HTTP API wrapper (future), the REST contract is:

```
POST   /api/rehearsals              body: RehearsalInput         → 202 { runId }
GET    /api/rehearsals/:id          → 200 RehearsalRun
GET    /api/rehearsals/:id/report   → 200 RehearsalResult
POST   /api/rehearsals/:id/rerun    body: { scopedScenarioIds? } → 202 { runId }
GET    /api/rehearsals/:id/evidence/:scenarioId → 200 Evidence
```

All responses are JSON. All IDs are UUIDs (v4). All timestamps are ISO 8601.

---

## 9. Execution Model

### Environment Variables

| Variable | Purpose |
|---|---|
| `CR_ARTIFACTS_DIR` | Override artifacts root (default: `./artifacts`) |
| `CR_LLM_API_KEY` | API key for the LLM (never logged, never in evidence) |
| `CR_LLM_MODEL` | LLM model name (default: `watsonx/ibm/granite-3-3-8b-instruct`) |
| `CR_SCENARIO_TIMEOUT_SECONDS` | Per-scenario timeout (default: 30) |
| `CR_DETERMINISTIC_MODE` | Skip LLM, use fixture journeys (default: `false`) |
| `DOCKER_AVAILABLE` | If `true`, use Docker for service isolation (default: `false`) |

### Seed Data Contract

Each scenario references a `seedDataRef` (e.g. `shopflow/inventory-3-units`).  
The runner loads `fixtures/<seedDataRef>/seed.json` and applies it to the service before execution.  
The service must expose a `POST /test/seed` endpoint (or equivalent) that accepts seed data and resets state.

---

## 10. Determinism Guarantees

For MVP, the following conditions are required for deterministic execution:

1. **Fixed seed data** — the same `seed.json` is applied before every run
2. **Mocked time** — services use `Date.now()` replaceable via env var `CR_FIXED_NOW`
3. **No external network** — services must start with mocked external dependencies
4. **Sequential scenarios** — scenarios run one at a time, never in parallel
5. **Clean state** — seed data is reapplied before each scenario

Running the same `RehearsalInput` twice must produce identical `Verdict` values.

---

## 11. ShopFlow First Path (MVP Target)

The first complete deterministic path to build and prove:

```
1.  RepositoryLoader.load({ localPath: './fixtures/shopflow' })
    → RepositoryContext { language: 'typescript', frameworks: ['express'] }

2.  ChangeExtractor.extract(repo, { baseRef: 'baseline', candidateRef: 'candidate' })
    → Change with FileDiff on product.service.ts

3.  IntentJourneyCompiler.compile(change, { text: 'Add caching to Product API', source: 'free_text' }, repo)
    [deterministicMode = true: returns fixture journeys]
    → Journey: "inventory-visibility-after-update"
    → ProtectedBehavior: "inventory-freshness" (source: 'inferred')

4.  ImpactAnalyzer.analyze(change, repo, serviceMap, journeys)
    → ImpactSet { affectedServices: ['inventory'], affectedWorkflows: ['product-to-inventory'] }

5.  ProtectedBehaviorResolver.resolve(...)
    → ProtectedBehavior[] with "inventory-freshness" at confidence: 'inferred'

6.  ScenarioPlanner.plan(journeys, protectedBehaviors, impact)
    → Scenario: steps = [
        { actionType: 'http', input: { method: 'POST', path: '/inventory/1', body: { stock: 3 } } },
        { actionType: 'http', input: { method: 'GET', path: '/products/1' } },
        { assertion: 'response.body.stock === seedData.stock' }
      ]

7.  RehearsalOrchestrator.run([scenario], change, repo, serviceMap, options)
    → starts baseline service at 'baseline' ref
    → runs scenario → RawExecution (baseline: stock=3 visible)
    → starts candidate service at 'candidate' ref
    → runs scenario → RawExecution (candidate: stock=5 stale cached value)

8.  ObservationCollector.collect(runId, rawBaseline)   → Observation (baseline)
    ObservationCollector.collect(runId, rawCandidate)  → Observation (candidate)

9.  BehavioralComparator.compare(baselineObs, candidateObs, scenario, requirement, behaviors)
    → BehavioralDifference {
        verdict: 'regression',
        diffDetail: { stepDiffs: [{ field: 'body.stock', baseline: 3, candidate: 5 }] },
        isExpected: false
      }

10. RegressionClassifier.classify(diff, protectedBehaviors)
    → Regression {
        severity: 'high',
        recommendedAction: 'Invalidate cache on inventory updates'
      }

11. EvidenceStore.persist(result)
    → artifacts/<run-id>/...

12. return RehearsalResult   → Bhavesh CLI renders Behavioral Diff + Evidence Capsule
```

---

## 12. Test Strategy

### Unit tests (per module)

| Module | Test cases |
|---|---|
| `extractor.ts` | parses unified diff correctly; handles empty diff; handles rename |
| `compiler.ts` | fixture mode returns correct journeys; LLM response validation rejects bad schema |
| `resolver.ts` | confidence ordering preserved; no inferred → confirmed upgrade |
| `planner.ts` | journey → scenario mapping; non-deterministic journey → not_exercised verdict |
| `normalizer.ts` | timestamps scrubbed; UUIDs scrubbed; auth headers scrubbed; idempotent |
| `comparator.ts` | identical outputs → unchanged; stock diff → regression; expected diff → changed |
| `classifier.ts` | regression against protected behavior → Regression; unprotected diff → null |
| `evidence-store.ts` | round-trip write/read; artifacts directory structure |

### Integration tests

- `repository → change → intent → journeys` (fixture mode)
- `journeys → scenarios → baseline execution → observation`
- `observations → comparator → regression`

### End-to-end tests

- ShopFlow caching regression: full pipeline, assert `Verdict === 'regression'` on inventory-freshness
- ShopFlow safe change: assert no regressions on a pure refactor
- Determinism: run the same input twice, assert identical verdicts

### Determinism test

```typescript
const result1 = await runRehearsal(input);
const result2 = await runRehearsal(input);
assert.deepEqual(
  result1.behavioralDifferences.map(d => d.verdict),
  result2.behavioralDifferences.map(d => d.verdict)
);
```

---

## 13. What This Document Does Not Cover

The following are **out of scope for this architecture spec** and owned by other team members:

| Concern | Owner |
|---|---|
| CLI command parsing and UX | Bhavesh |
| Behavioral Diff renderer (table/Markdown) | Bhavesh |
| Evidence Capsule packager and format | Bhavesh |
| GitHub PR diff retrieval and comment posting | Tashvi |
| CI / deployment / demo environment | Tashvi |
| Frontend components | Bhavesh |

The engine's contract to all of the above is: `runRehearsal(input) → RehearsalResult`.

---

## 14. Open Questions (to resolve before Phase 2 coding begins)

| # | Question | Default if unresolved |
|---|---|---|
| Q1 | Service isolation: child process or Docker? | child process for MVP |
| Q2 | LLM provider: watsonx or OpenAI for hackathon? | watsonx / Granite |
| Q3 | Seed data contract: `POST /test/seed` or file replacement? | `POST /test/seed` endpoint |
| Q4 | ShopFlow language: TypeScript/Express or Python/FastAPI? | TypeScript/Express |
| Q5 | Git worktrees vs temp directory copy for baseline/candidate? | `git worktree add` |
| Q6 | Are journeys pre-defined fixtures or always LLM-generated? | Fixtures for MVP demo, LLM for stretch |
