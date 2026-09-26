import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DeveloperActionsPanel } from "./DeveloperActionsPanel";
import * as api from "../services/api";

const renderTable = (ui: React.ReactElement) => {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>
  );
};

vi.mock("../services/api", () => ({
  getFixProposal: vi.fn(),
  rerunRehearsal: vi.fn(),
}));

describe("DeveloperActionsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
  });

  const defaultProps = {
    runId: "CR-123",
    journeyId: "j-1",
    verdict: "regression",
    onViewEvidence: vi.fn(),
  };

  it("1, 16, 17, 18 — only renders for regression or potentially_affected", () => {
    const { rerender } = renderTable(<DeveloperActionsPanel {...defaultProps} verdict="preserved" />);
    expect(screen.queryByText(/DEVELOPER ACTIONS/i)).toBeNull();

    rerender(
      <table>
        <tbody>
          <DeveloperActionsPanel {...defaultProps} verdict="intentional_change" />
        </tbody>
      </table>
    );
    expect(screen.queryByText(/DEVELOPER ACTIONS/i)).toBeNull();

    rerender(
      <table>
        <tbody>
          <DeveloperActionsPanel {...defaultProps} verdict="not_exercised" />
        </tbody>
      </table>
    );
    expect(screen.queryByText(/DEVELOPER ACTIONS/i)).toBeNull();

    rerender(
      <table>
        <tbody>
          <DeveloperActionsPanel {...defaultProps} verdict="regression" />
        </tbody>
      </table>
    );
    expect(screen.getByText(/DEVELOPER ACTIONS/i)).toBeDefined();

    rerender(
      <table>
        <tbody>
          <DeveloperActionsPanel {...defaultProps} verdict="potentially_affected" />
        </tbody>
      </table>
    );
    expect(screen.getByText(/DEVELOPER ACTIONS/i)).toBeDefined();
  });

  it("2 — View Evidence navigation", () => {
    renderTable(<DeveloperActionsPanel {...defaultProps} />);
    const btn = screen.getByTestId("btn-evidence-j-1");
    fireEvent.click(btn);
    expect(defaultProps.onViewEvidence).toHaveBeenCalled();
  });

  it("3, 4, 5, 6, 7 — Generate Fix renders proposal deterministically with NOT VERIFIED label", async () => {
    vi.mocked(api.getFixProposal).mockResolvedValue({
      root_issue: "Root issue test",
      suggested_change: "Suggested change test",
      suggested_regression_test: "Suggested test test",
      confidence: 0.92,
    });
    
    renderTable(<DeveloperActionsPanel {...defaultProps} />);
    const btn = screen.getByTestId("btn-fix-j-1");
    fireEvent.click(btn);
    
    expect(screen.getByText("Generating...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("PROPOSED FIX")).toBeDefined();
    });

    expect(screen.getByText("⚠ NOT VERIFIED")).toBeDefined();
    expect(screen.getByText("Root issue test")).toBeDefined();
    expect(screen.getByText("Suggested change test")).toBeDefined();
    expect(screen.getByText("Suggested test test")).toBeDefined();
    expect(screen.getByText("92%")).toBeDefined();
  });

  it("14, 15 — API failure handled on Generate Fix", async () => {
    vi.mocked(api.getFixProposal).mockRejectedValue(new Error("API Down"));
    
    renderTable(<DeveloperActionsPanel {...defaultProps} />);
    const btn = screen.getByTestId("btn-fix-j-1");
    fireEvent.click(btn);
    
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("Failed to generate fix");
    });
    expect(screen.queryByText("PROPOSED FIX")).toBeNull();
  });

  it("8 — Rerun action works after generating fix", async () => {
    vi.mocked(api.getFixProposal).mockResolvedValue({
      root_issue: "a", suggested_change: "b", suggested_regression_test: "c", confidence: 0.9,
    });
    vi.mocked(api.rerunRehearsal).mockResolvedValue({
      new_run_id: "CR-NEW", parent_run_id: "CR-123", status: "started", scoped_journey_ids: []
    });

    renderTable(<DeveloperActionsPanel {...defaultProps} />);
    fireEvent.click(screen.getByTestId("btn-fix-j-1"));
    
    await waitFor(() => {
      expect(screen.getByTestId("btn-rerun-j-1")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("btn-rerun-j-1"));
    expect(screen.getByText("Starting...")).toBeDefined();

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("Started new rehearsal run: CR-NEW");
    });
  });

  it("9, 10 — Mark Intentional stores and displays note", () => {
    renderTable(<DeveloperActionsPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText("Reason / Note");
    fireEvent.change(input, { target: { value: "My note" } });
    
    const btn = screen.getByTestId("btn-intentional-j-1");
    fireEvent.click(btn);
    
    expect(screen.getByText(/Marked Intentional/i)).toBeDefined();
    expect(screen.getByText(/My note/i)).toBeDefined();
  });

  it("11 — Ignore Finding stores and displays ignored state", () => {
    renderTable(<DeveloperActionsPanel {...defaultProps} />);
    const btn = screen.getByTestId("btn-ignore-j-1");
    fireEvent.click(btn);
    
    expect(screen.getByText(/Ignored ≠ Resolved/i)).toBeDefined();
  });
});
