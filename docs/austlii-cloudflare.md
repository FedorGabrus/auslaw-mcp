# AustLII Cloudflare bypass

AustLII (`www.austlii.edu.au`) is fronted by a **Cloudflare managed JavaScript
challenge**. This breaks any plain HTTP client (axios, curl, fetch) and is why
search / document retrieval is routed through a real browser
(`src/services/austlii-browser.ts`).

## Two independent breakages

1. **Cloudflare managed challenge → `403 cf-mitigated: challenge`.**
   Every request from a non-browser client is blocked, regardless of
   User-Agent. A JS challenge cannot be solved by an HTTP client.

2. **WAF query-signature rule → `410 Gone`.**
   Even past Cloudflare, the origin returns `410` for the _exact_ search
   signature `method + query + meta + results + view` with no other params —
   i.e. the default unfiltered search the code used to emit. Findings:
   - `method,query,meta,results,view` → **410** (deterministic)
   - the same plus `mask_path` (a _filtered_ search) → **200**
   - any 2 of 3 of `{meta, results, view}` → **200**
   - it is signature-specific, **not** param-count based.

   **Fix:** `searchAustLii` no longer sets `results`; the limit is applied
   client-side. The emitted signature becomes `method,query,meta,view` → 200.

## What works (verified empirically)

- **A Playwright-_launched_ browser is detected** — `launch` /
  `launchPersistentContext`, even headful, with `channel:chrome`, or with
  automation flags stripped (`ignoreDefaultArgs`), still gets stuck on the search
  endpoint. Playwright's launch injects automation flags Cloudflare fingerprints.
- **A real Chrome we start ourselves (clean command line) + attach over CDP
  auto-passes** the challenge in ~2s, no human interaction.
- **Navigation to the search CGI returns a WAF 410**; an in-page same-origin
  `fetch()` of the same URL returns 200. So navigation is used only to _clear_
  the challenge once; results come from `fetch()`.
- **Repeatedly navigating the search CGI, or a heavily reused browser profile,
  trips the WAF (410)**. Clearing the challenge once + a fresh profile avoids it.

## Design

`austlii-browser.ts` spawns a real Chrome (`child_process.spawn` with
`--remote-debugging-port`, **not** Playwright's launcher) and attaches via
`playwright-core`'s `connectOverCDP`:

- **Warmup (once):** navigate homepage → navigate a throwaway search URL (clears
  the search-path challenge / issues `cf_clearance`) → return to the homepage.
- `austliiFetchText(url)` — in-page same-origin `fetch()` from the settled
  homepage → `{status, body}`. Used for search.
- `austliiFetchBuffer(url)` — in-page `fetch()` → `arrayBuffer` (base64-bridged
  to a Node `Buffer`). Used for judgment / PDF retrieval.
- Both retry transient non-200s and re-warm on a 403.
- `closeAustliiBrowser()` — disconnects CDP, kills the spawned Chrome, removes the
  ephemeral profile (wired to SIGINT/SIGTERM).

Profile is **ephemeral per process** by default (clean every start, avoids the
WAF-flagging footgun); set `AUSTLII_BROWSER_PROFILE_DIR` to persist
`cf_clearance`. Intended to run **locally on a desktop with Google Chrome
installed**. Config: `AUSTLII_BROWSER_BYPASS`, `AUSTLII_CHROME_PATH`,
`AUSTLII_CDP_PORT`, `AUSTLII_CDP_URL`, `AUSTLII_BROWSER_PROFILE_DIR`,
`AUSTLII_CHALLENGE_TIMEOUT` (see `.env.example`).

## Operational notes

- A Chrome window opens when AustLII is first used; normally the challenge
  auto-passes with no interaction. If a verification does appear, solve it in
  that window.
- This is an arms race: a Cloudflare policy change can require revisiting the
  spawn flags or the warmup flow.
