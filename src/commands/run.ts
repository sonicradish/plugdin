import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInventory } from "../inventory/index.js";
import { findLoadout, loadLoadouts, resolveDefaultLoadoutName } from "../loadout/store.js";
import { resolveLoadout } from "../loadout/resolve.js";
import { materializeProjection } from "../projection/materialize.js";
import { projectClaudeCode } from "../projection/claude-code.js";
import { projectCodex } from "../projection/codex.js";
import { UnknownLoadoutError } from "./explain.js";
import type { Activation, ClientId, Projection } from "../domain/types.js";

const CLIENT_BINARIES: Record<ClientId, string> = { "claude-code": "claude", codex: "codex" };

/**
 * CLI-facing spelling of a Client. The canonical identity is "claude-code" (matches its
 * binary's own plugin key format, e.g. `code-review@claude-plugins-official`), but nobody
 * actually types that at a prompt — "claude" is what the binary itself is called, so it's
 * accepted as an alias everywhere a Client name is read from argv.
 */
export function normalizeClientArg(arg: string): ClientId | undefined {
  if (arg === "claude-code" || arg === "claude") return "claude-code";
  if (arg === "codex") return "codex";
  return undefined;
}

export class RefusedToLaunchError extends Error {
  constructor(public readonly projection: Projection) {
    super(`Refusing to launch ${projection.client}: ${projection.refusals.length} Component(s) could not be faithfully projected`);
  }
}

/**
 * `--loadout` is the only flag pluggedin's own CLI reserves; every other token is opaque
 * passthrough to the native Client (PLAN.md Phase 6: "the moment the wrapper cannot accept
 * -p or --model, people stop using it"). Order among passthrough args is preserved.
 */
export function parseRunArgs(argv: readonly string[]): { loadoutName?: string; passthroughArgs: string[] } {
  const passthroughArgs: string[] = [];
  let loadoutName: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--loadout") {
      loadoutName = argv[++i];
      continue;
    }
    if (token.startsWith("--loadout=")) {
      loadoutName = token.slice("--loadout=".length);
      continue;
    }
    passthroughArgs.push(token);
  }
  return loadoutName !== undefined ? { loadoutName, passthroughArgs } : { passthroughArgs };
}

export interface PreparedRun {
  readonly client: ClientId;
  readonly binary: string;
  readonly loadoutName: string;
  readonly projection: Projection;
  readonly nativeArgs: readonly string[];
}

/** Resolves the Loadout and computes the Projection, but does no I/O beyond discovery reads. */
export async function prepareRun(cwd: string, client: ClientId, loadoutNameArg: string | undefined, passthroughArgs: readonly string[]): Promise<PreparedRun> {
  const loadoutName = loadoutNameArg ?? (await resolveDefaultLoadoutName(cwd));
  const [{ inventory }, loadouts] = await Promise.all([buildInventory(cwd), loadLoadouts(cwd)]);

  const loadout = findLoadout(loadoutName, loadouts);
  if (!loadout) throw new UnknownLoadoutError(loadoutName);

  const resolution = resolveLoadout(loadout, inventory, loadouts);
  const activation: Activation = { client, inventory, loadout: resolution };

  const projection =
    client === "claude-code"
      ? projectClaudeCode(activation, join(await mkdtemp(join(tmpdir(), "pluggedin-run-")), "claude-code"))
      : projectCodex(activation);

  return {
    client,
    binary: CLIENT_BINARIES[client],
    loadoutName,
    projection,
    nativeArgs: [...projection.args, ...passthroughArgs],
  };
}

/**
 * Materializes the Projection's generated files (if any — Codex has none) and execs the
 * native Client, replacing pluggedin's own stdio so it behaves as a transparent wrapper.
 * Refuses (throws RefusedToLaunchError) rather than launch with a misrepresented Loadout —
 * callers should run `explain` first if they want to see refusals without spawning anything.
 */
export async function execRun(prepared: PreparedRun): Promise<number> {
  if (prepared.projection.refusals.length > 0) {
    throw new RefusedToLaunchError(prepared.projection);
  }
  await materializeProjection(prepared.projection);

  return new Promise((resolve, reject) => {
    const child = spawn(prepared.binary, prepared.nativeArgs, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
