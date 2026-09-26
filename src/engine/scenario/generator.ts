/**
 * Change Rehearsal — Scenario Plan Generator (R04)
 *
 * Converts BehaviorJourney / BehaviorProtectedBehavior domain objects (R03) into
 * deterministic, executable ScenarioPlan objects.
 *
 * Design invariants:
 * - Deterministic: same normalized input always produces the same output
 * - No timestamps, no randomness, no UUIDs
 * - Provenance and confidence are preserved verbatim — never upgraded
 * - Every unexercised journey/behavior is explicitly reported with a reason
 * - Nothing is silently dropped
 * - No I/O, no LLM calls, no network calls — pure in-memory transformation
 *
 * Fixture lookup:
 * The MVP uses a built-in registry of known seedDataRefs keyed by journey name.
 * This is intentionally simple for Phase 1. A later phase may introduce filesystem
 * or registry-based lookup without changing the generator's public interface.
 *
 * Owner: Reuben (engine)
 * Phase: R04
 */

import type {
  BehaviorJourney,
  BehaviorProtectedBehavior,
  BehaviorJourneyStep,
} from '../behavior/model.js';
import { validateScenarioPlan } from './validation.js';
import { scenarioPlanId, scenarioPlanStepId } from './ids.js';
import { EngineError } from '../errors.js';
import type {
  ScenarioPlan,
  ScenarioPlanStep,
  ScenarioPlanStepKind,
  ScenarioPrecondition,
  ScenarioTraceability,
  UnexercisedBehavior,
  ScenarioPlanGenerationResult,
  ConfidenceLevel,
} from './model.js';

// ---------------------------------------------------------------------------
// Seed data fixture registry
// ---------------------------------------------------------------------------

/**
 * Built-in mapping from journey name → seedDataRef.
 *
 * Journey names are matched case-insensitively after normalizing whitespace.
 * This is the authoritative source for MVP fixture resolution.
 *
 * To add a new fixture: add an entry here with the exact journey name as the key
 * and the relative fixture path (under src/engine/fixtures/) as the value.
 */
const SEED_DATA_REGISTRY: ReadonlyMap<string, string> = new Map([
  ['inventory-visibility-after-update', 'shopflow/inventory-3-units'],
]);

/**
 * Resolve the seedDataRef for a journey by name.
 * Returns undefined when no fixture is registered for this journey.
 */
function resolveSeedDataRef(journeyName: string): string | undefined {
  const normalized = journeyName.trim().toLowerCase();
  // Direct lookup first
  if (SEED_DATA_REGISTRY.has(normalized)) {
    return SEED_DATA_REGISTRY.get(normalized);
  }
  // Fallback: case-insensitive scan (handles whitespace normalisation differences)
  for (const [key, value] of SEED_DATA_REGISTRY) {
    if (key.toLowerCase() === normalized) {
      return value;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Step kind conversion
// ---------------------------------------------------------------------------

/**
 * Convert a BehaviorJourneyStepKind to ScenarioPlanStepKind.
 * They share the same value set; this is a type-boundary conversion.
 */
function toScenarioStepKind(kind: BehaviorJourneyStep['kind']): ScenarioPlanStepKind {
  // Both types use the same literal union; cast is safe.
  return kind as ScenarioPlanStepKind;
}

// ---------------------------------------------------------------------------
// Single-journey plan generation
// ---------------------------------------------------------------------------

/**
 * Attempt to generate a ScenarioPlan from a single BehaviorJourney.
 *
 * Returns either a ScenarioPlan (success) or an UnexercisedBehavior (failure).
 * Never throws — failures are expressed as UnexercisedBehavior records.
 *
 * @param journey     The source journey
 * @param behaviors   All known protected behaviors (used for traceability/invariant summary)
 */
function generatePlanFromJourney(
  journey: BehaviorJourney,
  behaviors: BehaviorProtectedBehavior[],
): { plan: ScenarioPlan } | { unexercised: UnexercisedBehavior } {
  // Guard: empty steps
  if (journey.steps.length === 0) {
    return {
      unexercised: {
        sourceId: journey.id,
        sourceName: journey.name,
        reason: 'empty_steps',
        explanation: `Journey "${journey.name}" has no steps and cannot be converted to a scenario`,
        confidence: journey.confidence,
      },
    };
  }

  // Guard: resolve seed data
  const seedDataRef = resolveSeedDataRef(journey.name);
  if (!seedDataRef) {
    return {
      unexercised: {
        sourceId: journey.id,
        sourceName: journey.name,
        reason: 'no_seed_data_ref',
        explanation:
          `Journey "${journey.name}" has no registered seed data fixture. ` +
          `Add an entry to SEED_DATA_REGISTRY in generator.ts to enable this scenario.`,
        confidence: journey.confidence,
      },
    };
  }

  // Find all behaviors that reference this journey
  const linkedBehaviors = behaviors.filter((b) =>
    b.relatedJourneyIds.includes(journey.id),
  );

  // Sort journey steps by sequence for stable output
  const sortedSteps = [...journey.steps].sort((a, b) => a.sequence - b.sequence);

  // Compute scenario ID before building steps (step IDs depend on scenario ID)
  const primaryBehaviorId = linkedBehaviors.length > 0 ? linkedBehaviors[0].id : undefined;
  const planId = scenarioPlanId(journey.id, seedDataRef, primaryBehaviorId);

  // Build scenario plan steps
  const planSteps: ScenarioPlanStep[] = sortedSteps.map((step, idx) => {
    const stepId = scenarioPlanStepId(planId, idx + 1, step.kind, step.description);
    return {
      id: stepId,
      sequence: idx + 1,
      kind: toScenarioStepKind(step.kind),
      description: step.description,
      ...(step.input !== undefined ? { input: step.input } : {}),
      ...(step.expectedHint !== undefined ? { expectedObservation: step.expectedHint } : {}),
      sourceStepId: step.id,
    };
  });

  // Build traceability record
  const traceability: ScenarioTraceability = {
    sourceJourneyId: journey.id,
    sourceJourneyName: journey.name,
    sourceBehaviorIds: linkedBehaviors.map((b) => b.id).sort(),
    sourceStepIds: sortedSteps.map((s) => s.id),
  };

  // Build preconditions
  const preconditions: ScenarioPrecondition[] = [
    {
      description: `Seed the application state from fixture "${seedDataRef}"`,
      seedDataRef,
    },
  ];

  // Build expected invariant summary from linked behaviors
  let expectedInvariantSummary: string | undefined;
  if (linkedBehaviors.length > 0) {
    const parts = linkedBehaviors.map(
      (b) => `${b.observable} → ${b.expectedOutcome}`,
    );
    expectedInvariantSummary = parts.join('; ');
  } else {
    // Fall back to step hints
    const hints = sortedSteps
      .map((s) => s.expectedHint)
      .filter((h): h is string => h !== undefined && h.length > 0);
    if (hints.length > 0) {
      expectedInvariantSummary = hints.join('; ');
    }
  }

  const plan: ScenarioPlan = {
    id: planId,
    name: journey.name,
    description: journey.description,
    confidence: journey.confidence,
    provenance: journey.provenance,
    traceability,
    preconditions,
    steps: planSteps,
    ...(expectedInvariantSummary !== undefined ? { expectedInvariantSummary } : {}),
    seedDataRef,
    deterministic: true,
  };

  return { plan };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate ScenarioPlan objects from a set of BehaviorJourney and
 * BehaviorProtectedBehavior records.
 *
 * Guarantees:
 * - Every input journey appears either in plans or in unexercised
 * - Output is deterministic: same normalized input → same output
 * - plans are sorted by id ascending
 * - unexercised entries are sorted by sourceId ascending
 * - Confidence and provenance from source journeys are preserved verbatim
 * - Generated plans pass internal validation (throws EngineError on bug)
 *
 * This function does NOT accept journeys with duplicate IDs — callers should
 * deduplicate before calling (the BehaviorRegistry enforces this at registration).
 *
 * @throws EngineError('SCENARIO_INVALID') if a generated plan fails internal validation
 *         (this is a programming error in the generator, not a user error)
 */
export function generateScenarioPlan(
  journeys: BehaviorJourney[],
  behaviors: BehaviorProtectedBehavior[],
): ScenarioPlanGenerationResult {
  const plans: ScenarioPlan[] = [];
  const unexercised: UnexercisedBehavior[] = [];
  const exercisedJourneyIds = new Set<string>();
  const exercisedBehaviorIds = new Set<string>();

  // Sort journeys by ID for deterministic processing order
  const sortedJourneys = [...journeys].sort((a, b) => a.id.localeCompare(b.id));

  for (const journey of sortedJourneys) {
    const result = generatePlanFromJourney(journey, behaviors);

    if ('plan' in result) {
      // Validate the generated plan — a failure here is a generator bug
      const validation = validateScenarioPlan(result.plan);
      if (!validation.valid) {
        throw new EngineError(
          'SCENARIO_INVALID',
          `Generator produced an invalid ScenarioPlan for journey "${journey.name}": ` +
          validation.errors.join('; '),
        );
      }

      plans.push(result.plan);
      exercisedJourneyIds.add(journey.id);

      // Mark all behaviors exercised by this plan
      for (const behaviorId of result.plan.traceability.sourceBehaviorIds) {
        exercisedBehaviorIds.add(behaviorId);
      }
    } else {
      unexercised.push(result.unexercised);
    }
  }

  // Stable sort output
  plans.sort((a, b) => a.id.localeCompare(b.id));
  unexercised.sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  return {
    plans,
    unexercised,
    exercisedJourneyIds: [...exercisedJourneyIds].sort(),
    exercisedBehaviorIds: [...exercisedBehaviorIds].sort(),
  };
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------

export type {
  ScenarioPlan,
  ScenarioPlanStep,
  ScenarioPrecondition,
  ScenarioTraceability,
  UnexercisedBehavior,
  ScenarioPlanGenerationResult,
};
