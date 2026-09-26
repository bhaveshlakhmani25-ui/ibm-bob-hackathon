/**
 * Unit tests — run command validation
 *
 * Tests the pure validation logic for the `run` command.
 * Does NOT require a running server.
 */
import { describe, it, expect } from "vitest";
import { validateRunOptions, type RunOptions } from "../../cli/commands/run.js";

const VALID_OPTS: RunOptions = {
  repo: "/repos/shopflow",
  base: "main",
  candidate: "feature/product-cache",
  requirement: "Add caching to the Product API",
};

describe("validateRunOptions", () => {
  it("passes with all required fields", () => {
    const result = validateRunOptions(VALID_OPTS);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes without optional requirement", () => {
    const opts: RunOptions = { ...VALID_OPTS, requirement: undefined };
    const result = validateRunOptions(opts);
    expect(result.valid).toBe(true);
  });

  it("fails when repo is empty", () => {
    const result = validateRunOptions({ ...VALID_OPTS, repo: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("--repo"))).toBe(true);
  });

  it("fails when repo is whitespace only", () => {
    const result = validateRunOptions({ ...VALID_OPTS, repo: "   " });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("--repo"))).toBe(true);
  });

  it("fails when base is empty", () => {
    const result = validateRunOptions({ ...VALID_OPTS, base: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("--base"))).toBe(true);
  });

  it("fails when candidate is empty", () => {
    const result = validateRunOptions({ ...VALID_OPTS, candidate: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("--candidate"))).toBe(true);
  });

  it("fails when base and candidate are identical", () => {
    const result = validateRunOptions({ ...VALID_OPTS, base: "main", candidate: "main" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("same ref"))).toBe(true);
  });

  it("fails when base and candidate are identical after trimming", () => {
    const result = validateRunOptions({ ...VALID_OPTS, base: " main ", candidate: "main" });
    expect(result.valid).toBe(false);
  });

  it("fails when pr is not a positive integer string", () => {
    const result = validateRunOptions({ ...VALID_OPTS, pr: "abc" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("--pr"))).toBe(true);
  });

  it("fails when pr is zero", () => {
    const result = validateRunOptions({ ...VALID_OPTS, pr: "0" });
    expect(result.valid).toBe(false);
  });

  it("fails when pr is negative", () => {
    const result = validateRunOptions({ ...VALID_OPTS, pr: "-5" });
    expect(result.valid).toBe(false);
  });

  it("passes when pr is a valid positive integer string", () => {
    const result = validateRunOptions({ ...VALID_OPTS, pr: "123" });
    expect(result.valid).toBe(true);
  });

  it("accumulates multiple errors", () => {
    const result = validateRunOptions({ repo: "", base: "", candidate: "", out: "table" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
