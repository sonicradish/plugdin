import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { annotationPath, isManagedByPlugdin, readAnnotation, removeAnnotation, writeAnnotation } from "../src/adopt/annotate.js";
import { planAdopt } from "../src/adopt/plan.js";
import { applyAdopt } from "../src/adopt/apply.js";
import type { Component } from "../src/domain/types.js";

describe("annotate", () => {
  let skillDir: string;

  beforeEach(async () => {
    skillDir = await mkdtemp(join(tmpdir(), "plugdin-skill-"));
  });

  afterEach(async () => {
    await rm(skillDir, { recursive: true, force: true });
  });

  it("writes a plugin.json marked as plugdin-managed", async () => {
    await writeAnnotation(skillDir, "tdd", "Test-driven development.");
    const manifest = await readAnnotation(skillDir);
    expect(manifest).toEqual({
      name: "tdd",
      description: "Test-driven development.",
      plugdin: { annotates: "tdd", tool: "plugdin adopt" },
    });
    expect(isManagedByPlugdin(manifest)).toBe(true);
  });

  it("is idempotent: writing twice produces identical bytes", async () => {
    await writeAnnotation(skillDir, "tdd", "d");
    const first = await readFile(annotationPath(skillDir), "utf8");
    await writeAnnotation(skillDir, "tdd", "d");
    const second = await readFile(annotationPath(skillDir), "utf8");
    expect(first).toBe(second);
  });

  it("removeAnnotation deletes a plugdin-managed manifest", async () => {
    await writeAnnotation(skillDir, "tdd", "d");
    await removeAnnotation(skillDir);
    expect(existsSync(annotationPath(skillDir))).toBe(false);
  });

  it("removeAnnotation refuses to delete a foreign (hand-authored) manifest", async () => {
    await mkdir(join(skillDir, ".claude-plugin"), { recursive: true });
    await writeFile(annotationPath(skillDir), JSON.stringify({ name: "hand-authored" }));
    await removeAnnotation(skillDir);
    expect(existsSync(annotationPath(skillDir))).toBe(true);
  });

  it("isManagedByPlugdin is false for a foreign manifest and for no manifest", async () => {
    expect(isManagedByPlugdin(undefined)).toBe(false);
    expect(isManagedByPlugdin({ name: "x", description: "y", plugdin: { annotates: "x", tool: "something-else" } })).toBe(false);
  });
});

function skillComponent(name: string, dir: string, description = "d"): Component {
  return { id: { kind: "skill", key: `${name}@skills-dir` }, name, description, clients: ["claude-code", "codex"], sourcePath: dir };
}

describe("planAdopt + applyAdopt", () => {
  let dirA: string;
  let dirB: string;
  let dirForeign: string;

  beforeEach(async () => {
    dirA = await mkdtemp(join(tmpdir(), "plugdin-skill-a-"));
    dirB = await mkdtemp(join(tmpdir(), "plugdin-skill-b-"));
    dirForeign = await mkdtemp(join(tmpdir(), "plugdin-skill-foreign-"));
    await mkdir(join(dirForeign, ".claude-plugin"), { recursive: true });
    await writeFile(join(dirForeign, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "foreign" }));
  });

  afterEach(async () => {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
    await rm(dirForeign, { recursive: true, force: true });
  });

  it("plans to annotate an unannotated skill and leave an already-annotated one alone", async () => {
    await writeAnnotation(dirB, "b", "d");
    const components = [skillComponent("a", dirA), skillComponent("b", dirB)];
    const plan = await planAdopt(components, { undo: false });
    expect(plan.map((a) => a.kind)).toEqual(["annotate", "already-annotated"]);
  });

  it("skips a foreign annotation in both directions without touching it", async () => {
    const components = [skillComponent("foreign", dirForeign)];
    const forward = await planAdopt(components, { undo: false });
    const backward = await planAdopt(components, { undo: true });
    expect(forward.map((a) => a.kind)).toEqual(["skip-foreign-annotation"]);
    expect(backward.map((a) => a.kind)).toEqual(["skip-foreign-annotation"]);
  });

  it("applyAdopt actually writes the Annotation for an 'annotate' action", async () => {
    const components = [skillComponent("a", dirA)];
    const plan = await planAdopt(components, { undo: false });
    await applyAdopt(plan, { dryRun: false });
    expect(existsSync(annotationPath(dirA))).toBe(true);
  });

  it("dryRun computes the plan but writes nothing", async () => {
    const components = [skillComponent("a", dirA)];
    const plan = await planAdopt(components, { undo: false });
    const results = await applyAdopt(plan, { dryRun: true });
    expect(results[0]?.applied).toBe(false);
    expect(existsSync(annotationPath(dirA))).toBe(false);
  });

  it("--undo removes a plugdin-managed Annotation", async () => {
    await writeAnnotation(dirA, "a", "d");
    const components = [skillComponent("a", dirA)];
    const plan = await planAdopt(components, { undo: true });
    expect(plan.map((a) => a.kind)).toEqual(["remove-annotation"]);
    await applyAdopt(plan, { dryRun: false });
    expect(existsSync(annotationPath(dirA))).toBe(false);
  });

  it("is idempotent: running the plan twice produces the same second-run plan (already-annotated)", async () => {
    const components = [skillComponent("a", dirA)];
    await applyAdopt(await planAdopt(components, { undo: false }), { dryRun: false });
    const secondPlan = await planAdopt(components, { undo: false });
    expect(secondPlan.map((a) => a.kind)).toEqual(["already-annotated"]);
  });
});
