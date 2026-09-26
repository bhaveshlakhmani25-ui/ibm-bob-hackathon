/**
 * Mock Engine — Deterministic ShopFlow caching scenario.
 *
 * Implements the Change Rehearsal API surface (§4.1, §4.2, §4.3) with
 * static fixtures so the CLI/UI layer can be developed and tested before
 * Reuben's engine is ready.
 *
 * Produces:
 *   4 journeys
 *   2 protected behaviors
 *   1 regression (Inventory freshness — ✗)
 *   1 not_exercised (Product → Checkout)
 *   2 preserved
 *
 * Behavior flagged as MOCK:
 *   - run_id is a deterministic UUID
 *   - Phase progression is time-based (simulates real pipeline timing)
 *   - Final status is always "completed" after ~12s
 *
 * When Reuben's engine is ready, replace REHEARSAL_API_URL in the
 * environment and this mock is bypassed automatically.
 */
import http from "node:http";
import type {
  StartRehearsalResponse,
  RehearsalStatusResponse,
  RehearsalReport,
  RehearsalPhase,
} from "../../shared/contracts.js";

const PORT = 3001;

// ---------------------------------------------------------------------------
// In-memory run store (keyed by run_id)
// ---------------------------------------------------------------------------

interface RunEntry {
  run_id: string;
  started_at: string;
  request: unknown;
}

const runs = new Map<string, RunEntry>();

// ---------------------------------------------------------------------------
// ShopFlow fixture
// ---------------------------------------------------------------------------

const SHOPFLOW_REPORT: Omit<RehearsalReport, "rehearsal_run_id"> = {
  change: {
    base_ref: "main",
    candidate_ref: "feature/product-cache",
    diff_summary:
      "Added Redis-based response caching to ProductController.getById() and ProductController.list().",
    affected_files: [
      "src/controllers/ProductController.ts",
      "src/services/CacheService.ts",
      "src/config/redis.ts",
    ],
  },
  requirement: {
    text: "Add caching to the Product API to improve response time.",
    source: "free_text",
  },
  intent: {
    description: "Improve Product API response time",
    expected_changes: ["Product API response path gains caching"],
  },
  journeys: [
    {
      id: "j1",
      name: "Product browsing",
      description: "User browses product catalog",
      type: "user",
      source: "impact",
      confidence: "test_derived",
      steps: [
        {
          id: "s1",
          sequence: 1,
          action_type: "http",
          description: "GET /api/products — list all products",
          input: { method: "GET", path: "/api/products" },
          expected_hint: "200 OK with product array",
        },
        {
          id: "s2",
          sequence: 2,
          action_type: "http",
          description: "GET /api/products/42 — view product detail",
          input: { method: "GET", path: "/api/products/42" },
          expected_hint: "200 OK with product object",
        },
      ],
    },
    {
      id: "j2",
      name: "Product → Inventory",
      description: "System checks live inventory after product fetch",
      type: "system",
      source: "requirement",
      confidence: "confirmed",
      steps: [
        {
          id: "s3",
          sequence: 1,
          action_type: "http",
          description: "GET /api/products/42 — fetch product (now cached)",
          input: { method: "GET", path: "/api/products/42" },
          expected_hint: "200 OK",
        },
        {
          id: "s4",
          sequence: 2,
          action_type: "http",
          description: "GET /api/inventory/42 — check live stock",
          input: { method: "GET", path: "/api/inventory/42" },
          expected_hint: "Stock count > 0",
        },
      ],
    },
    {
      id: "j3",
      name: "Product → Cart",
      description: "User adds product to cart",
      type: "user",
      source: "impact",
      confidence: "test_derived",
      steps: [
        {
          id: "s5",
          sequence: 1,
          action_type: "http",
          description: "POST /api/cart — add product to cart",
          input: { method: "POST", path: "/api/cart", body: { productId: "42", qty: 1 } },
          expected_hint: "201 Created",
        },
      ],
    },
    {
      id: "j4",
      name: "Product → Checkout",
      description: "User proceeds to checkout from product page",
      type: "user",
      source: "impact",
      confidence: "inferred",
      steps: [],
    },
  ],
  protected_behaviors: [
    {
      id: "pb1",
      description: "Inventory freshness: displayed stock must reflect live warehouse count",
      source: "test_derived",
      confidence: 0.95,
      workflow_name: "inventory-freshness-check",
      related_code_refs: ["src/services/InventoryService.ts", "tests/inventory.test.ts"],
    },
    {
      id: "pb2",
      description: "Price accuracy: product price must match the pricing engine output",
      source: "confirmed",
      confidence: 1.0,
      workflow_name: "price-accuracy-check",
      related_code_refs: ["src/services/PricingService.ts"],
    },
  ],
  behavioral_diff_rows: [
    {
      journey_id: "j1",
      journey_name: "Product browsing",
      verdict: "preserved",
      protected_behavior_source: "test_derived",
      is_expected_change: false,
    },
    {
      journey_id: "j2",
      journey_name: "Product → Inventory",
      verdict: "regression",
      protected_behavior_id: "pb1",
      protected_behavior_source: "test_derived",
      is_expected_change: false,
      scenario_id: "sc2",
      evidence_id: "ev2",
    },
    {
      journey_id: "j3",
      journey_name: "Product → Cart",
      verdict: "preserved",
      protected_behavior_source: "test_derived",
      is_expected_change: false,
    },
    {
      journey_id: "j4",
      journey_name: "Product → Checkout",
      verdict: "not_exercised",
      protected_behavior_source: "inferred",
      is_expected_change: false,
    },
  ],
  regressions: [
    {
      id: "r1",
      behavioral_difference_id: "bd2",
      journey_id: "j2",
      journey_name: "Product → Inventory",
      protected_behavior_id: "pb1",
      protected_behavior_description:
        "Inventory freshness: displayed stock must reflect live warehouse count",
      severity: "high",
      recommended_action:
        "Cache invalidation must occur when inventory is updated. Add a cache-bust on POST /api/inventory/:id.",
      evidence: {
        scenario_id: "sc2",
        baseline_observation: {
          side: "baseline",
          raw_output: '{"stock":3}',
          normalized_output: { stock: 3 },
          captured_at: new Date().toISOString(),
        },
        candidate_observation: {
          side: "candidate",
          raw_output: '{"stock":5}',
          normalized_output: { stock: 5 },
          captured_at: new Date().toISOString(),
        },
        reproduction_steps: [
          "1. Set inventory for product 42 to 3.",
          "2. GET /api/products/42 (populates cache).",
          "3. Update inventory for product 42 to 5.",
          "4. GET /api/inventory/42 — returns stale cached value 5 (baseline: 3).",
        ],
        affected_files: [
          "src/controllers/ProductController.ts",
          "src/services/CacheService.ts",
        ],
      },
    },
  ],
  summary: {
    total_journeys: 4,
    total_scenarios: 6,
    preserved: 2,
    intentional_changes: 0,
    regressions: 1,
    not_exercised: 1,
    potentially_affected: 0,
    verdict: "review_required",
  },
  capsule_ref: {
    json_path: "rehearsal-report.json",
    markdown_path: "rehearsal-report.md",
  },
  generated_at: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Phase progression (MOCK: time-based simulation)
// ---------------------------------------------------------------------------

const PHASE_PROGRESSION: RehearsalPhase[] = [
  "loading_repository",
  "extracting_change",
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

function getCurrentPhase(startedAt: string): RehearsalPhase {
  const elapsed = Date.now() - new Date(startedAt).getTime();
  // Each phase takes ~1.2s for a total of ~13.2s
  const phaseIndex = Math.min(
    Math.floor(elapsed / 1200),
    PHASE_PROGRESSION.length - 1,
  );
  return PHASE_PROGRESSION[phaseIndex] as RehearsalPhase;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function respond(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // POST /api/rehearsals — §4.1
  if (method === "POST" && url === "/api/rehearsals") {
    const body = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return respond(res, 400, { error: "Invalid JSON body" });
    }

    const run_id = `mock-run-${Date.now()}`;
    const started_at = new Date().toISOString();
    runs.set(run_id, { run_id, started_at, request: parsed });

    const response: StartRehearsalResponse = {
      run_id,
      status: "started",
      started_at,
    };
    return respond(res, 201, response);
  }

  // GET /api/rehearsals/:run_id/status — §4.2
  const statusMatch = url.match(/^\/api\/rehearsals\/([^/]+)\/status$/);
  if (method === "GET" && statusMatch) {
    const run_id = statusMatch[1] as string;
    const run = runs.get(run_id);
    if (!run) {
      return respond(res, 404, { error: "Run not found" });
    }

    const phase = getCurrentPhase(run.started_at);
    const isCompleted = phase === "completed";

    const response: RehearsalStatusResponse = {
      run_id,
      status: isCompleted ? "completed" : "running",
      phase,
      started_at: run.started_at,
      ...(isCompleted ? { completed_at: new Date().toISOString() } : {}),
      baseline_build_status: phase === "loading_repository" ? "pending" : "success",
      candidate_build_status: phase === "loading_repository" ? "pending" : "success",
    };
    return respond(res, 200, response);
  }

  // GET /api/rehearsals/:run_id/report — §4.3
  const reportMatch = url.match(/^\/api\/rehearsals\/([^/]+)\/report$/);
  if (method === "GET" && reportMatch) {
    const run_id = reportMatch[1] as string;
    if (!runs.has(run_id)) {
      return respond(res, 404, { error: "Run not found" });
    }
    const report: RehearsalReport = { rehearsal_run_id: run_id, ...SHOPFLOW_REPORT };
    return respond(res, 200, report);
  }

  return respond(res, 404, { error: "Not found" });
});

/**
 * Start the mock server on the given port (default: PORT constant).
 * Call this from CLI scripts. Tests call server.listen(0, ...) directly
 * for an ephemeral port so they don't conflict with other processes.
 */
export function startMockServer(port = PORT): void {
  server.listen(port, () => {
    console.log(`[mock-engine] Listening on http://localhost:${port}`);
    console.log("[mock-engine] MOCK: ShopFlow caching scenario. Replace with real engine when ready.");
  });
}

export { server, SHOPFLOW_REPORT };

// Auto-start only when this file is run directly (not when imported by tests)
const isMain =
  process.argv[1] !== undefined &&
  new URL(import.meta.url).pathname === new URL(process.argv[1], import.meta.url).pathname;

if (isMain) {
  startMockServer();
}
