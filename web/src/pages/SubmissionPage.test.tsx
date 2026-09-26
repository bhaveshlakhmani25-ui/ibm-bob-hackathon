import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SubmissionPage } from "./SubmissionPage";
import * as api from "../services/api";

vi.mock("../services/api", () => ({
  startRehearsal: vi.fn(),
  getRehearsalStatus: vi.fn(),
}));

describe("SubmissionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the clean form initially", () => {
    render(<SubmissionPage />);
    expect(screen.getByText("CHANGE REHEARSAL")).toBeDefined();
    expect(screen.getByLabelText(/What were you trying to change?/i)).toBeDefined();
    expect(screen.getByLabelText(/Repository/i)).toBeDefined();
    expect(screen.getByLabelText(/Change Source/i)).toBeDefined();
    expect(screen.getByLabelText(/Base Branch/i)).toBeDefined();
    
    const startBtn = screen.getByRole("button", { name: /Start Rehearsal/i });
    expect(startBtn).toBeDefined();
    // button should be disabled initially because intent is empty
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables the submit button when required inputs are valid", () => {
    render(<SubmissionPage />);
    const startBtn = screen.getByRole("button", { name: /Start Rehearsal/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);

    const intentTextarea = screen.getByLabelText(/What were you trying to change?/i);
    fireEvent.change(intentTextarea, { target: { value: "Add caching" } });
    
    expect((startBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits the form successfully and transitions to progress state", async () => {
    (api.startRehearsal as any).mockResolvedValue({
      run_id: "CR-123",
      status: "started",
      started_at: new Date().toISOString()
    });

    render(<SubmissionPage />);
    
    const intentTextarea = screen.getByLabelText(/What were you trying to change?/i);
    fireEvent.change(intentTextarea, { target: { value: "Add caching" } });

    const startBtn = screen.getByRole("button", { name: /Start Rehearsal/i });
    fireEvent.click(startBtn);

    // Button should be disabled and show loading state
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Starting/i)).toBeDefined();

    // Wait for the mock API call to resolve and UI to transition
    await waitFor(() => {
      expect(screen.getByText("ID: CR-123")).toBeDefined();
    });

    expect(api.startRehearsal).toHaveBeenCalledWith({
      repo_path: "ShopFlow",
      base_ref: "main",
      candidate_ref: "working_tree",
      requirement: "Add caching"
    });
  });

  it("shows an error message on API failure and allows retry", async () => {
    (api.startRehearsal as any).mockRejectedValue(new Error("Simulated failure"));

    render(<SubmissionPage />);
    
    const intentTextarea = screen.getByLabelText(/What were you trying to change?/i);
    fireEvent.change(intentTextarea, { target: { value: "Fail this" } });

    const startBtn = screen.getByRole("button", { name: /Start Rehearsal/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(screen.getByText("Simulated failure")).toBeDefined();
    });

    // Verify user input is preserved
    expect((intentTextarea as HTMLTextAreaElement).value).toBe("Fail this");

    // Click retry
    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    fireEvent.click(retryBtn);

    expect(screen.queryByText("Simulated failure")).toBeNull();
  });
});
