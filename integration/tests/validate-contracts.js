#!/usr/bin/env node
/**
 * Contract validation tests for Change Rehearsal integration layer.
 *
 * Validates all fixtures against their JSON Schema contracts and asserts
 * that intentionally-invalid data is correctly rejected.
 *
 * Run:  node tests/validate-contracts.js
 *       npm test  (from integration/)
 */

"use strict";

const path = require("path");
const fs = require("fs");
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const ROOT = path.resolve(__dirname, "..");

function loadJSON(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
}

const schemas = {
  input: loadJSON("schemas/input-contract.schema.json"),
  result: loadJSON("schemas/rehearsal-result.schema.json"),
  report: loadJSON("schemas/report-contract.schema.json"),
  error: loadJSON("schemas/error-contract.schema.json"),
};

// Compile schemas
const validate = {
  input: ajv.compile(schemas.input),
  result: ajv.compile(schemas.result),
  report: ajv.compile(schemas.report),
  error: ajv.compile(schemas.error),
};

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    if (detail) console.error(`    ${detail}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function validatesOk(validator, data, label) {
  const ok = validator(data);
  const errors = validator.errors ? JSON.stringify(validator.errors, null, 2) : null;
  assert(label, ok, errors);
}

function rejectsInvalid(validator, data, label) {
  const ok = !validator(data);
  assert(label, ok, "Expected validation to fail but it passed.");
}

// ---------------------------------------------------------------------------
// 1. Input contract — valid fixture
// ---------------------------------------------------------------------------

section("1. Input contract — valid fixture");
const validInput = loadJSON("fixtures/valid-input.json");
validatesOk(validate.input, validInput, "valid-input.json passes input-contract.schema.json");

// ---------------------------------------------------------------------------
// 2. Input contract — invalid: missing required fields
// ---------------------------------------------------------------------------

section("2. Input contract — rejection of invalid data");

rejectsInvalid(
  validate.input,
  { contract_version: "0.1" }, // missing change, journeys, protected_behaviors, scenarios
  "Object with only contract_version is rejected (missing required fields)"
);

rejectsInvalid(
  validate.input,
  {
    contract_version: "0.1",
    change: { id: "c1", base_ref: "main", candidate_ref: "f/x", diff_summary: { changed_files: ["a.ts"] }, created_at: "2025-01-01T00:00:00Z" },
    journeys: [],
    protected_behaviors: [],
    scenarios: [
      // deterministic: false must be rejected
      {
        id: "scn-bad",
        journey_id: "jrn-001",
        steps: [{ "ref": "step-001" }],
        deterministic: false
      }
    ]
  },
  "Scenario with deterministic=false is rejected"
);

rejectsInvalid(
  validate.input,
  {
    contract_version: "0.1",
    change: { id: "c1", base_ref: "main", candidate_ref: "f/x", diff_summary: { changed_files: ["a.ts"] }, created_at: "2025-01-01T00:00:00Z" },
    journeys: [
      {
        id: "jrn-001",
        change_id: "c1",
        name: "product-browsing",
        type: "INVALID_TYPE",   // not in enum
        source: "requirement",
        confidence: "confirmed"
      }
    ],
    protected_behaviors: [],
    scenarios: []
  },
  "Journey with invalid type enum value is rejected"
);

rejectsInvalid(
  validate.input,
  {
    contract_version: "0.2",  // wrong version
    change: { id: "c1", base_ref: "main", candidate_ref: "f/x", diff_summary: { changed_files: ["a.ts"] }, created_at: "2025-01-01T00:00:00Z" },
    journeys: [],
    protected_behaviors: [],
    scenarios: []
  },
  "Wrong contract_version '0.2' is rejected"
);

// ---------------------------------------------------------------------------
// 3. Rehearsal result — valid success fixture
// ---------------------------------------------------------------------------

section("3. Rehearsal result — valid success fixture");
const validResult = loadJSON("fixtures/valid-result-success.json");
validatesOk(validate.result, validResult, "valid-result-success.json passes rehearsal-result.schema.json");

// ---------------------------------------------------------------------------
// 4. Rehearsal result — rejection of invalid data
// ---------------------------------------------------------------------------

section("4. Rehearsal result — rejection of invalid data");

rejectsInvalid(
  validate.result,
  { contract_version: "0.1" }, // missing rehearsal_run, observations, etc.
  "Result with only contract_version is rejected"
);

rejectsInvalid(
  validate.result,
  {
    contract_version: "0.1",
    rehearsal_run: {
      id: "run-bad",
      change_id: "c1",
      started_at: "2025-01-01T00:00:00Z",
      status: "UNKNOWN_STATUS"  // not in enum
    },
    observations: [],
    behavioral_differences: [],
    evidence_capsule: {
      id: "cap-bad",
      rehearsal_run_id: "run-bad",
      change_summary: "x",
      journey_refs: ["j1"],
      protected_behavior_refs: [],
      scenario_refs: ["s1"],
      behavioral_difference_refs: [],
      recommendation: "ok",
      generated_at: "2025-01-01T00:00:00Z",
      formats: ["json"]
    }
  },
  "RehearsalRun with invalid status is rejected"
);

rejectsInvalid(
  validate.result,
  {
    contract_version: "0.1",
    rehearsal_run: {
      id: "run-bad",
      change_id: "c1",
      started_at: "2025-01-01T00:00:00Z",
      status: "completed"
    },
    observations: [],
    behavioral_differences: [],
    evidence_capsule: {
      id: "cap-bad",
      rehearsal_run_id: "run-bad",
      change_summary: "x",
      journey_refs: [],            // minItems: 1 violated
      protected_behavior_refs: [],
      scenario_refs: [],           // minItems: 1 violated
      behavioral_difference_refs: [],
      recommendation: "ok",
      generated_at: "2025-01-01T00:00:00Z",
      formats: ["json"]
    }
  },
  "EvidenceCapsule with empty journey_refs and scenario_refs is rejected (minItems: 1)"
);

// ---------------------------------------------------------------------------
// 5. Error contract — valid failure fixture
// ---------------------------------------------------------------------------

section("5. Error contract — valid failure fixture");
const validFailure = loadJSON("fixtures/valid-result-failure.json");
validatesOk(validate.error, validFailure, "valid-result-failure.json passes error-contract.schema.json");

// ---------------------------------------------------------------------------
// 6. Error contract — rejection of invalid data
// ---------------------------------------------------------------------------

section("6. Error contract — rejection of invalid data");

rejectsInvalid(
  validate.error,
  {
    contract_version: "0.1",
    status: "error",
    error_code: "MADE_UP_CODE",   // not in enum
    message: "something broke"
  },
  "Unrecognised error_code is rejected"
);

rejectsInvalid(
  validate.error,
  {
    contract_version: "0.1",
    status: "ok",                // must be 'error'
    error_code: "BUILD_FAILURE",
    message: "build failed"
  },
  "status 'ok' is rejected (must be 'error')"
);

rejectsInvalid(
  validate.error,
  {
    contract_version: "0.1",
    status: "error",
    error_code: "BUILD_FAILURE"
    // missing message
  },
  "Error envelope missing 'message' is rejected"
);

// ---------------------------------------------------------------------------
// 7. Report contract — construct a valid report and validate it
// ---------------------------------------------------------------------------

section("7. Report contract — constructed valid report");

const validReport = {
  contract_version: "0.1",
  rehearsal_run_id: "run-001",
  change_id: "chg-shopflow-001",
  status: "completed",
  exit_code: 1,
  summary: {
    total_scenarios: 2,
    preserved: 1,
    intentional_changes: 0,
    regressions: 1,
    not_exercised: 0
  },
  behavioral_diff_rows: [
    {
      journey_id: "jrn-001",
      journey_name: "inventory-visibility-after-update",
      verdict: "regression",
      confidence_source: "test_derived",
      is_regression: true,
      regression_id: "reg-001",
      evidence_ref: "obs-001"
    },
    {
      journey_id: "jrn-002",
      journey_name: "product-browsing",
      verdict: "preserved",
      confidence_source: "confirmed",
      is_regression: false
    }
  ],
  capsule_ref: {
    json_path: "rehearsal-report.json",
    markdown_path: "rehearsal-report.md"
  },
  pr_comment_posted: false,
  generated_at: "2025-01-15T09:04:30Z"
};

validatesOk(validate.report, validReport, "Constructed valid report passes report-contract.schema.json");

// ---------------------------------------------------------------------------
// 8. Report contract — rejection of invalid data
// ---------------------------------------------------------------------------

section("8. Report contract — rejection of invalid data");

rejectsInvalid(
  validate.report,
  { ...validReport, exit_code: 5 },  // 5 not in [0,1,2,3]
  "Report with exit_code=5 is rejected"
);

rejectsInvalid(
  validate.report,
  {
    ...validReport,
    behavioral_diff_rows: [
      {
        journey_id: "jrn-001",
        journey_name: "inventory-visibility-after-update",
        verdict: "changed",  // old Tier-1 vocabulary — must be rejected
        confidence_source: "test_derived",
        is_regression: true
      }
    ]
  },
  "Report with verdict='changed' (Tier-1 engine vocabulary) is rejected in report contract (F-01)"
);

rejectsInvalid(
  validate.report,
  { ...validReport, status: "running" },  // not in enum
  "Report with status='running' is rejected"
);

rejectsInvalid(
  validate.report,
  { ...validReport, capsule_ref: { json_path: "rehearsal-report.json" } },  // missing markdown_path
  "Report with incomplete capsule_ref is rejected"
);

// ---------------------------------------------------------------------------
// 8b. Report contract — CLI verdict vocabulary is accepted
// ---------------------------------------------------------------------------

section("8b. Report contract — CLI verdict vocabulary accepted");

const validReportCliVerdicts = {
  ...validReport,
  behavioral_diff_rows: [
    {
      journey_id: "jrn-001",
      journey_name: "inventory-visibility-after-update",
      verdict: "regression",
      confidence_source: "test_derived",
      is_regression: true,
      regression_id: "reg-001",
      evidence_ref: "obs-001"
    },
    {
      journey_id: "jrn-002",
      journey_name: "product-browsing",
      verdict: "preserved",
      confidence_source: "confirmed",
      is_regression: false
    },
    {
      journey_id: "jrn-003",
      journey_name: "product-checkout",
      verdict: "intentional_change",
      confidence_source: "test_derived",
      is_regression: false
    }
  ]
};

validatesOk(validate.report, validReportCliVerdicts, "Report with CLI verdicts (regression, preserved, intentional_change) passes schema");

rejectsInvalid(
  validate.report,
  {
    ...validReport,
    behavioral_diff_rows: [
      {
        journey_name: "some-journey",
        verdict: "UNKNOWN_VERDICT",  // not in any enum
        confidence_source: "confirmed"
      }
    ]
  },
  "Report with unrecognised verdict is rejected"
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("═".repeat(50));

if (failed > 0) {
  process.exit(1);
}
