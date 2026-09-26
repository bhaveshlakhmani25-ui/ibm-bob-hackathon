/**
 * extractor.js — CommonJS implementation of the change extractor.
 *
 * Test-layer equivalent of src/engine/change/extractor.ts.
 * Used by the Node.js test harness which cannot run TypeScript directly.
 */

'use strict';

const { createHash } = require('crypto');
const { EngineError, execGit, resolveRef } = require('./git.cjs');

const SENTINEL_WORKING_TREE = 'WORKING_TREE';
const SENTINEL_STAGED = 'STAGED';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function extractChange(repo, changeRef) {
  const cwd = repo.localPath;
  const candidate = changeRef.candidateRef;

  if (candidate === SENTINEL_WORKING_TREE) return extractWorkingTreeChange(repo, changeRef, cwd);
  if (candidate === SENTINEL_STAGED) return extractStagedChange(repo, changeRef, cwd);
  return extractRevisionChange(repo, changeRef, cwd);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function extractWorkingTreeChange(repo, changeRef, cwd) {
  const baseRevision = resolveRef('HEAD', cwd);
  const rawDiff = execGit(['diff', '--unified=3', 'HEAD'], cwd);
  const nameStatus = execGit(['diff', '--name-status', 'HEAD'], cwd);
  const filesChanged = parseDiff(rawDiff, nameStatus);
  const symbolsChanged = extractSymbols(filesChanged);
  const { insertions, deletions } = countInsertionsDeletions(filesChanged);
  const id = buildChangeId(baseRevision, SENTINEL_WORKING_TREE, filesChanged);
  return {
    id, baseRef: baseRevision, candidateRef: SENTINEL_WORKING_TREE,
    prNumber: changeRef.prNumber,
    diffSummary: { filesChanged, symbolsChanged, insertions, deletions },
    createdAt: new Date().toISOString(),
  };
}

function extractStagedChange(repo, changeRef, cwd) {
  const baseRevision = resolveRef('HEAD', cwd);
  const rawDiff = execGit(['diff', '--cached', '--unified=3', 'HEAD'], cwd);
  const nameStatus = execGit(['diff', '--cached', '--name-status', 'HEAD'], cwd);
  const filesChanged = parseDiff(rawDiff, nameStatus);
  const symbolsChanged = extractSymbols(filesChanged);
  const { insertions, deletions } = countInsertionsDeletions(filesChanged);
  const id = buildChangeId(baseRevision, SENTINEL_STAGED, filesChanged);
  return {
    id, baseRef: baseRevision, candidateRef: SENTINEL_STAGED,
    prNumber: changeRef.prNumber,
    diffSummary: { filesChanged, symbolsChanged, insertions, deletions },
    createdAt: new Date().toISOString(),
  };
}

function extractRevisionChange(repo, changeRef, cwd) {
  const baseRevision = resolveRef(changeRef.baseRef, cwd);
  const candidateRevision = resolveRef(changeRef.candidateRef, cwd);
  const rawDiff = execGit(['diff', '--unified=3', `${baseRevision}..${candidateRevision}`], cwd);
  const nameStatus = execGit(['diff', '--name-status', `${baseRevision}..${candidateRevision}`], cwd);
  const filesChanged = parseDiff(rawDiff, nameStatus);
  const symbolsChanged = extractSymbols(filesChanged);
  const { insertions, deletions } = countInsertionsDeletions(filesChanged);
  const id = buildChangeId(baseRevision, candidateRevision, filesChanged);
  return {
    id, baseRef: baseRevision, candidateRef: candidateRevision,
    prNumber: changeRef.prNumber,
    diffSummary: { filesChanged, symbolsChanged, insertions, deletions },
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Diff parser
// ---------------------------------------------------------------------------

function parseDiff(rawDiff, nameStatus) {
  const statusMap = parseNameStatus(nameStatus);
  if (!rawDiff.trim()) return [];

  const fileSections = rawDiff.split(/^(?=diff --git )/m).filter(Boolean);
  const fileDiffs = [];

  for (const section of fileSections) {
    try {
      const fileDiff = parseFileSection(section, statusMap);
      if (fileDiff) fileDiffs.push(fileDiff);
    } catch (err) {
      throw new EngineError('DIFF_PARSE_FAILED', `Failed to parse diff section: ${err.message}`, err);
    }
  }

  return fileDiffs;
}

function parseFileSection(section, statusMap) {
  const lines = section.split('\n');
  const headerMatch = lines[0].match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!headerMatch) return null;

  const aPath = headerMatch[1];
  const bPath = headerMatch[2];
  const currentPath = bPath ?? aPath;

  const statusEntry = statusMap.get(currentPath) ?? statusMap.get(aPath);
  const changeType = statusEntry?.changeType ?? inferChangeTypeFromHeader(lines);
  const oldPath = statusEntry?.oldPath;

  const hunks = parseHunks(lines);

  return { path: currentPath, ...(oldPath ? { oldPath } : {}), changeType, hunks };
}

function parseNameStatus(nameStatus) {
  const map = new Map();
  for (const line of nameStatus.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t/);
    const status = parts[0];
    if (status === 'A' && parts[1]) map.set(parts[1], { changeType: 'added' });
    else if (status === 'M' && parts[1]) map.set(parts[1], { changeType: 'modified' });
    else if (status === 'D' && parts[1]) map.set(parts[1], { changeType: 'deleted' });
    else if (status.startsWith('R') && parts[1] && parts[2])
      map.set(parts[2], { changeType: 'renamed', oldPath: parts[1] });
    else if (status.startsWith('C') && parts[2])
      map.set(parts[2], { changeType: 'added' });
  }
  return map;
}

function inferChangeTypeFromHeader(lines) {
  for (const line of lines) {
    if (line.startsWith('new file mode')) return 'added';
    if (line.startsWith('deleted file mode')) return 'deleted';
    if (line.startsWith('rename from')) return 'renamed';
  }
  return 'modified';
}

function parseHunks(lines) {
  const hunks = [];
  let currentHunk = null;
  const hunkContentLines = [];

  const flushHunk = () => {
    if (currentHunk) {
      currentHunk.content = hunkContentLines.join('\n');
      hunks.push(currentHunk);
      hunkContentLines.length = 0;
      currentHunk = null;
    }
  };

  for (const line of lines) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      flushHunk();
      currentHunk = {
        oldStart: parseInt(m[1], 10),
        oldLines: m[2] !== undefined ? parseInt(m[2], 10) : 1,
        newStart: parseInt(m[3], 10),
        newLines: m[4] !== undefined ? parseInt(m[4], 10) : 1,
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
// Symbol extraction
// ---------------------------------------------------------------------------

function detectFileLanguage(filePath) {
  const ext = (filePath.split('.').pop() ?? '').toLowerCase();
  const map = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    py: 'python', java: 'java', kt: 'kotlin', kts: 'kotlin', go: 'go', rs: 'rust',
    rb: 'ruby', cs: 'csharp', cpp: 'cpp', cc: 'cpp', c: 'c', h: 'c',
    sh: 'shell', bash: 'shell', yaml: 'yaml', yml: 'yaml', json: 'json',
    toml: 'toml', md: 'markdown', sql: 'sql',
  };
  return map[ext] ?? 'unknown';
}

const SYMBOL_PATTERNS = {
  typescript: [
    { pattern: /^\s*export\s+(?:async\s+)?function\s+(\w+)/, kind: 'function' },
    { pattern: /^\s*export\s+class\s+(\w+)/, kind: 'class' },
    { pattern: /^\s*export\s+const\s+(\w+)/, kind: 'variable' },
    { pattern: /^\s*export\s+default\s+(?:async\s+)?function\s+(\w+)/, kind: 'function' },
    { pattern: /^\s*export\s+default\s+class\s+(\w+)/, kind: 'class' },
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
    { pattern: /^(?:async\s+)?def\s+(\w+)\s*\(/, kind: 'function' },
    { pattern: /^class\s+(\w+)[\s:(]/, kind: 'class' },
    { pattern: /^\s+(?:async\s+)?def\s+(\w+)\s*\(/, kind: 'method' },
  ],
};

function extractSymbols(fileDiffs) {
  const symbols = [];
  const seen = new Set();

  for (const fileDiff of fileDiffs) {
    const lang = detectFileLanguage(fileDiff.path);
    const patterns = SYMBOL_PATTERNS[lang];
    if (!patterns) continue;

    for (const hunk of fileDiff.hunks) {
      for (const line of hunk.content.split('\n')) {
        if (!line.startsWith('+') && !line.startsWith('-')) continue;
        const codeLine = line.slice(1);
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

// ---------------------------------------------------------------------------
// Change ID
// ---------------------------------------------------------------------------

function buildChangeId(baseIdentifier, candidateIdentifier, fileDiffs) {
  const normalizedDiffContent = buildNormalizedDiffContent(fileDiffs);
  const input = baseIdentifier + '\0' + candidateIdentifier + '\0' + normalizedDiffContent;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function buildNormalizedDiffContent(fileDiffs) {
  const sorted = [...fileDiffs].sort((a, b) => a.path.localeCompare(b.path));
  const parts = [];

  for (const fd of sorted) {
    const renamedSuffix = fd.oldPath ? `(${fd.oldPath})` : '';
    parts.push(`${fd.changeType}:${fd.path}${renamedSuffix}\n`);
    for (const hunk of fd.hunks) {
      parts.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`);
      const normalizedLines = hunk.content.split('\n').map((l) => l.trimEnd()).join('\n');
      parts.push(normalizedLines + '\n');
    }
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

function countInsertionsDeletions(fileDiffs) {
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

module.exports = { extractChange, SENTINEL_WORKING_TREE, SENTINEL_STAGED };
