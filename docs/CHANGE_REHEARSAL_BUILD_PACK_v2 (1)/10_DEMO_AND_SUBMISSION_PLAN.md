# Change Rehearsal — Demo & Submission Plan

## 1. Demo Goal

The judge should understand the product in under one minute and see one complete regression caught with evidence.

---

## 2. Demo Story

### 0:00–0:20 — Problem

> "Git shows developers what lines changed. Existing tests show whether known scenarios still pass. But neither necessarily shows what important application behavior changed."

### 0:20–0:45 — Change

Show ShopFlow developer task:

> "Add caching to Product API."

Developer has a normal-looking PR.

### 0:45–1:10 — Change Rehearsal

Run the CLI.

Show:

```text
Intent
Affected journeys
Protected behaviors
```

### 1:10–1:40 — Journey Replay

Show baseline vs candidate.

```text
BASELINE
stock = 3

CANDIDATE
stock = 10
```

### 1:40–2:00 — Behavioral Diff

```text
❌ Inventory freshness regression
```

Open evidence.

### 2:00–2:30 — Repair

Fix invalidation logic.

Re-run the affected journey.

```text
BASELINE = 3
CANDIDATE = 3
✓ preserved
```

### 2:30–2:50 — GitHub

Show the PR-oriented report/comment.

### 2:50–3:20 — Measured impact

Show actual benchmark results.

### 3:20–3:40 — Bob

Briefly show:

- meaningful Bob tasks
- agentic workflow
- task-session evidence
- `bob_sessions/`

### 3:40–4:00 — Closing

> "Change Rehearsal is a flight simulator for software changes. It turns intent into journeys, replays them before and after a change, and gives developers evidence before they merge."

---

## 3. Hackathon Submission Package

Required/expected project materials should be checked against the live hackathon portal before submission.

Repository should contain:

```text
README.md
source code
bob_sessions/
benchmark/
examples/
docs/
```

Keep:

```text
secrets
API keys
real credentials
client/confidential data
```

out of the repository.

---

## 4. README Structure

```text
CHANGE REHEARSAL

Problem
Solution
How it works
Intent → Journey Compiler
Journey Replay
Behavioral Diff
Evidence Capsule
ShopFlow demo
Architecture
CLI usage
GitHub usage
Benchmark methodology/results
IBM Bob usage
Team
Security/data limitations
Future roadmap
```

---

## 5. Benchmark Presentation

Do not present invented numbers.

Show:

```text
N controlled changes
M regressions seeded
X detected
Y false positives
Average analysis time
Manual investigation comparison
```

All values must come from the team's actual experiment.

---

## 6. Bob Evidence Checklist

For each meaningful Bob task:

```text
Task complete
    ↓
Open task/session summary
    ↓
Capture screenshot/export
    ↓
Save under bob_sessions/<person>/
    ↓
Commit to GitHub
```

Do this during the build, not at the end.

---

## 7. Final Pre-Submission Check

- [ ] Product runs from a clean checkout
- [ ] Demo scenario runs end-to-end
- [ ] Safe-change control works
- [ ] Regression evidence opens
- [ ] Evidence Capsule exports
- [ ] GitHub workflow works or is clearly documented as MVP scope
- [ ] `bob_sessions/` complete
- [ ] No secrets committed
- [ ] Benchmark numbers verified
- [ ] README accurate
- [ ] Demo video shows the actual product
- [ ] Hackathon deliverables checked against the live portal
