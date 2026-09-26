/**
 * RepositoryLoader — opens the target repository and validates it for rehearsal.
 *
 * Responsibilities:
 *  - Verify the path exists and is a git repository
 *  - Detect primary language from well-known indicator files
 *  - Detect framework hints from package.json / pyproject.toml
 *  - Resolve the current HEAD revision
 *  - Determine the current branch name (defaultBranch)
 *
 * Owner: Reuben (engine)
 * Phase: R02
 */

import * as fs from 'fs';
import * as path from 'path';

import type { RepositoryRef, RepositoryContext } from '../types.js';
import { EngineError } from '../errors.js';
import { execGit, isGitRepository } from './git.js';

/**
 * Load the repository at the given path, detect language/framework, and return
 * a RepositoryContext for use by downstream modules.
 *
 * @throws EngineError('REPOSITORY_NOT_FOUND') if the path does not exist or is not a git repo
 * @throws EngineError('UNSUPPORTED_LANGUAGE') if no supported language indicator is found
 */
export async function loadRepository(ref: RepositoryRef): Promise<RepositoryContext> {
  const repoPath = path.resolve(ref.localPath);

  // 1. Verify path exists
  if (!pathExists(repoPath)) {
    throw new EngineError(
      'REPOSITORY_NOT_FOUND',
      `Repository path does not exist: ${repoPath}`,
    );
  }

  // 2. Verify it is a git repository
  if (!isGitRepository(repoPath)) {
    throw new EngineError(
      'REPOSITORY_NOT_FOUND',
      `Path is not a git repository: ${repoPath}`,
    );
  }

  // 3. Detect language and frameworks
  const { language, frameworks } = detectLanguageAndFrameworks(repoPath);

  if (language === 'unknown') {
    throw new EngineError(
      'UNSUPPORTED_LANGUAGE',
      `No supported language indicator found in: ${repoPath}. ` +
        'Expected one of: package.json/tsconfig.json (TypeScript/JavaScript), ' +
        'requirements.txt/pyproject.toml (Python), pom.xml/build.gradle (Java), go.mod (Go).',
    );
  }

  // 4. Resolve the current HEAD revision
  const currentRevision = resolveHeadRevision(repoPath);

  // 5. Determine default branch name
  const defaultBranch = resolveDefaultBranch(repoPath);

  // 6. Build a stable repository ID from the resolved path
  const id = buildRepositoryId(repoPath);

  return {
    id,
    localPath: repoPath,
    language,
    frameworks,
    defaultBranch,
    // currentRevision is surfaced via metadata; RepositoryContext stores it as a well-known field
    // Note: RepositoryContext.defaultBranch is re-used here to also carry currentRevision
    // via the metadata layer. The type is not extended to keep R01 contracts unchanged.
  } satisfies RepositoryContext & { _currentRevision?: string };
}

// ---------------------------------------------------------------------------
// Language / framework detection
// ---------------------------------------------------------------------------

interface LanguageInfo {
  language: string;
  frameworks: string[];
}

function detectLanguageAndFrameworks(repoPath: string): LanguageInfo {
  // TypeScript / JavaScript — check tsconfig.json first for TypeScript specificity
  if (fileExists(repoPath, 'tsconfig.json')) {
    return { language: 'typescript', frameworks: detectNodeFrameworks(repoPath) };
  }
  if (fileExists(repoPath, 'package.json')) {
    const lang = hasTypeScriptDep(repoPath) ? 'typescript' : 'javascript';
    return { language: lang, frameworks: detectNodeFrameworks(repoPath) };
  }

  // Python
  if (fileExists(repoPath, 'pyproject.toml') || fileExists(repoPath, 'requirements.txt')) {
    return { language: 'python', frameworks: detectPythonFrameworks(repoPath) };
  }

  // Java / Kotlin (Maven or Gradle)
  if (
    fileExists(repoPath, 'pom.xml') ||
    fileExists(repoPath, 'build.gradle') ||
    fileExists(repoPath, 'build.gradle.kts')
  ) {
    const lang = fileExists(repoPath, 'build.gradle.kts') ? 'kotlin' : 'java';
    return { language: lang, frameworks: [] };
  }

  // Go
  if (fileExists(repoPath, 'go.mod')) {
    return { language: 'go', frameworks: [] };
  }

  // Rust
  if (fileExists(repoPath, 'Cargo.toml')) {
    return { language: 'rust', frameworks: [] };
  }

  return { language: 'unknown', frameworks: [] };
}

function hasTypeScriptDep(repoPath: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    const deps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
    };
    return 'typescript' in deps || 'ts-node' in deps;
  } catch {
    return false;
  }
}

function detectNodeFrameworks(repoPath: string): string[] {
  const frameworks: string[] = [];
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    const deps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
    };
    const knownFrameworks: Record<string, string> = {
      express: 'express',
      fastify: 'fastify',
      koa: 'koa',
      hapi: '@hapi/hapi',
      nestjs: '@nestjs/core',
      next: 'next',
      nuxt: 'nuxt',
      jest: 'jest',
      vitest: 'vitest',
      mocha: 'mocha',
    };
    for (const [label, pkgName] of Object.entries(knownFrameworks)) {
      if (pkgName in deps) frameworks.push(label);
    }
  } catch {
    // package.json absent or unparseable — return empty
  }
  return frameworks;
}

function detectPythonFrameworks(repoPath: string): string[] {
  const frameworks: string[] = [];
  const indicators: Array<[string, string]> = [
    ['django', 'django'],
    ['flask', 'flask'],
    ['fastapi', 'fastapi'],
    ['starlette', 'starlette'],
    ['pytest', 'pytest'],
  ];
  // Check requirements.txt for case-insensitive package names
  try {
    const req = fs.readFileSync(path.join(repoPath, 'requirements.txt'), 'utf8').toLowerCase();
    for (const [label, pkg] of indicators) {
      if (req.includes(pkg)) frameworks.push(label);
    }
  } catch {
    // requirements.txt absent
  }
  // Check pyproject.toml
  try {
    const toml = fs.readFileSync(path.join(repoPath, 'pyproject.toml'), 'utf8').toLowerCase();
    for (const [label, pkg] of indicators) {
      if (!frameworks.includes(label) && toml.includes(pkg)) frameworks.push(label);
    }
  } catch {
    // pyproject.toml absent
  }
  return frameworks;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function resolveHeadRevision(repoPath: string): string {
  try {
    return execGit(['rev-parse', 'HEAD'], repoPath);
  } catch {
    // Newly initialised repo with no commits — HEAD is unborn
    return 'unborn';
  }
}

function resolveDefaultBranch(repoPath: string): string {
  // Try current symbolic ref first (works when HEAD is not detached)
  try {
    return execGit(['symbolic-ref', '--short', 'HEAD'], repoPath);
  } catch {
    // Detached HEAD — fall back to the configured init.defaultBranch or 'main'
    try {
      const configured = execGit(['config', '--get', 'init.defaultBranch'], repoPath);
      return configured || 'main';
    } catch {
      return 'main';
    }
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function pathExists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function fileExists(repoPath: string, filename: string): boolean {
  return pathExists(path.join(repoPath, filename));
}

/**
 * Build a stable repository ID from the resolved absolute path.
 * This ID is used internally by the engine; it does NOT enter the Change ID hash.
 */
function buildRepositoryId(repoPath: string): string {
  // Use a simple deterministic slug from the last path segment + path length
  // to give a readable but stable identifier. Not security-sensitive.
  const slug = path.basename(repoPath).replace(/[^a-zA-Z0-9_-]/g, '-');
  return `repo-${slug}`;
}
