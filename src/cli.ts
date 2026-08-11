#!/usr/bin/env node
import { adopt, formatAdoptResult } from "./commands/adopt.js";
import { doctor } from "./commands/doctor.js";
import { explain } from "./commands/explain.js";
import { formatDoctor, isClean } from "./commands/format-doctor.js";
import { formatExplain } from "./commands/format-explain.js";
import { pickOrCreateProfile } from "./commands/pick-profile.js";
import { CLIENT_ARG_NAMES, execRun, normalizeClientArg, parseRunArgs, prepareRun, RefusedToLaunchError, RenamedFlagError } from "./commands/run.js";
import { ProfileConfigError } from "./domain/errors.js";
import { EnquirerPrompter } from "./tui/enquirer-prompter.js";
import { shouldUseColor } from "./util/color.js";

const USAGE = `plugdin — decide which plugins, skills, and MCP servers a coding agent session sees

Start here:
  plugdin run claude                    Launch, and pick a Profile from a menu
  plugdin run claude --profile writing  Launch with a Profile you already have

  Clients: claude (claude-code), codex, grok (grok-build), opencode, pi.
  Everything after the client name except --profile passes through to the native
  binary untouched, so your usual flags keep working. With --profile omitted and a
  terminal attached, you get a picker that can also create a Profile on the spot;
  non-interactively it falls back to the project's default Profile, else "all".

Also:
  plugdin explain [profile]             Print what a Profile would produce, for every Client
  plugdin doctor                        Report Annotation drift, unannotated skills, collisions
  plugdin adopt [--dry-run] [--undo]    Write/remove Claude Code Annotations for loose skills.
                                        Only needed for Claude Code — every other Client
                                        addresses skills natively and never needs this.
  plugdin --help                        Show this message

"explain" and "doctor" are read-only. "adopt" only ever touches
.claude-plugin/plugin.json files it manages itself (see --undo).`;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return 0;
  }

  if (command === "explain") {
    const profileName = rest[0];
    try {
      const result = await explain(process.cwd(), profileName);
      console.log(formatExplain(result, { color: shouldUseColor(process.stdout) }));
      const anyRefusals = Object.values(result.projections).some((p) => p.refusals.length > 0);
      return anyRefusals ? 1 : 0;
    } catch (err) {
      if (err instanceof ProfileConfigError) {
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
      if (err instanceof ProfileConfigError) {
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
      console.error(`plugdin run: first argument must be one of ${CLIENT_ARG_NAMES.join(", ")}\n\n${USAGE}`);
      return 2;
    }
    try {
      let { profileName, passthroughArgs } = parseRunArgs(clientRest);
      const noProfileNamed = profileName === undefined;
      // No --profile given, and there's a human at the other end of stdin/stdout to ask:
      // show the picker (PLAN.md Phase 6) instead of silently falling back. A non-interactive
      // caller (scripts, CI) keeps the deterministic project-default-or-"all" fallback in
      // prepareRun, since there's no one there to answer prompts.
      if (profileName === undefined && process.stdin.isTTY && process.stdout.isTTY) {
        const prompter = new EnquirerPrompter();
        try {
          const picked = await pickOrCreateProfile(process.cwd(), prompter);
          profileName = picked.profileName;
        } finally {
          prompter.close();
        }
      }
      const prepared = await prepareRun(process.cwd(), client, profileName, passthroughArgs);
      // Only the non-interactive fallback (profileName still undefined here — the picker
      // above wasn't shown) is silent otherwise: nothing else prints which Profile was
      // actually used before exec'ing the Client.
      if (noProfileNamed && profileName === undefined) {
        console.error(`plugdin: no --profile given; using "${prepared.profileName}"`);
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
      if (err instanceof ProfileConfigError || err instanceof RenamedFlagError) {
        console.error(err.message);
        return 2;
      }
      if (err instanceof RefusedToLaunchError) {
        console.error(err.message);
        for (const refusal of err.projection.refusals) {
          console.error(`  ${refusal.component.kind} ${refusal.component.key}: ${refusal.reason}`);
        }
        console.error("\nRun `plugdin explain` to see the full picture before retrying.");
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
