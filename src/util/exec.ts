import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandFailure {
  readonly available: false;
  readonly reason: string;
}

export type CommandOutcome = (CommandResult & { readonly available: true }) | CommandFailure;

/**
 * Run a Client CLI command defensively: a missing binary or non-zero exit is a discovery
 * fact ("this Client isn't usable here"), never a thrown error that aborts the whole
 * Inventory scan.
 */
export async function runClientCommand(
  bin: string,
  args: readonly string[],
  opts?: { readonly cwd?: string; readonly timeoutMs?: number },
): Promise<CommandOutcome> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args as string[], {
      cwd: opts?.cwd,
      timeout: opts?.timeoutMs ?? 10_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { available: true, stdout, stderr };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (nodeErr.code === "ENOENT") {
      return { available: false, reason: `${bin} is not installed or not on PATH` };
    }
    // Non-zero exit: some subcommands (e.g. "no plugins installed") still print usable
    // stdout on a non-zero code in some client versions. Surface it rather than discard it.
    if (typeof nodeErr.stdout === "string" && nodeErr.stdout.trim().length > 0) {
      return { available: true, stdout: nodeErr.stdout, stderr: nodeErr.stderr ?? "" };
    }
    return { available: false, reason: nodeErr.message };
  }
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
