/**
 * JourneyReplayView tests — B05
 *
 * Covers:
 *  1.  Replay entry from B04 (Replay Journey button renders and triggers)
 *  2.  Journey name rendering
 *  3.  All steps render in order
 *  4.  Selected step behaviour (click to change)
 *  5.  Baseline result rendering
 *  6.  Candidate result rendering
 *  7.  Divergence highlighting (changed step only)
 *  8.  Verdict rendering per step
 *  9.  Confidence rendering
 *  10. Empty / no replay steps state
 *  11. API failure state
 *  12. Navigation back to Behavioral Diff
 *  13. Rehearsal ID persistence throughout
 *  14. Requirement persistence throughout
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { JourneyReplayView } from "./JourneyReplayView";
import { BehavioralDiffView } from "./BehavioralDiffView";
import * as api from "../services/api";
import type { JourneyReplayDetail, RehearsalReport } from "../../../src/shared/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../services/api", () => ({
  getJourneyReplay: vi.fn(),
  getRehearsalReport: vi.fn(),
  getRehearsalStatus: vi.fn(),
  startRehearsal: vi.fn(),
  _resetMockState: vi.fn(),
  _setMockRunState: vi.fn(),
  _setMockReportState: vi.fn(),
}));

const mockGetJourneyReplay = vi.mocked(api.getJourneyReplay);
const mockGetRehearsalReport = vi.mocked(api.getRehearsalReport);

const BASE_PROPS = {
  runId: "CR-REPLAY01",
  journeyId: "j-shopflow",
  requirement: "Add caching to Product API to improve response time.",
  onBack: vi.fn(),
} as const;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReplay(overrides: Partial<JourneyReplayDetail> = {}): JourneyReplayDetail {
  const base: JourneyReplayDetail = {
    run_id: "CR-REPLAY01",
    journey: {
      id: "j-shopflow",
      name: "ShopFlow — Product Purchase Journey",
      description: "Full purchase journey.",
      type: "user",
      source: "requirement",
      confidence: "test_derived",
      steps: [],
    },
    overall_verdict: "regression",
    confidence_source: "contract_derived",
    confidence_score: 1.0,
    steps: [
      {
        step_id: "step-1",
        sequence: 1,
        name: "Product Search",
        action: "GET /products?q=widget",
        baseline_result: {
          side: "baseline",
          raw_output: '{"status":200,"body":{"results":[{"id":"product-99"}]}}',
          normalized_output: { status: 200 },
          captured_at: "2025-01-15T09:01:05Z",
        },
        candidate_result: {
          side: "candidate",
          raw_output: '{"status":200,"body":{"results":[{"id":"product-99"}]}}',
          normalized_output: { status: 200 },
          captured_at: "2025-01-15T09:01:05Z",
        },
        verdict: "preserved",
        changed: false,
        explanation: "Search results are identical on both sides.",
      },
      {
        step_id: "step-2",
        sequence: 2,
        name: "Open Product",
        action: "GET /products/product-99",
        baseline_result: {
          side: "baseline",
          raw_output: '{"status":200,"body":{"price":9.99,"source":"db"}}',
          normalized_output: { status: 200 },
          captured_at: "2025-01-15T09:01:10Z",
        },
        candidate_result: {
          side: "candidate",
          raw_output: '{"status":200,"body":{"price":9.99,"source":"cache"}}',
          normalized_output: { status: 200 },
          captured_at: "2025-01-15T09:01:10Z",
        },
        verdict: "intentional_change",
        confidence_source: "inferred",
        confidence_score: 0.95,
        changed: false,
        explanation: "Served from cache instead of DB — intended caching change.",
      },
      {
        step_id: "step-3",
        sequence: 3,
        name: "Read Inventory",
        action: "GET /products/product-99 (post-inventory-write)",
        expected_hint: "Must return stock=1 after inventory was updated to stock=1",
        baseline_result: {
          side: "baseline",
          raw_output: '{"status":200,"body":{"stock":1}}',
          normalized_output: { stock: 1 },
          captured_at: "2025-01-15T09:02:10Z",
        },
        candidate_result: {
          side: "candidate",
          raw_output: '{"status":200,"body":{"stock":3}}',
          normalized_output: { stock: 3 },
          captured_at: "2025-01-15T09:02:25Z",
        },
        verdict: "regression",
        confidence_source: "contract_derived",
        confidence_score: 1.0,
        changed: true,
        explanation:
          "Inventory update → stock becomes 1 on baseline. Candidate returns stale cached value stock=3.",
      },
      {
        step_id: "step-4",
        sequence: 4,
        name: "Add Item to Cart",
        action: "PUT /cart/cart-42/product-99",
        baseline_result: {
          side: "baseline",
          raw_output: '{"status":200}',
          normalized_output: { status: 200 },
          captured_at: "2025-01-15T09:02:40Z",
        },
        candidate_result: {
          side: "candidate",
          raw_output: '{"status":200}',
          normalized_output: { status: 200 },
          captured_at: "2025-01-15T09:02:40Z",
        },
        verdict: "preserved",
        changed: false,
        explanation: "Cart add is unaffected by caching.",
      },
      {
        step_id: "step-5",
        sequence: 5,
        name: "Checkout",
        action: "POST /checkout",
        baseline_result: {
          side: "baseline",
          raw_output: '{"status":200,"body":{"order_id":"ord-123","total":9.99}}',
          normalized_output: { status: 200 },
          captured_at: "2025-01-15T09:03:00Z",
        },
        candidate_result: {
          side: "candidate",
          raw_output: '{"status":200,"body":{"order_id":"ord-123","total":9.99}}',
          normalized_output: { status: 200 },
          captured_at: "2025-01-15T09:03:00Z",
        },
        verdict: "preserved",
        changed: false,
        explanation: "Checkout identical on both sides.",
      },
    ],
  };
  return { ...base, ...overrides };
}

function makeReport(): RehearsalReport {
  return {
    rehearsal_run_id: "CR-REPLAY01",
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
    journeys: [
      {
        id: "j-shopflow",
        name: "ShopFlow — Product Purchase Journey",
        description: "Full purchase journey.",
        type: "user",
        source: "requirement",
        confidence: "test_derived",
        steps: [],
      },
    ],
    protected_behaviors: [],
    regressions: [],
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
    behavioral_diff_rows: [
      {
        journey_id: "j-shopflow",
        journey_name: "ShopFlow — Product Purchase Journey",
        verdict: "regression",
        is_expected_change: false,
      },
    ],
    generated_at: "2025-01-15T09:04:00Z",
  };
}

async function renderReplayAndAwait(
  overrides: Partial<JourneyReplayDetail> = {},
): Promise<ReturnType<typeof render>> {
  mockGetJourneyReplay.mockResolvedValue(makeReplay(overrides));
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<JourneyReplayView {...BASE_PROPS} />);
  });
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JourneyReplayView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Replay entry from B04: Replay Journey button renders in BehavioralDiffView
  it("1 — renders Replay Journey button in B04 diff rows", async () => {
    (mockGetRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    await act(async () => {
      render(
        <BehavioralDiffView
          runId="CR-REPLAY01"
          requirement="Add caching"
          onNewRehearsal={vi.fn()}
        />,
      );
    });
    await waitFor(() => {
      const btn = document.querySelector("[data-testid='btn-replay-j-shopflow']");
      expect(btn).not.toBeNull();
    });
    const btn = document.querySelector("[data-testid='btn-replay-j-shopflow']");
    expect(btn?.textContent).toContain("Replay Journey");
  });

  // 1b. Clicking Replay Journey in B04 renders JourneyReplayView
  it("1b — clicking Replay Journey in B04 renders JourneyReplayView", async () => {
    (mockGetRehearsalReport as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport());
    mockGetJourneyReplay.mockResolvedValue(makeReplay());

    await act(async () => {
      render(
        <BehavioralDiffView
          runId="CR-REPLAY01"
          requirement="Add caching"
          onNewRehearsal={vi.fn()}
        />,
      );
    });
    await waitFor(() => {
      expect(document.querySelector("[data-testid='btn-replay-j-shopflow']")).not.toBeNull();
    });

    await act(async () => {
      const btn = document.querySelector(
        "[data-testid='btn-replay-j-shopflow']",
      ) as HTMLButtonElement;
      btn.click();
    });

    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-view']")).not.toBeNull();
    });
  });

  // 2. Journey name rendering
  it("2 — renders the journey name", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      const el = document.querySelector("[data-testid='jrv-journey-name']");
      expect(el).not.toBeNull();
      expect(el?.textContent).toContain("ShopFlow — Product Purchase Journey");
    });
  });

  // 3. All steps render in order
  it("3 — renders all 5 steps in order via the timeline", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-timeline']")).not.toBeNull();
    });
    for (let seq = 1; seq <= 5; seq++) {
      expect(document.querySelector(`[data-testid='jrv-step-${seq}']`)).not.toBeNull();
    }
    const items = screen.getAllByRole("option");
    expect(items).toHaveLength(5);
    expect(items[0].textContent).toContain("Product Search");
    expect(items[1].textContent).toContain("Open Product");
    expect(items[2].textContent).toContain("Read Inventory");
    expect(items[3].textContent).toContain("Add Item to Cart");
    expect(items[4].textContent).toContain("Checkout");
  });

  // 4. Selected step behaviour — auto-selects divergent step
  it("4a — auto-selects the first divergent step (step 3) on load", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-step-panel']")).not.toBeNull();
    });
    const name = document.querySelector("[data-testid='jrv-step-name']");
    expect(name?.textContent).toContain("Read Inventory");
  });

  it("4b — clicking step 1 shows that step's detail", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-timeline']")).not.toBeNull();
    });
    await act(async () => {
      const step1 = document.querySelector("[data-testid='jrv-step-1']") as HTMLElement;
      step1.click();
    });
    const name = document.querySelector("[data-testid='jrv-step-name']");
    expect(name?.textContent).toContain("Product Search");
  });

  // 5. Baseline result rendering
  it("5 — renders the baseline result for the selected step", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-obs-baseline']")).not.toBeNull();
    });
    const baseline = document.querySelector("[data-testid='jrv-obs-baseline']");
    expect(baseline?.textContent).toContain("stock");
  });

  // 6. Candidate result rendering
  it("6 — renders the candidate result for the selected step", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-obs-candidate']")).not.toBeNull();
    });
    const candidate = document.querySelector("[data-testid='jrv-obs-candidate']");
    expect(candidate?.textContent).toContain("stock");
  });

  // 7a. Divergence highlighting — divergence panel shown for changed step
  it("7a — shows divergence panel only for the changed step", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-step-panel']")).not.toBeNull();
    });
    // Step 3 is selected by default; it is divergent
    const div = document.querySelector("[data-testid='jrv-step-divergence']");
    expect(div).not.toBeNull();
    expect(div?.textContent).toContain("Inventory update");
  });

  // 7b. Divergent badge only on the changed timeline step
  it("7b — divergent badge only appears on the changed timeline step", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-timeline']")).not.toBeNull();
    });
    // Step 3 should have divergent badge
    expect(document.querySelector("[data-testid='jrv-divergent-badge-3']")).not.toBeNull();
    // Steps 1, 2, 4, 5 should NOT have divergent badge
    expect(document.querySelector("[data-testid='jrv-divergent-badge-1']")).toBeNull();
    expect(document.querySelector("[data-testid='jrv-divergent-badge-2']")).toBeNull();
    expect(document.querySelector("[data-testid='jrv-divergent-badge-4']")).toBeNull();
    expect(document.querySelector("[data-testid='jrv-divergent-badge-5']")).toBeNull();
  });

  // 7c. Non-divergent step does not show divergence panel
  it("7c — non-divergent step does not show the divergence panel", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-timeline']")).not.toBeNull();
    });
    // Click step 1 (not changed)
    await act(async () => {
      const step1 = document.querySelector("[data-testid='jrv-step-1']") as HTMLElement;
      step1.click();
    });
    expect(document.querySelector("[data-testid='jrv-step-divergence']")).toBeNull();
  });

  // 8a. Verdict badge in the step detail panel
  it("8a — renders the verdict badge for the selected step", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-step-panel']")).not.toBeNull();
    });
    const panel = document.querySelector("[data-testid='jrv-step-panel']");
    // Step 3 verdict is regression
    expect(panel?.querySelector("[data-verdict='regression']")).not.toBeNull();
  });

  // 8b. Overall verdict in the journey summary
  it("8b — renders the overall verdict badge in the journey summary", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-summary']")).not.toBeNull();
    });
    const summary = document.querySelector("[data-testid='jrv-summary']");
    expect(summary?.querySelector("[data-verdict='regression']")).not.toBeNull();
  });

  // 9a. Confidence in step panel
  it("9a — renders confidence pill for a step that has one", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-step-panel']")).not.toBeNull();
    });
    const panel = document.querySelector("[data-testid='jrv-step-panel']");
    // Step 3 (default selection) has contract_derived confidence
    expect(panel?.textContent).toContain("contract-derived");
    expect(panel?.textContent).toContain("100%");
  });

  // 9b. Confidence in journey summary
  it("9b — renders confidence pill in the journey summary", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-summary']")).not.toBeNull();
    });
    const summary = document.querySelector("[data-testid='jrv-summary']");
    expect(summary?.textContent).toContain("contract-derived");
  });

  // 10. Empty / no steps state
  it("10 — shows empty state when steps array is empty", async () => {
    mockGetJourneyReplay.mockResolvedValue(makeReplay({ steps: [] }));
    await act(async () => {
      render(<JourneyReplayView {...BASE_PROPS} />);
    });
    await waitFor(() => {
      const el = document.querySelector("[data-testid='jrv-empty']");
      expect(el).not.toBeNull();
      expect(el?.textContent).toContain("No replay steps");
    });
    expect(document.querySelector("[data-testid='jrv-timeline']")).toBeNull();
  });

  // 11a. API failure with Error
  it("11a — shows error banner on API failure", async () => {
    mockGetJourneyReplay.mockRejectedValue(new Error("Replay not available"));
    await act(async () => {
      render(<JourneyReplayView {...BASE_PROPS} />);
    });
    await waitFor(() => {
      const el = document.querySelector("[data-testid='jrv-error']");
      expect(el).not.toBeNull();
      expect(el?.textContent).toContain("Replay not available");
    });
    expect(document.querySelector("[data-testid='jrv-timeline']")).toBeNull();
  });

  // 11b. API failure with non-Error
  it("11b — shows error banner for non-Error API failure", async () => {
    mockGetJourneyReplay.mockRejectedValue("unknown error");
    await act(async () => {
      render(<JourneyReplayView {...BASE_PROPS} />);
    });
    await waitFor(() => {
      const el = document.querySelector("[data-testid='jrv-error']");
      expect(el).not.toBeNull();
      expect(el?.textContent).toContain("Failed to load journey replay");
    });
  });

  // 12. Navigation back to Behavioral Diff
  it("12 — calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    mockGetJourneyReplay.mockResolvedValue(makeReplay());
    await act(async () => {
      render(
        <JourneyReplayView
          runId="CR-REPLAY01"
          journeyId="j-shopflow"
          requirement="Add caching"
          onBack={onBack}
        />,
      );
    });
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-back-btn']")).not.toBeNull();
    });
    const btn = document.querySelector("[data-testid='jrv-back-btn']") as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // 13. Rehearsal ID persistence
  it("13a — shows the run ID after successful load", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-run-id']")).not.toBeNull();
    });
    expect(document.querySelector("[data-testid='jrv-run-id']")?.textContent).toContain(
      "CR-REPLAY01",
    );
  });

  it("13b — shows the run ID even when an error occurs", async () => {
    mockGetJourneyReplay.mockRejectedValue(new Error("fail"));
    await act(async () => {
      render(<JourneyReplayView {...BASE_PROPS} />);
    });
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-error']")).not.toBeNull();
    });
    expect(document.querySelector("[data-testid='jrv-run-id']")?.textContent).toContain(
      "CR-REPLAY01",
    );
  });

  // 14. Requirement persistence
  it("14a — shows the requirement after successful load", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-requirement']")).not.toBeNull();
    });
    expect(
      document.querySelector("[data-testid='jrv-requirement']")?.textContent,
    ).toContain("Add caching to Product API to improve response time.");
  });

  it("14b — shows the requirement even when an error occurs", async () => {
    mockGetJourneyReplay.mockRejectedValue(new Error("fail"));
    await act(async () => {
      render(<JourneyReplayView {...BASE_PROPS} />);
    });
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-error']")).not.toBeNull();
    });
    expect(
      document.querySelector("[data-testid='jrv-requirement']")?.textContent,
    ).toContain("Add caching to Product API to improve response time.");
  });

  // Step action rendering
  it("step action — renders action in the detail panel", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-step-action']")).not.toBeNull();
    });
    expect(document.querySelector("[data-testid='jrv-step-action']")?.textContent).toContain(
      "GET /products/product-99 (post-inventory-write)",
    );
  });

  // Expected hint rendering
  it("expected hint — renders when present", async () => {
    await renderReplayAndAwait();
    await waitFor(() => {
      expect(document.querySelector("[data-testid='jrv-step-hint']")).not.toBeNull();
    });
    expect(document.querySelector("[data-testid='jrv-step-hint']")?.textContent).toContain(
      "Must return stock=1",
    );
  });

  // Loading state
  it("loading — shows loading state before data resolves", async () => {
    let resolveReplay!: (v: JourneyReplayDetail) => void;
    mockGetJourneyReplay.mockReturnValue(
      new Promise<JourneyReplayDetail>((r) => {
        resolveReplay = r;
      }),
    );
    render(<JourneyReplayView {...BASE_PROPS} />);
    expect(document.querySelector("[data-testid='jrv-loading']")).not.toBeNull();
    await act(async () => {
      resolveReplay(makeReplay());
    });
    expect(document.querySelector("[data-testid='jrv-loading']")).toBeNull();
  });
});
