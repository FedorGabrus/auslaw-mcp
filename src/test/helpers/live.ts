import { describe, it } from "vitest";

/**
 * Live-network tests (AustLII / jade.io) are **opt-in**.
 *
 * They are skipped by default — including in CI — and only run when
 * `RUN_LIVE_TESTS` is set in a non-CI environment. This keeps a plain local
 * `npm test` green even when external services are unreachable, throttled, or
 * behind a bot challenge. To run them: `RUN_LIVE_TESTS=1 npm test` (or
 * `npm run test:live`).
 */

// Explicit, nameable signatures: re-exporting `describe`/`it` directly trips
// TS4023 because their inferred types reference un-exportable vitest internals.
type DescribeFn = (name: string, factory: () => void) => void;
type ItFn = (name: string, fn: () => void | Promise<void>, timeout?: number) => void;

const runLive = !process.env.CI && !!process.env.RUN_LIVE_TESTS;

export const describeLive: DescribeFn = runLive ? describe : describe.skip;
export const itLive: ItFn = runLive ? it : it.skip;
