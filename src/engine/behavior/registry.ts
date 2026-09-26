/**
 * Change Rehearsal — Behavior Registry (R03)
 *
 * A lightweight, deterministic in-memory store for BehaviorJourney and
 * BehaviorProtectedBehavior records.
 *
 * Design principles:
 * - No database, no I/O
 * - Deterministic: same operations in the same order produce the same state
 * - All list operations return stable sorted arrays (sorted by id ascending)
 *   so iteration order is predictable regardless of insertion order
 * - Validation on write: invalid objects are rejected with a typed EngineError
 * - Duplicate IDs are rejected with BEHAVIOR_DUPLICATE_ID
 * - References to unknown journey/behavior IDs are rejected with BEHAVIOR_UNKNOWN_REFERENCE
 *   when explicitly validated (e.g. findJourneysForBehavior)
 *
 * Owner: Reuben (engine)
 * Phase: R03
 */

import type { BehaviorJourney, BehaviorProtectedBehavior } from './model.js';
import { validateJourney, validateProtectedBehavior } from './validation.js';
import { EngineError } from '../errors.js';

// ---------------------------------------------------------------------------
// BehaviorRegistry
// ---------------------------------------------------------------------------

export class BehaviorRegistry {
  private readonly journeys = new Map<string, BehaviorJourney>();
  private readonly behaviors = new Map<string, BehaviorProtectedBehavior>();

  // -------------------------------------------------------------------------
  // Journey operations
  // -------------------------------------------------------------------------

  /**
   * Register a journey.
   *
   * @throws EngineError('BEHAVIOR_INVALID')       if the journey fails validation
   * @throws EngineError('BEHAVIOR_DUPLICATE_ID')  if a journey with the same id is already registered
   */
  registerJourney(journey: BehaviorJourney): void {
    const result = validateJourney(journey);
    if (!result.valid) {
      throw new EngineError(
        'BEHAVIOR_INVALID',
        `Journey validation failed: ${result.errors.join('; ')}`,
      );
    }

    if (this.journeys.has(journey.id)) {
      throw new EngineError(
        'BEHAVIOR_DUPLICATE_ID',
        `A journey with id "${journey.id}" is already registered`,
      );
    }

    this.journeys.set(journey.id, journey);
  }

  /**
   * Retrieve a journey by id.
   * Returns undefined if not found (does not throw — callers decide).
   */
  getJourney(id: string): BehaviorJourney | undefined {
    return this.journeys.get(id);
  }

  /**
   * Return all registered journeys, sorted by id ascending.
   */
  listJourneys(): BehaviorJourney[] {
    return sortById([...this.journeys.values()]);
  }

  /**
   * Find journeys that list the given area in their affectedAreas.
   * Comparison is case-sensitive.
   * Returns a stable sorted array.
   */
  findJourneysForArea(area: string): BehaviorJourney[] {
    return sortById(
      [...this.journeys.values()].filter(
        (j) => j.affectedAreas?.includes(area) ?? false,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // ProtectedBehavior operations
  // -------------------------------------------------------------------------

  /**
   * Register a protected behavior.
   *
   * @throws EngineError('BEHAVIOR_INVALID')       if the behavior fails validation
   * @throws EngineError('BEHAVIOR_DUPLICATE_ID')  if a behavior with the same id is already registered
   */
  registerProtectedBehavior(behavior: BehaviorProtectedBehavior): void {
    const result = validateProtectedBehavior(behavior);
    if (!result.valid) {
      throw new EngineError(
        'BEHAVIOR_INVALID',
        `ProtectedBehavior validation failed: ${result.errors.join('; ')}`,
      );
    }

    if (this.behaviors.has(behavior.id)) {
      throw new EngineError(
        'BEHAVIOR_DUPLICATE_ID',
        `A protected behavior with id "${behavior.id}" is already registered`,
      );
    }

    this.behaviors.set(behavior.id, behavior);
  }

  /**
   * Retrieve a protected behavior by id.
   * Returns undefined if not found.
   */
  getProtectedBehavior(id: string): BehaviorProtectedBehavior | undefined {
    return this.behaviors.get(id);
  }

  /**
   * Return all registered protected behaviors, sorted by id ascending.
   */
  listProtectedBehaviors(): BehaviorProtectedBehavior[] {
    return sortById([...this.behaviors.values()]);
  }

  // -------------------------------------------------------------------------
  // Relationship queries
  // -------------------------------------------------------------------------

  /**
   * Find all protected behaviors whose relatedJourneyIds includes the given journeyId.
   *
   * Does NOT require the journey to be registered — this allows behaviors to reference
   * journeys that were registered externally. Use findJourneysForBehavior when you
   * need strict reference validation.
   *
   * Returns a stable sorted array.
   */
  findBehaviorsForJourney(journeyId: string): BehaviorProtectedBehavior[] {
    return sortById(
      [...this.behaviors.values()].filter(
        (b) => b.relatedJourneyIds.includes(journeyId),
      ),
    );
  }

  /**
   * Find all journeys whose id appears in the given behavior's relatedJourneyIds.
   *
   * @throws EngineError('BEHAVIOR_UNKNOWN_REFERENCE') if the behavior id is not registered
   * @throws EngineError('BEHAVIOR_UNKNOWN_REFERENCE') if any relatedJourneyId is not registered
   *
   * Returns a stable sorted array.
   */
  findJourneysForBehavior(behaviorId: string): BehaviorJourney[] {
    const behavior = this.behaviors.get(behaviorId);
    if (!behavior) {
      throw new EngineError(
        'BEHAVIOR_UNKNOWN_REFERENCE',
        `No protected behavior with id "${behaviorId}" is registered`,
      );
    }

    const missing = behavior.relatedJourneyIds.filter((jid) => !this.journeys.has(jid));
    if (missing.length > 0) {
      throw new EngineError(
        'BEHAVIOR_UNKNOWN_REFERENCE',
        `Protected behavior "${behaviorId}" references unknown journey id(s): ${missing.join(', ')}`,
      );
    }

    return sortById(
      behavior.relatedJourneyIds.map((jid) => this.journeys.get(jid)!),
    );
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  /** Return the number of registered journeys */
  journeyCount(): number {
    return this.journeys.size;
  }

  /** Return the number of registered protected behaviors */
  behaviorCount(): number {
    return this.behaviors.size;
  }

  /**
   * Produce a plain-object snapshot of the registry for serialization.
   * Journeys and behaviors are sorted by id ascending.
   */
  snapshot(): { journeys: BehaviorJourney[]; behaviors: BehaviorProtectedBehavior[] } {
    return {
      journeys: this.listJourneys(),
      behaviors: this.listProtectedBehaviors(),
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}
