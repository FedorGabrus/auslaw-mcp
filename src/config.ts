/**
 * Configuration module for AusLaw MCP
 * Loads configuration from environment variables with defaults
 */

import path from "node:path";

export interface Config {
  austlii: {
    searchBase: string;
    referer: string;
    userAgent: string;
    timeout: number;
    /**
     * AustLII sits behind a Cloudflare managed JS challenge that blocks plain
     * HTTP clients. When true (default), requests are routed through a real
     * Chrome (spawned with remote debugging and driven over CDP) by the
     * austlii-browser service.
     */
    browserBypass: boolean;
    /**
     * Path to the Chrome executable. The bypass spawns a *real* Chrome (not
     * Playwright's bundled Chromium) with a clean command line so Cloudflare's
     * managed challenge auto-passes. Default is the macOS Chrome location.
     */
    chromePath: string;
    /** Remote-debugging port for the spawned Chrome (CDP). */
    cdpPort: number;
    /**
     * Attach to an already-running Chrome at this DevTools URL (e.g.
     * "http://127.0.0.1:9222") instead of spawning one.
     */
    cdpUrl?: string;
    /**
     * Dedicated Chrome user-data-dir. When unset (default), an ephemeral
     * per-process profile is used (clean every start — avoids accumulating
     * WAF-flagged state). Set this to a stable path to persist cf_clearance
     * across restarts.
     */
    browserProfileDir?: string;
    /** Max ms to wait for a Cloudflare challenge to clear (auto or human-solved). */
    challengeTimeout: number;
  };
  jade: {
    baseUrl: string;
    userAgent: string;
    timeout: number;
    sessionCookie?: string;
  };
  ocr: {
    language: string;
    oem: number;
    psm: number;
  };
  defaults: {
    searchLimit: number;
    maxSearchLimit: number;
    outputFormat: string;
    sortBy: string;
  };
  cache: {
    /** Base directory for the .auslaw/ cache folder. Defaults to cwd. */
    dir: string;
    /** Project name used in bib exports and multi-doc tracking. Defaults to basename of dir. */
    projectName: string;
  };
  sources: {
    /** Directory where source markdown files are saved. */
    dir: string;
    /** When true, fetch_document_text automatically saves a local source copy. */
    fetchByDefault: boolean;
  };
  citedBy: {
    /** Cache cited-by results from jade.io citator lookups. */
    enabled: boolean;
    /** Download source files for the top-N citing cases when caching cited-by results. */
    downloadSources: boolean;
    /** Maximum number of citing-case sources to download per lookup. */
    downloadLimit: number;
  };
}

/**
 * Load configuration from environment variables with sensible defaults.
 *
 * @returns A fully-populated {@link Config} object
 */
export function loadConfig(): Config {
  const cacheDir = process.env.AUSLAW_CACHE_DIR ?? process.cwd();
  const projectName = process.env.AUSLAW_PROJECT_NAME ?? path.basename(cacheDir);
  const sourcesDir = process.env.AUSLAW_SOURCES_DIR ?? path.join(cacheDir, "sources");

  return {
    austlii: {
      searchBase:
        process.env.AUSTLII_SEARCH_BASE || "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      referer: process.env.AUSTLII_REFERER || "https://www.austlii.edu.au/forms/search1.html",
      userAgent:
        process.env.AUSTLII_USER_AGENT ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      timeout: parseInt(process.env.AUSTLII_TIMEOUT || "60000", 10), // AustLII can be slow
      browserBypass: process.env.AUSTLII_BROWSER_BYPASS !== "false",
      chromePath:
        process.env.AUSTLII_CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      cdpPort: parseInt(process.env.AUSTLII_CDP_PORT || "9222", 10),
      cdpUrl: process.env.AUSTLII_CDP_URL || undefined,
      browserProfileDir: process.env.AUSTLII_BROWSER_PROFILE_DIR || undefined,
      challengeTimeout: parseInt(process.env.AUSTLII_CHALLENGE_TIMEOUT || "180000", 10),
    },
    jade: {
      baseUrl: process.env.JADE_BASE_URL || "https://jade.io",
      userAgent: process.env.JADE_USER_AGENT || "auslaw-mcp/0.1.0 (legal research tool)",
      timeout: parseInt(process.env.JADE_TIMEOUT || "15000", 10),
      sessionCookie: process.env.JADE_SESSION_COOKIE || undefined,
    },
    ocr: {
      language: process.env.OCR_LANGUAGE || "eng",
      oem: parseInt(process.env.OCR_OEM || "1", 10),
      psm: parseInt(process.env.OCR_PSM || "3", 10),
    },
    defaults: {
      searchLimit: parseInt(process.env.DEFAULT_SEARCH_LIMIT || "10", 10),
      maxSearchLimit: parseInt(process.env.MAX_SEARCH_LIMIT || "50", 10),
      outputFormat: process.env.DEFAULT_OUTPUT_FORMAT || "json",
      sortBy: process.env.DEFAULT_SORT_BY || "auto",
    },
    cache: {
      dir: cacheDir,
      projectName,
    },
    sources: {
      dir: sourcesDir,
      fetchByDefault: process.env.AUSLAW_FETCH_SOURCES !== "false",
    },
    citedBy: {
      enabled: process.env.AUSLAW_CACHE_CITED_BY !== "false",
      downloadSources: process.env.AUSLAW_DOWNLOAD_CITED_BY_SOURCES !== "false",
      downloadLimit: parseInt(process.env.AUSLAW_CITED_BY_DOWNLOAD_LIMIT ?? "5", 10) || 5,
    },
  };
}

// Export a singleton instance
export const config = loadConfig();
