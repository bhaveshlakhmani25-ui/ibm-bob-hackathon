/**
 * ChangeExtractor — produces a structured diff from a git repository.
 *
 * Supports three extraction modes:
 *
 *   REVISION      — diff between two explicit git commits/refs
 *                   changeRef.candidateRef is a valid git ref
 *
 *   STAGED        — diff between HEAD and the index (staged files only)
 *                   changeRef.candidateRef === 'STAGED'
 *
 *   WORKING_TREE  — diff between HEAD and the current working tree
 *                   changeRef.candidateRef === 'WORKING_TREE'
 *
 * WORKING_TREE and STAGED are honest representations; they are never stored
 * as fake commit SHAs. Change.candidateRef will be the literal sentinel string.
 *
 * Change.id is derived from normalized diff content (not from repo path):
 *
 *   sha256(
 *     normalizedBaseIdentifier + "\0" +
 *     normalizedCandidateIdentifier + "\0" +
 *     normalizedDiffContent
 *   )
 *
 * normalizedDiffContent is built from the sorted file diffs and hunk content,
 * ensuring that two states with the same paths/counts but different actual
 * changed lines produce different IDs.
 *
 * Owner: Reuben (engine)
 * Phase: R02
 */

import { createHash } from 'crypto';

import type { RepositoryContext, ChangeRef, Change, FileDiff, Hunk, SymbolRef } from '../types.js';
import { EngineError } from '../errors.js';
import { execGit, resolveRef } from '../repository/git.js';
import { detectFileLanguage } from './changeset.js';

// Sentinel values for non-commit change modes
export const SENTINEL_WORKING_TREE = 'WORKING_TREE';
export const SENTINEL_STAGED = 'STAGED';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a structured Change from the repository.
 *
 * Routing:
 *  - candidateRef === 'WORKING_TREE' → working-tree diff (git diff HEAD)
 *  - candidateRef === 'STAGED'       → staged diff (git diff --cached HEAD)
 *  - otherwise                       → revision diff (git diff <base>..<candidate>)
 *
 * @throws EngineError('GIT_REF_NOT_FOUND')  if a supplied ref does not exist
 * @throws EngineError('GIT_DIFF_FAILED')    if git diff exits non-zero
 * @throws EngineError('DIFF_PARSE_FAILED')  if the unified diff cannot be parsed
 */
export async function extractChange(
  repo: RepositoryContext,
  changeRef: ChangeRef,
): Promise<Change> {
  const cwd = repo.localPath;
  const candidate = changeRef.candidateRef;

  if (candidate === SENTINEL_WORKING_TREE) {
    return extractWorkingTreeChange(repo, changeRef, cwd);
  }
  if (candidate === SENTINEL_STAGED) {
    return extractStagedChange(repo, changeRef, cwd);
  }
  return extractRevisionChange(repo, changeRef, cwd);
}

// ---------------------------------------------------------------------------
// Mode: working tree  (git diff HEAD)
// ---------------------------------------------------------------------------

function extractWorkingTreeChange(
  repo: RepositoryContext,
  changeRef: ChangeRef,
  cwd: string,
): Change {
  // Resolve HEAD as the base identifier
  const baseRevision = resolveRef('HEAD', cwd);

  // git diff HEAD — compares HEAD to working tree
  const rawDiff = execGit(['diff', '--unified=3', 'HEAD'], cwd);
  const nameStatus = execGit(['diff', '--name-status', 'HEAD'], cwd);

  const filesChanged = parseDiff(rawDiff, nameStatus);
  const symbolsChanged = extractSymbols(filesChanged);
  const { insertions, deletions } = countInsertionsDeletions(filesChanged);

  const id = buildChangeId(baseRevision, SENTINEL_WORKING_TREE, filesChanged);

  return {
    id,
    baseRef: baseRevision,
    candidateRef: SENTINEL_WORKING_TREE,
    prNumber: changeRef.prNumber,
    diffSummary: { filesChanged, symbolsChanged, insertions, deletions },
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mode: staged  (git diff --cached HEAD)
// ---------------------------------------------------------------------------

function extractStagedChange(
  repo: RepositoryContext,
  changeRef: ChangeRef,
  cwd: string,
): Change {
  const baseRevision = resolveRef('HEAD', cwd);

  // git diff --cached HEAD — compares HEAD to the index
  const rawDiff = execGit(['diff', '--cached', '--unified=3', 'HEAD'], cwd);
  const nameStatus = execGit(['diff', '--cached', '--name-status', 'HEAD'], cwd);

  const filesChanged = parseDiff(rawDiff, nameStatus);
  const symbolsChanged = extractSymbols(filesChanged);
  const { insertions, deletions } = countInsertionsDeletions(filesChanged);

  const id = buildChangeId(baseRevision, SENTINEL_STAGED, filesChanged);

  return {
    id,
    baseRef: baseRevision,
    candidateRef: SENTINEL_STAGED,
    prNumber: changeRef.prNumber,
    diffSummary: { filesChanged, symbolsChanged, insertions, deletions },
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mode: revision  (git diff <base>..<candidate>)
// ---------------------------------------------------------------------------

function extractRevisionChange(
  repo: RepositoryContext,
  changeRef: ChangeRef,
  cwd: string,
): Change {
  // Validate and resolve both refs to full SHAs
  const baseRevision = resolveRef(changeRef.baseRef, cwd);
  const candidateRevision = resolveRef(changeRef.candidateRef, cwd);

  // git diff <base>..<candidate>
  const rawDiff = execGit(
    ['diff', '--unified=3', `${baseRevision}..${candidateRevision}`],
    cwd,
  );
  const nameStatus = execGit(
    ['diff', '--name-status', `${baseRevision}..${candidateRevision}`],
    cwd,
  );

  const filesChanged = parseDiff(rawDiff, nameStatus);
  const symbolsChanged = extractSymbols(filesChanged);
  const { insertions, deletions } = countInsertionsDeletions(filesChanged);

  const id = buildChangeId(baseRevision, candidateRevision, filesChanged);

  return {
    id,
    baseRef: baseRevision,
    candidateRef: candidateRevision,
    prNumber: changeRef.prNumber,
    diffSummary: { filesChanged, symbolsChanged, insertions, deletions },
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Unified diff parser
// ---------------------------------------------------------------------------

/**
 * Parse a unified diff string into FileDiff[].
 *
 * The name-status output is used to determine the accurate changeType and
 * handle renames (R100 / R<similarity>) which the unified diff header
 * does not always represent cleanly.
 *
 * @throws EngineError('DIFF_PARSE_FAILED') if the diff is structurally invalid
 */
function parseDiff(rawDiff: string, nameStatus: string): FileDiff[] {
  // Build a map of path → changeType from --name-status output
  const statusMap = parseNameStatus(nameStatus);

  if (!rawDiff.trim()) {
    // Empty diff is valid — no files changed
    return [];
  }

  // Split into per-file sections on "diff --git" boundaries
  const fileSections = rawDiff.split(/^(?=diff --git )/m).filter(Boolean);

  const fileDiffs: FileDiff[] = [];

  for (const section of fileSections) {
    try {
      const fileDiff = parseFileSection(section, statusMap);
      if (fileDiff) fileDiffs.push(fileDiff);
    } catch (err) {
      throw new EngineError(
        'DIFF_PARSE_FAILED',
        `Failed to parse diff section: ${(err as Error).message}`,
        err,
      );
    }
  }

  return fileDiffs;
}

/**
 * Parse a single "diff --git a/... b/..." section into a FileDiff.
 */
function parseFileSection(
  section: string,
  statusMap: Map<string, { changeType: FileDiff['changeType']; oldPath?: string }>,
): FileDiff | null {
  const lines = section.split('\n');

  // Extract file path(s) from the "diff --git a/<path> b/<path>" header
  const diffHeader = lines[0];
  const headerMatch = diffHeader.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!headerMatch) return null;

  const aPath = headerMatch[1];
  const bPath = headerMatch[2];

  // The canonical "current" path is b-side; for deletions it may only have a-side
  const currentPath = bPath ?? aPath;

  // Look up authoritative status from --name-status
  const statusEntry = statusMap.get(currentPath) ?? statusMap.get(aPath);
  const changeType = statusEntry?.changeType ?? inferChangeTypeFromHeader(lines);
  const oldPath = statusEntry?.oldPath;

  // Parse hunks
  const hunks = parseHunks(lines);

  return {
    path: currentPath,
    ...(oldPath ? { oldPath } : {}),
    changeType,
    hunks,
  };
}

/**
 * Parse `--name-status` output into a map of current-path → { changeType, oldPath? }.
 *
 * Format per line:
 *   A  path/to/added.ts
 *   M  path/to/modified.ts
 *   D  path/to/deleted.ts
 *   R100  old/path.ts  new/path.ts
 *   R80   old/path.ts  new/path.ts
 */
function parseNameStatus(
  nameStatus: string,
): Map<string, { changeType: FileDiff['changeType']; oldPath?: string }> {
  const map = new Map<string, { changeType: FileDiff['changeType']; oldPath?: string }>();

  for (const line of nameStatus.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\t/);
    const status = parts[0];

    if (status === 'A' && parts[1]) {
      map.set(parts[1], { changeType: 'added' });
    } else if (status === 'M' && parts[1]) {
      map.set(parts[1], { changeType: 'modified' });
    } else if (status === 'D' && parts[1]) {
      map.set(parts[1], { changeType: 'deleted' });
    } else if (status.startsWith('R') && parts[1] && parts[2]) {
      // Rename: R<similarity-score> <old-path> <new-path>
      map.set(parts[2], { changeType: 'renamed', oldPath: parts[1] });
    }
    // C (copy) is treated as added for MVP
    else if (status.startsWith('C') && parts[2]) {
      map.set(parts[2], { changeType: 'added' });
    }
  }

  return map;
}

/** Fallback: infer change type from diff header lines when name-status is unavailable */
function inferChangeTypeFromHeader(lines: string[]): FileDiff['changeType'] {
  for (const line of lines) {
    if (line.startsWith('new file mode')) return 'added';
    if (line.startsWith('deleted file mode')) return 'deleted';
    if (line.startsWith('rename from')) return 'renamed';
  }
  return 'modified';
}

/**
 * Parse hunk sections from the lines of a file diff section.
 * Hunks start with `@@ -oldStart,oldLines +newStart,newLines @@`
 */
function parseHunks(lines: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  const hunkContentLines: string[] = [];

  const flushHunk = () => {
    if (currentHunk) {
      currentHunk.content = hunkContentLines.join('\n');
      hunks.push(currentHunk);
      hunkContentLines.length = 0;
      currentHunk = null;
    }
  };

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkHeader) {
      flushHunk();
      currentHunk = {
        oldStart: parseInt(hunkHeader[1], 10),
        oldLines: hunkHeader[2] !== undefined ? parseInt(hunkHeader[2], 10) : 1,
        newStart: parseInt(hunkHeader[3], 10),
        newLines: hunkHeader[4] !== undefined ? parseInt(hunkHeader[4], 10) : 1,
        content: '',
      };
      hunkContentLines.push(line);
    } else if (currentHunk) {
      hunkContentLines.push(line);
    }
  }

  flushHunk();
  return hunks;
}

// ---------------------------------------------------------------------------
// Symbol extraction (regex-based, no LLM)
// ---------------------------------------------------------------------------

/**
 * Extract changed symbols from FileDiff[].
 *
 * Only lines added or removed in hunks are scanned — this focuses on what
 * actually changed, not the entire file.
 *
 * Languages supported with regex extraction:
 *   TypeScript / JavaScript: exported functions, classes, const declarations
 *   Python: top-level def and class statements
 *
 * For all other languages the limitation is represented explicitly by
 * returning no symbols (rather than inventing inaccurate results).
 */
function extractSymbols(fileDiffs: FileDiff[]): SymbolRef[] {
  const symbols: SymbolRef[] = [];
  const seen = new Set<string>();

  for (const fileDiff of fileDiffs) {
    const lang = detectFileLanguage(fileDiff.path);
    const patterns = SYMBOL_PATTERNS[lang];
    if (!patterns) continue; // unsupported language — represent limitation by omission

    for (const hunk of fileDiff.hunks) {
      for (const line of hunk.content.split('\n')) {
        // Only scan added/removed lines
        if (!line.startsWith('+') && !line.startsWith('-')) continue;
        const codeLine = line.slice(1); // strip the +/- prefix

        for (const { pattern, kind } of patterns) {
          const match = codeLine.match(pattern);
          if (match?.[1]) {
            const key = `${fileDiff.path}:${match[1]}:${kind}`;
            if (!seen.has(key)) {
              seen.add(key);
              symbols.push({ file: fileDiff.path, name: match[1], kind });
            }
          }
        }
      }
    }
  }

  return symbols;
}

type SymbolKind = SymbolRef['kind'];

interface SymbolPattern {
  pattern: RegExp;
  kind: SymbolKind;
}

/**
 * Language-specific symbol extraction patterns.
 * Each pattern must capture the symbol name in group 1.
 *
 * Only languages where deterministic regex extraction is reliable are listed.
 * Unsupported languages are absent from this map — callers treat absence as
 * "symbol extraction not available for this language".
 */
const SYMBOL_PATTERNS: Record<string, SymbolPattern[]> = {
  typescript: [
    // export async function name / export function name
    { pattern: /^\s*export\s+(?:async\s+)?function\s+(\w+)/, kind: 'function' },
    // export class Name
    { pattern: /^\s*export\s+class\s+(\w+)/, kind: 'class' },
    // export const name = ...
    { pattern: /^\s*export\s+const\s+(\w+)/, kind: 'variable' },
    // export default function name / export default class Name
    { pattern: /^\s*export\s+default\s+(?:async\s+)?function\s+(\w+)/, kind: 'function' },
    { pattern: /^\s*export\s+default\s+class\s+(\w+)/, kind: 'class' },
    // method definitions inside classes: methodName( or async methodName(
    { pattern: /^\s+(?:async\s+)?(\w+)\s*\(/, kind: 'method' },
  ],
  javascript: [
    { pattern: /^\s*export\s+(?:async\s+)?function\s+(\w+)/, kind: 'function' },
    { pattern: /^\s*export\s+class\s+(\w+)/, kind: 'class' },
    { pattern: /^\s*export\s+const\s+(\w+)/, kind: 'variable' },
    { pattern: /^\s*export\s+default\s+(?:async\s+)?function\s+(\w+)/, kind: 'function' },
    { pattern: /^\s*export\s+default\s+class\s+(\w+)/, kind: 'class' },
    { pattern: /^\s+(?:async\s+)?(\w+)\s*\(/, kind: 'method' },
  ],
  python: [
    // Top-level def name( or async def name(
    { pattern: /^(?:async\s+)?def\s+(\w+)\s*\(/, kind: 'function' },
    // Top-level class Name:
    { pattern: /^class\s+(\w+)[\s:(]/, kind: 'class' },
    // Indented def (method)
    { pattern: /^\s+(?:async\s+)?def\s+(\w+)\s*\(/, kind: 'method' },
  ],
};

// ---------------------------------------------------------------------------
// Change ID — content-based, deterministic
// ---------------------------------------------------------------------------

/**
 * Build a stable Change ID from normalized change content.
 *
 * sha256(
 *   normalizedBaseIdentifier + "\0" +
 *   normalizedCandidateIdentifier + "\0" +
 *   normalizedDiffContent
 * )
 *
 * normalizedDiffContent is built from the sorted file diffs and their hunk
 * content, with trailing whitespace stripped and lines LF-normalized.
 *
 * Two states with identical paths and identical insertion/deletion counts
 * but different actual changed lines will produce different IDs.
 * repo.localPath is never included.
 */
function buildChangeId(
  baseIdentifier: string,
  candidateIdentifier: string,
  fileDiffs: FileDiff[],
): string {
  const normalizedDiffContent = buildNormalizedDiffContent(fileDiffs);

  const input =
    baseIdentifier +
    '\0' +
    candidateIdentifier +
    '\0' +
    normalizedDiffContent;

  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Build a deterministic string from sorted file diffs and their hunks.
 *
 * Format per file (sorted by path):
 *   "<changeType>:<path>(<oldPath>)\n"   — header; oldPath only for renames
 *   "@@ -<os>,<ol> +<ns>,<nl> @@\n"     — per hunk header
 *   <hunk content lines, trailing whitespace stripped, LF-terminated>
 */
function buildNormalizedDiffContent(fileDiffs: FileDiff[]): string {
  const sorted = [...fileDiffs].sort((a, b) => a.path.localeCompare(b.path));
  const parts: string[] = [];

  for (const fd of sorted) {
    const renamedSuffix = fd.oldPath ? `(${fd.oldPath})` : '';
    parts.push(`${fd.changeType}:${fd.path}${renamedSuffix}\n`);

    for (const hunk of fd.hunks) {
      parts.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`);
      // Normalize hunk content: strip trailing whitespace per line, use LF
      const normalizedLines = hunk.content
        .split('\n')
        .map((l) => l.trimEnd())
        .join('\n');
      parts.push(normalizedLines + '\n');
    }
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Insertion / deletion totals
// ---------------------------------------------------------------------------

function countInsertionsDeletions(fileDiffs: FileDiff[]): {
  insertions: number;
  deletions: number;
} {
  let insertions = 0;
  let deletions = 0;

  for (const fd of fileDiffs) {
    for (const hunk of fd.hunks) {
      for (const line of hunk.content.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) insertions++;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
    }
  }

  return { insertions, deletions };
}
