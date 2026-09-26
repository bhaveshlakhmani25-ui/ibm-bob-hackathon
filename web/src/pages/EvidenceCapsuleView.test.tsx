/**
 * EvidenceCapsuleView tests — B06
 *
 * Covers:
 *  1.  Capsule generation: required metadata fields
 *  2.  Requirement preservation
 *  3.  Change context (base, candidate)
 *  4.  Verdict preservation (canonical engine verdict, not inferred)
 *  5.  Confidence preservation (protected_behavior_confidence, confidence_source)
 *  6.  Baseline observation
 *  7.  Candidate observation
 *  8.  Changed flag (engine-authoritative — not inferred from text diff)
 *  9.  Journey replay steps (ordered)
 *  10. Divergent step identified
 *  11. error_code preservation
 *  12. Missing optional fields (no protected_behavior, no reproduction, no errors)
 *  13. Empty replay_steps state
 *  14. API failure state
 *  15. Export: copy button present
 *  16. Export: download button present
 *  17. Export: JSON preview matches canonical capsule object
 *  18. Run ID and requirement always visible in header
 *  19. Back button navigates to Journey Replay
 *  20. B05→B06: Evidence Capsule button present in JourneyReplayView
 *  21. B05→B06: navigates to capsule view on click
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { EvidenceCapsuleView } from "./EvidenceCapsuleView";
import { JourneyReplayView } from "./JourneyReplayView";
import * as api from "../services/api";
import type { EvidenceCapsule, JourneyReplayDetail } from "../../../src/shared/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../services/api", () => ({
  getEvidenceCapsule: vi.fn(),
  getJourneyReplay: vi.fn(),
  getRehearsalReport: vi.fn(),
  getRehearsalStatus: vi.fn(),
  startRehearsal: vi.fn(),
  _resetMockState: vi.fn(),
  _setMockRunState: vi.fn(),
  _setMockCapsuleState: vi.fn(),
  _setMockReportState: vi.fn(),
}));

const mockGetEvidenceCapsule = vi.mocked(api.getEvidenceCapsule);
const mockGetJourneyReplay = vi.mocked(api.getJourneyReplay);

const BASE_PROPS = {
  runId: "CR-CAPSULE01",
  requirement: "Add caching to Product API to improve response time.",
  onBack: vi.fn(),
} as const;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCapsule(overrides: Partial<EvidenceCapsule> = {}): EvidenceCapsule {
  const base: EvidenceCapsule = {
    metadata: {
      capsule_format_version: "1.0",
      run_id: "CR-CAPSULE01",
      generated_at: "2025-01-15T09:04:00Z",
    },
    requirement: {
      text: "Add caching to the Product API to improve response time.",
      source: "free_text",
    },
    change: {
      base_ref: "main",
      candidate_ref: "feature/product-cache",
      diff_summary: "Add Redis caching to Product API. Files: productService.ts, cache.ts.",
      affected_files: ["src/productService.ts", "src/cache.ts"],
    },
    rehearsal: {
      started_at: "2025-01-15T09:01:00Z",
      completed_at: "2025-01-15T09:03:45Z",
      baseline_build_status: "success",
      candidate_build_status: "success",
    },
    journey: {
      journey_id: "jrn-001",
      journey_name: "ShopFlow — Product Purchase Journey",
      journey_description: "Full purchase journey.",
      journey_type: "user",
      journey_source: "requirement",
    },
    protected_behavior: {
      id: "pb-001",
      description: "Product inventory must reflect the latest write.",
      source: "contract_derived",
      confidence: 1.0,
    },
    verdict: {
      verdict: "regression",
      final_verdict: "review_required",
      protected_behavior_confidence: 1.0,
      confidence_source: "contract_derived",
      severity: "high",
      recommended_action: "Invalidate cache on inventory update.",
    },
    behavioral_evidence: {
      baseline_observation: {
        side: "baseline",
        raw_output: '{"status":200,"body":{"stock":1}}',
        normalized_output: { status: 200, body: { stock: 1 } },
        captured_at: "2025-01-15T09:02:10Z",
      },
      candidate_observation: {
        side: "candidate",
        raw_output: '{"status":200,"body":{"stock":3}}',
        normalized_output: { status: 200, body: { stock: 3 } },
        captured_at: "2025-01-15T09:02:25Z",
      },
      changed: true,
      diff_detail: "body.stock: baseline=1, candidate=3.",
      explanation: "Cache was not invalidated on inventory write.",
    },
    replay_steps: [
      {
        step_id: "step-1",
        sequence: 1,
        name: "Product Search",
        action: "GET /products?q=widget",
        baseline_result: {
          side: "baseline",
          raw_output: '{"status":200}',
          normalized_output: { status: 200 },
          captured_at: "2025-01-15T09:01:05Z",
        },
        candidate_result: {
          side: "candidate",
          raw_output: '{"status":200}',
          normalized_output: { status: 200 },
          captured_at: "2025-01-15T09:01:05Z",
        },
        verdict: "preserved",
        changed: false,
        explanation: "Search results identical.",
      },
      {
        step_id: "step-3",
        sequence: 3,
        name: "Read Inventory",
        action: "GET /products/product-99 (post-inventory-write)",
        expected_hint: "Must return stock=1",
        baseline_result: {
          side: "baseline",
          raw_output: '{"status":200,"body":{"stock":1}}',
          normalized_output: { status: 200, body: { stock: 1 } },
          captured_at: "2025-01-15T09:02:10Z",
        },
        candidate_result: {
          side: "candidate",
          raw_output: '{"status":200,"body":{"stock":3}}',
          normalized_output: { status: 200, body: { stock: 3 } },
          captured_at: "2025-01-15T09:02:25Z",
        },
        verdict: "regression",
        confidence_source: "contract_derived",
        confidence_score: 1.0,
        changed: true,
        explanation: "Cache not invalidated. Stale value returned.",
      },
    ],
    reproduction: {
      steps: [
        "1. Update inventory for product-99 to stock=1",
        "2. GET /products/product-99",
        "3. Observe candidate returns stale stock=3",
      ],
      scenario_id: "scn-001",
    },
  };
  return { ...base, ...overrides };
}

/** Render and await the capsule to finish loading */
async function renderCapsuleAndAwait(
  props: Partial<typeof BASE_PROPS> = {},
  capsule: EvidenceCapsule = makeCapsule(),
) {
  mockGetEvidenceCapsule.mockResolvedValue(capsule);
  await act(async () => {
    render(<EvidenceCapsuleView {...BASE_PROPS} {...props} />);
  });
  await waitFor(() => {
    expect(screen.queryByTestId("ecv-loading")).toBeNull();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EvidenceCapsuleView — B06", () => {

  // ── 1. Required metadata ──────────────────────────────────────────────────

  it("renders capsule version from metadata", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-version");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("1.0");
  });

  it("renders run_id from metadata", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-run-id");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("CR-CAPSULE01");
  });

  it("renders generated_at timestamp", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-generated-at");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("2025-01-15T09:04:00Z");
  });

  // ── 2. Requirement preservation ──────────────────────────────────────────

  it("renders the requirement text from the capsule", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-requirement");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain(
      "Add caching to the Product API to improve response time.",
    );
  });

  it("shows requirement in the navigation header", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-header-requirement");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain(BASE_PROPS.requirement);
  });

  // ── 3. Change context ─────────────────────────────────────────────────────

  it("renders base_ref", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-base-ref");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("main");
  });

  it("renders candidate_ref", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-candidate-ref");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("feature/product-cache");
  });

  it("renders diff_summary when present", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-diff-summary");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("Add Redis caching");
  });

  it("renders affected_files when present", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-affected-files");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("src/productService.ts");
  });

  it("does not render PR number when absent", async () => {
    await renderCapsuleAndAwait();
    expect(screen.queryByTestId("ecv-pr-number")).toBeNull();
  });

  it("renders PR number when present", async () => {
    const capsule = makeCapsule({
      change: { base_ref: "main", candidate_ref: "feat/x", pr_number: 42 },
    });
    await renderCapsuleAndAwait({}, capsule);
    const el = screen.getByTestId("ecv-pr-number");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("42");
  });

  // ── 4. Verdict preservation ───────────────────────────────────────────────

  it("renders the canonical journey verdict from engine (not inferred)", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const verdictEl = screen.getByTestId("ecv-verdict-section");
      const badge = verdictEl.querySelector('[data-verdict="regression"]');
      expect(badge).not.toBeNull();
    });
  });

  it("renders the final_verdict", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-final-verdict");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("Review Required");
  });

  it("renders severity tag when present", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-severity");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("high");
  });

  it("renders recommended_action when present", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-recommended-action");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("Invalidate cache on inventory update.");
  });

  // ── 5. Confidence preservation ────────────────────────────────────────────

  it("renders confidence_source from verdict", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const verdictEl = screen.getByTestId("ecv-verdict-section");
      const pill = verdictEl.querySelector(".conf-contract");
      expect(pill).not.toBeNull();
    });
  });

  it("renders protected_behavior_confidence percentage", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const verdictEl = screen.getByTestId("ecv-verdict-section");
      const score = verdictEl.querySelector(".conf-score");
      expect(score).not.toBeNull();
      expect(score?.textContent).toContain("100%");
    });
  });

  // ── 6. Baseline observation ───────────────────────────────────────────────

  it("renders baseline observation raw_output", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-obs-baseline");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("stock");
  });

  // ── 7. Candidate observation ──────────────────────────────────────────────

  it("renders candidate observation raw_output", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-obs-candidate");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("stock");
  });

  // ── 8. Changed flag (engine-authoritative) ────────────────────────────────

  it("renders changed=true flag from engine", async () => {
    await renderCapsuleAndAwait();
    const flagEl = screen.getByTestId("ecv-changed-flag");
    expect(flagEl).not.toBeNull();
    const trueEl = flagEl.querySelector('[data-changed="true"]');
    expect(trueEl).not.toBeNull();
    expect(flagEl.textContent).toContain("YES — divergence detected by engine");
  });

  it("renders changed=false flag from engine", async () => {
    const capsule = makeCapsule({
      behavioral_evidence: {
        ...makeCapsule().behavioral_evidence,
        changed: false,
        explanation: undefined,
        diff_detail: undefined,
      },
    });
    await renderCapsuleAndAwait({}, capsule);
    const flagEl = screen.getByTestId("ecv-changed-flag");
    const falseEl = flagEl.querySelector('[data-changed="false"]');
    expect(falseEl).not.toBeNull();
    expect(flagEl.textContent).toContain("NO — no divergence");
  });

  // ── 9. Journey replay steps ───────────────────────────────────────────────

  it("renders all replay steps in sequence order", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const step1 = screen.getByTestId("ecv-step-1");
      const step3 = screen.getByTestId("ecv-step-3");
      expect(step1).not.toBeNull();
      expect(step3).not.toBeNull();
      // Step 1 appears before step 3 in DOM order
      expect(
        step1.compareDocumentPosition(step3) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("renders step names", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      expect(screen.getByTestId("ecv-step-1").textContent).toContain("Product Search");
      expect(screen.getByTestId("ecv-step-3").textContent).toContain("Read Inventory");
    });
  });

  it("renders step verdicts", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      expect(
        screen.getByTestId("ecv-step-1").querySelector('[data-verdict="preserved"]'),
      ).not.toBeNull();
      expect(
        screen.getByTestId("ecv-step-3").querySelector('[data-verdict="regression"]'),
      ).not.toBeNull();
    });
  });

  // ── 10. Divergent step identified ─────────────────────────────────────────

  it("marks the divergent step with the diverged marker", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const marker = screen.getByTestId("ecv-divergent-3");
      expect(marker).not.toBeNull();
      expect(marker.textContent).toContain("DIVERGED");
    });
  });

  it("does not mark non-divergent steps", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      expect(screen.queryByTestId("ecv-divergent-1")).toBeNull();
    });
  });

  it("marks divergent step row with css class", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const row = screen.getByTestId("ecv-step-3");
      expect(row.className).toContain("ecv-step-row-divergent");
    });
  });

  it("does not mark non-divergent step row", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const row = screen.getByTestId("ecv-step-1");
      expect(row.className).not.toContain("ecv-step-row-divergent");
    });
  });

  // ── 11. error_code preservation ───────────────────────────────────────────

  it("renders errors section when errors are present", async () => {
    const capsule = makeCapsule({
      errors: [
        {
          error_code: "INFERENCE_ONLY_PROTECTED_BEHAVIOR",
          message: "All protected behaviors are inferred; developer review required.",
        },
      ],
    });
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      const errorsSection = screen.getByTestId("ecv-errors");
      expect(errorsSection).not.toBeNull();
      const codeEl = screen.getByTestId("ecv-error-code-0");
      expect(codeEl).not.toBeNull();
      expect(codeEl.textContent).toContain("INFERENCE_ONLY_PROTECTED_BEHAVIOR");
      const errEl = screen.getByTestId("ecv-error-0");
      expect(errEl.textContent).toContain("All protected behaviors are inferred");
    });
  });

  it("preserves machine-readable error_code alongside human-readable message", async () => {
    const capsule = makeCapsule({
      errors: [
        { error_code: "BUILD_FAILURE", message: "Candidate build failed." },
      ],
    });
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      expect(screen.getByTestId("ecv-error-code-0").textContent).toContain("BUILD_FAILURE");
      expect(screen.getByTestId("ecv-error-0").textContent).toContain("Candidate build failed.");
    });
  });

  it("does not render errors section when no errors", async () => {
    const capsule = makeCapsule({ errors: undefined });
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      expect(screen.queryByTestId("ecv-errors")).toBeNull();
    });
  });

  // ── 12. Missing optional fields ───────────────────────────────────────────

  it("renders without protected_behavior when absent", async () => {
    const capsule = makeCapsule({ protected_behavior: undefined });
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      expect(screen.queryByTestId("ecv-protected-behavior")).toBeNull();
      // The rest of the verdict section still renders
      expect(screen.getByTestId("ecv-verdict-section")).not.toBeNull();
    });
  });

  it("renders without reproduction when absent", async () => {
    const capsule = makeCapsule({ reproduction: undefined });
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      expect(screen.queryByTestId("ecv-reproduction")).toBeNull();
    });
  });

  it("renders without diff_summary and affected_files when absent", async () => {
    const capsule = makeCapsule({
      change: { base_ref: "main", candidate_ref: "feat/x" },
    });
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      expect(screen.queryByTestId("ecv-diff-summary")).toBeNull();
      expect(screen.queryByTestId("ecv-affected-files")).toBeNull();
    });
  });

  it("renders without severity when absent from verdict", async () => {
    const capsule = makeCapsule({
      verdict: { verdict: "preserved", final_verdict: "ready_to_merge" },
    });
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      expect(screen.queryByTestId("ecv-severity")).toBeNull();
    });
  });

  // ── 13. Empty evidence / no replay steps ──────────────────────────────────

  it("renders empty-notice when replay_steps is empty", async () => {
    const capsule = makeCapsule({ replay_steps: [] });
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      expect(screen.getByTestId("ecv-empty-notice")).not.toBeNull();
      // But main sections still render
      expect(screen.getByTestId("ecv-header")).not.toBeNull();
      expect(screen.getByTestId("ecv-verdict-section")).not.toBeNull();
    });
  });

  it("renders ecv-replay-empty inside the replay section when steps = []", async () => {
    const capsule = makeCapsule({ replay_steps: [] });
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      expect(screen.getByTestId("ecv-replay-empty")).not.toBeNull();
    });
  });

  // ── 14. API failure state ─────────────────────────────────────────────────

  it("renders error banner when API rejects", async () => {
    mockGetEvidenceCapsule.mockRejectedValue(new Error("Rehearsal not found"));
    await act(async () => {
      render(<EvidenceCapsuleView {...BASE_PROPS} />);
    });
    await waitFor(() => {
      const errBanner = screen.getByTestId("ecv-error");
      expect(errBanner).not.toBeNull();
      expect(errBanner.textContent).toContain("Rehearsal not found");
    });
  });

  it("does not render capsule sections when API fails", async () => {
    mockGetEvidenceCapsule.mockRejectedValue(new Error("Network error"));
    await act(async () => {
      render(<EvidenceCapsuleView {...BASE_PROPS} />);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("ecv-loading")).toBeNull();
    });
    expect(screen.queryByTestId("ecv-header")).toBeNull();
  });

  // ── 15. Export: copy button ───────────────────────────────────────────────

  it("renders Copy JSON button", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const btn = screen.getByTestId("ecv-btn-copy");
      expect(btn).not.toBeNull();
      expect(btn.textContent).toContain("Copy JSON");
    });
  });

  // ── 16. Export: download button ──────────────────────────────────────────

  it("renders Download JSON button", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const btn = screen.getByTestId("ecv-btn-download");
      expect(btn).not.toBeNull();
      expect(btn.textContent).toContain("Download JSON");
    });
  });

  it("download button aria-label contains the run_id", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const btn = screen.getByTestId("ecv-btn-download");
      expect(btn.getAttribute("aria-label")).toBe(
        "Download evidence-capsule-CR-CAPSULE01.json",
      );
    });
  });

  // ── 17. Export: JSON preview matches canonical capsule object ────────────

  it("ecv-json-preview renders the full capsule as JSON", async () => {
    const capsule = makeCapsule();
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      const preview = screen.getByTestId("ecv-json-preview");
      const parsed = JSON.parse(preview.textContent!);
      expect(parsed.metadata.run_id).toBe("CR-CAPSULE01");
      expect(parsed.metadata.capsule_format_version).toBe("1.0");
      expect(parsed.verdict.verdict).toBe("regression");
      expect(parsed.behavioral_evidence.changed).toBe(true);
    });
  });

  it("JSON preview contains the requirement text verbatim", async () => {
    const capsule = makeCapsule();
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      const parsed = JSON.parse(screen.getByTestId("ecv-json-preview").textContent!);
      expect(parsed.requirement.text).toBe(
        "Add caching to the Product API to improve response time.",
      );
    });
  });

  it("JSON preview contains all replay steps", async () => {
    const capsule = makeCapsule();
    await renderCapsuleAndAwait({}, capsule);
    await waitFor(() => {
      const parsed = JSON.parse(screen.getByTestId("ecv-json-preview").textContent!);
      expect(parsed.replay_steps).toHaveLength(2);
      expect(parsed.replay_steps[1].changed).toBe(true);
      expect(parsed.replay_steps[1].verdict).toBe("regression");
    });
  });

  it("exported JSON exactly matches capsule used by UI (no divergence)", async () => {
    const capsule = makeCapsule();
    mockGetEvidenceCapsule.mockResolvedValue(capsule);
    await act(async () => {
      render(<EvidenceCapsuleView {...BASE_PROPS} />);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("ecv-loading")).toBeNull();
    });
    const preview = screen.getByTestId("ecv-json-preview");
    const parsed = JSON.parse(preview.textContent!);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(capsule));
  });

  // ── 18. Run ID and requirement always visible in header ───────────────────

  it("run ID is always visible in the header", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-header-run-id");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain(BASE_PROPS.runId);
  });

  it("requirement is always visible in the header", async () => {
    await renderCapsuleAndAwait();
    const el = screen.getByTestId("ecv-header-requirement");
    expect(el).not.toBeNull();
    expect(el.textContent).toContain(BASE_PROPS.requirement);
  });

  // ── 19. Back button ───────────────────────────────────────────────────────

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    await renderCapsuleAndAwait({ onBack });
    fireEvent.click(screen.getByTestId("ecv-back-btn"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // ── Reproduction steps ────────────────────────────────────────────────────

  it("renders reproduction steps when present", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const reproSection = screen.getByTestId("ecv-reproduction");
      expect(reproSection).not.toBeNull();
      const steps = screen.getByTestId("ecv-repro-steps");
      expect(steps.querySelectorAll("li")).toHaveLength(3);
      expect(steps.textContent).toContain("1. Update inventory");
    });
  });

  it("renders scenario_id when present in reproduction", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const el = screen.getByTestId("ecv-scenario-id");
      expect(el).not.toBeNull();
      expect(el.textContent).toContain("scn-001");
    });
  });

  // ── Journey name ──────────────────────────────────────────────────────────

  it("renders the journey name in the replay section", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const el = screen.getByTestId("ecv-journey-name");
      expect(el).not.toBeNull();
      expect(el.textContent).toContain("ShopFlow — Product Purchase Journey");
    });
  });

  // ── Protected behavior ────────────────────────────────────────────────────

  it("renders protected behavior description when present", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const el = screen.getByTestId("ecv-protected-behavior");
      expect(el).not.toBeNull();
      expect(el.textContent).toContain("Product inventory must reflect the latest write.");
    });
  });

  // ── Behavioral evidence explanation ──────────────────────────────────────

  it("renders explanation when present in behavioral evidence", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const el = screen.getByTestId("ecv-explanation");
      expect(el).not.toBeNull();
      expect(el.textContent).toContain("Cache was not invalidated on inventory write.");
    });
  });

  it("renders diff_detail when present in behavioral evidence", async () => {
    await renderCapsuleAndAwait();
    await waitFor(() => {
      const el = screen.getByTestId("ecv-diff-detail");
      expect(el).not.toBeNull();
      expect(el.textContent).toContain("body.stock: baseline=1, candidate=3.");
    });
  });
});

// ---------------------------------------------------------------------------
// B05 → B06 navigation integration
// ---------------------------------------------------------------------------

describe("JourneyReplayView → EvidenceCapsuleView navigation (B05→B06)", () => {
  const REPLAY_PROPS = {
    runId: "CR-CAPSULE01",
    journeyId: "jrn-001",
    requirement: "Add caching to Product API to improve response time.",
    onBack: vi.fn(),
  } as const;

  function makeReplay(): JourneyReplayDetail {
    return {
      run_id: "CR-CAPSULE01",
      journey: {
        id: "jrn-001",
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
            raw_output: '{"status":200}',
            normalized_output: { status: 200 },
            captured_at: "2025-01-15T09:01:05Z",
          },
          candidate_result: {
            side: "candidate",
            raw_output: '{"status":200}',
            normalized_output: { status: 200 },
            captured_at: "2025-01-15T09:01:05Z",
          },
          verdict: "preserved",
          changed: false,
        },
      ],
    };
  }

  // ── 20. Evidence Capsule button present in JourneyReplayView ─────────────

  it("renders the Evidence Capsule button in JourneyReplayView", async () => {
    mockGetJourneyReplay.mockResolvedValue(makeReplay());
    await act(async () => {
      render(<JourneyReplayView {...REPLAY_PROPS} />);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("jrv-loading")).toBeNull();
    });
    const btn = screen.getByTestId("jrv-capsule-btn");
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("Evidence Capsule");
  });

  // ── 21. Navigates to capsule view on click ────────────────────────────────

  it("navigates to EvidenceCapsuleView when Evidence Capsule button is clicked", async () => {
    mockGetJourneyReplay.mockResolvedValue(makeReplay());
    mockGetEvidenceCapsule.mockResolvedValue(makeCapsule());

    await act(async () => {
      render(<JourneyReplayView {...REPLAY_PROPS} />);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("jrv-loading")).toBeNull();
    });

    // Click Evidence Capsule button
    await act(async () => {
      fireEvent.click(screen.getByTestId("jrv-capsule-btn"));
    });

    // Should now show the capsule view
    await waitFor(() => {
      expect(screen.getByTestId("ecv-view")).not.toBeNull();
      expect(screen.queryByTestId("jrv-view")).toBeNull();
    });
  });

  it("navigates back from capsule to replay on back button click", async () => {
    mockGetJourneyReplay.mockResolvedValue(makeReplay());
    mockGetEvidenceCapsule.mockResolvedValue(makeCapsule());

    await act(async () => {
      render(<JourneyReplayView {...REPLAY_PROPS} />);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("jrv-loading")).toBeNull();
    });

    // Navigate to capsule
    await act(async () => {
      fireEvent.click(screen.getByTestId("jrv-capsule-btn"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("ecv-view")).not.toBeNull();
    });

    // Navigate back
    await act(async () => {
      fireEvent.click(screen.getByTestId("ecv-back-btn"));
    });

    // Should be back to JourneyReplayView
    await waitFor(() => {
      expect(screen.getByTestId("jrv-view")).not.toBeNull();
      expect(screen.queryByTestId("ecv-view")).toBeNull();
    });
  });
});
