# Change Rehearsal — Bhavesh Implementation Plan
## Branch: `feature/bhavesh-core`

> **Scope:** Product/CLI layer only. Does not include the rehearsal engine (Reuben) or GitHub/CI integration (Tashvi).

---

## 1. What Bhavesh Owns

Per `05_MVP_IMPLEMENTATION_AND_TEST_PLAN.md` and `08_BOB_TEAM_BUILD_CONTEXT.md`:

| Area | Responsibility |
|---|---|
| Application shell / CLI entry | Entry point, command routing, config loading |
| Change / repository input flow | `run` command — accept repo path, refs, requirement text |
| Intent → Journey presentation | Render compiler output from engine |
| Rehearsal dashboard | Live progress display during a run |
| Journey display | Per-journey step-level view |
| Protected behavior display | Source/confidence-labeled behavior list |
| Behavioral Diff interface | Table of verdicts per journey/behavior |
| Regression evidence view | Per-regression detailed view |
| Evidence capsule view | Full portable report (Markdown + JSON export) |
| Developer action controls | Fix / Re-run / Mark intentional / Ignore / Approve |

Bhavesh does **not** own: repository loading, diff extraction, journey/scenario generation, baseline/candidate runners, observation collection, or comparator logic.

---

## 2. Exact Boundary with Reuben's Engine

```
┌─────────────────────────────────────────────┐
│              Reuben's Engine                │
│                                             │
│  RepositoryLoader → ChangeExtractor         │
│  → IntentJourneyCompiler                    │
│  → ImpactAnalyzer                           │
│  → ProtectedBehaviorResolver                │
│  → JourneyScenarioPlanner                   │
│  → RehearsalOrchestrator                    │
│     ├── BaselineRunner                      │
│     └── CandidateRunner                     │
│  → ObservationCollector                     │
│  → BehavioralComparator                     │
│  → EvidenceStore                            │
└─────────────────────────────────────────────┘
                    ║  JSON / TypeScript API
                    ▼
┌─────────────────────────────────────────────┐
│              Bhavesh's Layer                │
│                                             │
│  CLI shell  →  Input flow                   │
│  → RehearsalDashboard                       │
│  → JourneyDisplay                           │
│  → ProtectedBehaviorDisplay                 │
│  → BehavioralDiffTable                      │
│  → EvidenceView                             │
│  → EvidenceCapsuleExport                    │
│  → DeveloperActionControls                  │
└─────────────────────────────────────────────┘
```

The boundary is the **engine's public API surface** (see Section 4). Bhavesh calls it; Reuben implements it. Neither side reaches into the other's internals.

---

## 3. Tech Stack Decisions (Bhavesh Layer)

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript | Type-safe, matches engine contract types |
| CLI framework | `commander` or `ink` | `commander` for simple output; `ink` for live progress/TUI if needed |
| Output formatting | `cli-table3` + ANSI colors via `chalk` | Matches UX spec tables exactly |
| JSON serialization | Native `JSON.stringify` | No extra deps |
| Markdown export | Template literal rendering | Deterministic, no extra deps |
| Test runner | `vitest` | Fast, TypeScript-native |
| Package manager | `npm` (consistent with monorepo) | |

> If a web UI is added post-MVP, it would be a separate package inside the same monorepo and would consume the same engine API contracts.

---

## 4. API / Data Contracts (Bhavesh consumes, Reuben implements)

These must be agreed and frozen before parallel coding. The types below become a shared TypeScript interface file at `src/shared/contracts.ts`.

### 4.1 `POST /api/rehearsals` — Start a rehearsal run

**Request:**
```typescript
interface StartRehearsalRequest {
  repo_path: string;         // absolute or relative path to repository
  base_ref: string;          // git ref for baseline (e.g. "main")
  candidate_ref: string;     // git ref for candidate (e.g. "feature/product-cache")
  requirement?: string;      // free-text developer intent
  pr_number?: number;        // optional GitHub PR number
}
```

**Response:**
```typescript
interface StartRehearsalResponse {
  run_id: string;            // UUID for this rehearsal run
  status: "started" | "queued";
  started_at: string;        // ISO timestamp
}
```

---

### 4.2 `GET /api/rehearsals/:run_id/status` — Poll run progress

**Response:**
```typescript
type RunStatus = "running" | "completed" | "failed" | "build_failed";

interface RehearsalStatusResponse {
  run_id: string;
  status: RunStatus;
  phase: RehearsalPhase;     // current pipeline stage
  started_at: string;
  completed_at?: string;
  baseline_build_status: "pending" | "success" | "failed";
  candidate_build_status: "pending" | "success" | "failed";
  error?: string;            // only present if status === "failed"
}

type RehearsalPhase =
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
```

---

### 4.3 `GET /api/rehearsals/:run_id/report` — Full behavioral diff report

**Response:**
```typescript
interface RehearsalReport {
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

interface ChangeSummary {
  base_ref: string;
  candidate_ref: string;
  pr_number?: number;
  diff_summary: string;       // human-readable description of what changed
  affected_files: string[];
}

interface RequirementSummary {
  text: string;
  source: "free_text" | "issue_link" | "acceptance_criteria";
}

interface IntentSummary {
  description: string;        // e.g. "Improve Product API response time"
  expected_changes: string[]; // e.g. ["Product API response path gains caching"]
}

interface Journey {
  id: string;
  name: string;
  description: string;
  type: "user" | "system" | "api" | "data";
  source: "requirement" | "impact" | "developer" | "inferred";
  confidence: "confirmed" | "test_derived" | "contract_derived" | "inferred";
  steps: JourneyStep[];
}

interface JourneyStep {
  id: string;
  sequence: number;
  action_type: "http" | "cli" | "function" | "db";
  description: string;        // human-readable, e.g. "Update inventory to 3"
  input: Record<string, unknown>;
  expected_hint?: string;
}

interface ProtectedBehavior {
  id: string;
  description: string;
  source: "confirmed" | "test_derived" | "contract_derived" | "inferred";
  confidence: number;         // 0.0–1.0
  workflow_name?: string;
  related_code_refs: string[];
}

type Verdict =
  | "preserved"
  | "intentional_change"
  | "regression"
  | "potentially_affected"
  | "not_exercised";

interface BehavioralDiffRow {
  journey_id: string;
  journey_name: string;
  verdict: Verdict;
  protected_behavior_id?: string;
  protected_behavior_source?: ProtectedBehavior["source"];
  is_expected_change: boolean;
  scenario_id?: string;
  evidence_id?: string;       // null if not_exercised / potentially_affected
}

interface Regression {
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

interface RegressionEvidence {
  scenario_id: string;
  baseline_observation: Observation;
  candidate_observation: Observation;
  reproduction_steps: string[];
  affected_files: string[];
}

interface Observation {
  side: "baseline" | "candidate";
  raw_output: string;
  normalized_output: Record<string, unknown>;
  captured_at: string;
}

interface ReportSummary {
  total_journeys: number;
  total_scenarios: number;
  preserved: number;
  intentional_changes: number;
  regressions: number;
  not_exercised: number;
  potentially_affected: number;
  verdict: "ready_to_merge" | "review_required" | "build_failed";
}
```

---

### 4.4 `GET /api/rehearsals/:run_id/evidence/:evidence_id` — Per-scenario evidence

**Response:**
```typescript
interface EvidenceDetail {
  evidence_id: string;
  scenario_id: string;
  journey: Journey;
  protected_behavior?: ProtectedBehavior;
  requirement?: RequirementSummary;
  baseline_observation: Observation;
  candidate_observation: Observation;
  diff_detail: string;        // human-readable description of the diff
  reproduction_steps: string[];
  affected_files: string[];
  recommended_action?: string;
}
```

---

### 4.5 `POST /api/rehearsals/:run_id/rerun` — Re-run after a fix

**Request:**
```typescript
interface RerunRequest {
  candidate_ref: string;      // new commit ref after the fix
  scope?: "affected_only" | "full"; // default: "affected_only"
}
```

**Response:**
```typescript
interface RerunResponse {
  new_run_id: string;
  parent_run_id: string;
  status: "started";
  scoped_journey_ids: string[]; // journeys being re-run
}
```

---

### 4.6 `GET /api/rehearsals/:run_id/capsule` — Evidence Capsule

**Response:** Raw JSON (`EvidenceCapsule` type) — same as `RehearsalReport` plus `reproduction_refs` and `capsule_format_version`.

The Markdown export is rendered client-side (Bhavesh's layer) from the JSON capsule.

---

## 5. Component Implementation Plan

### 5.1 Application Shell

**File:** `src/cli/index.ts`

Entry point. Registers all commands via `commander`. Handles `--help`, `--version`, exit codes.

```
Exit codes:
  0  → completed, no open regressions
  1  → completed, one or more regressions
  2  → execution/build failure
  3  → invalid config / unsupported repository
```

**Commands registered:**
- `run` → `src/cli/commands/run.ts`
- `rerun` → `src/cli/commands/rerun.ts`
- `show` → `src/cli/commands/show.ts`

---

### 5.2 Change / Repository Input Flow

**File:** `src/cli/commands/run.ts`

Handles:
```
change-rehearsal run \
  --repo <path> \
  --base <ref> \
  --candidate <ref> \
  --requirement "<text>" \
  [--pr <number>] \
  [--out table|json|markdown]
```

Steps:
1. Validate flags (repo exists, refs non-empty).
2. Display start screen (per `06_GITHUB_CLI_UX_SPEC.md` §3).
3. Call `POST /api/rehearsals` with the input.
4. Hand off to `RehearsalDashboard` for live progress.
5. On completion, hand off to `BehavioralDiffTable`.
6. Exit with appropriate code.

**Start screen format:**
```
CHANGE REHEARSAL
────────────────────────────────

Repository: shopflow
Base:       main
Candidate:  feature/product-cache

Requirement:
Add caching to the Product API to improve response time.

[ Starting rehearsal... ]
```

---

### 5.3 Rehearsal Dashboard

**File:** `src/cli/views/RehearsalDashboard.ts`

Polls `GET /api/rehearsals/:run_id/status` every 1s. Renders live phase progress.

```
CHANGE REHEARSAL  ⟳ running

  ✓  Loading repository
  ✓  Extracting change
  ✓  Compiling journeys
  ✓  Analyzing impact
  ●  Resolving protected behaviors...
  ○  Planning scenarios
  ○  Running baseline
  ○  Running candidate
  ○  Comparing
  ○  Generating report
```

On `status === "build_failed"`, renders build failure message and exits code 2.

On `status === "completed"`, transitions to `BehavioralDiffTable`.

---

### 5.4 Intent → Journey Display

**File:** `src/cli/views/IntentJourneyDisplay.ts`

Renders immediately after the compiler phase from the report data. Shows:

```
INTENT
Improve Product API response time

EXPECTED CHANGES
• Product API response path gains caching

AFFECTED JOURNEYS
• Product browsing          [impact]
• Product → Inventory       [requirement]
• Product → Cart            [impact]
• Product → Checkout        [impact]

PROTECTED BEHAVIORS
• Inventory freshness       [test-derived]
• Price accuracy            [confirmed]
```

Confidence levels are color-coded:
- `confirmed` → green
- `test_derived` → cyan
- `contract_derived` → yellow
- `inferred` → dim/gray

The display always labels source. Never shows inferred as equivalent to confirmed.

---

### 5.5 Behavioral Diff Interface

**File:** `src/cli/views/BehavioralDiffTable.ts`

Core output table. Renders `BehavioralDiffRow[]` from the report.

```
BEHAVIORAL DIFF
────────────────────────────────────────────────────────────
Journey                          Verdict            Source
────────────────────────────────────────────────────────────
Product browsing                 ✓ preserved        test-derived
Price calculation                ✓ preserved        confirmed
Inventory freshness             ❌ regression        test-derived
Product → Checkout               ⚠ not exercised    inferred
────────────────────────────────────────────────────────────
4 journeys  |  1 regression  |  1 not exercised
```

Verdict symbols:
- `preserved` → `✓` green
- `intentional_change` → `~` cyan
- `regression` → `❌` red
- `potentially_affected` → `⚠` yellow
- `not_exercised` → `⚠` dim yellow

The user can press `enter` or pass `--evidence <journey-id>` to drill into a row.

---

### 5.6 Journey Replay Display

**File:** `src/cli/views/JourneyReplayView.ts`

Step-by-step side-by-side view for a single journey. Rendered when the user selects a row from the Behavioral Diff.

```
JOURNEY: Product → Inventory
──────────────────────────────────────────────────────────

Step 1: Update inventory to 3
        BASELINE ✓               CANDIDATE ✓

Step 2: Read product
        stock = 3                stock = 10  ❌

Step 3: Compare
        expected = 3             observed = 10

──────────────────────────────────────────────────────────
RESULT: ❌ REGRESSION
```

---

### 5.7 Protected Behavior Display

**File:** `src/cli/views/ProtectedBehaviorList.ts`

Standalone list view of all `ProtectedBehavior[]` from the report. Accessible via `change-rehearsal show --run-id <id> --behaviors`.

```
PROTECTED BEHAVIORS

  [confirmed]      Price accuracy
  [test-derived]   Inventory freshness         (products.test.ts)
  [test-derived]   Cart calculation            (cart.test.ts)
  [contract-derived] API response schema
  [inferred]       Admin authentication
```

The `[inferred]` label is always dim and carries a note: "requires developer review for strong claims."

---

### 5.8 Regression Evidence View

**File:** `src/cli/views/EvidenceView.ts`

Renders a single `EvidenceDetail` fetched from `GET /api/rehearsals/:run_id/evidence/:evidence_id`.

```
REGRESSION EVIDENCE
────────────────────────────────

Requirement:
Add caching to Product API

Journey:
Product → Inventory

Protected behavior:
Inventory freshness  [test-derived]

Baseline:
  HTTP 200
  { "stock": 3 }

Candidate:
  HTTP 200
  { "stock": 10 }   ← differs

Reproduction:
  1. Update inventory to 3
  2. GET /products/1
  3. Observe stock field = 10 (expected 3)

Affected files:
  cache.ts
  productService.ts

Suggested action:
  Invalidate cache on inventory write
```

---

### 5.9 Evidence Capsule View + Export

**File:** `src/cli/views/EvidenceCapsuleExport.ts`

Triggered by:
```bash
change-rehearsal show --run-id <id> --format capsule
```

1. Fetches `GET /api/rehearsals/:run_id/capsule`.
2. Writes `rehearsal-report.json` (raw capsule JSON).
3. Renders and writes `rehearsal-report.md` (Markdown template).

**Markdown template structure:**
```markdown
# Change Rehearsal Capsule

## Change
Add caching to Product API

## Intent
Improve Product API response time

## Journeys Rehearsed
- Product browsing          ✓ preserved
- Product → Inventory       ❌ regression
- Product → Cart            ✓ preserved
- Product → Checkout        ⚠ not exercised

## Protected Behaviors
| Behavior | Source | Result |
...

## Regressions
### Inventory freshness
...

## Evidence
...

## Reproduction
...
```

---

### 5.10 Developer Action Controls

**File:** `src/cli/views/DeveloperActions.ts`

Rendered at the bottom of a completed run when regressions exist.

```
❌ 1 regression detected

  [1] View evidence
  [2] Re-run after fix
  [3] Mark as intentional
  [4] Ignore (document reason)
  [5] Export capsule

Enter choice >
```

Behaviour:
- `[1]` → `EvidenceView` for the first/selected regression
- `[2]` → prompt for new commit ref → call `POST /api/rehearsals/:run_id/rerun`
- `[3]` → prompt for reason → stores locally in run metadata
- `[4]` → prompt for reason → stores locally, flags in capsule
- `[5]` → `EvidenceCapsuleExport`

On re-run completion:
```
✅ Re-run complete

  Scoped to 1 affected journey

  Inventory freshness   ✓ preserved  (was ❌ regression)

✅ READY TO MERGE
   0 open regressions
```

---

### 5.11 Final Readiness Display

**File:** `src/cli/views/ReadinessView.ts`

Renders the final verdict at the end of a run or re-run.

```
✅ READY TO MERGE
   0 open regressions
   4 journeys verified
```

or:

```
⛔ REVIEW REQUIRED
   1 regression
   1 journey not exercised
```

or:

```
⚠ INCOMPLETE COVERAGE
   0 regressions
   2 journeys not exercised
   (cannot confirm safe to merge)
```

The tool never claims "safe to merge" when coverage is incomplete.

---

### 5.12 `show` Command

**File:** `src/cli/commands/show.ts`

```bash
change-rehearsal show --run-id <id>
# → renders BehavioralDiffTable for completed run

change-rehearsal show --run-id <id> --evidence <scenario-id>
# → renders EvidenceView for that scenario

change-rehearsal show --run-id <id> --format capsule
# → EvidenceCapsuleExport

change-rehearsal show --run-id <id> --behaviors
# → ProtectedBehaviorList
```

---

### 5.13 `rerun` Command

**File:** `src/cli/commands/rerun.ts`

```bash
change-rehearsal rerun --run-id <id> --commit <ref>
```

1. Calls `POST /api/rehearsals/:run_id/rerun` with the new ref.
2. Displays scoped journeys being re-run.
3. Hands off to `RehearsalDashboard` for progress.
4. On completion, renders `BehavioralDiffTable` with delta annotations.

---

## 6. File / Directory Structure

```
src/
├── shared/
│   └── contracts.ts          ← shared TypeScript types (4.1–4.6 above)
├── cli/
│   ├── index.ts              ← CLI entry point, commander setup
│   ├── commands/
│   │   ├── run.ts
│   │   ├── rerun.ts
│   │   └── show.ts
│   ├── views/
│   │   ├── RehearsalDashboard.ts
│   │   ├── IntentJourneyDisplay.ts
│   │   ├── BehavioralDiffTable.ts
│   │   ├── JourneyReplayView.ts
│   │   ├── ProtectedBehaviorList.ts
│   │   ├── EvidenceView.ts
│   │   ├── EvidenceCapsuleExport.ts
│   │   ├── DeveloperActions.ts
│   │   └── ReadinessView.ts
│   └── utils/
│       ├── apiClient.ts       ← thin HTTP client wrapping fetch/axios
│       ├── formatters.ts      ← ANSI color, verdict symbols, table formatting
│       └── exitCodes.ts       ← exit code constants
└── tests/
    ├── unit/
    │   ├── formatters.test.ts
    │   ├── capsuleExport.test.ts
    │   └── verdictDisplay.test.ts
    └── integration/
        └── runCommand.test.ts
```

---

## 7. Shared Contracts File

The types in Section 4 are the single source of truth. Both Bhavesh (consumer) and Reuben (producer) import from `src/shared/contracts.ts`. Neither side changes this file unilaterally — changes require agreement.

---

## 8. Build Order (Bhavesh Phase Sequence)

### Step 1 — Shared contracts (pair with Reuben, Day 1)

1. Create `src/shared/contracts.ts` with all types from Section 4.
2. Reuben implements the engine to produce these shapes.
3. Bhavesh builds the CLI layer to consume them.

### Step 2 — CLI shell + run command (Day 1)

1. `src/cli/index.ts` — commander setup, version, exit codes.
2. `src/cli/commands/run.ts` — input validation, start screen.
3. `src/cli/utils/apiClient.ts` — POST + GET wrappers.

### Step 3 — RehearsalDashboard (Day 1–2)

Live phase progress with polling. Works even before the engine is complete (mock the status endpoint).

### Step 4 — IntentJourneyDisplay + ProtectedBehaviorList (Day 2)

Render the compiler output. Validates that confidence labels are shown correctly.

### Step 5 — BehavioralDiffTable (Day 2)

Core output. Should be readable by a developer in under 10 seconds.

### Step 6 — JourneyReplayView + EvidenceView (Day 2–3)

Per-journey drill-down. Requires real observations from the engine.

### Step 7 — DeveloperActions + rerun command (Day 3)

Fix/re-run loop. Critical for demo — regression found → fix → re-run → clean.

### Step 8 — EvidenceCapsuleExport + show command (Day 3)

Export and sharable artifact.

### Step 9 — ReadinessView + exit codes (Day 3)

Final verdict and CI-friendly exit behavior.

### Step 10 — Unit tests (ongoing)

Formatters, capsule serialization, verdict display — pure functions, fast tests.

---

## 9. Mock Engine Contract (for parallel development)

Before Reuben's engine is ready, Bhavesh runs against a mock server at `src/tests/mocks/engineMock.ts` that returns static fixtures matching the ShopFlow caching scenario.

Mock fixture produces:
- 4 journeys
- 2 protected behaviors
- 1 regression (`Inventory freshness`, `❌`)
- 1 not exercised (`Product → Checkout`, `⚠`)
- 2 preserved

This allows full UI/CLI development and testing in parallel with engine work.

---

## 10. Integration Gate (with Reuben)

The contract is frozen when:

1. `src/shared/contracts.ts` is committed and both branches import it.
2. The mock server returns valid `contracts.ts` shapes.
3. The engine returns the same shapes from its real implementation.
4. Bhavesh's CLI renders the ShopFlow regression scenario end-to-end from real engine output.

**Acceptance test (Bhavesh's layer):**

```bash
change-rehearsal run \
  --repo ./fixtures/shopflow \
  --base main \
  --candidate feature/product-cache \
  --requirement "Add caching to Product API"
```

Expected output:
```
BEHAVIORAL DIFF
...
Inventory freshness   ❌ regression   test-derived
...

❌ 1 regression detected
```

Exit code: `1`

---

## 11. What This Plan Does Not Include

- The rehearsal engine internals (Reuben's scope)
- GitHub App or Action (Tashvi's scope, Phase 4)
- Web dashboard / IDE plugin (post-MVP)
- Automatic cross-service discovery (post-MVP)
- Non-deterministic ML-based verification (non-goal)
