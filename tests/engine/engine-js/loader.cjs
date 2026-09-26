/**
 * loader.js — CommonJS implementation of the repository loader.
 *
 * Test-layer equivalent of src/engine/repository/loader.ts.
 * Used by the Node.js test harness which cannot run TypeScript directly.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { EngineError, execGit, isGitRepository } = require('./git.cjs');

async function loadRepository(ref) {
  const repoPath = path.resolve(ref.localPath);

  if (!pathExists(repoPath)) {
    throw new EngineError('REPOSITORY_NOT_FOUND', `Repository path does not exist: ${repoPath}`);
  }

  if (!isGitRepository(repoPath)) {
    throw new EngineError('REPOSITORY_NOT_FOUND', `Path is not a git repository: ${repoPath}`);
  }

  const { language, frameworks } = detectLanguageAndFrameworks(repoPath);

  if (language === 'unknown') {
    throw new EngineError(
      'UNSUPPORTED_LANGUAGE',
      `No supported language indicator found in: ${repoPath}. ` +
        'Expected one of: package.json/tsconfig.json (TypeScript/JavaScript), ' +
        'requirements.txt/pyproject.toml (Python), pom.xml/build.gradle (Java), go.mod (Go).',
    );
  }

  const defaultBranch = resolveDefaultBranch(repoPath);
  const id = buildRepositoryId(repoPath);

  return { id, localPath: repoPath, language, frameworks, defaultBranch };
}

// ---------------------------------------------------------------------------
// Language / framework detection
// ---------------------------------------------------------------------------

function detectLanguageAndFrameworks(repoPath) {
  if (fileExists(repoPath, 'tsconfig.json')) {
    return { language: 'typescript', frameworks: detectNodeFrameworks(repoPath) };
  }
  if (fileExists(repoPath, 'package.json')) {
    const lang = hasTypeScriptDep(repoPath) ? 'typescript' : 'javascript';
    return { language: lang, frameworks: detectNodeFrameworks(repoPath) };
  }
  if (fileExists(repoPath, 'pyproject.toml') || fileExists(repoPath, 'requirements.txt')) {
    return { language: 'python', frameworks: detectPythonFrameworks(repoPath) };
  }
  if (fileExists(repoPath, 'pom.xml') || fileExists(repoPath, 'build.gradle') || fileExists(repoPath, 'build.gradle.kts')) {
    const lang = fileExists(repoPath, 'build.gradle.kts') ? 'kotlin' : 'java';
    return { language: lang, frameworks: [] };
  }
  if (fileExists(repoPath, 'go.mod')) return { language: 'go', frameworks: [] };
  if (fileExists(repoPath, 'Cargo.toml')) return { language: 'rust', frameworks: [] };
  return { language: 'unknown', frameworks: [] };
}

function hasTypeScriptDep(repoPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    return 'typescript' in deps || 'ts-node' in deps;
  } catch { return false; }
}

function detectNodeFrameworks(repoPath) {
  const frameworks = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const known = { express: 'express', fastify: 'fastify', koa: 'koa', nestjs: '@nestjs/core',
      next: 'next', jest: 'jest', vitest: 'vitest', mocha: 'mocha' };
    for (const [label, pkg2] of Object.entries(known)) {
      if (pkg2 in deps) frameworks.push(label);
    }
  } catch { /* absent */ }
  return frameworks;
}

function detectPythonFrameworks(repoPath) {
  const frameworks = [];
  const indicators = [['django','django'],['flask','flask'],['fastapi','fastapi'],
    ['starlette','starlette'],['pytest','pytest']];
  try {
    const req = fs.readFileSync(path.join(repoPath, 'requirements.txt'), 'utf8').toLowerCase();
    for (const [label, pkg] of indicators) { if (req.includes(pkg)) frameworks.push(label); }
  } catch { /* absent */ }
  try {
    const toml = fs.readFileSync(path.join(repoPath, 'pyproject.toml'), 'utf8').toLowerCase();
    for (const [label, pkg] of indicators) {
      if (!frameworks.includes(label) && toml.includes(pkg)) frameworks.push(label);
    }
  } catch { /* absent */ }
  return frameworks;
}

function resolveDefaultBranch(repoPath) {
  try { return execGit(['symbolic-ref', '--short', 'HEAD'], repoPath); }
  catch {
    try { return execGit(['config', '--get', 'init.defaultBranch'], repoPath) || 'main'; }
    catch { return 'main'; }
  }
}

function pathExists(p) {
  try { fs.statSync(p); return true; } catch { return false; }
}

function fileExists(repoPath, filename) {
  return pathExists(path.join(repoPath, filename));
}

function buildRepositoryId(repoPath) {
  const slug = path.basename(repoPath).replace(/[^a-zA-Z0-9_-]/g, '-');
  return `repo-${slug}`;
}

module.exports = { loadRepository };
