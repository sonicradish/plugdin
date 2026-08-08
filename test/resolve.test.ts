import { describe, expect, it } from "vitest";
import { AmbiguousAllowDenyError, BaselineCycleError, UnknownBaselineLoadoutError, activeComponents, resolveLoadout } from "../src/loadout/resolve.js";
import type { Component, Inventory, Loadout } from "../src/domain/types.js";

function component(key: string): Component {
  return { id: { kind: "plugin", key }, name: key, clients: ["claude-code"], sourcePath: key };
}

const inventory: Inventory = {
  components: [component("a"), component("b"), component("c")],
  discoveredAt: ["claude-code"],
};

function loadout(partial: Partial<Loadout> & { name: string }): Loadout {
  return { baseline: { kind: "all" }, allow: [], deny: [], scope: "global", definedAt: "<test>", ...partial };
}

describe("resolveLoadout", () => {
  it("baseline all turns every Component on", () => {
    const resolution = resolveLoadout(loadout({ name: "everything", baseline: { kind: "all" } }), inventory, new Map());
    expect([...resolution.decisions.entries()]).toEqual([
      ["a", true],
      ["b", true],
      ["c", true],
    ]);
  });

  it("baseline none turns every Component off", () => {
    const resolution = resolveLoadout(loadout({ name: "nothing", baseline: { kind: "none" } }), inventory, new Map());
    expect(activeComponents(resolution, inventory)).toEqual([]);
  });

  it("allow turns specific Components on over a none baseline", () => {
    const resolution = resolveLoadout(
      loadout({ name: "minimal", baseline: { kind: "none" }, allow: ["b"] }),
      inventory,
      new Map(),
    );
    expect(activeComponents(resolution, inventory).map((c) => c.id.key)).toEqual(["b"]);
  });

  it("deny turns specific Components off over an all baseline", () => {
    const resolution = resolveLoadout(
      loadout({ name: "most", baseline: { kind: "all" }, deny: ["b"] }),
      inventory,
      new Map(),
    );
    expect(activeComponents(resolution, inventory).map((c) => c.id.key)).toEqual(["a", "c"]);
  });

  it("a baseline: all Loadout picks up a Component added to the Inventory after definition", () => {
    const grown: Inventory = { components: [...inventory.components, component("d")], discoveredAt: ["claude-code"] };
    const resolution = resolveLoadout(loadout({ name: "everything", baseline: { kind: "all" } }), grown, new Map());
    expect(resolution.decisions.get("d")).toBe(true);
  });

  it("a baseline: none Loadout does NOT pick up a newly added Component", () => {
    const base = loadout({ name: "minimal", baseline: { kind: "none" }, allow: ["a"] });
    const grown: Inventory = { components: [...inventory.components, component("d")], discoveredAt: ["claude-code"] };
    const resolution = resolveLoadout(base, grown, new Map());
    expect(resolution.decisions.get("d")).toBe(false);
  });

  it("resolves against a named Loadout baseline, applying the child's allow/deny on top", () => {
    const parent = loadout({ name: "team-default", baseline: { kind: "none" }, allow: ["a", "b"] });
    const child = loadout({ name: "my-loadout", baseline: { kind: "loadout", name: "team-default" }, deny: ["b"], allow: ["c"] });
    const byName = new Map([["team-default", parent]]);
    const resolution = resolveLoadout(child, inventory, byName);
    expect(activeComponents(resolution, inventory).map((c) => c.id.key).sort()).toEqual(["a", "c"]);
  });

  it("throws UnknownBaselineLoadoutError for a baseline naming a Loadout that doesn't exist", () => {
    const child = loadout({ name: "orphan", baseline: { kind: "loadout", name: "does-not-exist" } });
    expect(() => resolveLoadout(child, inventory, new Map())).toThrow(UnknownBaselineLoadoutError);
  });

  it("throws BaselineCycleError for a baseline cycle", () => {
    const a = loadout({ name: "a-loadout", baseline: { kind: "loadout", name: "b-loadout" } });
    const b = loadout({ name: "b-loadout", baseline: { kind: "loadout", name: "a-loadout" } });
    const byName = new Map([
      ["a-loadout", a],
      ["b-loadout", b],
    ]);
    expect(() => resolveLoadout(a, inventory, byName)).toThrow(BaselineCycleError);
  });

  it("throws AmbiguousAllowDenyError when the same key is both allowed and denied", () => {
    const bad = loadout({ name: "contradictory", allow: ["a"], deny: ["a"] });
    expect(() => resolveLoadout(bad, inventory, new Map())).toThrow(AmbiguousAllowDenyError);
  });
});
