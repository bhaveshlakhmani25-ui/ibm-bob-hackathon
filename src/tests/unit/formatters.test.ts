/**
 * Unit tests — formatters
 *
 * Tests pure formatting functions for verdict symbols, labels, and phase display.
 * Does NOT require chalk ANSI output — tests the structural / non-empty correctness.
 */
import { describe, it, expect } from "vitest";
import chalk from "chalk";
import {
  verdictSymbol,
  verdictLabel,
  confidenceLabel,
  phaseLabel,
  statusIndicator,
  PHASE_ORDER,
} from "../../cli/utils/formatters.js";
import type { Verdict, ConfidenceLevel, RunStatus, RehearsalPhase } from "../../shared/contracts.js";

// Strip ANSI codes for assertion purposes
function strip(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, "");
}

const VERDICTS: Verdict[] = [
  "preserved",
  "intentional_change",
  "regression",
  "potentially_affected",
  "not_exercised",
];

const CONFIDENCE_LEVELS: ConfidenceLevel[] = [
  "confirmed",
  "test_derived",
  "contract_derived",
  "inferred",
];

const STATUSES: RunStatus[] = ["running", "completed", "failed", "build_failed"];

describe("verdictSymbol", () => {
  for (const verdict of VERDICTS) {
    it(`returns a non-empty symbol for "${verdict}"`, () => {
      const sym = strip(verdictSymbol(verdict));
      expect(sym.trim()).toBeTruthy();
    });
  }

  it("returns green-colored symbol for preserved", () => {
    // chalk may be disabled in test env; test structural shape instead
    const sym = verdictSymbol("preserved");
    expect(sym).toContain("✓");
  });

  it("returns red-colored symbol for regression", () => {
    const sym = verdictSymbol("regression");
    expect(sym).toContain("✗");
  });
});

describe("verdictLabel", () => {
  for (const verdict of VERDICTS) {
    it(`returns non-empty label for "${verdict}"`, () => {
      const label = strip(verdictLabel(verdict));
      expect(label.trim()).toBeTruthy();
    });
  }

  it("includes the word 'regression' for regression verdict", () => {
    expect(strip(verdictLabel("regression"))).toContain("regression");
  });

  it("includes 'preserved' for preserved verdict", () => {
    expect(strip(verdictLabel("preserved"))).toContain("preserved");
  });
});

describe("confidenceLabel", () => {
  for (const level of CONFIDENCE_LEVELS) {
    it(`returns a non-empty label for "${level}"`, () => {
      const label = strip(confidenceLabel(level));
      expect(label.trim()).toBeTruthy();
    });
  }

  it("includes the word 'test-derived' for test_derived", () => {
    expect(strip(confidenceLabel("test_derived"))).toContain("test-derived");
  });
});

describe("phaseLabel", () => {
  for (const phase of PHASE_ORDER) {
    it(`returns a non-empty human label for phase "${phase}"`, () => {
      const label = phaseLabel(phase as RehearsalPhase);
      expect(label.trim()).toBeTruthy();
    });
  }

  it("returns 'Loading repository' for loading_repository", () => {
    expect(phaseLabel("loading_repository")).toBe("Loading repository");
  });
});

describe("statusIndicator", () => {
  for (const status of STATUSES) {
    it(`returns non-empty indicator for "${status}"`, () => {
      const indicator = strip(statusIndicator(status));
      expect(indicator.trim()).toBeTruthy();
    });
  }
});

describe("PHASE_ORDER", () => {
  it("contains 11 phases (10 pipeline + completed)", () => {
    expect(PHASE_ORDER).toHaveLength(11);
  });

  it("starts with loading_repository", () => {
    expect(PHASE_ORDER[0]).toBe("loading_repository");
  });

  it("ends with completed", () => {
    expect(PHASE_ORDER[PHASE_ORDER.length - 1]).toBe("completed");
  });
});
