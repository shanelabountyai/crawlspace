/**
 * npm run scan <url> [--json] [--no-render] [--save <dir>]
 * Crawls one site politely (CrawlspaceBot, robots.txt, ≤15 pages, 1 req/s per host, GET only, SSRF guard),
 * then scores it with the Phase 1 engine. --save writes the snapshot in fixture format (e.g. examples/<name>).
 */
import { resolve } from "node:path";
import { crawlSite, CrawlRefused, SsrfError } from "../src/lib/crawl";
import { renderTable } from "../src/lib/report/table";
import { scanSnapshot } from "../src/lib/scan";
import { writeSnapshotToDir } from "../src/lib/snapshot";

async function main() {
  const args = process.argv.slice(2);
  const saveIdx = args.indexOf("--save");
  const saveDir = saveIdx >= 0 ? args[saveIdx + 1] : undefined;
  const url = args.find((a, i) => !a.startsWith("--") && (saveIdx < 0 || i !== saveIdx + 1));
  if (!url) {
    console.error("usage: npm run scan <url> [-- --json] [-- --no-render] [-- --save examples/<name>]");
    process.exit(2);
  }
  const json = args.includes("--json");
  try {
    const { snapshot, report } = await crawlSite(url, { render: !args.includes("--no-render") });
    const card = scanSnapshot(snapshot);
    if (!json) {
      console.log(renderTable(card));
      console.log(`\n${report.requests.length} requests (${report.requests.filter((r) => r.kind === "page").length} pages, ${report.requests.filter((r) => r.kind === "asset").length} scripts/XHR); ${report.renderEvents.filter((e) => e.action === "blocked").length} browser requests blocked`);
      for (const s of report.skipped) console.log(`skipped ${s.url}: ${s.reason}`);
      for (const n of report.notes) console.log(`note: ${n}`);
      console.log("");
    }
    if (saveDir) {
      writeSnapshotToDir(snapshot, resolve(saveDir));
      if (!json) console.log(`snapshot saved to ${saveDir}\n`);
    }
    console.log(JSON.stringify(card, null, 2));
  } catch (e) {
    if (e instanceof SsrfError || e instanceof CrawlRefused) {
      console.error(`refused: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }
}

void main();
