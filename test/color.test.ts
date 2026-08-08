import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPainter, shouldUseColor } from "../src/util/color.js";

describe("createPainter", () => {
  it("returns text unchanged when disabled", () => {
    const p = createPainter(false);
    expect(p.bold("x")).toBe("x");
    expect(p.red("x")).toBe("x");
    expect(p.green("x")).toBe("x");
  });

  it("wraps text in ANSI codes when enabled, preserving the original text as a substring", () => {
    const p = createPainter(true);
    expect(p.bold("x")).not.toBe("x");
    expect(p.bold("x")).toContain("x");
    expect(p.red("REFUSED")).toContain("REFUSED");
  });

  it("resets after each styled span so styles don't bleed into following text", () => {
    const p = createPainter(true);
    expect(p.red("x")).toMatch(/\x1b\[0m$/);
  });
});

describe("shouldUseColor", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is false for a non-TTY stream by default", () => {
    expect(shouldUseColor({ isTTY: false })).toBe(false);
  });

  it("is false for an undefined stream", () => {
    expect(shouldUseColor(undefined)).toBe(false);
  });

  it("is true for a real TTY stream by default", () => {
    expect(shouldUseColor({ isTTY: true })).toBe(true);
  });

  it("NO_COLOR forces off even on a real TTY, regardless of its value", () => {
    process.env.NO_COLOR = "";
    expect(shouldUseColor({ isTTY: true })).toBe(false);
    process.env.NO_COLOR = "1";
    expect(shouldUseColor({ isTTY: true })).toBe(false);
  });

  it('FORCE_COLOR forces on even without a TTY, unless its value is "0"', () => {
    process.env.FORCE_COLOR = "1";
    expect(shouldUseColor({ isTTY: false })).toBe(true);
    process.env.FORCE_COLOR = "0";
    expect(shouldUseColor({ isTTY: false })).toBe(false);
  });

  it("NO_COLOR wins over FORCE_COLOR when both are set", () => {
    process.env.NO_COLOR = "1";
    process.env.FORCE_COLOR = "1";
    expect(shouldUseColor({ isTTY: true })).toBe(false);
  });
});
