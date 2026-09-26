# Change Rehearsal — Integration Contract v0.1

## Purpose

This document defines the machine-checkable contract boundaries owned by Tashvi's integration layer.

Tashvi's responsibilities are:

- GitHub/PR integration
- CI orchestration
- E2E testing
- Contract validation
- Connecting Bhavesh's core output to Reuben's backend/AI engine
- Consuming the rehearsal result and driving the report layer
- Deployment and demo readiness

Tashvi is **not** an additional AI reasoning stage. The integration layer is an orchestration and validation boundary.

---

## Architecture

```
┌────────────────────┐
│ Bhavesh Core / CLI  │
└─────────┬──────────┘
          │
          │ structured Change
          │ (InputContract v0.1)
          ▼
┌────────────────────┐
│ Tashvi Integration │
│ Contract / CI /    │
│ E2E / GitHub       │
└─────────┬──────────┘
          │
          │ request
          ▼
┌────────────────────┐
│ Reuben Backend /   │
│ AI Rehearsal       │
└─────────┬──────────┘
          │
          │ RehearsalRun /
          │ EvidenceCapsule
          │ (RehearsalResult v0.1)
          ▼
┌────────────────────┐
│ Tashvi Integration │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Report / CLI / CI  │
│ rehearsal-report.  │
│ json / .md         │
└────────────────────┘
```

The integration layer is an **orchestration/validation boundary**, NOT an additional AI reasoning step.

---

## Contract Version

All four contracts carry `"contract_version": "0.1"`.

Increment when any required field changes or a new enum value is added.

---

## A. Input Contract — What Bhavesh Must Provide

**Schema:** [`schemas/input-contract.schema.json`](schemas/input-contract.schema.json)

Bhavesh's core engine emits a single JSON document conforming to this schema after running the Intent → Journey Compiler pipeline.

### Required fields

| Field | Type | Description |
|---|---|---|
| `contract_version` | `"0.1"` | Must be the literal string `"0.1"`. |
| `change` | `Change` | The specific code change being validated. |
| `journeys` | `Journey[]` | Journeys affected by the change, from the Intent → Journey Compiler. |
| `protected_behaviors` | `ProtectedBehavior[]` | Behaviors that must remain correct. |
| `scenarios` | `Scenario[]` | Deterministic executable scenarios. All must have `deterministic: true`. |

### Optional fields

| Field | Type | Description |
|---|---|---|
| `requirement` | `Requirement` | Developer intent/acceptance criteria, if provided by the user. |
| `journey_steps` | `JourneyStep[]` | Executable steps for each journey. |

### Change fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique change identifier. |
| `base_ref` | string | Git ref for the pre-change (baseline) side. |
| `candidate_ref` | string | Git ref for the post-change (candidate) side. |
| `pr_number` | integer | Optional. GitHub PR number. |
| `diff_summary.changed_files` | string[] | At least one file required. |
| `diff_summary.changed_symbols` | string[] | Optional. Function/class names. |
| `created_at` | ISO 8601 | Timestamp. |

### Journey fields

All journeys must include `id`, `change_id`, `name`, `type`, `source`, and `confidence`.

- `type` ∈ `user | system | api | data`
- `source` ∈ `requirement | impact | developer | inferred`
- `confidence` ∈ `confirmed | test_derived | contract_derived | inferred`

No component may upgrade `inferred` confidence to `confirmed` without explicit developer action.

### ProtectedBehavior fields

All protected behaviors must include `id`, `change_id`, `description`, `source`, and `confidence` (both using the same confidence hierarchy).

### Scenario fields

All scenarios must have `deterministic: true`. Non-deterministic scenarios are rejected by the integration contract validator.

### Example

See [`fixtures/valid-input.json`](fixtures/valid-input.json) — the ShopFlow caching change.

---

## B. AI/Backend Result Contract — What Reuben Must Return

**Schema:** [`schemas/rehearsal-result.schema.json`](schemas/rehearsal-result.schema.json)

Reuben's backend/AI rehearsal engine returns a single JSON document conforming to this schema.

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `contract_version` | `"0.1"` | ✓ | Must match. |
| `rehearsal_run` | `RehearsalRun` | ✓ | One invocation of Change Rehearsal. |
| `observations` | `Observation[]` | ✓ | All normalized outputs from baseline and candidate. |
| `behavioral_differences` | `BehavioralDifference[]` | ✓ | Per-scenario/journey verdicts. |
| `evidence_capsule` | `EvidenceCapsule` | ✓ | Portable rehearsal report. |
| `journey_replays` | `JourneyReplay[]` | optional | Per-journey execution pairing. |
| `regressions` | `Regression[]` | optional | Subset of differences classified as violations. |

### RehearsalRun fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique run ID. |
| `change_id` | string | Must match the `change.id` from the input contract. |
| `started_at` | ISO 8601 | Required. |
| `completed_at` | ISO 8601 | Optional (absent on failure). |
| `status` | `completed \| failed \| partial` | `partial` = some scenarios not exercised. |
| `baseline_build_status` | `success \| failed \| skipped` | Optional. |
| `candidate_build_status` | `success \| failed \| skipped` | Optional. |

### Observation fields

Each observation captures one scenario run on one side.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `rehearsal_run_id` | string | |
| `scenario_id` | string | |
| `side` | `baseline \| candidate` | |
| `normalized_output` | object | Required. Noise-stripped output. |
| `raw_output` | object | Optional. |
| `captured_at` | ISO 8601 | |

### BehavioralDifference fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `scenario_id` | string | |
| `journey_id` | string | |
| `verdict` | `unchanged \| changed \| potentially_affected \| not_exercised` | See verdict semantics below. |
| `diff_detail` | object or null | Null when verdict is `unchanged` or `not_exercised`. |
| `is_expected` | boolean | `true` = intentional change (justified by requirement). `false` = regression candidate. |

### Verdict semantics

| Verdict | Meaning |
|---|---|
| `unchanged` | Baseline and candidate outputs match. |
| `changed` | Outputs differ in a way relevant to the scenario. |
| `potentially_affected` | Journey identified as impacted but no executable scenario exercised it. |
| `not_exercised` | Behavior exists but no valid deterministic scenario could be constructed. |

### EvidenceCapsule fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | ✓ | |
| `rehearsal_run_id` | string | ✓ | |
| `change_summary` | string | ✓ | |
| `requirement_summary` | string | optional | |
| `journey_refs` | string[] | ✓ | At least one. |
| `protected_behavior_refs` | string[] | ✓ | |
| `scenario_refs` | string[] | ✓ | At least one. |
| `behavioral_difference_refs` | string[] | ✓ | |
| `evidence_refs` | string[] | optional | |
| `reproduction_refs` | string[] | optional | Human-readable reproduction steps. |
| `recommendation` | string | ✓ | Merge recommendation text. |
| `generated_at` | ISO 8601 | ✓ | |
| `formats` | `("json" \| "markdown")[]` | ✓ | At least one. Must include `"json"` for `rehearsal-report.json`. |

### Example

See [`fixtures/valid-result-success.json`](fixtures/valid-result-success.json) — ShopFlow inventory-freshness regression.

---

## C. Outbound Report Contract — What Tashvi Passes to CLI/CI

**Schema:** [`schemas/report-contract.schema.json`](schemas/report-contract.schema.json)

The integration layer constructs this document from the `RehearsalResult` and writes it to `rehearsal-report.json`. The Markdown companion (`rehearsal-report.md`) is written by the Evidence Capsule layer.

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `contract_version` | `"0.1"` | ✓ | |
| `rehearsal_run_id` | string | ✓ | |
| `change_id` | string | ✓ | |
| `status` | `completed \| partial \| failed` | ✓ | |
| `exit_code` | `0 \| 1 \| 2 \| 3` | ✓ | See exit code table below. |
| `summary` | object | ✓ | Scenario count breakdown. |
| `behavioral_diff_rows` | array | ✓ | One row per journey, for the CLI table and PR comment. |
| `capsule_ref.json_path` | string | ✓ | Path to `rehearsal-report.json`. |
| `capsule_ref.markdown_path` | string | ✓ | Path to `rehearsal-report.md`. |
| `pr_comment_posted` | boolean | optional | Whether the diff was posted to the GitHub PR. |
| `generated_at` | ISO 8601 | ✓ | |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Completed with no open regressions. |
| `1` | Completed with one or more regressions. |
| `2` | Execution or build failure. |
| `3` | Invalid configuration or unsupported repository. |

---

## D. Error Contract

**Schema:** [`schemas/error-contract.schema.json`](schemas/error-contract.schema.json)

Returned instead of a `RehearsalResult` or `ReportContract` when the integration layer encounters a non-recoverable failure.

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `contract_version` | `"0.1"` | ✓ | |
| `status` | `"error"` | ✓ | Always the literal string `"error"`. |
| `error_code` | string | ✓ | Machine-readable. See table below. |
| `message` | string | ✓ | Human-readable description. |
| `exit_code` | `1 \| 2 \| 3` | optional | CLI exit code. |
| `rehearsal_run_id` | string | optional | Present if the run started before failure. |
| `change_id` | string | optional | Present if the change was identified. |
| `detail` | object | optional | Structured machine-readable detail. |
| `occurred_at` | ISO 8601 | optional | |

### Error codes

Maps to the documented failure modes in Technical Architecture §17.

| Error Code | Architecture Failure Mode |
|---|---|
| `BUILD_FAILURE` | Baseline or candidate build failed. |
| `SCENARIO_GENERATION_FAILURE` | Scenario could not be generated; behavior marked as `not_exercised`. |
| `INFERENCE_ONLY_PROTECTED_BEHAVIOR` | All protected behaviors are inferred; developer review required. |
| `CROSS_SERVICE_ANALYSIS_UNAVAILABLE` | Cross-service impact limited by available service map. |
| `INVALID_INPUT_CONTRACT` | Bhavesh's output did not conform to `input-contract.schema.json`. |
| `REHEARSAL_ENGINE_UNAVAILABLE` | Reuben's backend could not be reached or returned an unrecognised response. |

### Example

See [`fixtures/valid-result-failure.json`](fixtures/valid-result-failure.json).

---

## Traceability

Every final verdict must be traceable per the Evidence Invariant (v2 Schema §7):

```
Report row
   ↓
BehavioralDifference
   ↓
Scenario / Journey
   ↓
Baseline Observation
   ↓
Candidate Observation
   ↓
Evidence
```

No verdict may rely solely on an LLM statement.

---

## Machine Validation

```bash
cd integration
npm install
npm test
```

The validator in [`tests/validate-contracts.js`](tests/validate-contracts.js) checks:

1. All valid fixtures pass their respective schemas.
2. Known-invalid data (wrong enum, missing required field, wrong version, `deterministic: false`) is correctly rejected.

17 tests, 0 failures.

---

## File Map

```
integration/
├── schemas/
│   ├── input-contract.schema.json       # A. Input contract (Bhavesh → Tashvi)
│   ├── rehearsal-result.schema.json     # B. AI/Backend result (Reuben → Tashvi)
│   ├── report-contract.schema.json      # C. Outbound report (Tashvi → CLI/CI)
│   └── error-contract.schema.json       # D. Error envelope
├── fixtures/
│   ├── valid-input.json                 # Valid InputContract (ShopFlow caching change)
│   ├── valid-result-success.json        # Valid RehearsalResult (regression detected)
│   └── valid-result-failure.json        # Valid ErrorContract (build failure)
├── tests/
│   └── validate-contracts.js            # Contract validation tests (Node.js, ajv)
├── package.json
├── INTEGRATION_CONTRACT.md              # This document
└── README.md
```
