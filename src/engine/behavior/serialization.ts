/**
 * Change Rehearsal — Behavior Domain Serialization (R03)
 *
 * Deterministic serialization and deserialization for the behavior domain model.
 *
 * Requirements:
 * - Stable field structure: field order is normalized on serialize
 * - Stable collection ordering: arrays sorted by id ascending before serialization
 * - Round-trip fidelity: deserialize(serialize(x)) deep-equals x
 * - Invalid input → typed EngineError (BEHAVIOR_DESERIALIZATION_FAILED), never an unhandled throw
 * - No randomness, no timestamps injected during serialization
 *
 * Serialized format is plain JSON; the envelope carries a schema version so
 * future format changes can be detected.
 *
 * Owner: Reuben (engine)
 * Phase: R03
 */

import type { BehaviorJourney, BehaviorProtectedBehavior } from './model.js';
import { validateJourney, validateProtectedBehavior } from './validation.js';
import { EngineError } from '../errors.js';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Increment when the serialized format changes in a breaking way. */
export const BEHAVIOR_SCHEMA_VERSION = '1.0';

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

export interface SerializedJourney {
  schemaVersion: string;
  journey: BehaviorJourney;
}

export interface SerializedProtectedBehavior {
  schemaVersion: string;
  behavior: BehaviorProtectedBehavior;
}

export interface SerializedBehaviorRegistry {
  schemaVersion: string;
  journeys: BehaviorJourney[];
  behaviors: BehaviorProtectedBehavior[];
}

// ---------------------------------------------------------------------------
// Journey serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a single BehaviorJourney to a deterministic JSON string.
 * Steps are sorted by sequence before serialization.
 */
export function serializeJourney(journey: BehaviorJourney): string {
  const normalized = normalizeJourney(journey);
  const envelope: SerializedJourney = {
    schemaVersion: BEHAVIOR_SCHEMA_VERSION,
    journey: normalized,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a BehaviorJourney from a JSON string.
 *
 * @throws EngineError('BEHAVIOR_DESERIALIZATION_FAILED') if:
 *   - input is not valid JSON
 *   - envelope structure is wrong
 *   - schema version is unrecognized
 *   - the journey payload fails validation
 */
export function deserializeJourney(raw: string): BehaviorJourney {
  const parsed = safeParse(raw);
  assertObject(parsed, 'journey envelope');

  const envelope = parsed as Record<string, unknown>;
  assertSchemaVersion(envelope['schemaVersion']);

  const result = validateJourney(envelope['journey']);
  if (!result.valid) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      `Deserialized journey failed validation: ${result.errors.join('; ')}`,
    );
  }

  return envelope['journey'] as BehaviorJourney;
}

// ---------------------------------------------------------------------------
// ProtectedBehavior serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a single BehaviorProtectedBehavior to a deterministic JSON string.
 * relatedJourneyIds are sorted before serialization.
 */
export function serializeProtectedBehavior(behavior: BehaviorProtectedBehavior): string {
  const normalized = normalizeBehavior(behavior);
  const envelope: SerializedProtectedBehavior = {
    schemaVersion: BEHAVIOR_SCHEMA_VERSION,
    behavior: normalized,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a BehaviorProtectedBehavior from a JSON string.
 *
 * @throws EngineError('BEHAVIOR_DESERIALIZATION_FAILED') on any parse or validation failure
 */
export function deserializeProtectedBehavior(raw: string): BehaviorProtectedBehavior {
  const parsed = safeParse(raw);
  assertObject(parsed, 'protected behavior envelope');

  const envelope = parsed as Record<string, unknown>;
  assertSchemaVersion(envelope['schemaVersion']);

  const result = validateProtectedBehavior(envelope['behavior']);
  if (!result.valid) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      `Deserialized protected behavior failed validation: ${result.errors.join('; ')}`,
    );
  }

  return envelope['behavior'] as BehaviorProtectedBehavior;
}

// ---------------------------------------------------------------------------
// Registry serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a registry snapshot to a deterministic JSON string.
 * Both arrays are sorted by id ascending.
 */
export function serializeRegistry(snapshot: {
  journeys: BehaviorJourney[];
  behaviors: BehaviorProtectedBehavior[];
}): string {
  const envelope: SerializedBehaviorRegistry = {
    schemaVersion: BEHAVIOR_SCHEMA_VERSION,
    journeys: sortById(snapshot.journeys).map(normalizeJourney),
    behaviors: sortById(snapshot.behaviors).map(normalizeBehavior),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a registry snapshot from a JSON string.
 * Validates each journey and behavior individually.
 *
 * @throws EngineError('BEHAVIOR_DESERIALIZATION_FAILED') on any parse or validation failure
 */
export function deserializeRegistry(raw: string): {
  journeys: BehaviorJourney[];
  behaviors: BehaviorProtectedBehavior[];
} {
  const parsed = safeParse(raw);
  assertObject(parsed, 'registry envelope');

  const envelope = parsed as Record<string, unknown>;
  assertSchemaVersion(envelope['schemaVersion']);

  if (!Array.isArray(envelope['journeys'])) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      'Registry envelope must contain a "journeys" array',
    );
  }

  if (!Array.isArray(envelope['behaviors'])) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      'Registry envelope must contain a "behaviors" array',
    );
  }

  const journeys: BehaviorJourney[] = [];
  for (let i = 0; i < (envelope['journeys'] as unknown[]).length; i++) {
    const result = validateJourney((envelope['journeys'] as unknown[])[i]);
    if (!result.valid) {
      throw new EngineError(
        'BEHAVIOR_DESERIALIZATION_FAILED',
        `journeys[${i}] failed validation: ${result.errors.join('; ')}`,
      );
    }
    journeys.push((envelope['journeys'] as unknown[])[i] as BehaviorJourney);
  }

  const behaviors: BehaviorProtectedBehavior[] = [];
  for (let i = 0; i < (envelope['behaviors'] as unknown[]).length; i++) {
    const result = validateProtectedBehavior((envelope['behaviors'] as unknown[])[i]);
    if (!result.valid) {
      throw new EngineError(
        'BEHAVIOR_DESERIALIZATION_FAILED',
        `behaviors[${i}] failed validation: ${result.errors.join('; ')}`,
      );
    }
    behaviors.push((envelope['behaviors'] as unknown[])[i] as BehaviorProtectedBehavior);
  }

  return { journeys, behaviors };
}

// ---------------------------------------------------------------------------
// Normalization helpers (stable field order + sorted collections)
// ---------------------------------------------------------------------------

function normalizeJourney(j: BehaviorJourney): BehaviorJourney {
  return {
    id: j.id,
    name: j.name,
    description: j.description,
    ...(j.entryPoint !== undefined ? { entryPoint: j.entryPoint } : {}),
    steps: [...j.steps].sort((a, b) => a.sequence - b.sequence).map((s) => ({
      id: s.id,
      sequence: s.sequence,
      kind: s.kind,
      description: s.description,
      ...(s.input !== undefined ? { input: s.input } : {}),
      ...(s.expectedHint !== undefined ? { expectedHint: s.expectedHint } : {}),
    })),
    ...(j.tags !== undefined ? { tags: [...j.tags].sort() } : {}),
    ...(j.affectedAreas !== undefined ? { affectedAreas: [...j.affectedAreas].sort() } : {}),
    provenance: normalizeProvenance(j.provenance),
    confidence: j.confidence,
  };
}

function normalizeBehavior(b: BehaviorProtectedBehavior): BehaviorProtectedBehavior {
  return {
    id: b.id,
    description: b.description,
    observable: b.observable,
    expectedOutcome: b.expectedOutcome,
    provenance: normalizeProvenance(b.provenance),
    confidence: b.confidence,
    relatedJourneyIds: [...b.relatedJourneyIds].sort(),
    ...(b.severity !== undefined ? { severity: b.severity } : {}),
  };
}

function normalizeProvenance(p: BehaviorJourney['provenance'] | BehaviorProtectedBehavior['provenance']) {
  return {
    confidence: p.confidence,
    ...(p.sourceRef !== undefined ? { sourceRef: p.sourceRef } : {}),
    ...(p.sourceKind !== undefined ? { sourceKind: p.sourceKind } : {}),
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
      'BEHAVIOR_DESERIALIZATION_FAILED',
      `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function assertObject(value: unknown, context: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      `Expected an object for ${context}, got ${Array.isArray(value) ? 'array' : typeof value}`,
    );
  }
}

function assertSchemaVersion(version: unknown): void {
  if (version !== BEHAVIOR_SCHEMA_VERSION) {
    throw new EngineError(
      'BEHAVIOR_DESERIALIZATION_FAILED',
      `Unsupported schema version "${String(version)}". Expected "${BEHAVIOR_SCHEMA_VERSION}".`,
    );
  }
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}
