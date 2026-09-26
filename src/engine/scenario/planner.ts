/**
 * ScenarioPlanner — converts journeys and protected behaviors into
 * deterministic executable Scenario objects.
 *
 * Owner: Reuben (engine)
 * Phase: 1
 *
 * Invariant: every Scenario produced by this module has deterministic: true.
 * If a journey cannot be made deterministic, produce a BehavioralDifference
 * with verdict: 'not_exercised' instead of including an unsafe scenario.
 */

import type {
  Journey,
  ProtectedBehavior,
  ImpactSet,
  Scenario,
  BehavioralDifference,
} from '../types.js';
import { randomUUID } from 'node:crypto';

export interface PlannerOutput {
  scenarios: Scenario[];
  /** Verdicts for journeys that could not be made into deterministic scenarios */
  notExercised: BehavioralDifference[];
}

/**
 * Plan deterministic scenarios from journeys and protected behaviors.
 *
 * For MVP, ShopFlow journeys are pre-defined fixtures with concrete HTTP steps.
 * LLM-generated journeys that lack a seedDataRef are flagged as not_exercised.
 */
export async function planScenarios(
  journeys: Journey[],
  protectedBehaviors: ProtectedBehavior[],
  _impact: ImpactSet,
): Promise<PlannerOutput> {
  // TODO (Phase 1):
  // For each journey:
  //   1. Check that all steps have concrete, deterministic inputs (no wildcards or LLM-only hints)
  //   2. Find or generate a seedDataRef for the journey (lookup fixtures/ directory)
  //   3. If both conditions are met: create Scenario
  //   4. Otherwise: create a BehavioralDifference with verdict: 'not_exercised'

  const scenarios: Scenario[] = [];
  const notExercised: BehavioralDifference[] = [];

  for (const journey of journeys) {
    const seedDataRef = resolveSeedDataRef(journey);

    if (!seedDataRef) {
      notExercised.push({
        id: randomUUID(),
        scenarioId: '',
        journeyId: journey.id,
        verdict: 'not_exercised',
        diffDetail: {
          stepDiffs: [],
          summary: `No deterministic seed data found for journey "${journey.name}"`,
        },
        isExpected: false,
      });
      continue;
    }

    scenarios.push({
      id: randomUUID(),
      journeyId: journey.id,
      protectedBehaviorId: protectedBehaviors.find(
        (pb) => pb.workflowName === journey.name,
      )?.id,
      steps: journey.steps,
      expectedInvariantHint: journey.steps
        .map((s) => s.expectedHint)
        .filter(Boolean)
        .join('; '),
      deterministic: true,
      seedDataRef,
    });
  }

  return { scenarios, notExercised };
}

/**
 * Resolve the seed data reference for a journey.
 * Returns undefined if no fixture exists for the journey.
 *
 * Fixture lookup order:
 * 1. fixtures/<journey.name>/seed.json
 * 2. fixtures/shopflow/<journey.name>/seed.json (ShopFlow default namespace)
 */
function resolveSeedDataRef(journey: Journey): string | undefined {
  // TODO (Phase 1): check filesystem for matching fixture directories
  // For now, return a hardcoded ref for the ShopFlow demo journey
  if (journey.name === 'inventory-visibility-after-update') {
    return 'shopflow/inventory-3-units';
  }
  return undefined;
}
