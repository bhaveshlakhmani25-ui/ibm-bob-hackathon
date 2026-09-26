/**
 * IntentJourneyCompiler — converts a requirement + diff into journeys and protected behaviors.
 *
 * Owner: Reuben (engine)
 * Phase: 1
 *
 * Principle: AI proposes; deterministic execution verifies.
 * The LLM may reason about journeys, but its output is always validated against
 * the schema before any downstream module consumes it.
 * All LLM-derived behaviors are tagged confidence: 'inferred'.
 */

import type {
  Change,
  RequirementInput,
  RepositoryContext,
  RehearsalOptions,
  IntentCompilerOutput,
} from '../types.js';
import { EngineError } from '../errors.js';

/**
 * Compile a requirement + diff into:
 * - a structured Requirement with expectedChanges
 * - Journey[] with JourneyStep[]
 * - ProtectedBehavior[] (source: 'inferred' for LLM output)
 * - expectedChangeSummary for the report
 *
 * When options.deterministicMode is true (or no LLM key is available),
 * returns fixture-based journeys from fixtures/shopflow/journeys.json.
 *
 * @throws EngineError('INTENT_COMPILER_FAILED') if LLM call fails and no fixture fallback exists
 * @throws EngineError('LLM_RESPONSE_INVALID') if LLM returns a response that fails schema validation
 * @throws EngineError('FIXTURE_NOT_FOUND') if deterministicMode is true and no fixture exists
 */
export async function compileIntent(
  change: Change,
  requirement: RequirementInput | undefined,
  repo: RepositoryContext,
  options?: RehearsalOptions,
): Promise<IntentCompilerOutput> {
  // TODO (Phase 1):
  // if (options?.deterministicMode || !process.env.CR_LLM_API_KEY) {
  //   return loadFixtureJourneys(change);
  // }
  //
  // const prompt = buildPrompt(change, requirement, repo);
  // const raw = await callLLM(prompt);
  // const parsed = parseAndValidate(raw);  // throws LLM_RESPONSE_INVALID on bad schema
  // return parsed;
  throw new EngineError('INTENT_COMPILER_FAILED', 'compileIntent: not yet implemented');
}
