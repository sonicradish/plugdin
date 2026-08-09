import { describe, expect, it } from "vitest";
import { runClientCommand, runClientCommandToFile } from "../src/util/exec.js";

/** Comfortably past a 64KB pipe buffer, which is where the truncation shows up. */
const BIG = 200_000;
const printBig = `process.stdout.write(JSON.stringify({ blob: "x".repeat(${BIG}) }))`;

describe("runClientCommandToFile", () => {
  it("returns output far larger than a pipe buffer intact", async () => {
    // The bug this exists for: `opencode debug skill` exits before a large stdout pipe has
    // drained, so its 143KB of JSON arrived cut off mid-string at ~64KB and stopped parsing —
    // which surfaced as an empty Inventory rather than as an error.
    const result = await runClientCommandToFile(process.execPath, ["-e", printBig]);

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(JSON.parse(result.stdout).blob).toHaveLength(BIG);
  });

  it("reports a missing binary as unavailable, exactly as the piped variant does", async () => {
    const result = await runClientCommandToFile("pluggedin-no-such-binary", []);
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toMatch(/not installed or not on PATH/);
  });

  it("treats an empty stdout as unavailable, so a silent failure is never read as 'nothing installed'", async () => {
    const result = await runClientCommandToFile(process.execPath, ["-e", "process.stderr.write('boom'); process.exit(1)"]);
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toBe("boom");
  });

  it("keeps stdout that came with a non-zero exit, matching runClientCommand's leniency", async () => {
    const result = await runClientCommandToFile(process.execPath, ["-e", "process.stdout.write('[]'); process.exit(2)"]);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.stdout).toBe("[]");
  });
});

describe("runClientCommand", () => {
  it("still reads normal-sized output, which most Client commands produce", async () => {
    const result = await runClientCommand(process.execPath, ["-e", "process.stdout.write('{\"ok\":true}')"]);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(JSON.parse(result.stdout)).toEqual({ ok: true });
  });
});
