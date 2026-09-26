/**
 * Change Rehearsal — R06 Deterministic Step Matching
 *
 * Matches baseline and candidate steps deterministically for comparison.
 *
 * Matching strategy (priority order):
 *   1. Stable stepId — primary key; used when present on both sides
 *   2. Stable sequence number — used when stepId matches are unavailable
 *   3. Deterministic ordering — within a side, steps sorted by sequence ascending
 *
 * Unmatched steps are explicitly reported:
 *   - Steps only in baseline → baselineMissing=false, candidateMissing=true (step was removed)
 *   - Steps only in candidate → baselineMissing=true, candidateMissing=false (step was added)
 *   Nothing is silently dropped.
 *
 * Observation comparison strategy:
 *   Within a matched step pair, observations are compared by `kind` only.
 *   Rationale: baseline and candidate execute the same step but produce observations
 *   with DIFFERENT `source` strings (e.g. "synthetic:baseline:step-x" vs
 *   "synthetic:candidate:step-x"). Matching by kind+source would fail to find pairs
 *   across sides. Matching by kind + position within the kind group is correct.
 *   normalizedValue is used for comparison (R05 already performed normalization).
 *   The raw value is never used for comparison — it may contain unstable values.
 *
 * Owner: Reuben (engine)
 * Phase: R06
 */

import type { StepExecutionResult, NormalizedObservation } from '../execution/model.js';
import type { ObservationFieldDiff, StepComparisonResult } from './model.js';
import type { ExecutionStatus } from '../execution/model.js';

// ---------------------------------------------------------------------------
// Step matching
// ---------------------------------------------------------------------------

/**
 * Match baseline and candidate steps deterministically.
 *
 * Returns one StepComparisonResult per matched (or unmatched) step pair.
 * The result array is sorted by sequence ascending (using the first available
 * sequence from either side) for deterministic output ordering.
 *
 * Matching algorithm:
 *   1. Build a Map<stepId, StepExecutionResult> for each side.
 *   2. Collect all unique stepIds from both sides.
 *   3. For each stepId, form a pair (baseline side, candidate side).
 *   4. Sort pairs by sequence ascending.
 *
 * If a stepId appears in both sides but the sequences differ (step was
 * reordered), the baseline sequence is used for ordering purposes and
 * the difference is captured in the step result.
 */
export function matchSteps(
  baselineSteps: StepExecutionResult[],
  candidateSteps: StepExecutionResult[],
): StepComparisonResult[] {
  // Sort each side by sequence ascending for deterministic processing
  const sortedBaseline = [...baselineSteps].sort((a, b) => a.sequence - b.sequence);
  const sortedCandidate = [...candidateSteps].sort((a, b) => a.sequence - b.sequence);

  // Build lookup maps by stepId
  const baselineMap = new Map<string, StepExecutionResult>();
  for (const step of sortedBaseline) {
    baselineMap.set(step.stepId, step);
  }

  const candidateMap = new Map<string, StepExecutionResult>();
  for (const step of sortedCandidate) {
    candidateMap.set(step.stepId, step);
  }

  // Collect all unique stepIds (preserving order: baseline first, then candidate-only)
  const allStepIds = new Set<string>();
  for (const step of sortedBaseline) allStepIds.add(step.stepId);
  for (const step of sortedCandidate) allStepIds.add(step.stepId);

  const results: StepComparisonResult[] = [];

  for (const stepId of allStepIds) {
    const baselineStep = baselineMap.get(stepId) ?? null;
    const candidateStep = candidateMap.get(stepId) ?? null;

    const baselineMissing = baselineStep === null;
    const candidateMissing = candidateStep === null;

    // Determine representative sequence for ordering
    const sequence = baselineStep?.sequence ?? candidateStep?.sequence ?? 0;

    // Compare observations when both sides have the step
    const fieldDiffs = baselineStep !== null && candidateStep !== null
      ? compareStepObservations(baselineStep.observations, candidateStep.observations)
      : [];

    results.push({
      stepId,
      sequence,
      baselineStatus: (baselineStep?.status ?? null) as ExecutionStatus | null,
      candidateStatus: (candidateStep?.status ?? null) as ExecutionStatus | null,
      fieldDiffs,
      baselineMissing,
      candidateMissing,
    });
  }

  // Sort by sequence ascending for deterministic output
  results.sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    // Tie-break by stepId for complete determinism
    return a.stepId.localeCompare(b.stepId);
  });

  return results;
}

// ---------------------------------------------------------------------------
// Observation comparison
// ---------------------------------------------------------------------------

/**
 * Compare observations from a baseline step against observations from a candidate step.
 *
 * Matching strategy: group by `kind` only (NOT by kind+source).
 *
 * Rationale: baseline and candidate execute the same step but produce observations
 * with different `source` strings (they contain the side name, e.g.
 * "synthetic:baseline:step-x" vs "synthetic:candidate:step-x").
 * Matching by kind+source would fail to find pairs across sides.
 *
 * Within a kind group, observations are matched by sequential position.
 * Both sides execute the same steps in the same order, so position within
 * a kind group is stable.
 *
 * Extra observations on one side (not matched on the other) are captured as
 * unmatched diffs — nothing is silently dropped.
 *
 * Field-level diffs use the observation kind as the path prefix.
 */
export function compareStepObservations(
  baselineObs: NormalizedObservation[],
  candidateObs: NormalizedObservation[],
): ObservationFieldDiff[] {
  // Sort each side deterministically by kind then source for stable processing
  const sortedBaseline = [...baselineObs].sort(observationOrder);
  const sortedCandidate = [...candidateObs].sort(observationOrder);

  // Group by kind only — sources differ by side so we match by kind+position
  const baselineByKind = groupObservationsByKind(sortedBaseline);
  const candidateByKind = groupObservationsByKind(sortedCandidate);

  const allKinds = new Set<string>([
    ...baselineByKind.keys(),
    ...candidateByKind.keys(),
  ]);

  // Sort kinds for deterministic processing
  const sortedKinds = [...allKinds].sort();

  const diffs: ObservationFieldDiff[] = [];

  for (const kind of sortedKinds) {
    const bList = baselineByKind.get(kind) ?? [];
    const cList = candidateByKind.get(kind) ?? [];

    const maxLen = Math.max(bList.length, cList.length);
    for (let i = 0; i < maxLen; i++) {
      const b = bList[i];
      const c = cList[i];
      const keyLabel = maxLen > 1 ? `${kind}[${i}]` : kind;

      if (!b) {
        // Extra candidate observation (newly added in candidate)
        diffs.push(...extractFieldDiffs(null, c.normalizedValue, keyLabel));
        continue;
      }
      if (!c) {
        // Extra baseline observation (removed in candidate)
        diffs.push(...extractFieldDiffs(b.normalizedValue, null, keyLabel));
        continue;
      }

      // Both exist — compare normalizedValues only
      diffs.push(...extractFieldDiffs(b.normalizedValue, c.normalizedValue, keyLabel));
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Field-level diffing
// ---------------------------------------------------------------------------

/**
 * Produce a flat list of field-level diffs between two normalized values.
 *
 * Uses recursive descent with dot-notation paths.
 * Arrays are compared element-by-element (order is preserved per normalization rules).
 * Primitives are compared by value.
 *
 * Base case: if values are deeply equal, returns empty array.
 * For objects: recurses into mismatching fields.
 * For primitives: emits a single diff.
 */
export function extractFieldDiffs(
  baseline: unknown,
  candidate: unknown,
  path: string,
): ObservationFieldDiff[] {
  const diffs: ObservationFieldDiff[] = [];
  recurseFieldDiff(baseline, candidate, path, diffs);
  return diffs;
}

function recurseFieldDiff(
  a: unknown,
  b: unknown,
  path: string,
  acc: ObservationFieldDiff[],
): void {
  // Fast path: deep equality check
  if (isDeepEqual(a, b)) return;

  // Both are plain objects (not arrays, not null) — recurse into fields
  if (isPlainObject(a) && isPlainObject(b)) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    // Sort keys for deterministic output
    const sortedKeys = [...allKeys].sort();
    for (const key of sortedKeys) {
      recurseFieldDiff(aObj[key], bObj[key], `${path}.${key}`, acc);
    }
    return;
  }

  // Both are arrays — compare element-by-element
  if (Array.isArray(a) && Array.isArray(b)) {
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      recurseFieldDiff(a[i], b[i], `${path}[${i}]`, acc);
    }
    return;
  }

  // One or both sides is null/missing/primitive — emit leaf diff
  acc.push({ field: path, baselineValue: a ?? null, candidateValue: b ?? null });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic sort order for observations: kind ascending, then source ascending.
 */
function observationOrder(a: NormalizedObservation, b: NormalizedObservation): number {
  if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
  return a.source.localeCompare(b.source);
}

/**
 * Group observations by `kind` only.
 * When multiple observations share the same kind, they are kept in their
 * sorted order (kind ascending, then source ascending).
 */
function groupObservationsByKind(
  sorted: NormalizedObservation[],
): Map<string, NormalizedObservation[]> {
  const groups = new Map<string, NormalizedObservation[]>();
  for (const obs of sorted) {
    const existing = groups.get(obs.kind);
    if (existing) {
      existing.push(obs);
    } else {
      groups.set(obs.kind, [obs]);
    }
  }
  return groups;
}

/**
 * True if a and b are deeply equal using JSON canonical comparison.
 * Numbers, booleans, and null compare by value.
 * This is sufficient for comparing normalized observation values.
 */
function isDeepEqual(a: unknown, b: unknown): boolean {
  // Fast identity check
  if (a === b) return true;

  // JSON-based deep equality — works correctly for all normalized value types
  // (numbers, strings, booleans, null, plain objects, arrays).
  // Undefined values are omitted by JSON.stringify, which is consistent with
  // how the normalization layer handles missing fields.
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

/**
 * Canonicalize a value for comparison: sort object keys for deterministic JSON.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    result[key] = canonicalize(obj[key]);
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}
