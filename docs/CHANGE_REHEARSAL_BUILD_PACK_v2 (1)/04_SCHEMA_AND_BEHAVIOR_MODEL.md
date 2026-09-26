# Change Rehearsal — Schema & Behavior Model v2

## 1. Purpose

This document defines the shared vocabulary and data entities used by the product, architecture, CLI, benchmark, and reports.

The v2 model adds first-class **Journey**, **JourneyStep**, **JourneyReplay**, and **EvidenceCapsule** entities to reflect the final product direction.

---

## 2. Core Vocabulary

- **Behavioral unit** — the smallest observable thing checked after normalization.
- **Journey** — a meaningful user/system workflow that spans one or more executable steps.
- **Journey step** — one action in a journey, such as an HTTP call, CLI invocation, database operation, or function invocation.
- **Baseline** — system at the pre-change ref.
- **Candidate** — system at the post-change ref.
- **Expected change** — behavior the requirement explicitly or structurally expects to change.
- **Intentional change** — a baseline/candidate difference that matches the requirement.
- **Unexpected change** — a difference not justified by the requirement.
- **Regression** — an unexpected change to protected behavior.
- **Protected behavior** — behavior that should remain correct across the change.
- **Confidence** — trust level of a protected behavior: `confirmed > test_derived > contract_derived > inferred`.
- **Observation** — normalized output captured from a single scenario execution on one side.
- **Evidence** — persisted observations and supporting artifacts that justify a verdict.
- **Behavioral Diff** — the workflow-level comparison of baseline and candidate behavior.
- **Journey Replay** — the execution of a journey against baseline and candidate.
- **Evidence Capsule** — a portable report package containing the complete evidence chain for a rehearsal.

---

## 3. Entities

### Project

**Purpose:** top-level container for one repository/engagement.

**Fields:** `id`, `name`, `repository_id`, `created_at`, optional `service_map`.

### Repository

**Purpose:** repository under rehearsal.

**Fields:** `id`, `url_or_path`, `default_branch`, `language`, `frameworks`.

### Change

**Purpose:** specific code change being validated.

**Fields:** `id`, `base_ref`, `candidate_ref`, optional `pr_number`, `diff_summary`, `created_at`.

### Requirement

**Purpose:** developer intent / acceptance criteria.

**Fields:**

```text
id
text
source: free_text | issue_link | acceptance_criteria
expected_changes
```

### Journey

**Purpose:** a meaningful workflow affected by the change.

**Fields:**

```text
id
change_id
name
description
type: user | system | api | data
priority
source: requirement | impact | developer | inferred
confidence
```

**Examples:**

```text
product-browsing
inventory-visibility-after-update
product-to-cart
product-to-checkout
```

### JourneyStep

**Purpose:** one executable action within a journey.

**Fields:**

```text
id
journey_id
sequence
action_type: http | cli | function | db
input
expected_hint
```

### ProtectedBehavior

**Purpose:** behavior that must remain correct.

**Fields:**

```text
id
change_id
description
source: confirmed | test_derived | contract_derived | inferred
confidence
workflow_name
related_code_refs
```

### Scenario

**Purpose:** deterministic executable test scenario tied to a journey, requirement, or protected behavior.

**Fields:**

```text
id
journey_id
protected_behavior_id | requirement_id
steps
expected_invariant_hint
deterministic
seed_data_ref
```

For MVP, `deterministic = true` is required.

### JourneyReplay

**Purpose:** records one journey execution across baseline and candidate.

**Fields:**

```text
id
rehearsal_run_id
journey_id
baseline_status
candidate_status
baseline_observation_refs
candidate_observation_refs
verdict
```

### RehearsalRun

**Purpose:** one invocation of Change Rehearsal.

**Fields:**

```text
id
change_id
started_at
completed_at
status
baseline_build_status
candidate_build_status
```

### Observation

**Purpose:** normalized output of one scenario run on one side.

**Fields:**

```text
id
rehearsal_run_id
scenario_id
side: baseline | candidate
raw_output
normalized_output
captured_at
```

### BehavioralDifference

**Purpose:** comparison of baseline and candidate behavior.

**Fields:**

```text
id
scenario_id
journey_id
verdict: unchanged | changed | potentially_affected | not_exercised
diff_detail
is_expected
```

### Regression

**Purpose:** behavioral difference classified as an unexpected protected-behavior violation.

**Fields:**

```text
id
behavioral_difference_id
protected_behavior_id
severity
recommended_action
```

### Evidence

**Purpose:** link between a verdict and its persisted artifacts.

**Fields:**

```text
id
behavioral_difference_id
observation_refs
storage_path
artifact_refs
```

### EvidenceCapsule

**Purpose:** portable rehearsal report.

**Fields:**

```text
id
rehearsal_run_id
change_summary
requirement_summary
journey_refs
protected_behavior_refs
scenario_refs
behavioral_difference_refs
evidence_refs
reproduction_refs
recommendation
generated_at
formats: json | markdown
```

### RepairAttempt

**Purpose:** tracks a developer fix/re-run cycle.

**Fields:**

```text
id
regression_id
commit_ref
rerun_id
resolved
decision_reason
```

### Report

**Purpose:** rendered Behavioral Diff report.

**Fields:**

```text
id
rehearsal_run_id
rows
generated_at
pr_comment_posted
capsule_ref
```

---

## 4. Source / Confidence Rule

The source/confidence field on `ProtectedBehavior` is authoritative.

```text
confirmed
    ↓
test_derived
    ↓
contract_derived
    ↓
inferred
```

No downstream component may upgrade an inferred behavior to confirmed without explicit developer action.

---

## 5. Journey-to-Scenario Relationship

A journey is the human/workflow abstraction.

A scenario is its executable representation.

Example:

```text
Journey:
Product → Inventory

Scenario:
1. Update inventory to 3
2. GET product
3. Assert displayed stock = 3
```

This distinction lets the UI and evidence operate at a workflow level while the execution engine remains deterministic.

---

## 6. Verdict Semantics

### unchanged

Normalized baseline and candidate outputs match for the relevant behavior.

### changed

Outputs differ in a way relevant to the scenario.

### potentially_affected

Impact analysis identified the journey, but no executable scenario exercised it.

### not_exercised

A behavior exists but the system could not construct a valid deterministic scenario.

---

## 7. Evidence Invariant

Every final verdict must be traceable:

```text
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
