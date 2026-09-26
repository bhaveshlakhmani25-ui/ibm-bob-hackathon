/**
 * RepositoryLoader — opens the target repository and validates it for rehearsal.
 *
 * Owner: Reuben (engine)
 * Phase: 1
 */

import type { RepositoryRef, RepositoryContext } from '../types.js';
import { EngineError } from '../errors.js';

/**
 * Load the repository at the given path, detect language/framework, and return
 * a RepositoryContext for use by downstream modules.
 *
 * @throws EngineError('REPOSITORY_NOT_FOUND') if the path does not exist or is not a git repo
 * @throws EngineError('UNSUPPORTED_LANGUAGE') if the language cannot be detected
 */
export async function loadRepository(ref: RepositoryRef): Promise<RepositoryContext> {
  // TODO (Phase 1):
  // 1. fs.stat(ref.localPath) — throw REPOSITORY_NOT_FOUND if missing
  // 2. execGit(['rev-parse', '--git-dir'], ref.localPath) — throw REPOSITORY_NOT_FOUND if not a repo
  // 3. Detect language: check for package.json → 'typescript'/'javascript',
  //    requirements.txt/pyproject.toml → 'python', pom.xml → 'java'
  // 4. Read package.json / pyproject.toml for framework hints
  // 5. execGit(['symbolic-ref', '--short', 'HEAD'], ...) for defaultBranch
  // 6. Return RepositoryContext
  throw new EngineError('REPOSITORY_NOT_FOUND', 'loadRepository: not yet implemented');
}
