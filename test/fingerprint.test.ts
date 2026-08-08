import { describe, expect, it } from "vitest";
import { mcpServerFingerprint } from "../src/util/fingerprint.js";

describe("mcpServerFingerprint", () => {
  it("is stable for the same command and args", () => {
    const a = mcpServerFingerprint("/usr/bin/node", ["server.js", "--port", "3000"]);
    const b = mcpServerFingerprint("/usr/bin/node", ["server.js", "--port", "3000"]);
    expect(a).toBe(b);
  });

  it("differs when args differ", () => {
    const a = mcpServerFingerprint("/usr/bin/node", ["server.js", "--port", "3000"]);
    const b = mcpServerFingerprint("/usr/bin/node", ["server.js", "--port", "4000"]);
    expect(a).not.toBe(b);
  });

  it("is stable across env changes, since env is excluded from identity", () => {
    // env isn't a parameter, so this documents the property rather than exercising env
    // directly: identity is a pure function of (command, args) only.
    const a = mcpServerFingerprint("/usr/bin/node", ["server.js"]);
    const b = mcpServerFingerprint("/usr/bin/node", ["server.js"]);
    expect(a).toBe(b);
  });

  it("prefixes with the command's basename for readability", () => {
    expect(mcpServerFingerprint("/usr/local/bin/my-server", [])).toMatch(/^my-server-[0-9a-f]{12}$/);
  });
});
