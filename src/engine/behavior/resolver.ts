/**
 * ProtectedBehaviorResolver — merges protected behaviors from all sources,
 * enforcing the confidence ordering.
 *
 * Owner: Reuben (engine)
 * Phase: 1
 *
 * Confidence ordering (highest to lowest):
 *   confirmed > test_derived > contract_derived > inferred
 *
 * Invariant: no downstream module may upgrade a behavior's confidence level
 * without an explicit developer action (e.g. marking it in change-rehearsal.yaml).
 */

import type {
  Change,
  ImpactSet,
  IntentCompilerOutput,
  RepositoryContext,
  ProtectedBehavior,
  ConfidenceLevel,
} from '../types.js';

/**
 * Produce the final merged set of ProtectedBehavior records for this change.
 *
 * Sources (merged in priority order):
 * 1. confirmed   — developer-declared in change-rehearsal.yaml
 * 2. test_derived — inferred from existing test file names / describe blocks
 * 3. contract_derived — inferred from OpenAPI/JSON Schema contracts in the repo
 * 4. inferred    — from the IntentJourneyCompiler (LLM or fixture)
 *
 * When two sources describe the same workflowName, the higher-confidence source wins.
 */
export async function resolveProtectedBehaviors(
  change: Change,
  impact: ImpactSet,
  intentOutput: IntentCompilerOutput,
  repo: RepositoryContext,
): Promise<ProtectedBehavior[]> {
  // TODO (Phase 1):
  // 1. loadConfirmedBehaviors(repo)     → source: 'confirmed'
  // 2. deriveFromTests(repo, impact)    → source: 'test_derived'
  // 3. deriveFromContracts(repo, impact)→ source: 'contract_derived'
  // 4. intentOutput.protectedBehaviors  → source: 'inferred' (already tagged)
  // 5. Merge: dedup by workflowName, keep highest-confidence entry
  // 6. Return merged ProtectedBehavior[]

  // For Phase 1 demo: return the inferred behaviors from the compiler as-is
  return intentOutput.protectedBehaviors;
}

/**
 * Confidence levels ordered highest-first for deduplication logic.
 */
export const CONFIDENCE_ORDER: ConfidenceLevel[] = [
  'confirmed',
  'test_derived',
  'contract_derived',
  'inferred',
];

export function isHigherConfidence(a: ConfidenceLevel, b: ConfidenceLevel): boolean {
  return CONFIDENCE_ORDER.indexOf(a) < CONFIDENCE_ORDER.indexOf(b);
}
