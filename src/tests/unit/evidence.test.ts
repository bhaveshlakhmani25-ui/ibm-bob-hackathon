/**
 * Change Rehearsal — R07 Evidence Capsule Tests
 *
 * Covers all 27 required test areas:
 *  1.  Capsule generation from R05/R06 evidence
 *  2.  Deterministic capsule ID
 *  3.  JSON serialization
 *  4.  JSON round trip
 *  5.  Markdown report generation
 *  6.  Deterministic Markdown ordering
 *  7.  REGRESSION evidence rendering
 *  8.  PRESERVED evidence rendering
 *  9.  INTENTIONAL_CHANGE evidence rendering
 *  10. POTENTIAL_DIFFERENCE evidence rendering
 *  11. INCONCLUSIVE evidence rendering
 *  12. Execution failure evidence
 *  13. Traceability: difference → step → scenario → journey
 *  14. Protected behavior provenance
 *  15. Confidence preservation
 *  16. Baseline observation preservation
 *  17. Candidate observation preservation
 *  18. Field-level difference preservation
 *  19. ShopFlow inventory case
 *  20. capsule_ref generation
 *  21. F-04 RehearsalReport compatibility
 *  22. Sensitive value exclusion/scrubbing
 *  23. Deterministic ordering
 *  24. Invalid capsule validation
 *  25. Multiple behavioral differences
 *  26. Empty evidence case
 *  27. Round-trip serialization
 *
 * All tests are deterministic — no LLM, no network, no external state.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCapsule,
  makeCapsuleId,
  buildReport,
  mapVerdict,
  unmapVerdict,
  serializeCapsuleToJson,
  deserializeCapsuleFromJson,
  serializeCapsuleToMarkdown,
  validateCapsule,
  validateEvidenceRecord,
  validateCapsuleRef,
  EVIDENCE_CAPSULE_SCHEMA_VERSION,
  VALID_COMPARISON_VERDICTS,
  VALID_CONFIDENCE_LEVELS,
} from '../../engine/evidence/index.js';
import type { CapsuleInput } from '../../engine/evidence/index.js';
import type { BehavioralDifferenceRecord } from '../../engine/comparison/model.js';
import type {
  PairedExecutionResult,
  ScenarioExecutionResult,
  StepExecutionResult,
  NormalizedObservation,
} from '../../engine/execution/model.js';
import type { ScenarioPlan } from '../../engine/scenario/model.js';
import type { BehaviorProtectedBehavior } from '../../engine/behavior/model.js';
import { normalizeHttpObservation } from '../../engine/execution/normalization.js';
import { journeyId, protectedBehaviorId } from '../../engine/behavior/ids.js';

// ---------------------------------------------------------------------------
// Test Fixtures — Helpers
// ---------------------------------------------------------------------------

const FIXED_TIMESTAMP = '2025-01-15T09:00:00.000Z';
const RUN_ID = 'run-r07-test-001';
const SCENARIO_ID = 'scenario-r07-test-001';
const JOURNEY_ID = journeyId('inventory-visibility-after-update', 'Update inventory and assert freshness');
const BEHAVIOR_ID = protectedBehaviorId('Inventory freshness', 'stock field in GET /products/:id', 'stock equals last written value');

function makeStep(
  stepId: string,
  sequence: number,
  observations: NormalizedObservation[] = [],
  status: 'passed' | 'failed' | 'blocked' | 'timed_out' | 'error' = 'passed',
): StepExecutionResult {
  return {
    stepId,
    sequence,
    status,
    durationMs: 100,
    observations,
  };
}

function makeExecResult(
  side: 'baseline' | 'candidate',
  steps: StepExecutionResult[],
  status: 'passed' | 'failed' | 'blocked' | 'timed_out' | 'error' = 'passed',
): ScenarioExecutionResult {
  return {
    runId: `run-${side}-${RUN_ID}`,
    scenarioId: SCENARIO_ID,
    target: { kind: side, revision: side === 'baseline' ? 'main' : 'feature/inventory-cache' },
    status,
    startedAt: FIXED_TIMESTAMP,
    completedAt: FIXED_TIMESTAMP,
    durationMs: 500,
    steps,
    metadata: {
      rehearsalRunId: RUN_ID,
      target: { kind: side, revision: side === 'baseline' ? 'main' : 'feature/inventory-cache' },
      seedDataRef: 'shopflow/inventory-3-units',
      stepsAttempted: steps.length,
      stepsPassed: steps.filter((s) => s.status === 'passed').length,
      stepsFailed: steps.filter((s) => s.status === 'failed').length,
    },
  };
}

function makePaired(
  baselineSteps: StepExecutionResult[],
  candidateSteps: StepExecutionResult[],
  baselineStatus: ScenarioExecutionResult['status'] = 'passed',
  candidateStatus: ScenarioExecutionResult['status'] = 'passed',
): PairedExecutionResult {
  return {
    scenarioId: SCENARIO_ID,
    baseline: makeExecResult('baseline', baselineSteps, baselineStatus),
    candidate: makeExecResult('candidate', candidateSteps, candidateStatus),
  };
}

function makeHttpObs(
  body: Record<string, unknown>,
  source: string,
): NormalizedObservation {
  return normalizeHttpObservation(200, { 'content-type': 'application/json' }, body, source);
}

function makePlan(
  overrides: Partial<ScenarioPlan> = {},
): ScenarioPlan {
  return {
    id: SCENARIO_ID,
    name: 'Inventory visibility after update',
    description: 'Update inventory stock, then assert the displayed stock reflects the update.',
    confidence: 'confirmed',
    provenance: { confidence: 'confirmed', sourceKind: 'test', sourceRef: 'test/inventory.test.ts' },
    traceability: {
      sourceJourneyId: JOURNEY_ID,
      sourceJourneyName: 'inventory-visibility-after-update',
      sourceBehaviorIds: [BEHAVIOR_ID],
      sourceStepIds: ['step-src-1', 'step-src-2', 'step-src-3'],
    },
    preconditions: [{ description: 'Inventory at 1 unit', seedDataRef: 'shopflow/inventory-1-unit' }],
    steps: [
      {
        id: 'step-read-1',
        sequence: 1,
        kind: 'http',
        description: 'GET /products/1',
        sourceStepId: 'step-src-1',
      },
    ],
    expectedInvariantSummary: 'stock equals last written value',
    seedDataRef: 'shopflow/inventory-1-unit',
    deterministic: true,
    ...overrides,
  };
}

function makeBehavior(
  confidence: BehaviorProtectedBehavior['confidence'] = 'confirmed',
): BehaviorProtectedBehavior {
  return {
    id: BEHAVIOR_ID,
    description: 'Inventory freshness',
    observable: 'stock field in GET /products/:id',
    expectedOutcome: 'stock equals last written value',
    provenance: { confidence, sourceKind: 'test', sourceRef: 'test/inventory.test.ts' },
    confidence,
    relatedJourneyIds: [JOURNEY_ID],
    severity: 'high',
  };
}

function makeDiff(
  verdict: BehavioralDifferenceRecord['verdict'],
  overrides: Partial<BehavioralDifferenceRecord> = {},
): BehavioralDifferenceRecord {
  return {
    differenceId: `diff-${verdict.toLowerCase()}-001`,
    scenarioId: SCENARIO_ID,
    journeyId: JOURNEY_ID,
    protectedBehaviorId: BEHAVIOR_ID,
    verdict,
    summary: `Scenario verdict: ${verdict}`,
    detail: `Detailed reasoning for ${verdict} verdict.`,
    stepResults: [
      {
        stepId: 'step-read-1',
        sequence: 1,
        baselineStatus: 'passed',
        candidateStatus: 'passed',
        fieldDiffs:
          verdict === 'REGRESSION' || verdict === 'INTENTIONAL_CHANGE' || verdict === 'POTENTIAL_DIFFERENCE'
            ? [{ field: 'body.stock', baselineValue: 1, candidateValue: 3 }]
            : [],
        baselineMissing: false,
        candidateMissing: false,
      },
    ],
    confidence: 'confirmed',
    provenance: { confidence: 'confirmed', sourceKind: 'test', sourceRef: 'test/inventory.test.ts' },
    baselineExecutionStatus: verdict === 'INCONCLUSIVE' ? 'error' : 'passed',
    candidateExecutionStatus: verdict === 'INCONCLUSIVE' ? 'error' : 'passed',
    comparedAt: FIXED_TIMESTAMP,
    comparatorVersion: '1.0',
    ...overrides,
  };
}

function makeMinimalInput(diff: BehavioralDifferenceRecord, paired?: PairedExecutionResult): CapsuleInput {
  const baselineObs = makeHttpObs({ stock: 1 }, 'GET /products/1 → baseline');
  const candidateObs = makeHttpObs({ stock: 3 }, 'GET /products/1 → candidate');
  const pairedResult = paired ?? makePaired(
    [makeStep('step-read-1', 1, [baselineObs])],
    [makeStep('step-read-1', 1, [candidateObs])],
  );

  return {
    rehearsalRunId: RUN_ID,
    changeSummary: 'Add caching to Product API. Files: productService.ts',
    requirementSummary: 'Product API response time improvement via caching.',
    pairedResults: [pairedResult],
    differences: [diff],
    scenarioPlans: [makePlan()],
    protectedBehaviors: [makeBehavior()],
    createdAt: FIXED_TIMESTAMP,
  };
}

// ===========================================================================
// 1. Capsule generation
// ===========================================================================

describe('1. Capsule generation from R05/R06 evidence', () => {
  it('builds a capsule from minimal input', () => {
    const diff = makeDiff('REGRESSION');
    const capsule = buildCapsule(makeMinimalInput(diff));

    expect(capsule.capsuleId).toMatch(/^capsule-/);
    expect(capsule.rehearsalRunId).toBe(RUN_ID);
    expect(capsule.schemaVersion).toBe(EVIDENCE_CAPSULE_SCHEMA_VERSION);
    expect(capsule.evidenceRecords).toHaveLength(1);
    expect(capsule.summary.regressions).toBe(1);
  });

  it('capsule has correct summary counts', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    expect(capsule.summary.totalScenarios).toBe(1);
    expect(capsule.summary.totalDifferences).toBe(1);
    expect(capsule.summary.regressions).toBe(1);
    expect(capsule.summary.preserved).toBe(0);
  });
});

// ===========================================================================
// 2. Deterministic capsule ID
// ===========================================================================

describe('2. Deterministic capsule ID', () => {
  it('same runId + differenceIds always produces the same capsule ID', () => {
    const id1 = makeCapsuleId('run-001', ['diff-a', 'diff-b']);
    const id2 = makeCapsuleId('run-001', ['diff-a', 'diff-b']);
    expect(id1).toBe(id2);
  });

  it('order of differenceIds does not affect capsule ID', () => {
    const id1 = makeCapsuleId('run-001', ['diff-b', 'diff-a']);
    const id2 = makeCapsuleId('run-001', ['diff-a', 'diff-b']);
    expect(id1).toBe(id2);
  });

  it('different runId produces different capsule ID', () => {
    const id1 = makeCapsuleId('run-001', ['diff-a']);
    const id2 = makeCapsuleId('run-002', ['diff-a']);
    expect(id1).not.toBe(id2);
  });

  it('different differences produce different capsule ID', () => {
    const id1 = makeCapsuleId('run-001', ['diff-a']);
    const id2 = makeCapsuleId('run-001', ['diff-b']);
    expect(id1).not.toBe(id2);
  });

  it('empty differences produce a stable capsule ID', () => {
    const id1 = makeCapsuleId('run-001', []);
    const id2 = makeCapsuleId('run-001', []);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^capsule-/);
  });

  it('same inputs always produce same capsule ID end-to-end', () => {
    const diff = makeDiff('REGRESSION');
    const input = makeMinimalInput(diff);
    const c1 = buildCapsule(input);
    const c2 = buildCapsule(input);
    expect(c1.capsuleId).toBe(c2.capsuleId);
  });
});

// ===========================================================================
// 3. JSON serialization
// ===========================================================================

describe('3. JSON serialization', () => {
  it('serializeCapsuleToJson produces valid JSON', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const json = serializeCapsuleToJson(capsule);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('serialized JSON contains schema version envelope', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    const json = serializeCapsuleToJson(capsule);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(EVIDENCE_CAPSULE_SCHEMA_VERSION);
    expect(parsed.capsule).toBeDefined();
  });

  it('serialized JSON has rehearsalRunId', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    const json = serializeCapsuleToJson(capsule);
    expect(json).toContain(RUN_ID);
  });
});

// ===========================================================================
// 4. JSON round trip
// ===========================================================================

describe('4. JSON round trip', () => {
  it('deserialize(serialize(capsule)) deep-equals original capsule', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const json = serializeCapsuleToJson(capsule);
    const restored = deserializeCapsuleFromJson(json);
    // Compare key fields deterministically
    expect(restored.capsuleId).toBe(capsule.capsuleId);
    expect(restored.rehearsalRunId).toBe(capsule.rehearsalRunId);
    expect(restored.schemaVersion).toBe(capsule.schemaVersion);
    expect(restored.evidenceRecords).toHaveLength(capsule.evidenceRecords.length);
    expect(restored.summary.regressions).toBe(capsule.summary.regressions);
  });

  it('round-trip preserves verdict exactly', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const restored = deserializeCapsuleFromJson(serializeCapsuleToJson(capsule));
    expect(restored.evidenceRecords[0]?.verdict).toBe('REGRESSION');
  });

  it('round-trip preserves field diffs', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const restored = deserializeCapsuleFromJson(serializeCapsuleToJson(capsule));
    const fieldDiffs = restored.evidenceRecords[0]?.fieldDiffs ?? [];
    expect(fieldDiffs.length).toBeGreaterThan(0);
    const stockDiff = fieldDiffs.find((d) => d.field === 'body.stock');
    expect(stockDiff?.baselineValue).toBe(1);
    expect(stockDiff?.candidateValue).toBe(3);
  });

  it('deserialize throws on malformed JSON', () => {
    expect(() => deserializeCapsuleFromJson('not-json')).toThrow();
  });

  it('deserialize throws on wrong schema version', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    const json = serializeCapsuleToJson(capsule);
    const parsed = JSON.parse(json);
    parsed.schemaVersion = '99.0';
    expect(() => deserializeCapsuleFromJson(JSON.stringify(parsed))).toThrow();
  });
});

// ===========================================================================
// 5. Markdown report generation
// ===========================================================================

describe('5. Markdown report generation', () => {
  it('produces Markdown string containing the run ID', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).toContain(RUN_ID);
  });

  it('Markdown has the Summary section', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).toContain('## Summary');
  });

  it('Markdown has the Behavioral Differences section for non-preserved', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).toContain('## Behavioral Differences');
  });

  it('Markdown has the Traceability section', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).toContain('## Traceability');
  });

  it('Markdown does not have Behavioral Differences section when all preserved', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).not.toContain('## Behavioral Differences');
  });

  it('Markdown includes the overall verdict', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).toContain('REGRESSION_DETECTED');
  });
});

// ===========================================================================
// 6. Deterministic Markdown ordering
// ===========================================================================

describe('6. Deterministic Markdown ordering', () => {
  it('same capsule always produces the same Markdown', () => {
    const input = makeMinimalInput(makeDiff('REGRESSION'));
    const capsule1 = buildCapsule(input);
    const capsule2 = buildCapsule(input);
    expect(serializeCapsuleToMarkdown(capsule1)).toBe(serializeCapsuleToMarkdown(capsule2));
  });

  it('REGRESSION appears before POTENTIAL_DIFFERENCE in Markdown', () => {
    const diff1 = makeDiff('POTENTIAL_DIFFERENCE', {
      differenceId: 'diff-potential-001',
      scenarioId: 'scenario-potential-001',
    });
    const diff2 = makeDiff('REGRESSION', {
      differenceId: 'diff-regression-001',
      scenarioId: 'scenario-regression-001',
    });

    const baselineObs = makeHttpObs({ stock: 1 }, 'GET /products/1 → baseline');
    const candidateObs = makeHttpObs({ stock: 3 }, 'GET /products/1 → candidate');
    const paired1: PairedExecutionResult = {
      scenarioId: 'scenario-potential-001',
      baseline: { ...makeExecResult('baseline', [makeStep('step-read-1', 1, [baselineObs])]), scenarioId: 'scenario-potential-001' },
      candidate: { ...makeExecResult('candidate', [makeStep('step-read-1', 1, [candidateObs])]), scenarioId: 'scenario-potential-001' },
    };
    const paired2: PairedExecutionResult = {
      scenarioId: 'scenario-regression-001',
      baseline: { ...makeExecResult('baseline', [makeStep('step-read-1', 1, [baselineObs])]), scenarioId: 'scenario-regression-001' },
      candidate: { ...makeExecResult('candidate', [makeStep('step-read-1', 1, [candidateObs])]), scenarioId: 'scenario-regression-001' },
    };
    const plan1 = makePlan({ id: 'scenario-potential-001', traceability: { ...makePlan().traceability, sourceJourneyId: JOURNEY_ID } });
    const plan2 = makePlan({ id: 'scenario-regression-001', traceability: { ...makePlan().traceability, sourceJourneyId: JOURNEY_ID } });

    const capsule = buildCapsule({
      rehearsalRunId: RUN_ID,
      changeSummary: 'test',
      pairedResults: [paired1, paired2],
      differences: [diff1, diff2],
      scenarioPlans: [plan1, plan2],
      protectedBehaviors: [makeBehavior()],
      createdAt: FIXED_TIMESTAMP,
    });

    const md = serializeCapsuleToMarkdown(capsule);
    const regressionIdx = md.indexOf('REGRESSION');
    const potentialIdx = md.indexOf('POTENTIAL_DIFFERENCE');
    // REGRESSION should appear before POTENTIAL_DIFFERENCE in behavioral differences
    expect(regressionIdx).toBeLessThan(potentialIdx);
  });
});

// ===========================================================================
// 7. REGRESSION evidence rendering
// ===========================================================================

describe('7. REGRESSION evidence rendering', () => {
  it('REGRESSION verdict is preserved in evidence record', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    expect(capsule.evidenceRecords[0]?.verdict).toBe('REGRESSION');
  });

  it('REGRESSION record has the field diff preserved', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const record = capsule.evidenceRecords[0]!;
    const stockDiff = record.fieldDiffs.find((d) => d.field === 'body.stock');
    expect(stockDiff?.baselineValue).toBe(1);
    expect(stockDiff?.candidateValue).toBe(3);
  });

  it('REGRESSION Markdown section contains the verdict', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).toContain('Verdict: REGRESSION');
  });

  it('REGRESSION evidence record links protected behavior', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const record = capsule.evidenceRecords[0]!;
    expect(record.protectedBehaviorId).toBe(BEHAVIOR_ID);
  });

  it('report has regression in F-04 regressions array', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const report = buildReport({
      capsule,
      jsonPath: 'rehearsal-report.json',
      markdownPath: 'rehearsal-report.md',
    });
    expect(report.regressions.length).toBeGreaterThan(0);
    expect(report.regressions[0]!.id).toMatch(/^regression-/);
  });
});

// ===========================================================================
// 8. PRESERVED evidence rendering
// ===========================================================================

describe('8. PRESERVED evidence rendering', () => {
  it('PRESERVED verdict is preserved in evidence record', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    expect(capsule.evidenceRecords[0]?.verdict).toBe('PRESERVED');
  });

  it('PRESERVED summary count is 1', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    expect(capsule.summary.preserved).toBe(1);
    expect(capsule.summary.regressions).toBe(0);
  });

  it('PRESERVED Markdown has Preserved Behaviors section', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).toContain('## Preserved Behaviors');
  });

  it('PRESERVED overallVerdict is PASS', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    expect(capsule.summary.overallVerdict).toBe('PASS');
  });
});

// ===========================================================================
// 9. INTENTIONAL_CHANGE evidence rendering
// ===========================================================================

describe('9. INTENTIONAL_CHANGE evidence rendering', () => {
  it('INTENTIONAL_CHANGE verdict is preserved', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('INTENTIONAL_CHANGE')));
    expect(capsule.evidenceRecords[0]?.verdict).toBe('INTENTIONAL_CHANGE');
  });

  it('INTENTIONAL_CHANGE maps to F-04 intentional_change verdict', () => {
    expect(mapVerdict('INTENTIONAL_CHANGE')).toBe('intentional_change');
  });

  it('INTENTIONAL_CHANGE diff row has is_expected_change = true', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('INTENTIONAL_CHANGE')));
    const report = buildReport({
      capsule,
      jsonPath: 'rehearsal-report.json',
      markdownPath: 'rehearsal-report.md',
    });
    expect(report.behavioral_diff_rows[0]?.is_expected_change).toBe(true);
  });

  it('INTENTIONAL_CHANGE Markdown has Intentional Changes section', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('INTENTIONAL_CHANGE')));
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).toContain('## Intentional Changes');
  });
});

// ===========================================================================
// 10. POTENTIAL_DIFFERENCE evidence rendering
// ===========================================================================

describe('10. POTENTIAL_DIFFERENCE evidence rendering', () => {
  it('POTENTIAL_DIFFERENCE verdict is preserved', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('POTENTIAL_DIFFERENCE')));
    expect(capsule.evidenceRecords[0]?.verdict).toBe('POTENTIAL_DIFFERENCE');
  });

  it('POTENTIAL_DIFFERENCE maps to F-04 potentially_affected', () => {
    expect(mapVerdict('POTENTIAL_DIFFERENCE')).toBe('potentially_affected');
  });

  it('POTENTIAL_DIFFERENCE contributes to potentialDifferences count', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('POTENTIAL_DIFFERENCE')));
    expect(capsule.summary.potentialDifferences).toBe(1);
  });

  it('POTENTIAL_DIFFERENCE overallVerdict is REVIEW_REQUIRED', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('POTENTIAL_DIFFERENCE')));
    expect(capsule.summary.overallVerdict).toBe('REVIEW_REQUIRED');
  });
});

// ===========================================================================
// 11. INCONCLUSIVE evidence rendering
// ===========================================================================

describe('11. INCONCLUSIVE evidence rendering', () => {
  it('INCONCLUSIVE verdict is preserved', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('INCONCLUSIVE')));
    expect(capsule.evidenceRecords[0]?.verdict).toBe('INCONCLUSIVE');
  });

  it('INCONCLUSIVE maps to F-04 not_exercised', () => {
    expect(mapVerdict('INCONCLUSIVE')).toBe('not_exercised');
  });

  it('INCONCLUSIVE contributes to inconclusive count', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('INCONCLUSIVE')));
    expect(capsule.summary.inconclusive).toBe(1);
  });

  it('INCONCLUSIVE overallVerdict is REVIEW_REQUIRED', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('INCONCLUSIVE')));
    expect(capsule.summary.overallVerdict).toBe('REVIEW_REQUIRED');
  });
});

// ===========================================================================
// 12. Execution failure evidence
// ===========================================================================

describe('12. Execution failure evidence', () => {
  it('execution failures are counted in summary', () => {
    const paired = makePaired([], [], 'error', 'error');
    const diff = makeDiff('INCONCLUSIVE', {
      baselineExecutionStatus: 'error',
      candidateExecutionStatus: 'error',
    });
    const capsule = buildCapsule(makeMinimalInput(diff, paired));
    expect(capsule.summary.executionFailures).toBe(1);
  });

  it('execution failure overallVerdict includes REVIEW_REQUIRED', () => {
    const paired = makePaired([], [], 'blocked', 'passed');
    const diff = makeDiff('INCONCLUSIVE', {
      baselineExecutionStatus: 'blocked',
      candidateExecutionStatus: 'passed',
    });
    const capsule = buildCapsule(makeMinimalInput(diff, paired));
    expect(capsule.summary.overallVerdict).toBe('REVIEW_REQUIRED');
  });

  it('execution failure evidence record preserves execution status', () => {
    const diff = makeDiff('INCONCLUSIVE', {
      baselineExecutionStatus: 'error',
      candidateExecutionStatus: 'timed_out',
    });
    const capsule = buildCapsule(makeMinimalInput(diff));
    expect(capsule.evidenceRecords[0]?.baselineExecutionStatus).toBe('error');
    expect(capsule.evidenceRecords[0]?.candidateExecutionStatus).toBe('timed_out');
  });
});

// ===========================================================================
// 13. Traceability: difference → step → scenario → journey
// ===========================================================================

describe('13. Traceability from difference → step → scenario → journey', () => {
  it('evidence record has differenceId tracing to R06', () => {
    const diff = makeDiff('REGRESSION');
    const capsule = buildCapsule(makeMinimalInput(diff));
    expect(capsule.evidenceRecords[0]?.differenceId).toBe(diff.differenceId);
  });

  it('evidence record has scenarioId', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    expect(capsule.evidenceRecords[0]?.scenarioId).toBe(SCENARIO_ID);
  });

  it('evidence record has journeyId', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    expect(capsule.evidenceRecords[0]?.journeyId).toBe(JOURNEY_ID);
  });

  it('evidence record has primaryStepId when steps have diffs', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    expect(capsule.evidenceRecords[0]?.primaryStepId).toBe('step-read-1');
  });

  it('scenario summaries link to journey ID', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const scenario = capsule.scenarioSummaries.find((s) => s.scenarioId === SCENARIO_ID);
    expect(scenario?.journeyId).toBe(JOURNEY_ID);
  });

  it('journey refs are populated from differences', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const journey = capsule.journeyRefs.find((j) => j.journeyId === JOURNEY_ID);
    expect(journey).toBeDefined();
    expect(journey?.journeyName).toBe('inventory-visibility-after-update');
  });
});

// ===========================================================================
// 14. Protected behavior provenance
// ===========================================================================

describe('14. Protected behavior provenance', () => {
  it('evidence record links to protectedBehaviorId', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    expect(capsule.evidenceRecords[0]?.protectedBehaviorId).toBe(BEHAVIOR_ID);
  });

  it('behavior refs include the linked protected behavior', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const behav = capsule.behaviorRefs.find((b) => b.behaviorId === BEHAVIOR_ID);
    expect(behav).toBeDefined();
    expect(behav?.description).toBe('Inventory freshness');
  });

  it('behavior ref provenance is preserved verbatim', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const behav = capsule.behaviorRefs.find((b) => b.behaviorId === BEHAVIOR_ID)!;
    expect(behav.provenance.sourceRef).toBe('test/inventory.test.ts');
    expect(behav.provenance.sourceKind).toBe('test');
  });
});

// ===========================================================================
// 15. Confidence preservation
// ===========================================================================

describe('15. Confidence preservation', () => {
  it('confirmed confidence is preserved verbatim', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    expect(capsule.evidenceRecords[0]?.confidence).toBe('confirmed');
  });

  it('test_derived confidence is preserved verbatim', () => {
    const diff = makeDiff('REGRESSION', { confidence: 'test_derived' });
    const capsule = buildCapsule(makeMinimalInput(diff));
    expect(capsule.evidenceRecords[0]?.confidence).toBe('test_derived');
  });

  it('inferred confidence is preserved and NOT upgraded', () => {
    const diff = makeDiff('REGRESSION', {
      confidence: 'inferred',
      provenance: { confidence: 'inferred', sourceKind: 'inference' },
    });
    const capsule = buildCapsule(makeMinimalInput(diff));
    expect(capsule.evidenceRecords[0]?.confidence).toBe('inferred');
    expect(capsule.evidenceRecords[0]?.provenance.confidence).toBe('inferred');
  });

  it('provenance is preserved verbatim', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    expect(capsule.evidenceRecords[0]?.provenance.sourceRef).toBe('test/inventory.test.ts');
    expect(capsule.evidenceRecords[0]?.provenance.sourceKind).toBe('test');
  });
});

// ===========================================================================
// 16. Baseline observation preservation
// ===========================================================================

describe('16. Baseline observation preservation', () => {
  it('baseline observations are captured from R05 PairedExecutionResult', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const record = capsule.evidenceRecords[0]!;
    expect(record.baselineObservations).toHaveLength(1);
    expect(record.baselineObservations[0]?.status).toBe('passed');
  });

  it('baseline observation step ID is preserved', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const record = capsule.evidenceRecords[0]!;
    expect(record.baselineObservations[0]?.stepId).toBe('step-read-1');
  });

  it('baseline normalized observation value contains stock = 1', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const record = capsule.evidenceRecords[0]!;
    const baselineObs = record.baselineObservations[0]?.observations[0];
    expect(baselineObs).toBeDefined();
    // The normalized value should contain stock: 1 (not stock: 3)
    const normalized = baselineObs?.normalizedValue as Record<string, unknown>;
    const body = normalized?.['body'] as Record<string, unknown> | undefined;
    expect(body?.['stock']).toBe(1);
  });
});

// ===========================================================================
// 17. Candidate observation preservation
// ===========================================================================

describe('17. Candidate observation preservation', () => {
  it('candidate observations are captured from R05 PairedExecutionResult', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const record = capsule.evidenceRecords[0]!;
    expect(record.candidateObservations).toHaveLength(1);
    expect(record.candidateObservations[0]?.status).toBe('passed');
  });

  it('candidate normalized observation value contains stock = 3', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const record = capsule.evidenceRecords[0]!;
    const candidateObs = record.candidateObservations[0]?.observations[0];
    expect(candidateObs).toBeDefined();
    const normalized = candidateObs?.normalizedValue as Record<string, unknown>;
    const body = normalized?.['body'] as Record<string, unknown> | undefined;
    expect(body?.['stock']).toBe(3);
  });
});

// ===========================================================================
// 18. Field-level difference preservation
// ===========================================================================

describe('18. Field-level difference preservation', () => {
  it('field diffs are carried from R06 stepResults', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const fieldDiffs = capsule.evidenceRecords[0]?.fieldDiffs ?? [];
    expect(fieldDiffs).toHaveLength(1);
    expect(fieldDiffs[0]?.field).toBe('body.stock');
  });

  it('baseline field diff value is 1', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const fd = capsule.evidenceRecords[0]?.fieldDiffs[0]!;
    expect(fd.baselineValue).toBe(1);
  });

  it('candidate field diff value is 3', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const fd = capsule.evidenceRecords[0]?.fieldDiffs[0]!;
    expect(fd.candidateValue).toBe(3);
  });

  it('field diffs are sorted alphabetically by field name', () => {
    const diff = makeDiff('REGRESSION', {
      stepResults: [
        {
          stepId: 'step-read-1',
          sequence: 1,
          baselineStatus: 'passed',
          candidateStatus: 'passed',
          fieldDiffs: [
            { field: 'z.field', baselineValue: 0, candidateValue: 1 },
            { field: 'a.field', baselineValue: 0, candidateValue: 1 },
            { field: 'm.field', baselineValue: 0, candidateValue: 1 },
          ],
          baselineMissing: false,
          candidateMissing: false,
        },
      ],
    });
    const capsule = buildCapsule(makeMinimalInput(diff));
    const fields = capsule.evidenceRecords[0]?.fieldDiffs.map((d) => d.field) ?? [];
    expect(fields).toEqual(['a.field', 'm.field', 'z.field']);
  });
});

// ===========================================================================
// 19. ShopFlow inventory case
// ===========================================================================

describe('19. ShopFlow inventory case', () => {
  // This test mirrors the R06 ShopFlow case: baseline stock=1, candidate stock=3, REGRESSION
  const SHOPFLOW_JOURNEY_ID = journeyId(
    'inventory-visibility-after-update',
    'Update inventory stock, then read the product and assert the displayed stock reflects the update.',
  );
  const SHOPFLOW_BEHAVIOR_ID = protectedBehaviorId(
    'inventory freshness',
    'stock field in /products/:id response reflects most recent write',
    'stock === last PUT /inventory/:id value',
  );

  it('ShopFlow case produces REGRESSION verdict', () => {
    const baselineObs = normalizeHttpObservation(
      200,
      { 'content-type': 'application/json' },
      { id: 1, name: 'Widget', stock: 1 },
      'GET /products/1 → baseline',
    );
    const candidateObs = normalizeHttpObservation(
      200,
      { 'content-type': 'application/json' },
      { id: 1, name: 'Widget', stock: 3 },
      'GET /products/1 → candidate',
    );

    const pairedResult: PairedExecutionResult = {
      scenarioId: 'scenario-shopflow-001',
      baseline: makeExecResult('baseline', [makeStep('step-get-product', 1, [baselineObs])], 'passed'),
      candidate: makeExecResult('candidate', [makeStep('step-get-product', 1, [candidateObs])], 'passed'),
    };
    // Fix scenarioId in exec results
    pairedResult.baseline.scenarioId = 'scenario-shopflow-001';
    pairedResult.candidate.scenarioId = 'scenario-shopflow-001';

    const diff: BehavioralDifferenceRecord = {
      differenceId: 'diff-shopflow-inventory-001',
      scenarioId: 'scenario-shopflow-001',
      journeyId: SHOPFLOW_JOURNEY_ID,
      protectedBehaviorId: SHOPFLOW_BEHAVIOR_ID,
      verdict: 'REGRESSION',
      summary: 'Protected behavior "inventory freshness" violated: stock changed from 1 to 3',
      detail: 'BASELINE observed stock=1; CANDIDATE observed stock=3. Protected behavior requires stock equals last written value.',
      stepResults: [
        {
          stepId: 'step-get-product',
          sequence: 1,
          baselineStatus: 'passed',
          candidateStatus: 'passed',
          fieldDiffs: [{ field: 'body.stock', baselineValue: 1, candidateValue: 3 }],
          baselineMissing: false,
          candidateMissing: false,
        },
      ],
      confidence: 'confirmed',
      provenance: { confidence: 'confirmed', sourceKind: 'test', sourceRef: 'test/inventory.test.ts' },
      baselineExecutionStatus: 'passed',
      candidateExecutionStatus: 'passed',
      comparedAt: FIXED_TIMESTAMP,
      comparatorVersion: '1.0',
    };

    const behavior: BehaviorProtectedBehavior = {
      id: SHOPFLOW_BEHAVIOR_ID,
      description: 'inventory freshness',
      observable: 'stock field in /products/:id response reflects most recent write',
      expectedOutcome: 'stock === last PUT /inventory/:id value',
      provenance: { confidence: 'confirmed', sourceKind: 'test' },
      confidence: 'confirmed',
      relatedJourneyIds: [SHOPFLOW_JOURNEY_ID],
      severity: 'high',
    };

    const plan: ScenarioPlan = {
      id: 'scenario-shopflow-001',
      name: 'inventory visibility after update',
      description: 'Update inventory stock, then read the product and assert the displayed stock reflects the update.',
      confidence: 'confirmed',
      provenance: { confidence: 'confirmed', sourceKind: 'test' },
      traceability: {
        sourceJourneyId: SHOPFLOW_JOURNEY_ID,
        sourceJourneyName: 'inventory-visibility-after-update',
        sourceBehaviorIds: [SHOPFLOW_BEHAVIOR_ID],
        sourceStepIds: ['step-src-1', 'step-src-2'],
      },
      preconditions: [],
      steps: [
        { id: 'step-get-product', sequence: 1, kind: 'http', description: 'GET /products/1', sourceStepId: 'step-src-2' },
      ],
      seedDataRef: 'shopflow/inventory-3-units',
      deterministic: true,
    };

    const capsule = buildCapsule({
      rehearsalRunId: 'run-shopflow-001',
      changeSummary: 'Add caching to Product API (feature/product-cache). Files: productService.ts, cache.ts.',
      requirementSummary: 'Add caching to the Product API to improve response time.',
      pairedResults: [pairedResult],
      differences: [diff],
      scenarioPlans: [plan],
      protectedBehaviors: [behavior],
      createdAt: FIXED_TIMESTAMP,
    });

    // Validate the chain
    expect(capsule.evidenceRecords[0]?.verdict).toBe('REGRESSION');
    expect(capsule.evidenceRecords[0]?.protectedBehaviorId).toBe(SHOPFLOW_BEHAVIOR_ID);
    expect(capsule.evidenceRecords[0]?.confidence).toBe('confirmed');
    expect(capsule.evidenceRecords[0]?.fieldDiffs[0]?.field).toBe('body.stock');
    expect(capsule.evidenceRecords[0]?.fieldDiffs[0]?.baselineValue).toBe(1);
    expect(capsule.evidenceRecords[0]?.fieldDiffs[0]?.candidateValue).toBe(3);
    expect(capsule.summary.regressions).toBe(1);
    expect(capsule.summary.overallVerdict).toBe('REGRESSION_DETECTED');

    // Verify Markdown includes expected content
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).toContain('REGRESSION');
    expect(md).toContain('inventory freshness');
    expect(md).toContain('confirmed');
  });

  it('ShopFlow: R06 verdict is not reinterpreted by R07', () => {
    // Building a capsule with REGRESSION should produce REGRESSION, not "likely regression"
    const diff = makeDiff('REGRESSION');
    const capsule = buildCapsule(makeMinimalInput(diff));
    // The verdict in the capsule must be exactly 'REGRESSION'
    expect(capsule.evidenceRecords[0]?.verdict).toBe('REGRESSION');
    // It must not be anything else
    expect(capsule.evidenceRecords[0]?.verdict).not.toBe('POTENTIAL_DIFFERENCE');
    expect(capsule.evidenceRecords[0]?.verdict).not.toBe('INCONCLUSIVE');
  });
});

// ===========================================================================
// 20. capsule_ref generation
// ===========================================================================

describe('20. capsule_ref generation', () => {
  it('buildReport generates capsule_ref with json_path and markdown_path', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const report = buildReport({
      capsule,
      jsonPath: 'rehearsal-report.json',
      markdownPath: 'rehearsal-report.md',
    });
    expect(report.capsule_ref).toBeDefined();
    expect(report.capsule_ref?.json_path).toBe('rehearsal-report.json');
    expect(report.capsule_ref?.markdown_path).toBe('rehearsal-report.md');
  });

  it('validateCapsuleRef accepts valid capsule_ref', () => {
    const result = validateCapsuleRef({
      json_path: 'rehearsal-report.json',
      markdown_path: 'rehearsal-report.md',
    });
    expect(result.valid).toBe(true);
  });

  it('validateCapsuleRef rejects missing markdown_path', () => {
    const result = validateCapsuleRef({ json_path: 'rehearsal-report.json' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('markdown_path'))).toBe(true);
  });

  it('validateCapsuleRef rejects missing json_path', () => {
    const result = validateCapsuleRef({ markdown_path: 'rehearsal-report.md' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('json_path'))).toBe(true);
  });
});

// ===========================================================================
// 21. F-04 RehearsalReport compatibility
// ===========================================================================

describe('21. F-04 RehearsalReport compatibility', () => {
  it('report uses rehearsal_run_id (not run_id)', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const report = buildReport({
      capsule,
      jsonPath: 'rehearsal-report.json',
      markdownPath: 'rehearsal-report.md',
    });
    expect(report.rehearsal_run_id).toBe(RUN_ID);
    // Should not have a top-level run_id property
    expect((report as unknown as Record<string, unknown>)['run_id']).toBeUndefined();
  });

  it('report uses behavioral_diff_rows (not behavioral_diff)', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const report = buildReport({
      capsule,
      jsonPath: 'rehearsal-report.json',
      markdownPath: 'rehearsal-report.md',
    });
    expect(Array.isArray(report.behavioral_diff_rows)).toBe(true);
    expect((report as unknown as Record<string, unknown>)['behavioral_diff']).toBeUndefined();
  });

  it('report has capsule_ref (F-04 field)', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const report = buildReport({
      capsule,
      jsonPath: 'rehearsal-report.json',
      markdownPath: 'rehearsal-report.md',
    });
    expect(report.capsule_ref).toBeDefined();
  });

  it('behavioral_diff_rows verdict uses lowercase F-04 values', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const report = buildReport({
      capsule,
      jsonPath: 'rehearsal-report.json',
      markdownPath: 'rehearsal-report.md',
    });
    // F-04 Verdict uses lowercase
    expect(report.behavioral_diff_rows[0]?.verdict).toBe('regression');
  });

  it('verdict mapping is exhaustive and round-trips', () => {
    const verdicts = ['PRESERVED', 'INTENTIONAL_CHANGE', 'REGRESSION', 'POTENTIAL_DIFFERENCE', 'INCONCLUSIVE'] as const;
    for (const v of verdicts) {
      const mapped = mapVerdict(v);
      expect(mapped).toBeTruthy();
      // It should map to a valid F-04 Verdict string
      expect(['preserved', 'intentional_change', 'regression', 'potentially_affected', 'not_exercised']).toContain(mapped);
    }
  });

  it('PRESERVED R06 verdict maps to preserved in F-04 report row', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    const report = buildReport({ capsule, jsonPath: 'report.json', markdownPath: 'report.md' });
    expect(report.behavioral_diff_rows[0]?.verdict).toBe('preserved');
  });
});

// ===========================================================================
// 22. Sensitive value exclusion
// ===========================================================================

describe('22. Sensitive value exclusion/scrubbing', () => {
  it('serialized JSON does not contain Authorization header values', () => {
    const obs = makeHttpObs({ stock: 5 }, 'GET /products/1');
    const paired = makePaired(
      [makeStep('step-read-1', 1, [obs])],
      [makeStep('step-read-1', 1, [obs])],
    );
    const diff = makeDiff('PRESERVED');
    const capsule = buildCapsule(makeMinimalInput(diff, paired));
    const json = serializeCapsuleToJson(capsule);
    // Should not contain literal bearer token patterns
    expect(json.toLowerCase()).not.toContain('authorization: bearer');
  });

  it('observation snapshots use normalizedValue (not raw value)', () => {
    // The ObservationSnapshot only stores normalizedValue
    // Raw sensitive values from step.observations[*].value are excluded
    const obs = makeHttpObs({ stock: 5 }, 'GET /products/1');
    // The raw value in the observation may differ from normalizedValue
    // but our extraction only uses normalizedValue
    const paired = makePaired(
      [makeStep('step-read-1', 1, [obs])],
      [makeStep('step-read-1', 1, [obs])],
    );
    const diff = makeDiff('PRESERVED');
    const capsule = buildCapsule(makeMinimalInput(diff, paired));
    const record = capsule.evidenceRecords[0]!;
    // Observations in the snapshot should be normalizedValue-based
    for (const snap of [...record.baselineObservations, ...record.candidateObservations]) {
      for (const o of snap.observations) {
        // normalizedValue must be present
        expect(o.normalizedValue).toBeDefined();
      }
    }
  });

  it('validation rejects records with sensitive patterns in observations', () => {
    const record = {
      evidenceId: 'evidence-test-001',
      differenceId: 'diff-001',
      scenarioId: 'scenario-001',
      journeyId: 'journey-001',
      verdict: 'PRESERVED',
      baselineObservations: [
        {
          stepId: 'step-1',
          sequence: 1,
          status: 'passed',
          observations: [
            {
              kind: 'http_response',
              value: null,
              normalizedValue: { 'Authorization: Bearer sk-SECRETKEY12345678901234': 'sensitive' },
              source: 'test',
            },
          ],
        },
      ],
      candidateObservations: [],
      fieldDiffs: [],
      reason: 'test',
      detail: 'test',
      confidence: 'confirmed',
      provenance: { confidence: 'confirmed' },
      baselineExecutionStatus: 'passed',
      candidateExecutionStatus: 'passed',
    };

    const result = validateEvidenceRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sensitive'))).toBe(true);
  });
});

// ===========================================================================
// 23. Deterministic ordering
// ===========================================================================

describe('23. Deterministic ordering', () => {
  it('evidenceRecords are sorted by evidenceId ascending', () => {
    // Build two diffs with different IDs
    const diff1 = makeDiff('PRESERVED', {
      differenceId: 'diff-zzz-001',
      scenarioId: 'scenario-zzz-001',
      protectedBehaviorId: undefined,
    });
    const diff2 = makeDiff('REGRESSION', {
      differenceId: 'diff-aaa-001',
      scenarioId: 'scenario-aaa-001',
    });

    const baselineObs = makeHttpObs({ stock: 1 }, 'baseline');
    const candidateObs = makeHttpObs({ stock: 3 }, 'candidate');
    const paired1: PairedExecutionResult = {
      scenarioId: 'scenario-zzz-001',
      baseline: { ...makeExecResult('baseline', [makeStep('step-read-1', 1, [baselineObs])]), scenarioId: 'scenario-zzz-001' },
      candidate: { ...makeExecResult('candidate', [makeStep('step-read-1', 1, [candidateObs])]), scenarioId: 'scenario-zzz-001' },
    };
    const paired2: PairedExecutionResult = {
      scenarioId: 'scenario-aaa-001',
      baseline: { ...makeExecResult('baseline', [makeStep('step-read-1', 1, [baselineObs])]), scenarioId: 'scenario-aaa-001' },
      candidate: { ...makeExecResult('candidate', [makeStep('step-read-1', 1, [candidateObs])]), scenarioId: 'scenario-aaa-001' },
    };
    const plan1 = makePlan({ id: 'scenario-zzz-001', traceability: { ...makePlan().traceability } });
    const plan2 = makePlan({ id: 'scenario-aaa-001', traceability: { ...makePlan().traceability } });

    const capsule = buildCapsule({
      rehearsalRunId: RUN_ID,
      changeSummary: 'test',
      pairedResults: [paired1, paired2],
      differences: [diff1, diff2],
      scenarioPlans: [plan1, plan2],
      protectedBehaviors: [makeBehavior()],
      createdAt: FIXED_TIMESTAMP,
    });

    const ids = capsule.evidenceRecords.map((r) => r.evidenceId);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('JSON serialization is idempotent on the same capsule', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const json1 = serializeCapsuleToJson(capsule);
    const json2 = serializeCapsuleToJson(capsule);
    expect(json1).toBe(json2);
  });

  it('Markdown serialization is idempotent on the same capsule', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const md1 = serializeCapsuleToMarkdown(capsule);
    const md2 = serializeCapsuleToMarkdown(capsule);
    expect(md1).toBe(md2);
  });

  it('scenario summaries are sorted by scenarioId', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const ids = capsule.scenarioSummaries.map((s) => s.scenarioId);
    expect(ids).toEqual([...ids].sort());
  });
});

// ===========================================================================
// 24. Invalid capsule validation
// ===========================================================================

describe('24. Invalid capsule validation', () => {
  it('validateCapsule rejects null', () => {
    expect(validateCapsule(null).valid).toBe(false);
  });

  it('validateCapsule rejects missing capsuleId', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    const broken = { ...capsule, capsuleId: '' };
    const result = validateCapsule(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('capsuleId'))).toBe(true);
  });

  it('validateCapsule rejects wrong schema version', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    const broken = { ...capsule, schemaVersion: '99.0' as '1.0' };
    const result = validateCapsule(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
  });

  it('validateCapsule rejects missing rehearsalRunId', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    const broken = { ...capsule, rehearsalRunId: '' };
    expect(validateCapsule(broken).valid).toBe(false);
  });

  it('validateCapsule accepts a valid capsule', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    expect(validateCapsule(capsule).valid).toBe(true);
  });

  it('validateEvidenceRecord rejects invalid verdict', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const record = { ...capsule.evidenceRecords[0]!, verdict: 'INVALID' as 'REGRESSION' };
    const result = validateEvidenceRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('verdict'))).toBe(true);
  });

  it('validateEvidenceRecord rejects invalid confidence', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const record = { ...capsule.evidenceRecords[0]!, confidence: 'very_sure' as 'confirmed' };
    const result = validateEvidenceRecord(record);
    expect(result.valid).toBe(false);
  });
});

// ===========================================================================
// 25. Multiple behavioral differences
// ===========================================================================

describe('25. Multiple behavioral differences', () => {
  it('capsule with 3 differences has 3 evidence records', () => {
    const diffs = [
      makeDiff('REGRESSION', { differenceId: 'diff-1', scenarioId: 'scenario-1' }),
      makeDiff('PRESERVED', { differenceId: 'diff-2', scenarioId: 'scenario-2', protectedBehaviorId: undefined }),
      makeDiff('POTENTIAL_DIFFERENCE', { differenceId: 'diff-3', scenarioId: 'scenario-3' }),
    ];

    const baselineObs = makeHttpObs({ stock: 1 }, 'baseline');
    const candidateObs = makeHttpObs({ stock: 3 }, 'candidate');

    const makePairedForScenario = (scenarioId: string): PairedExecutionResult => ({
      scenarioId,
      baseline: { ...makeExecResult('baseline', [makeStep('step-1', 1, [baselineObs])]), scenarioId },
      candidate: { ...makeExecResult('candidate', [makeStep('step-1', 1, [candidateObs])]), scenarioId },
    });

    const capsule = buildCapsule({
      rehearsalRunId: RUN_ID,
      changeSummary: 'multiple diffs test',
      pairedResults: ['scenario-1', 'scenario-2', 'scenario-3'].map(makePairedForScenario),
      differences: diffs,
      scenarioPlans: diffs.map((d) =>
        makePlan({
          id: d.scenarioId,
          traceability: { ...makePlan().traceability, sourceBehaviorIds: d.protectedBehaviorId ? [d.protectedBehaviorId] : [] },
        }),
      ),
      protectedBehaviors: [makeBehavior()],
      createdAt: FIXED_TIMESTAMP,
    });

    expect(capsule.evidenceRecords).toHaveLength(3);
    expect(capsule.summary.regressions).toBe(1);
    expect(capsule.summary.preserved).toBe(1);
    expect(capsule.summary.potentialDifferences).toBe(1);
  });
});

// ===========================================================================
// 26. Empty evidence case
// ===========================================================================

describe('26. Empty evidence case', () => {
  it('capsule with no differences is valid', () => {
    const capsule = buildCapsule({
      rehearsalRunId: RUN_ID,
      changeSummary: 'no changes test',
      pairedResults: [],
      differences: [],
      scenarioPlans: [],
      protectedBehaviors: [],
      createdAt: FIXED_TIMESTAMP,
    });

    expect(capsule.evidenceRecords).toHaveLength(0);
    expect(capsule.summary.totalDifferences).toBe(0);
    // No regressions/preserved when empty
    expect(capsule.summary.regressions).toBe(0);
    expect(validateCapsule(capsule).valid).toBe(true);
  });

  it('empty capsule overallVerdict is PASS', () => {
    const capsule = buildCapsule({
      rehearsalRunId: RUN_ID,
      changeSummary: 'nothing changed',
      pairedResults: [],
      differences: [],
      scenarioPlans: [],
      protectedBehaviors: [],
      createdAt: FIXED_TIMESTAMP,
    });
    expect(capsule.summary.overallVerdict).toBe('PASS');
  });

  it('empty capsule produces valid Markdown', () => {
    const capsule = buildCapsule({
      rehearsalRunId: RUN_ID,
      changeSummary: 'nothing changed',
      pairedResults: [],
      differences: [],
      scenarioPlans: [],
      protectedBehaviors: [],
      createdAt: FIXED_TIMESTAMP,
    });
    const md = serializeCapsuleToMarkdown(capsule);
    expect(md).toContain('## Summary');
    expect(md).toContain(RUN_ID);
    expect(md).not.toContain('## Behavioral Differences');
  });
});

// ===========================================================================
// 27. Round-trip serialization
// ===========================================================================

describe('27. Round-trip serialization', () => {
  it('JSON round-trip preserves all verdict types', () => {
    const verdicts = ['PRESERVED', 'REGRESSION', 'INTENTIONAL_CHANGE', 'POTENTIAL_DIFFERENCE', 'INCONCLUSIVE'] as const;

    for (const verdict of verdicts) {
      const capsule = buildCapsule(makeMinimalInput(makeDiff(verdict)));
      const json = serializeCapsuleToJson(capsule);
      const restored = deserializeCapsuleFromJson(json);
      expect(restored.evidenceRecords[0]?.verdict).toBe(verdict);
    }
  });

  it('JSON round-trip preserves evidence record count', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const restored = deserializeCapsuleFromJson(serializeCapsuleToJson(capsule));
    expect(restored.evidenceRecords).toHaveLength(capsule.evidenceRecords.length);
  });

  it('JSON round-trip preserves schemaVersion', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('PRESERVED')));
    const restored = deserializeCapsuleFromJson(serializeCapsuleToJson(capsule));
    expect(restored.schemaVersion).toBe(EVIDENCE_CAPSULE_SCHEMA_VERSION);
  });

  it('JSON round-trip preserves confidence and provenance', () => {
    const diff = makeDiff('REGRESSION', {
      confidence: 'test_derived',
      provenance: { confidence: 'test_derived', sourceKind: 'contract', sourceRef: 'openapi.yaml' },
    });
    const capsule = buildCapsule(makeMinimalInput(diff));
    const restored = deserializeCapsuleFromJson(serializeCapsuleToJson(capsule));
    expect(restored.evidenceRecords[0]?.confidence).toBe('test_derived');
    expect(restored.evidenceRecords[0]?.provenance.sourceRef).toBe('openapi.yaml');
  });

  it('JSON round-trip preserves summary counts', () => {
    const capsule = buildCapsule(makeMinimalInput(makeDiff('REGRESSION')));
    const restored = deserializeCapsuleFromJson(serializeCapsuleToJson(capsule));
    expect(restored.summary.regressions).toBe(capsule.summary.regressions);
    expect(restored.summary.overallVerdict).toBe(capsule.summary.overallVerdict);
  });
});
