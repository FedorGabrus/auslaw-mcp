import { describe, it, expect } from "vitest";
import { extractParagraphBlocks, extractParagraphsFromText } from "../../services/fetcher.js";

describe("extractParagraphBlocks", () => {
  it("extracts paragraphs from modern per-paragraph block elements", () => {
    const html = `<html><body><article>
      <p>[1] First paragraph text here.</p>
      <p>[2] Second paragraph about duty of care.</p>
      <p>[3] Third paragraph concluding.</p>
    </article></body></html>`;

    const paras = extractParagraphBlocks(html);
    expect(paras.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(paras[1]!.text).toContain("duty of care");
  });

  it("falls back to flattened-text scanning for legacy single-block HTML", () => {
    // Older AustLII judgments place every [N] marker inside one block, so the
    // element pass finds nothing and the text fallback must take over.
    const html = `<html><body><pre>JUDGMENT
[1] The appeal raises a single question.
[2] The respondent owed a duty of care.
[3] The appeal is allowed with costs.</pre></body></html>`;

    const paras = extractParagraphBlocks(html);
    expect(paras.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(paras[0]!.text).toContain("single question");
    expect(paras[2]!.text).toContain("allowed with costs");
  });

  it("returns an empty array when there is no [N] numbering", () => {
    const html = `<html><body><p>This older reported judgment uses page numbers only.</p></body></html>`;
    expect(extractParagraphBlocks(html)).toEqual([]);
  });
});

describe("extractParagraphsFromText", () => {
  it("splits sequential [N] markers into paragraphs", () => {
    const text = "[1] First. [2] Second part here. [3] Third and final.";
    const paras = extractParagraphsFromText(text);
    expect(paras.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(paras[1]!.text).toBe("Second part here.");
  });

  it("ignores bracketed citation years that break the sequence", () => {
    const text =
      "[1] The principle in Donoghue v Stevenson [1932] UKHL 100 applies. " +
      "[2] See also Smith v Jones [2024] HCA 1 at [5]. [3] Appeal allowed.";
    const paras = extractParagraphsFromText(text);
    // Only the real paragraph markers (1, 2, 3) are kept; [1932], [2024], [5]
    // are not the next expected number and are skipped.
    expect(paras.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(paras[0]!.text).toContain("Donoghue v Stevenson [1932] UKHL 100");
    expect(paras[1]!.text).toContain("Smith v Jones [2024] HCA 1 at [5]");
  });

  it("returns an empty array when no markers are present", () => {
    expect(extractParagraphsFromText("Plain text with no numbering.")).toEqual([]);
  });
});
