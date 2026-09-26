/**
 * repository-loader.test.js — tests for the repository loader.
 *
 * Exercises the CommonJS implementation in engine-js/loader.js, which mirrors
 * src/engine/repository/loader.ts exactly. All tests use isolated temporary
 * git repositories — no dependency on the workspace .git state.
 *
 * Covered cases:
 *  - Valid repository → returns RepositoryContext
 *  - Language detection: TypeScript, JavaScript, Python, Go
 *  - Framework detection from package.json / requirements.txt
 *  - Invalid (non-existent) path → REPOSITORY_NOT_FOUND
 *  - Existing directory that is not a git repo → REPOSITORY_NOT_FOUND
 *  - No supported language indicator → UNSUPPORTED_LANGUAGE
 *  - defaultBranch is populated
 *  - id is stable across two calls on the same repo
 */

'use strict';

const { suite, assert } = require('./test-runner.cjs');
const { createTmpRepo, cleanupTmpRepo, writeFile, commit } = require('./git-test-helpers.cjs');
const { loadRepository } = require('./engine-js/loader.cjs');

// ---------------------------------------------------------------------------

suite('RepositoryLoader — valid repositories', (test) => {
  test('loads a valid git repo and returns RepositoryContext', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'tsconfig.json', '{}');
      commit(ctx, 'init');
      const result = await loadRepository({ localPath: ctx.dir });
      assert.ok(result.id, 'id should be populated');
      assert.equal(result.localPath, ctx.dir);
      assert.equal(result.language, 'typescript');
      assert.ok(typeof result.defaultBranch === 'string' && result.defaultBranch.length > 0,
        'defaultBranch should be a non-empty string');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('detects TypeScript via tsconfig.json', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'tsconfig.json', '{"compilerOptions":{}}');
      commit(ctx, 'init');
      const result = await loadRepository({ localPath: ctx.dir });
      assert.equal(result.language, 'typescript');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('detects JavaScript via package.json without typescript dep', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'package.json', JSON.stringify({ name: 'test', dependencies: { express: '^4' } }));
      commit(ctx, 'init');
      const result = await loadRepository({ localPath: ctx.dir });
      assert.equal(result.language, 'javascript');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('detects TypeScript via package.json with typescript devDependency', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'package.json', JSON.stringify({
        name: 'test', devDependencies: { typescript: '^5' },
      }));
      commit(ctx, 'init');
      const result = await loadRepository({ localPath: ctx.dir });
      assert.equal(result.language, 'typescript');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('detects Python via requirements.txt', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'requirements.txt', 'fastapi\nuvicorn\n');
      commit(ctx, 'init');
      const result = await loadRepository({ localPath: ctx.dir });
      assert.equal(result.language, 'python');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('detects Python frameworks from requirements.txt', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'requirements.txt', 'fastapi\npytest\n');
      commit(ctx, 'init');
      const result = await loadRepository({ localPath: ctx.dir });
      assert.includes(result.frameworks, 'fastapi');
      assert.includes(result.frameworks, 'pytest');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('detects Go via go.mod', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'go.mod', 'module example.com/myapp\n\ngo 1.21\n');
      commit(ctx, 'init');
      const result = await loadRepository({ localPath: ctx.dir });
      assert.equal(result.language, 'go');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('detects express framework from package.json', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'package.json', JSON.stringify({
        name: 'test', dependencies: { express: '^4.18.0' },
      }));
      commit(ctx, 'init');
      const result = await loadRepository({ localPath: ctx.dir });
      assert.includes(result.frameworks, 'express');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('id is stable across two calls on the same repo', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'tsconfig.json', '{}');
      commit(ctx, 'init');
      const r1 = await loadRepository({ localPath: ctx.dir });
      const r2 = await loadRepository({ localPath: ctx.dir });
      assert.equal(r1.id, r2.id, 'repository id should be stable');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });

  test('defaultBranch reflects the current branch (main)', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'package.json', '{}');
      commit(ctx, 'init');
      const result = await loadRepository({ localPath: ctx.dir });
      assert.equal(result.defaultBranch, 'main');
    } finally {
      cleanupTmpRepo(ctx);
    }
  });
});

suite('RepositoryLoader — error cases', (test) => {
  test('throws REPOSITORY_NOT_FOUND for a non-existent path', async () => {
    await assert.rejects(
      () => loadRepository({ localPath: '/this/path/does/not/exist/cr-test-12345' }),
      'REPOSITORY_NOT_FOUND',
    );
  });

  test('throws REPOSITORY_NOT_FOUND for a directory that is not a git repo', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-notgit-'));
    try {
      await assert.rejects(
        () => loadRepository({ localPath: tmpDir }),
        'REPOSITORY_NOT_FOUND',
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('throws UNSUPPORTED_LANGUAGE when no language indicator is found', async () => {
    const ctx = createTmpRepo();
    try {
      writeFile(ctx, 'README.md', '# Test\n');
      commit(ctx, 'init');
      await assert.rejects(
        () => loadRepository({ localPath: ctx.dir }),
        'UNSUPPORTED_LANGUAGE',
      );
    } finally {
      cleanupTmpRepo(ctx);
    }
  });
});
