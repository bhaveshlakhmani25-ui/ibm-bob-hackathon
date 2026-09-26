# Change Rehearsal — API Contract

> **Status:** Locked for Phase 1/2 parallel development  
> **Owners:** Reuben (engine), Bhavesh (CLI/UX)  
> **Last updated:** Phase 0

This document defines the interface between the engine layer (Reuben) and the CLI/presentation layer (Bhavesh). Both sides must code to this contract. Changes require sign-off from both owners before implementation.

---

## 1. Primary Function Contract

The engine exposes a single TypeScript entry point:

```typescript
import { runRehearsal } from './src/engine/pipeline.js';
import type { RehearsalInput, RehearsalResult } from './src/engine/types.js';

const result: RehearsalResult = await runRehearsal(input);
```

All types are defined in [`src/engine/types.ts`](./src/engine/types.ts).

### Input

```typescript
interface RehearsalInput {
  repository: { localPath: string };
  change: { baseRef: string; candidateRef: string; prNumber?: number };
  requirement?: { text: string; source: 'free_text' | 'issue_link' | 'acceptance_criteria' };
  options?: {
    scenarioTimeoutSeconds?: number;
    deterministicMode?: boolean;     // true = use fixtures, skip LLM
    scopedScenarioIds?: string[];    // repair loop: only re-run these
  };
}
```

### Output

```typescript
interface RehearsalResult {
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
  artifactsDir: string;             // absolute path to artifacts/<run-id>/
}
```

### Error behavior

- The function **throws `EngineError`** only when the pipeline cannot continue (bad git ref, repo not found, etc.).
- Build failures, execution timeouts, and not-exercised scenarios are **captured in the result** — they do NOT throw.
- The CLI should check `run.baselineBuildStatus` and `run.candidateBuildStatus` and surface errors to the user.

---

## 2. HTTP API Contract (future / optional wrapper)

If an HTTP server wrapper is added:

| Method | Path | Request body | Response |
|---|---|---|---|
| POST | `/api/rehearsals` | `RehearsalInput` | `202 { runId: string }` |
| GET | `/api/rehearsals/:id` | — | `200 RehearsalRun` |
| GET | `/api/rehearsals/:id/report` | — | `200 RehearsalResult` |
| POST | `/api/rehearsals/:id/rerun` | `{ scopedScenarioIds?: string[] }` | `202 { runId: string }` |
| GET | `/api/rehearsals/:id/evidence/:scenarioId` | — | `200 Evidence` |

All responses are `application/json`. All IDs are UUID v4. All timestamps are ISO 8601.

---

## 3. Evidence Capsule Hand-off

The engine writes all artifacts to `artifacts/<run-id>/` and returns `result.artifactsDir`.

Bhavesh's Evidence Capsule packager consumes:

| File | Contents |
|---|---|
| `run.json` | `RehearsalRun` |
| `change.json` | `Change` |
| `requirement.json` | `Requirement` (if provided) |
| `journeys.json` | `Journey[]` |
| `protected-behaviors.json` | `ProtectedBehavior[]` |
| `scenarios.json` | `Scenario[]` |
| `diffs.json` | `BehavioralDifference[]` |
| `regressions.json` | `Regression[]` |
| `evidence.json` | `Evidence[]` |
| `observations/baseline-<id>.json` | `Observation` (one per scenario) |
| `observations/candidate-<id>.json` | `Observation` (one per scenario) |

The capsule renderer reads these files and produces `rehearsal-report.json` and `rehearsal-report.md`.

---

## 4. Verdict Reference

| Verdict | Meaning |
|---|---|
| `unchanged` | Baseline and candidate outputs are identical for this scenario |
| `changed` | Outputs differ; difference is expected per the requirement (`isExpected: true`) |
| `regression` | Outputs differ in a way that violates a protected behavior; not justified by requirement |
| `potentially_affected` | Impact analysis flagged this journey but no scenario exercised it |
| `not_exercised` | No deterministic scenario could be constructed |

---

## 5. Confidence Reference

| Level | Source |
|---|---|
| `confirmed` | Developer-declared in `change-rehearsal.yaml` |
| `test_derived` | Inferred from existing test files |
| `contract_derived` | Inferred from OpenAPI/JSON Schema contracts |
| `inferred` | LLM or fixture-derived |

Confidence ordering: `confirmed > test_derived > contract_derived > inferred`.  
**No downstream component may upgrade confidence without explicit developer action.**

---

## 6. Environment Variables (engine)

| Variable | Default | Description |
|---|---|---|
| `CR_ARTIFACTS_DIR` | `./artifacts` | Root directory for run artifacts |
| `CR_LLM_API_KEY` | — | API key for LLM calls (never logged) |
| `CR_LLM_MODEL` | `watsonx/ibm/granite-3-3-8b-instruct` | LLM model |
| `CR_SCENARIO_TIMEOUT_SECONDS` | `30` | Per-scenario wall-clock timeout |
| `CR_DETERMINISTIC_MODE` | `false` | Skip LLM, use fixture journeys |
| `CR_FIXED_NOW` | — | ISO timestamp to inject as `Date.now()` in services |
| `DOCKER_AVAILABLE` | `false` | Use Docker containers for service isolation |
