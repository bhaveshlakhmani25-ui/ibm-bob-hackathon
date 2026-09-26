import type {
  StartRehearsalRequest,
  StartRehearsalResponse,
  RehearsalStatusResponse,
  RehearsalPhase,
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
