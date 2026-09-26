/**
 * Change Rehearsal — Scenario Domain Serialization (R04)
 *
 * Deterministic serialization and deserialization for the scenario domain model.
 *
 * Requirements:
 * - Stable field structure: field order is normalized on serialize
 * - Stable collection ordering: steps sorted by sequence, arrays sorted by id ascending
 * - Round-trip fidelity: deserialize(serialize(x)) deep-equals x
 * - Invalid input → typed EngineError (SCENARIO_DESERIALIZATION_FAILED), never an unhandled throw
 * - No randomness, no timestamps injected during serialization
 *
 * Follows the same pattern as behavior/serialization.ts.
 * Serialized format is plain JSON; the envelope carries a schema version.
 *
 * Owner: Reuben (engine)
 * Phase: R04
 */

import type { ScenarioPlan, ScenarioPlanGenerationResult, UnexercisedBehavior } from './model.js';
import { validateScenarioPlan } from './validation.js';
import { EngineError } from '../errors.js';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Increment when the serialized format changes in a breaking way. */
export const SCENARIO_SCHEMA_VERSION = '1.0';

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

export interface SerializedScenarioPlan {
  schemaVersion: string;
  plan: ScenarioPlan;
}

export interface SerializedScenarioPlanGenerationResult {
  schemaVersion: string;
  plans: ScenarioPlan[];
  unexercised: UnexercisedBehavior[];
  exercisedJourneyIds: string[];
  exercisedBehaviorIds: string[];
}

// ---------------------------------------------------------------------------
// ScenarioPlan serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a single ScenarioPlan to a deterministic JSON string.
 * Steps are sorted by sequence; sourceBehaviorIds and sourceStepIds are sorted ascending.
 */
export function serializeScenarioPlan(plan: ScenarioPlan): string {
  const normalized = normalizePlan(plan);
  const envelope: SerializedScenarioPlan = {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    plan: normalized,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a ScenarioPlan from a JSON string.
 *
 * @throws EngineError('SCENARIO_DESERIALIZATION_FAILED') if:
 *   - input is not valid JSON
 *   - envelope structure is wrong
 *   - schema version is unrecognized
 *   - the plan payload fails validation
 */
export function deserializeScenarioPlan(raw: string): ScenarioPlan {
  const parsed = safeParse(raw);
  assertObject(parsed, 'scenario plan envelope');

  const envelope = parsed as Record<string, unknown>;
  assertSchemaVersion(envelope['schemaVersion']);

  const result = validateScenarioPlan(envelope['plan']);
  if (!result.valid) {
    throw new EngineError(
      'SCENARIO_DESERIALIZATION_FAILED',
      `Deserialized scenario plan failed validation: ${result.errors.join('; ')}`,
    );
  }

  return envelope['plan'] as ScenarioPlan;
}

// ---------------------------------------------------------------------------
// ScenarioPlanGenerationResult serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a ScenarioPlanGenerationResult to a deterministic JSON string.
 * Plans are sorted by id ascending; unexercised entries by sourceId ascending.
 */
export function serializeGenerationResult(result: ScenarioPlanGenerationResult): string {
  const envelope: SerializedScenarioPlanGenerationResult = {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    plans: sortById(result.plans).map(normalizePlan),
    unexercised: sortBy(result.unexercised, (u) => u.sourceId).map(normalizeUnexercised),
    exercisedJourneyIds: [...result.exercisedJourneyIds].sort(),
    exercisedBehaviorIds: [...result.exercisedBehaviorIds].sort(),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a ScenarioPlanGenerationResult from a JSON string.
 * Each plan is individually validated.
 *
 * @throws EngineError('SCENARIO_DESERIALIZATION_FAILED') on any parse or validation failure
 */
export function deserializeGenerationResult(raw: string): ScenarioPlanGenerationResult {
  const parsed = safeParse(raw);
  assertObject(parsed, 'generation result envelope');

  const envelope = parsed as Record<string, unknown>;
  assertSchemaVersion(envelope['schemaVersion']);

  if (!Array.isArray(envelope['plans'])) {
    throw new EngineError(
      'SCENARIO_DESERIALIZATION_FAILED',
      'Generation result envelope must contain a "plans" array',
    );
  }

  if (!Array.isArray(envelope['unexercised'])) {
    throw new EngineError(
      'SCENARIO_DESERIALIZATION_FAILED',
      'Generation result envelope must contain an "unexercised" array',
    );
  }

  if (!Array.isArray(envelope['exercisedJourneyIds'])) {
    throw new EngineError(
      'SCENARIO_DESERIALIZATION_FAILED',
      'Generation result envelope must contain an "exercisedJourneyIds" array',
    );
  }

  if (!Array.isArray(envelope['exercisedBehaviorIds'])) {
    throw new EngineError(
      'SCENARIO_DESERIALIZATION_FAILED',
      'Generation result envelope must contain an "exercisedBehaviorIds" array',
    );
  }

  const plans: ScenarioPlan[] = [];
  for (let i = 0; i < (envelope['plans'] as unknown[]).length; i++) {
    const result = validateScenarioPlan((envelope['plans'] as unknown[])[i]);
    if (!result.valid) {
      throw new EngineError(
        'SCENARIO_DESERIALIZATION_FAILED',
        `plans[${i}] failed validation: ${result.errors.join('; ')}`,
      );
    }
    plans.push((envelope['plans'] as unknown[])[i] as ScenarioPlan);
  }

  return {
    plans,
    unexercised: envelope['unexercised'] as UnexercisedBehavior[],
    exercisedJourneyIds: envelope['exercisedJourneyIds'] as string[],
    exercisedBehaviorIds: envelope['exercisedBehaviorIds'] as string[],
  };
}

// ---------------------------------------------------------------------------
// Normalization helpers (stable field order + sorted collections)
// ---------------------------------------------------------------------------

function normalizePlan(p: ScenarioPlan): ScenarioPlan {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    confidence: p.confidence,
    provenance: {
      confidence: p.provenance.confidence,
      ...(p.provenance.sourceRef !== undefined ? { sourceRef: p.provenance.sourceRef } : {}),
      ...(p.provenance.sourceKind !== undefined ? { sourceKind: p.provenance.sourceKind } : {}),
    },
    traceability: {
      sourceJourneyId: p.traceability.sourceJourneyId,
      sourceJourneyName: p.traceability.sourceJourneyName,
      sourceBehaviorIds: [...p.traceability.sourceBehaviorIds].sort(),
      sourceStepIds: [...p.traceability.sourceStepIds],
    },
    preconditions: p.preconditions.map((pc) => ({
      description: pc.description,
      ...(pc.seedDataRef !== undefined ? { seedDataRef: pc.seedDataRef } : {}),
    })),
    steps: [...p.steps]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => ({
        id: s.id,
        sequence: s.sequence,
        kind: s.kind,
        description: s.description,
        ...(s.input !== undefined ? { input: s.input } : {}),
        ...(s.expectedObservation !== undefined ? { expectedObservation: s.expectedObservation } : {}),
        sourceStepId: s.sourceStepId,
      })),
    ...(p.expectedInvariantSummary !== undefined
      ? { expectedInvariantSummary: p.expectedInvariantSummary }
      : {}),
    seedDataRef: p.seedDataRef,
    deterministic: true,
  };
}

function normalizeUnexercised(u: UnexercisedBehavior): UnexercisedBehavior {
  return {
    sourceId: u.sourceId,
    sourceName: u.sourceName,
    reason: u.reason,
    explanation: u.explanation,
    confidence: u.confidence,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new EngineError(
      'SCENARIO_DESERIALIZATION_FAILED',
      `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function assertObject(value: unknown, context: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineError(
      'SCENARIO_DESERIALIZATION_FAILED',
      `Expected an object for ${context}, got ${Array.isArray(value) ? 'array' : typeof value}`,
    );
  }
}

function assertSchemaVersion(version: unknown): void {
  if (version !== SCENARIO_SCHEMA_VERSION) {
    throw new EngineError(
      'SCENARIO_DESERIALIZATION_FAILED',
      `Unsupported schema version "${String(version)}". Expected "${SCENARIO_SCHEMA_VERSION}".`,
    );
  }
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function sortBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}
