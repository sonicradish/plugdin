import { execFile, spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/**
 * Same contract as `runClientCommand`, but the child writes straight to a temp file instead
 * of through a pipe.
 *
 * Some Clients exit before a large stdout pipe has drained, silently truncating their own
 * output. Confirmed live 2026-08-09: `opencode debug skill` returns 143,878 bytes when
 * redirected to a file but exactly ~64KB — one pipe buffer — when piped, cutting off
 * mid-string so the JSON no longer parses. `maxBuffer` does not help; nothing was buffered
 * to begin with. Handing the child a file descriptor removes the pipe from the picture.
 *
 * Use this for any introspection command whose output grows with the size of the user's
 * Inventory (skill listings, resolved configs). The bounded ones can stay on the cheaper
 * pipe path.
 */
export async function runClientCommandToFile(
  bin: string,
  args: readonly string[],
  opts?: { readonly cwd?: string; readonly timeoutMs?: number },
): Promise<CommandOutcome> {
  const dir = await mkdtemp(join(tmpdir(), "pluggedin-capture-"));
  const outPath = join(dir, "stdout");
  const handle = await open(outPath, "w");
  try {
    const outcome = await new Promise<CommandOutcome>((resolve) => {
      const child = spawn(bin, args as string[], {
        cwd: opts?.cwd,
        timeout: opts?.timeoutMs ?? 10_000,
        stdio: ["ignore", handle.fd, "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        resolve({
          available: false,
          reason: err.code === "ENOENT" ? `${bin} is not installed or not on PATH` : err.message,
        });
      });
      child.on("close", async () => {
        await handle.close().catch(() => undefined);
        const stdout = await readFile(outPath, "utf8").catch(() => "");
        // Matching runClientCommand: usable stdout counts even on a non-zero exit.
        if (stdout.trim().length === 0) {
          resolve({ available: false, reason: stderr.trim() || `${bin} ${args.join(" ")} produced no output` });
          return;
        }
        resolve({ available: true, stdout, stderr });
      });
    });
    return outcome;
  } finally {
    await handle.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
