# Change Rehearsal — Integration Contract

## Purpose

This contract defines how the Change Rehearsal components connect.

Tashvi owns integration, end-to-end testing, and deployment.

Bhavesh owns the core Change Rehearsal/change-analysis functionality.

Reuben owns the AI/backend functionality.

---

## Overall Flow

Developer
    ↓
Git Change / Diff
    ↓
Change Rehearsal Core
    ↓
Change / Impact Context
    ↓
AI Backend
    ↓
Risk + Rehearsal Analysis
    ↓
Integration Layer
    ↓
Developer-Facing Rehearsal Report

---

## Component Responsibilities

### Bhavesh — Core Engine

The core engine should provide structured information about a code change.

Expected information:

- changed files
- changed functions/classes where available
- Git diff/change information
- affected or potentially affected areas
- relevant tests
- project context

The exact implementation is owned by Bhavesh.

---

### Reuben — AI / Backend

The AI/backend receives the structured change context.

It should return structured analysis containing, where available:

- change summary
- affected areas
- potential risks
- suggested rehearsal scenarios
- relevant tests/checks

Example:

```json
{
  "summary": "Payment timeout changed from 5 to 30 seconds",
  "affected_areas": [
    "Payment API",
    "Retry Service"
  ],
  "risks": [
    "Longer request duration",
    "Changed retry behaviour"
  ],
  "rehearsal_scenarios": [
    "Run payment timeout tests",
    "Test retry behaviour",
    "Test API response time"
  ]
}
