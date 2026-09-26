/**
 * Change Rehearsal — Engine Pipeline
 *
 * Top-level orchestrator. Wires all modules together in the correct order.
 * This is the single entry point for the CLI and any future HTTP adapter.
 *
 * Owner: Reuben (engine)
 */

import type {
  RehearsalInput,
  RehearsalResult,
  RehearsalRun,
  RepositoryContext,
  Change,
  IntentCompilerOutput,
  ImpactSet,
  ProtectedBehavior,
  Scenario,
  Observation,
  BehavioralDifference,
  Regression,
  Evidence,
  ServiceMap,
} from './types.js';

// Module imports (all stubs for now — implementations follow in Phase 1 / Phase 2)
// import { loadRepository } from './repository/loader.js';
// import { extractChange } from './change/extractor.js';
// import { compileIntent } from './intent/compiler.js';
// import { analyzeImpact } from './impact/analyzer.js';
// import { resolveProtectedBehaviors } from './behavior/resolver.js';
// import { planScenarios } from './scenario/planner.js';
// import { orchestrate } from './execution/orchestrator.js';
// import { collectObservation } from './execution/collector.js';
// import { compare } from './comparison/comparator.js';
// import { classify } from './comparison/classifier.js';
// import { EvidenceStore } from './store/evidence-store.js';

/**
 * Run a complete change rehearsal.
 *
 * Returns a fully populated RehearsalResult when the pipeline completes.
 * Build/execution failures are captured inside the result (run.baselineBuildStatus,
 * run.candidateBuildStatus, BehavioralDifference.verdict === 'not_exercised') and
 * do NOT cause this function to throw.
 *
 * Throws EngineError if the pipeline itself cannot continue (e.g. git ref not found,
 * repository path invalid).
 *
 * @param input - Validated rehearsal input (repository, change refs, optional requirement)
 */
export async function runRehearsal(
  input: RehearsalInput,
): Promise<RehearsalResult> {
  // Step 1: Load repository
  // const repo: RepositoryContext = await loadRepository(input.repository);

  // Step 2: Extract change (git diff)
  // const change: Change = await extractChange(repo, input.change);

  // Step 3: Compile intent + journeys (LLM or fixture)
  // const intentOutput: IntentCompilerOutput = await compileIntent(
  //   change,
  //   input.requirement,
  //   repo,
  //   input.options,
  // );

  // Step 4: Analyze impact (call graph + service map)
  // const serviceMap: ServiceMap = loadServiceMap(repo);
  // const impact: ImpactSet = await analyzeImpact(
  //   change,
  //   repo,
  //   serviceMap,
  //   intentOutput.journeys,
  // );

  // Step 5: Resolve protected behaviors (merge confirmed/test/contract/inferred)
  // const protectedBehaviors: ProtectedBehavior[] = await resolveProtectedBehaviors(
  //   change,
  //   impact,
  //   intentOutput,
  //   repo,
  // );

  // Step 6: Plan deterministic scenarios
  // const scenarios: Scenario[] = await planScenarios(
  //   intentOutput.journeys,
  //   protectedBehaviors,
  //   impact,
  // );

  // Step 7: Orchestrate execution (baseline + candidate)
  // const { run, rawExecutions } = await orchestrate(
  //   scenarios,
  //   change,
  //   repo,
  //   serviceMap,
  //   input.options ?? {},
  // );

  // Step 8: Collect and normalize observations
  // const observations: Observation[] = rawExecutions.map((raw) =>
  //   collectObservation(run.id, raw),
  // );

  // Step 9: Compare observations and produce behavioral differences
  // const behavioralDifferences: BehavioralDifference[] = scenarios.map((scenario) => {
  //   const baseObs = observations.find(
  //     (o) => o.scenarioId === scenario.id && o.side === 'baseline',
  //   )!;
  //   const candObs = observations.find(
  //     (o) => o.scenarioId === scenario.id && o.side === 'candidate',
  //   )!;
  //   return compare(baseObs, candObs, scenario, intentOutput.requirement, protectedBehaviors);
  // });

  // Step 10: Classify regressions
  // const regressions: Regression[] = behavioralDifferences
  //   .map((diff) => classify(diff, protectedBehaviors))
  //   .filter((r): r is Regression => r !== null);

  // Step 11: Persist evidence
  // const store = new EvidenceStore();
  // const evidence: Evidence[] = await store.persist({ run, change, ... });

  // Step 12: Return complete result to CLI layer
  // return {
  //   run,
  //   change,
  //   requirement: intentOutput.requirement,
  //   journeys: intentOutput.journeys,
  //   protectedBehaviors,
  //   scenarios,
  //   observations,
  //   behavioralDifferences,
  //   regressions,
  //   evidence,
  //   artifactsDir: store.runDir(run.id),
  // };

  throw new Error('runRehearsal: not yet implemented');
}
