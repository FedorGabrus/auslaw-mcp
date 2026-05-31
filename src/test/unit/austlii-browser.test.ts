import { describe, it, expect } from "vitest";
import { isConnectionDead } from "../../services/austlii-browser.js";

describe("isConnectionDead", () => {
  it("flags closed/disconnected browser errors for session rebuild", () => {
    const dead = [
      "browserContext.newPage: Target page, context or browser has been closed.",
      "Target page, context or browser has been closed",
      "Target closed",
      "Browser has been disconnected",
      "Connection closed",
      "page.evaluate: WebSocket connection closed",
    ];
    for (const msg of dead) {
      expect(isConnectionDead(new Error(msg)), msg).toBe(true);
      expect(isConnectionDead(msg), msg).toBe(true);
    }
  });

  it("does NOT flag the in-place navigation/transient cases (handled by fetchWithRetry)", () => {
    const alive = [
      "Execution context was destroyed, most likely because of a navigation",
      "page.evaluate: Execution context was destroyed",
      "Timeout 60000ms exceeded",
      "Request failed with status 410",
      "",
    ];
    for (const msg of alive) {
      expect(isConnectionDead(new Error(msg)), msg).toBe(false);
      expect(isConnectionDead(msg), msg).toBe(false);
    }
    expect(isConnectionDead(undefined)).toBe(false);
    expect(isConnectionDead(null)).toBe(false);
  });
});
