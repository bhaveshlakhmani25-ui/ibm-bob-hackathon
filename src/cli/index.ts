#!/usr/bin/env node
/**
 * Change Rehearsal CLI — Entry point
 *
 * Registers all commands via commander.
 * Corresponds to docs/BHAVESH_IMPLEMENTATION_PLAN.md §5.1
 */
import { Command } from "commander";
import { registerRunCommand } from "./commands/run.js";

const program = new Command();

program
  .name("change-rehearsal")
  .description("Intent-driven behavioral diff for developer changes")
  .version("0.2.0");

registerRunCommand(program);

program.parse(process.argv);
