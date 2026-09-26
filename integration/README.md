# Change Rehearsal — Integration

This folder contains the integration layer contract boundary for Change Rehearsal.

## Role

Tashvi's integration layer is an **orchestration and validation boundary**. It is not an additional AI reasoning stage.

Responsibilities:
- Validates Bhavesh's core output against the input contract before forwarding
- Forwards the structured `Change`/`Journey`/`ProtectedBehavior`/`Scenario` payload to Reuben's rehearsal engine
- Validates Reuben's result against the rehearsal result contract
- Constructs the outbound `rehearsal-report.json` consumed by the CLI/CI layer
- Posts the Behavioral Diff to the GitHub PR comment thread
- Runs E2E tests and CI pipeline

## Integration Flow

```
Bhavesh Core / CLI
      │
      │  InputContract v0.1
      │  (Change + Journeys + ProtectedBehaviors + Scenarios)
      ▼
Tashvi Integration  ←── contract validation
      │
      │  request
      ▼
Reuben Backend / AI Rehearsal
      │
      │  RehearsalResult v0.1
      │  (RehearsalRun + Observations + BehavioralDifferences + EvidenceCapsule)
      ▼
Tashvi Integration  ←── contract validation
      │
      ▼
rehearsal-report.json / rehearsal-report.md / GitHub PR comment
```

## Schemas

| File | Purpose |
|---|---|
| `schemas/input-contract.schema.json` | What Bhavesh must emit |
| `schemas/rehearsal-result.schema.json` | What Reuben must return |
| `schemas/report-contract.schema.json` | What the integration layer emits to CLI/CI |
| `schemas/error-contract.schema.json` | Error envelope for all failure modes |

## Fixtures

| File | Content |
|---|---|
| `fixtures/valid-input.json` | ShopFlow caching change — valid input |
| `fixtures/valid-result-success.json` | ShopFlow regression detected — valid rehearsal result |
| `fixtures/valid-result-failure.json` | Build failure — valid error envelope |

## Running Contract Tests

```bash
cd integration
npm install
npm test
```

Expected output: **17 tests, 0 failures**.

## Contract Documentation

See [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md) for the full human-readable contract specification including:

- What Bhavesh must provide (InputContract)
- What Reuben must return (RehearsalResult)
- What Tashvi passes to CLI/CI (ReportContract)
- Error contract and all failure modes
- Traceability requirements
- Exit code semantics

## Team

- **Bhavesh** — Core engine / CLI / Intent → Journey Compiler / Behavioral Diff presentation
- **Reuben** — Rehearsal engine / AI backend / Baseline+Candidate execution / Comparator
- **Tashvi** — Integration / GitHub / CI / E2E testing / Deployment
