# Change Rehearsal — GitHub & CLI UX Spec v2

## 1. UX Principle

The product should fit into a developer's existing workflow rather than require a new IDE.

```text
Code
→ Git
→ Pull Request
→ Change Rehearsal
→ evidence
→ decision
```

MVP is **CLI-first** with a GitHub-oriented workflow.

---

## 2. Primary CLI

Conceptual interface:

```bash
change-rehearsal run \
  --repo <path> \
  --base <ref> \
  --candidate <ref> \
  --requirement "<text>" \
  --out table
```

PR mode:

```bash
change-rehearsal run \
  --pr <number> \
  --requirement "<text>"
```

Re-run:

```bash
change-rehearsal rerun \
  --run-id <id> \
  --commit <ref>
```

Show report:

```bash
change-rehearsal show --run-id <id>
```

Show evidence:

```bash
change-rehearsal show \
  --run-id <id> \
  --evidence <scenario-id>
```

Exact syntax can change during implementation.

---

## 3. Start Screen

```text
CHANGE REHEARSAL
────────────────────────────────

Repository: shopflow
Base:       main
Candidate:  feature/product-cache

Requirement:
Add caching to the Product API to improve response time.

[ START REHEARSAL ]
```

---

## 4. Intent → Journey Output

```text
INTENT
Improve Product API response time

AFFECTED JOURNEYS
• Product browsing
• Product → Inventory
• Product → Cart
• Product → Checkout

PROTECTED BEHAVIORS
• Inventory freshness [test-derived]
• Price accuracy [confirmed]
```

The UI should make the distinction between intended changes and protected behavior obvious.

---

## 5. Behavioral Diff

```text
BEHAVIORAL DIFF

Journey                         Verdict          Source
────────────────────────────────────────────────────────
Product browsing                 ✓ preserved      test-derived
Price calculation                ✓ preserved      confirmed
Inventory freshness             ❌ regression     test-derived
Product → Checkout               ⚠ not exercised  inferred
```

The user can select a row for evidence.

---

## 6. Journey Replay View

The CLI should offer a compact side-by-side representation:

```text
JOURNEY: Product → Inventory

Step 1: Update inventory to 3
      BASELINE ✓              CANDIDATE ✓

Step 2: Read product
      stock = 3               stock = 10  ❌

Step 3: Compare
      expected = 3            observed = 10

RESULT: REGRESSION
```

The actual visual rendering may remain text-based for MVP.

---

## 7. Evidence View

```text
REGRESSION EVIDENCE

Requirement:
Add caching to Product API

Journey:
Product → Inventory

Protected behavior:
Inventory freshness

Baseline:
stock = 3

Candidate:
stock = 10

Reproduction:
1. Update inventory
2. Read product
3. Observe stale stock

Affected files:
cache.ts
productService.ts
```

---

## 8. Evidence Capsule

Command:

```bash
change-rehearsal show --run-id <id> --format capsule
```

Produces:

```text
rehearsal-report.md
rehearsal-report.json
```

The Markdown artifact is designed to be attached to a PR or shared with a reviewer.

---

## 9. Repair / Re-run UX

```text
❌ Regression detected

[ View evidence ]
[ Generate / inspect fix ]
[ Mark intentional ]
[ Ignore ]
```

After a fix:

```bash
change-rehearsal rerun \
  --run-id <id> \
  --commit <fix-ref>
```

Only affected journeys/scenarios should run when possible.

---

## 10. Final Readiness

```text
✅ READY TO MERGE
0 open regressions

or

⛔ REVIEW REQUIRED
2 open regressions
1 journey not exercised
```

The tool should not call something "safe" when coverage is incomplete.

---

## 11. GitHub PR Comment

Example:

```text
CHANGE REHEARSAL

Intent:
Improve Product API response time

28 scenarios
26 ✓ preserved
1 ⚠ expected change
1 ❌ regression

REGRESSION
Inventory freshness

BASELINE: stock = 3
CANDIDATE: stock = 10

[View evidence]
[View rehearsal capsule]
```

For MVP, the CLI posts this comment using `gh` or the GitHub API.

---

## 12. Exit Codes

- `0` — completed with no open regressions
- `1` — completed with one or more regressions
- `2` — execution/build failure
- `3` — invalid configuration / unsupported repository

---

## 13. MVP UX Non-Goals

- No web dashboard
- No IDE plugin
- No interactive TUI beyond useful CLI output
- No full GitHub App
- No mandatory Antigravity integration

Future integrations can include VS Code, JetBrains, and Antigravity.
