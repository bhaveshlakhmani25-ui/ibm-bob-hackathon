/**
 * run command — Change Submission Flow (B02)
 *
 * Entry point for starting a rehearsal from the CLI.
 * Corresponds to docs/BHAVESH_IMPLEMENTATION_PLAN.md §5.2
 *
 * Flow:
 *  1. Validate flags
 *  2. Render start screen
 *  3. POST /api/rehearsals → StartRehearsalResponse
 *  4. Hand off to RehearsalDashboard for live progress
 *  5. On completion, hand off to BehavioralDiffTable
 *  6. Exit with appropriate code
 */
import chalk from "chalk";
import type { Command } from "commander";
import path from "node:path";
import type { StartRehearsalRequest } from "../../shared/contracts.js";
import { startRehearsal, ApiError } from "../utils/apiClient.js";
import { EXIT } from "../utils/exitCodes.js";
import { header, divider } from "../utils/formatters.js";
import { runDashboard } from "../views/RehearsalDashboard.js";
import { renderBehavioralDiffTable } from "../views/BehavioralDiffTable.js";
import { fetchReport } from "../utils/apiClient.js";

// ---------------------------------------------------------------------------
// Option types
// ---------------------------------------------------------------------------

export interface RunOptions {
  repo: string;
  base: string;
  candidate: string;
  requirement?: string;
  pr?: string;
  out?: "table" | "json" | "markdown";
  apiUrl?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateRunOptions(opts: RunOptions): ValidationResult {
  const errors: string[] = [];

  if (!opts.repo || opts.repo.trim() === "") {
    errors.push("--repo is required: provide the path to the repository.");
  }
  if (!opts.base || opts.base.trim() === "") {
    errors.push("--base is required: provide the baseline Git ref (e.g. main).");
  }
  if (!opts.candidate || opts.candidate.trim() === "") {
    errors.push("--candidate is required: provide the candidate Git ref (e.g. feature/my-change).");
  }
  if (opts.base && opts.candidate && opts.base.trim() === opts.candidate.trim()) {
    errors.push("--base and --candidate must differ: they point to the same ref.");
  }
  if (opts.pr !== undefined) {
    const prNum = Number(opts.pr);
    if (!Number.isInteger(prNum) || prNum <= 0) {
      errors.push("--pr must be a positive integer (GitHub PR number).");
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------

export function renderStartScreen(opts: RunOptions): void {
  console.log();
  console.log(header("Change Rehearsal"));
  console.log(divider());
  console.log();
  console.log(`Repository:  ${chalk.cyan(path.resolve(opts.repo))}`);
  console.log(`Base:        ${chalk.dim(opts.base)}`);
  console.log(`Candidate:   ${chalk.bold(opts.candidate)}`);
  if (opts.pr) {
    console.log(`PR:          ${chalk.dim("#" + opts.pr)}`);
  }
  console.log();

  if (opts.requirement && opts.requirement.trim() !== "") {
    console.log(chalk.bold("Requirement:"));
    console.log(chalk.italic("  " + opts.requirement.trim()));
    console.log();
  } else {
    console.log(chalk.dim("Requirement: (none provided — intent will be inferred from the diff)"));
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Main run handler
// ---------------------------------------------------------------------------

export async function runCommand(opts: RunOptions): Promise<number> {
  // 1. Validate
  const validation = validateRunOptions(opts);
  if (!validation.valid) {
    console.error(chalk.red.bold("Invalid arguments:"));
    for (const err of validation.errors) {
      console.error(chalk.red("  ✗ " + err));
    }
    console.error();
    return EXIT.INVALID_CONFIG;
  }

  // 2. Start screen
  renderStartScreen(opts);
  console.log(chalk.dim("[ Starting rehearsal... ]"));
  console.log();

  // 3. Build the request — aligned with StartRehearsalRequest contract §4.1
  const request: StartRehearsalRequest = {
    repo_path: path.resolve(opts.repo),
    base_ref: opts.base.trim(),
    candidate_ref: opts.candidate.trim(),
    ...(opts.requirement?.trim() ? { requirement: opts.requirement.trim() } : {}),
    ...(opts.pr ? { pr_number: Number(opts.pr) } : {}),
  };

  // 4. POST /api/rehearsals
  let runId: string;
  try {
    const response = await startRehearsal(request, opts.apiUrl);
    runId = response.run_id;
    console.log(
      chalk.green("✓ Rehearsal started") +
        "  " +
        chalk.dim("run_id:") +
        " " +
        chalk.bold(runId),
    );
    console.log(chalk.dim("  Status: " + response.status + "   Started: " + response.started_at));
    console.log();
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(chalk.red.bold("Failed to start rehearsal:"), err.message);
      if (err.status === 400) {
        console.error(chalk.dim("Check that --repo, --base, and --candidate are correct."));
      } else if (err.status === 0) {
        console.error(
          chalk.dim("Cannot reach the rehearsal engine at: ") +
            chalk.dim(opts.apiUrl ?? process.env["REHEARSAL_API_URL"] ?? "http://localhost:3001"),
        );
        console.error(chalk.dim("Is the engine running?"));
      }
    } else {
      console.error(chalk.red.bold("Unexpected error:"), err instanceof Error ? err.message : String(err));
    }
    return EXIT.EXECUTION_FAILURE;
  }

  // 5. Hand off to RehearsalDashboard
  const { exitCode: dashboardExitCode, finalStatus } = await runDashboard(runId, opts.apiUrl);

  if (!finalStatus || finalStatus.status !== "completed") {
    return dashboardExitCode;
  }

  // 6. Fetch report and render BehavioralDiffTable
  try {
    const report = await fetchReport(runId, opts.apiUrl);

    if (opts.out === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      renderBehavioralDiffTable(report.behavioral_diff_rows, report.summary);
    }

    return report.summary.regressions > 0 ? EXIT.REGRESSIONS : EXIT.OK;
  } catch (err) {
    console.error(
      chalk.red("Failed to fetch report:"),
      err instanceof Error ? err.message : String(err),
    );
    return EXIT.EXECUTION_FAILURE;
  }
}

// ---------------------------------------------------------------------------
// Commander registration
// ---------------------------------------------------------------------------

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Start a change rehearsal run")
    .requiredOption("--repo <path>", "Path to the repository")
    .requiredOption("--base <ref>", "Baseline Git ref (e.g. main)")
    .requiredOption("--candidate <ref>", "Candidate Git ref (e.g. feature/my-change)")
    .option("--requirement <text>", "Free-text developer intent / requirement")
    .option("--pr <number>", "GitHub PR number (optional)")
    .option("--out <format>", "Output format: table (default) | json | markdown", "table")
    .option("--api-url <url>", "Override the engine API base URL")
    .action(async (opts: RunOptions) => {
      const exitCode = await runCommand(opts);
      process.exit(exitCode);
    });
}
