/**
 * BehavioralDiffView tests — B04
 *
 * Covers:
 *  1.  Rendering each of the 5 Tier-2 verdict types
 *  2.  Confidence rendering (source label + numeric score %)
 *  3.  Baseline vs candidate observation display
 *  4.  Regression row visually prominent (css class + severity + action)
 *  5.  Potentially affected row
 *  6.  Not exercised row
 *  7.  Preserved row
 *  8.  Intentional change row
 *  9.  Scoreboard summary counts
 *  10. Empty / no-results state (behavioral_diff = [])
 *  11. API failure (getRehearsalReport rejects)
 *  12. Malformed / incomplete result handling (missing optional fields)
 *  13. Run ID and requirement always visible
 *  14. New Rehearsal button calls onNewRehearsal
 *  15. Report-not-ready error (non-completed status)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { BehavioralDiffView } from "./BehavioralDiffView";
import * as api from "../services/api";
import type { RehearsalReport } from "../../../src/shared/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../services/api", () => ({
  getRehearsalReport: vi.fn(),
  getRehearsalStatus: vi.fn(),
  startRehearsal: vi.fn(),
  _resetMockState: vi.fn(),
  _setMockRunState: vi.fn(),
  _setMockReportState: vi.fn(),
}));

const BASE_PROPS = {
  runId: "CR-DIFFTEST",
  requirement: "Add caching to Product API",
  onNewRehearsal: vi.fn(),
} as const;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<RehearsalReport> = {}): RehearsalReport {
  const base: RehearsalReport = {
    rehearsal_run_id: "CR-DIFFTEST",
    change: {
      base_ref: "main",
      candidate_ref: "feature/product-cache",
      diff_summary: "Added Redis caching.",
      affected_files: ["src/ProductService.ts"],
    },
    requirement: { text: "Add caching to Product API", source: "free_text" },
    intent: {
      description: "Improve Product API response time",
      expected_changes: ["Caching layer added"],
    },
    journeys: [],
    protected_behaviors: [
      {
        id: "pb-2",
        description: "Stock reflects latest inventory after update.",
        source: "contract_derived",
        confidence: 1.0,
        related_code_refs: ["src/ProductService.ts:fetchProduct"],
      },
    ],
    regressions: [
      {
        id: "reg-1",
        behavioral_difference_id: "bd-2",
        journey_id: "j-2",
        journey_name: "Update Inventory Stock",
        protected_behavior_id: "pb-2",
        protected_behavior_description: "Stock reflects latest inventory after update.",
        severity: "high",
        recommended_action: "Invalidate cache on write.",
        evidence: {
          scenario_id: "sc-2",
          baseline_observation: {
            side: "baseline",
            raw_output: '{"stock":3}',
            normalized_output: { stock: 3 },
            captured_at: "2025-01-15T09:02:10Z",
          },
          candidate_observation: {
            side: "candidate",
            raw_output: '{"stock":10}',
            normalized_output: { stock: 10 },
            captured_at: "2025-01-15T09:02:25Z",
          },
          reproduction_steps: ["POST /inventory/product-99 { stock: 3 }", "GET /products/product-99"],
          affected_files: ["src/CacheService.ts"],
        },
      },
    ],
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
        protected_behavior_id: undefined,
        protected_behavior_source: "inferred",
        protected_behavior_confidence: 0.95,
        is_expected_change: true,
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
        protected_behavior_id: undefined,
        protected_behavior_source: "test_derived",
        protected_behavior_confidence: 0.98,
        is_expected_change: false,
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
        protected_behavior_source: "inferred",
        protected_behavior_confidence: 0.60,
        is_expected_change: false,
      },
    ],
    generated_at: "2025-01-15T09:04:00Z",
  };
  return { ...base, ...overrides };
}

async function renderAndAwait(props = BASE_PROPS): Promise<ReturnType<typeof render>> {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<BehavioralDiffView {...props} />);
  });
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BehavioralDiffView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. All five verdict types rendered
  // -------------------------------------------------------------------------

  it("1a — renders regression verdict row", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      const badge = document.querySelector("[data-verdict='regression']");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain("Regression");
    });
  });

  it("1b — renders preserved verdict row", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      const badge = document.querySelector("[data-verdict='preserved']");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain("Preserved");
    });
  });

  it("1c — renders intentional_change verdict row", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      const badge = document.querySelector("[data-verdict='intentional_change']");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain("Intentional Change");
    });
  });

  it("1d — renders potentially_affected verdict row", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      const badge = document.querySelector("[data-verdict='potentially_affected']");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain("Potentially Affected");
    });
  });

  it("1e — renders not_exercised verdict row", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      const badge = document.querySelector("[data-verdict='not_exercised']");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain("Not Exercised");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Confidence rendering
  // -------------------------------------------------------------------------

  it("2a — displays confidence source label (contract_derived)", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      expect(screen.getByText(/contract-derived/i)).toBeDefined();
    });
  });

  it("2b — displays confidence percentage for rows with a score", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      // 1.0 → 100%, 0.95 → 95%, 0.98 → 98%, 0.60 → 60%
      expect(screen.getByText(/100%/)).toBeDefined();
    });
  });

  it("2c — renders no confidence indicator (—) for not_exercised row without source", async () => {
    const report = makeReport();
    // j-4 (not_exercised) has no protected_behavior_source
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(report);
    await renderAndAwait();

    await waitFor(() => {
      // There should be at least one "—" placeholder for missing confidence
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("2d — inferred confidence source label renders correctly", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      const inferred = screen.getAllByText(/inferred/);
      expect(inferred.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Baseline vs candidate display
  // -------------------------------------------------------------------------

  it("3 — shows baseline and candidate observations for regression row", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      // baseline raw output
      expect(screen.getByText(/stock.*3/i)).toBeDefined();
      // candidate raw output
      expect(screen.getByText(/stock.*10/i)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Regression visually obvious
  // -------------------------------------------------------------------------

  it("4a — regression row has regression highlight css class", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      const rows = document.querySelectorAll(".diff-row-regression-highlight");
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it("4b — regression row shows severity tag", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      expect(screen.getByText(/high/i)).toBeDefined();
    });
  });

  it("4c — regression row shows recommended action", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      expect(screen.getByText(/Invalidate cache on write/i)).toBeDefined();
    });
  });

  it("4d — regression verdict badge preserves machine-readable data-verdict attribute", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      const badge = document.querySelector("[data-verdict='regression']");
      expect(badge?.getAttribute("data-verdict")).toBe("regression");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Potentially affected
  // -------------------------------------------------------------------------

  it("5 — potentially_affected row shows explanation text", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      expect(
        screen.getByText(/may be affected but was not directly comparable/i),
      ).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Not exercised
  // -------------------------------------------------------------------------

  it("6 — not_exercised row shows explanation text", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      expect(
        screen.getByText(/No scenario exercised this behavior/i),
      ).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 7. Preserved
  // -------------------------------------------------------------------------

  it("7 — preserved row shows explanation text", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      expect(
        screen.getByText(/Behavior is unchanged between baseline and candidate/i),
      ).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 8. Intentional change
  // -------------------------------------------------------------------------

  it("8 — intentional_change row with is_expected_change shows expected-tag", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      const tag = document.querySelector(".expected-tag");
      expect(tag).not.toBeNull();
      expect(tag?.textContent).toContain("expected change");
    });
  });

  // -------------------------------------------------------------------------
  // 9. Scoreboard counts
  // -------------------------------------------------------------------------

  it("9 — scoreboard shows correct counts per verdict", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      const preserved = document.querySelector("[data-testid='score-preserved']");
      const regression = document.querySelector("[data-testid='score-regression']");
      const intentional = document.querySelector("[data-testid='score-intentional']");
      const potential = document.querySelector("[data-testid='score-potential']");
      const notExercised = document.querySelector("[data-testid='score-not-exercised']");

      expect(preserved?.querySelector(".score-num")?.textContent).toBe("1");
      expect(regression?.querySelector(".score-num")?.textContent).toBe("1");
      expect(intentional?.querySelector(".score-num")?.textContent).toBe("1");
      expect(potential?.querySelector(".score-num")?.textContent).toBe("1");
      expect(notExercised?.querySelector(".score-num")?.textContent).toBe("1");
    });
  });

  it("9b — scoreboard overall result shows Review Required", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      expect(screen.getByText(/Review Required/i)).toBeDefined();
    });
  });

  it("9c — scoreboard shows Ready to Merge when verdict is ready_to_merge", async () => {
    const report = makeReport({
      summary: {
        total_journeys: 2,
        total_scenarios: 2,
        preserved: 2,
        intentional_changes: 0,
        regressions: 0,
        not_exercised: 0,
        potentially_affected: 0,
        verdict: "ready_to_merge",
      },
    });
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(report);
    await renderAndAwait();

    await waitFor(() => {
      expect(screen.getByText(/Ready to Merge/i)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 10. Empty / no-results state
  // -------------------------------------------------------------------------

  it("10 — shows empty state message when behavioral_diff is empty", async () => {
    const report = makeReport({ behavioral_diff: [] });
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(report);
    await renderAndAwait();

    await waitFor(() => {
      const empty = document.querySelector("[data-testid='diff-empty']");
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toContain("No behavioral diff results");
    });
  });

  // -------------------------------------------------------------------------
  // 11. API failure
  // -------------------------------------------------------------------------

  it("11 — shows error banner when getRehearsalReport rejects", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error: ECONNREFUSED"),
    );
    await renderAndAwait();

    await waitFor(() => {
      const banner = document.querySelector("[data-testid='bdiff-error']");
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain("Failed to load behavioral diff");
      expect(banner?.textContent).toContain("ECONNREFUSED");
    });
  });

  it("11b — shows generic error message on non-Error rejection", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockRejectedValue(
      "unexpected string error",
    );
    await renderAndAwait();

    await waitFor(() => {
      const banner = document.querySelector("[data-testid='bdiff-error']");
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain("Failed to load behavioral diff report");
    });
  });

  // -------------------------------------------------------------------------
  // 12. Malformed / incomplete result handling
  // -------------------------------------------------------------------------

  it("12a — handles missing optional fields gracefully (no protected behavior linked)", async () => {
    const report = makeReport({
      behavioral_diff: [
        {
          journey_id: "j-minimal",
          journey_name: "Minimal Journey",
          verdict: "preserved",
          is_expected_change: false,
          // no protected_behavior_id, source, confidence, scenario_id, evidence_id
        },
      ],
      regressions: [],
      protected_behaviors: [],
      summary: {
        total_journeys: 1,
        total_scenarios: 1,
        preserved: 1,
        intentional_changes: 0,
        regressions: 0,
        not_exercised: 0,
        potentially_affected: 0,
        verdict: "ready_to_merge",
      },
    });
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(report);
    await renderAndAwait();

    await waitFor(() => {
      expect(screen.getByText("Minimal Journey")).toBeDefined();
      const badge = document.querySelector("[data-verdict='preserved']");
      expect(badge).not.toBeNull();
    });
  });

  it("12b — handles regression row with missing evidence gracefully", async () => {
    const report = makeReport({
      behavioral_diff: [
        {
          journey_id: "j-r",
          journey_name: "Broken Regression",
          verdict: "regression",
          is_expected_change: false,
          // no evidence_id → no observation lookup
        },
      ],
      regressions: [],
      protected_behaviors: [],
      summary: {
        total_journeys: 1,
        total_scenarios: 1,
        preserved: 0,
        intentional_changes: 0,
        regressions: 1,
        not_exercised: 0,
        potentially_affected: 0,
        verdict: "review_required",
      },
    });
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(report);
    await renderAndAwait();

    await waitFor(() => {
      expect(screen.getByText("Broken Regression")).toBeDefined();
      const badge = document.querySelector("[data-verdict='regression']");
      expect(badge).not.toBeNull();
    });
  });

  it("12c — handles report with zero intentional_changes (optional field)", async () => {
    const report = makeReport({
      summary: {
        total_journeys: 2,
        total_scenarios: 2,
        preserved: 2,
        intentional_changes: 0,
        regressions: 0,
        not_exercised: 0,
        potentially_affected: 0,
        verdict: "ready_to_merge",
      },
    });
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(report);
    await renderAndAwait();

    await waitFor(() => {
      const intentional = document.querySelector("[data-testid='score-intentional']");
      expect(intentional?.querySelector(".score-num")?.textContent).toBe("0");
    });
  });

  // -------------------------------------------------------------------------
  // 13. Run ID and requirement always visible
  // -------------------------------------------------------------------------

  it("13a — run ID is visible before data loads (loading state)", () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    );
    render(<BehavioralDiffView {...BASE_PROPS} />);

    expect(screen.getByText("CR-DIFFTEST")).toBeDefined();
    expect(screen.getByText("Add caching to Product API")).toBeDefined();
    // Loading indicator
    const loading = document.querySelector("[data-testid='bdiff-loading']");
    expect(loading).not.toBeNull();
  });

  it("13b — run ID and requirement visible after successful load", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await renderAndAwait();

    await waitFor(() => {
      expect(screen.getByText("CR-DIFFTEST")).toBeDefined();
      expect(screen.getByText("Add caching to Product API")).toBeDefined();
    });
  });

  it("13c — run ID and requirement visible in error state", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Server error"),
    );
    await renderAndAwait();

    await waitFor(() => {
      expect(screen.getByText("CR-DIFFTEST")).toBeDefined();
      expect(screen.getByText("Add caching to Product API")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 14. New Rehearsal button
  // -------------------------------------------------------------------------

  it("14 — New Rehearsal button calls onNewRehearsal prop", async () => {
    const onNewRehearsal = vi.fn();
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());

    await act(async () => {
      render(
        <BehavioralDiffView
          runId="CR-DIFFTEST"
          requirement="Add caching"
          onNewRehearsal={onNewRehearsal}
        />,
      );
    });

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /New Rehearsal/i });
      expect(btn).toBeDefined();
      fireEvent.click(btn);
      expect(onNewRehearsal).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // 15. Report-not-ready error
  // -------------------------------------------------------------------------

  it("15 — shows error when report status is not completed", async () => {
    (api.getRehearsalReport as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Report not ready. Status: running"),
    );
    await renderAndAwait();

    await waitFor(() => {
      const banner = document.querySelector("[data-testid='bdiff-error']");
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain("Report not ready");
    });
  });
});
