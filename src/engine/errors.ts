/**
 * Change Rehearsal — Engine Error Hierarchy
 *
 * All engine errors carry a typed code so callers can handle them programmatically
 * without parsing error message strings.
 *
 * Owner: Reuben (engine)
 */

/**
 * Every error code that the engine may throw.
 *
 * Build and execution failures that do not abort the run are recorded in
 * RehearsalRun/RawExecution and do NOT cause an EngineError to be thrown.
 * EngineError is thrown only when the pipeline itself cannot continue.
 */
export type EngineErrorCode =
  // --- Repository ---
  | 'REPOSITORY_NOT_FOUND'
  | 'UNSUPPORTED_LANGUAGE'
  // --- Change extraction ---
  | 'GIT_DIFF_FAILED'
  | 'GIT_REF_NOT_FOUND'
  | 'GIT_COMMAND_FAILED'
  | 'DIFF_PARSE_FAILED'
  // --- Intent compiler ---
  | 'INTENT_COMPILER_FAILED'
  | 'LLM_RESPONSE_INVALID'
  | 'FIXTURE_NOT_FOUND'
  // --- Scenario planning ---
  | 'SCENARIO_NOT_DETERMINISTIC'
  // --- Execution ---
  | 'SERVICE_START_FAILED'
  | 'SERVICE_HEALTH_CHECK_TIMEOUT'
  | 'SCENARIO_EXECUTION_TIMEOUT'
  | 'SCENARIO_EXECUTION_FAILED'
  // --- Observation ---
  | 'OBSERVATION_NORMALIZATION_FAILED'
  // --- Evidence / IO ---
  | 'EVIDENCE_WRITE_FAILED'
  | 'RUN_NOT_FOUND';

export class EngineError extends Error {
  public readonly name = 'EngineError';

  constructor(
    public readonly code: EngineErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    // Maintain prototype chain in transpiled targets
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** True if the given value is an EngineError with the specified code */
export function isEngineError(
  value: unknown,
  code?: EngineErrorCode,
): value is EngineError {
  if (!(value instanceof EngineError)) return false;
  if (code !== undefined) return value.code === code;
  return true;
}
