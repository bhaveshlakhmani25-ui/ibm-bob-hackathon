/**
 * git-test-helpers.js — utilities for creating isolated temporary git repositories.
 *
 * Every test that needs a git repo calls `createTmpRepo()` and then
 * `cleanupTmpRepo(ctx)` in a finally block.
 *
 * No npm packages — uses only Node.js built-ins and the installed git executable.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Create a fresh temporary git repository.
 *
 * @returns {{ dir: string }} context object — pass to cleanupTmpRepo when done.
 */
function createTmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-test-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test User']);
  return { dir };
}

/**
 * Remove the temporary repository created by createTmpRepo.
 * @param {{ dir: string }} ctx
 */
function cleanupTmpRepo(ctx) {
  try {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup; test already finished
  }
}

/**
 * Write a file inside the tmp repo and return its path.
 * @param {{ dir: string }} ctx
 * @param {string} relativePath
 * @param {string} content
 */
function writeFile(ctx, relativePath, content) {
  const full = path.join(ctx.dir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

/**
 * Stage and commit all changes.
 * @param {{ dir: string }} ctx
 * @param {string} message
 * @returns {string} the full commit SHA
 */
function commit(ctx, message) {
  git(ctx.dir, ['add', '-A']);
  git(ctx.dir, ['commit', '-m', message, '--allow-empty']);
  return git(ctx.dir, ['rev-parse', 'HEAD']);
}

/**
 * Stage specific file(s).
 */
function stageFile(ctx, relativePath) {
  git(ctx.dir, ['add', relativePath]);
}

/**
 * Run git with the given args inside dir; return trimmed stdout.
 * Throws on non-zero exit.
 */
function git(dir, args) {
  try {
    const out = execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return typeof out === 'string' ? out.trim() : '';
  } catch (err) {
    const stderr = err.stderr instanceof Buffer ? err.stderr.toString() : (err.stderr ?? '');
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
}

module.exports = { createTmpRepo, cleanupTmpRepo, writeFile, commit, stageFile, git };
