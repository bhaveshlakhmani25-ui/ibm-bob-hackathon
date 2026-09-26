/**
 * Change Rehearsal — Deterministic ID Generation for Behavior Domain (R03)
 *
 * All IDs in the behavior domain must be:
 *   - Stable: the same logical object always produces the same ID
 *   - Deterministic: no randomness, no timestamps, no UUID v4
 *   - Content-derived: computed from the object's semantic identity fields
 *
 * Strategy: SHA-256 of a canonical JSON representation of the identity fields,
 * truncated to a human-readable hex prefix.
 *
 * This mirrors the approach used by buildChangeId in change/extractor.ts.
 *
 * Owner: Reuben (engine)
 * Phase: R03
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Length of the hex ID prefix (characters, not bytes).
 * 16 hex chars = 64 bits of content-hash identity — collision-resistant
 * for the expected domain sizes (hundreds of journeys/behaviors, not billions).
 */
const ID_HEX_LENGTH = 16;

// ---------------------------------------------------------------------------
// Core hashing primitive
// ---------------------------------------------------------------------------

/**
 * Produce a stable ID by SHA-256 hashing a canonical string representation
 * and taking the first ID_HEX_LENGTH hex characters.
 *
 * @param parts - Ordered array of string values that form the canonical identity.
 *                Each part is trimmed and lower-cased before hashing so that
 *                minor whitespace/casing differences do not produce different IDs.
 */
export function deterministicId(parts: string[]): string {
  const canonical = parts
    .map((p) => p.trim().toLowerCase())
    .join('\x00'); // NUL byte as separator — cannot appear in normal strings
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, ID_HEX_LENGTH);
}

// ---------------------------------------------------------------------------
// Journey ID
// ---------------------------------------------------------------------------

/**
 * Produce a stable ID for a BehaviorJourney.
 *
 * Identity is derived from: name + description + optional entryPoint.
 * The prefix "journey-" makes IDs readable in logs and artifacts.
 */
export function journeyId(
  name: string,
  description: string,
  entryPoint?: string,
): string {
  const parts = [name, description];
  if (entryPoint) parts.push(entryPoint);
  return `journey-${deterministicId(parts)}`;
}

// ---------------------------------------------------------------------------
// Journey Step ID
// ---------------------------------------------------------------------------

/**
 * Produce a stable ID for a BehaviorJourneyStep.
 *
 * Identity is derived from: journeyId + sequence + kind + description.
 * The sequence is included so the same description at different positions
 * produces different step IDs.
 */
export function journeyStepId(
  parentJourneyId: string,
  sequence: number,
  kind: string,
  description: string,
): string {
  const parts = [parentJourneyId, String(sequence), kind, description];
  return `step-${deterministicId(parts)}`;
}

// ---------------------------------------------------------------------------
// Protected Behavior ID
// ---------------------------------------------------------------------------

/**
 * Produce a stable ID for a BehaviorProtectedBehavior.
 *
 * Identity is derived from: description + observable + expectedOutcome.
 * The prefix "behavior-" makes IDs readable in logs and artifacts.
 */
export function protectedBehaviorId(
  description: string,
  observable: string,
  expectedOutcome: string,
): string {
  const parts = [description, observable, expectedOutcome];
  return `behavior-${deterministicId(parts)}`;
}
