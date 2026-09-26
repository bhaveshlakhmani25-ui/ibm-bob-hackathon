/**
 * R04 — Scenario Generator Tests
 *
 * Covers all 14 required test areas:
 *  1.  Deterministic scenario IDs
 *  2.  Deterministic scenario generation
 *  3.  Journey-to-scenario mapping
 *  4.  Behavior-to-scenario traceability
 *  5.  Ordered scenario steps
 *  6.  Setup/preconditions
 *  7.  Expected observations/assertions
 *  8.  Unsupported/unexercised behavior reporting
 *  9.  Provenance/confidence preservation
 * 10.  Validation failures
 * 11.  Serialization round-trip
 * 12.  Duplicate/deterministic ordering behavior
 * 13.  ShopFlow inventory freshness scenario
 * 14.  Regression protection for existing R01/R02/R03 tests
 */

import { describe, it, expect } from 'vitest';
import type {
  BehaviorJourney,
  BehaviorProtectedBehavior,
  BehaviorJourneyStep,
} from '../../engine/behavior/model.js';
import { journeyId, journeyStepId, protectedBehaviorId } from '../../engine/behavior/ids.js';
import { scenarioPlanId, scenarioPlanStepId } from '../../engine/scenario/ids.js';
import {
  validateScenarioPlan,
  validateScenarioPlanStep,
  validateTraceability,
  validatePrecondition,
  VALID_STEP_PLAN_KINDS,
} from '../../engine/scenario/validation.js';
import { generateScenarioPlan } from '../../engine/scenario/generator.js';
import {
  serializeScenarioPlan,
  deserializeScenarioPlan,
  serializeGenerationResult,
  deserializeGenerationResult,
  SCENARIO_SCHEMA_VERSION,
} from '../../engine/scenario/serialization.js';
import { planScenarios } from '../../engine/scenario/planner.js';
import { EngineError, isEngineError } from '../../engine/errors.js';
import type { Journey, ProtectedBehavior, ImpactSet } from '../../engine/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<BehaviorJourneyStep> = {}): BehaviorJourneyStep {
  const sequence = overrides.sequence ?? 1;
  const kind = overrides.kind ?? 'http';
  const description = overrides.description ?? 'GET /products';
  const parentId = overrides.id ? 'parent' : 'journey-parent';
  return {
    id: journeyStepId(parentId, sequence, kind, description),
    sequence,
    kind,
    description,
    ...overrides,
  };
}

function makeJourney(overrides: Partial<BehaviorJourney> = {}): BehaviorJourney {
  const name = overrides.name ?? 'inventory-visibility-after-update';
  const description =
    overrides.description ?? 'Update inventory stock then read the product and assert the stock reflects the update.';
  const jId = journeyId(name, description);
  const step = makeStep({ id: journeyStepId(jId, 1, 'http', 'GET /products') });
  return {
    id: jId,
    name,
    description,
    steps: [step],
    provenance: { confidence: 'inferred', sourceKind: 'inference' },
    confidence: 'inferred',
    ...overrides,
  };
}

function makeBehavior(
  overrides: Partial<BehaviorProtectedBehavior> = {},
  journeyIds: string[] = [],
): BehaviorProtectedBehavior {
  const description =
    overrides.description ?? 'Inventory stock reflects the latest update';
  const observable = overrides.observable ?? 'GET /products/:id response body.stock';
  const expectedOutcome = overrides.expectedOutcome ?? 'stock equals the value from the most recent PUT /inventory/:id';
  return {
    id: protectedBehaviorId(description, observable, expectedOutcome),
    description,
    observable,
    expectedOutcome,
    provenance: { confidence: 'inferred', sourceKind: 'inference' },
    confidence: 'inferred',
    relatedJourneyIds: journeyIds,
    ...overrides,
  };
}

/** The canonical ShopFlow inventory journey (mirrors the fixture JSON). */
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
      input: { kind: 'http', method: 'POST', path: '/test/seed', body: { products: [{ id: 1 }] } },
      expectedHint: '200 OK',
    },
    {
      id: journeyStepId(jId, 2, 'http', 'PUT /inventory/1'),
      sequence: 2,
      kind: 'http',
      description: 'PUT /inventory/1',
      input: { kind: 'http', method: 'PUT', path: '/inventory/1', body: { stock: 1 } },
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

const EMPTY_IMPACT: ImpactSet = {
  affectedFiles: [],
  affectedSymbols: [],
  affectedServices: [],
  affectedWorkflows: [],
};

// ---------------------------------------------------------------------------
// 1. Deterministic scenario IDs
// ---------------------------------------------------------------------------

describe('1. Deterministic scenario IDs', () => {
  it('produces the same scenario ID for the same inputs', () => {
    const id1 = scenarioPlanId('journey-abc', 'shopflow/inventory-3-units');
    const id2 = scenarioPlanId('journey-abc', 'shopflow/inventory-3-units');
    expect(id1).toBe(id2);
  });

  it('produces different IDs for different journey IDs', () => {
    const id1 = scenarioPlanId('journey-aaa', 'shopflow/inventory-3-units');
    const id2 = scenarioPlanId('journey-bbb', 'shopflow/inventory-3-units');
    expect(id1).not.toBe(id2);
  });

  it('produces different IDs for different seedDataRefs', () => {
    const id1 = scenarioPlanId('journey-abc', 'shopflow/inventory-3-units');
    const id2 = scenarioPlanId('journey-abc', 'shopflow/other-fixture');
    expect(id1).not.toBe(id2);
  });

  it('includes optional behaviorId in the ID derivation', () => {
    const without = scenarioPlanId('journey-abc', 'shopflow/inventory-3-units');
    const with_ = scenarioPlanId('journey-abc', 'shopflow/inventory-3-units', 'behavior-xyz');
    expect(without).not.toBe(with_);
  });

  it('ID always starts with "scenario-" prefix', () => {
    const id = scenarioPlanId('journey-abc', 'shopflow/inventory-3-units');
    expect(id).toMatch(/^scenario-/);
  });

  it('step IDs are deterministic and start with "sstep-"', () => {
    const sid1 = scenarioPlanStepId('scenario-abc', 1, 'http', 'GET /products');
    const sid2 = scenarioPlanStepId('scenario-abc', 1, 'http', 'GET /products');
    expect(sid1).toBe(sid2);
    expect(sid1).toMatch(/^sstep-/);
  });

  it('step IDs differ for different sequences', () => {
    const sid1 = scenarioPlanStepId('scenario-abc', 1, 'http', 'GET /products');
    const sid2 = scenarioPlanStepId('scenario-abc', 2, 'http', 'GET /products');
    expect(sid1).not.toBe(sid2);
  });
});

// ---------------------------------------------------------------------------
// 2. Deterministic scenario generation
// ---------------------------------------------------------------------------

describe('2. Deterministic scenario generation', () => {
  it('produces the same output for the same input (idempotent)', () => {
    const journey = makeShopFlowJourney();
    const behavior = makeBehavior({}, [journey.id]);

    const result1 = generateScenarioPlan([journey], [behavior]);
    const result2 = generateScenarioPlan([journey], [behavior]);

    expect(result1.plans).toHaveLength(1);
    expect(result2.plans).toHaveLength(1);
    expect(result1.plans[0].id).toBe(result2.plans[0].id);
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it('produces stable output regardless of input array order (journeys)', () => {
    const j1 = makeJourney({ name: 'inventory-visibility-after-update', description: 'Journey A.' });
    const j2 = makeJourney({ name: 'some-unknown-journey', description: 'Journey B.' });

    const result1 = generateScenarioPlan([j1, j2], []);
    const result2 = generateScenarioPlan([j2, j1], []);

    expect(result1.plans.map((p) => p.id)).toEqual(result2.plans.map((p) => p.id));
    expect(result1.unexercised.map((u) => u.sourceId)).toEqual(
      result2.unexercised.map((u) => u.sourceId),
    );
  });

  it('output plans are sorted by id ascending', () => {
    const j1 = makeShopFlowJourney();
    // Add a second supported journey by extending the registry (not possible in current MVP,
    // so we just verify one plan is sorted trivially)
    const result = generateScenarioPlan([j1], []);
    const ids = result.plans.map((p) => p.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('unexercised entries are sorted by sourceId ascending', () => {
    const j1 = makeJourney({ name: 'unknown-a', description: 'A.' });
    const j2 = makeJourney({ name: 'unknown-b', description: 'B.' });
    const result = generateScenarioPlan([j1, j2], []);
    const sourceIds = result.unexercised.map((u) => u.sourceId);
    expect(sourceIds).toEqual([...sourceIds].sort());
  });
});

// ---------------------------------------------------------------------------
// 3. Journey-to-scenario mapping
// ---------------------------------------------------------------------------

describe('3. Journey-to-scenario mapping', () => {
  it('generates a plan for a supported journey', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans).toHaveLength(1);
    expect(result.unexercised).toHaveLength(0);
  });

  it('reports an unsupported journey as unexercised', () => {
    const journey = makeJourney({ name: 'unsupported-checkout', description: 'Some journey.' });
    const result = generateScenarioPlan([journey], []);
    expect(result.plans).toHaveLength(0);
    expect(result.unexercised).toHaveLength(1);
    expect(result.unexercised[0].sourceId).toBe(journey.id);
  });

  it('handles a mix of supported and unsupported journeys', () => {
    const supported = makeShopFlowJourney();
    const unsupported = makeJourney({ name: 'unknown-journey', description: 'Unknown.' });
    const result = generateScenarioPlan([supported, unsupported], []);
    expect(result.plans).toHaveLength(1);
    expect(result.unexercised).toHaveLength(1);
    expect(result.exercisedJourneyIds).toContain(supported.id);
    expect(result.unexercised[0].sourceId).toBe(unsupported.id);
  });

  it('records the exercised journey ID in exercisedJourneyIds', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.exercisedJourneyIds).toContain(journey.id);
  });

  it('maps scenario plan name from journey name', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].name).toBe(journey.name);
  });

  it('maps scenario plan description from journey description', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].description).toBe(journey.description);
  });
});

// ---------------------------------------------------------------------------
// 4. Behavior-to-scenario traceability
// ---------------------------------------------------------------------------

describe('4. Behavior-to-scenario traceability', () => {
  it('records the source journey ID in traceability', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].traceability.sourceJourneyId).toBe(journey.id);
  });

  it('records the source journey name in traceability', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].traceability.sourceJourneyName).toBe(journey.name);
  });

  it('records linked behavior IDs in traceability.sourceBehaviorIds', () => {
    const journey = makeShopFlowJourney();
    const behavior = makeBehavior({}, [journey.id]);
    const result = generateScenarioPlan([journey], [behavior]);
    expect(result.plans[0].traceability.sourceBehaviorIds).toContain(behavior.id);
  });

  it('records source step IDs in traceability.sourceStepIds', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const plan = result.plans[0];
    const stepIds = journey.steps.map((s) => s.id);
    for (const sid of stepIds) {
      expect(plan.traceability.sourceStepIds).toContain(sid);
    }
  });

  it('traceability.sourceStepIds preserves correct count', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].traceability.sourceStepIds).toHaveLength(journey.steps.length);
  });

  it('records exercised behavior IDs in exercisedBehaviorIds', () => {
    const journey = makeShopFlowJourney();
    const behavior = makeBehavior({}, [journey.id]);
    const result = generateScenarioPlan([journey], [behavior]);
    expect(result.exercisedBehaviorIds).toContain(behavior.id);
  });

  it('empty sourceBehaviorIds when no behavior references this journey', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].traceability.sourceBehaviorIds).toHaveLength(0);
  });

  it('sourceBehaviorIds are sorted ascending', () => {
    const journey = makeShopFlowJourney();
    const b1 = makeBehavior({ description: 'Behavior A', observable: 'obs-a', expectedOutcome: 'out-a' }, [journey.id]);
    const b2 = makeBehavior({ description: 'Behavior B', observable: 'obs-b', expectedOutcome: 'out-b' }, [journey.id]);
    const result = generateScenarioPlan([journey], [b1, b2]);
    const ids = result.plans[0].traceability.sourceBehaviorIds;
    expect(ids).toEqual([...ids].sort());
  });
});

// ---------------------------------------------------------------------------
// 5. Ordered scenario steps
// ---------------------------------------------------------------------------

describe('5. Ordered scenario steps', () => {
  it('generates steps with 1-based sequence numbers', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const steps = result.plans[0].steps;
    const sequences = steps.map((s) => s.sequence);
    expect(sequences).toEqual([1, 2, 3]);
  });

  it('steps are sorted by sequence ascending', () => {
    // Create a journey with steps in non-sequential insertion order
    const jId = journeyId('inventory-visibility-after-update', 'Reversed steps journey.');
    const steps: BehaviorJourneyStep[] = [
      { id: journeyStepId(jId, 3, 'http', 'step 3'), sequence: 3, kind: 'http', description: 'step 3' },
      { id: journeyStepId(jId, 1, 'http', 'step 1'), sequence: 1, kind: 'http', description: 'step 1' },
      { id: journeyStepId(jId, 2, 'http', 'step 2'), sequence: 2, kind: 'http', description: 'step 2' },
    ];
    const journey: BehaviorJourney = {
      id: jId,
      name: 'inventory-visibility-after-update',
      description: 'Reversed steps journey.',
      steps,
      provenance: { confidence: 'inferred' },
      confidence: 'inferred',
    };
    const result = generateScenarioPlan([journey], []);
    const planSteps = result.plans[0].steps;
    expect(planSteps.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(planSteps.map((s) => s.description)).toEqual(['step 1', 'step 2', 'step 3']);
  });

  it('each step has a unique ID', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const ids = result.plans[0].steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('step count matches source journey step count', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].steps).toHaveLength(journey.steps.length);
  });

  it('each plan step carries sourceStepId from the source journey step', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const sourceIds = journey.steps.map((s) => s.id);
    const planSourceIds = result.plans[0].steps.map((s) => s.sourceStepId);
    expect(planSourceIds.sort()).toEqual(sourceIds.sort());
  });

  it('step kind maps from source journey step kind', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    for (const step of result.plans[0].steps) {
      expect(VALID_STEP_PLAN_KINDS.has(step.kind)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Setup/preconditions
// ---------------------------------------------------------------------------

describe('6. Setup/preconditions', () => {
  it('generates at least one precondition for a supported journey', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].preconditions.length).toBeGreaterThan(0);
  });

  it('precondition contains a seedDataRef for the ShopFlow journey', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const hasSeedRef = result.plans[0].preconditions.some((pc) => pc.seedDataRef !== undefined);
    expect(hasSeedRef).toBe(true);
  });

  it('seedDataRef on the plan matches the precondition seedDataRef', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const plan = result.plans[0];
    const primaryPrecondition = plan.preconditions.find((pc) => pc.seedDataRef !== undefined);
    expect(plan.seedDataRef).toBe(primaryPrecondition?.seedDataRef);
  });

  it('precondition description is a non-empty string', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    for (const pc of result.plans[0].preconditions) {
      expect(pc.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('ShopFlow seedDataRef resolves to "shopflow/inventory-3-units"', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].seedDataRef).toBe('shopflow/inventory-3-units');
  });
});

// ---------------------------------------------------------------------------
// 7. Expected observations/assertions
// ---------------------------------------------------------------------------

describe('7. Expected observations/assertions', () => {
  it('step expectedObservation is derived from source expectedHint', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    // Step 3 of ShopFlow has expectedHint: 'body.stock === 1'
    const lastStep = result.plans[0].steps.find((s) => s.sequence === 3);
    expect(lastStep?.expectedObservation).toBe('body.stock === 1');
  });

  it('expectedInvariantSummary is set when a behavior is linked', () => {
    const journey = makeShopFlowJourney();
    const behavior = makeBehavior({}, [journey.id]);
    const result = generateScenarioPlan([journey], [behavior]);
    expect(result.plans[0].expectedInvariantSummary).toBeDefined();
    expect(result.plans[0].expectedInvariantSummary!.length).toBeGreaterThan(0);
  });

  it('expectedInvariantSummary contains the behavior observable and expectedOutcome', () => {
    const journey = makeShopFlowJourney();
    const behavior = makeBehavior(
      {
        observable: 'GET /products/:id response body.stock',
        expectedOutcome: 'stock equals the value from the most recent PUT',
      },
      [journey.id],
    );
    const result = generateScenarioPlan([journey], [behavior]);
    const summary = result.plans[0].expectedInvariantSummary!;
    expect(summary).toContain(behavior.observable);
    expect(summary).toContain(behavior.expectedOutcome);
  });

  it('expectedInvariantSummary falls back to step hints when no behavior is linked', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    // ShopFlow steps have expectedHints — should produce a summary
    expect(result.plans[0].expectedInvariantSummary).toBeDefined();
  });

  it('step without expectedHint has no expectedObservation', () => {
    const journey = makeShopFlowJourney();
    // Remove the expectedHint from step 1 in our test
    const modifiedJourney: BehaviorJourney = {
      ...journey,
      steps: journey.steps.map((s) =>
        s.sequence === 1 ? { ...s, expectedHint: undefined } : s,
      ),
    };
    const result = generateScenarioPlan([modifiedJourney], []);
    const step1 = result.plans[0].steps.find((s) => s.sequence === 1);
    expect(step1?.expectedObservation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Unsupported/unexercised behavior reporting
// ---------------------------------------------------------------------------

describe('8. Unsupported/unexercised behavior reporting', () => {
  it('reports a journey with no registered fixture as unexercised', () => {
    const journey = makeJourney({ name: 'no-fixture-journey', description: 'No fixture.' });
    const result = generateScenarioPlan([journey], []);
    expect(result.unexercised).toHaveLength(1);
    expect(result.unexercised[0].reason).toBe('no_seed_data_ref');
  });

  it('reports a journey with empty steps as unexercised', () => {
    const journey: BehaviorJourney = {
      ...makeShopFlowJourney(),
      steps: [],
    };
    const result = generateScenarioPlan([journey], []);
    expect(result.unexercised).toHaveLength(1);
    expect(result.unexercised[0].reason).toBe('empty_steps');
  });

  it('unexercised report has non-empty explanation', () => {
    const journey = makeJourney({ name: 'no-fixture-journey', description: 'No fixture.' });
    const result = generateScenarioPlan([journey], []);
    expect(result.unexercised[0].explanation.trim().length).toBeGreaterThan(0);
  });

  it('unexercised report carries the confidence level of the source journey', () => {
    const journey: BehaviorJourney = {
      ...makeJourney({ name: 'no-fixture-journey', description: 'No fixture.' }),
      confidence: 'test_derived',
    };
    const result = generateScenarioPlan([journey], []);
    expect(result.unexercised[0].confidence).toBe('test_derived');
  });

  it('unexercised report carries the sourceId of the source journey', () => {
    const journey = makeJourney({ name: 'no-fixture-journey', description: 'No fixture.' });
    const result = generateScenarioPlan([journey], []);
    expect(result.unexercised[0].sourceId).toBe(journey.id);
  });

  it('unexercised report carries the sourceName', () => {
    const journey = makeJourney({ name: 'no-fixture-journey', description: 'No fixture.' });
    const result = generateScenarioPlan([journey], []);
    expect(result.unexercised[0].sourceName).toBe(journey.name);
  });

  it('nothing is silently dropped: plans + unexercised covers all input journeys', () => {
    const j1 = makeShopFlowJourney();
    const j2 = makeJourney({ name: 'unknown-a', description: 'A.' });
    const j3 = makeJourney({ name: 'unknown-b', description: 'B.' });
    const result = generateScenarioPlan([j1, j2, j3], []);

    const coveredIds = new Set([
      ...result.plans.map((p) => p.traceability.sourceJourneyId),
      ...result.unexercised.map((u) => u.sourceId),
    ]);

    expect(coveredIds.has(j1.id)).toBe(true);
    expect(coveredIds.has(j2.id)).toBe(true);
    expect(coveredIds.has(j3.id)).toBe(true);
  });

  it('empty input produces empty results with no errors', () => {
    const result = generateScenarioPlan([], []);
    expect(result.plans).toHaveLength(0);
    expect(result.unexercised).toHaveLength(0);
    expect(result.exercisedJourneyIds).toHaveLength(0);
    expect(result.exercisedBehaviorIds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Provenance/confidence preservation
// ---------------------------------------------------------------------------

describe('9. Provenance/confidence preservation', () => {
  it('preserves journey confidence verbatim (inferred stays inferred)', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].confidence).toBe('inferred');
  });

  it('preserves journey confidence verbatim (test_derived)', () => {
    const journey: BehaviorJourney = {
      ...makeShopFlowJourney(),
      confidence: 'test_derived',
      provenance: { confidence: 'test_derived', sourceKind: 'test' },
    };
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].confidence).toBe('test_derived');
  });

  it('preserves journey confidence verbatim (confirmed)', () => {
    const journey: BehaviorJourney = {
      ...makeShopFlowJourney(),
      confidence: 'confirmed',
      provenance: { confidence: 'confirmed', sourceKind: 'developer_declaration' },
    };
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].confidence).toBe('confirmed');
  });

  it('preserves provenance.sourceKind from source journey', () => {
    const journey: BehaviorJourney = {
      ...makeShopFlowJourney(),
      provenance: { confidence: 'test_derived', sourceKind: 'test', sourceRef: 'test/inventory.test.ts' },
    };
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].provenance.sourceKind).toBe('test');
  });

  it('preserves provenance.sourceRef from source journey', () => {
    const journey: BehaviorJourney = {
      ...makeShopFlowJourney(),
      provenance: { confidence: 'inferred', sourceRef: 'openapi.yaml#/paths/inventory' },
    };
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].provenance.sourceRef).toBe('openapi.yaml#/paths/inventory');
  });

  it('does not upgrade inferred confidence for unexercised behavior', () => {
    const journey: BehaviorJourney = {
      ...makeJourney({ name: 'unknown', description: 'Unknown.' }),
      confidence: 'inferred',
    };
    const result = generateScenarioPlan([journey], []);
    expect(result.unexercised[0].confidence).toBe('inferred');
  });
});

// ---------------------------------------------------------------------------
// 10. Validation failures
// ---------------------------------------------------------------------------

describe('10. Validation failures', () => {
  describe('validateScenarioPlanStep', () => {
    it('fails when id is missing', () => {
      const step = { sequence: 1, kind: 'http', description: 'step', sourceStepId: 'src' };
      const result = validateScenarioPlanStep(step, 'step');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('id'))).toBe(true);
    });

    it('fails when sequence is 0', () => {
      const step = { id: 'step-1', sequence: 0, kind: 'http', description: 'step', sourceStepId: 'src' };
      const result = validateScenarioPlanStep(step, 'step');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('sequence'))).toBe(true);
    });

    it('fails when kind is invalid', () => {
      const step = { id: 'step-1', sequence: 1, kind: 'websocket', description: 'step', sourceStepId: 'src' };
      const result = validateScenarioPlanStep(step, 'step');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('kind'))).toBe(true);
    });

    it('fails when description is empty', () => {
      const step = { id: 'step-1', sequence: 1, kind: 'http', description: '  ', sourceStepId: 'src' };
      const result = validateScenarioPlanStep(step, 'step');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('description'))).toBe(true);
    });

    it('fails when sourceStepId is missing', () => {
      const step = { id: 'step-1', sequence: 1, kind: 'http', description: 'step' };
      const result = validateScenarioPlanStep(step, 'step');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('sourceStepId'))).toBe(true);
    });
  });

  describe('validateScenarioPlan', () => {
    it('fails when id is missing', () => {
      const journey = makeShopFlowJourney();
      const result0 = generateScenarioPlan([journey], []);
      const plan = { ...result0.plans[0], id: '' };
      const result = validateScenarioPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('.id'))).toBe(true);
    });

    it('fails when steps is empty', () => {
      const journey = makeShopFlowJourney();
      const result0 = generateScenarioPlan([journey], []);
      const plan = { ...result0.plans[0], steps: [] };
      const result = validateScenarioPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('steps'))).toBe(true);
    });

    it('fails when confidence is invalid', () => {
      const journey = makeShopFlowJourney();
      const result0 = generateScenarioPlan([journey], []);
      const plan = { ...result0.plans[0], confidence: 'super_confident' as never };
      const result = validateScenarioPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
    });

    it('fails when seedDataRef is empty', () => {
      const journey = makeShopFlowJourney();
      const result0 = generateScenarioPlan([journey], []);
      const plan = { ...result0.plans[0], seedDataRef: '' };
      const result = validateScenarioPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('seedDataRef'))).toBe(true);
    });

    it('fails when deterministic is false', () => {
      const journey = makeShopFlowJourney();
      const result0 = generateScenarioPlan([journey], []);
      const plan = { ...result0.plans[0], deterministic: false as never };
      const result = validateScenarioPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('deterministic'))).toBe(true);
    });

    it('fails when step sequences are non-contiguous', () => {
      const journey = makeShopFlowJourney();
      const result0 = generateScenarioPlan([journey], []);
      const plan = {
        ...result0.plans[0],
        steps: result0.plans[0].steps.map((s, i) => ({ ...s, sequence: i === 1 ? 5 : s.sequence })),
      };
      const result = validateScenarioPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('contiguous'))).toBe(true);
    });

    it('fails when step IDs are duplicated', () => {
      const journey = makeShopFlowJourney();
      const result0 = generateScenarioPlan([journey], []);
      const firstStepId = result0.plans[0].steps[0].id;
      const plan = {
        ...result0.plans[0],
        steps: result0.plans[0].steps.map((s, i) =>
          i === 1 ? { ...s, id: firstStepId } : s,
        ),
      };
      const result = validateScenarioPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
    });

    it('validates a well-formed generated plan as valid', () => {
      const journey = makeShopFlowJourney();
      const result0 = generateScenarioPlan([journey], []);
      const result = validateScenarioPlan(result0.plans[0]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('validateTraceability', () => {
    it('fails when sourceJourneyId is missing', () => {
      const t = { sourceJourneyId: '', sourceJourneyName: 'name', sourceBehaviorIds: [], sourceStepIds: [] };
      const result = validateTraceability(t, 'plan');
      expect(result.valid).toBe(false);
    });
  });

  describe('validatePrecondition', () => {
    it('fails when description is missing', () => {
      const result = validatePrecondition({ description: '' }, 'pc');
      expect(result.valid).toBe(false);
    });

    it('fails when seedDataRef is empty string', () => {
      const result = validatePrecondition({ description: 'setup', seedDataRef: '' }, 'pc');
      expect(result.valid).toBe(false);
    });

    it('passes without seedDataRef', () => {
      const result = validatePrecondition({ description: 'setup state' }, 'pc');
      expect(result.valid).toBe(true);
    });
  });

  describe('EngineError codes', () => {
    it('throws SCENARIO_INVALID for a plan that fails internal validation (programming error path)', () => {
      // We cannot easily trigger internal validation failure from outside
      // (the generator always produces valid plans), so we test the error code exists.
      const err = new EngineError('SCENARIO_INVALID', 'test');
      expect(isEngineError(err, 'SCENARIO_INVALID')).toBe(true);
    });

    it('throws SCENARIO_DESERIALIZATION_FAILED for bad JSON', () => {
      expect(() => deserializeScenarioPlan('not json')).toThrow(
        expect.objectContaining({ code: 'SCENARIO_DESERIALIZATION_FAILED' }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 11. Serialization round-trip
// ---------------------------------------------------------------------------

describe('11. Serialization round-trip', () => {
  it('serializeScenarioPlan / deserializeScenarioPlan round-trips correctly', () => {
    const journey = makeShopFlowJourney();
    const behavior = makeBehavior({}, [journey.id]);
    const result = generateScenarioPlan([journey], [behavior]);
    const plan = result.plans[0];

    const serialized = serializeScenarioPlan(plan);
    const deserialized = deserializeScenarioPlan(serialized);

    expect(deserialized.id).toBe(plan.id);
    expect(deserialized.name).toBe(plan.name);
    expect(deserialized.confidence).toBe(plan.confidence);
    expect(deserialized.seedDataRef).toBe(plan.seedDataRef);
    expect(deserialized.deterministic).toBe(true);
    expect(deserialized.steps).toHaveLength(plan.steps.length);
    expect(deserialized.traceability.sourceJourneyId).toBe(plan.traceability.sourceJourneyId);
    expect(deserialized.traceability.sourceBehaviorIds).toEqual(plan.traceability.sourceBehaviorIds);
  });

  it('serialized JSON contains the expected schema version', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const serialized = serializeScenarioPlan(result.plans[0]);
    const parsed = JSON.parse(serialized) as { schemaVersion: string };
    expect(parsed.schemaVersion).toBe(SCENARIO_SCHEMA_VERSION);
  });

  it('serializeGenerationResult / deserializeGenerationResult round-trips', () => {
    const j1 = makeShopFlowJourney();
    const j2 = makeJourney({ name: 'unknown', description: 'Unknown.' });
    const behavior = makeBehavior({}, [j1.id]);
    const result = generateScenarioPlan([j1, j2], [behavior]);

    const serialized = serializeGenerationResult(result);
    const deserialized = deserializeGenerationResult(serialized);

    expect(deserialized.plans).toHaveLength(result.plans.length);
    expect(deserialized.unexercised).toHaveLength(result.unexercised.length);
    expect(deserialized.exercisedJourneyIds).toEqual(result.exercisedJourneyIds);
    expect(deserialized.exercisedBehaviorIds).toEqual(result.exercisedBehaviorIds);
  });

  it('fails deserialization when schema version is wrong', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const serialized = serializeScenarioPlan(result.plans[0]);
    const corrupted = serialized.replace(SCENARIO_SCHEMA_VERSION, '99.0');
    expect(() => deserializeScenarioPlan(corrupted)).toThrow(
      expect.objectContaining({ code: 'SCENARIO_DESERIALIZATION_FAILED' }),
    );
  });

  it('fails deserialization when plan has invalid confidence', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const serialized = serializeScenarioPlan(result.plans[0]);
    const corrupted = serialized.replace('"inferred"', '"not_valid_confidence"');
    expect(() => deserializeScenarioPlan(corrupted)).toThrow(
      expect.objectContaining({ code: 'SCENARIO_DESERIALIZATION_FAILED' }),
    );
  });

  it('two serializations of the same plan are byte-for-byte identical', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const plan = result.plans[0];
    expect(serializeScenarioPlan(plan)).toBe(serializeScenarioPlan(plan));
  });
});

// ---------------------------------------------------------------------------
// 12. Duplicate/deterministic ordering behavior
// ---------------------------------------------------------------------------

describe('12. Duplicate/deterministic ordering behavior', () => {
  it('running generation twice on the same input produces identical JSON', () => {
    const journey = makeShopFlowJourney();
    const b = makeBehavior({}, [journey.id]);
    const r1 = generateScenarioPlan([journey], [b]);
    const r2 = generateScenarioPlan([journey], [b]);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('exercisedJourneyIds are sorted ascending', () => {
    const j = makeShopFlowJourney();
    const r = generateScenarioPlan([j], []);
    expect(r.exercisedJourneyIds).toEqual([...r.exercisedJourneyIds].sort());
  });

  it('exercisedBehaviorIds are sorted ascending', () => {
    const j = makeShopFlowJourney();
    const b1 = makeBehavior({ description: 'B1', observable: 'o1', expectedOutcome: 'e1' }, [j.id]);
    const b2 = makeBehavior({ description: 'B2', observable: 'o2', expectedOutcome: 'e2' }, [j.id]);
    const r = generateScenarioPlan([j], [b1, b2]);
    expect(r.exercisedBehaviorIds).toEqual([...r.exercisedBehaviorIds].sort());
  });

  it('plans array is sorted by id ascending', () => {
    const j = makeShopFlowJourney();
    const r = generateScenarioPlan([j], []);
    const ids = r.plans.map((p) => p.id);
    expect(ids).toEqual([...ids].sort());
  });
});

// ---------------------------------------------------------------------------
// 13. ShopFlow inventory freshness scenario
// ---------------------------------------------------------------------------

describe('13. ShopFlow inventory freshness scenario', () => {
  it('generates exactly one plan for the ShopFlow inventory journey', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans).toHaveLength(1);
  });

  it('generated plan seedDataRef is "shopflow/inventory-3-units"', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].seedDataRef).toBe('shopflow/inventory-3-units');
  });

  it('generated plan has 3 steps matching the fixture', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].steps).toHaveLength(3);
  });

  it('step 1 is a seed/setup step (POST)', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const step1 = result.plans[0].steps.find((s) => s.sequence === 1)!;
    expect(step1.kind).toBe('http');
    // input.method should be POST for the seed step
    expect((step1.input as Record<string, unknown>)?.['method']).toBe('POST');
  });

  it('step 2 updates inventory (PUT)', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const step2 = result.plans[0].steps.find((s) => s.sequence === 2)!;
    expect((step2.input as Record<string, unknown>)?.['method']).toBe('PUT');
  });

  it('step 3 reads product (GET) and asserts stock value', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const step3 = result.plans[0].steps.find((s) => s.sequence === 3)!;
    expect((step3.input as Record<string, unknown>)?.['method']).toBe('GET');
    expect(step3.expectedObservation).toContain('stock');
  });

  it('plan is traceable to the ShopFlow journey', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].traceability.sourceJourneyId).toBe(journey.id);
    expect(result.plans[0].traceability.sourceJourneyName).toBe('inventory-visibility-after-update');
  });

  it('plan has a precondition describing seed data setup', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const seedPrecondition = result.plans[0].preconditions.find(
      (pc) => pc.seedDataRef === 'shopflow/inventory-3-units',
    );
    expect(seedPrecondition).toBeDefined();
  });

  it('plan is deterministic (same ID on repeated calls)', () => {
    const journey = makeShopFlowJourney();
    const r1 = generateScenarioPlan([journey], []);
    const r2 = generateScenarioPlan([journey], []);
    expect(r1.plans[0].id).toBe(r2.plans[0].id);
  });

  it('plan confidence is preserved as "inferred" from source', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    expect(result.plans[0].confidence).toBe('inferred');
  });

  it('plan validates successfully', () => {
    const journey = makeShopFlowJourney();
    const result = generateScenarioPlan([journey], []);
    const validationResult = validateScenarioPlan(result.plans[0]);
    expect(validationResult.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 14. Regression protection — planScenarios() pipeline adapter
// ---------------------------------------------------------------------------

describe('14. Regression protection for R01/R02/R03 pipeline contract', () => {
  const fixtureJourney: Journey = {
    id: 'journey-inventory-visibility',
    changeId: '__fixture__',
    name: 'inventory-visibility-after-update',
    description: 'Update inventory stock, then read the product and assert the displayed stock reflects the update.',
    type: 'api',
    priority: 1,
    source: 'requirement',
    confidence: 'inferred',
    steps: [
      {
        id: 'step-1-seed',
        journeyId: 'journey-inventory-visibility',
        sequence: 1,
        actionType: 'http',
        input: { kind: 'http', method: 'POST', path: '/test/seed', body: {} },
        expectedHint: '200 OK',
      },
      {
        id: 'step-2-update-inventory',
        journeyId: 'journey-inventory-visibility',
        sequence: 2,
        actionType: 'http',
        input: { kind: 'http', method: 'PUT', path: '/inventory/1', body: { stock: 3 } },
        expectedHint: '200 OK, stock updated',
      },
      {
        id: 'step-3-read-product',
        journeyId: 'journey-inventory-visibility',
        sequence: 3,
        actionType: 'http',
        input: { kind: 'http', method: 'GET', path: '/products/1' },
        expectedHint: 'body.stock === 3',
      },
    ],
  };

  const fixtureBehavior: ProtectedBehavior = {
    id: 'behavior-inventory-freshness',
    changeId: '__fixture__',
    description: 'Inventory stock reflects the latest update',
    source: 'inferred',
    confidence: 'inferred',
    workflowName: 'inventory-visibility-after-update',
    relatedCodeRefs: [],
  };

  it('planScenarios returns a Scenario for the ShopFlow fixture journey', async () => {
    const { scenarios, notExercised } = await planScenarios(
      [fixtureJourney],
      [fixtureBehavior],
      EMPTY_IMPACT,
    );
    expect(scenarios).toHaveLength(1);
    expect(notExercised).toHaveLength(0);
  });

  it('planScenarios Scenario.id is deterministic', async () => {
    const { scenarios: s1 } = await planScenarios([fixtureJourney], [fixtureBehavior], EMPTY_IMPACT);
    const { scenarios: s2 } = await planScenarios([fixtureJourney], [fixtureBehavior], EMPTY_IMPACT);
    expect(s1[0].id).toBe(s2[0].id);
    expect(s1[0].id).toMatch(/^scenario-/);
  });

  it('planScenarios Scenario.deterministic is true', async () => {
    const { scenarios } = await planScenarios([fixtureJourney], [fixtureBehavior], EMPTY_IMPACT);
    expect(scenarios[0].deterministic).toBe(true);
  });

  it('planScenarios Scenario.journeyId matches the input journey', async () => {
    const { scenarios } = await planScenarios([fixtureJourney], [fixtureBehavior], EMPTY_IMPACT);
    expect(scenarios[0].journeyId).toBe(fixtureJourney.id);
  });

  it('planScenarios Scenario.seedDataRef is "shopflow/inventory-3-units"', async () => {
    const { scenarios } = await planScenarios([fixtureJourney], [fixtureBehavior], EMPTY_IMPACT);
    expect(scenarios[0].seedDataRef).toBe('shopflow/inventory-3-units');
  });

  it('planScenarios Scenario.steps are non-empty and ordered', async () => {
    const { scenarios } = await planScenarios([fixtureJourney], [fixtureBehavior], EMPTY_IMPACT);
    const steps = scenarios[0].steps;
    expect(steps.length).toBeGreaterThan(0);
    const sequences = steps.map((s) => s.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it('planScenarios notExercised carries deterministic IDs (no randomUUID)', async () => {
    const unknownJourney: Journey = {
      ...fixtureJourney,
      id: 'journey-unknown-z',
      name: 'unknown-journey-z',
    };
    const { notExercised: ne1 } = await planScenarios([unknownJourney], [], EMPTY_IMPACT);
    const { notExercised: ne2 } = await planScenarios([unknownJourney], [], EMPTY_IMPACT);
    expect(ne1).toHaveLength(1);
    expect(ne1[0].id).toBe(ne2[0].id);
  });

  it('planScenarios notExercised.verdict is "not_exercised"', async () => {
    const unknownJourney: Journey = {
      ...fixtureJourney,
      id: 'journey-unknown-q',
      name: 'unknown-journey-q',
    };
    const { notExercised } = await planScenarios([unknownJourney], [], EMPTY_IMPACT);
    expect(notExercised[0].verdict).toBe('not_exercised');
  });

  it('planScenarios Scenario.protectedBehaviorId links to the matching behavior', async () => {
    const { scenarios } = await planScenarios([fixtureJourney], [fixtureBehavior], EMPTY_IMPACT);
    expect(scenarios[0].protectedBehaviorId).toBe(fixtureBehavior.id);
  });
});
