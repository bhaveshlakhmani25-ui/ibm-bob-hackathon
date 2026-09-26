/**
 * RegressionClassifier — promotes a BehavioralDifference to a Regression
 * when it violates a protected behavior.
 *
 * Owner: Reuben (engine)
 * Phase: 2
 */

import type {
  BehavioralDifference,
  ProtectedBehavior,
  Regression,
  ConfidenceLevel,
} from '../types.js';
import { randomUUID } from 'node:crypto';

/**
 * Classify a behavioral difference as a Regression, or return null if it is not one.
 *
 * A Regression is produced when:
 * - diff.verdict === 'regression'
 * - a matching ProtectedBehavior can be found
 */
export function classify(
  diff: BehavioralDifference,
  protectedBehaviors: ProtectedBehavior[],
): Regression | null {
  if (diff.verdict !== 'regression') return null;

  const behavior = protectedBehaviors.find(
    (pb) => pb.id === diff.scenarioId || diff.diffDetail.summary.toLowerCase().includes(pb.workflowName.toLowerCase()),
  );

  // When no matching protected behavior is found, the comparator should not
  // have emitted verdict: 'regression'. Log a warning and return null.
  if (!behavior) return null;

  return {
    id: randomUUID(),
    behavioralDifferenceId: diff.id,
    protectedBehaviorId: behavior.id,
    severity: confidenceToSeverity(behavior.confidence),
    recommendedAction: buildRecommendation(behavior, diff),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map confidence level to severity.
 * Higher confidence in the protected behavior = higher severity if violated.
 */
function confidenceToSeverity(
  confidence: ConfidenceLevel,
): Regression['severity'] {
  switch (confidence) {
    case 'confirmed':      return 'critical';
    case 'test_derived':   return 'high';
    case 'contract_derived': return 'medium';
    case 'inferred':       return 'low';
  }
}

function buildRecommendation(
  behavior: ProtectedBehavior,
  diff: BehavioralDifference,
): string {
  return (
    `Protected behavior "${behavior.description}" was violated. ` +
    `Diff: ${diff.diffDetail.summary}. ` +
    `Review the change and ensure ${behavior.workflowName} remains correct.`
  );
}
