import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInventory } from "../inventory/index.js";
import { findProfile, loadProfiles, resolveDefaultProfileName } from "../profile/store.js";
import { resolveProfile } from "../profile/resolve.js";
import { materializeProjection } from "../projection/materialize.js";
import { gatherProjectionContext, projectFor } from "../projection/index.js";
import { UnknownProfileError } from "./explain.js";
import type { Activation, ClientId, Projection } from "../domain/types.js";

const CLIENT_BINARIES: Record<ClientId, string> = {
  "claude-code": "claude",
  codex: "codex",
  grok: "grok",
  opencode: "opencode",
  // Cursor's CLI ships as `cursor-agent`, not `cursor`; Pi's is simply `pi`.
  pi: "pi",
};

/**
 * CLI-facing spelling of a Client. The canonical identity is "claude-code" (matches its
 * binary's own plugin key format, e.g. `code-review@claude-plugins-official`), but nobody
 * actually types that at a prompt — "claude" is what the binary itself is called, so it's
 * accepted as an alias everywhere a Client name is read from argv. The same applies to the
 * other Clients whose product name and binary name differ: "grok-build" for `grok`.
 */
const CLIENT_ALIASES: Readonly<Record<string, ClientId>> = {
  "claude-code": "claude-code",
  claude: "claude-code",
  codex: "codex",
  grok: "grok",
  "grok-build": "grok",
  opencode: "opencode",
  pi: "pi",
};

export const CLIENT_ARG_NAMES: readonly string[] = Object.keys(CLIENT_ALIASES);

export function normalizeClientArg(arg: string): ClientId | undefined {
  return CLIENT_ALIASES[arg];
}

export class RenamedFlagError extends Error {
  constructor() {
    super(`--loadout was renamed to --profile, and ~/.plugdin/loadouts/ to ~/.plugdin/profiles/ (rename the directory to keep your existing files)`);
  }
}

export class RefusedToLaunchError extends Error {
  constructor(public readonly projection: Projection) {
    super(`Refusing to launch ${projection.client}: ${projection.refusals.length} Component(s) could not be faithfully projected`);
  }
}

/**
 * `--profile` is the only flag plugdin's own CLI reserves; every other token is opaque
 * passthrough to the native Client (PLAN.md Phase 6: "the moment the wrapper cannot accept
 * -p or --model, people stop using it"). Order among passthrough args is preserved.
 *
 * `--loadout` is the sole exception to passthrough. It was this flag's name through v0.3.1
 * (ADR-0006) and is now rejected rather than forwarded: handing an unknown flag to the Client
 * gets it reported as the Client's own error, which sends people looking in the wrong place.
 */
export function parseRunArgs(argv: readonly string[]): { profileName?: string; passthroughArgs: string[] } {
  const passthroughArgs: string[] = [];
  let profileName: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--profile") {
      profileName = argv[++i];
      continue;
    }
    if (token.startsWith("--profile=")) {
      profileName = token.slice("--profile=".length);
      continue;
    }
    if (token === "--loadout" || token.startsWith("--loadout=")) {
      throw new RenamedFlagError();
    }
    passthroughArgs.push(token);
  }
  return profileName !== undefined ? { profileName, passthroughArgs } : { passthroughArgs };
}

export interface PreparedRun {
  readonly client: ClientId;
  readonly binary: string;
  readonly profileName: string;
  readonly projection: Projection;
  readonly nativeArgs: readonly string[];
}

/** Resolves the Profile and computes the Projection, but does no I/O beyond discovery reads. */
export async function prepareRun(cwd: string, client: ClientId, profileNameArg: string | undefined, passthroughArgs: readonly string[]): Promise<PreparedRun> {
  const profileName = profileNameArg ?? (await resolveDefaultProfileName(cwd));
  const [{ inventory }, profiles] = await Promise.all([buildInventory(cwd), loadProfiles(cwd)]);

  const profile = findProfile(profileName, profiles);
  if (!profile) throw new UnknownProfileError(profileName);

  const resolution = resolveProfile(profile, inventory, profiles);
  const activation: Activation = { client, inventory, profile: resolution };

  const context = await gatherProjectionContext(await mkdtemp(join(tmpdir(), "plugdin-run-")));
  const projection = projectFor(client, activation, context);

  return {
    client,
    binary: CLIENT_BINARIES[client],
    profileName,
    projection,
    nativeArgs: [...projection.args, ...passthroughArgs],
  };
}

/**
 * Materializes the Projection's ephemeral config (files and config-home mirrors, if any —
 * Codex and Pi have none) and execs the native Client, replacing plugdin's own stdio so it
 * behaves as a transparent wrapper. Refuses (throws RefusedToLaunchError) rather than launch
 * with a misrepresented Profile — callers should run `explain` first if they want to see
 * refusals without spawning anything.
 *
 * The Projection's environment overlays the inherited one rather than replacing it: a Client
 * launched here must still see the user's PATH, terminal, and credentials env.
 */
export async function execRun(prepared: PreparedRun): Promise<number> {
  if (prepared.projection.refusals.length > 0) {
    throw new RefusedToLaunchError(prepared.projection);
  }
  await materializeProjection(prepared.projection);

  return new Promise((resolve, reject) => {
    const child = spawn(prepared.binary, prepared.nativeArgs, {
      stdio: "inherit",
      env: { ...process.env, ...prepared.projection.env },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
