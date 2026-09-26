/**
 * BehavioralComparator — compares baseline and candidate observations and
 * produces a typed BehavioralDifference per scenario.
 *
 * Owner: Reuben (engine)
 * Phase: 2
 *
 * This is PURELY STRUCTURAL — no LLM involvement.
 * Verdicts are derived by deep-comparing normalized outputs.
 */

import type {
  Observation,
  Scenario,
  Requirement,
  ProtectedBehavior,
  BehavioralDifference,
  NormalizedStepOutput,
  StepDiff,
  Verdict,
} from '../types.js';
import { randomUUID } from 'node:crypto';

/**
 * Compare one baseline observation against one candidate observation for the same scenario.
 *
 * Verdict logic:
 * 1. If normalizedOutputs are deeply equal → 'unchanged'
 * 2. If different AND the difference matches requirement.expectedChanges → 'changed' (isExpected: true)
 * 3. If different AND the affected field is covered by a ProtectedBehavior → 'regression'
 * 4. Otherwise → 'changed' (isExpected: false)
 */
export function compare(
  baseline: Observation,
  candidate: Observation,
  scenario: Scenario,
  requirement: Requirement | undefined,
  protectedBehaviors: ProtectedBehavior[],
): BehavioralDifference {
  const stepDiffs = diffSteps(
    baseline.normalizedOutput.steps,
    candidate.normalizedOutput.steps,
  );

  if (stepDiffs.length === 0) {
    return makeDiff(scenario, 'unchanged', stepDiffs, false, 'Behavior preserved.');
  }

  const summary = stepDiffs
    .map((d) => `${d.field}: baseline=${JSON.stringify(d.baseline)} candidate=${JSON.stringify(d.candidate)}`)
    .join('; ');

  // Check if the difference is expected per the requirement
  if (requirement && isExpectedByRequirement(stepDiffs, requirement)) {
    return makeDiff(scenario, 'changed', stepDiffs, true, `Expected change: ${summary}`);
  }

  // Check if any diff field is covered by a protected behavior
  const affectsProtected = protectedBehaviors.some((pb) =>
    isCoveredByBehavior(scenario, pb),
  );

  if (affectsProtected) {
    return makeDiff(scenario, 'regression', stepDiffs, false, `Regression: ${summary}`);
  }

  return makeDiff(scenario, 'changed', stepDiffs, false, `Unexpected change: ${summary}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDiff(
  scenario: Scenario,
  verdict: Verdict,
  stepDiffs: StepDiff[],
  isExpected: boolean,
  summary: string,
): BehavioralDifference {
  return {
    id: randomUUID(),
    scenarioId: scenario.id,
    journeyId: scenario.journeyId,
    verdict,
    diffDetail: { stepDiffs, summary },
    isExpected,
  };
}

function diffSteps(
  baselineSteps: NormalizedStepOutput[],
  candidateSteps: NormalizedStepOutput[],
): StepDiff[] {
  const diffs: StepDiff[] = [];

  const maxLen = Math.max(baselineSteps.length, candidateSteps.length);
  for (let i = 0; i < maxLen; i++) {
    const b = baselineSteps[i];
    const c = candidateSteps[i];

    if (!b || !c) {
      diffs.push({
        stepId: b?.stepId ?? c?.stepId ?? `step-${i}`,
        field: 'step',
        baseline: b ?? null,
        candidate: c ?? null,
      });
      continue;
    }

    // HTTP status
    if (b.httpStatus !== c.httpStatus) {
      diffs.push({ stepId: b.stepId, field: 'httpStatus', baseline: b.httpStatus, candidate: c.httpStatus });
    }

    // HTTP body (deep compare via JSON round-trip)
    const bBody = JSON.stringify(b.httpBody);
    const cBody = JSON.stringify(c.httpBody);
    if (bBody !== cBody) {
      // Collect field-level diffs within the body
      const bodyDiffs = flatDiffObjects(b.httpBody, c.httpBody, 'body');
      diffs.push(...bodyDiffs.map((d) => ({ stepId: b.stepId, ...d })));
    }

    // DB snapshot
    const bDb = JSON.stringify(b.dbSnapshot);
    const cDb = JSON.stringify(c.dbSnapshot);
    if (bDb !== cDb) {
      const dbDiffs = flatDiffObjects(b.dbSnapshot, c.dbSnapshot, 'db');
      diffs.push(...dbDiffs.map((d) => ({ stepId: b.stepId, ...d })));
    }
  }

  return diffs;
}

/**
 * Flatten two objects and emit a diff entry for each field that differs.
 * Uses dot-notation paths (e.g. "body.stock").
 */
function flatDiffObjects(
  baseline: unknown,
  candidate: unknown,
  prefix: string,
): Omit<StepDiff, 'stepId'>[] {
  const diffs: Omit<StepDiff, 'stepId'>[] = [];
  flatDiff(baseline, candidate, prefix, diffs);
  return diffs;
}

function flatDiff(
  a: unknown,
  b: unknown,
  path: string,
  acc: Omit<StepDiff, 'stepId'>[],
): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;

  if (
    typeof a === 'object' && a !== null &&
    typeof b === 'object' && b !== null &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const keys = new Set([
      ...Object.keys(a as object),
      ...Object.keys(b as object),
    ]);
    for (const key of keys) {
      flatDiff(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}.${key}`,
        acc,
      );
    }
    return;
  }

  acc.push({ field: path, baseline: a, candidate: b });
}

/**
 * True if the step diffs can be attributed to the expected changes in the requirement.
 * MVP: naive keyword match against requirement.expectedChanges strings.
 */
function isExpectedByRequirement(
  diffs: StepDiff[],
  requirement: Requirement,
): boolean {
  if (requirement.expectedChanges.length === 0) return false;
  return diffs.every((diff) =>
    requirement.expectedChanges.some(
      (expected) =>
        diff.field.toLowerCase().includes(expected.toLowerCase()) ||
        expected.toLowerCase().includes(diff.field.toLowerCase()),
    ),
  );
}

/**
 * True if the scenario is directly associated with the protected behavior.
 */
function isCoveredByBehavior(
  scenario: Scenario,
  behavior: ProtectedBehavior,
): boolean {
  return scenario.protectedBehaviorId === behavior.id;
}
