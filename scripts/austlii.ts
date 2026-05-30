/**
 * Manual AustLII CLI helper — for local testing / verification of the
 * Cloudflare browser bypass without going through an MCP client.
 *
 * Usage (no build needed — runs via tsx):
 *   npm run austlii -- "mabo native title"          # search (default: cases, limit 10)
 *   npm run austlii -- fetch "https://www.austlii.edu.au/.../HCA/1992/23.html"
 *
 * A visible browser window opens; solve any Cloudflare challenge once. The
 * persistent profile then caches cf_clearance for subsequent runs.
 */
import { searchAustLii } from "../src/services/austlii.js";
import { fetchDocumentText } from "../src/services/fetcher.js";
import { closeAustliiBrowser } from "../src/services/austlii-browser.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "fetch") {
    const url = args[1];
    if (!url) throw new Error('Usage: npm run austlii -- fetch "<url>"');
    const r = await fetchDocumentText(url);
    console.log(`contentType=${r.contentType}  ocrUsed=${r.ocrUsed}  length=${r.text.length}`);
    console.log("---");
    console.log(r.text.slice(0, 800));
    return;
  }

  const query = args.join(" ").trim() || "mabo native title";
  console.log(`Searching AustLII for: "${query}"\n`);
  const results = await searchAustLii(query, { type: "case", limit: 10 });
  console.log(`${results.length} result(s):`);
  for (const r of results) {
    console.log(`- ${r.title}`);
    console.log(`  ${r.url}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => closeAustliiBrowser());
