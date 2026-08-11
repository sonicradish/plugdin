import { describe, expect, it } from "vitest";
import { ProfileConfigError } from "../src/domain/errors.js";
import {
  AmbiguousAllowDenyError,
  BaselineCycleError,
  UnknownBaselineProfileError,
  activeComponents,
  explicitlySetKeys,
  resolveProfile,
} from "../src/profile/resolve.js";
import type { Component, Inventory, Profile } from "../src/domain/types.js";

function component(key: string): Component {
  return { id: { kind: "plugin", key }, name: key, clients: ["claude-code"], sourcePath: key };
}

const inventory: Inventory = {
  components: [component("a"), component("b"), component("c")],
  discoveredAt: ["claude-code"],
};

function profile(partial: Partial<Profile> & { name: string }): Profile {
  return { baseline: { kind: "all" }, allow: [], deny: [], scope: "global", definedAt: "<test>", ...partial };
}

describe("resolveProfile", () => {
  it("baseline all turns every Component on", () => {
    const resolution = resolveProfile(profile({ name: "everything", baseline: { kind: "all" } }), inventory, new Map());
    expect([...resolution.decisions.entries()]).toEqual([
      ["a", true],
      ["b", true],
      ["c", true],
    ]);
  });

  it("baseline none turns every Component off", () => {
    const resolution = resolveProfile(profile({ name: "nothing", baseline: { kind: "none" } }), inventory, new Map());
    expect(activeComponents(resolution, inventory)).toEqual([]);
  });

  it("allow turns specific Components on over a none baseline", () => {
    const resolution = resolveProfile(
      profile({ name: "minimal", baseline: { kind: "none" }, allow: ["b"] }),
      inventory,
      new Map(),
    );
    expect(activeComponents(resolution, inventory).map((c) => c.id.key)).toEqual(["b"]);
  });

  it("deny turns specific Components off over an all baseline", () => {
    const resolution = resolveProfile(
      profile({ name: "most", baseline: { kind: "all" }, deny: ["b"] }),
      inventory,
      new Map(),
    );
    expect(activeComponents(resolution, inventory).map((c) => c.id.key)).toEqual(["a", "c"]);
  });

  it("a baseline: all Profile picks up a Component added to the Inventory after definition", () => {
    const grown: Inventory = { components: [...inventory.components, component("d")], discoveredAt: ["claude-code"] };
    const resolution = resolveProfile(profile({ name: "everything", baseline: { kind: "all" } }), grown, new Map());
    expect(resolution.decisions.get("d")).toBe(true);
  });

  it("a baseline: none Profile does NOT pick up a newly added Component", () => {
    const base = profile({ name: "minimal", baseline: { kind: "none" }, allow: ["a"] });
    const grown: Inventory = { components: [...inventory.components, component("d")], discoveredAt: ["claude-code"] };
    const resolution = resolveProfile(base, grown, new Map());
    expect(resolution.decisions.get("d")).toBe(false);
  });

  it("resolves against a named Profile baseline, applying the child's allow/deny on top", () => {
    const parent = profile({ name: "team-default", baseline: { kind: "none" }, allow: ["a", "b"] });
    const child = profile({ name: "my-profile", baseline: { kind: "profile", name: "team-default" }, deny: ["b"], allow: ["c"] });
    const byName = new Map([["team-default", parent]]);
    const resolution = resolveProfile(child, inventory, byName);
    expect(activeComponents(resolution, inventory).map((c) => c.id.key).sort()).toEqual(["a", "c"]);
  });

  it("throws UnknownBaselineProfileError for a baseline naming a Profile that doesn't exist", () => {
    const child = profile({ name: "orphan", baseline: { kind: "profile", name: "does-not-exist" } });
    expect(() => resolveProfile(child, inventory, new Map())).toThrow(UnknownBaselineProfileError);
  });

  it("throws BaselineCycleError for a baseline cycle", () => {
    const a = profile({ name: "a-profile", baseline: { kind: "profile", name: "b-profile" } });
    const b = profile({ name: "b-profile", baseline: { kind: "profile", name: "a-profile" } });
    const byName = new Map([
      ["a-profile", a],
      ["b-profile", b],
    ]);
    expect(() => resolveProfile(a, inventory, byName)).toThrow(BaselineCycleError);
  });

  it("throws AmbiguousAllowDenyError when the same key is both allowed and denied", () => {
    const bad = profile({ name: "contradictory", allow: ["a"], deny: ["a"] });
    expect(() => resolveProfile(bad, inventory, new Map())).toThrow(AmbiguousAllowDenyError);
  });

  it("every resolution error is a ProfileConfigError, so the CLI's generic catch handles all of them", () => {
    expect(new UnknownBaselineProfileError("x")).toBeInstanceOf(ProfileConfigError);
    expect(new BaselineCycleError(["a", "b"])).toBeInstanceOf(ProfileConfigError);
    expect(new AmbiguousAllowDenyError("x", ["a"])).toBeInstanceOf(ProfileConfigError);
  });
});

describe("explicitlySetKeys", () => {
  it("returns the Profile's own allow/deny keys", () => {
    const l = profile({ name: "x", baseline: { kind: "none" }, allow: ["a"], deny: ["b"] });
    expect(explicitlySetKeys(l, new Map())).toEqual(new Set(["a", "b"]));
  });

  it("does not include keys never mentioned by any allow/deny", () => {
    const l = profile({ name: "x", baseline: { kind: "all" }, deny: ["b"] });
    expect(explicitlySetKeys(l, new Map()).has("c")).toBe(false);
  });

  it("walks the baseline chain, including an inherited Profile's own allow/deny", () => {
    const parent = profile({ name: "team-default", baseline: { kind: "none" }, allow: ["a", "b"] });
    const child = profile({ name: "mine", baseline: { kind: "profile", name: "team-default" }, deny: ["b"], allow: ["c"] });
    const byName = new Map([["team-default", parent]]);
    expect(explicitlySetKeys(child, byName)).toEqual(new Set(["a", "b", "c"]));
  });

  it("does not infinite-loop on a baseline cycle (resolveProfile already rejects these before this runs)", () => {
    const a = profile({ name: "a-profile", baseline: { kind: "profile", name: "b-profile" }, allow: ["a"] });
    const b = profile({ name: "b-profile", baseline: { kind: "profile", name: "a-profile" }, allow: ["b"] });
    const byName = new Map([
      ["a-profile", a],
      ["b-profile", b],
    ]);
    expect(explicitlySetKeys(a, byName)).toEqual(new Set(["a", "b"]));
  });
});
