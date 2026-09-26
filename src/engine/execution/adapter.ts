/**
 * Change Rehearsal — R05 Execution Adapter
 *
 * Defines the ExecutionAdapter interface and provides:
 *   1. The adapter contract that all execution backends must satisfy
 *   2. A SyntheticAdapter for deterministic in-memory testing (ShopFlow fixture)
 *
 * ADAPTER BOUNDARY:
 *   The RehearsalExecutor depends on ExecutionAdapter, not on any specific
 *   transport (HTTP, CLI, browser, DB). New adapters can be added without
 *   touching the executor or domain model.
 *
 *   Current adapters:
 *     SyntheticAdapter — deterministic in-memory adapter (used for all tests
 *                        and the ShopFlow inventory freshness scenario)
 *
 *   Future adapters (not implemented here):
 *     HttpAdapter     — executes HTTP steps against a running service
 *     CliAdapter      — executes CLI steps via child_process.spawn
 *     FunctionAdapter — calls local module functions directly
 *
 * Owner: Reuben (engine)
 * Phase: R05
 */

import type { ScenarioPlanStep } from '../scenario/model.js';
import type { ExecutionTarget, StepExecutionResult, ExecutionError } from './model.js';
import {
  normalizeHttpObservation,
  normalizeDbObservation,
  normalizeFunctionObservation,
} from './normalization.js';

// ---------------------------------------------------------------------------
// Adapter context
// ---------------------------------------------------------------------------

/**
 * Runtime context passed to the adapter for each step execution.
 *
 * Contains per-run configuration so adapters are stateless — the same adapter
 * instance can be used for multiple runs.
 */
export interface AdapterContext {
  /** The target being executed (baseline or candidate) */
  target: ExecutionTarget;
  /**
   * Maximum milliseconds the adapter should spend on this step.
   * Adapters SHOULD honour this; the executor enforces it as a hard limit.
   */
  timeoutMs: number;
  /**
   * Seed data that was applied before execution started.
   * Available for adapters that need to reference initial state.
   */
  seedData?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Contract for all execution adapters.
 *
 * A single adapter handles one step kind (http, function, db, etc.) or may
 * handle multiple step kinds by dispatching internally.
 *
 * The adapter returns a StepExecutionResult containing all observations
 * captured during the step. If the step cannot be executed, the result must
 * carry status 'error', 'blocked', or 'timed_out' with an executionError.
 *
 * Adapters MUST NOT:
 *   - Make LLM calls
 *   - Make comparison decisions (that is R06's job)
 *   - Throw unhandled exceptions — catch and return error results
 *   - Log secrets or credentials
 */
export interface ExecutionAdapter {
  /**
   * Human-readable name for this adapter (used in logging / metadata).
   */
  readonly name: string;

  /**
   * True if this adapter can handle the given step.
   * The executor calls this to find the right adapter before calling executeStep.
   */
  canHandle(step: ScenarioPlanStep): boolean;

  /**
   * Execute a single scenario plan step and return a deterministic result.
   *
   * The adapter MUST:
   *   - Capture all relevant observations during execution
   *   - Return partial observations even if the step fails
   *   - Respect context.timeoutMs (best-effort; executor enforces hard limit)
   *   - Return an executionError for infrastructure failures (not app-level failures)
   *
   * The adapter MUST NOT:
   *   - Return 'passed' for an application-level error (HTTP 5xx = 'failed', not 'passed')
   *   - Return 'regression' as a status (that is R06's domain)
   */
  executeStep(
    step: ScenarioPlanStep,
    context: AdapterContext,
  ): Promise<StepExecutionResult>;
}

// ---------------------------------------------------------------------------
// SyntheticAdapter — deterministic in-memory adapter
// ---------------------------------------------------------------------------

/**
 * Response definition for a single step in the SyntheticAdapter.
 *
 * Callers supply a map of stepId → SyntheticResponse when creating the adapter.
 * Steps not in the map receive a default 200 OK response.
 */
export interface SyntheticStepResponse {
  /** HTTP status code to return (default: 200) */
  httpStatus?: number;
  /** Response body (default: {}) */
  body?: unknown;
  /** Response headers (default: {}) */
  headers?: Record<string, string>;
  /** Simulate a step failure (application-level) */
  forceFailure?: boolean;
  /** Simulate an adapter error */
  forceError?: boolean;
  /** Error code when forceError is true (default: 'ADAPTER_ERROR') */
  errorCode?: ExecutionError['code'];
  /** Error message when forceError is true */
  errorMessage?: string;
  /** Simulated execution duration in milliseconds (default: 1) */
  durationMs?: number;
  /** DB snapshot to include in the observation */
  dbSnapshot?: Record<string, unknown>;
}

/**
 * A deterministic, in-memory execution adapter for tests and CI.
 *
 * Does NOT make network calls. Does NOT require a running service.
 *
 * Usage:
 *   const adapter = new SyntheticAdapter({
 *     'step-read-product': {
 *       httpStatus: 200,
 *       body: { id: 1, stock: 3 },
 *     },
 *   });
 *
 * This adapter supports the ShopFlow inventory freshness scenario without
 * any external dependencies.
 */
export class SyntheticAdapter implements ExecutionAdapter {
  public readonly name = 'SyntheticAdapter';

  private readonly responses: ReadonlyMap<string, SyntheticStepResponse>;

  /**
   * @param stepResponses - Map of stepId or sequence string → response definition.
   *                        Keying by sequence number ("1", "2", "3") is useful when
   *                        the exact step ID is generated at runtime by the R04 generator.
   *                        Steps not in this map receive default 200 OK responses.
   */
  constructor(stepResponses: Record<string, SyntheticStepResponse> = {}) {
    this.responses = new Map(Object.entries(stepResponses));
  }

  canHandle(_step: ScenarioPlanStep): boolean {
    // The SyntheticAdapter handles all step kinds.
    return true;
  }

  async executeStep(
    step: ScenarioPlanStep,
    context: AdapterContext,
  ): Promise<StepExecutionResult> {
    // Look up by stepId first; fall back to sequence number string for convenience
    // when adapter is keyed by sequence (e.g. "1", "2", "3").
    const response =
      this.responses.get(step.id) ??
      this.responses.get(String(step.sequence)) ??
      {};
    const durationMs = response.durationMs ?? 1;
    const source = `synthetic:${context.target.kind}:${step.id}`;

    // Infrastructure error case
    if (response.forceError === true) {
      const errCode = response.errorCode ?? 'ADAPTER_ERROR';
      return {
        stepId: step.id,
        sequence: step.sequence,
        status: errCode === 'TIMEOUT' ? 'timed_out'
          : errCode === 'ENV_UNAVAILABLE' ? 'blocked'
          : 'error',
        durationMs,
        observations: [],
        executionError: {
          code: errCode,
          message: response.errorMessage ?? `Simulated ${errCode} in SyntheticAdapter`,
        },
      };
    }

    const httpStatus = response.httpStatus ?? 200;
    const body = response.body ?? {};
    const headers = response.headers ?? { 'content-type': 'application/json' };

    const isApplicationFailure =
      response.forceFailure === true ||
      (typeof httpStatus === 'number' && httpStatus >= 400);

    const observations = [
      normalizeHttpObservation(httpStatus, headers, body, source),
    ];

    if (response.dbSnapshot) {
      observations.push(
        normalizeDbObservation(response.dbSnapshot, `${source}:db`),
      );
    }

    return {
      stepId: step.id,
      sequence: step.sequence,
      status: isApplicationFailure ? 'failed' : 'passed',
      durationMs,
      observations,
    };
  }
}

/**
 * Build a SyntheticAdapter configured with the ShopFlow inventory freshness fixture.
 *
 * Models the inventory-visibility-after-update scenario:
 *   Step 1: POST /test/seed       → 200 OK (seed data applied)
 *   Step 2: PUT /inventory/1      → 200 OK (stock updated)
 *   Step 3: GET /products/1       → 200 OK with stock value from target
 *
 * The baseline and candidate return different stock values to simulate the
 * real scenario where a code change affects inventory reporting.
 *
 * R05 captures both values.
 * R06 compares them later — R05 does NOT label this a regression.
 */
export function buildShopFlowAdapter(
  side: 'baseline' | 'candidate',
): SyntheticAdapter {
  // Baseline: stock = 1 (old behavior)
  // Candidate: stock = 3 (new behavior after the fix)
  const stock = side === 'baseline' ? 1 : 3;

  // Keys are sequence numbers ("1", "2", "3") so this adapter works regardless
  // of the runtime step IDs generated by the R04 scenario generator.
  return new SyntheticAdapter({
    // Step 1: POST /test/seed — seed the database state
    '1': {
      httpStatus: 200,
      body: { ok: true },
      durationMs: 2,
    },
    // Step 2: PUT /inventory/1 — update inventory stock
    '2': {
      httpStatus: 200,
      body: { ok: true, productId: 1 },
      durationMs: 3,
    },
    // Step 3: GET /products/1 — read product and observe stock
    '3': {
      httpStatus: 200,
      body: { id: 1, name: 'Widget', price: 9.99, stock },
      durationMs: 2,
      dbSnapshot: { 'inventory.productId=1.stock': stock },
    },
  });
}
