/**
 * git.ts — thin wrapper around the `git` CLI.
 *
 * Provides a single `execGit(args, cwd)` function that:
 *  - spawns git synchronously (no external dependencies)
 *  - captures stdout as a UTF-8 string
 *  - maps non-zero exit codes to typed EngineErrors
 *
 * Every module in the engine that needs to run git commands imports from here.
 * No other module shells out to git directly.
 *
 * Owner: Reuben (engine)
 * Phase: R02
 */

import { execFileSync } from 'child_process';
import { EngineError } from '../errors.js';

/**
 * Execute a git command inside `cwd` and return trimmed stdout.
 *
 * @param args  - git arguments, e.g. ['rev-parse', '--git-dir']
 * @param cwd   - absolute path to the repository root
 * @param opts  - optional overrides
 * @returns trimmed stdout string
 *
 * @throws EngineError('GIT_COMMAND_FAILED') for generic non-zero exit
 * @throws EngineError('GIT_REF_NOT_FOUND')  when git reports an unknown revision/ref
 * @throws EngineError('GIT_DIFF_FAILED')    when `git diff` exits non-zero
 */
export function execGit(
  args: string[],
  cwd: string,
  opts: { allowedCodes?: number[] } = {},
): string {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      // stderr is captured so we can inspect the message for ref-not-found
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return typeof stdout === 'string' ? stdout.trim() : '';
  } catch (err: unknown) {
    const spawnErr = err as NodeJS.ErrnoException & {
      status?: number;
      stderr?: Buffer | string;
    };

    const exitCode = spawnErr.status ?? 1;

    // If the caller declared this exit code as acceptable, return empty string
    if (opts.allowedCodes?.includes(exitCode)) {
      return '';
    }

    const stderr =
      spawnErr.stderr instanceof Buffer
        ? spawnErr.stderr.toString('utf8')
        : (spawnErr.stderr ?? '');

    // Distinguish ref-not-found from general command failure
    if (isRefNotFound(stderr)) {
      throw new EngineError(
        'GIT_REF_NOT_FOUND',
        `git: unknown revision or path not in the working tree — args: ${args.join(' ')}`,
        err,
      );
    }

    // Distinguish diff failure from general command failure
    if (args[0] === 'diff') {
      throw new EngineError(
        'GIT_DIFF_FAILED',
        `git diff failed (exit ${exitCode}): ${stderr.trim()}`,
        err,
      );
    }

    throw new EngineError(
      'GIT_COMMAND_FAILED',
      `git ${args[0]} failed (exit ${exitCode}): ${stderr.trim()}`,
      err,
    );
  }
}

/**
 * Resolve a git ref to its full 40-character SHA-1.
 *
 * @throws EngineError('GIT_REF_NOT_FOUND') if the ref does not exist
 */
export function resolveRef(ref: string, cwd: string): string {
  return execGit(['rev-parse', '--verify', ref], cwd);
}

/**
 * Return true if the directory at `dirPath` is a git repository
 * (contains a .git directory or is itself a bare repo).
 * Does not throw.
 */
export function isGitRepository(dirPath: string): boolean {
  try {
    execGit(['rev-parse', '--git-dir'], dirPath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Patterns emitted by git when a ref is unknown */
const REF_NOT_FOUND_PATTERNS = [
  'unknown revision or path not in the working tree',
  'bad revision',
  'ambiguous argument',
  'not a valid object name',
  'fatal: needed a single revision',
];

function isRefNotFound(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return REF_NOT_FOUND_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}
