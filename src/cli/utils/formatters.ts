/**
 * ANSI formatting helpers and verdict display utilities.
 * Wraps chalk so that tests can swap to a no-color mode easily.
 */
import chalk from "chalk";
import type { Verdict, ConfidenceLevel, RunStatus, RehearsalPhase } from "../../shared/contracts.js";

// ---------------------------------------------------------------------------
// Verdict symbols and colors
// ---------------------------------------------------------------------------

export function verdictSymbol(verdict: Verdict): string {
  switch (verdict) {
    case "preserved":
      return chalk.green("✓");
    case "intentional_change":
      return chalk.blue("~");
    case "regression":
      return chalk.red("✗");
    case "potentially_affected":
      return chalk.yellow("?");
    case "not_exercised":
      return chalk.dim("○");
  }
}

export function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case "preserved":
      return chalk.green("preserved");
    case "intentional_change":
      return chalk.blue("intentional change");
    case "regression":
      return chalk.red("regression");
    case "potentially_affected":
      return chalk.yellow("potentially affected");
    case "not_exercised":
      return chalk.dim("not exercised");
  }
}

// ---------------------------------------------------------------------------
// Confidence level coloring
// ---------------------------------------------------------------------------

export function confidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case "confirmed":
      return chalk.green(`[${level}]`);
    case "test_derived":
      return chalk.cyan("[test-derived]");
    case "contract_derived":
      return chalk.yellow("[contract-derived]");
    case "inferred":
      return chalk.dim("[inferred]");
  }
}

// ---------------------------------------------------------------------------
// Phase display names (human-readable)
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<RehearsalPhase, string> = {
  loading_repository: "Loading repository",
  extracting_change: "Extracting change",
  compiling_journeys: "Compiling journeys",
  analyzing_impact: "Analyzing impact",
  resolving_protected_behaviors: "Resolving protected behaviors",
  planning_scenarios: "Planning scenarios",
  running_baseline: "Running baseline",
  running_candidate: "Running candidate",
  comparing: "Comparing",
  generating_report: "Generating report",
  completed: "Completed",
};

export const PHASE_ORDER: RehearsalPhase[] = [
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

export function phaseLabel(phase: RehearsalPhase): string {
  return PHASE_LABELS[phase];
}

// ---------------------------------------------------------------------------
// Run status indicator
// ---------------------------------------------------------------------------

export function statusIndicator(status: RunStatus): string {
  switch (status) {
    case "running":
      return chalk.cyan("⟳ running");
    case "completed":
      return chalk.green("✓ completed");
    case "failed":
      return chalk.red("✗ failed");
    case "build_failed":
      return chalk.red("✗ build failed");
  }
}

// ---------------------------------------------------------------------------
// Section divider
// ---------------------------------------------------------------------------

export function divider(width = 60): string {
  return chalk.dim("─".repeat(width));
}

export function header(title: string): string {
  return chalk.bold(title.toUpperCase());
}
