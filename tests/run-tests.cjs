/**
 * run-tests.js — entry point for the Change Rehearsal engine test suite.
 *
 * Usage:
 *   node tests/run-tests.js
 *
 * Returns exit code 0 if all tests pass, 1 if any fail.
 *
 * No npm packages required — pure Node.js built-ins only.
 */

'use strict';

// Load all test suites (they register themselves on require)
require('./engine/repository-loader.test.cjs');
require('./engine/change-extractor.test.cjs');

// Run
const { run } = require('./engine/test-runner.cjs');

run().then((ok) => {
  process.exit(ok ? 0 : 1);
}).catch((err) => {
  console.error('Test runner failed unexpectedly:', err);
  process.exit(1);
});
