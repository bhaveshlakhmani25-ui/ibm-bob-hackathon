import type { StartRehearsalRequest, StartRehearsalResponse, RehearsalStatusResponse } from "../../../src/shared/contracts";

// In-memory mock data
let mockStatus: RehearsalStatusResponse | null = null;
let currentRunId: string | null = null;

// Mock delay to simulate network latency
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const startRehearsal = async (req: StartRehearsalRequest): Promise<StartRehearsalResponse> => {
  await delay(1500); // Simulate network and initial validation

  if (!req.requirement || req.requirement.trim() === "") {
    throw new Error("Requirement intent cannot be empty.");
  }
  
  if (req.requirement.includes("fail")) {
    throw new Error("Simulated backend rejection for invalid requirement.");
  }

  currentRunId = `CR-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
  
  mockStatus = {
    run_id: currentRunId,
    status: "running",
    phase: "loading_repository",
    started_at: new Date().toISOString(),
    baseline_build_status: "pending",
    candidate_build_status: "pending",
  };
  
  // Start mock background progression
  setTimeout(progressMockRehearsal, 3000);

  return {
    run_id: currentRunId,
    status: "started",
    started_at: mockStatus.started_at,
  };
};

export const getRehearsalStatus = async (runId: string): Promise<RehearsalStatusResponse> => {
  await delay(500); // Network delay
  if (runId !== currentRunId || !mockStatus) {
    throw new Error("Rehearsal not found");
  }
  return mockStatus;
};

// Internal function to mock the progression through states
const progressMockRehearsal = async () => {
  if (!mockStatus) return;
  
  const phases = [
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
    "completed"
  ] as const;
  
  for (const phase of phases) {
    if (mockStatus.status === "failed" || mockStatus.status === "build_failed") break;
    mockStatus.phase = phase;
    await delay(1500); // Wait between phases
  }
  
  if (mockStatus.status === "running") {
    mockStatus.status = "completed";
    mockStatus.completed_at = new Date().toISOString();
  }
};
