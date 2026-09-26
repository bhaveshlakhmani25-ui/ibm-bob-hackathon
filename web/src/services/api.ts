import type {
  StartRehearsalRequest,
  StartRehearsalResponse,
  RehearsalStatusResponse,
  RehearsalPhase,
  RehearsalReport,
} from "../../../src/shared/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The UI treats "queued" as a pre-phase before the engine picks up the run.
// It is not part of RehearsalPhase in the contract (the contract starts at
// loading_repository), so we keep it as a UI-only concept here.
export type UiPhase = RehearsalPhase | "queued";

// ---------------------------------------------------------------------------
// MOCK: In-memory run store
// ---------------------------------------------------------------------------

interface MockRun {
  status: RehearsalStatusResponse;
  startedAt: number; // epoch ms — used to compute deterministic phase
}

let mockRun: MockRun | null = null;
let mockRunId: string | null = null;

// MOCK: Simulate a realistic phase timeline.
// Each phase gets ~1.5 s. Total happy-path duration: ~16.5 s.
// Replace with real API call when Reuben's engine is available.
const MOCK_PHASE_TIMELINE: RehearsalPhase[] = [
  "extracting_change",
  "loading_repository",
  "compiling_journeys",
  "analyzing_impact",
  "resolving_protected_behaviors",
  "planning_scenarios",
  "running_baseline",
  "running_candidate",
  "comparing",
  "generating_report",
  "completed",
];
const MOCK_MS_PER_PHASE = 1500;

function computeMockPhase(startedAt: number): RehearsalPhase {
  const elapsed = Date.now() - startedAt;
  const idx = Math.min(
    Math.floor(elapsed / MOCK_MS_PER_PHASE),
    MOCK_PHASE_TIMELINE.length - 1,
  );
  return MOCK_PHASE_TIMELINE[idx] as RehearsalPhase;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * POST /api/rehearsals
 *
 * MOCK: Returns immediately with a generated run_id.
 * Replace the body of this function with a real fetch() call when the engine
 * is available.
 */
export const startRehearsal = async (
  req: StartRehearsalRequest,
): Promise<StartRehearsalResponse> => {
  await delay(1200); // MOCK: simulate network + initial validation latency

  if (!req.requirement || req.requirement.trim() === "") {
    throw new Error("Requirement intent cannot be empty.");
  }

  // MOCK: allow deterministic simulation of terminal failure scenarios via
  // special keywords in the requirement text. These will be replaced by real
  // engine responses when Reuben's engine is ready.
  if (req.requirement.toLowerCase().includes("fail")) {
    throw new Error("Simulated backend rejection for invalid requirement.");
  }

  const run_id = `CR-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
  const started_at = new Date().toISOString();

  mockRunId = run_id;
  mockRun = {
    status: {
      run_id,
      status: "running",
      phase: "extracting_change",
      started_at,
      baseline_build_status: "pending",
      candidate_build_status: "pending",
    },
    startedAt: Date.now(),
  };

  // MOCK: schedule terminal state injection based on requirement keywords.
  // These simulate the outcomes Reuben's engine would actually return.
  if (req.requirement.toLowerCase().includes("regression")) {
    // MOCK: inject a regression failure after ~8 s (mid-pipeline)
    setTimeout(() => {
      if (mockRun) {
        mockRun.status.status = "failed";
        mockRun.status.phase = "comparing";
        mockRun.status.completed_at = new Date().toISOString();
        mockRun.status.error =
          "Regression detected: Inventory freshness check failed. " +
          "Cached product response returned stale stock count.";
        mockRun.status.error_code = "SCENARIO_GENERATION_FAILURE";
      }
    }, 8000);
  } else if (req.requirement.toLowerCase().includes("build")) {
    // MOCK: inject a build failure after ~3 s
    setTimeout(() => {
      if (mockRun) {
        mockRun.status.status = "build_failed";
        mockRun.status.phase = "running_baseline";
        mockRun.status.completed_at = new Date().toISOString();
        mockRun.status.candidate_build_status = "failed";
        mockRun.status.error =
          "Candidate build failed: TypeScript compilation error in CacheService.ts at line 42.";
        mockRun.status.error_code = "BUILD_FAILURE";
      }
    }, 3000);
  } else if (req.requirement.toLowerCase().includes("config")) {
    // MOCK: inject a configuration error after ~2 s
    setTimeout(() => {
      if (mockRun) {
        mockRun.status.status = "failed";
        mockRun.status.phase = "extracting_change";
        mockRun.status.completed_at = new Date().toISOString();
        mockRun.status.error =
          "Configuration error: REHEARSAL_API_URL is not set. " +
          "Check your .env file and ensure the rehearsal engine is configured.";
        mockRun.status.error_code = "INVALID_INPUT_CONTRACT";
      }
    }, 2000);
  }

  return { run_id, status: "started", started_at };
};

/**
 * GET /api/rehearsals/:id/status
 *
 * MOCK: Returns a deterministically-progressing status derived from elapsed
 * time. Replace with a real fetch() call when the engine is available.
 */
export const getRehearsalStatus = async (
  runId: string,
): Promise<RehearsalStatusResponse> => {
  await delay(400); // MOCK: simulate network round-trip

  if (runId !== mockRunId || !mockRun) {
    throw new Error(`Rehearsal not found: ${runId}`);
  }

  // If a terminal state was injected (regression/build_failed/config keyword),
  // return it as-is without advancing the phase.
  const { status } = mockRun;
  if (
    status.status === "completed" ||
    status.status === "failed" ||
    status.status === "build_failed"
  ) {
    return { ...status };
  }

  // MOCK: advance the phase based on elapsed time.
  const phase = computeMockPhase(mockRun.startedAt);
  mockRun.status.phase = phase;

  if (phase === "completed") {
    mockRun.status.status = "completed";
    mockRun.status.completed_at = new Date().toISOString();
    mockRun.status.baseline_build_status = "success";
    mockRun.status.candidate_build_status = "success";
  } else if (phase !== "extracting_change") {
    // After the first phase both builds are known-good in the happy path
    mockRun.status.baseline_build_status = "success";
    mockRun.status.candidate_build_status = "success";
  }

  return { ...mockRun.status };
};

/**
 * GET /api/rehearsals/:id/report
 *
 * MOCK: Returns a deterministic RehearsalReport typed exactly against the
 * canonical contracts (§4.3). All five Tier-2 verdict values are represented.
 * Replace with a real fetch() call when Reuben's comparator is available.
 *
 * Mock data is isolated here and not used by any other path.
 */
export const getRehearsalReport = async (
  runId: string,
): Promise<RehearsalReport> => {
  await delay(600); // MOCK: simulate network round-trip

  if (runId !== mockRunId || !mockRun) {
    throw new Error(`Rehearsal not found: ${runId}`);
  }

  if (mockRun.status.status !== "completed") {
    throw new Error(`Report not ready. Status: ${mockRun.status.status}`);
  }

  // Return test-injected override if present (used by unit tests)
  const override = (mockRun as MockRun & { _reportOverride?: RehearsalReport })._reportOverride;
  if (override) return override;

  // ---------------------------------------------------------------------------
  // MOCK REPORT — deterministic, isolated, typed against contracts
  // Replace all fields below with real engine output when Reuben's comparator
  // is wired in. Do not reference this data outside of this function.
  // ---------------------------------------------------------------------------
  const report: RehearsalReport = {
    run_id: runId,
    change: {
      base_ref: "main",
      candidate_ref: "feature/product-cache",
      diff_summary: "Added Redis caching to the product retrieval API path.",
      affected_files: [
        "src/services/ProductService.ts",
        "src/services/CacheService.ts",
      ],
    },
    requirement: {
      text: "Add caching to Product API to improve response time.",
      source: "free_text",
    },
    intent: {
      description: "Improve Product API response time via caching",
      expected_changes: [
        "Product API response path gains Redis caching",
        "Cache miss falls back to DB as before",
      ],
    },
    journeys: [
      {
        id: "j-1",
        name: "Fetch Product Details",
        description: "GET /products/:id returns product with current stock.",
        type: "api",
        source: "requirement",
        confidence: "test_derived",
        steps: [],
      },
      {
        id: "j-2",
        name: "Update Inventory Stock",
        description: "POST /inventory/:id updates stock and subsequent GET reflects new value.",
        type: "api",
        source: "impact",
        confidence: "contract_derived",
        steps: [],
      },
      {
        id: "j-3",
        name: "Add Item to Cart",
        description: "PUT /cart/:id/:product_id succeeds and cart reflects item.",
        type: "user",
        source: "inferred",
        confidence: "test_derived",
        steps: [],
      },
      {
        id: "j-4",
        name: "User Login",
        description: "POST /auth/login returns a session token.",
        type: "user",
        source: "inferred",
        confidence: "inferred",
        steps: [],
      },
      {
        id: "j-5",
        name: "Checkout Process",
        description: "Full checkout: add to cart → confirm → receive order ID.",
        type: "user",
        source: "impact",
        confidence: "inferred",
        steps: [],
      },
    ],
    protected_behaviors: [
      {
        id: "pb-1",
        description: "GET /products/:id returns correct cached response after first load.",
        source: "inferred",
        confidence: 0.95,
        related_code_refs: ["src/services/ProductService.ts:fetchProduct"],
      },
      {
        id: "pb-2",
        description: "GET /products/:id always reflects the latest inventory stock after an update.",
        source: "contract_derived",
        confidence: 1.0,
        related_code_refs: ["src/services/ProductService.ts:fetchProduct", "src/services/CacheService.ts:invalidate"],
      },
      {
        id: "pb-3",
        description: "Cart operations are unaffected by product caching changes.",
        source: "test_derived",
        confidence: 0.98,
        related_code_refs: ["src/services/CartService.ts:addItem"],
      },
      {
        id: "pb-5",
        description: "Checkout price calculation uses current product price.",
        source: "inferred",
        confidence: 0.60,
        related_code_refs: ["src/services/CheckoutService.ts:calculateTotal"],
      },
    ],
    regressions: [
      {
        id: "reg-1",
        behavioral_difference_id: "bd-2",
        journey_id: "j-2",
        journey_name: "Update Inventory Stock",
        protected_behavior_id: "pb-2",
        protected_behavior_description:
          "GET /products/:id always reflects the latest inventory stock after an update.",
        severity: "high",
        recommended_action:
          "Invalidate the Redis cache entry for the product on every inventory write in CacheService.ts, or bypass cache for stock reads.",
        evidence: {
          scenario_id: "sc-2",
          baseline_observation: {
            side: "baseline",
            raw_output: JSON.stringify({ status: 200, body: { id: "product-99", name: "Widget", stock: 3, price: 9.99 } }),
            normalized_output: { status: 200, body: { id: "product-99", name: "Widget", stock: 3, price: 9.99 } },
            captured_at: "2025-01-15T09:02:10Z",
          },
          candidate_observation: {
            side: "candidate",
            raw_output: JSON.stringify({ status: 200, body: { id: "product-99", name: "Widget", stock: 10, price: 9.99 } }),
            normalized_output: { status: 200, body: { id: "product-99", name: "Widget", stock: 10, price: 9.99 } },
            captured_at: "2025-01-15T09:02:25Z",
          },
          reproduction_steps: [
            "POST /inventory/product-99 with { stock: 3 }",
            "GET /products/product-99",
            "Observe candidate returns stale stock=10 instead of 3",
          ],
          affected_files: [
            "src/services/CacheService.ts",
            "src/services/ProductService.ts",
          ],
        },
      },
    ],
    generated_at: new Date().toISOString(),
    summary: {
      total_journeys: 5,
      total_scenarios: 5,
      preserved: 1,
      intentional_changes: 1,
      regressions: 1,
      not_exercised: 1,
      potentially_affected: 1,
      verdict: "review_required",
    },
    behavioral_diff: [
      {
        journey_id: "j-1",
        journey_name: "Fetch Product Details",
        verdict: "intentional_change",
        protected_behavior_id: "pb-1",
        protected_behavior_source: "inferred",
        protected_behavior_confidence: 0.95,
        is_expected_change: true,
        scenario_id: "sc-1",
      },
      {
        journey_id: "j-2",
        journey_name: "Update Inventory Stock",
        verdict: "regression",
        protected_behavior_id: "pb-2",
        protected_behavior_source: "contract_derived",
        protected_behavior_confidence: 1.0,
        is_expected_change: false,
        scenario_id: "sc-2",
        evidence_id: "reg-1",
      },
      {
        journey_id: "j-3",
        journey_name: "Add Item to Cart",
        verdict: "preserved",
        protected_behavior_id: "pb-3",
        protected_behavior_source: "test_derived",
        protected_behavior_confidence: 0.98,
        is_expected_change: false,
        scenario_id: "sc-3",
      },
      {
        journey_id: "j-4",
        journey_name: "User Login",
        verdict: "not_exercised",
        is_expected_change: false,
      },
      {
        journey_id: "j-5",
        journey_name: "Checkout Process",
        verdict: "potentially_affected",
        protected_behavior_id: "pb-5",
        protected_behavior_source: "inferred",
        protected_behavior_confidence: 0.60,
        is_expected_change: false,
      },
    ],
  };

  return report;
};

// ---------------------------------------------------------------------------
// Exported for tests only
// ---------------------------------------------------------------------------

/** Reset mock state. Used in tests to isolate runs. */
export function _resetMockState(): void {
  mockRun = null;
  mockRunId = null;
}

/** Directly set mock run state. Used in tests. */
export function _setMockRunState(
  runId: string,
  status: RehearsalStatusResponse,
): void {
  mockRunId = runId;
  mockRun = { status: { ...status }, startedAt: Date.now() };
}

/**
 * Override the report returned by getRehearsalReport for a given runId.
 * Used in tests to inject specific RehearsalReport fixtures.
 */
export function _setMockReportState(
  runId: string,
  report: RehearsalReport,
): void {
  mockRunId = runId;
  mockRun = {
    status: {
      run_id: runId,
      status: "completed",
      phase: "completed",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      baseline_build_status: "success",
      candidate_build_status: "success",
    },
    startedAt: Date.now(),
  };
  // Store report override on the mock run object (type-extended for tests)
  (mockRun as MockRun & { _reportOverride?: RehearsalReport })._reportOverride = report;
}
