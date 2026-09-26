# Change Rehearsal — Bob Project Context v2

*Use this as product context inside IBM Bob. Keep it synchronized with the actual build.*

## Project Identity

**Change Rehearsal** — "Don't just review the diff. Rehearse the behavior."

A tool-agnostic developer tool that turns a software change plus developer intent into executable journeys, replays them against baseline and candidate versions, and produces evidence-backed behavioral differences before merge.

## Core Product Thesis

```text
Requirement
   ↓
Intent → Journey Compiler
   ↓
Affected journeys
   ↓
Protected behavior
   ↓
Executable scenarios
   ↓
Baseline vs Candidate
   ↓
Journey Replay
   ↓
Behavioral Diff
   ↓
Evidence Capsule
```

## Core Problem

Developers can change code quickly but often lack a fast way to verify what the change actually did to important application behavior. Existing tests may not cover every meaningful workflow.

## Product Principle

**AI proposes; deterministic execution verifies.**

LLM reasoning may:

```text
infer intent
identify journeys
suggest protected behavior
generate scenarios
explain differences
```

Deterministic tooling must:

```text
execute
capture
normalize
compare
persist evidence
```

## Central Differentiators to Demonstrate

1. **Intent → Journey Compiler** — requirement becomes affected executable journeys.
2. **Journey Replay** — the same journey runs against baseline and candidate.
3. **Evidence Capsule** — one portable report ties together intent, journey, before/after evidence, regression and reproduction.

These are product-level differentiation goals, not claims that every underlying technique is unique in research.

## Primary Demo — ShopFlow

Synthetic e-commerce app:

```text
Frontend → Auth → Product → Inventory → Pricing → Order → DB
```

Requirement:

> Add caching to Product API.

Hidden regression:

```text
Inventory update
→ baseline reads fresh stock
→ candidate reads stale cached stock
```

The system should detect and explain this through journey replay.

## MVP

```text
repository
→ change
→ requirement
→ intent/journey
→ impact
→ protected behavior
→ scenario
→ baseline
→ candidate
→ Behavioral Diff
→ Evidence Capsule
→ developer action
```

## Architecture

```text
Repository Loader
→ Change Extractor
→ Intent/Journey Compiler
→ Impact Analyzer
→ Protected Behavior Resolver
→ Journey/Scenario Planner
→ Rehearsal Orchestrator
→ Baseline Runner + Candidate Runner
→ Observation Collector
→ Comparator
→ Evidence Store
→ Behavioral Diff
→ Evidence Capsule
```

## Implementation Priorities

1. ShopFlow fixture + `/init` + contracts.
2. Repository/change/intent/journey pipeline.
3. Baseline/candidate execution and deterministic comparison.
4. Behavioral Diff + Evidence Capsule.
5. CLI.
6. GitHub PR flow.
7. Repair loop + benchmark.

## Team Roles

### Bhavesh — Product + Core Builder

- product workflow
- CLI/UX
- Intent → Journey presentation
- Behavioral Diff
- Evidence Capsule presentation
- core user experience

### Reuben — Engine + AI Builder

- repository/change analysis
- journey/scenario generation
- rehearsal engine
- baseline/candidate execution
- comparator
- regression logic
- backend/engine

### Tashvi — Integration + QA + Deployment

- frontend/backend integration
- GitHub flow
- CI
- end-to-end testing
- deployment
- documentation
- submission/demo readiness

## Branch Workflow

```text
main
  ↑
Tashvi integration
  ↑              ↑
Bhavesh        Reuben
core/product  engine/AI
```

No direct experimental development on `main`.

## Tool Workflow

### IBM Bob

Use for meaningful reasoning-heavy work:

```text
repository understanding
architecture
complex implementation
agentic workflows
parallel analysis
subagents
testing
review
debugging
```

### Antigravity / other AI tools

Use for supporting implementation:

```text
UI
styling
boilerplate
repetitive/mechanical edits
rapid iteration
```

### ChatGPT

Use for:

```text
architecture
task decomposition
prompt design
debugging
technical reasoning
product decisions
```

### GitHub

Single source of truth:

```text
branches
commits
PRs
Bob evidence
final submission
```

## Bobcoin Rules

Each participant has a separate hackathon Bob allocation. Use Bob for meaningful tasks, not trivial edits. Capture task-session evidence at implementation acceptance gates.

## Bob Evidence

Required repository folder:

```text
bob_sessions/
```

Recommended organization:

```text
bob_sessions/
├── bhavesh/
├── reuben/
└── tashvi/
```

Capture the relevant task/session-summary screenshot as the work is completed.

## Security

- synthetic data only
- no secrets
- no client/confidential data
- no real credentials
- baseline/candidate execution isolated
- evidence sanitized

## Current Milestone

**Build-ready / Phase 0:**

1. Create/finalize ShopFlow synthetic app.
2. Freeze tech stack.
3. Freeze engine/UI contracts.
4. Run `/init` in Bob.
5. Begin Phase 1 with Reuben + Bhavesh in parallel.
6. Tashvi prepares integration/CI and begins early integration.
