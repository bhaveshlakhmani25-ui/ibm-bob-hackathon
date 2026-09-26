# Change Rehearsal — Product PRD v2

**Tagline:** Don't just review the diff. Rehearse the behavior.

## 1. Product Vision

Change Rehearsal is a tool-agnostic developer tool that validates a proposed software change **before merge** by connecting developer intent to affected application journeys, rehearsing those journeys against the pre-change and post-change versions, and producing evidence-backed behavioral differences.

Think of it as a **flight simulator for software changes**.

The product is not tied to how code was written. A developer may use IBM Bob, Antigravity, another coding assistant, a traditional IDE, or manual coding. Change Rehearsal consumes the resulting repository, change, and optional requirement.

### Core product loop

```text
Requirement + Change
        ↓
Intent → Journey Compiler
        ↓
Impact Analysis
        ↓
Protected Behavior
        ↓
Scenario Generation
        ↓
Journey Rehearsal
        ↓
BASELINE vs CANDIDATE
        ↓
Behavioral Diff
        ↓
Evidence Capsule
        ↓
Developer decision
        ↓
Fix / Re-run / Approve
```

---

## 2. Problem Statement

Developers need to make frequent changes to software, but there is a gap between **changing code** and **knowing what changed in the running system**.

A typical workflow is:

```text
Requirement
    ↓
Developer changes code
    ↓
Run existing tests
    ↓
Tests pass
    ↓
Code review
    ↓
Merge
    ↓
Unexpected regression discovered later
```

Existing tests are valuable, but they mostly cover scenarios that someone has already thought to encode. A change can compile, pass the current tests, and look reasonable in review while altering an edge case, API behavior, state transition, authentication behavior, data consistency, or a downstream workflow.

### Core problem statement

> **Developers lack a fast, evidence-based way to verify that a software change achieves its intended behavior while preserving important behavior that already existed.**

This is a general developer workflow problem. It is not dependent on AI-generated code.

---

## 3. Why This Matters Now

AI-assisted development is increasing the speed and volume of code changes. The verification problem therefore becomes more important, not less.

Stack Overflow's 2025 Developer Survey reports that 84% of respondents use or plan to use AI tools in development; 46% distrust AI output accuracy versus 33% who trust it; 66% report frustration with AI solutions that are "almost right"; and 45% report that debugging AI-generated code can be more time-consuming. These findings support the need for stronger verification, but they do **not** establish that AI-generated code is inherently less safe than manually written code. ([Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/ai))

---

## 4. Product Positioning

### What Change Rehearsal is

> **A pre-merge behavioral validation layer that turns a developer change into an executable rehearsal of the application journeys that the change can affect.**

### What it is not

- Not an AI coding assistant
- Not autocomplete
- Not a generic chatbot
- Not a generic code-review bot
- Not only a test generator
- Not a replacement for CI/CD
- Not an IDE
- Not tied to IBM Bob at runtime

The important product boundary is:

```text
Coding tool
    ↓
creates change
    ↓
CHANGE REHEARSAL
    ↓
verifies behavior
```

---

## 5. Core Product Concept: Intent → Journey

A central product feature is the **Intent → Journey Compiler**.

The developer supplies a requirement such as:

> "Add caching to the Product API to improve response time."

Change Rehearsal translates that intent into potentially affected journeys:

```text
Product browsing
Inventory freshness
Product → Cart
Product → Checkout
```

It then identifies which behaviors are expected to change and which behaviors should remain protected.

This creates a two-sided contract:

```text
WHAT SHOULD CHANGE
        +
WHAT MUST NOT BREAK
```

The compiler output is a **rehearsal plan**, not merely a textual summary.

---

## 6. Protected Behavior

Protected behavior is existing behavior that should remain correct even though it is not the target of the change.

Example:

```text
Change:
Add passwordless login

Protected:
Existing email login
Admin authentication
Session expiration
Password reset
Rate limiting
```

Protected behavior comes from four sources:

| Source | Confidence | Example |
|---|---|---|
| Developer-confirmed | Highest | "Inventory freshness must never change" |
| Test-derived | High | Existing test assertion |
| Contract-derived | Medium-high | OpenAPI/type/schema expectation |
| Inferred | Medium/low | Derived from code, calls, and impact |

The product must clearly show the source/confidence of each protected behavior.

The system must never present an inferred behavior as equivalent to a developer-confirmed invariant.

---

## 7. Journey Replay

**Journey Replay** is the main execution concept.

Instead of showing only a code diff, Change Rehearsal replays the same meaningful workflow against:

```text
BASELINE
(pre-change)

and

CANDIDATE
(post-change)
```

Example:

```text
BASELINE
Inventory updated to 3
→ Product page shows 3

CANDIDATE
Inventory updated to 3
→ Product page shows 10  ❌
```

The developer sees an observable difference tied to a journey, not merely an LLM warning.

For the hackathon MVP, execution is deterministic and locally controlled.

---

## 8. Behavioral Diff

Git shows:

```diff
- old code
+ new code
```

Change Rehearsal shows:

```text
BEHAVIORAL DIFF

Product lookup                    ✓ preserved
Price calculation                 ✓ preserved
Inventory freshness              ❌ regression
Checkout flow                     ⚠ not exercised
```

Every row should map to:

```text
journey
protected behavior / requirement
scenario
baseline observation
candidate observation
evidence
```

---

## 9. Evidence Capsule

The **Evidence Capsule** is a portable, human-readable and machine-readable artifact for a rehearsal.

Example:

```text
CHANGE REHEARSAL CAPSULE

Change:
Add caching to Product API

Intent:
Improve Product API latency

Affected journey:
Product → Inventory

Protected behavior:
Inventory reflects latest stock

Scenario:
Update inventory, then read product

Baseline:
Stock = 3

Candidate:
Stock = 10

Verdict:
REGRESSION

Reproduction:
1. Update inventory to 3
2. Request product
3. Observe cached stock = 10

Affected files:
cache.ts
productService.ts

Suggested action:
Invalidate cache on inventory write
```

The capsule can be exported as:

```text
rehearsal-report.json
rehearsal-report.md
```

For the hackathon MVP, this is a report/export feature, not a hosted collaboration service.

---

## 10. Adaptive Rehearsal

Adaptive Rehearsal is a **stretch feature** for the hackathon and a core future direction.

The concept:

```text
Low-impact change
→ targeted rehearsal

Medium-impact change
→ broader rehearsal

High-impact change
→ deep rehearsal
```

Examples:

```text
README change
→ no behavioral execution

UI copy change
→ targeted UI journey

Authentication middleware change
→ auth/session/admin journeys

Payment change
→ checkout/payment/failure/recovery journeys
```

The MVP may use a simple impact score or fixed scope rather than a full adaptive optimizer.

---

## 11. Developer Workflow

### Current workflow

```text
Requirement
→ Change code
→ Existing tests
→ Code review
→ Merge
→ Regression discovered later
```

### Improved workflow

```text
Requirement + Change
→ Impact
→ Intent → Journey
→ Protected Behavior
→ Scenario
→ Baseline / Candidate Replay
→ Behavioral Diff
→ Evidence
→ Fix / Re-run / Approve
→ Merge
```

---

## 12. Target Users

### Developer / IC

Wants confidence before requesting review without manually designing exhaustive regression tests.

### Reviewer / Tech Lead

Wants evidence of behavioral impact rather than re-reading every line of a diff.

### Teams shipping quickly

Need to verify more changes without relying entirely on manual review.

---

## 13. Core Jobs-to-Be-Done

- "When I open a PR, I want to know what behavior actually changed, not just what lines changed."
- "When I touch a shared service or caching layer, I want to know which other journeys could be affected."
- "When my existing tests pass, I want evidence that important existing behavior did not silently change."
- "When a regression is reported, I want a reproducible journey and evidence rather than a vague warning."

---

## 14. Core MVP Features

1. Repository + change ingestion
2. Requirement / acceptance-criteria intake
3. Intent → Journey Compiler
4. Impact analysis
5. Protected behavior resolution
6. Deterministic scenario generation / selection
7. Baseline execution
8. Candidate execution
9. Journey Replay
10. Behavioral Diff
11. Evidence Store
12. Evidence Capsule export
13. Developer fix / re-run flow
14. CLI
15. GitHub PR-oriented output

---

## 15. Non-Goals for the Hackathon MVP

- Full multi-language support
- Hosted execution of arbitrary third-party repositories
- Full autonomous protected-behavior discovery
- Production-scale distributed orchestration
- Full IDE plugin ecosystem
- A complete GitHub App with organization administration
- Non-deterministic ML / probabilistic behavior verification

---

## 16. Tool-Agnostic Runtime Model

Change Rehearsal should accept changes created by:

```text
IBM Bob
Antigravity
Cursor
Claude Code
GitHub Copilot
VS Code
JetBrains
Manual coding
```

The product runtime consumes:

```text
Repository
+
Change / diff
+
Requirement
```

It does not require the coding assistant that produced the change.

---

## 17. Primary Demo — ShopFlow

ShopFlow is a synthetic e-commerce application:

```text
Frontend
  ↓
Authentication
  ↓
Product
  ↓
Inventory
  ↓
Pricing
  ↓
Order
  ↓
Database
```

### Developer task

> "Add caching to the Product API to improve response time."

### Hidden regression

```text
BEFORE
Inventory update → new product state immediately visible

AFTER
Inventory update → stale cached product state
```

### Expected Change Rehearsal output

```text
Intent:
Improve Product API performance

Affected journey:
Product → Inventory

Protected behavior:
Inventory freshness

Scenario:
Update inventory, then read product

BASELINE:
3 units

CANDIDATE:
10 units

❌ REGRESSION DETECTED
```

Evidence includes the actual before/after observations and the reproduction sequence.

---

## 18. Success Metrics

No invented numbers.

Measure during the hackathon benchmark:

- Regression detection rate
- False-positive rate
- False-negative rate
- Analysis time
- Manual investigation steps
- Manual test-design effort
- Rework required
- Actionability of evidence
- Scenarios successfully replayed

---

## 19. Product Promise

Change Rehearsal asks:

```text
What was supposed to change?
What was supposed to stay the same?
What actually changed?
Can we reproduce the difference?
```

### Final one-line pitch

> **Change Rehearsal is a flight simulator for software changes: it turns a developer's intent into executable journeys, replays them before and after a change, and shows the evidence when behavior unexpectedly moves.**
