import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchAustLii } from "../../services/austlii.js";
import { austliiFetchText } from "../../services/austlii-browser.js";
import { AUSTLII_SEARCH_HTML } from "../fixtures/index.js";

// searchAustLii fetches via the browser transport (Cloudflare bypass), not axios.
// Mock that seam so parsing is exercised offline against fixtures.
vi.mock("../../services/austlii-browser.js", () => ({
  austliiFetchText: vi.fn(),
}));
const mockedFetch = vi.mocked(austliiFetchText);

describe("searchAustLii (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue({ status: 200, body: AUSTLII_SEARCH_HTML });
  });

  it("should parse case results from HTML correctly", async () => {
    const results = await searchAustLii("negligence", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.title).toBeTruthy();
      expect(r.url).toBeTruthy();
    }
  });

  it("should filter out journal articles (URLs with /journals/)", async () => {
    const results = await searchAustLii("negligence", { type: "case" });
    for (const r of results) {
      expect(r.url).not.toContain("/journals/");
    }
  });

  it("should filter out legislation results when searching for cases", async () => {
    const results = await searchAustLii("competition", { type: "case" });
    for (const r of results) {
      expect(r.url).toContain("/cases/");
      expect(r.url).not.toMatch(/\/legis\//);
    }
  });

  it("should extract neutral citations from titles", async () => {
    const results = await searchAustLii("Smith v Jones", { type: "case" });
    const withCitation = results.find((r) => r.neutralCitation);
    expect(withCitation).toBeDefined();
    expect(withCitation!.neutralCitation).toMatch(/\[\d{4}\]\s*[A-Z]+\s*\d+/);
  });

  it("should extract jurisdiction from URLs", async () => {
    const results = await searchAustLii("negligence", { type: "case" });
    const cthResult = results.find((r) => r.url.includes("/au/cases/cth/"));
    expect(cthResult).toBeDefined();
    expect(cthResult!.jurisdiction).toBe("cth");
  });

  it("should respect limit parameter", async () => {
    const results = await searchAustLii("negligence", { type: "case", limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("should set source to 'austlii' for all results", async () => {
    const results = await searchAustLii("negligence", { type: "case" });
    for (const r of results) {
      expect(r.source).toBe("austlii");
    }
  });

  it("should throw a wrapped error on transport failure", async () => {
    mockedFetch.mockRejectedValue(new Error("Network Error"));

    await expect(searchAustLii("negligence", { type: "case" })).rejects.toThrow(
      "AustLII search failed",
    );
  });

  it("should build correct search URL with jurisdiction filter", async () => {
    await searchAustLii("negligence", { type: "case", jurisdiction: "vic" });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const calledUrl = String(mockedFetch.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("mask_path=au%2Fcases%2Fvic");
  });

  it("omits the results param to avoid the WAF 410 signature", async () => {
    await searchAustLii("negligence", { type: "case" });
    const calledUrl = String(mockedFetch.mock.calls[0]?.[0] ?? "");
    // method+query+meta+results+view is the toxic 410 signature; results is dropped.
    expect(calledUrl).not.toContain("results=");
    expect(calledUrl).toContain("meta=");
    expect(calledUrl).toContain("view=");
  });

  it("filters out non-legislation URLs when searching for legislation", async () => {
    // Use HTML that includes a relative URL pointing to a /cases/ path (not /legis/)
    const legislationHtml = `
      <html><body>
        <ul><li data-count="1." class="multi">
          <a href="/au/legis/cth/consol_act/paa1988125.html">Privacy Act 1988 (Cth)</a>
          <p class="meta"><a>Commonwealth</a></p>
        </li>
        <li data-count="2." class="multi">
          <a href="/au/cases/cth/HCA/2024/1.html">Case that should be filtered</a>
          <p class="meta"><a>High Court</a></p>
        </li></ul>
      </body></html>`;
    mockedFetch.mockResolvedValueOnce({ status: 200, body: legislationHtml });

    const results = await searchAustLii("Privacy Act", { type: "legislation" });
    for (const r of results) {
      expect(r.url).toContain("/legis/");
    }
  });

  it("processes relative URLs with query parameters correctly", async () => {
    // Simulate AustLII returning a relative URL with search-decoration query params
    const htmlWithRelativeUrl = `
      <html><body>
        <ul><li data-count="1." class="multi">
          <a href="/au/cases/cth/HCA/1992/23.html?stem=0&synonyms=0&query=mabo">Mabo v Queensland [1992] HCA 23</a>
          <p class="meta"><a>High Court</a></p>
        </li></ul>
      </body></html>`;
    mockedFetch.mockResolvedValueOnce({ status: 200, body: htmlWithRelativeUrl });

    const results = await searchAustLii("mabo", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    // Search decoration params (stem, synonyms, query) should be stripped
    expect(results[0]!.url).not.toContain("stem=0");
    expect(results[0]!.url).not.toContain("synonyms=0");
    expect(results[0]!.url).toContain("austlii.edu.au");
  });

  it("rethrows non-Error exceptions from the browser transport", async () => {
    mockedFetch.mockRejectedValueOnce("Failed to fetch");

    await expect(searchAustLii("negligence", { type: "case" })).rejects.toBe("Failed to fetch");
  });

  it("includes offset parameter in search URL when provided", async () => {
    mockedFetch.mockResolvedValueOnce({ status: 200, body: AUSTLII_SEARCH_HTML });

    await searchAustLii("negligence", { type: "case", offset: 10 });

    const calledUrl = String(mockedFetch.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("offset=10");
  });

  it("preserves non-decoration query params in relative result URLs", async () => {
    const htmlWithCustomParam = `
      <html><body>
        <ul><li data-count="1." class="multi">
          <a href="/au/cases/cth/HCA/1992/23.html?stem=0&customparam=kept">Mabo v Queensland [1992] HCA 23</a>
          <p class="meta"><a>High Court</a></p>
        </li></ul>
      </body></html>`;
    mockedFetch.mockResolvedValueOnce({ status: 200, body: htmlWithCustomParam });

    const results = await searchAustLii("mabo", { type: "case" });
    expect(results.length).toBeGreaterThan(0);
    // stem (decoration) should be stripped; customparam should be preserved
    expect(results[0]!.url).not.toContain("stem=0");
    expect(results[0]!.url).toContain("customparam=kept");
  });
});
