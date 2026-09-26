/**
 * ScenarioPlanner — converts journeys and protected behaviors into
 * deterministic executable Scenario objects.
 *
 * Owner: Reuben (engine)
 * Phase: 1 / R04
 *
 * Invariant: every Scenario produced by this module has deterministic: true.
 * If a journey cannot be made deterministic, an UnexercisedBehavior is recorded
 * in the generation result. The adapter below converts these to BehavioralDifference
 * (verdict: 'not_exercised') only to satisfy the existing PlannerOutput contract —
 * no information is manufactured or lost in the conversion.
 *
 * R04 domain model (ScenarioPlan) is produced by generator.ts.
 * This file is the adapter between the R04 domain and the R01 pipeline contract.
 */

import type {
  Journey,
  ProtectedBehavior,
  ImpactSet,
  Scenario,
  BehavioralDifference,
  JourneyStep,
} from '../types.js';
import type {
  BehaviorJourney,
  BehaviorJourneyStep,
} from '../behavior/model.js';
import { generateScenarioPlan } from './generator.js';
import { scenarioPlanId } from './ids.js';
import type { ScenarioPlan, UnexercisedBehavior } from './model.js';

export interface PlannerOutput {
  scenarios: Scenario[];
  /** Verdicts for journeys that could not be made into deterministic scenarios */
  notExercised: BehavioralDifference[];
}

/**
 * Plan deterministic scenarios from journeys and protected behaviors.
 *
 * Accepts the pipeline Journey/ProtectedBehavior types from types.ts.
 * Internally adapts them to R03 BehaviorJourney objects, runs the R04 generator,
 * then adapts the output back to the pipeline Scenario/BehavioralDifference types.
 *
 * No randomness — IDs are deterministic content hashes.
 */
export async function planScenarios(
  journeys: Journey[],
  protectedBehaviors: ProtectedBehavior[],
  _impact: ImpactSet,
): Promise<PlannerOutput> {
  // Adapt pipeline Journey[] → BehaviorJourney[] for the R04 generator.
  // Pipeline journeys already carry the necessary fields; we map them
  // to the richer R03 domain model without losing any information.
  const behaviorJourneys: BehaviorJourney[] = journeys.map(adaptJourney);

  // Adapt pipeline ProtectedBehavior[] → BehaviorProtectedBehavior[] for
  // the generator's behavior-lookup and traceability wiring.
  // Note: pipeline ProtectedBehavior does not carry relatedJourneyIds, so we
  // derive the relationship by matching workflowName against journey names.
  const behaviorProtected = protectedBehaviors.map((pb) => ({
    id: pb.id,
    description: pb.description,
    observable: pb.workflowName,
    expectedOutcome: pb.description,
    provenance: { confidence: pb.confidence },
    confidence: pb.confidence,
    relatedJourneyIds: journeys
      .filter((j) => j.name === pb.workflowName)
      .map((j) => j.id),
  }));

  // Run the R04 deterministic generator
  const result = generateScenarioPlan(behaviorJourneys, behaviorProtected);

  // Adapt ScenarioPlan[] → Scenario[] (pipeline contract)
  const scenarios: Scenario[] = result.plans.map((plan) =>
    adaptScenarioPlan(plan, journeys),
  );

  // Adapt UnexercisedBehavior[] → BehavioralDifference[] (pipeline contract)
  // This adapter exists solely because PlannerOutput.notExercised is typed as
  // BehavioralDifference[]. The R04-specific reason/explanation is preserved
  // in the diffDetail.summary so no information is lost.
  const notExercised: BehavioralDifference[] = result.unexercised.map((u) =>
    adaptUnexercised(u),
  );

  return { scenarios, notExercised };
}

// ---------------------------------------------------------------------------
// Adapters: pipeline types ↔ R04 domain types
// ---------------------------------------------------------------------------

/**
 * Adapt a pipeline Journey to a BehaviorJourney for the R04 generator.
 */
function adaptJourney(journey: Journey): BehaviorJourney {
  return {
    id: journey.id,
    name: journey.name,
    description: journey.description,
    steps: journey.steps.map(adaptJourneyStep),
    provenance: { confidence: journey.confidence },
    confidence: journey.confidence,
  };
}

/**
 * Adapt a pipeline JourneyStep to a BehaviorJourneyStep.
 */
function adaptJourneyStep(step: JourneyStep): BehaviorJourneyStep {
  // Map pipeline actionType to BehaviorJourneyStepKind
  const kind = step.actionType as BehaviorJourneyStep['kind'];
  return {
    id: step.id,
    sequence: step.sequence,
    kind,
    description: step.expectedHint ?? `${step.actionType} step`,
    input: step.input as unknown as Record<string, unknown>,
    ...(step.expectedHint !== undefined ? { expectedHint: step.expectedHint } : {}),
  };
}

/**
 * Adapt a ScenarioPlan to the pipeline Scenario type.
 *
 * The pipeline Scenario reuses JourneyStep[] from the source journey.
 * We look up the original steps from the input journeys array by traceability.
 */
function adaptScenarioPlan(plan: ScenarioPlan, journeys: Journey[]): Scenario {
  const sourceJourney = journeys.find(
    (j) => j.id === plan.traceability.sourceJourneyId,
  );

  // Use the original pipeline JourneySteps (preserving their full structure)
  // sorted by sequence for deterministic order.
  const steps: JourneyStep[] = sourceJourney
    ? [...sourceJourney.steps].sort((a, b) => a.sequence - b.sequence)
    : [];

  // The scenario ID is derived deterministically from the plan.
  // For pipeline Scenario we use the same ID as the ScenarioPlan so IDs are
  // consistent across the R04 domain and the execution pipeline.
  return {
    id: plan.id,
    journeyId: plan.traceability.sourceJourneyId,
    protectedBehaviorId:
      plan.traceability.sourceBehaviorIds.length > 0
        ? plan.traceability.sourceBehaviorIds[0]
        : undefined,
    steps,
    expectedInvariantHint: plan.expectedInvariantSummary,
    deterministic: true,
    seedDataRef: plan.seedDataRef,
  };
}

/**
 * Adapt an UnexercisedBehavior to a BehavioralDifference.
 *
 * This adapter is required only by the PlannerOutput.notExercised contract.
 * The R04-specific reason is embedded in diffDetail.summary so it is not lost.
 * scenarioId is intentionally empty — no scenario was created.
 *
 * Deterministic ID: derived from sourceId so the same unexercised report
 * always produces the same BehavioralDifference ID.
 */
function adaptUnexercised(u: UnexercisedBehavior): BehavioralDifference {
  return {
    id: `unexercised-${scenarioPlanId(u.sourceId, u.reason)}`,
    scenarioId: '',
    journeyId: u.sourceId,
    verdict: 'not_exercised',
    diffDetail: {
      stepDiffs: [],
      summary: `[${u.reason}] ${u.explanation}`,
    },
    isExpected: false,
  };
}
