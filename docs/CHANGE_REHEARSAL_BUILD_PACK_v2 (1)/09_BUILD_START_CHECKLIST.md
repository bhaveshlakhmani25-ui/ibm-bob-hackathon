# Change Rehearsal — Build Start Checklist

## 0. Before Writing Feature Code

- [ ] Confirm final product name: Change Rehearsal
- [ ] Confirm tagline: "Don't just review the diff. Rehearse the behavior."
- [ ] Confirm MVP: Intent → Journey → Replay → Behavioral Diff → Evidence
- [ ] Confirm one demo stack
- [ ] Confirm one ShopFlow fixture
- [ ] Confirm API contracts
- [ ] Confirm Git branch ownership
- [ ] Confirm Bob account/usage for all three participants
- [ ] Confirm `bob_sessions/` folder

---

## 1. Bob Setup

For each participant:

- [ ] Open Bob
- [ ] Confirm hackathon team/account
- [ ] Confirm correct region
- [ ] Confirm Bobcoins
- [ ] Run `/init`
- [ ] Review generated `AGENTS.md`
- [ ] Commit project context

Do not spend Bobcoins on trivial edits.

---

## 2. Git Setup

```text
main
├── feature/bhavesh-core
├── feature/reuben-engine
└── integration/tashvi
```

- [ ] Protect `main` from casual direct edits
- [ ] Agree on commit naming
- [ ] Agree on PR naming
- [ ] Tashvi creates integration branch

---

## 3. First Technical Milestone

### Goal

Get this working before building a polished UI:

```text
ShopFlow repo
    ↓
git diff
    ↓
requirement
    ↓
journey
    ↓
scenario
    ↓
baseline
    ↓
candidate
    ↓
behavioral difference
```

### Success condition

The seeded caching regression is detected.

---

## 4. Bhavesh First Tasks

1. Product shell / CLI entry
2. Intent → Journey output
3. Behavioral Diff renderer
4. Evidence Capsule renderer

Suggested Bob task pattern:

```text
Analyze → Plan → Implement → Test → Review
```

---

## 5. Reuben First Tasks

1. Repository loader
2. Git diff extraction
3. Journey/scenario generation
4. Baseline runner
5. Candidate runner
6. Comparator

---

## 6. Tashvi First Tasks

1. Integration branch
2. Test harness
3. GitHub plumbing
4. Environment configuration
5. Deployment skeleton
6. E2E test plan

---

## 7. First Demo Scenario

```text
Requirement:
Add caching to Product API

Journey:
Product → Inventory

Baseline:
stock = 3

Candidate:
stock = 10

Verdict:
REGRESSION
```

The team should be able to demo this without needing a long setup explanation.

---

## 8. Definition of Done for MVP

- [ ] One supported stack
- [ ] One complete ShopFlow scenario
- [ ] Baseline/candidate execution works
- [ ] Behavioral Diff works
- [ ] Evidence is persisted
- [ ] Evidence Capsule exports
- [ ] Safe-change control case works
- [ ] Repair + re-run works if time allows
- [ ] GitHub PR result works if time allows
- [ ] Bob evidence captured
- [ ] Benchmark started
- [ ] README updated
