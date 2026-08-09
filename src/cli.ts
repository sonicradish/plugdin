#!/usr/bin/env node
import { adopt, formatAdoptResult } from "./commands/adopt.js";
import { doctor } from "./commands/doctor.js";
import { explain } from "./commands/explain.js";
import { formatDoctor, isClean } from "./commands/format-doctor.js";
import { formatExplain } from "./commands/format-explain.js";
import { pickOrCreateLoadout } from "./commands/pick-loadout.js";
import { CLIENT_ARG_NAMES, execRun, normalizeClientArg, parseRunArgs, prepareRun, RefusedToLaunchError } from "./commands/run.js";
import { LoadoutConfigError } from "./domain/errors.js";
import { EnquirerPrompter } from "./tui/enquirer-prompter.js";
import { shouldUseColor } from "./util/color.js";

const USAGE = `pluggedin — decide which plugins, skills, and MCP servers a coding agent session sees

Usage:
  pluggedin explain [loadout]     Print what a Loadout would produce, for every Client
  pluggedin adopt [--dry-run] [--undo]
                                    Write/remove Claude Code Annotations for loose skills.
                                    Only needed for Claude Code support — every other Client
                                    addresses skills natively and never needs this.
  pluggedin doctor                Report Annotation drift, unannotated skills, collisions
  pluggedin run <claude|codex|grok|opencode|pi> [--loadout NAME] [native args...]
                                    Launch a Client with a Loadout applied. Everything
                                    after the client name except --loadout passes through
                                    to the native binary untouched. If --loadout is omitted
                                    and stdin/stdout are a terminal, prompts you to pick one
                                    or create a new one; non-interactively, falls back to
                                    the project's default Loadout, else "all".
  pluggedin --help                Show this message

"explain" and "doctor" are read-only. "adopt" only ever touches
.claude-plugin/plugin.json files it manages itself (see --undo).`;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return 0;
  }

  if (command === "explain") {
    const loadoutName = rest[0];
    try {
      const result = await explain(process.cwd(), loadoutName);
      console.log(formatExplain(result, { color: shouldUseColor(process.stdout) }));
      const anyRefusals = Object.values(result.projections).some((p) => p.refusals.length > 0);
      return anyRefusals ? 1 : 0;
    } catch (err) {
      if (err instanceof LoadoutConfigError) {
        console.error(err.message);
        return 2;
      }
      throw err;
    }
  }

  if (command === "adopt") {
    const opts = { dryRun: rest.includes("--dry-run"), undo: rest.includes("--undo") };
    const results = await adopt(process.cwd(), opts);
    console.log(formatAdoptResult(results, opts));
    return 0;
  }

  if (command === "doctor") {
    try {
      const report = await doctor(process.cwd());
      console.log(formatDoctor(report));
      return isClean(report) ? 0 : 1;
    } catch (err) {
      if (err instanceof LoadoutConfigError) {
        console.error(err.message);
        return 2;
      }
      throw err;
    }
  }

  if (command === "run") {
    const [clientArg, ...clientRest] = rest;
    const client = clientArg === undefined ? undefined : normalizeClientArg(clientArg);
    if (!client) {
      console.error(`pluggedin run: first argument must be one of ${CLIENT_ARG_NAMES.join(", ")}\n\n${USAGE}`);
      return 2;
    }
    let { loadoutName, passthroughArgs } = parseRunArgs(clientRest);
    const noLoadoutNamed = loadoutName === undefined;
    try {
      // No --loadout given, and there's a human at the other end of stdin/stdout to ask:
      // show the picker (PLAN.md Phase 6) instead of silently falling back. A non-interactive
      // caller (scripts, CI) keeps the deterministic project-default-or-"all" fallback in
      // prepareRun, since there's no one there to answer prompts.
      if (loadoutName === undefined && process.stdin.isTTY && process.stdout.isTTY) {
        const prompter = new EnquirerPrompter();
        try {
          const picked = await pickOrCreateLoadout(process.cwd(), prompter);
          loadoutName = picked.loadoutName;
        } finally {
          prompter.close();
        }
      }
      const prepared = await prepareRun(process.cwd(), client, loadoutName, passthroughArgs);
      // Only the non-interactive fallback (loadoutName still undefined here — the picker
      // above wasn't shown) is silent otherwise: nothing else prints which Loadout was
      // actually used before exec'ing the Client.
      if (noLoadoutNamed && loadoutName === undefined) {
        console.error(`pluggedin: no --loadout given; using "${prepared.loadoutName}"`);
      }
      if (prepared.projection.warnings.length > 0) {
        console.error(`Note: ${prepared.projection.warnings.length} Component(s) could not be faithfully projected — launching anyway, left as-is:`);
        for (const warning of prepared.projection.warnings) {
          console.error(`  ${warning.component.kind} ${warning.component.key}: ${warning.reason}`);
        }
      }
      for (const projectionNote of prepared.projection.notes) {
        console.error(`Note: ${projectionNote}`);
      }
      return await execRun(prepared);
    } catch (err) {
      if (err instanceof LoadoutConfigError) {
        console.error(err.message);
        return 2;
      }
      if (err instanceof RefusedToLaunchError) {
        console.error(err.message);
        for (const refusal of err.projection.refusals) {
          console.error(`  ${refusal.component.kind} ${refusal.component.key}: ${refusal.reason}`);
        }
        console.error("\nRun `pluggedin explain` to see the full picture before retrying.");
        return 3;
      }
      throw err;
    }
  }

  console.error(`Unknown command: ${command}\n\n${USAGE}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  },
);
