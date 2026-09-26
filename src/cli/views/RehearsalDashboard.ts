/**
 * RehearsalDashboard — Live phase progress display.
 *
 * Polls GET /api/rehearsals/:run_id/status every second, renders the
 * pipeline phase list with ✓ / ● / ○ indicators.
 *
 * Contracts: src/shared/contracts.ts §4.2
 */
import chalk from "chalk";
import type { RehearsalStatusResponse, RehearsalPhase } from "../../shared/contracts.js";
import { getRehearsalStatus } from "../utils/apiClient.js";
import { header, divider, phaseLabel, statusIndicator, PHASE_ORDER } from "../utils/formatters.js";
import { EXIT } from "../utils/exitCodes.js";

const POLL_INTERVAL_MS = 1000;

function renderDashboard(status: RehearsalStatusResponse): void {
  // Clear the terminal between polls for a live-refresh feel
  process.stdout.write("\x1B[2J\x1B[0f");

  console.log(header("Change Rehearsal") + "  " + statusIndicator(status.status));
  console.log(divider());
  console.log();

  // Build status indicators
  const baselineLabel = buildStatusLabel("Baseline", status.baseline_build_status);
  const candidateLabel = buildStatusLabel("Candidate", status.candidate_build_status);
  if (
    status.baseline_build_status !== "pending" ||
    status.candidate_build_status !== "pending"
  ) {
    console.log(baselineLabel + "   " + candidateLabel);
    console.log();
  }

  const currentPhaseIndex = PHASE_ORDER.indexOf(status.phase);

  for (let i = 0; i < PHASE_ORDER.length - 1; i++) {
    const phase = PHASE_ORDER[i] as RehearsalPhase;
    const label = phaseLabel(phase);

    if (i < currentPhaseIndex) {
      // Completed phase
      console.log(`  ${chalk.green("✓")}  ${chalk.dim(label)}`);
    } else if (i === currentPhaseIndex) {
      // Active phase
      console.log(`  ${chalk.cyan("●")}  ${chalk.bold(label)}${chalk.cyan("...")}`);
    } else {
      // Pending phase
      console.log(`  ${chalk.dim("○")}  ${chalk.dim(label)}`);
    }
  }

  console.log();
}

function buildStatusLabel(side: string, buildStatus: "pending" | "success" | "failed"): string {
  switch (buildStatus) {
    case "pending":
      return chalk.dim(`${side}: pending`);
    case "success":
      return chalk.green(`${side}: ✓ built`);
    case "failed":
      return chalk.red(`${side}: ✗ build failed`);
  }
}

function renderBuildFailure(status: RehearsalStatusResponse): void {
  console.log();
  console.log(chalk.red.bold("BUILD FAILURE"));
  console.log(divider());
  if (status.baseline_build_status === "failed") {
    console.log(chalk.red("  ✗ Baseline build failed"));
  }
  if (status.candidate_build_status === "failed") {
    console.log(chalk.red("  ✗ Candidate build failed"));
  }
  if (status.error) {
    console.log();
    console.log(chalk.dim("Error:"), status.error);
  }
  console.log();
  console.log(chalk.dim("Fix the build errors and retry with:"));
  console.log(chalk.dim("  change-rehearsal run --repo <path> --base <ref> --candidate <ref>"));
  console.log();
}

function renderFailed(status: RehearsalStatusResponse): void {
  console.log();
  console.log(chalk.red.bold("REHEARSAL FAILED"));
  console.log(divider());
  if (status.error) {
    console.log(chalk.red("Error:"), status.error);
  }
  console.log();
}

/**
 * Run the dashboard polling loop for the given run ID.
 *
 * Resolves with the exit code once the run reaches a terminal state.
 * All output goes directly to stdout.
 */
export async function runDashboard(
  runId: string,
  baseUrl?: string,
): Promise<{ exitCode: number; finalStatus: RehearsalStatusResponse }> {
  let status: RehearsalStatusResponse;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      status = await getRehearsalStatus(runId, baseUrl);
    } catch (err) {
      console.error(chalk.red("Error polling rehearsal status:"), err instanceof Error ? err.message : String(err));
      return { exitCode: EXIT.EXECUTION_FAILURE, finalStatus: undefined as unknown as RehearsalStatusResponse };
    }

    renderDashboard(status);

    if (status.status === "completed") {
      return { exitCode: EXIT.OK, finalStatus: status };
    }

    if (status.status === "build_failed") {
      renderBuildFailure(status);
      return { exitCode: EXIT.EXECUTION_FAILURE, finalStatus: status };
    }

    if (status.status === "failed") {
      renderFailed(status);
      return { exitCode: EXIT.EXECUTION_FAILURE, finalStatus: status };
    }

    // Still running — wait before next poll
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
