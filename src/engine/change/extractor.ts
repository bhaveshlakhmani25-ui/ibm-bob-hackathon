/**
 * ChangeExtractor — produces a structured diff from two git refs.
 *
 * Owner: Reuben (engine)
 * Phase: 1
 */

import type { RepositoryContext, ChangeRef, Change } from '../types.js';
import { EngineError } from '../errors.js';

/**
 * Extract a structured Change (file diffs, changed symbols, metadata) by running
 * `git diff <baseRef>..<candidateRef>` inside the repository.
 *
 * @throws EngineError('GIT_DIFF_FAILED') if git exits non-zero
 * @throws EngineError('GIT_REF_NOT_FOUND') if either ref does not exist
 */
export async function extractChange(
  repo: RepositoryContext,
  changeRef: ChangeRef,
): Promise<Change> {
  // TODO (Phase 1):
  // 1. Validate both refs exist: `git rev-parse --verify <ref>`
  // 2. Run: `git diff --unified=3 <baseRef>..<candidateRef>`
  // 3. Parse unified diff into FileDiff[] with Hunk[] (use a diff-parsing library or hand-roll)
  // 4. For each changed file, extract top-level symbol names via regex:
  //    - TypeScript/JS: `export (function|class|const|async function) <name>`
  //    - Python: `^def <name>|^class <name>`
  // 5. Count insertions/deletions from hunk headers
  // 6. Assign a stable ID (uuid v4 or sha of baseRef+candidateRef)
  // 7. Return Change
  throw new EngineError('GIT_DIFF_FAILED', 'extractChange: not yet implemented');
}
