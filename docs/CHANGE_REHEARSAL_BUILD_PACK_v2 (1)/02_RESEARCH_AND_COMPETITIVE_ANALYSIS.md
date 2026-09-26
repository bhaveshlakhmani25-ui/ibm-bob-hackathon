# Change Rehearsal — Research & Competitive Analysis v2

**Research basis:** current materials reviewed and refreshed for the hackathon build direction.

## 1. Problem Validation

### Regressions are a meaningful software-maintenance problem

The project research pack includes empirical studies reporting that regressions represent roughly half of reported bugs in studied Linux and Chromium datasets. The underlying lesson for Change Rehearsal is not that every change is dangerous, but that previously working behavior can be broken without the defect being obvious from the changed lines.

### AI increases the importance of verification

Stack Overflow's 2025 Developer Survey reports:

- 84% of respondents are using or planning to use AI tools in development.
- 46% distrust the accuracy of AI tools versus 33% who trust them.
- 66% report frustration with AI solutions that are "almost right."
- 45% report that debugging AI-generated code can be more time-consuming.

Source: [Stack Overflow Developer Survey 2025 — AI](https://survey.stackoverflow.co/2025/ai)

These figures support a verification-first product thesis. They do **not** prove that AI-generated code has a higher regression rate than manually written code; Change Rehearsal does not make that claim.

---

## 2. Competitive Reality Check

The key strategic conclusion is:

> **Differential testing, behavioral regression detection, behavior contracts, and change-directed test generation are already active areas of research and product development.**

We should therefore avoid claiming that Change Rehearsal invented behavioral regression testing.

### Testora

Testora is described in research on regression detection using pull-request intent together with behavioral differences between old and new versions.

Source: [Testora / research](https://arxiv.org/abs/2503.18597)

**Implication for us:** requirement-aware differential testing is established prior art.

### DiffTestGen

DiffTestGen is a 2026 research approach for change-directed LLM-based testing. It uses static call-graph information and project documentation to target changed code and expose behavioral differences between versions.

Source: [DiffTestGen](https://arxiv.org/abs/2607.16024)

**Implication for us:** change-directed scenario generation and differential execution are active research; we should not position those components as novel in isolation.

### ShipCheck

ShipCheck currently combines protected behavior, behavior contracts, impact analysis, behavioral history, GitHub-oriented workflows, and base-versus-head runtime verification. Its September 2026 changelog documents differential verification and broader behavior-governance features.

Sources:
- [ShipCheck](https://useshipcheck.dev/)
- [ShipCheck changelog](https://useshipcheck.dev/changelog)

**Implication for us:** behavior contracts + differential verification + GitHub governance are already a live product direction.

### BehaviorDiff

BehaviorDiff is included in the original project research as a close open-source analogue for deterministic before/after comparison of HTTP/database/outbound-call behavior.

Source: [BehaviorDiff](https://github.com/abheeshtroy/BehaviorDiff)

**Implication for us:** baseline/candidate comparison is prior art and should be treated as a foundation, not as our unique claim.

---

## 3. Our Defensible Product Differentiation

The hackathon product should be framed around a **specific workflow composition and experience**, not a claim of category invention.

### Our intended product sequence

```text
Developer requirement
        ↓
Intent → Journey Compiler
        ↓
Affected user/system journeys
        ↓
Protected behavior selection
        ↓
Executable journey plan
        ↓
Baseline replay
        ↓
Candidate replay
        ↓
Behavioral Diff
        ↓
Evidence Capsule
```

### Three product-level features we will emphasize

#### 1. Intent → Journey Compiler

Turn a natural-language change request into affected, executable journeys and protected behaviors.

#### 2. Journey Replay

Show the same journey on the old and new versions, with observable state/output side-by-side.

#### 3. Evidence Capsule

Package the requirement, journey, scenario, protected behavior, baseline, candidate, evidence, and recommendation into one shareable artifact.

These are the product-level experience we will demonstrate. We will not claim that every underlying technique is unique.

---

## 4. Product Positioning Matrix

| Capability | Change Rehearsal | Testora | DiffTestGen | ShipCheck | Traditional code review |
|---|---|---|---|---|---|
| Requirement/intent input | Core | Yes | Uses project docs / change context | Yes | Sometimes |
| Journey-first framing | **Core** | Not the main framing | Not the main framing | Behavior-focused | No |
| Protected behavior | Core | Related | Related | Core | Limited |
| Baseline/head execution | Core | Core to research | Core | Core | No |
| User-visible journey replay | **Core emphasis** | Not the main product framing | Not the main framing | Runtime verification | No |
| Evidence artifact | **Core** | Evidence from testing | Evidence from testing | Core | Comments |
| GitHub workflow | MVP-oriented | Related | Research | Strong | Core |
| Tool-agnostic runtime | Core | Yes | Yes | Yes | Yes |

This table is a positioning aid, not a claim that competitors lack every listed capability.

---

## 5. Technical Feasibility

### Repository understanding

Mature tooling exists for Git, AST parsing, import/call graphs, and test discovery.

### Journey extraction

Feasible for the MVP if we constrain the demo to a known application with explicit entry points and a manageable set of workflows.

### Protected behavior

Feasible as a hybrid:

1. existing tests
2. contracts/docs
3. code/impact inference
4. developer confirmation

Full automatic discovery of every protected behavior is out of scope.

### Scenario generation

Feasible when grounded in deterministic fixtures and known application entry points.

### Before/after execution

Feasible for a small Node/TypeScript application using disposable local environments.

### Behavioral comparison

Feasible with normalized HTTP responses, state snapshots, and deterministic fixtures.

### GitHub integration

Feasible as a thin layer over the CLI using GitHub CLI/API. A full GitHub App is unnecessary for the hackathon MVP.

---

## 6. Research Conclusions That Affect Build Scope

### We should build

```text
Requirement-aware
Journey-centered
Deterministic
Evidence-backed
CLI-first
GitHub-oriented
```

### We should not build

```text
Generic code reviewer
Generic test generator
Generic onboarding assistant
Complete CI/CD platform
Multi-language platform
Full autonomous behavior discovery
```

---

## 7. Honest Differentiation Statement

Use this wording in the pitch rather than claiming category uniqueness:

> **Change Rehearsal focuses on the developer's intent and the application's user/system journeys. Instead of stopping at a code diff or a list of generated tests, it turns the requested change into a concrete rehearsal plan, executes that plan on the baseline and candidate versions, and gives the developer an evidence capsule showing what changed in behavior.**

---

## 8. Sources

- [Stack Overflow Developer Survey 2025 — AI](https://survey.stackoverflow.co/2025/ai)
- [Testora research](https://arxiv.org/abs/2503.18597)
- [DiffTestGen research](https://arxiv.org/abs/2607.16024)
- [ShipCheck](https://useshipcheck.dev/)
- [ShipCheck changelog](https://useshipcheck.dev/changelog)
- [BehaviorDiff](https://github.com/abheeshtroy/BehaviorDiff)
