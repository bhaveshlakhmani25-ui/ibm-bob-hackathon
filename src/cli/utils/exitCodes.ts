/**
 * Exit codes for the Change Rehearsal CLI.
 * Documented in docs/BHAVESH_IMPLEMENTATION_PLAN.md §5.1
 */
export const EXIT = {
  /** Completed, no open regressions */
  OK: 0,
  /** Completed, one or more regressions found */
  REGRESSIONS: 1,
  /** Execution / build failure */
  EXECUTION_FAILURE: 2,
  /** Invalid config / unsupported repository */
  INVALID_CONFIG: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
