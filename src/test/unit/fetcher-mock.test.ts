import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchDocumentText } from "../../services/fetcher.js";
import { austliiFetchBuffer } from "../../services/austlii-browser.js";
import { AUSTLII_JUDGMENT_HTML } from "../fixtures/index.js";

// AustLII URLs are fetched via the browser transport (Cloudflare bypass).
// Mock that seam so content-type handling is exercised offline against fixtures.
vi.mock("../../services/austlii-browser.js", () => ({
  austliiFetchBuffer: vi.fn(),
}));
vi.mock("file-type", () => ({
  fileTypeFromBuffer: vi.fn().mockResolvedValue(undefined),
}));

const mockedBuf = vi.mocked(austliiFetchBuffer);

/** Helper to stub a browser fetch with a given body + content-type. */
function stubFetch(body: Buffer | string, contentType: string, status = 200) {
  mockedBuf.mockResolvedValue({
    status,
    buffer: typeof body === "string" ? Buffer.from(body) : body,
    contentType,
  });
}

describe("fetchDocumentText (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw a descriptive error for jade.io URLs instead of returning empty content", async () => {
    // jade.io is a GWT SPA — HTTP fetch returns a JS bootstrap shell, not judgment text.
    // Silently returning empty content is misleading; we want a clear, actionable error.
    await expect(fetchDocumentText("https://jade.io/article/67401")).rejects.toThrow(
      /jade\.io.*not supported|fetch_document_text.*jade\.io/i,
    );
  });

  it("should extract text from HTML content", async () => {
    stubFetch(Buffer.from(AUSTLII_JUDGMENT_HTML), "text/html");

    const result = await fetchDocumentText(
      "https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html",
    );
    expect(result.text).toBeTruthy();
    expect(result.text).toContain("Smith v Jones");
  });

  it("should preserve paragraph numbers [N] in extracted text", async () => {
    stubFetch(Buffer.from(AUSTLII_JUDGMENT_HTML), "text/html");

    const result = await fetchDocumentText(
      "https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html",
    );
    expect(result.text).toMatch(/\[1\]/);
    expect(result.text).toMatch(/\[4\]/);
  });

  it("should set correct metadata fields", async () => {
    stubFetch(Buffer.from(AUSTLII_JUDGMENT_HTML), "text/html");

    const result = await fetchDocumentText(
      "https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html",
    );
    expect(result.contentType).toBe("text/html");
    expect(result.sourceUrl).toBe("https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html");
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.contentLength).toBeDefined();
    expect(result.metadata!.contentType).toBe("text/html");
  });

  it("should set ocrUsed to false for HTML content", async () => {
    stubFetch(Buffer.from(AUSTLII_JUDGMENT_HTML), "text/html");

    const result = await fetchDocumentText(
      "https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html",
    );
    expect(result.ocrUsed).toBe(false);
  });

  it("should handle plain text content type", async () => {
    const plainText = "This is a plain text legal document.";
    stubFetch(plainText, "text/plain");

    const result = await fetchDocumentText(
      "https://www.austlii.edu.au/au/cases/cth/HCA/2024/doc.txt",
    );
    expect(result.text).toBe(plainText);
    expect(result.contentType).toBe("text/plain");
    expect(result.ocrUsed).toBe(false);
  });

  it("should throw on browser fetch failure", async () => {
    mockedBuf.mockRejectedValue(new Error("Connection refused"));

    await expect(
      fetchDocumentText("https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html"),
    ).rejects.toThrow();
  });

  it("should throw when AustLII returns an error status", async () => {
    mockedBuf.mockResolvedValue({ status: 410, buffer: Buffer.from(""), contentType: "" });

    await expect(
      fetchDocumentText("https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html"),
    ).rejects.toThrow(/HTTP 410/);
  });

  it("should preserve cleaned HTML in response.html for HTML content", async () => {
    stubFetch(Buffer.from(AUSTLII_JUDGMENT_HTML), "text/html");

    const result = await fetchDocumentText(
      "https://www.austlii.edu.au/au/cases/cth/HCA/2024/1.html",
    );
    expect(result.html).toBeDefined();
    expect(result.html).toContain("<h1>");
    expect(result.html).toContain("Smith v Jones");
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("<style");
    expect(result.html).not.toContain("<nav");
  });

  it("should not set html field for plain text content", async () => {
    const plainText = "This is a plain text legal document.";
    stubFetch(plainText, "text/plain");

    const result = await fetchDocumentText(
      "https://www.austlii.edu.au/au/cases/cth/HCA/2024/doc.txt",
    );
    expect(result.html).toBeUndefined();
  });

  it("should throw for unsupported content type", async () => {
    stubFetch(Buffer.from("binary data"), "application/octet-stream");

    await expect(
      fetchDocumentText("https://www.austlii.edu.au/au/cases/cth/HCA/2024/file.bin"),
    ).rejects.toThrow();
  });
});
