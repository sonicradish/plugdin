import { describe, expect, it } from "vitest";
import { projectClaudeCode } from "../src/projection/claude-code.js";
import { projectCodex } from "../src/projection/codex.js";
import type { Activation, Component, Inventory, Resolution } from "../src/domain/types.js";

function activation(components: Component[], on: readonly string[]): Activation {
  const inventory: Inventory = { components, discoveredAt: ["claude-code", "codex"] };
  const decisions = new Map(components.map((c) => [c.id.key, on.includes(c.id.key)]));
  const profile: Resolution = { profileName: "test", decisions };
  return { client: "claude-code", inventory, profile };
}

describe("projectClaudeCode", () => {
  it("emits enabledPlugins for plugin Components matching their decision", () => {
    const components: Component[] = [
      { id: { kind: "plugin", key: "on@mp" }, name: "on", clients: ["claude-code"], sourcePath: "x" },
      { id: { kind: "plugin", key: "off@mp" }, name: "off", clients: ["claude-code"], sourcePath: "x" },
    ];
    const projection = projectClaudeCode(activation(components, ["on@mp"]), "/tmp/work");
    const settings = JSON.parse(projection.generatedFiles.find((f) => f.path.endsWith("settings.json"))!.contents);
    expect(settings.enabledPlugins).toEqual({ "on@mp": true, "off@mp": false });
  });

  it("projects an annotated skill as a <name>@skills-dir plugin toggle", () => {
    const components: Component[] = [
      { id: { kind: "skill", key: "tdd@skills-dir" }, name: "tdd", clients: ["claude-code"], sourcePath: "x", annotation: "annotated" },
    ];
    const projection = projectClaudeCode(activation(components, []), "/tmp/work");
    const settings = JSON.parse(projection.generatedFiles.find((f) => f.path.endsWith("settings.json"))!.contents);
    expect(settings.enabledPlugins).toEqual({ "tdd@skills-dir": false });
    expect(projection.refusals).toEqual([]);
  });

  it("refuses to turn off an unannotated skill rather than silently keeping it visible", () => {
    const components: Component[] = [
      { id: { kind: "skill", key: "tdd@skills-dir" }, name: "tdd", clients: ["claude-code"], sourcePath: "x", annotation: "unannotated" },
    ];
    const projection = projectClaudeCode(activation(components, []), "/tmp/work");
    expect(projection.refusals).toHaveLength(1);
    expect(projection.refusals[0]?.component.key).toBe("tdd@skills-dir");
    expect(projection.refusals[0]?.reason).toMatch(/adopt/);
  });

  it("does not refuse an unannotated skill that's already on (nothing needs to change)", () => {
    const components: Component[] = [
      { id: { kind: "skill", key: "tdd@skills-dir" }, name: "tdd", clients: ["claude-code"], sourcePath: "x", annotation: "unannotated" },
    ];
    const projection = projectClaudeCode(activation(components, ["tdd@skills-dir"]), "/tmp/work");
    expect(projection.refusals).toEqual([]);
  });

  it("includes only surviving MCP servers in --mcp-config and always pairs it with --strict-mcp-config", () => {
    const components: Component[] = [
      {
        id: { kind: "mcp-server", key: "srv-1" },
        name: "on-server",
        clients: ["claude-code"],
        sourcePath: "x",
        mcp: { command: "/bin/on", args: [], env: {} },
      },
      {
        id: { kind: "mcp-server", key: "srv-2" },
        name: "off-server",
        clients: ["claude-code"],
        sourcePath: "x",
        mcp: { command: "/bin/off", args: [], env: {} },
      },
    ];
    const projection = projectClaudeCode(activation(components, ["srv-1"]), "/tmp/work");
    const mcpConfig = JSON.parse(projection.generatedFiles.find((f) => f.path.endsWith("mcp-config.json"))!.contents);
    expect(Object.keys(mcpConfig.mcpServers)).toEqual(["on-server"]);
    expect(projection.args).toContain("--strict-mcp-config");
  });

  it("refuses an MCP server that should be on but has no captured launch spec", () => {
    const components: Component[] = [
      { id: { kind: "mcp-server", key: "srv-1" }, name: "broken", clients: ["claude-code"], sourcePath: "x" },
    ];
    const projection = projectClaudeCode(activation(components, ["srv-1"]), "/tmp/work");
    expect(projection.refusals).toHaveLength(1);
  });

  it("ignores Components not offered to claude-code", () => {
    const components: Component[] = [
      { id: { kind: "plugin", key: "codex-only@mp" }, name: "codex-only", clients: ["codex"], sourcePath: "x" },
    ];
    const projection = projectClaudeCode(activation(components, ["codex-only@mp"]), "/tmp/work");
    const settings = JSON.parse(projection.generatedFiles.find((f) => f.path.endsWith("settings.json"))!.contents);
    expect(settings.enabledPlugins).toEqual({});
  });
});

describe("projectCodex", () => {
  it("emits a -c plugins override per plugin Component", () => {
    const components: Component[] = [
      { id: { kind: "plugin", key: "documents@openai-primary-runtime" }, name: "documents", clients: ["codex"], sourcePath: "x" },
    ];
    const projection = projectCodex(activation(components, ["documents@openai-primary-runtime"]));
    expect(projection.args).toEqual(["-c", 'plugins."documents@openai-primary-runtime".enabled=true']);
  });

  it("emits a single skills.config override enumerating every skill, not just changed ones", () => {
    const components: Component[] = [
      { id: { kind: "skill", key: "a@skills-dir" }, name: "a", clients: ["codex"], sourcePath: "x" },
      { id: { kind: "skill", key: "b@skills-dir" }, name: "b", clients: ["codex"], sourcePath: "x" },
    ];
    const projection = projectCodex(activation(components, ["a@skills-dir"]));
    expect(projection.args).toEqual(["-c", "skills.config=[{name=\"a\",enabled=true},{name=\"b\",enabled=false}]"]);
  });

  it("emits no override for an MCP server that stays on (native default)", () => {
    const components: Component[] = [
      {
        id: { kind: "mcp-server", key: "srv-1" },
        name: "node_repl",
        clients: ["codex"],
        sourcePath: "x",
        mcp: { command: "/bin/node_repl", args: [], env: {} },
      },
    ];
    const projection = projectCodex(activation(components, ["srv-1"]));
    expect(projection.args).toEqual([]);
    expect(projection.refusals).toEqual([]);
  });

  it("warns (non-blocking) instead of refusing when turning an MCP server off would need a lossy re-emission", () => {
    const components: Component[] = [
      {
        id: { kind: "mcp-server", key: "srv-1" },
        name: "node_repl",
        clients: ["codex"],
        sourcePath: "x",
        mcp: { command: "/bin/node_repl", args: [], env: {} },
      },
    ];
    const projection = projectCodex(activation(components, []));
    expect(projection.refusals).toEqual([]); // does not block launch
    expect(projection.args).toEqual([]); // and emits no override — server is left as Codex already has it
    expect(projection.warnings).toHaveLength(1);
    expect(projection.warnings[0]?.component.key).toBe("srv-1");
  });

  it("escapes plugin keys and skill names embedded in -c argument values", () => {
    const components: Component[] = [
      { id: { kind: "skill", key: 'weird"name@skills-dir' }, name: 'weird"name', clients: ["codex"], sourcePath: "x" },
    ];
    const projection = projectCodex(activation(components, []));
    expect(projection.args[1]).toBe('skills.config=[{name="weird\\"name",enabled=false}]');
  });
});
