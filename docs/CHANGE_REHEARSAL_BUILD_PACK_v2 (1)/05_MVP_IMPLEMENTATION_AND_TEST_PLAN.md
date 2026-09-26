# Change Rehearsal — MVP Implementation & Test Plan v2

## 1. MVP Principle

The hackathon MVP must prove **one complete workflow extremely well**.

```text
Repository
→ Change
→ Requirement
→ Intent → Journey
→ Impact
→ Protected Behavior
→ Scenario
→ Baseline Replay
→ Candidate Replay
→ Behavioral Diff
→ Evidence Capsule
→ Developer Action
```

Primary demo: **ShopFlow — add caching to Product API**.

---

## 2. Build Order

### Phase 0 — Foundation (All)

- Keep existing GitHub repo.
- Create the ShopFlow synthetic fixture application.
- Run `/init` in IBM Bob and verify `AGENTS.md`.
- Freeze the tech stack.
- Freeze the API/engine contract between Bhavesh and Reuben.
- Create benchmark fixtures.

**Gate:** local repository and sample app run cleanly.

---

### Phase 1 — Repository + Change + Intent (Reuben, Bhavesh)

Build:

- Repository loader
- Git diff extractor
- Requirement parser
- Intent → Journey Compiler
- Basic impact analysis
- Protected behavior resolver

**Gate:** given the ShopFlow caching requirement and diff, the system produces:

```text
intent
journeys
protected behaviors
candidate scenarios
```

No runtime execution yet.

---

### Phase 2 — Rehearsal Engine (Reuben + Bhavesh)

Build:

- Baseline runner
- Candidate runner
- Deterministic fixture reset
- Journey/scenario executor
- Observation collector
- Noise normalization
- Behavioral comparator
- Evidence store

**Gate:** ShopFlow produces the correct baseline/candidate behavior difference for inventory freshness.

---

### Phase 3 — CLI + Behavioral Diff + Evidence Capsule (Bhavesh)

Build:

- `run`
- `rerun`
- `show`
- table output
- JSON output
- Markdown Evidence Capsule

**Gate:** one CLI invocation produces a complete report that explains the regression without requiring the developer to inspect raw logs manually.

---

### Phase 4 — GitHub + Integration (Tashvi leads integration)

Build:

- `--pr` input
- PR diff retrieval
- PR comment renderer
- end-to-end integration tests
- deployment/demo environment

**Gate:** a real team PR can be rehearsed and receive the Behavioral Diff output.

---

### Phase 5 — Repair Loop + Benchmark (whoever has time)

Build:

- scoped re-run of affected scenarios
- regression fix flow
- 20-case benchmark
- measured results

**Gate:** at least one regression is found, fixed, and verified through a re-run.

---

## 3. Parallel Team Work

### Bhavesh

Owns:

```text
Product UX
CLI
Intent → Journey presentation
Behavioral Diff
Evidence Capsule presentation
Core user workflow
```

### Reuben

Owns:

```text
Engine
Repository/change analysis
Journey/scenario generation
Baseline/candidate execution
Comparison
Regression logic
```

### Tashvi

Owns:

```text
Integration
GitHub workflow
CI
E2E testing
Deployment
Production/demo readiness
```

Tashvi should integrate continuously from Phase 1 onward, not wait until the end.

---

## 4. API Contract Lock

Before parallel coding, Bhavesh and Reuben agree on stable contracts.

Example:

```text
POST /api/rehearsals
GET  /api/rehearsals/:id
GET  /api/rehearsals/:id/report
POST /api/rehearsals/:id/rerun
```

The exact implementation can differ, but the contract must be written down before both sides code heavily against it.

---

## 5. Test Strategy

### Unit

- diff parsing
- intent/journey compiler transforms
- protected behavior resolution
- normalization
- comparator verdicts
- capsule serialization

### Integration

- repository → change → intent → journey
- journey → scenario
- scenario → baseline/candidate
- observations → comparator

### End-to-end

- ShopFlow caching regression
- ShopFlow safe change
- repair and re-run
- PR report generation

### Determinism

Run the same input repeatedly and require identical verdicts.

### Security

Confirm containers cannot read outside the fixture repo and have no unnecessary network access.

---

## 6. Benchmark

Synthetic only.

Example 20-change set:

```text
5 safe changes
5 edge-case regressions
5 dependency regressions
5 behavior/invariant regressions
```

Measure conventional workflow:

```text
investigation time
manual steps
test-design effort
regressions missed
rework
```

Measure Change Rehearsal:

```text
analysis time
journeys generated
scenarios generated
regressions detected
manual steps
rework
evidence produced
```

Never invent the final numbers.

---

## 7. Primary Acceptance Test

Input:

```text
ShopFlow
Change:
Add caching to Product API
```

Expected output:

```text
Journey:
Product → Inventory

Protected behavior:
Inventory freshness

BASELINE:
updated value visible

CANDIDATE:
stale value visible

Verdict:
REGRESSION

Evidence:
request/response or state snapshots
```

---

## 8. Secondary Acceptance Test

A safe code-only refactor should produce:

```text
No protected behavioral regressions
```

This prevents the product from being a machine that flags everything.
