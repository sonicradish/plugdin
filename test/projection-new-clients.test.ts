import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { projectGrok, type GrokProjectionContext } from "../src/projection/grok.js";
import { projectOpenCode } from "../src/projection/opencode.js";
import { projectPi } from "../src/projection/pi.js";
import type { Activation, ClientId, Component, Inventory, Resolution } from "../src/domain/types.js";

function activation(client: ClientId, components: Component[], on: readonly string[]): Activation {
  const inventory: Inventory = { components, discoveredAt: [client] };
  const decisions = new Map(components.map((c) => [c.id.key, on.includes(c.id.key)]));
  const profile: Resolution = { profileName: "test", decisions };
  return { client, inventory, profile };
}

const grokContext: GrokProjectionContext = {
  workDir: "/work",
  grokHome: "/home/me/.grok",
  baseConfigToml: '[ui]\ntheme = "rosepine-moon"\n',
  skillRoots: ["/home/me/.grok/skills", "/home/me/.grok/bundled/skills", "/home/me/.claude/skills"],
};

function grokConfig(projection: ReturnType<typeof projectGrok>) {
  return parseToml(projection.generatedFiles[0]!.contents) as {
    ui?: { theme?: string };
    skills?: { ignore?: string[] };
    plugins?: { disabled?: string[] };
    mcp_servers?: Record<string, { enabled?: boolean; command?: string }>;
  };
}

const grokSkill = (name: string, path: string): Component => ({
  id: { kind: "skill", key: `${name}@grok-skills` },
  name,
  clients: ["grok"],
  sourcePath: path,
  clientPaths: { grok: [path] },
  annotation: "not-applicable",
});

describe("projectGrok", () => {
  it("points GROK_HOME at a mirror of the real config home, replacing only config.toml", () => {
    const projection = projectGrok(activation("grok", [], []), grokContext);
    expect(projection.env.GROK_HOME).toBe("/work/grok-home");
    expect(projection.mirrors).toEqual([
      {
        path: "/work/grok-home",
        mirrorOf: "/home/me/.grok",
        replaced: ["config.toml"],
        purpose: expect.stringContaining("symlinks"),
      },
    ]);
  });

  it("carries the user's own config forward, so an ephemeral home is not a reset", () => {
    const projection = projectGrok(activation("grok", [], []), grokContext);
    expect(grokConfig(projection).ui?.theme).toBe("rosepine-moon");
  });

  it("ignores a skill by every root it could come from, since Grok reports only the winner", () => {
    // The live failure this pins down: ignoring the one path `grok inspect` reported let a
    // bundled copy of the same name, never seen in the Inventory, take its place.
    const components = [grokSkill("docx", "/home/me/.grok/skills/docx")];
    const projection = projectGrok(activation("grok", components, []), grokContext);
    const ignore = grokConfig(projection).skills?.ignore ?? [];

    expect(ignore).toContain("/work/grok-home/skills/docx");
    expect(ignore).toContain("/work/grok-home/bundled/skills/docx");
    expect(ignore).toContain("/home/me/.claude/skills/docx");
  });

  it("does not sweep a name another skill Component is keeping on", () => {
    // Two different files both called code-review: Grok's own is off, the shared one is on.
    const components = [
      grokSkill("code-review", "/home/me/.grok/skills/code-review"),
      {
        id: { kind: "skill" as const, key: "code-review@skills-dir" },
        name: "code-review",
        clients: ["grok" as const],
        sourcePath: "/home/me/.claude/skills/code-review",
        annotation: "annotated" as const,
      },
    ];
    const projection = projectGrok(activation("grok", components, ["code-review@skills-dir"]), grokContext);
    const ignore = grokConfig(projection).skills?.ignore ?? [];

    expect(ignore).toEqual(["/work/grok-home/skills/code-review"]);
    expect(ignore).not.toContain("/home/me/.claude/skills/code-review");
  });

  it("rewrites config-home paths onto the mirror, which is what Grok will actually resolve", () => {
    const components = [grokSkill("design", "/home/me/.grok/bundled/skills/design")];
    const projection = projectGrok(activation("grok", components, []), grokContext);
    expect(grokConfig(projection).skills?.ignore).toContain("/work/grok-home/bundled/skills/design");
  });

  it("switches off an MCP server the user layer defines", () => {
    const context = { ...grokContext, baseConfigToml: '[mcp_servers.srv]\ncommand = "srv"\n' };
    const components: Component[] = [
      { id: { kind: "mcp-server", key: "srv-1" }, name: "srv", clients: ["grok"], sourcePath: "srv", mcp: { command: "srv", args: [], env: {} } },
    ];
    const projection = projectGrok(activation("grok", components, []), context);

    expect(grokConfig(projection).mcp_servers?.srv).toEqual({ command: "srv", enabled: false });
    expect(projection.warnings).toEqual([]);
  });

  it("warns instead of refusing for a server the user layer cannot outrank", () => {
    const components: Component[] = [
      { id: { kind: "mcp-server", key: "srv-1" }, name: "project-only", clients: ["grok"], sourcePath: "srv", mcp: { command: "srv", args: [], env: {} } },
    ];
    const projection = projectGrok(activation("grok", components, []), grokContext);

    expect(projection.refusals).toEqual([]);
    expect(projection.warnings).toHaveLength(1);
    expect(projection.warnings[0]?.reason).toMatch(/project .grok\/config.toml/);
  });

  it("says nothing about an MCP server that is staying on", () => {
    const components: Component[] = [
      { id: { kind: "mcp-server", key: "srv-1" }, name: "srv", clients: ["grok"], sourcePath: "srv", mcp: { command: "srv", args: [], env: {} } },
    ];
    const projection = projectGrok(activation("grok", components, ["srv-1"]), grokContext);
    expect(projection.warnings).toEqual([]);
  });
});

describe("projectOpenCode", () => {
  const config = (projection: ReturnType<typeof projectOpenCode>) =>
    JSON.parse(projection.env.OPENCODE_CONFIG_CONTENT!) as {
      mcp?: Record<string, { enabled: boolean }>;
      plugin?: string[];
      permission?: { skill: Record<string, string> };
    };

  const skill = (name: string): Component => ({
    id: { kind: "skill", key: `${name}@opencode-skills` },
    name,
    clients: ["opencode"],
    sourcePath: `/skills/${name}`,
    annotation: "unannotated",
  });
  const plugin = (name: string): Component => ({
    id: { kind: "plugin", key: `${name}@opencode` },
    name,
    clients: ["opencode"],
    sourcePath: name,
  });

  it("denies a skill by name, with the broad allow first so it cannot re-allow the denials", () => {
    const projection = projectOpenCode(activation("opencode", [skill("tdd"), skill("grilling")], ["tdd@opencode-skills"]));
    // Insertion order is evaluation order in OpenCode, and the last match wins.
    expect(Object.entries(config(projection).permission!.skill)).toEqual([
      ["*", "allow"],
      ["grilling", "deny"],
    ]);
  });

  it("states plainly that a denied skill is still listed to the model", () => {
    const projection = projectOpenCode(activation("opencode", [skill("grilling")], []));
    expect(projection.notes).toHaveLength(1);
    expect(projection.notes[0]).toMatch(/remain listed/);
    expect(projection.warnings).toEqual([]);
  });

  it("leaves permissions untouched when no skill is off", () => {
    const projection = projectOpenCode(activation("opencode", [skill("tdd")], ["tdd@opencode-skills"]));
    expect(config(projection).permission).toBeUndefined();
    expect(projection.notes).toEqual([]);
  });

  it("empties the plugin array when every plugin is off — the one case config can express", () => {
    const projection = projectOpenCode(activation("opencode", [plugin("a"), plugin("b")], []));
    expect(config(projection).plugin).toEqual([]);
    expect(projection.warnings).toEqual([]);
  });

  it("warns rather than half-projecting when only some plugins are off", () => {
    const projection = projectOpenCode(activation("opencode", [plugin("a"), plugin("b")], ["a@opencode"]));
    expect(config(projection).plugin).toBeUndefined();
    expect(projection.warnings).toHaveLength(1);
    expect(projection.warnings[0]?.component.key).toBe("b@opencode");
    expect(projection.refusals).toEqual([]);
  });

  it("disables an MCP server by name and says nothing about the ones staying on", () => {
    const mcp = (key: string, name: string): Component => ({
      id: { kind: "mcp-server", key },
      name,
      clients: ["opencode"],
      sourcePath: "x",
      mcp: { command: "x", args: [], env: {} },
    });
    const projection = projectOpenCode(activation("opencode", [mcp("k1", "off-srv"), mcp("k2", "on-srv")], ["k2"]));
    expect(config(projection).mcp).toEqual({ "off-srv": { enabled: false } });
  });
});

describe("projectPi", () => {
  const pkg = (spec: string): Component => ({
    id: { kind: "plugin", key: `${spec}@pi` },
    name: spec,
    clients: ["pi"],
    sourcePath: `/pkgs/${spec}`,
    piPackage: { extensionPaths: [`/pkgs/${spec}/ext.ts`], skillPaths: [`/pkgs/${spec}/skills`] },
  });
  const skill = (name: string): Component => ({
    id: { kind: "skill", key: `${name}@pi-skills` },
    name,
    clients: ["pi"],
    sourcePath: `/pi-skills/${name}`,
    annotation: "not-applicable",
  });

  it("passes no flags at all when nothing is off, rather than an allowlist of everything", () => {
    // Anything this tool failed to discover would otherwise be dropped as collateral.
    const projection = projectPi(activation("pi", [pkg("npm:a"), skill("tdd")], ["npm:a@pi", "tdd@pi-skills"]));
    expect(projection.args).toEqual([]);
  });

  it("turns discovery off and names the survivors when a skill is off", () => {
    const projection = projectPi(activation("pi", [skill("tdd"), skill("grilling")], ["tdd@pi-skills"]));
    expect(projection.args).toEqual(["--no-skills", "--skill", "/pi-skills/tdd"]);
  });

  it("re-adds a surviving package's own skill directories, not just its extension", () => {
    // `--no-extensions` does not stop a package's skills loading; only `--no-skills` does,
    // so an off package forces both switches and every surviving path has to be named again.
    const projection = projectPi(activation("pi", [pkg("npm:a"), pkg("npm:b")], ["npm:a@pi"]));
    expect(projection.args).toEqual([
      "--no-extensions",
      "--extension",
      "/pkgs/npm:a/ext.ts",
      "--no-skills",
      "--skill",
      "/pkgs/npm:a/skills",
    ]);
  });

  it("warns that an MCP server cannot be turned off, and never refuses over it", () => {
    const components: Component[] = [
      { id: { kind: "mcp-server", key: "srv-1" }, name: "srv", clients: ["pi"], sourcePath: "srv", mcp: { command: "srv", args: [], env: {} } },
    ];
    const projection = projectPi(activation("pi", components, []));
    expect(projection.refusals).toEqual([]);
    expect(projection.warnings).toHaveLength(1);
    expect(projection.warnings[0]?.reason).toMatch(/pi-mcp-adapter/);
  });

  it("ignores Components belonging to other Clients", () => {
    const components: Component[] = [
      { id: { kind: "plugin", key: "x@mp" }, name: "x", clients: ["claude-code"], sourcePath: "x" },
    ];
    expect(projectPi(activation("pi", components, [])).args).toEqual([]);
  });
});
