# CHANGE REHEARSAL

View live website - https://ibm-bob-hackathon-1i4m.vercel.app/
Change Rehearsal is a behavioral testing platform designed to validate code changes against intended outcomes. It answers the question: *"What did this code change actually do to the system's behavior?"* rather than just *"What lines of code were changed?"*

## 1. The Problem
Traditional code review relies on static diffs. Reviewers must mentally execute code changes to predict their impact across a complex architecture. This leads to missed regressions, misunderstood requirements, and brittle integrations.

## 2. What CHANGE REHEARSAL Does
Change Rehearsal simulates a code change by compiling "journeys" (end-to-end scenarios) and executing them on both a baseline build and a candidate build. It produces a **Behavioral Diff** that highlights exact divergences in API payloads, logs, or UI outputs.

## 3. The Workflow
1. **Change Submission**: The developer proposes a change (via PR or local candidate branch) and states their requirement/intent.
2. **Start Rehearsal**: The engine triggers an isolated run.
3. **Rehearsal Progress**: The developer watches real-time pipeline status (build, test, analyze).
4. **Behavioral Diff**: A summary report identifies what was preserved, intentionally changed, or broken.
5. **Journey Replay**: The developer clicks into a specific broken journey to see the step-by-step divergence (Baseline vs Candidate observations).
6. **Evidence Capsule**: A portable JSON/UI payload is generated as canonical proof of the test execution, which can be downloaded.
7. **Developer Actions**: The developer can mark divergences as intentional, ignore them, or generate a fix.

## 4. Why Behavioral Rehearsal is Different from Ordinary Diff Review
An ordinary code diff shows **what** changed (e.g. `const timeout = 5000` to `2000`). Behavioral Rehearsal shows the **impact** of that change (e.g. "The checkout journey now fails at step 3 with a timeout error"). It shifts the review from syntax to semantics.

## 5. How to Run It Locally
```bash
# 1. Install dependencies at the root, integration, and web layer
npm install
cd integration && npm install
cd ../web && npm install
cd ..

# 2. Run the full test suite to verify the system
npm run test
cd integration && npm run test
cd ../web && npx vitest run
cd ..

# 3. Start the UI
cd web
npm run dev
```

## 6. The Demo Scenario
**Scenario**: "Add caching to Product API to improve response time." (The `ShopFlow` journey)

**Outcome**:
- **Baseline**: Inventory reflects the latest stock correctly.
- **Candidate**: Stale cached inventory is returned.
- **Behavioral Diff**: Marks this as a `regression`.
- **Journey Replay**: Step 3 (Read Inventory) highlights a divergence: baseline returns stock=1, candidate returns stock=3.
- **Evidence Capsule**: Contains exact JSON trace of the cache failure.
- **Developer Actions**: The user can generate a fix, but it does NOT blindly mutate code - it provides a proposal for review.

## 7. Architecture
The repository uses a strict separation of concerns:
- **Core Engine (`src/`)**: The backend analyzer that runs code and captures observations.
- **Integration Layer (`integration/`)**: A strict JSON-schema contract boundary. Defines the `ReportContract`, `ErrorContract`, etc.
- **Web UI (`web/`)**: A React frontend strictly typed against `src/shared/contracts.ts` that renders the rehearsal payloads.

## 8. Bob's Role in the Development Workflow
Bob (the Agentic AI) served as the primary architect and contributor for this project, working in isolated sessions.
- **Bhavesh**: Architected the frontend layout and UI components (B01-B07).
- **Reuben**: Constructed the Core Engine and mock layers (R01-R08).
- **Tashvi**: Acted as the Integration orchestrator, defining schemas, fixing F-01 vocabulary mismatches, and performing E2E QA tests (T01-T07).

## 9. Current Limitations
- **Mock Engine Boundary**: The current `web/src/services/api.ts` uses simulated engine responses for the `ShopFlow` demo. The real LLM comparator endpoints are stubbed.
- **Read-Only Developer Actions**: Generating a fix currently creates a proposed solution but does not execute the actual filesystem mutations automatically.
