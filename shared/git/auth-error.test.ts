import { describe, expect, it } from "vitest";
import { isAuthError } from "./auth-error.js";

describe("isAuthError", () => {
  it("matches common git auth / missing-credential messages", () => {
    const positives = [
      "fatal: Authentication failed for 'https://github.com/o/r.git/'",
      "could not read Username for 'https://github.com': terminal prompts disabled",
      "fatal: could not read Password for 'https://alice@github.com': terminal prompts disabled",
      "remote: Permission denied",
      "remote: HTTP 403 Forbidden",
      "remote: Invalid username or password",
    ];
    for (const m of positives) expect(isAuthError(m), m).toBe(true);
  });

  it("does not match unrelated network / non-auth errors", () => {
    const negatives = [
      "fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com",
      "Connection timed out after 30000ms",
      "error: early EOF",
      "non-fast-forward",
      "",
      null,
      undefined,
    ];
    for (const m of negatives) expect(isAuthError(m), String(m)).toBe(false);
  });
});
