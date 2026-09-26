/**
 * RehearsalOrchestrator — coordinates baseline and candidate execution.
 *
 * Owner: Reuben (engine)
 * Phase: 2
 *
 * Execution model (MVP):
 * - Uses child_process.spawn to start services (no Docker required)
 * - Applies seed data before each scenario via POST /test/seed
 * - Runs scenarios sequentially (never in parallel) to guarantee determinism
 * - Enforces per-scenario timeout via AbortController
 *
 * Build failures (service won't start) are recorded in the RehearsalRun record
 * and do NOT throw. All scenarios for that side are marked 'not_exercised'.
 */

import type {
  Scenario,
  Change,
  RepositoryContext,
  ServiceMap,
  RehearsalOptions,
  RehearsalRun,
  RawExecution,
} from '../types.js';
import { EngineError } from '../errors.js';
import { randomUUID } from 'node:crypto';

export interface OrchestratorResult {
  run: RehearsalRun;
  rawExecutions: RawExecution[];
}

/**
 * Run all scenarios against both baseline and candidate.
 *
 * When scopedScenarioIds is provided (repair loop), only those scenarios are executed.
 *
 * @throws EngineError('SERVICE_START_FAILED') only when BOTH sides fail to start
 */
export async function orchestrate(
  scenarios: Scenario[],
  change: Change,
  repo: RepositoryContext,
  serviceMap: ServiceMap,
  options: RehearsalOptions,
): Promise<OrchestratorResult> {
  const runId = randomUUID();
  const now = new Date().toISOString();

  const run: RehearsalRun = {
    id: runId,
    changeId: change.id,
    startedAt: now,
    status: 'running',
    baselineBuildStatus: 'pending',
    candidateBuildStatus: 'pending',
  };

  // TODO (Phase 2):
  // 1. Filter scenarios by scopedScenarioIds if provided
  // 2. Start baseline service at change.baseRef
  //    - git worktree add <tmpDir> <baseRef>
  //    - cd <tmpDir>; <serviceMap.services[name].startCommand>
  //    - poll <serviceMap.services[name].healthCheck> until 2xx or timeout
  //    - record run.baselineBuildStatus
  // 3. For each scenario:
  //    - POST <baselineBaseUrl>/test/seed  with fixture data
  //    - Execute each step with AbortController timeout
  //    - Collect RawStepResult[]
  //    - Record RawExecution { side: 'baseline', ... }
  // 4. Stop baseline service; clean up worktree
  // 5. Repeat steps 2–4 for candidate at change.candidateRef
  // 6. Update run.status = 'completed', run.completedAt
  // 7. Return { run, rawExecutions }

  throw new EngineError('SERVICE_START_FAILED', 'orchestrate: not yet implemented');
}
