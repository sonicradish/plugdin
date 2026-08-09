import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runClientCommand } = vi.hoisted(() => ({ runClientCommand: vi.fn() }));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  return { ...actual, runClientCommand };
});

const { discoverPiMcpServers, discoverPiPackages, parsePiPackageList } = await import("../src/inventory/pi.js");

describe("parsePiPackageList", () => {
  it("pairs each install spec with the resolved directory printed beneath it", () => {
    const stdout = [
      "User packages:",
      "  npm:pi-subagents",
      "    /Users/me/.pi/agent/npm/node_modules/pi-subagents",
      "  git:github.com/someone/pi-ollama",
      "    /Users/me/.pi/agent/git/github.com/someone/pi-ollama",
      "",
    ].join("\n");

    expect(parsePiPackageList(stdout)).toEqual([
      { spec: "npm:pi-subagents", dir: "/Users/me/.pi/agent/npm/node_modules/pi-subagents" },
      { spec: "git:github.com/someone/pi-ollama", dir: "/Users/me/.pi/agent/git/github.com/someone/pi-ollama" },
    ]);
  });

  it("reads project packages alongside user ones, since Pi lists both", () => {
    const stdout = ["User packages:", "  npm:a", "    /global/a", "Project packages:", "  npm:b", "    /project/b"].join("\n");
    expect(parsePiPackageList(stdout).map((p) => p.spec)).toEqual(["npm:a", "npm:b"]);
  });

  it("ignores a section header with no packages under it", () => {
    expect(parsePiPackageList("User packages:\n")).toEqual([]);
  });
});

describe("discoverPiPackages", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "plugdin-pi-pkg-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves what a package contributes from its package.json `pi` field", async () => {
    const pkgDir = join(dir, "pi-subagents");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "pi-subagents", pi: { extensions: ["./src/extension/index.ts"], skills: ["./skills"] } }),
    );
    runClientCommand.mockResolvedValueOnce({ available: true, stderr: "", stdout: `User packages:\n  npm:pi-subagents\n    ${pkgDir}\n` });

    const result = await discoverPiPackages(dir);
    expect(result.components).toEqual([
      {
        id: { kind: "plugin", key: "npm:pi-subagents@pi" },
        name: "npm:pi-subagents",
        clients: ["pi"],
        sourcePath: pkgDir,
        piPackage: {
          extensionPaths: [join(pkgDir, "src/extension/index.ts")],
          skillPaths: [join(pkgDir, "skills")],
        },
      },
    ]);
  });

  it("still records a package whose package.json declares no pi resources", async () => {
    const pkgDir = join(dir, "plain");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "plain" }));
    runClientCommand.mockResolvedValueOnce({ available: true, stderr: "", stdout: `User packages:\n  npm:plain\n    ${pkgDir}\n` });

    const result = await discoverPiPackages(dir);
    expect(result.components[0]?.piPackage).toEqual({ extensionPaths: [], skillPaths: [] });
  });

  it("reports unavailable when pi is not on PATH", async () => {
    runClientCommand.mockResolvedValueOnce({ available: false, reason: "pi is not installed or not on PATH" });
    expect(await discoverPiPackages(dir)).toEqual({ components: [], available: false, reason: "pi is not installed or not on PATH" });
  });
});

describe("discoverPiMcpServers", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "plugdin-pi-mcp-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("reads the project .mcp.json — the same file Claude Code reads, so one server, not two", async () => {
    await writeFile(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { srv: { command: "node", args: ["srv.js"] } } }));
    const components = await discoverPiMcpServers(cwd, join(cwd, "agent"));
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({ name: "srv", clients: ["pi"], mcp: { command: "node", args: ["srv.js"] } });
  });

  it("lets a Pi-owned project override win over an earlier layer of the same name", async () => {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { srv: { command: "shared" } } }));
    await writeFile(join(cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { srv: { command: "overridden" } } }));

    const components = await discoverPiMcpServers(cwd, join(cwd, "agent"));
    expect(components).toHaveLength(1);
    expect(components[0]?.mcp?.command).toBe("overridden");
  });
});
