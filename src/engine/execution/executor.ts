/**
 * Change Rehearsal — R05 Rehearsal Executor
 *
 * The RehearsalExecutor takes a ScenarioPlan and executes it against an
 * ExecutionTarget (baseline or candidate) by running each step sequentially
 * through an ExecutionAdapter.
 *
 * EXECUTOR INVARIANTS:
 *   - Steps are executed in ascending sequence order (deterministic)
 *   - Partial evidence is preserved: if step N fails, results for steps 1..N-1
 *     are still returned in the ScenarioExecutionResult
 *   - Execution status != behavioral verdict (no 'regression' status here)
 *   - No LLM calls, no network calls (those are in the adapter layer)
 *   - Run IDs are runtime-generated (randomUUID) — not domain identity fields
 *   - Timeout is enforced via Promise.race on each step
 *
 * R06 INTERFACE:
 *   The primary output is PairedExecutionResult, which bundles baseline +
 *   candidate ScenarioExecutionResults for one scenario. R06 consumes this.
 *
 * Owner: Reuben (engine)
 * Phase: R05
 */

import { randomUUID } from 'node:crypto';
import type { ScenarioPlan, ScenarioPlanStep } from '../scenario/model.js';
import type {
  ExecutionTarget,
  ScenarioExecutionResult,
  StepExecutionResult,
  ExecutionStatus,
  PairedExecutionResult,
  RunMetadata,
} from './model.js';
import type { ExecutionAdapter, AdapterContext } from './adapter.js';
import { validateExecutionTarget, validateScenarioPlan } from './validation.js';

// ---------------------------------------------------------------------------
// RehearsalExecutor configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a RehearsalExecutor instance.
 */
export interface RehearsalExecutorConfig {
  /**
   * Maximum milliseconds allowed per step.
   * Default: 30_000 (30 seconds).
   */
  stepTimeoutMs?: number;
  /**
   * The execution adapter to use.
   * Must be set — the executor has no default adapter.
   */
  adapter: ExecutionAdapter;
}

// ---------------------------------------------------------------------------
// RehearsalExecutor
// ---------------------------------------------------------------------------

/**
 * Executes a ScenarioPlan against an ExecutionTarget and produces a
 * ScenarioExecutionResult.
 *
 * The executor is intentionally stateless across runs: each call to
 * executeScenario() is independent and produces a fresh result.
 */
export class RehearsalExecutor {
  private readonly stepTimeoutMs: number;
  private readonly adapter: ExecutionAdapter;

  constructor(config: RehearsalExecutorConfig) {
    this.adapter = config.adapter;
    this.stepTimeoutMs = config.stepTimeoutMs ?? 30_000;
  }

  /**
   * Execute a ScenarioPlan against a single ExecutionTarget.
   *
   * Steps are executed sequentially in ascending sequence order.
   * If a step returns status 'blocked', 'timed_out', or 'error', remaining
   * steps are skipped (they cannot meaningfully run after infrastructure failure).
   * If a step returns status 'failed' (application-level), remaining steps
   * still execute — an application failure does not abort the scenario.
   *
   * @param plan - The scenario plan to execute
   * @param target - The execution target (baseline or candidate)
   * @param rehearsalRunId - Parent run ID for metadata traceability
   * @returns A complete ScenarioExecutionResult with all step results
   */
  async executeScenario(
    plan: ScenarioPlan,
    target: ExecutionTarget,
    rehearsalRunId: string,
  ): Promise<ScenarioExecutionResult> {
    validateExecutionTarget(target);
    validateScenarioPlan(plan);

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    // Sort steps by sequence ascending for deterministic execution order
    const orderedSteps = [...plan.steps].sort((a, b) => a.sequence - b.sequence);

    const stepResults: StepExecutionResult[] = [];
    let infrastructureAbort = false;
    let stepsAttemptedCount = 0;

    for (const step of orderedSteps) {
      // If an infrastructure failure occurred on a previous step, skip remaining steps
      if (infrastructureAbort) {
        stepResults.push(makeSkippedStep(step));
        continue;
      }

      stepsAttemptedCount++;

      const stepResult = await this.executeStep(step, target);
      stepResults.push(stepResult);

      // Infrastructure failures abort remaining steps
      if (
        stepResult.status === 'blocked' ||
        stepResult.status === 'timed_out' ||
        stepResult.status === 'error'
      ) {
        infrastructureAbort = true;
      }
      // Application-level failures ('failed') do NOT abort the scenario —
      // we continue executing to capture maximum evidence for R06.
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    const status = aggregateStatus(stepResults);

    const metadata: RunMetadata = {
      rehearsalRunId,
      target,
      seedDataRef: plan.seedDataRef,
      stepsAttempted: stepsAttemptedCount,
      stepsPassed: stepResults.filter((s) => s.status === 'passed').length,
      stepsFailed: stepResults.filter((s) => s.status === 'failed').length,
    };

    return {
      runId,
      scenarioId: plan.id,
      target,
      status,
      startedAt,
      completedAt,
      durationMs,
      steps: stepResults,
      metadata,
    };
  }

  /**
   * Execute a ScenarioPlan against BOTH baseline and candidate targets and
   * return a PairedExecutionResult ready for R06 consumption.
   *
   * The order of execution is: baseline first, then candidate.
   * This is intentional — baseline state must be established before candidate
   * so comparisons have a stable reference point.
   *
   * @param plan - The scenario plan to execute on both sides
   * @param baseline - The baseline execution target
   * @param candidate - The candidate execution target
   * @param rehearsalRunId - Parent run ID for metadata traceability
   */
  async executeScenarioPair(
    plan: ScenarioPlan,
    baseline: ExecutionTarget,
    candidate: ExecutionTarget,
    rehearsalRunId: string,
  ): Promise<PairedExecutionResult> {
    // Execute sequentially — baseline then candidate.
    // Parallel execution would risk interference in shared environments.
    const baselineResult = await this.executeScenario(plan, baseline, rehearsalRunId);
    const candidateResult = await this.executeScenario(plan, candidate, rehearsalRunId);

    return {
      scenarioId: plan.id,
      baseline: baselineResult,
      candidate: candidateResult,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal step execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a single step with timeout enforcement.
   *
   * The timeout is enforced by racing the adapter call against a timer.
   * If the adapter does not resolve within stepTimeoutMs, a timed_out result
   * is returned — the adapter call is abandoned (best-effort cancellation).
   */
  private async executeStep(
    step: ScenarioPlanStep,
    target: ExecutionTarget,
  ): Promise<StepExecutionResult> {
    if (!this.adapter.canHandle(step)) {
      return {
        stepId: step.id,
        sequence: step.sequence,
        status: 'error',
        durationMs: 0,
        observations: [],
        executionError: {
          code: 'INVALID_STEP',
          message: `No adapter can handle step kind '${step.kind}' (step ${step.id})`,
        },
      };
    }

    const context: AdapterContext = {
      target,
      timeoutMs: this.stepTimeoutMs,
    };

    const stepStart = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutResult = new Promise<StepExecutionResult>((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({
            stepId: step.id,
            sequence: step.sequence,
            status: 'timed_out',
            durationMs: Date.now() - stepStart,
            observations: [],
            executionError: {
              code: 'TIMEOUT',
              message: `Step '${step.id}' exceeded timeout of ${this.stepTimeoutMs}ms`,
            },
          });
        }, this.stepTimeoutMs);
      });

      return await Promise.race([
        this.adapter.executeStep(step, context),
        timeoutResult,
      ]);
    } catch (err) {
      return {
        stepId: step.id,
        sequence: step.sequence,
        status: 'error',
        durationMs: Date.now() - stepStart,
        observations: [],
        executionError: {
          code: 'ADAPTER_ERROR',
          message: `Adapter threw unexpectedly for step '${step.id}'`,
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Produce a skipped step result for a step that was not executed due to an
 * earlier infrastructure failure.
 *
 * 'blocked' is used here because the step was prevented from running by
 * an external condition (the infrastructure failure of a prior step).
 */
function makeSkippedStep(step: ScenarioPlanStep): StepExecutionResult {
  return {
    stepId: step.id,
    sequence: step.sequence,
    status: 'blocked',
    durationMs: 0,
    observations: [],
    executionError: {
      code: 'ENV_UNAVAILABLE',
      message: `Step '${step.id}' was skipped due to an earlier infrastructure failure`,
    },
  };
}

/**
 * Aggregate individual step statuses into a single scenario status.
 *
 * Priority (worst-case wins):
 *   error > timed_out > blocked > failed > passed
 *
 * Rationale: infrastructure issues are more severe than application failures
 * because they prevent observation collection. An empty scenario (no steps)
 * is considered 'passed' — it ran successfully with nothing to execute.
 */
export function aggregateStatus(steps: StepExecutionResult[]): ExecutionStatus {
  if (steps.length === 0) return 'passed';

  if (steps.some((s) => s.status === 'error')) return 'error';
  if (steps.some((s) => s.status === 'timed_out')) return 'timed_out';
  if (steps.some((s) => s.status === 'blocked')) return 'blocked';
  if (steps.some((s) => s.status === 'failed')) return 'failed';

  return 'passed';
}
