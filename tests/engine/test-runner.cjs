/**
 * test-runner.js — zero-dependency test runner for the Change Rehearsal engine.
 *
 * No npm packages required. Uses only Node.js built-ins.
 *
 * API:
 *   const { suite, run } = require('./test-runner');
 *   suite('My suite', (test) => {
 *     test('something works', () => { ... });                  // sync
 *     test('something async', async () => { ... });            // async
 *   });
 *   run().then(ok => process.exit(ok ? 0 : 1));
 *
 * Assertions: throw an Error (or use the assert module) to fail a test.
 */

'use strict';

const suites = [];

/**
 * Register a test suite.
 * @param {string} name
 * @param {(test: Function) => void} fn
 */
function suite(name, fn) {
  const tests = [];
  fn((testName, testFn) => tests.push({ name: testName, fn: testFn }));
  suites.push({ name, tests });
}

/**
 * Run all registered suites.
 * @returns {Promise<boolean>} true if all tests passed
 */
async function run() {
  let passed = 0;
  let failed = 0;

  for (const s of suites) {
    console.log(`\n  ${s.name}`);
    for (const t of s.tests) {
      try {
        await Promise.resolve(t.fn());
        console.log(`    ✓ ${t.name}`);
        passed++;
      } catch (err) {
        console.log(`    ✗ ${t.name}`);
        console.log(`      ${err.message}`);
        if (err.stack) {
          // Print only the first relevant stack frame (not the runner itself)
          const frames = err.stack.split('\n').slice(1, 4).join('\n');
          console.log(`      ${frames}`);
        }
        failed++;
      }
    }
  }

  const total = passed + failed;
  console.log(`\n  ${passed}/${total} tests passed${failed > 0 ? `, ${failed} failed` : ''}\n`);
  return failed === 0;
}

/**
 * Simple assertion helpers (augment as needed).
 */
const assert = {
  equal(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(
        msg ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  },
  notEqual(actual, unexpected, msg) {
    if (actual === unexpected) {
      throw new Error(
        msg ?? `Expected values to differ, both were ${JSON.stringify(actual)}`,
      );
    }
  },
  deepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual, null, 0);
    const e = JSON.stringify(expected, null, 0);
    if (a !== e) {
      throw new Error(msg ?? `Deep equal failed.\n  Expected: ${e}\n  Actual:   ${a}`);
    }
  },
  ok(value, msg) {
    if (!value) throw new Error(msg ?? `Expected truthy value, got ${JSON.stringify(value)}`);
  },
  throws(fn, expectedCode, msg) {
    let threw = false;
    try {
      fn();
    } catch (err) {
      threw = true;
      if (expectedCode && err.code !== expectedCode) {
        throw new Error(
          msg ??
            `Expected EngineError code '${expectedCode}', got '${err.code ?? err.message}'`,
        );
      }
    }
    if (!threw) throw new Error(msg ?? 'Expected function to throw, but it did not');
  },
  async rejects(fn, expectedCode, msg) {
    let threw = false;
    try {
      await fn();
    } catch (err) {
      threw = true;
      if (expectedCode && err.code !== expectedCode) {
        throw new Error(
          msg ??
            `Expected EngineError code '${expectedCode}', got '${err.code ?? err.message}'`,
        );
      }
    }
    if (!threw) throw new Error(msg ?? 'Expected async function to reject, but it resolved');
  },
  includes(haystack, needle, msg) {
    if (typeof haystack === 'string') {
      if (!haystack.includes(needle)) {
        throw new Error(msg ?? `Expected string to include '${needle}'`);
      }
    } else if (Array.isArray(haystack)) {
      if (!haystack.includes(needle)) {
        throw new Error(msg ?? `Expected array to include ${JSON.stringify(needle)}`);
      }
    } else {
      throw new Error('assert.includes: unsupported type');
    }
  },
};

module.exports = { suite, run, assert };
