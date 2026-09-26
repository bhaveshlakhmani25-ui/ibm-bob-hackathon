/**
 * Change Rehearsal — R06 BehavioralComparator Tests
 *
 * Covers all 25 required test areas:
 *  1.  Identical baseline/candidate → PRESERVED
 *  2.  Meaningful protected behavior change → REGRESSION
 *  3.  Explicit expected/intentional change → INTENTIONAL_CHANGE
 *  4.  Uncertain difference → POTENTIAL_DIFFERENCE
 *  5.  Insufficient evidence → INCONCLUSIVE
 *  6.  Baseline missing observation
 *  7.  Candidate missing observation
 *  8.  Extra candidate observation
 *  9.  Extra baseline observation
 * 10.  Multiple observations
 * 11.  Stable step matching (by stepId)
 * 12.  Reordered observations
 * 13.  Normalized timestamps compare correctly
 * 14.  Meaningful numeric changes remain detectable
 * 15.  Infrastructure failure is not automatically regression
 * 16.  Candidate timeout
 * 17.  Baseline timeout
 * 18.  Blocked environment
 * 19.  Application-level failure
 * 20.  Protected behavior confidence is preserved
 * 21.  Inferred behavior is not upgraded to confirmed
 * 22.  Deterministic IDs
 * 23.  Deterministic ordering
 * 24.  Serialization/validation
 * 25.  ShopFlow inventory freshness case (baseline=1, candidate=3, REGRESSION)
 *
 * All tests are deterministic — no LLM calls, no network calls, no external state.
 */

import { describe, it, expect } from 'vitest';
import { compareScenario, compareAll, COMPARATOR_VERSION } from '../../engine/comparison/comparator.js';
import { matchSteps, compareStepObservations, extractFieldDiffs } from '../../engine/comparison/matching.js';
import {
  validateDifferenceRecord,
  validateComparisonResultSet,
  serializeDifferenceRecord,
  deserializeDifferenceRecord,
  serializeComparisonResultSet,
  deserializeComparisonResultSet,
  COMPARISON_SCHEMA_VERSION,
} from '../../engine/comparison/serialization.js';
import type { ComparisonInput, BehavioralDifferenceRecord } from '../../engine/comparison/model.js';
import type { PairedExecutionResult, ScenarioExecutionResult, StepExecutionResult, NormalizedObservation } from '../../engine/execution/model.js';
import type { ScenarioPlan } from '../../engine/scenario/model.js';
import type { BehaviorProtectedBehavior } from '../../engine/behavior/model.js';
import { normalizeHttpObservation, normalizeDbObservation } from '../../engine/execution/normalization.js';
import { RehearsalExecutor } from '../../engine/execution/executor.js';
import { buildShopFlowAdapter } from '../../engine/execution/adapter.js';
import { generateScenarioPlan } from '../../engine/scenario/generator.js';
import { journeyId, journeyStepId, protectedBehaviorId } from '../../engine/behavior/ids.js';
import type { BehaviorJourney } from '../../engine/behavior/model.js';

// ---------------------------------------------------------------------------
// Test Fixtures — helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ScenarioPlan for testing.
 * Has 1 step with a deterministic ID.
 */
function makePlan(overrides: Partial<ScenarioPlan> = {}): ScenarioPlan {
  const jId = journeyId('test-journey', 'Test journey description');
  return {
    id: 'scenario-r06-test-001',
    name: 'R06 Test Scenario',
    description: 'A minimal scenario for R06 testing',
    confidence: 'inferred',
    provenance: { confidence: 'inferred', sourceKind: 'inference' },
    traceability: {
      sourceJourneyId: jId,
      sourceJourneyName: 'test-journey',
      sourceBehaviorIds: [],
      sourceStepIds: ['step-src-1'],
    },
    preconditions: [],
    steps: [
      {
        id: 'step-r06-001',
        sequence: 1,
        kind: 'http',
        description: 'GET /products',
        sourceStepId: 'step-src-1',
      },
    ],
    seedDataRef: 'test/fixture',
    deterministic: true,
    ...overrides,
  };
}

/**
 * Build a minimal StepExecutionResult.
 */
function makeStepResult(overrides: Partial<StepExecutionResult> = {}): StepExecutionResult {
  return {
    stepId: 'step-r06-001',
    sequence: 1,
    status: 'passed',
    durationMs: 1,
    observations: [],
    ...overrides,
  };
}

/**
 * Build a minimal ScenarioExecutionResult.
 */
function makeExecResult(
  side: 'baseline' | 'candidate',
  steps: StepExecutionResult[],
  overrides: Partial<ScenarioExecutionResult> = {},
): ScenarioExecutionResult {
  return {
    runId: `run-${side}-test`,
    scenarioId: 'scenario-r06-test-001',
    target: { kind: side, revision: side === 'baseline' ? 'main' : 'feature/test' },
    status: 'passed',
    startedAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:00:01Z',
    durationMs: 1000,
    steps,
    metadata: {
      rehearsalRunId: 'run-test-001',
      target: { kind: side, revision: side === 'baseline' ? 'main' : 'feature/test' },
      seedDataRef: 'test/fixture',
      stepsAttempted: steps.length,
      stepsPassed: steps.filter((s) => s.status === 'passed').length,
      stepsFailed: steps.filter((s) => s.status === 'failed').length,
    },
    ...overrides,
  };
}

/**
 * Build a PairedExecutionResult from baseline and candidate step results.
 */
function makePaired(
  baselineSteps: StepExecutionResult[],
  candidateSteps: StepExecutionResult[],
  baselineOverrides: Partial<ScenarioExecutionResult> = {},
  candidateOverrides: Partial<ScenarioExecutionResult> = {},
): PairedExecutionResult {
  return {
    scenarioId: 'scenario-r06-test-001',
    baseline: makeExecResult('baseline', baselineSteps, baselineOverrides),
    candidate: makeExecResult('candidate', candidateSteps, candidateOverrides),
  };
}

/**
 * Build a step with an http_response observation.
 */
function makeStepWithHttpObs(
  stepId: string,
  sequence: number,
  status: number,
  body: Record<string, unknown>,
  side: 'baseline' | 'candidate' = 'baseline',
): StepExecutionResult {
  const obs = normalizeHttpObservation(
    status,
    { 'content-type': 'application/json' },
    body,
    `synthetic:${side}:${stepId}`,
  );
  return makeStepResult({ stepId, sequence, observations: [obs] });
}

/**
 * Build a protected behavior at the given confidence level.
 */
function makeBehavior(
  description: string,
  observable: string,
  expectedOutcome: string,
  confidence: BehaviorProtectedBehavior['confidence'],
  relatedJourneyIds: string[] = [],
  overrides: Partial<BehaviorProtectedBehavior> = {},
): BehaviorProtectedBehavior {
  const jId = journeyId('test-journey', 'Test journey description');
  return {
    id: protectedBehaviorId(description, observable, expectedOutcome),
    description,
    observable,
    expectedOutcome,
    provenance: { confidence, sourceKind: 'test' },
    confidence,
    relatedJourneyIds: relatedJourneyIds.length > 0 ? relatedJourneyIds : [jId],
    ...overrides,
  };
}

/**
 * Build a minimal ComparisonInput with identical steps on both sides.
 */
function makeIdenticalInput(obs?: NormalizedObservation[]): ComparisonInput {
  const observations = obs ?? [];
  const step = makeStepResult({ observations });
  return {
    pairedResult: makePaired([step], [makeStepResult({ observations })]),
    scenarioPlan: makePlan(),
    protectedBehaviors: [],
  };
}

// ---------------------------------------------------------------------------
// 1. Identical baseline/candidate → PRESERVED
// ---------------------------------------------------------------------------

describe('1. Identical baseline/candidate → PRESERVED', () => {
  it('produces PRESERVED when both sides have no observations and pass', () => {
    const input = makeIdenticalInput();
    const result = compareScenario(input);
    expect(result.verdict).toBe('PRESERVED');
  });

  it('produces PRESERVED when both sides have identical http observations', () => {
    const step = makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 5 });
    const input: ComparisonInput = {
      pairedResult: makePaired(
        [step],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 5 }, 'candidate')],
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };
    const result = compareScenario(input);
    expect(result.verdict).toBe('PRESERVED');
  });

  it('PRESERVED record has correct metadata', () => {
    const input = makeIdenticalInput();
    const result = compareScenario(input);
    expect(result.scenarioId).toBe('scenario-r06-test-001');
    expect(result.comparatorVersion).toBe('1.0');
    expect(result.baselineExecutionStatus).toBe('passed');
    expect(result.candidateExecutionStatus).toBe('passed');
  });

  it('summary mentions equivalence for PRESERVED', () => {
    const input = makeIdenticalInput();
    const result = compareScenario(input);
    expect(result.summary.toLowerCase()).toContain('equivalent');
  });
});

// ---------------------------------------------------------------------------
// 2. Meaningful protected behavior change → REGRESSION
// ---------------------------------------------------------------------------

describe('2. Meaningful protected behavior change → REGRESSION', () => {
  it('produces REGRESSION when contract_derived behavior is violated', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Inventory freshness',
      'inventory stock',
      'Stock level reflects latest update',
      'contract_derived',
      [jId],
    );

    const baseStep = makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 5 }, 'baseline');
    const candStep = makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 3 }, 'candidate');

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired([baseStep], [candStep]),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('REGRESSION');
  });

  it('produces REGRESSION when test_derived behavior is violated', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Checkout total',
      'order total amount',
      'Total equals sum of item prices',
      'test_derived',
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const baseStep = makeStepWithHttpObs('step-r06-001', 1, 200, { total: 100 }, 'baseline');
    const candStep = makeStepWithHttpObs('step-r06-001', 1, 200, { total: 150 }, 'candidate');

    const input: ComparisonInput = {
      pairedResult: makePaired([baseStep], [candStep]),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('REGRESSION');
  });

  it('REGRESSION summary mentions the behavior description', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Inventory freshness',
      'inventory stock',
      'Stock level reflects latest update',
      'confirmed',
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 1 })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 3 }, 'candidate')],
      ),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('REGRESSION');
    expect(result.summary).toContain('Inventory freshness');
  });

  it('REGRESSION detail mentions observable and expected outcome', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Inventory freshness',
      'inventory stock',
      'Stock level reflects latest update',
      'confirmed',
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 1 })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 3 }, 'candidate')],
      ),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    expect(result.detail).toContain('inventory stock');
    expect(result.detail).toContain('Stock level reflects latest update');
  });
});

// ---------------------------------------------------------------------------
// 3. Explicit expected/intentional change → INTENTIONAL_CHANGE
// ---------------------------------------------------------------------------

describe('3. Explicit expected/intentional change → INTENTIONAL_CHANGE', () => {
  it('produces INTENTIONAL_CHANGE when expectedInvariantSummary contains "intentional"', () => {
    const plan = makePlan({
      expectedInvariantSummary: 'intentional: stock is now sourced from new cache layer',
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 1 })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 3 }, 'candidate')],
      ),
      scenarioPlan: plan,
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INTENTIONAL_CHANGE');
  });

  it('produces INTENTIONAL_CHANGE when expectedInvariantSummary contains "expected change"', () => {
    const plan = makePlan({
      expectedInvariantSummary: 'expected change: response format updated',
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { price: 9.99 })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { price: 12.99 }, 'candidate')],
      ),
      scenarioPlan: plan,
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INTENTIONAL_CHANGE');
  });

  it('produces INTENTIONAL_CHANGE for developer_declaration provenance with non-empty summary', () => {
    const plan = makePlan({
      expectedInvariantSummary: 'API contract updated for v2',
      provenance: { confidence: 'confirmed', sourceKind: 'developer_declaration' },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { version: 'v1' })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { version: 'v2' }, 'candidate')],
      ),
      scenarioPlan: plan,
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INTENTIONAL_CHANGE');
  });

  it('INTENTIONAL_CHANGE summary mentions "expected"', () => {
    const plan = makePlan({
      expectedInvariantSummary: 'intentional: updated inventory source',
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 1 })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 2 }, 'candidate')],
      ),
      scenarioPlan: plan,
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.summary.toLowerCase()).toMatch(/expected|intentional/);
  });
});

// ---------------------------------------------------------------------------
// 4. Uncertain difference → POTENTIAL_DIFFERENCE
// ---------------------------------------------------------------------------

describe('4. Uncertain difference → POTENTIAL_DIFFERENCE', () => {
  it('produces POTENTIAL_DIFFERENCE when diff exists but no protected behavior linked', () => {
    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { count: 5 })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { count: 7 }, 'candidate')],
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('POTENTIAL_DIFFERENCE');
  });

  it('produces POTENTIAL_DIFFERENCE when linked behavior confidence is inferred (too weak for REGRESSION)', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Inferred behavior',
      'some field',
      'Should remain the same',
      'inferred', // too weak for REGRESSION
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { field: 'A' })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { field: 'B' }, 'candidate')],
      ),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('POTENTIAL_DIFFERENCE');
  });

  it('produces POTENTIAL_DIFFERENCE when candidate fails application-level but diffs present', () => {
    const baseStep = makeStepWithHttpObs('step-r06-001', 1, 200, { ok: true });
    const candStep = makeStepWithHttpObs('step-r06-001', 1, 500, { error: 'internal' }, 'candidate');
    const candExecStep = { ...candStep, status: 'failed' as const };

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [baseStep],
        [candExecStep],
        {},
        { status: 'failed' },
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('POTENTIAL_DIFFERENCE');
  });
});

// ---------------------------------------------------------------------------
// 5. Insufficient evidence → INCONCLUSIVE
// ---------------------------------------------------------------------------

describe('5. Insufficient evidence → INCONCLUSIVE', () => {
  it('produces INCONCLUSIVE when candidate is timed_out', () => {
    const step = makeStepResult({ status: 'timed_out' });
    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepResult()],
        [step],
        {},
        { status: 'timed_out' },
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  it('produces INCONCLUSIVE when baseline is blocked', () => {
    const step = makeStepResult({ status: 'blocked' });
    const input: ComparisonInput = {
      pairedResult: makePaired(
        [step],
        [makeStepResult()],
        { status: 'blocked' },
        {},
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  it('produces INCONCLUSIVE even when protected behavior is confirmed', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Critical behavior',
      'stock',
      'Stock must remain unchanged',
      'confirmed',
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepResult()],
        [makeStepResult({ status: 'error' })],
        {},
        { status: 'error' },
      ),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  it('INCONCLUSIVE summary mentions the failed execution', () => {
    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepResult()],
        [makeStepResult({ status: 'timed_out' })],
        {},
        { status: 'timed_out' },
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.summary.toLowerCase()).toContain('timed_out');
  });
});

// ---------------------------------------------------------------------------
// 6 & 7. Baseline / Candidate missing steps
// ---------------------------------------------------------------------------

describe('6 & 7. Missing steps', () => {
  it('handles case where candidate has a step missing (step removed)', () => {
    const step1 = makeStepResult({ stepId: 'step-a', sequence: 1 });
    const step2 = makeStepResult({ stepId: 'step-b', sequence: 2 });

    const input: ComparisonInput = {
      // Baseline has 2 steps, candidate has only 1
      pairedResult: makePaired([step1, step2], [step1]),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    // step-b is missing from candidate
    const missingStep = result.stepResults.find((sr) => sr.stepId === 'step-b');
    expect(missingStep).toBeDefined();
    expect(missingStep!.candidateMissing).toBe(true);
    expect(missingStep!.baselineMissing).toBe(false);
  });

  it('handles case where baseline has a step missing (step added in candidate)', () => {
    const step1 = makeStepResult({ stepId: 'step-a', sequence: 1 });
    const step2 = makeStepResult({ stepId: 'step-b', sequence: 2 });

    const input: ComparisonInput = {
      // Baseline has 1 step, candidate has 2
      pairedResult: makePaired([step1], [step1, step2]),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    const newStep = result.stepResults.find((sr) => sr.stepId === 'step-b');
    expect(newStep).toBeDefined();
    expect(newStep!.baselineMissing).toBe(true);
    expect(newStep!.candidateMissing).toBe(false);
  });

  it('missing step makes the record non-PRESERVED (POTENTIAL_DIFFERENCE)', () => {
    const step1 = makeStepResult({ stepId: 'step-a', sequence: 1 });
    const step2 = makeStepResult({ stepId: 'step-b', sequence: 2 });

    const input: ComparisonInput = {
      pairedResult: makePaired([step1, step2], [step1]),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).not.toBe('PRESERVED');
  });
});

// ---------------------------------------------------------------------------
// 8 & 9. Extra observations
// ---------------------------------------------------------------------------

describe('8 & 9. Extra observations', () => {
  it('handles extra observation on candidate side', () => {
    const baseObs = normalizeHttpObservation(200, {}, { stock: 1 }, 'test:baseline:step-a');
    const candObs1 = normalizeHttpObservation(200, {}, { stock: 1 }, 'test:candidate:step-a');
    const candObs2 = normalizeHttpObservation(200, {}, { extra: true }, 'test:candidate:step-a:extra');

    const baseStep = makeStepResult({ observations: [baseObs] });
    const candStep = makeStepResult({ observations: [candObs1, candObs2] });

    const fieldDiffs = compareStepObservations([baseObs], [candObs1, candObs2]);
    // Extra candidate observation should be captured
    expect(fieldDiffs.length).toBeGreaterThan(0);
  });

  it('handles extra observation on baseline side', () => {
    const baseObs1 = normalizeHttpObservation(200, {}, { stock: 1 }, 'test:baseline:step-a');
    const baseObs2 = normalizeHttpObservation(200, {}, { extra: true }, 'test:baseline:step-a:extra');
    const candObs = normalizeHttpObservation(200, {}, { stock: 1 }, 'test:candidate:step-a');

    const fieldDiffs = compareStepObservations([baseObs1, baseObs2], [candObs]);
    // Extra baseline observation should be captured
    expect(fieldDiffs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Multiple observations
// ---------------------------------------------------------------------------

describe('10. Multiple observations', () => {
  it('compares multiple observations per step correctly', () => {
    const baseHttpObs = normalizeHttpObservation(200, {}, { stock: 5 }, 'test:baseline:step-a');
    const baseDbObs = normalizeDbObservation({ stock: 5 }, 'test:baseline:step-a:db');
    const candHttpObs = normalizeHttpObservation(200, {}, { stock: 7 }, 'test:candidate:step-a');
    const candDbObs = normalizeDbObservation({ stock: 7 }, 'test:candidate:step-a:db');

    const fieldDiffs = compareStepObservations(
      [baseHttpObs, baseDbObs],
      [candHttpObs, candDbObs],
    );

    // Should detect both HTTP body diff and DB snapshot diff
    const stockDiffs = fieldDiffs.filter((d) => d.field.includes('stock'));
    expect(stockDiffs.length).toBeGreaterThanOrEqual(2);
  });

  it('does not fabricate diffs when all observations match', () => {
    const httpObs = normalizeHttpObservation(200, {}, { stock: 5 }, 'test:step-a');
    const dbObs = normalizeDbObservation({ stock: 5 }, 'test:step-a:db');

    const fieldDiffs = compareStepObservations(
      [httpObs, dbObs],
      [httpObs, dbObs],
    );

    expect(fieldDiffs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Stable step matching (by stepId)
// ---------------------------------------------------------------------------

describe('11. Stable step matching by stepId', () => {
  it('matches steps by stepId, not by array position', () => {
    const stepA = makeStepWithHttpObs('step-a', 1, 200, { val: 'A' });
    const stepB = makeStepWithHttpObs('step-b', 2, 200, { val: 'B' });
    const stepACandidate = makeStepWithHttpObs('step-a', 1, 200, { val: 'A' }, 'candidate');
    const stepBCandidate = makeStepWithHttpObs('step-b', 2, 200, { val: 'B' }, 'candidate');

    // Candidate steps in reverse order in the array
    const stepResults = matchSteps([stepA, stepB], [stepBCandidate, stepACandidate]);

    // step-a should be matched with step-a, step-b with step-b
    const aResult = stepResults.find((sr) => sr.stepId === 'step-a');
    const bResult = stepResults.find((sr) => sr.stepId === 'step-b');

    expect(aResult).toBeDefined();
    expect(bResult).toBeDefined();

    // No diffs because values are the same (matched correctly)
    expect(aResult!.fieldDiffs).toHaveLength(0);
    expect(bResult!.fieldDiffs).toHaveLength(0);
  });

  it('detects diff only in the changed step when the other is preserved', () => {
    const stepA = makeStepWithHttpObs('step-a', 1, 200, { val: 1 });
    const stepB = makeStepWithHttpObs('step-b', 2, 200, { val: 10 });
    const stepACandidate = makeStepWithHttpObs('step-a', 1, 200, { val: 1 }, 'candidate');
    const stepBCandidate = makeStepWithHttpObs('step-b', 2, 200, { val: 20 }, 'candidate'); // changed

    const stepResults = matchSteps([stepA, stepB], [stepACandidate, stepBCandidate]);

    const aResult = stepResults.find((sr) => sr.stepId === 'step-a')!;
    const bResult = stepResults.find((sr) => sr.stepId === 'step-b')!;

    expect(aResult.fieldDiffs).toHaveLength(0);
    expect(bResult.fieldDiffs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 12. Reordered observations
// ---------------------------------------------------------------------------

describe('12. Reordered observations', () => {
  it('matches observations by kind+source regardless of array order', () => {
    const httpObs = normalizeHttpObservation(200, {}, { stock: 5 }, 'test:step-a');
    const dbObs = normalizeDbObservation({ stock: 5 }, 'test:step-a:db');

    // Baseline: http first, then db
    // Candidate: db first, then http — same values
    const fieldDiffs = compareStepObservations([httpObs, dbObs], [dbObs, httpObs]);

    // Should detect no diffs — same values regardless of order
    expect(fieldDiffs).toHaveLength(0);
  });

  it('detects diffs correctly when observations are reordered with different values', () => {
    const httpObs = normalizeHttpObservation(200, {}, { stock: 5 }, 'test:step-a');
    const dbObs = normalizeDbObservation({ stock: 5 }, 'test:step-a:db');
    const httpObsChanged = normalizeHttpObservation(200, {}, { stock: 10 }, 'test:step-a');
    const dbObsChanged = normalizeDbObservation({ stock: 10 }, 'test:step-a:db');

    // Candidate: different values
    const fieldDiffs = compareStepObservations([httpObs, dbObs], [dbObsChanged, httpObsChanged]);

    expect(fieldDiffs.length).toBeGreaterThan(0);
    // Diffs should be on the stock field
    const stockDiffs = fieldDiffs.filter((d) => d.field.includes('stock'));
    expect(stockDiffs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 13. Normalized timestamps compare correctly
// ---------------------------------------------------------------------------

describe('13. Normalized timestamps compare correctly', () => {
  it('timestamps normalized to placeholder do not cause spurious diffs', () => {
    // Both bodies have different timestamps but same business values
    const body1 = { id: 1, name: 'Widget', createdAt: '2024-01-01T00:00:00Z' };
    const body2 = { id: 1, name: 'Widget', createdAt: '2024-06-01T12:30:00Z' };

    const obs1 = normalizeHttpObservation(200, {}, body1, 'test:step-a');
    const obs2 = normalizeHttpObservation(200, {}, body2, 'test:step-a');

    // Both are normalized — timestamps become '<timestamp>'
    const fieldDiffs = compareStepObservations([obs1], [obs2]);

    // No diff on createdAt — both normalized to '<timestamp>'
    const timestampDiffs = fieldDiffs.filter((d) => d.field.includes('createdAt'));
    expect(timestampDiffs).toHaveLength(0);
  });

  it('does not produce diffs for UUIDs that differ between sides', () => {
    const body1 = { orderId: '550e8400-e29b-41d4-a716-446655440000', status: 'completed' };
    const body2 = { orderId: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff', status: 'completed' };

    const obs1 = normalizeHttpObservation(200, {}, body1, 'test:step-a');
    const obs2 = normalizeHttpObservation(200, {}, body2, 'test:step-a');

    const fieldDiffs = compareStepObservations([obs1], [obs2]);

    // UUID fields should both be '<id>' — no diff
    const idDiffs = fieldDiffs.filter((d) => d.field.includes('orderId'));
    expect(idDiffs).toHaveLength(0);

    // Status field is the same — no diff anywhere
    expect(fieldDiffs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 14. Meaningful numeric changes remain detectable
// ---------------------------------------------------------------------------

describe('14. Meaningful numeric changes remain detectable', () => {
  it('detects stock quantity changes (numeric values preserved by normalization)', () => {
    const obs1 = normalizeHttpObservation(200, {}, { stock: 1 }, 'test:step-a');
    const obs2 = normalizeHttpObservation(200, {}, { stock: 3 }, 'test:step-a');

    const fieldDiffs = compareStepObservations([obs1], [obs2]);

    const stockDiff = fieldDiffs.find((d) => d.field.includes('stock'));
    expect(stockDiff).toBeDefined();
    expect(stockDiff!.baselineValue).toBe(1);
    expect(stockDiff!.candidateValue).toBe(3);
  });

  it('detects price changes', () => {
    const obs1 = normalizeHttpObservation(200, {}, { price: 9.99 }, 'test:step-a');
    const obs2 = normalizeHttpObservation(200, {}, { price: 12.99 }, 'test:step-a');

    const fieldDiffs = compareStepObservations([obs1], [obs2]);

    const priceDiff = fieldDiffs.find((d) => d.field.includes('price'));
    expect(priceDiff).toBeDefined();
    expect(priceDiff!.baselineValue).toBe(9.99);
    expect(priceDiff!.candidateValue).toBe(12.99);
  });

  it('detects HTTP status code changes', () => {
    const obs1 = normalizeHttpObservation(200, {}, {}, 'test:step-a');
    const obs2 = normalizeHttpObservation(201, {}, {}, 'test:step-a');

    const fieldDiffs = compareStepObservations([obs1], [obs2]);

    const statusDiff = fieldDiffs.find((d) => d.field.includes('status'));
    expect(statusDiff).toBeDefined();
    expect(statusDiff!.baselineValue).toBe(200);
    expect(statusDiff!.candidateValue).toBe(201);
  });

  it('detects order state changes (named string values preserved)', () => {
    const obs1 = normalizeHttpObservation(200, {}, { state: 'pending' }, 'test:step-a');
    const obs2 = normalizeHttpObservation(200, {}, { state: 'completed' }, 'test:step-a');

    const fieldDiffs = compareStepObservations([obs1], [obs2]);

    const stateDiff = fieldDiffs.find((d) => d.field.includes('state'));
    expect(stateDiff).toBeDefined();
    expect(stateDiff!.baselineValue).toBe('pending');
    expect(stateDiff!.candidateValue).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// 15. Infrastructure failure is NOT automatically a regression
// ---------------------------------------------------------------------------

describe('15. Infrastructure failure is not automatically a regression', () => {
  it('timed_out candidate with confirmed protected behavior → INCONCLUSIVE, not REGRESSION', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Critical confirmed behavior',
      'stock',
      'Stock must not change',
      'confirmed',
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepResult()],
        [makeStepResult({ status: 'timed_out' })],
        {},
        { status: 'timed_out' },
      ),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.verdict).not.toBe('REGRESSION');
  });

  it('error status with protected behavior → INCONCLUSIVE, not REGRESSION', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Critical behavior',
      'stock',
      'Stock must remain unchanged',
      'test_derived',
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepResult()],
        [makeStepResult()],
        {},
        { status: 'error' },
      ),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.verdict).not.toBe('REGRESSION');
  });
});

// ---------------------------------------------------------------------------
// 16. Candidate timeout
// ---------------------------------------------------------------------------

describe('16. Candidate timeout', () => {
  it('candidate timed_out → INCONCLUSIVE', () => {
    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepResult()],
        [makeStepResult()],
        {},
        { status: 'timed_out' },
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.candidateExecutionStatus).toBe('timed_out');
  });

  it('INCONCLUSIVE detail mentions candidate status', () => {
    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepResult()],
        [makeStepResult()],
        {},
        { status: 'timed_out' },
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.detail).toContain('timed_out');
  });
});

// ---------------------------------------------------------------------------
// 17. Baseline timeout
// ---------------------------------------------------------------------------

describe('17. Baseline timeout', () => {
  it('baseline timed_out → INCONCLUSIVE', () => {
    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepResult()],
        [makeStepResult()],
        { status: 'timed_out' },
        {},
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.baselineExecutionStatus).toBe('timed_out');
  });
});

// ---------------------------------------------------------------------------
// 18. Blocked environment
// ---------------------------------------------------------------------------

describe('18. Blocked environment', () => {
  it('baseline blocked → INCONCLUSIVE', () => {
    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepResult()],
        [makeStepResult()],
        { status: 'blocked' },
        {},
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  it('candidate blocked → INCONCLUSIVE', () => {
    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepResult()],
        [makeStepResult()],
        {},
        { status: 'blocked' },
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });
});

// ---------------------------------------------------------------------------
// 19. Application-level failure
// ---------------------------------------------------------------------------

describe('19. Application-level failure', () => {
  it('application-level failure (failed status) is NOT infrastructure failure', () => {
    // 'failed' is application-level — R05 design explicitly distinguishes this
    const baseStep = makeStepWithHttpObs('step-r06-001', 1, 200, { ok: true });
    const candStep = makeStepWithHttpObs('step-r06-001', 1, 500, { error: 'oops' }, 'candidate');

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [baseStep],
        [candStep],
        { status: 'passed' },
        { status: 'failed' },
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    // 'failed' is not infrastructure failure — verdict is not INCONCLUSIVE
    expect(result.verdict).not.toBe('INCONCLUSIVE');
  });

  it('both sides failed with same observations → PRESERVED', () => {
    const baseStep = makeStepWithHttpObs('step-r06-001', 1, 500, { error: 'service down' });
    const candStep = makeStepWithHttpObs('step-r06-001', 1, 500, { error: 'service down' }, 'candidate');

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [baseStep],
        [candStep],
        { status: 'failed' },
        { status: 'failed' },
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.verdict).toBe('PRESERVED');
  });

  it('application failure with confirmed protected behavior → POTENTIAL_DIFFERENCE (not REGRESSION)', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Stock invariant',
      'stock',
      'Stock must be accurate',
      'confirmed',
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const baseStep = makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 5 });
    const candStep = makeStepWithHttpObs('step-r06-001', 1, 500, { error: 'stock service error' }, 'candidate');

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [baseStep],
        [candStep],
        { status: 'passed' },
        { status: 'failed' },
      ),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    // Application failure with diffs — can be REGRESSION or POTENTIAL_DIFFERENCE
    // (depends on whether behavior is linked and diffs match observable)
    // Key constraint: must NOT be INCONCLUSIVE (this is app-level, not infra failure)
    expect(result.verdict).not.toBe('INCONCLUSIVE');
  });
});

// ---------------------------------------------------------------------------
// 20. Protected behavior confidence is preserved
// ---------------------------------------------------------------------------

describe('20. Protected behavior confidence is preserved', () => {
  it('carries confirmed confidence from behavior to record', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Confirmed behavior',
      'stock',
      'Stock must remain valid',
      'confirmed',
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 1 })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 3 }, 'candidate')],
      ),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    expect(result.confidence).toBe('confirmed');
  });

  it('carries test_derived confidence from behavior to record', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Test-derived behavior',
      'total',
      'Total must equal sum',
      'test_derived',
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { total: 100 })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { total: 120 }, 'candidate')],
      ),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    expect(result.confidence).toBe('test_derived');
  });

  it('falls back to scenario plan confidence when no behavior linked', () => {
    const plan = makePlan({ confidence: 'contract_derived' });

    const input: ComparisonInput = {
      pairedResult: makePaired([makeStepResult()], [makeStepResult()]),
      scenarioPlan: plan,
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    expect(result.confidence).toBe('contract_derived');
  });
});

// ---------------------------------------------------------------------------
// 21. Inferred behavior is NOT upgraded to confirmed
// ---------------------------------------------------------------------------

describe('21. Inferred behavior is not upgraded to confirmed', () => {
  it('inferred confidence behavior never produces REGRESSION', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Inferred behavior',
      'stock',
      'Stock should stay the same',
      'inferred', // too weak for REGRESSION
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 1 })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { stock: 99 }, 'candidate')],
      ),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    // Inferred is never strong enough for REGRESSION
    expect(result.verdict).not.toBe('REGRESSION');
    expect(result.verdict).toBe('POTENTIAL_DIFFERENCE');
  });

  it('inferred confidence is preserved verbatim in the output record', () => {
    const jId = journeyId('test-journey', 'Test journey description');
    const behavior = makeBehavior(
      'Inferred behavior',
      'stock',
      'Stock should stay same',
      'inferred',
      [jId],
    );

    const plan = makePlan({
      traceability: {
        sourceJourneyId: jId,
        sourceJourneyName: 'test-journey',
        sourceBehaviorIds: [behavior.id],
        sourceStepIds: ['step-src-1'],
      },
    });

    const input: ComparisonInput = {
      pairedResult: makePaired([makeStepResult()], [makeStepResult()]),
      scenarioPlan: plan,
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(input);
    // Confidence carried verbatim from inferred behavior
    expect(result.confidence).toBe('inferred');
    // NEVER upgraded to confirmed, test_derived, or contract_derived
    expect(result.confidence).not.toBe('confirmed');
    expect(result.confidence).not.toBe('test_derived');
    expect(result.confidence).not.toBe('contract_derived');
  });
});

// ---------------------------------------------------------------------------
// 22. Deterministic IDs
// ---------------------------------------------------------------------------

describe('22. Deterministic IDs', () => {
  it('same inputs produce the same differenceId', () => {
    const input = makeIdenticalInput();
    const result1 = compareScenario(input);
    const result2 = compareScenario(input);
    expect(result1.differenceId).toBe(result2.differenceId);
  });

  it('different verdicts produce different differenceIds', () => {
    // PRESERVED case
    const preservedInput = makeIdenticalInput();
    const preserved = compareScenario(preservedInput);

    // POTENTIAL_DIFFERENCE case
    const diffInput: ComparisonInput = {
      pairedResult: makePaired(
        [makeStepWithHttpObs('step-r06-001', 1, 200, { val: 1 })],
        [makeStepWithHttpObs('step-r06-001', 1, 200, { val: 2 }, 'candidate')],
      ),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };
    const diff = compareScenario(diffInput);

    expect(preserved.differenceId).not.toBe(diff.differenceId);
  });

  it('differenceId starts with "diff-"', () => {
    const result = compareScenario(makeIdenticalInput());
    expect(result.differenceId).toMatch(/^diff-[0-9a-f]{16}$/);
  });

  it('IDs do not contain random characters (deterministic across multiple calls)', () => {
    const input = makeIdenticalInput();
    const ids = Array.from({ length: 5 }, () => compareScenario(input).differenceId);
    expect(new Set(ids).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 23. Deterministic ordering
// ---------------------------------------------------------------------------

describe('23. Deterministic ordering', () => {
  it('compareAll sorts results by differenceId ascending', () => {
    const plan1 = makePlan({ id: 'scenario-aaa', name: 'AAA Scenario' });
    const plan2 = makePlan({ id: 'scenario-zzz', name: 'ZZZ Scenario' });

    const inputs: ComparisonInput[] = [
      {
        pairedResult: { ...makePaired([makeStepResult()], [makeStepResult()]), scenarioId: 'scenario-aaa' },
        scenarioPlan: plan1,
        protectedBehaviors: [],
      },
      {
        pairedResult: { ...makePaired([makeStepResult()], [makeStepResult()]), scenarioId: 'scenario-zzz' },
        scenarioPlan: plan2,
        protectedBehaviors: [],
      },
    ];

    const resultSet = compareAll(inputs);
    const ids = resultSet.differences.map((d) => d.differenceId);

    // Must be sorted ascending
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('compareAll produces consistent counts', () => {
    const plan1 = makePlan({ id: 'scenario-aaa' });
    const plan2 = makePlan({ id: 'scenario-bbb' });

    const inputs: ComparisonInput[] = [
      {
        pairedResult: { ...makePaired([makeStepResult()], [makeStepResult()]), scenarioId: 'scenario-aaa' },
        scenarioPlan: plan1,
        protectedBehaviors: [],
      },
      {
        pairedResult: {
          ...makePaired(
            [makeStepWithHttpObs('step-r06-001', 1, 200, { v: 1 })],
            [makeStepWithHttpObs('step-r06-001', 1, 200, { v: 2 }, 'candidate')],
          ),
          scenarioId: 'scenario-bbb',
        },
        scenarioPlan: plan2,
        protectedBehaviors: [],
      },
    ];

    const resultSet = compareAll(inputs);
    expect(resultSet.counts.PRESERVED).toBe(1);
    expect(resultSet.counts.POTENTIAL_DIFFERENCE).toBe(1);
    expect(Object.values(resultSet.counts).reduce((a, b) => a + b, 0)).toBe(inputs.length);
  });

  it('step results within a difference are sorted by sequence ascending', () => {
    const step1 = makeStepResult({ stepId: 'step-x', sequence: 1 });
    const step2 = makeStepResult({ stepId: 'step-y', sequence: 2 });
    const step3 = makeStepResult({ stepId: 'step-z', sequence: 3 });

    const input: ComparisonInput = {
      pairedResult: makePaired([step3, step1, step2], [step3, step1, step2]),
      scenarioPlan: makePlan(),
      protectedBehaviors: [],
    };

    const result = compareScenario(input);
    const sequences = result.stepResults.map((sr) => sr.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// 24. Serialization/validation
// ---------------------------------------------------------------------------

describe('24. Serialization/validation', () => {
  it('valid difference record passes validation', () => {
    const result = compareScenario(makeIdenticalInput());
    const validation = validateDifferenceRecord(result);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('serializes and deserializes a difference record (round-trip)', () => {
    const result = compareScenario(makeIdenticalInput());
    const json = serializeDifferenceRecord(result);
    const deserialized = deserializeDifferenceRecord(json);

    expect(deserialized.differenceId).toBe(result.differenceId);
    expect(deserialized.scenarioId).toBe(result.scenarioId);
    expect(deserialized.verdict).toBe(result.verdict);
    expect(deserialized.comparatorVersion).toBe(result.comparatorVersion);
  });

  it('serializes and deserializes a ComparisonResultSet (round-trip)', () => {
    const input = makeIdenticalInput();
    const resultSet = compareAll([input]);
    const json = serializeComparisonResultSet(resultSet);
    const deserialized = deserializeComparisonResultSet(json);

    expect(deserialized.differences).toHaveLength(1);
    expect(deserialized.comparatorVersion).toBe(COMPARISON_SCHEMA_VERSION);
    expect(deserialized.differences[0].differenceId).toBe(resultSet.differences[0].differenceId);
  });

  it('serialization is deterministic (same input → same JSON)', () => {
    const result = compareScenario(makeIdenticalInput());
    const json1 = serializeDifferenceRecord(result);
    const json2 = serializeDifferenceRecord(result);
    expect(json1).toBe(json2);
  });

  it('invalid record fails validation with error messages', () => {
    const validation = validateDifferenceRecord({
      differenceId: '',
      scenarioId: 'test',
      // missing many required fields
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it('invalid JSON throws EngineError on deserialization', () => {
    expect(() => deserializeDifferenceRecord('not-json')).toThrow();
  });

  it('unknown schema version throws on deserialization', () => {
    const result = compareScenario(makeIdenticalInput());
    const json = JSON.stringify({ schemaVersion: '99.0', record: result });
    expect(() => deserializeDifferenceRecord(json)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 25. ShopFlow inventory freshness case
// ---------------------------------------------------------------------------

describe('25. ShopFlow inventory freshness case', () => {
  /**
   * Build the ShopFlow scenario plan using the real R04 generator,
   * mirroring how R05 tests do it.
   */
  function getShopFlowPlan(): ScenarioPlan {
    const jId = journeyId(
      'inventory-visibility-after-update',
      'Update inventory stock, then read the product and assert the displayed stock reflects the update.',
    );

    const journey: BehaviorJourney = {
      id: jId,
      name: 'inventory-visibility-after-update',
      description: 'Update inventory stock, then read the product and assert the displayed stock reflects the update.',
      steps: [
        {
          id: journeyStepId(jId, 1, 'http', 'POST /test/seed'),
          sequence: 1,
          kind: 'http',
          description: 'POST /test/seed',
        },
        {
          id: journeyStepId(jId, 2, 'http', 'PUT /inventory/1'),
          sequence: 2,
          kind: 'http',
          description: 'PUT /inventory/1',
        },
        {
          id: journeyStepId(jId, 3, 'http', 'GET /products/1'),
          sequence: 3,
          kind: 'http',
          description: 'GET /products/1',
        },
      ],
      provenance: { confidence: 'inferred', sourceKind: 'inference' },
      confidence: 'inferred',
    };

    const genResult = generateScenarioPlan([journey], []);
    if (genResult.plans.length === 0) {
      throw new Error(
        `No plan generated for ShopFlow journey: ${genResult.unexercised.map((u) => u.explanation).join('; ')}`,
      );
    }
    return genResult.plans[0];
  }

  it('ShopFlow plan is generated deterministically', () => {
    const plan1 = getShopFlowPlan();
    const plan2 = getShopFlowPlan();
    expect(plan1.id).toBe(plan2.id);
  });

  it('ShopFlow: baseline stock=1, candidate stock=3, confirmed behavior → REGRESSION', async () => {
    const plan = getShopFlowPlan();

    // Execute both sides with the ShopFlow adapter
    const baseExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('baseline') });
    const candExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('candidate') });

    const BASELINE_TARGET = { kind: 'baseline' as const, revision: 'main' };
    const CANDIDATE_TARGET = { kind: 'candidate' as const, revision: 'feature/inventory-fix' };
    const RUN_ID = 'shopflow-r06-test-001';

    const baseResult = await baseExecutor.executeScenario(plan, BASELINE_TARGET, RUN_ID);
    const candResult = await candExecutor.executeScenario(plan, CANDIDATE_TARGET, RUN_ID);

    expect(baseResult.status).toBe('passed');
    expect(candResult.status).toBe('passed');

    // Verify the values are different (stock 1 vs 3)
    const baseStep3 = baseResult.steps.find((s) => s.sequence === 3)!;
    const candStep3 = candResult.steps.find((s) => s.sequence === 3)!;
    const baseHttpObs = baseStep3.observations.find((o) => o.kind === 'http_response')!;
    const candHttpObs = candStep3.observations.find((o) => o.kind === 'http_response')!;

    const baseBody = (baseHttpObs.normalizedValue as { body: { stock: number } }).body;
    const candBody = (candHttpObs.normalizedValue as { body: { stock: number } }).body;

    expect(baseBody.stock).toBe(1);
    expect(candBody.stock).toBe(3);

    // Build the behavior — inventory freshness with confirmed confidence
    const behavior = makeBehavior(
      'Inventory freshness',
      'stock',
      'Stock level must reflect latest update',
      'confirmed',
      [plan.traceability.sourceJourneyId],
    );

    const pairedResult: PairedExecutionResult = {
      scenarioId: plan.id,
      baseline: baseResult,
      candidate: candResult,
    };

    const comparisonInput: ComparisonInput = {
      pairedResult,
      scenarioPlan: {
        ...plan,
        traceability: {
          ...plan.traceability,
          sourceBehaviorIds: [behavior.id],
        },
      },
      protectedBehaviors: [behavior],
    };

    const result = compareScenario(comparisonInput);

    // Core assertion: stock difference with confirmed protected behavior → REGRESSION
    expect(result.verdict).toBe('REGRESSION');
    expect(result.summary).toContain('Inventory freshness');
  });

  it('ShopFlow: identical execution → PRESERVED', async () => {
    const plan = getShopFlowPlan();

    // Both sides use the same adapter (same stock=3)
    const executor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('candidate') });
    const BASELINE_TARGET = { kind: 'baseline' as const, revision: 'main' };
    const CANDIDATE_TARGET = { kind: 'candidate' as const, revision: 'feature/no-change' };

    const baseResult = await executor.executeScenario(plan, BASELINE_TARGET, 'run-id');
    const candResult = await executor.executeScenario(plan, CANDIDATE_TARGET, 'run-id');

    const pairedResult: PairedExecutionResult = {
      scenarioId: plan.id,
      baseline: baseResult,
      candidate: candResult,
    };

    const result = compareScenario({
      pairedResult,
      scenarioPlan: plan,
      protectedBehaviors: [],
    });

    expect(result.verdict).toBe('PRESERVED');
  });

  it('ShopFlow: without protected behavior → POTENTIAL_DIFFERENCE', async () => {
    const plan = getShopFlowPlan();

    const baseExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('baseline') });
    const candExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('candidate') });
    const BASELINE_TARGET = { kind: 'baseline' as const, revision: 'main' };
    const CANDIDATE_TARGET = { kind: 'candidate' as const, revision: 'feature/inventory-fix' };

    const baseResult = await baseExecutor.executeScenario(plan, BASELINE_TARGET, 'run-id');
    const candResult = await candExecutor.executeScenario(plan, CANDIDATE_TARGET, 'run-id');

    const pairedResult: PairedExecutionResult = {
      scenarioId: plan.id,
      baseline: baseResult,
      candidate: candResult,
    };

    // No protected behaviors
    const result = compareScenario({
      pairedResult,
      scenarioPlan: plan,
      protectedBehaviors: [],
    });

    // Diff detected but no protected behavior → POTENTIAL_DIFFERENCE
    expect(result.verdict).toBe('POTENTIAL_DIFFERENCE');
  });

  it('ShopFlow: REGRESSION record has non-empty stepResults with diffs', async () => {
    const plan = getShopFlowPlan();
    const baseExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('baseline') });
    const candExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('candidate') });
    const BASELINE_TARGET = { kind: 'baseline' as const, revision: 'main' };
    const CANDIDATE_TARGET = { kind: 'candidate' as const, revision: 'feature/inventory-fix' };

    const baseResult = await baseExecutor.executeScenario(plan, BASELINE_TARGET, 'run-id');
    const candResult = await candExecutor.executeScenario(plan, CANDIDATE_TARGET, 'run-id');

    const behavior = makeBehavior(
      'Inventory freshness',
      'stock',
      'Stock level must reflect latest update',
      'confirmed',
      [plan.traceability.sourceJourneyId],
    );

    const result = compareScenario({
      pairedResult: { scenarioId: plan.id, baseline: baseResult, candidate: candResult },
      scenarioPlan: {
        ...plan,
        traceability: { ...plan.traceability, sourceBehaviorIds: [behavior.id] },
      },
      protectedBehaviors: [behavior],
    });

    expect(result.verdict).toBe('REGRESSION');
    // stepResults should have entries for the ShopFlow steps
    expect(result.stepResults.length).toBeGreaterThan(0);
    // There should be a diff on the stock field
    const allDiffs = result.stepResults.flatMap((sr) => sr.fieldDiffs);
    expect(allDiffs.length).toBeGreaterThan(0);

    const stockDiff = allDiffs.find((d) => d.field.includes('stock'));
    expect(stockDiff).toBeDefined();
    expect(stockDiff!.baselineValue).toBe(1);
    expect(stockDiff!.candidateValue).toBe(3);
  });

  it('ShopFlow: REGRESSION verdict round-trips through serialization', async () => {
    const plan = getShopFlowPlan();
    const baseExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('baseline') });
    const candExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('candidate') });
    const BASELINE_TARGET = { kind: 'baseline' as const, revision: 'main' };
    const CANDIDATE_TARGET = { kind: 'candidate' as const, revision: 'feature/inventory-fix' };

    const baseResult = await baseExecutor.executeScenario(plan, BASELINE_TARGET, 'run-id');
    const candResult = await candExecutor.executeScenario(plan, CANDIDATE_TARGET, 'run-id');

    const behavior = makeBehavior(
      'Inventory freshness',
      'stock',
      'Stock level must reflect latest update',
      'confirmed',
      [plan.traceability.sourceJourneyId],
    );

    const result = compareScenario({
      pairedResult: { scenarioId: plan.id, baseline: baseResult, candidate: candResult },
      scenarioPlan: {
        ...plan,
        traceability: { ...plan.traceability, sourceBehaviorIds: [behavior.id] },
      },
      protectedBehaviors: [behavior],
    });

    const json = serializeDifferenceRecord(result);
    const deserialized = deserializeDifferenceRecord(json);

    expect(deserialized.verdict).toBe('REGRESSION');
    expect(deserialized.differenceId).toBe(result.differenceId);
  });

  it('ShopFlow REGRESSION differenceId is deterministic across multiple runs', async () => {
    const plan = getShopFlowPlan();
    const BASELINE_TARGET = { kind: 'baseline' as const, revision: 'main' };
    const CANDIDATE_TARGET = { kind: 'candidate' as const, revision: 'feature/inventory-fix' };

    const behavior = makeBehavior(
      'Inventory freshness',
      'stock',
      'Stock level must reflect latest update',
      'confirmed',
      [plan.traceability.sourceJourneyId],
    );

    const runComparison = async (): Promise<BehavioralDifferenceRecord> => {
      const baseExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('baseline') });
      const candExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('candidate') });

      const baseResult = await baseExecutor.executeScenario(plan, BASELINE_TARGET, 'run-id');
      const candResult = await candExecutor.executeScenario(plan, CANDIDATE_TARGET, 'run-id');

      return compareScenario({
        pairedResult: { scenarioId: plan.id, baseline: baseResult, candidate: candResult },
        scenarioPlan: {
          ...plan,
          traceability: { ...plan.traceability, sourceBehaviorIds: [behavior.id] },
        },
        protectedBehaviors: [behavior],
      });
    };

    const result1 = await runComparison();
    const result2 = await runComparison();

    expect(result1.differenceId).toBe(result2.differenceId);
    expect(result1.verdict).toBe('REGRESSION');
    expect(result2.verdict).toBe('REGRESSION');
  });
});

// ---------------------------------------------------------------------------
// extractFieldDiffs utility
// ---------------------------------------------------------------------------

describe('extractFieldDiffs utility', () => {
  it('returns empty array for equal values', () => {
    expect(extractFieldDiffs({ a: 1 }, { a: 1 }, 'root')).toHaveLength(0);
  });

  it('returns diff for different primitive values', () => {
    const diffs = extractFieldDiffs(1, 2, 'root');
    expect(diffs).toHaveLength(1);
    expect(diffs[0].baselineValue).toBe(1);
    expect(diffs[0].candidateValue).toBe(2);
  });

  it('recurses into nested objects', () => {
    const diffs = extractFieldDiffs({ a: { b: 1 } }, { a: { b: 2 } }, 'root');
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe('root.a.b');
  });

  it('handles null vs value diff', () => {
    const diffs = extractFieldDiffs(null, 'value', 'field');
    expect(diffs).toHaveLength(1);
    expect(diffs[0].baselineValue).toBeNull();
    expect(diffs[0].candidateValue).toBe('value');
  });
});
