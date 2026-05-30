/**
 * AustLII browser transport.
 *
 * AustLII is fronted by a Cloudflare *managed* JavaScript challenge that blocks
 * every plain HTTP client (axios/fetch) with `403 cf-mitigated: challenge` —
 * no header or User-Agent tweak defeats it. Empirically (see
 * `docs/austlii-cloudflare.md`):
 *   - A browser launched by Playwright (`launch`/`launchPersistentContext`),
 *     even headful or with automation flags stripped, is still detected on the
 *     search endpoint and stuck in an unsolvable challenge loop.
 *   - A *real Chrome* started with a clean command line (just a remote-debugging
 *     port) and driven over CDP auto-passes the challenge in ~2s.
 *
 * Strategy: spawn a real Chrome ourselves with `--remote-debugging-port`, attach
 * via `connectOverCDP`, and perform all requests as same-origin in-page
 * `fetch()` calls (search via navigation hits a WAF 410; in-page fetch returns
 * 200). A persistent user-data-dir keeps `cf_clearance` across restarts. If a
 * challenge ever does appear, the Chrome window is visible so it can be solved
 * by hand; normally no interaction is needed.
 *
 * Intended to run locally on a desktop with a display.
 */
import { config } from "../config.js";
import { austliiRateLimiter } from "../utils/rate-limiter.js";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";

const CHALLENGE_TITLE = "just a moment";
const HOMEPAGE = "https://www.austlii.edu.au/";

interface Session {
  browser: Browser;
  context: BrowserContext;
  chrome?: ChildProcess;
  /** Ephemeral profile dir to delete on close (undefined when profile is persistent). */
  ephemeralDir?: string;
}

let sessionPromise: Promise<Session> | null = null;
/** Serialises browser operations — a shared page must not handle concurrent work. */
let opQueue: Promise<unknown> = Promise.resolve();

/** Poll the Chrome DevTools endpoint until it is ready (or time out). */
async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`Chrome DevTools endpoint on port ${port} did not become ready`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Lazily spawn Chrome + attach over CDP (memoised for the process). */
async function getSession(): Promise<Session> {
  if (!config.austlii.browserBypass) {
    throw new Error(
      "AustLII access is disabled (AUSTLII_BROWSER_BYPASS=false). AustLII is behind a " +
        "Cloudflare challenge and cannot be reached without the browser transport.",
    );
  }
  if (!sessionPromise) {
    sessionPromise = (async () => {
      let playwright: typeof import("playwright-core");
      try {
        playwright = await import("playwright-core");
      } catch {
        throw new Error(
          "AustLII access requires the 'playwright-core' package. Run: npm install playwright-core",
        );
      }

      let chrome: ChildProcess | undefined;
      let ephemeralDir: string | undefined;
      let cdpUrl = config.austlii.cdpUrl;
      if (!cdpUrl) {
        const port = config.austlii.cdpPort;
        // Use a stable profile if configured, else an ephemeral one (clean every
        // start — a heavily reused profile accumulates WAF-flagged state).
        let profileDir = config.austlii.browserProfileDir;
        if (!profileDir) {
          ephemeralDir = await mkdtemp(path.join(os.tmpdir(), "auslaw-austlii-"));
          profileDir = ephemeralDir;
        }
        chrome = spawn(
          config.austlii.chromePath,
          [
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${profileDir}`,
            "--no-first-run",
            "--no-default-browser-check",
            HOMEPAGE,
          ],
          { stdio: "ignore" },
        );
        chrome.on("error", () => {
          /* surfaced via the waitForCdp timeout below */
        });
        try {
          await waitForCdp(port, 20_000);
        } catch (error) {
          chrome.kill();
          const msg = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to start Chrome for AustLII access: ${msg}\n` +
              `Check AUSTLII_CHROME_PATH (currently "${config.austlii.chromePath}").`,
          );
        }
        cdpUrl = `http://127.0.0.1:${port}`;
      }

      const browser = await playwright.chromium.connectOverCDP(cdpUrl);
      const context = browser.contexts()[0] ?? (await browser.newContext());
      return { browser, context, chrome, ephemeralDir };
    })().catch((error) => {
      sessionPromise = null; // allow a later retry
      throw error;
    });
  }
  return sessionPromise;
}

/** Get a page on the AustLII origin from the connected context. */
async function getPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  return (
    pages.find((p) => p.url().includes("austlii.edu.au")) ?? pages[0] ?? (await context.newPage())
  );
}

/** Tracks whether the search-path Cloudflare challenge has been cleared this session. */
let warmed = false;

/**
 * Wait for any Cloudflare challenge on the current page to clear. Normally it
 * auto-passes in a couple of seconds; if it doesn't, wait for the user to solve
 * it in the visible Chrome window.
 */
async function waitForChallenge(page: Page): Promise<void> {
  const deadline = Date.now() + config.austlii.challengeTimeout;
  let warned = false;
  for (;;) {
    let title = "";
    try {
      title = (await page.title()).toLowerCase();
    } catch {
      // navigation in flight
    }
    if (title && !title.includes(CHALLENGE_TITLE)) return;
    if (Date.now() >= deadline) {
      throw new Error(
        "AustLII is behind a Cloudflare verification that did not clear in time. " +
          "Solve the challenge in the AustLII Chrome window, then retry.",
      );
    }
    if (!warned) {
      console.error(
        "[auslaw-mcp] Waiting for the AustLII Cloudflare check to clear " +
          "(solve it in the Chrome window if it appears)…",
      );
      warned = true;
    }
    await page.waitForTimeout(1000);
  }
}

/**
 * Ensure the page is on the AustLII origin with the Cloudflare challenge cleared
 * for BOTH the homepage and the search path, then leave the page on the stable
 * homepage. This navigation-based clearing runs **once** per session: repeatedly
 * navigating the search CGI trips a WAF (410), and evaluating during the
 * challenge reload destroys the execution context — so all subsequent requests
 * are same-origin in-page `fetch()` from this settled homepage.
 */
async function ensureWarm(page: Page): Promise<void> {
  if (!page.url().includes("austlii.edu.au")) {
    await page.goto(HOMEPAGE, { waitUntil: "domcontentloaded", timeout: config.austlii.timeout });
  }
  await waitForChallenge(page);
  if (warmed) return;

  // One-time: navigate a search URL so Cloudflare clears the search path and
  // issues cf_clearance (its own response may be a WAF 410, which we ignore).
  const warmupUrl = `${config.austlii.searchBase}?method=auto&query=law&meta=%2Fau&view=relevance`;
  await page
    .goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: config.austlii.timeout })
    .catch(() => {});
  await waitForChallenge(page);
  // Land back on the stable homepage to evaluate fetches against.
  await page.goto(HOMEPAGE, { waitUntil: "domcontentloaded", timeout: config.austlii.timeout });
  await waitForChallenge(page);
  warmed = true;
}

/** Same-origin in-page fetch returning text. */
function fetchTextInPage(page: Page, url: string) {
  return page.evaluate(async (u): Promise<{ status: number; body: string }> => {
    const r = await fetch(u, { credentials: "include" });
    return { status: r.status, body: await r.text() };
  }, url);
}

/** Same-origin in-page fetch returning base64-encoded bytes. */
function fetchBufferInPage(page: Page, url: string) {
  return page.evaluate(async (u): Promise<{ status: number; contentType: string; b64: string }> => {
    const r = await fetch(u, { credentials: "include" });
    const ab = await r.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return { status: r.status, contentType: r.headers.get("content-type") ?? "", b64: btoa(bin) };
  }, url);
}

/**
 * Run an in-page fetch with resilience: AustLII's search CGI behind Cloudflare
 * occasionally returns a transient 410/5xx, and the challenge reload can destroy
 * the execution context. Retry a few times, re-warming the session on a 403.
 */
async function fetchWithRetry<T extends { status: number }>(
  page: Page,
  url: string,
  fn: (p: Page, u: string) => Promise<T>,
): Promise<T> {
  const MAX_ATTEMPTS = 3;
  let last: T | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: T;
    try {
      res = await fn(page, url);
    } catch (error) {
      if (/context was destroyed|navigation/i.test(String(error)) && attempt < MAX_ATTEMPTS - 1) {
        await page.waitForTimeout(1500);
        continue;
      }
      throw error;
    }
    last = res;
    if (res.status === 200) return res;
    if (res.status === 403) {
      warmed = false;
      await ensureWarm(page);
      continue;
    }
    // Transient non-200 (e.g. AustLII 410 under load) — brief backoff then retry.
    if (attempt < MAX_ATTEMPTS - 1) await page.waitForTimeout(2000);
  }
  return last as T;
}

/** Run a browser operation serialised behind the op queue. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = opQueue.then(fn, fn);
  opQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Fetch an AustLII page as text (used for search). */
export async function austliiFetchText(url: string): Promise<{ status: number; body: string }> {
  return enqueue(async () => {
    await austliiRateLimiter.throttle();
    const { context } = await getSession();
    const page = await getPage(context);
    await ensureWarm(page);
    return fetchWithRetry(page, url, fetchTextInPage);
  });
}

/** Fetch an AustLII document as bytes (used for judgment/PDF retrieval). */
export async function austliiFetchBuffer(
  url: string,
): Promise<{ status: number; buffer: Buffer; contentType: string }> {
  return enqueue(async () => {
    await austliiRateLimiter.throttle();
    const { context } = await getSession();
    const page = await getPage(context);
    await ensureWarm(page);
    const res = await fetchWithRetry(page, url, fetchBufferInPage);
    return {
      status: res.status,
      buffer: Buffer.from(res.b64, "base64"),
      contentType: res.contentType,
    };
  });
}

/** Close the CDP connection and the spawned Chrome (best-effort; call on shutdown). */
export async function closeAustliiBrowser(): Promise<void> {
  const pending = sessionPromise;
  sessionPromise = null;
  warmed = false;
  if (!pending) return;
  try {
    const { browser, chrome, ephemeralDir } = await pending;
    await browser.close().catch(() => {});
    // connectOverCDP does not stop the spawned browser — kill it explicitly.
    if (chrome && !chrome.killed) chrome.kill();
    if (ephemeralDir) await rm(ephemeralDir, { recursive: true, force: true }).catch(() => {});
  } catch {
    // never opened / already gone
  }
}
