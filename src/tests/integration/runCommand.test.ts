/**
 * Integration tests — run command submission flow (B02)
 *
 * Spins up the mock engine server, exercises the full submission path:
 *   validate → POST /api/rehearsals → get run_id → GET status (poll) → GET report
 *
 * Uses the shared contracts from src/shared/contracts.ts as the type surface.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type {
  StartRehearsalRequest,
  StartRehearsalResponse,
  RehearsalStatusResponse,
  RehearsalReport,
} from "../../shared/contracts.js";
import { startRehearsal, getRehearsalStatus, fetchReport, ApiError } from "../../cli/utils/apiClient.js";
import { SHOPFLOW_REPORT } from "../mocks/engineMock.js";

// Import the server WITHOUT auto-starting it (isMain guard ensures that).
// We bind to port 0 (OS-assigned ephemeral) so tests never collide.
import { server } from "../mocks/engineMock.js";

let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

// ---------------------------------------------------------------------------
// POST /api/rehearsals (§4.1)
// ---------------------------------------------------------------------------

describe("POST /api/rehearsals", () => {
  it("returns run_id and status: started for a valid request", async () => {
    const request: StartRehearsalRequest = {
      repo_path: "/repos/shopflow",
      base_ref: "main",
      candidate_ref: "feature/product-cache",
      requirement: "Add caching to Product API",
    };

    const response: StartRehearsalResponse = await startRehearsal(request, baseUrl);

    expect(response.run_id).toBeTruthy();
    expect(response.run_id).toMatch(/^mock-run-\d+$/);
    expect(response.status).toBe("started");
    expect(response.started_at).toBeTruthy();
    // ISO 8601 check
    expect(() => new Date(response.started_at)).not.toThrow();
  });

  it("each call creates a unique run_id", async () => {
    const request: StartRehearsalRequest = {
      repo_path: "/repos/shopflow",
      base_ref: "main",
      candidate_ref: "feature/product-cache",
    };

    const r1 = await startRehearsal(request, baseUrl);
    const r2 = await startRehearsal(request, baseUrl);

    expect(r1.run_id).not.toBe(r2.run_id);
  });

  it("accepts request without optional requirement", async () => {
    const request: StartRehearsalRequest = {
      repo_path: "/repos/shopflow",
      base_ref: "main",
      candidate_ref: "feature/product-cache",
    };

    const response = await startRehearsal(request, baseUrl);
    expect(response.run_id).toBeTruthy();
  });

  it("accepts request with optional pr_number", async () => {
    const request: StartRehearsalRequest = {
      repo_path: "/repos/shopflow",
      base_ref: "main",
      candidate_ref: "feature/product-cache",
      pr_number: 42,
    };

    const response = await startRehearsal(request, baseUrl);
    expect(response.run_id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GET /api/rehearsals/:run_id/status (§4.2)
// ---------------------------------------------------------------------------

describe("GET /api/rehearsals/:run_id/status", () => {
  it("returns status response for a known run", async () => {
    const request: StartRehearsalRequest = {
      repo_path: "/repos/shopflow",
      base_ref: "main",
      candidate_ref: "feature/product-cache",
    };
    const { run_id } = await startRehearsal(request, baseUrl);
    const status: RehearsalStatusResponse = await getRehearsalStatus(run_id, baseUrl);

    expect(status.run_id).toBe(run_id);
    expect(["running", "completed"]).toContain(status.status);
    expect(status.phase).toBeTruthy();
    expect(status.started_at).toBeTruthy();
    expect(["pending", "success", "failed"]).toContain(status.baseline_build_status);
    expect(["pending", "success", "failed"]).toContain(status.candidate_build_status);
  });

  it("returns 404 for an unknown run_id", async () => {
    await expect(getRehearsalStatus("non-existent-run-id", baseUrl)).rejects.toThrow(ApiError);

    try {
      await getRehearsalStatus("non-existent-run-id", baseUrl);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/rehearsals/:run_id/report (§4.3)
// ---------------------------------------------------------------------------

describe("GET /api/rehearsals/:run_id/report", () => {
  it("returns a complete RehearsalReport for a known run", async () => {
    const { run_id } = await startRehearsal(
      { repo_path: "/repos/shopflow", base_ref: "main", candidate_ref: "feature/product-cache" },
      baseUrl,
    );

    const report: RehearsalReport = await fetchReport(run_id, baseUrl);

    expect(report.run_id).toBe(run_id);
    expect(report.journeys).toHaveLength(4);
    expect(report.protected_behaviors).toHaveLength(2);
    expect(report.regressions).toHaveLength(1);
    expect(report.behavioral_diff).toHaveLength(4);
    expect(report.summary.regressions).toBe(1);
    expect(report.summary.preserved).toBe(2);
    expect(report.summary.not_exercised).toBe(1);
  });

  it("report behavioral_diff has the regression verdict on the right journey", async () => {
    const { run_id } = await startRehearsal(
      { repo_path: "/repos/shopflow", base_ref: "main", candidate_ref: "feature/product-cache" },
      baseUrl,
    );
    const report = await fetchReport(run_id, baseUrl);

    const regressionRow = report.behavioral_diff.find((r) => r.verdict === "regression");
    expect(regressionRow).toBeDefined();
    expect(regressionRow?.journey_name).toBe("Product → Inventory");
  });

  it("report matches the ShopFlow fixture shape", async () => {
    const { run_id } = await startRehearsal(
      { repo_path: "/repos/shopflow", base_ref: "main", candidate_ref: "feature/product-cache" },
      baseUrl,
    );
    const report = await fetchReport(run_id, baseUrl);

    expect(report.requirement.text).toBe(SHOPFLOW_REPORT.requirement.text);
    expect(report.intent.description).toBe(SHOPFLOW_REPORT.intent.description);
    expect(report.change.base_ref).toBe("main");
    expect(report.change.candidate_ref).toBe("feature/product-cache");
  });

  it("returns 404 for an unknown run_id", async () => {
    await expect(fetchReport("ghost-run-id", baseUrl)).rejects.toThrow(ApiError);
  });

  // F-02 regression: protected_behavior_confidence must survive the complete data path
  it("F-02 — regression row carries protected_behavior_confidence (numeric, 0–1)", async () => {
    const { run_id } = await startRehearsal(
      { repo_path: "/repos/shopflow", base_ref: "main", candidate_ref: "feature/product-cache" },
      baseUrl,
    );
    const report = await fetchReport(run_id, baseUrl);

    const regressionRow = report.behavioral_diff.find((r) => r.verdict === "regression");
    expect(regressionRow).toBeDefined();
    expect(typeof regressionRow?.protected_behavior_confidence).toBe("number");
    expect(regressionRow?.protected_behavior_confidence).toBeGreaterThan(0);
    expect(regressionRow?.protected_behavior_confidence).toBeLessThanOrEqual(1);
    // Verify it matches the linked protected_behavior
    const linkedPb = report.protected_behaviors.find(
      (pb) => pb.id === regressionRow?.protected_behavior_id,
    );
    expect(linkedPb).toBeDefined();
    expect(regressionRow?.protected_behavior_confidence).toBe(linkedPb?.confidence);
  });

  // F-02 regression: preserved rows without a linked protected behavior have no confidence
  it("F-02 — preserved rows without protected_behavior_id have no confidence", async () => {
    const { run_id } = await startRehearsal(
      { repo_path: "/repos/shopflow", base_ref: "main", candidate_ref: "feature/product-cache" },
      baseUrl,
    );
    const report = await fetchReport(run_id, baseUrl);

    const preservedRows = report.behavioral_diff.filter(
      (r) => r.verdict === "preserved" && !r.protected_behavior_id,
    );
    for (const row of preservedRows) {
      expect(row.protected_behavior_confidence).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// ApiError network failure
// ---------------------------------------------------------------------------

describe("ApiError", () => {
  it("throws ApiError with status 0 when the server is unreachable", async () => {
    await expect(
      startRehearsal(
        { repo_path: "/x", base_ref: "main", candidate_ref: "feature/x" },
        "http://localhost:19999", // nothing listening here
      ),
    ).rejects.toThrow(ApiError);

    try {
      await startRehearsal(
        { repo_path: "/x", base_ref: "main", candidate_ref: "feature/x" },
        "http://localhost:19999",
      );
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
      expect((err as ApiError).message).toMatch(/Network error/i);
    }
  });

  // F-05 regression: error_code must be preserved through the API layer
  it("F-05 — ApiError preserves error_code from the engine's error envelope", async () => {
    // The mock server returns error_code: "REHEARSAL_ENGINE_UNAVAILABLE" on 404
    try {
      await getRehearsalStatus("non-existent-run-id", baseUrl);
      expect.fail("Expected ApiError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).error_code).toBe("REHEARSAL_ENGINE_UNAVAILABLE");
    }
  });

  it("F-05 — ApiError.error_code is undefined when the response body is not an error envelope", async () => {
    // Network error has no error_code (not a JSON envelope)
    try {
      await startRehearsal(
        { repo_path: "/x", base_ref: "main", candidate_ref: "feature/x" },
        "http://localhost:19999",
      );
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).error_code).toBeUndefined();
    }
  });
});
