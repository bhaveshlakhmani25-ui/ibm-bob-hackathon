/**
 * metadata.ts — structured repository metadata for impact analysis.
 *
 * `buildRepositoryMetadata` assembles a flat, easy-to-consume metadata
 * record from a RepositoryContext and a ChangeSet. This is the primary
 * data contract between the git/change-analysis layer (R02) and the
 * impact analysis layer (later phases).
 *
 * Nothing in this module makes git calls or LLM calls.
 * All information is derived from already-resolved inputs.
 *
 * Owner: Reuben (engine)
 * Phase: R02
 */

import type { RepositoryContext, SymbolRef } from '../types.js';
import type { ChangeSet, ChangedPathEntry, ChangeMode, ResolvedIdentifier } from '../change/changeset.js';

// ---------------------------------------------------------------------------
// RepositoryMetadata type
// ---------------------------------------------------------------------------

/**
 * Structured metadata about a repository and its proposed change.
 *
 * Designed to be serialisable to JSON; no circular references, no functions.
 * Consumed by ImpactAnalyzer and any other downstream module that needs
 * a structured view of the change without having to re-run git commands.
 */
export interface RepositoryMetadata {
  /** Stable repository identifier (from RepositoryContext.id) */
  repositoryId: string;

  /** Absolute path to the repository root */
  repositoryRoot: string;

  /** Detected primary language (e.g. 'typescript', 'python') */
  language: string;

  /** Detected framework hints (e.g. ['express', 'jest']) */
  frameworks: string[];

  /** Current branch name (may be a commit SHA when HEAD is detached) */
  defaultBranch: string;

  /**
   * Resolved base revision.
   * Full 40-char SHA-1 for both revision and working-tree/staged modes.
   * (HEAD is always the base for working-tree and staged.)
   */
  baseRevision: string;

  /**
   * Resolved candidate identifier.
   * Full SHA-1 for revision mode.
   * "WORKING_TREE" or "STAGED" for the corresponding modes.
   * Never a fake commit SHA.
   */
  candidateRevision: ResolvedIdentifier;

  /** How the change was extracted */
  changeMode: ChangeMode;

  /** Stable Change ID derived from normalized diff content */
  changeId: string;

  /** ISO 8601 timestamp of extraction */
  extractedAt: string;

  /** All changed paths, sorted by path ascending */
  changedPaths: ChangedPathEntry[];

  /**
   * Flat list of unique changed file paths (convenience field).
   * Derived from changedPaths; includes new path for renames.
   */
  changedFilePaths: string[];

  /**
   * Symbols identified in the diff via regex extraction.
   * Only populated for languages where deterministic extraction is supported
   * (TypeScript, JavaScript, Python). Empty for all other languages.
   * Absence of symbols does NOT imply no symbols changed.
   */
  symbolsChanged: SymbolRef[];

  /** Total inserted lines across all changed files */
  totalInsertions: number;

  /** Total deleted lines across all changed files */
  totalDeletions: number;

  /**
   * Languages of all changed files (deduplicated, sorted).
   * Useful for impact analysis to know which language parsers to invoke.
   */
  affectedLanguages: string[];

  /**
   * True when symbol extraction was unavailable for one or more changed files
   * (i.e. at least one changed file has an unsupported language).
   * When true, impact analysis should treat the absence of symbolsChanged
   * entries for those files as a limitation, not as evidence of no changes.
   */
  hasUnsupportedLanguageFiles: boolean;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Assemble a RepositoryMetadata record from a RepositoryContext and a ChangeSet.
 *
 * @param repo      - The repository context from loadRepository
 * @param changeSet - The ChangeSet from buildChangeSet
 */
export function buildRepositoryMetadata(
  repo: RepositoryContext,
  changeSet: ChangeSet,
): RepositoryMetadata {
  const { change, mode, repositoryRoot, baseRevision, candidateRevision, changedPaths, extractedAt } =
    changeSet;

  const changedFilePaths = changedPaths.map((cp) => cp.path);

  const affectedLanguages = deduplicated(
    changedPaths.map((cp) => cp.language).filter((l) => l !== 'unknown'),
  ).sort();

  const hasUnsupportedLanguageFiles = changedPaths.some((cp) => cp.language === 'unknown');

  return {
    repositoryId: repo.id,
    repositoryRoot,
    language: repo.language,
    frameworks: repo.frameworks,
    defaultBranch: repo.defaultBranch,
    baseRevision,
    candidateRevision,
    changeMode: mode,
    changeId: change.id,
    extractedAt,
    changedPaths,
    changedFilePaths,
    symbolsChanged: change.diffSummary.symbolsChanged,
    totalInsertions: change.diffSummary.insertions,
    totalDeletions: change.diffSummary.deletions,
    affectedLanguages,
    hasUnsupportedLanguageFiles,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function deduplicated<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
