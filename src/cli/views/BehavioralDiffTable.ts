/**
 * BehavioralDiffTable — Core output table of verdicts per journey.
 *
 * Renders BehavioralDiffRow[] from the rehearsal report as a terminal table.
 * Contracts: src/shared/contracts.ts §4.3
 */
import chalk from "chalk";
import Table from "cli-table3";
import type { BehavioralDiffRow, ReportSummary } from "../../shared/contracts.js";
import { verdictSymbol, verdictLabel, confidenceLabel, header, divider } from "../utils/formatters.js";

export function renderBehavioralDiffTable(
  rows: BehavioralDiffRow[],
  summary: ReportSummary,
): void {
  console.log();
  console.log(header("Behavioral Diff"));
  console.log(divider(60));

  const table = new Table({
    head: [
      chalk.bold("Journey"),
      chalk.bold("Verdict"),
      chalk.bold("Source"),
      chalk.bold("Expected"),
    ],
    colWidths: [32, 22, 18, 10],
    style: { head: [], border: ["dim"] },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
  });

  for (const row of rows) {
    const sourceLabel = row.protected_behavior_source
      ? confidenceLabel(row.protected_behavior_source)
      : chalk.dim("—");

    table.push([
      `${verdictSymbol(row.verdict)}  ${row.journey_name}`,
      verdictLabel(row.verdict),
      sourceLabel,
      row.is_expected_change ? chalk.blue("yes") : chalk.dim("no"),
    ]);
  }

  console.log(table.toString());
  console.log();
  renderSummary(summary);
}

function renderSummary(summary: ReportSummary): void {
  console.log(header("Summary"));
  console.log(divider(40));
  console.log(
    `  Journeys:          ${summary.total_journeys}   Scenarios:  ${summary.total_scenarios}`,
  );
  console.log(
    `  ${chalk.green("Preserved:")}         ${summary.preserved}   ` +
    `${chalk.blue("Intentional:")}  ${summary.intentional_changes}`,
  );
  console.log(
    `  ${chalk.red("Regressions:")}       ${summary.regressions}   ` +
    `${chalk.yellow("Affected:")}     ${summary.potentially_affected}   ` +
    `${chalk.dim("Not exercised:")} ${summary.not_exercised}`,
  );
  console.log();

  if (summary.regressions > 0) {
    console.log(chalk.red.bold(`  ✗ ${summary.regressions} regression${summary.regressions > 1 ? "s" : ""} detected`));
  } else {
    console.log(chalk.green.bold("  ✓ No regressions — ready to merge"));
  }
  console.log();
}
