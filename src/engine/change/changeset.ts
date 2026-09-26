/**
 * changeset.ts — ChangeSet: the structured, enriched result of change analysis.
 *
 * A ChangeSet is a richer wrapper around Change that carries:
 *  - an explicit `mode` discriminant (revision | staged | working_tree)
 *  - resolved base/candidate identifiers (full SHAs or honest sentinel strings)
 *  - the repository root
 *  - a summary of changed paths and their statuses
 *
 * This is the type consumed by downstream impact analysis.
 * The core Change type (from types.ts) is preserved unchanged; ChangeSet extends it
 * without modifying the R01 contract.
 *
 * Owner: Reuben (engine)
 * Phase: R02
 */

import type { Change, RepositoryContext, FileDiff } from '../types.js';

// ---------------------------------------------------------------------------
// ChangeSet type
// ---------------------------------------------------------------------------

/**
 * The mode of the change:
 *  - `revision`     — diff between two explicit git commits/refs
 *  - `staged`       — diff between HEAD and the git index (staged files)
 *  - `working_tree` — diff between HEAD and the current working tree (unstaged changes)
 */
export type ChangeMode = 'revision' | 'staged' | 'working_tree';

/**
 * A resolved identifier for one side of a change.
 *
 * For revision mode: the full 40-character SHA-1.
 * For staged mode:   the literal string "STAGED".
 * For working_tree:  the literal string "WORKING_TREE".
 */
export type ResolvedIdentifier = string | 'STAGED' | 'WORKING_TREE';

/**
 * A summary entry for a single changed path — a flat, easy-to-consume
 * view of FileDiff intended for impact analysis and metadata consumers.
 */
export interface ChangedPathEntry {
  /** Current path (post-rename, or the only path for non-renames) */
  path: string;
  /** Previous path, only present when changeType === 'renamed' */
  oldPath?: string;
  changeType: FileDiff['changeType'];
  /** Detected language/file type, or 'unknown' */
  language: string;
  insertions: number;
  deletions: number;
}

/**
 * ChangeSet — the canonical structured representation of a proposed change.
 *
 * Produced by `buildChangeSet` after `extractChange` returns a Change.
 * Consumed by `buildRepositoryMetadata` and downstream impact analysis.
 */
export interface ChangeSet {
  /** The underlying Change as produced by extractChange */
  change: Change;

  /** How this change was extracted */
  mode: ChangeMode;

  /** Absolute path to the repository root */
  repositoryRoot: string;

  /**
   * Resolved base identifier.
   * For revision mode: full SHA-1 of the base commit.
   * For staged/working_tree: full SHA-1 of HEAD (the base is always HEAD).
   */
  baseRevision: string;

  /**
   * Resolved candidate identifier.
   * For revision mode: full SHA-1 of the candidate commit.
   * For staged: the literal string "STAGED".
   * For working_tree: the literal string "WORKING_TREE".
   *
   * This field NEVER contains a fake commit SHA for non-commit states.
   */
  candidateRevision: ResolvedIdentifier;

  /** Flat summary of every changed path, sorted by path ascending */
  changedPaths: ChangedPathEntry[];

  /** ISO 8601 timestamp at which this ChangeSet was built */
  extractedAt: string;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a ChangeSet from a Change and the RepositoryContext that produced it.
 *
 * @param repo   - The repository context from loadRepository
 * @param change - The Change from extractChange
 * @param mode   - The extraction mode (revision | staged | working_tree)
 * @param baseRevision      - Resolved base SHA (from extractor)
 * @param candidateRevision - Resolved candidate identifier (from extractor)
 */
export function buildChangeSet(
  repo: RepositoryContext,
  change: Change,
  mode: ChangeMode,
  baseRevision: string,
  candidateRevision: ResolvedIdentifier,
): ChangeSet {
  const changedPaths: ChangedPathEntry[] = change.diffSummary.filesChanged
    .map((fileDiff): ChangedPathEntry => ({
      path: fileDiff.path,
      oldPath: fileDiff.oldPath,
      changeType: fileDiff.changeType,
      language: detectFileLanguage(fileDiff.path),
      insertions: countHunkInsertions(fileDiff),
      deletions: countHunkDeletions(fileDiff),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    change,
    mode,
    repositoryRoot: repo.localPath,
    baseRevision,
    candidateRevision,
    changedPaths,
    extractedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Detect a file's language from its extension */
export function detectFileLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    py: 'python',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    cs: 'csharp',
    cpp: 'cpp',
    cc: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    swift: 'swift',
    scala: 'scala',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    toml: 'toml',
    md: 'markdown',
    sql: 'sql',
  };
  return map[ext] ?? 'unknown';
}

function countHunkInsertions(fileDiff: FileDiff): number {
  return fileDiff.hunks.reduce((sum, hunk) => {
    const lines = hunk.content.split('\n');
    return sum + lines.filter((l) => l.startsWith('+')).length;
  }, 0);
}

function countHunkDeletions(fileDiff: FileDiff): number {
  return fileDiff.hunks.reduce((sum, hunk) => {
    const lines = hunk.content.split('\n');
    return sum + lines.filter((l) => l.startsWith('-')).length;
  }, 0);
}
