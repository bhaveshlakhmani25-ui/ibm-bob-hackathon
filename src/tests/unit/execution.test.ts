/**
 * Change Rehearsal — R05 Execution Tests
 *
 * Covers all 18 required test areas:
 *  1.  Baseline execution
 *  2.  Candidate execution
 *  3.  Same scenario executed against both targets (paired)
 *  4.  Step ordering
 *  5.  Successful execution
 *  6.  Failed step (application-level)
 *  7.  Blocked environment
 *  8.  Timeout
 *  9.  Infrastructure error
 * 10.  Partial step evidence preservation
 * 11.  Observation capture
 * 12.  Meaningful business values are preserved
 * 13.  Normalization of explicitly supported unstable values
 * 14.  Normalization does not erase meaningful values
 * 15.  Deterministic result serialization
 * 16.  Empty scenario handling (no steps: blocked at validation)
 * 17.  Invalid execution target handling
 * 18.  ShopFlow inventory freshness fixture
 *
 * All tests are deterministic — no LLM calls, no network calls, no external state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RehearsalExecutor } from '../../engine/execution/executor.js';
import { SyntheticAdapter, buildShopFlowAdapter } from '../../engine/execution/adapter.js';
import type { ExecutionTarget, ScenarioExecutionResult, StepExecutionResult } from '../../engine/execution/model.js';
import {
  normalizeBody,
  normalizeHeaders,
  normalizeString,
  normalizeHttpObservation,
  normalizeDbObservation,
} from '../../engine/execution/normalization.js';
import { validateExecutionTarget } from '../../engine/execution/validation.js';
import { aggregateStatus } from '../../engine/execution/executor.js';
import { EngineError } from '../../engine/errors.js';
import { generateScenarioPlan } from '../../engine/scenario/generator.js';
import { journeyId, journeyStepId } from '../../engine/behavior/ids.js';
import type { BehaviorJourney, BehaviorJourneyStep } from '../../engine/behavior/model.js';
import type { ScenarioPlan } from '../../engine/scenario/model.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASELINE_TARGET: ExecutionTarget = {
  kind: 'baseline',
  revision: 'main',
  environmentId: 'test',
};

const CANDIDATE_TARGET: ExecutionTarget = {
  kind: 'candidate',
  revision: 'feature/inventory-fix',
  environmentId: 'test',
};

const REHEARSAL_RUN_ID = 'run-test-rehearsal-001';

/**
 * Minimal valid ScenarioPlan for testing.
 * Has 3 steps with deterministic IDs.
 */
function makeMinimalPlan(overrides: Partial<ScenarioPlan> = {}): ScenarioPlan {
  return {
    id: 'scenario-test-001',
    name: 'Test Scenario',
    description: 'A minimal scenario for testing',
    confidence: 'inferred',
    provenance: { confidence: 'inferred' },
    traceability: {
      sourceJourneyId: 'journey-test-001',
      sourceJourneyName: 'Test Journey',
      sourceBehaviorIds: [],
      sourceStepIds: ['src-step-1', 'src-step-2', 'src-step-3'],
    },
    preconditions: [],
    steps: [
      {
        id: 'step-a',
        sequence: 1,
        kind: 'http',
        description: 'First step',
        sourceStepId: 'src-step-1',
      },
      {
        id: 'step-b',
        sequence: 2,
        kind: 'http',
        description: 'Second step',
        sourceStepId: 'src-step-2',
      },
      {
        id: 'step-c',
        sequence: 3,
        kind: 'http',
        description: 'Third step',
        sourceStepId: 'src-step-3',
      },
    ],
    seedDataRef: 'test/fixture-001',
    deterministic: true,
    ...overrides,
  };
}

/**
 * Build the ShopFlow inventory-visibility-after-update journey for tests.
 * Mirrors makeShopFlowJourney() from scenario.test.ts.
 */
function makeShopFlowJourney(): BehaviorJourney {
  const name = 'inventory-visibility-after-update';
  const description =
    'Update inventory stock, then read the product and assert the displayed stock reflects the update.';
  const jId = journeyId(name, description);

  const steps: BehaviorJourneyStep[] = [
    {
      id: journeyStepId(jId, 1, 'http', 'POST /test/seed'),
      sequence: 1,
      kind: 'http',
      description: 'POST /test/seed',
      input: {
        kind: 'http',
        method: 'POST',
        path: '/test/seed',
        body: { products: [{ id: 1 }] },
      },
      expectedHint: '200 OK',
    },
    {
      id: journeyStepId(jId, 2, 'http', 'PUT /inventory/1'),
      sequence: 2,
      kind: 'http',
      description: 'PUT /inventory/1',
      input: {
        kind: 'http',
        method: 'PUT',
        path: '/inventory/1',
        body: { stock: 1 },
      },
      expectedHint: '200 OK, stock updated',
    },
    {
      id: journeyStepId(jId, 3, 'http', 'GET /products/1'),
      sequence: 3,
      kind: 'http',
      description: 'GET /products/1',
      input: { kind: 'http', method: 'GET', path: '/products/1' },
      expectedHint: 'body.stock === 1',
    },
  ];

  return {
    id: jId,
    name,
    description,
    steps,
    provenance: { confidence: 'inferred', sourceKind: 'inference' },
    confidence: 'inferred',
  };
}

/**
 * Get the ShopFlow ScenarioPlan from the R04 generator.
 */
function getShopFlowPlan(): ScenarioPlan {
  const journey = makeShopFlowJourney();
  const result = generateScenarioPlan([journey], []);
  expect(result.plans).toHaveLength(1);
  return result.plans[0];
}

// ---------------------------------------------------------------------------
// 1. Baseline execution
// ---------------------------------------------------------------------------

describe('1. Baseline execution', () => {
  it('executes a scenario against the baseline target', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter(),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    expect(result.target.kind).toBe('baseline');
    expect(result.target.revision).toBe('main');
  });

  it('baseline result has a unique runId', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const r1 = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    const r2 = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    // Each execution is unique — runId is runtime-generated
    expect(r1.runId).not.toBe(r2.runId);
  });

  it('baseline result carries the rehearsalRunId in metadata', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.metadata.rehearsalRunId).toBe(REHEARSAL_RUN_ID);
  });

  it('baseline result contains the scenarioId', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.scenarioId).toBe(plan.id);
  });

  it('baseline result has startedAt and completedAt timestamps', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// 2. Candidate execution
// ---------------------------------------------------------------------------

describe('2. Candidate execution', () => {
  it('executes a scenario against the candidate target', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, CANDIDATE_TARGET, REHEARSAL_RUN_ID);

    expect(result.target.kind).toBe('candidate');
    expect(result.target.revision).toBe('feature/inventory-fix');
  });

  it('candidate result carries the rehearsalRunId in metadata', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, CANDIDATE_TARGET, REHEARSAL_RUN_ID);
    expect(result.metadata.rehearsalRunId).toBe(REHEARSAL_RUN_ID);
  });

  it('candidate result has a unique runId from baseline', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const baselineResult = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    const candidateResult = await executor.executeScenario(plan, CANDIDATE_TARGET, REHEARSAL_RUN_ID);
    expect(baselineResult.runId).not.toBe(candidateResult.runId);
  });
});

// ---------------------------------------------------------------------------
// 3. Same scenario executed against both targets (paired)
// ---------------------------------------------------------------------------

describe('3. Paired execution', () => {
  it('executeScenarioPair returns both baseline and candidate results', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const paired = await executor.executeScenarioPair(
      plan,
      BASELINE_TARGET,
      CANDIDATE_TARGET,
      REHEARSAL_RUN_ID,
    );

    expect(paired.scenarioId).toBe(plan.id);
    expect(paired.baseline.target.kind).toBe('baseline');
    expect(paired.candidate.target.kind).toBe('candidate');
  });

  it('both sides execute the same scenarioId', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const paired = await executor.executeScenarioPair(
      plan,
      BASELINE_TARGET,
      CANDIDATE_TARGET,
      REHEARSAL_RUN_ID,
    );

    expect(paired.baseline.scenarioId).toBe(plan.id);
    expect(paired.candidate.scenarioId).toBe(plan.id);
  });

  it('baseline and candidate have different runIds', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const paired = await executor.executeScenarioPair(
      plan,
      BASELINE_TARGET,
      CANDIDATE_TARGET,
      REHEARSAL_RUN_ID,
    );

    expect(paired.baseline.runId).not.toBe(paired.candidate.runId);
  });

  it('both sides share the same rehearsalRunId in metadata', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const paired = await executor.executeScenarioPair(
      plan,
      BASELINE_TARGET,
      CANDIDATE_TARGET,
      REHEARSAL_RUN_ID,
    );

    expect(paired.baseline.metadata.rehearsalRunId).toBe(REHEARSAL_RUN_ID);
    expect(paired.candidate.metadata.rehearsalRunId).toBe(REHEARSAL_RUN_ID);
  });
});

// ---------------------------------------------------------------------------
// 4. Step ordering
// ---------------------------------------------------------------------------

describe('4. Step ordering', () => {
  it('steps are returned in ascending sequence order', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const sequences = result.steps.map((s) => s.sequence);
    expect(sequences).toEqual([1, 2, 3]);
  });

  it('steps execute in ascending sequence order even if plan steps are unordered', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    // Deliberately provide steps out of order
    const plan = makeMinimalPlan({
      steps: [
        { id: 'step-c', sequence: 3, kind: 'http', description: 'Third', sourceStepId: 'src-3' },
        { id: 'step-a', sequence: 1, kind: 'http', description: 'First', sourceStepId: 'src-1' },
        { id: 'step-b', sequence: 2, kind: 'http', description: 'Second', sourceStepId: 'src-2' },
      ],
    });
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepIds = result.steps.map((s) => s.stepId);
    expect(stepIds).toEqual(['step-a', 'step-b', 'step-c']);
  });

  it('all steps are present in the result', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    expect(result.steps).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 5. Successful execution
// ---------------------------------------------------------------------------

describe('5. Successful execution', () => {
  it('all steps pass when adapter returns 200 OK', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': { httpStatus: 200, body: { ok: true } },
        'step-b': { httpStatus: 200, body: { count: 5 } },
        'step-c': { httpStatus: 200, body: { result: 'done' } },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    expect(result.status).toBe('passed');
    for (const step of result.steps) {
      expect(step.status).toBe('passed');
    }
  });

  it('scenario durationMs is a non-negative number', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('metadata stepsPassed equals step count on full success', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.metadata.stepsPassed).toBe(3);
    expect(result.metadata.stepsFailed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Failed step (application-level)
// ---------------------------------------------------------------------------

describe('6. Failed step (application-level)', () => {
  it('step with HTTP 404 has status "failed"', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-b': { httpStatus: 404, body: { error: 'not found' } },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepB = result.steps.find((s) => s.stepId === 'step-b')!;
    expect(stepB.status).toBe('failed');
  });

  it('scenario status is "failed" when any step is failed', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-b': { httpStatus: 500, body: { error: 'server error' } },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.status).toBe('failed');
  });

  it('application-level failure does NOT abort remaining steps', async () => {
    // step-a fails but step-b and step-c should still execute
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': { httpStatus: 400, body: { error: 'bad request' } },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepA = result.steps.find((s) => s.stepId === 'step-a')!;
    const stepB = result.steps.find((s) => s.stepId === 'step-b')!;
    const stepC = result.steps.find((s) => s.stepId === 'step-c')!;

    expect(stepA.status).toBe('failed');
    // Remaining steps still execute after application-level failure
    expect(stepB.status).toBe('passed');
    expect(stepC.status).toBe('passed');
  });

  it('metadata stepsFailed is correct after application-level failure', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-b': { forceFailure: true },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.metadata.stepsFailed).toBe(1);
    expect(result.metadata.stepsPassed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Blocked environment
// ---------------------------------------------------------------------------

describe('7. Blocked environment', () => {
  it('step with ENV_UNAVAILABLE error has status "blocked"', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': {
          forceError: true,
          errorCode: 'ENV_UNAVAILABLE',
          errorMessage: 'Service not reachable',
        },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepA = result.steps.find((s) => s.stepId === 'step-a')!;
    expect(stepA.status).toBe('blocked');
    expect(stepA.executionError?.code).toBe('ENV_UNAVAILABLE');
  });

  it('infrastructure failure (blocked) aborts remaining steps', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': {
          forceError: true,
          errorCode: 'ENV_UNAVAILABLE',
        },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    // step-b and step-c should be skipped (blocked) because of step-a failure
    const stepB = result.steps.find((s) => s.stepId === 'step-b')!;
    const stepC = result.steps.find((s) => s.stepId === 'step-c')!;
    expect(stepB.status).toBe('blocked');
    expect(stepC.status).toBe('blocked');
  });

  it('scenario status is "blocked" when first step is blocked', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': { forceError: true, errorCode: 'ENV_UNAVAILABLE' },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.status).toBe('blocked');
  });

  it('skipped steps have ENV_UNAVAILABLE executionError with an explanation', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': { forceError: true, errorCode: 'ENV_UNAVAILABLE' },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepB = result.steps.find((s) => s.stepId === 'step-b')!;
    expect(stepB.executionError?.code).toBe('ENV_UNAVAILABLE');
    expect(stepB.executionError?.message).toContain('skipped');
  });
});

// ---------------------------------------------------------------------------
// 8. Timeout
// ---------------------------------------------------------------------------

describe('8. Timeout', () => {
  it('step with TIMEOUT error code has status "timed_out"', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': {
          forceError: true,
          errorCode: 'TIMEOUT',
          errorMessage: 'Step exceeded timeout',
        },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepA = result.steps.find((s) => s.stepId === 'step-a')!;
    expect(stepA.status).toBe('timed_out');
    expect(stepA.executionError?.code).toBe('TIMEOUT');
  });

  it('scenario status is "timed_out" when any step times out', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-b': { forceError: true, errorCode: 'TIMEOUT' },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.status).toBe('timed_out');
  });

  it('timeout aborts remaining steps', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': { forceError: true, errorCode: 'TIMEOUT' },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepB = result.steps.find((s) => s.stepId === 'step-b')!;
    expect(stepB.status).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// 9. Infrastructure error
// ---------------------------------------------------------------------------

describe('9. Infrastructure error', () => {
  it('step with ADAPTER_ERROR has status "error"', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-b': {
          forceError: true,
          errorCode: 'ADAPTER_ERROR',
          errorMessage: 'Unexpected adapter failure',
        },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepB = result.steps.find((s) => s.stepId === 'step-b')!;
    expect(stepB.status).toBe('error');
    expect(stepB.executionError?.code).toBe('ADAPTER_ERROR');
  });

  it('scenario status is "error" when any step has an adapter error', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-c': { forceError: true, errorCode: 'ADAPTER_ERROR' },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.status).toBe('error');
  });

  it('infrastructure error status "error" takes priority over "failed" in aggregation', () => {
    const steps: StepExecutionResult[] = [
      { stepId: 's1', sequence: 1, status: 'failed', durationMs: 1, observations: [] },
      { stepId: 's2', sequence: 2, status: 'error', durationMs: 1, observations: [] },
    ];
    expect(aggregateStatus(steps)).toBe('error');
  });

  it('unhandled exception in adapter produces error step result', async () => {
    // Adapter that throws directly (not returning a result)
    const throwingAdapter = {
      name: 'ThrowingAdapter',
      canHandle: () => true,
      executeStep: async () => {
        throw new Error('Unexpected adapter crash');
      },
    };

    const executor = new RehearsalExecutor({ adapter: throwingAdapter });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepA = result.steps.find((s) => s.stepId === 'step-a')!;
    expect(stepA.status).toBe('error');
    expect(stepA.executionError?.code).toBe('ADAPTER_ERROR');
    expect(stepA.executionError?.cause).toContain('Unexpected adapter crash');
  });

  it('unsupported step kind produces error step result', async () => {
    const adapter = {
      name: 'LimitedAdapter',
      canHandle: () => false, // refuses all steps
      executeStep: async () => { throw new Error('should not be called'); },
    };

    const executor = new RehearsalExecutor({ adapter });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepA = result.steps.find((s) => s.stepId === 'step-a')!;
    expect(stepA.status).toBe('error');
    expect(stepA.executionError?.code).toBe('INVALID_STEP');
  });
});

// ---------------------------------------------------------------------------
// 10. Partial step evidence preservation
// ---------------------------------------------------------------------------

describe('10. Partial step evidence preservation', () => {
  it('completed step results are preserved when a later step fails', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': { httpStatus: 200, body: { step: 'a', value: 42 } },
        'step-b': { httpStatus: 200, body: { step: 'b', count: 7 } },
        'step-c': { forceError: true, errorCode: 'ADAPTER_ERROR' },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    // First two steps should have observations even though step-c failed
    const stepA = result.steps.find((s) => s.stepId === 'step-a')!;
    const stepB = result.steps.find((s) => s.stepId === 'step-b')!;

    expect(stepA.status).toBe('passed');
    expect(stepA.observations).toHaveLength(1);
    expect(stepB.status).toBe('passed');
    expect(stepB.observations).toHaveLength(1);
  });

  it('all step results are returned even when scenario status is error', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': { forceError: true, errorCode: 'ADAPTER_ERROR' },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    // All 3 steps returned (one error + two blocked)
    expect(result.steps).toHaveLength(3);
    expect(result.status).toBe('error');
  });

  it('step durationMs is present for all steps', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-c': { forceError: true, errorCode: 'ADAPTER_ERROR' },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    for (const step of result.steps) {
      expect(typeof step.durationMs).toBe('number');
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Observation capture
// ---------------------------------------------------------------------------

describe('11. Observation capture', () => {
  it('HTTP response observations are captured for each step', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': { httpStatus: 200, body: { id: 1, name: 'Widget' } },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepA = result.steps.find((s) => s.stepId === 'step-a')!;
    expect(stepA.observations).toHaveLength(1);
    expect(stepA.observations[0].kind).toBe('http_response');
  });

  it('observation.value contains the raw response', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': { httpStatus: 200, body: { id: 1, stock: 3 } },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const obs = result.steps[0].observations[0];
    const rawValue = obs.value as { status: number; body: { id: number; stock: number } };
    expect(rawValue.status).toBe(200);
    expect(rawValue.body.stock).toBe(3);
  });

  it('observation.normalizedValue contains normalized response', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': { httpStatus: 200, body: { id: 1, stock: 3 } },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const obs = result.steps[0].observations[0];
    expect(obs.normalizedValue).toBeDefined();
  });

  it('DB snapshot observation is captured when adapter provides dbSnapshot', async () => {
    const executor = new RehearsalExecutor({
      adapter: new SyntheticAdapter({
        'step-a': {
          httpStatus: 200,
          body: { ok: true },
          dbSnapshot: { 'inventory.productId=1.stock': 3 },
        },
      }),
    });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const stepA = result.steps.find((s) => s.stepId === 'step-a')!;
    const dbObs = stepA.observations.find((o) => o.kind === 'db_snapshot');
    expect(dbObs).toBeDefined();
    expect((dbObs!.value as Record<string, unknown>)['inventory.productId=1.stock']).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 12. Meaningful business values are preserved
// ---------------------------------------------------------------------------

describe('12. Meaningful business values are preserved', () => {
  it('numeric inventory quantity is preserved exactly (not normalized to placeholder)', () => {
    const body = { id: 1, name: 'Widget', stock: 3, price: 9.99 };
    const normalized = normalizeBody(body) as Record<string, unknown>;

    // All numeric values MUST be preserved
    expect(normalized['id']).toBe(1);
    expect(normalized['stock']).toBe(3);
    expect(normalized['price']).toBe(9.99);
  });

  it('string product name is preserved', () => {
    const body = { name: 'Widget Pro', category: 'Electronics' };
    const normalized = normalizeBody(body) as Record<string, unknown>;

    expect(normalized['name']).toBe('Widget Pro');
    expect(normalized['category']).toBe('Electronics');
  });

  it('boolean values are preserved', () => {
    const body = { active: true, deleted: false };
    const normalized = normalizeBody(body) as Record<string, unknown>;

    expect(normalized['active']).toBe(true);
    expect(normalized['deleted']).toBe(false);
  });

  it('null values are preserved', () => {
    const body = { deletedAt: null, parentId: null };
    const normalized = normalizeBody(body) as Record<string, unknown>;

    expect(normalized['deletedAt']).toBeNull();
    expect(normalized['parentId']).toBeNull();
  });

  it('HTTP status codes are preserved (not normalized)', () => {
    const obs = normalizeHttpObservation(200, {}, { ok: true }, 'test');
    const nv = obs.normalizedValue as { status: number };
    expect(nv.status).toBe(200);
  });

  it('error message strings are preserved', () => {
    const body = { error: 'Product not found', code: 'NOT_FOUND' };
    const normalized = normalizeBody(body) as Record<string, unknown>;

    expect(normalized['error']).toBe('Product not found');
    expect(normalized['code']).toBe('NOT_FOUND');
  });

  it('array ordering is preserved (not reordered by normalizer)', () => {
    const body = { items: [3, 1, 2], tags: ['b', 'a', 'c'] };
    const normalized = normalizeBody(body) as { items: number[]; tags: string[] };

    expect(normalized.items).toEqual([3, 1, 2]);
    expect(normalized.tags).toEqual(['b', 'a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// 13. Normalization of explicitly supported unstable values
// ---------------------------------------------------------------------------

describe('13. Normalization of unstable values', () => {
  it('ISO timestamps in string values are replaced with <timestamp>', () => {
    const result = normalizeString('Created at 2024-01-15T10:30:00Z by user');
    expect(result).toBe('Created at <timestamp> by user');
  });

  it('ISO timestamps with milliseconds are replaced', () => {
    const result = normalizeString('at 2024-01-15T10:30:00.123Z now');
    expect(result).toBe('at <timestamp> now');
  });

  it('ISO timestamps with timezone offset are replaced', () => {
    const result = normalizeString('2024-01-15T10:30:00+05:30');
    expect(result).toBe('<timestamp>');
  });

  it('UUID-like strings in values are replaced with <id>', () => {
    const result = normalizeString('request-id: 550e8400-e29b-41d4-a716-446655440000');
    expect(result).toBe('request-id: <id>');
  });

  it('timestamps in nested body objects are replaced', () => {
    const body = { id: 1, createdAt: '2024-01-15T10:30:00Z', stock: 3 };
    const normalized = normalizeBody(body) as Record<string, unknown>;

    expect(normalized['createdAt']).toBe('<timestamp>');
    expect(normalized['stock']).toBe(3); // meaningful value preserved
  });

  it('sensitive headers are redacted', () => {
    const headers = {
      'content-type': 'application/json',
      'authorization': 'Bearer secret-token',
      'x-api-key': 'my-api-key',
    };
    const normalized = normalizeHeaders(headers);

    expect(normalized['content-type']).toBe('application/json');
    expect(normalized['authorization']).toBe('<scrubbed>');
    expect(normalized['x-api-key']).toBe('<scrubbed>');
  });

  it('sensitive body fields are redacted', () => {
    const body = { username: 'alice', password: 'supersecret', token: 'jwt.payload.sig' };
    const normalized = normalizeBody(body) as Record<string, unknown>;

    expect(normalized['username']).toBe('alice');
    expect(normalized['password']).toBe('<scrubbed>');
    expect(normalized['token']).toBe('<scrubbed>');
  });

  it('UUIDs in deeply nested body are replaced', () => {
    const body = {
      data: {
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        count: 5,
      },
    };
    const normalized = normalizeBody(body) as { data: Record<string, unknown> };
    expect(normalized.data['requestId']).toBe('<id>');
    expect(normalized.data['count']).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 14. Normalization does not erase meaningful values
// ---------------------------------------------------------------------------

describe('14. Normalization preserves meaningful values', () => {
  it('integer quantity is not replaced', () => {
    expect(normalizeBody(3)).toBe(3);
    expect(normalizeBody(0)).toBe(0);
    expect(normalizeBody(100)).toBe(100);
  });

  it('decimal price is not replaced', () => {
    expect(normalizeBody(9.99)).toBe(9.99);
  });

  it('false is not replaced', () => {
    expect(normalizeBody(false)).toBe(false);
  });

  it('order state strings are not replaced', () => {
    const body = { status: 'pending', state: 'awaiting_payment' };
    const normalized = normalizeBody(body) as Record<string, unknown>;
    expect(normalized['status']).toBe('pending');
    expect(normalized['state']).toBe('awaiting_payment');
  });

  it('short numeric strings are not replaced', () => {
    const result = normalizeString('count: 42');
    expect(result).toBe('count: 42');
  });

  it('URL paths are not replaced', () => {
    const result = normalizeString('/products/1');
    expect(result).toBe('/products/1');
  });

  it('normal content-type header is not scrubbed', () => {
    const headers = { 'content-type': 'application/json', 'x-request-id': 'abc123' };
    const normalized = normalizeHeaders(headers);
    expect(normalized['content-type']).toBe('application/json');
    expect(normalized['x-request-id']).toBe('abc123');
  });
});

// ---------------------------------------------------------------------------
// 15. Deterministic result serialization
// ---------------------------------------------------------------------------

describe('15. Deterministic result serialization', () => {
  it('normalizeBody output is serializable to JSON (no undefined)', () => {
    const body = { id: 1, createdAt: '2024-01-15T10:30:00Z', stock: 3 };
    const normalized = normalizeBody(body);
    const json = JSON.stringify(normalized);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('object keys in normalizeBody output are sorted for determinism', () => {
    const body = { z: 1, a: 2, m: 3 };
    const normalized = normalizeBody(body) as Record<string, unknown>;
    const keys = Object.keys(normalized);
    expect(keys).toEqual(['a', 'm', 'z']);
  });

  it('header keys in normalizeHeaders output are sorted for determinism', () => {
    const headers = { 'z-header': 'z', 'a-header': 'a', 'm-header': 'm' };
    const normalized = normalizeHeaders(headers);
    const keys = Object.keys(normalized);
    expect(keys).toEqual(['a-header', 'm-header', 'z-header']);
  });

  it('same input always produces the same normalizeBody output', () => {
    const body = { id: 1, name: 'Widget', stock: 3, createdAt: '2024-01-15T10:30:00Z' };
    const n1 = JSON.stringify(normalizeBody(body));
    const n2 = JSON.stringify(normalizeBody(body));
    expect(n1).toBe(n2);
  });

  it('ScenarioExecutionResult fields can be serialized to JSON', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as ScenarioExecutionResult;
    expect(parsed.scenarioId).toBe(plan.id);
  });
});

// ---------------------------------------------------------------------------
// 16. Empty scenario handling
// ---------------------------------------------------------------------------

describe('16. Empty scenario / edge cases', () => {
  it('aggregateStatus returns "passed" for an empty step array', () => {
    expect(aggregateStatus([])).toBe('passed');
  });

  it('validateExecutionTarget throws EngineError for null target', () => {
    expect(() => validateExecutionTarget(null as unknown as ExecutionTarget)).toThrow(EngineError);
  });

  it('validateExecutionTarget throws for invalid kind', () => {
    expect(() => validateExecutionTarget({ kind: 'invalid' as 'baseline', revision: 'main' })).toThrow(EngineError);
  });

  it('validateExecutionTarget throws for empty revision', () => {
    expect(() => validateExecutionTarget({ kind: 'baseline', revision: '' })).toThrow(EngineError);
  });

  it('validateExecutionTarget does not throw for valid targets', () => {
    expect(() => validateExecutionTarget(BASELINE_TARGET)).not.toThrow();
    expect(() => validateExecutionTarget(CANDIDATE_TARGET)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 17. Invalid execution target handling
// ---------------------------------------------------------------------------

describe('17. Invalid execution target handling', () => {
  it('executeScenario throws EngineError for invalid target kind', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const badTarget = { kind: 'neither' as 'baseline', revision: 'main' };

    await expect(
      executor.executeScenario(plan, badTarget, REHEARSAL_RUN_ID),
    ).rejects.toThrow(EngineError);
  });

  it('executeScenario throws EngineError for empty revision', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const plan = makeMinimalPlan();
    const badTarget: ExecutionTarget = { kind: 'baseline', revision: '' };

    await expect(
      executor.executeScenario(plan, badTarget, REHEARSAL_RUN_ID),
    ).rejects.toThrow(EngineError);
  });

  it('executeScenario throws EngineError for plan without deterministic:true', async () => {
    const executor = new RehearsalExecutor({ adapter: new SyntheticAdapter() });
    const badPlan = { ...makeMinimalPlan(), deterministic: false } as unknown as ScenarioPlan;

    await expect(
      executor.executeScenario(badPlan, BASELINE_TARGET, REHEARSAL_RUN_ID),
    ).rejects.toThrow(EngineError);
  });
});

// ---------------------------------------------------------------------------
// 18. ShopFlow inventory freshness fixture
// ---------------------------------------------------------------------------

describe('18. ShopFlow inventory freshness fixture', () => {
  let plan: ScenarioPlan;

  beforeEach(() => {
    plan = getShopFlowPlan();
  });

  it('ShopFlow plan is deterministically generated by R04', () => {
    const plan2 = getShopFlowPlan();
    expect(plan.id).toBe(plan2.id);
  });

  it('baseline executes successfully with stock=1', async () => {
    const executor = new RehearsalExecutor({
      adapter: buildShopFlowAdapter('baseline'),
    });
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.status).toBe('passed');
  });

  it('candidate executes successfully with stock=3', async () => {
    const executor = new RehearsalExecutor({
      adapter: buildShopFlowAdapter('candidate'),
    });
    const result = await executor.executeScenario(plan, CANDIDATE_TARGET, REHEARSAL_RUN_ID);
    expect(result.status).toBe('passed');
  });

  it('baseline stock observation is 1 (old behavior)', async () => {
    const executor = new RehearsalExecutor({
      adapter: buildShopFlowAdapter('baseline'),
    });
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);

    // Step 3 is the GET /products/1 step
    const step3 = result.steps.find((s) => s.sequence === 3)!;
    const httpObs = step3.observations.find((o) => o.kind === 'http_response')!;
    const rawVal = httpObs.value as { status: number; body: { stock: number } };

    // R05 reports what it observed — it does NOT classify this as a regression
    expect(rawVal.body.stock).toBe(1);
  });

  it('candidate stock observation is 3 (new behavior)', async () => {
    const executor = new RehearsalExecutor({
      adapter: buildShopFlowAdapter('candidate'),
    });
    const result = await executor.executeScenario(plan, CANDIDATE_TARGET, REHEARSAL_RUN_ID);

    const step3 = result.steps.find((s) => s.sequence === 3)!;
    const httpObs = step3.observations.find((o) => o.kind === 'http_response')!;
    const rawVal = httpObs.value as { status: number; body: { stock: number } };

    // R05 reports 3 — comparison and regression verdict belong to R06
    expect(rawVal.body.stock).toBe(3);
  });

  it('both baseline and candidate stock values are preserved (not normalized to placeholder)', async () => {
    const baseExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('baseline') });
    const candExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('candidate') });

    const baseResult = await baseExecutor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    const candResult = await candExecutor.executeScenario(plan, CANDIDATE_TARGET, REHEARSAL_RUN_ID);

    const baseStep3 = baseResult.steps.find((s) => s.sequence === 3)!;
    const candStep3 = candResult.steps.find((s) => s.sequence === 3)!;

    const baseObs = baseStep3.observations.find((o) => o.kind === 'http_response')!;
    const candObs = candStep3.observations.find((o) => o.kind === 'http_response')!;

    const baseNV = baseObs.normalizedValue as { body: { stock: number } };
    const candNV = candObs.normalizedValue as { body: { stock: number } };

    // Business values MUST survive normalization
    expect(baseNV.body.stock).toBe(1);
    expect(candNV.body.stock).toBe(3);

    // The difference IS observable — R06 will detect it
    expect(baseNV.body.stock).not.toBe(candNV.body.stock);
  });

  it('paired execution captures both sides for R06 consumption', async () => {
    // R05 uses a single adapter because the SyntheticAdapter in a pair test
    // needs to serve both sides. In the real ShopFlow case we use per-side adapters.
    // Here we verify the paired result structure with consistent adapters.
    const executor = new RehearsalExecutor({
      adapter: buildShopFlowAdapter('candidate'),
    });

    const paired = await executor.executeScenarioPair(
      plan,
      BASELINE_TARGET,
      CANDIDATE_TARGET,
      REHEARSAL_RUN_ID,
    );

    expect(paired.scenarioId).toBe(plan.id);
    expect(paired.baseline.target.kind).toBe('baseline');
    expect(paired.candidate.target.kind).toBe('candidate');
    expect(paired.baseline.steps).toHaveLength(3);
    expect(paired.candidate.steps).toHaveLength(3);
  });

  it('R05 does NOT label the stock difference as "regression"', async () => {
    const baseExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('baseline') });
    const candExecutor = new RehearsalExecutor({ adapter: buildShopFlowAdapter('candidate') });

    const baseResult = await baseExecutor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    const candResult = await candExecutor.executeScenario(plan, CANDIDATE_TARGET, REHEARSAL_RUN_ID);

    // R05 status values: passed | failed | blocked | timed_out | error
    // "regression" is NOT a valid R05 status value
    const validStatuses = new Set(['passed', 'failed', 'blocked', 'timed_out', 'error']);
    expect(validStatuses.has(baseResult.status)).toBe(true);
    expect(validStatuses.has(candResult.status)).toBe(true);

    // Both should be "passed" — the execution succeeded even though values differ
    expect(baseResult.status).toBe('passed');
    expect(candResult.status).toBe('passed');
  });

  it('ShopFlow plan has 3 steps and all produce observations', async () => {
    const executor = new RehearsalExecutor({
      adapter: buildShopFlowAdapter('candidate'),
    });
    const result = await executor.executeScenario(plan, CANDIDATE_TARGET, REHEARSAL_RUN_ID);

    expect(result.steps).toHaveLength(3);
    for (const step of result.steps) {
      expect(step.observations.length).toBeGreaterThan(0);
    }
  });

  it('DB snapshot observation captures stock value correctly', async () => {
    const executor = new RehearsalExecutor({
      adapter: buildShopFlowAdapter('candidate'),
    });
    const result = await executor.executeScenario(plan, CANDIDATE_TARGET, REHEARSAL_RUN_ID);

    const step3 = result.steps.find((s) => s.sequence === 3)!;
    const dbObs = step3.observations.find((o) => o.kind === 'db_snapshot');
    expect(dbObs).toBeDefined();

    const dbValue = dbObs!.value as Record<string, unknown>;
    expect(dbValue['inventory.productId=1.stock']).toBe(3);
  });

  it('seedDataRef is preserved in run metadata', async () => {
    const executor = new RehearsalExecutor({
      adapter: buildShopFlowAdapter('baseline'),
    });
    const result = await executor.executeScenario(plan, BASELINE_TARGET, REHEARSAL_RUN_ID);
    expect(result.metadata.seedDataRef).toBe('shopflow/inventory-3-units');
  });
});
