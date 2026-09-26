/**
 * git.js — CommonJS implementation of the git execution helper.
 *
 * This is the test-layer equivalent of src/engine/repository/git.ts.
 * Used by the Node.js test harness which cannot run TypeScript directly.
 *
 * Kept in sync with the TypeScript source by convention; any changes to
 * git.ts should be reflected here.
 */

'use strict';

const { execFileSync } = require('child_process');

class EngineError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function execGit(args, cwd, opts = {}) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return typeof stdout === 'string' ? stdout.trim() : '';
  } catch (err) {
    const exitCode = err.status ?? 1;

    if (opts.allowedCodes?.includes(exitCode)) return '';

    const stderr =
      err.stderr instanceof Buffer ? err.stderr.toString('utf8') : (err.stderr ?? '');

    if (isRefNotFound(stderr)) {
      throw new EngineError(
        'GIT_REF_NOT_FOUND',
        `git: unknown revision or path — args: ${args.join(' ')}`,
        err,
      );
    }
    if (args[0] === 'diff') {
      throw new EngineError('GIT_DIFF_FAILED', `git diff failed (exit ${exitCode}): ${stderr.trim()}`, err);
    }
    throw new EngineError('GIT_COMMAND_FAILED', `git ${args[0]} failed (exit ${exitCode}): ${stderr.trim()}`, err);
  }
}

function resolveRef(ref, cwd) {
  return execGit(['rev-parse', '--verify', ref], cwd);
}

function isGitRepository(dirPath) {
  try {
    execGit(['rev-parse', '--git-dir'], dirPath);
    return true;
  } catch {
    return false;
  }
}

const REF_NOT_FOUND_PATTERNS = [
  'unknown revision or path not in the working tree',
  'bad revision',
  'ambiguous argument',
  'not a valid object name',
  'fatal: needed a single revision',
];

function isRefNotFound(stderr) {
  const lower = stderr.toLowerCase();
  return REF_NOT_FOUND_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

module.exports = { execGit, resolveRef, isGitRepository, EngineError };
