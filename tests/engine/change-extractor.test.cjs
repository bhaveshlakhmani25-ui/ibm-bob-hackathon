/**
 * change-extractor.test.js — tests for the change extractor.
 *
 * Exercises the CommonJS implementation in engine-js/extractor.js, which
 * mirrors src/engine/change/extractor.ts exactly. All tests use isolated
 * temporary git repositories — no dependency on the workspace .git state.
 *
 * Covered cases:
 *  - Added file detection
 *  - Modified file detection
 *  - Deleted file detection
 *  - Rename detection
 *  - Revision comparison (base SHA → candidate SHA)
 *  - Invalid revision → GIT_REF_NOT_FOUND
 *  - Working tree changes (WORKING_TREE sentinel)
 *  - Staged changes (STAGED sentinel)
 *  - Hunk content parsed correctly
 *  - Insertion/deletion counts
 *  - Symbol extraction: TypeScript exports, Python defs
 *  - Unknown language: no symbols invented
 *  - D1: identical state → identical Change.id
 *  - D2: same paths + same counts, different content → different Change.id
 *  - WORKING_TREE bonus: same working-tree state → same Change.id
 */

'use strict';

const { suite, assert } = require('./test-runner.cjs');
const { createTmpRepo, cleanupTmpRepo, writeFile, commit, stageFile, git } = require('./git-test-helpers.cjs');
const { extractChange, SENTINEL_WORKING_TREE, SENTINEL_STAGED } = require('./engine-js/extractor.cjs');

// minimal RepositoryContext factory
function makeRepoCtx(dir) {
  return { id: 'repo-test', localPath: dir, language: 'typescript', frameworks: [], defaultBranch: 'main' };
}

// ---------------------------------------------------------------------------
// Suite: file status detection
// ---------------------------------------------------------------------------

suite('ChangeExtractor — file status detection', (test) => {
  test('detects added file', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'package.json', '{}');
      const base = commit(ctx, 'base');
      writeFile(ctx, 'src/new-file.ts', 'export const hello = "world";\n');
      const candidate = commit(ctx, 'add new-file');

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });

      const added = change.diffSummary.filesChanged.find((f) => f.path === 'src/new-file.ts');
      assert.ok(added, 'should include new-file.ts');
      assert.equal(added.changeType, 'added');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('detects modified file', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'app.ts', 'export const x = 1;\n');
      const base = commit(ctx, 'base');
      writeFile(ctx, 'app.ts', 'export const x = 2;\n');
      const candidate = commit(ctx, 'modify app.ts');

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });

      const modified = change.diffSummary.filesChanged.find((f) => f.path === 'app.ts');
      assert.ok(modified, 'should include app.ts');
      assert.equal(modified.changeType, 'modified');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('detects deleted file', async () => {
    const fs = require('fs');
    const path = require('path');
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'to-delete.ts', 'export const gone = true;\n');
      const base = commit(ctx, 'base');

      fs.unlinkSync(path.join(ctx.dir, 'to-delete.ts'));
      git(ctx.dir, ['add', '-A']);
      git(ctx.dir, ['commit', '-m', 'delete file']);
      const candidate = git(ctx.dir, ['rev-parse', 'HEAD']);

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });

      const deleted = change.diffSummary.filesChanged.find((f) => f.path === 'to-delete.ts');
      assert.ok(deleted, 'should include to-delete.ts');
      assert.equal(deleted.changeType, 'deleted');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('detects renamed file', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'old-name.ts', 'export const value = 42;\n');
      const base = commit(ctx, 'base');

      git(ctx.dir, ['mv', 'old-name.ts', 'new-name.ts']);
      git(ctx.dir, ['commit', '-m', 'rename file']);
      const candidate = git(ctx.dir, ['rev-parse', 'HEAD']);

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });

      const renamed = change.diffSummary.filesChanged.find((f) => f.path === 'new-name.ts');
      assert.ok(renamed, 'should include new-name.ts as current path');
      assert.equal(renamed.changeType, 'renamed');
      assert.equal(renamed.oldPath, 'old-name.ts');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: revision comparison
// ---------------------------------------------------------------------------

suite('ChangeExtractor — revision comparison', (test) => {
  test('produces a Change with resolved full SHAs for both refs', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'index.ts', 'export const v = 1;\n');
      const base = commit(ctx, 'base');
      writeFile(ctx, 'index.ts', 'export const v = 2;\n');
      const candidate = commit(ctx, 'update v');

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });

      assert.equal(change.baseRef.length, 40, 'baseRef should be full SHA');
      assert.equal(change.candidateRef.length, 40, 'candidateRef should be full SHA');
      assert.equal(change.baseRef, base);
      assert.equal(change.candidateRef, candidate);
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('resolves relative ref (HEAD~1) to full SHA', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'tsconfig.json', '{}');
      const base = commit(ctx, 'base');
      writeFile(ctx, 'src/a.ts', 'export const a = 1;\n');
      const candidate = commit(ctx, 'add a.ts');

      const change = await extractChange(makeRepoCtx(ctx.dir), {
        baseRef: 'HEAD~1',
        candidateRef: 'HEAD',
      });

      assert.equal(change.baseRef.length, 40, 'should resolve HEAD~1 to full SHA');
      assert.equal(change.baseRef, base);
      assert.equal(change.candidateRef, candidate);
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('throws GIT_REF_NOT_FOUND for an invalid base ref', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'package.json', '{}');
      commit(ctx, 'base');
      await assert.rejects(
        () => extractChange(makeRepoCtx(ctx.dir), {
          baseRef: 'not-a-real-ref-abc123',
          candidateRef: 'HEAD',
        }),
        'GIT_REF_NOT_FOUND',
      );
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('throws GIT_REF_NOT_FOUND for an invalid candidate ref', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'package.json', '{}');
      const base = commit(ctx, 'base');
      await assert.rejects(
        () => extractChange(makeRepoCtx(ctx.dir), {
          baseRef: base,
          candidateRef: 'not-a-real-ref-xyz999',
        }),
        'GIT_REF_NOT_FOUND',
      );
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('returns empty filesChanged for two identical revisions', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'package.json', '{}');
      const sha = commit(ctx, 'only commit');
      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: sha, candidateRef: sha });
      assert.equal(change.diffSummary.filesChanged.length, 0);
      assert.equal(change.diffSummary.insertions, 0);
      assert.equal(change.diffSummary.deletions, 0);
    } finally {
      cleanupTmpRepo(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: working tree and staged modes
// ---------------------------------------------------------------------------

suite('ChangeExtractor — working tree mode', (test) => {
  test('detects unstaged modification, candidateRef is WORKING_TREE sentinel', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'app.ts', 'export const x = 1;\n');
      commit(ctx, 'base');
      writeFile(ctx, 'app.ts', 'export const x = 99;\n'); // unstaged

      const change = await extractChange(makeRepoCtx(ctx.dir), {
        baseRef: 'HEAD',
        candidateRef: SENTINEL_WORKING_TREE,
      });

      assert.equal(change.candidateRef, SENTINEL_WORKING_TREE,
        'candidateRef must be sentinel, not a SHA');
      assert.equal(change.baseRef.length, 40, 'baseRef should be resolved HEAD SHA');
      assert.ok(change.diffSummary.filesChanged.length > 0, 'should detect working tree change');

      const modified = change.diffSummary.filesChanged.find((f) => f.path === 'app.ts');
      assert.ok(modified, 'app.ts should appear in working tree diff');
      assert.equal(modified.changeType, 'modified');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('returns empty diff when working tree is clean', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'app.ts', 'export const x = 1;\n');
      commit(ctx, 'base');
      const change = await extractChange(makeRepoCtx(ctx.dir), {
        baseRef: 'HEAD',
        candidateRef: SENTINEL_WORKING_TREE,
      });
      assert.equal(change.diffSummary.filesChanged.length, 0);
    } finally {
      cleanupTmpRepo(ctx);
    }
  });
});

suite('ChangeExtractor — staged mode', (test) => {
  test('detects staged file, candidateRef is STAGED sentinel', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'existing.ts', 'export const e = 1;\n');
      commit(ctx, 'base');
      writeFile(ctx, 'staged-new.ts', 'export const n = 42;\n');
      stageFile(ctx, 'staged-new.ts');

      const change = await extractChange(makeRepoCtx(ctx.dir), {
        baseRef: 'HEAD',
        candidateRef: SENTINEL_STAGED,
      });

      assert.equal(change.candidateRef, SENTINEL_STAGED,
        'candidateRef must be STAGED sentinel');
      assert.equal(change.baseRef.length, 40, 'baseRef should be resolved HEAD SHA');

      const added = change.diffSummary.filesChanged.find((f) => f.path === 'staged-new.ts');
      assert.ok(added, 'staged-new.ts should appear in staged diff');
      assert.equal(added.changeType, 'added');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('returns empty diff when nothing is staged', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'app.ts', 'export const x = 1;\n');
      commit(ctx, 'base');
      const change = await extractChange(makeRepoCtx(ctx.dir), {
        baseRef: 'HEAD',
        candidateRef: SENTINEL_STAGED,
      });
      assert.equal(change.diffSummary.filesChanged.length, 0);
    } finally {
      cleanupTmpRepo(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: hunk parsing and counts
// ---------------------------------------------------------------------------

suite('ChangeExtractor — hunk parsing and counts', (test) => {
  test('counts insertions and deletions correctly', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'counter.ts', 'line1\nline2\nline3\n');
      const base = commit(ctx, 'base');
      // Delete line2, add two new lines
      writeFile(ctx, 'counter.ts', 'line1\nnew-line-a\nnew-line-b\nline3\n');
      const candidate = commit(ctx, 'edit counter');

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });
      assert.equal(change.diffSummary.deletions, 1, 'should count 1 deletion');
      assert.equal(change.diffSummary.insertions, 2, 'should count 2 insertions');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('populates hunk objects on changed files', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'service.ts', 'export function greet() { return "hello"; }\n');
      const base = commit(ctx, 'base');
      writeFile(ctx, 'service.ts', 'export function greet() { return "hi"; }\n');
      const candidate = commit(ctx, 'update greet');

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });

      const file = change.diffSummary.filesChanged[0];
      assert.ok(file.hunks.length > 0, 'should have at least one hunk');
      assert.ok(typeof file.hunks[0].oldStart === 'number', 'hunk.oldStart should be a number');
      assert.ok(typeof file.hunks[0].content === 'string', 'hunk.content should be a string');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: symbol extraction
// ---------------------------------------------------------------------------

suite('ChangeExtractor — symbol extraction', (test) => {
  test('extracts TypeScript exported function', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'service.ts', '// placeholder\n');
      const base = commit(ctx, 'base');
      writeFile(ctx, 'service.ts', 'export function calculateTotal(items) {\n  return items.length;\n}\n');
      const candidate = commit(ctx, 'add calculateTotal');

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });

      const sym = change.diffSummary.symbolsChanged.find((s) => s.name === 'calculateTotal');
      assert.ok(sym, 'should extract calculateTotal symbol');
      assert.equal(sym.kind, 'function');
      assert.equal(sym.file, 'service.ts');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('extracts TypeScript exported class', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'model.ts', '// placeholder\n');
      const base = commit(ctx, 'base');
      writeFile(ctx, 'model.ts', 'export class UserService {\n  getUser() { return null; }\n}\n');
      const candidate = commit(ctx, 'add UserService');

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });

      const sym = change.diffSummary.symbolsChanged.find((s) => s.name === 'UserService');
      assert.ok(sym, 'should extract UserService symbol');
      assert.equal(sym.kind, 'class');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('extracts Python top-level def', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'utils.py', '# placeholder\n');
      const base = commit(ctx, 'base');
      writeFile(ctx, 'utils.py', 'def compute_discount(price, pct):\n    return price * (1 - pct)\n');
      const candidate = commit(ctx, 'add compute_discount');

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });

      const sym = change.diffSummary.symbolsChanged.find((s) => s.name === 'compute_discount');
      assert.ok(sym, 'should extract compute_discount symbol');
      assert.equal(sym.kind, 'function');
      assert.equal(sym.file, 'utils.py');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('does not invent symbols for unsupported language (.go)', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'main.go', 'package main\n');
      const base = commit(ctx, 'base');
      writeFile(ctx, 'main.go', 'package main\n\nfunc Add(a, b int) int { return a + b }\n');
      const candidate = commit(ctx, 'add go function');

      const change = await extractChange(makeRepoCtx(ctx.dir), { baseRef: base, candidateRef: candidate });

      const goSymbols = change.diffSummary.symbolsChanged.filter((s) => s.file === 'main.go');
      assert.equal(goSymbols.length, 0, 'should not invent symbols for .go files');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: Change ID determinism (D1 and D2)
// ---------------------------------------------------------------------------

suite('ChangeExtractor — Change ID determinism', (test) => {
  // D1: identical state → identical Change.id
  test('D1: identical repository/change state produces identical Change.id', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'app.ts', 'export const version = "1.0";\n');
      const base = commit(ctx, 'base');
      writeFile(ctx, 'app.ts', 'export const version = "2.0";\n');
      const candidate = commit(ctx, 'bump version');

      const changeRef = { baseRef: base, candidateRef: candidate };
      const change1 = await extractChange(makeRepoCtx(ctx.dir), changeRef);
      const change2 = await extractChange(makeRepoCtx(ctx.dir), changeRef);

      assert.equal(change1.id, change2.id, 'D1: same state must produce same Change.id');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  // D2: same paths + same counts, different content → different Change.id
  test('D2: same paths and insertion/deletion counts but different content → different Change.id', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'x.ts', 'const a = 1;\n');
      const base = commit(ctx, 'base');

      // State A: change line to 'const a = 2;'
      writeFile(ctx, 'x.ts', 'const a = 2;\n');
      const candidateA = commit(ctx, 'state A');
      const changeA = await extractChange(makeRepoCtx(ctx.dir), {
        baseRef: base,
        candidateRef: candidateA,
      });

      // Reset x.ts to base content via git checkout
      git(ctx.dir, ['checkout', base, '--', 'x.ts']);

      // State B: change line to 'const a = 3;' (same path, same counts)
      writeFile(ctx, 'x.ts', 'const a = 3;\n');
      const candidateB = commit(ctx, 'state B');
      const changeB = await extractChange(makeRepoCtx(ctx.dir), {
        baseRef: base,
        candidateRef: candidateB,
      });

      // Verify preconditions: same path, same insertions/deletions
      assert.equal(changeA.diffSummary.filesChanged.length, 1);
      assert.equal(changeB.diffSummary.filesChanged.length, 1);
      assert.equal(changeA.diffSummary.insertions, changeB.diffSummary.insertions,
        'test precondition: insertions must be equal');
      assert.equal(changeA.diffSummary.deletions, changeB.diffSummary.deletions,
        'test precondition: deletions must be equal');
      assert.equal(
        changeA.diffSummary.filesChanged[0].path,
        changeB.diffSummary.filesChanged[0].path,
        'test precondition: changed paths must match',
      );

      // The IDs must differ because actual diff content differs
      assert.notEqual(changeA.id, changeB.id,
        'D2: different diff content must produce different Change.id');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  // Bonus: WORKING_TREE same state → same ID
  test('WORKING_TREE: identical working-tree state produces same Change.id', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'app.ts', 'export const x = 1;\n');
      commit(ctx, 'base');
      writeFile(ctx, 'app.ts', 'export const x = 999;\n'); // unstaged

      const ref = { baseRef: 'HEAD', candidateRef: SENTINEL_WORKING_TREE };
      const c1 = await extractChange(makeRepoCtx(ctx.dir), ref);
      const c2 = await extractChange(makeRepoCtx(ctx.dir), ref);

      assert.equal(c1.id, c2.id, 'working tree IDs must match for same content');
      assert.equal(c1.candidateRef, SENTINEL_WORKING_TREE);
    } finally {
      cleanupTmpRepo(ctx);
    }
  });
});
