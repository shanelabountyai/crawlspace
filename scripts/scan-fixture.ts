/**
 * npm run scan:fixture <name> [--json]
 * Scans a synthetic site from fixtures/sites/<name> (no network) and prints the scorecard as a table, then JSON.
 */
import { fixtureAgents, fixtureSnapshot, listFixtures } from "../src/lib/fixtures";
import { scanSnapshot } from "../src/lib/scan";
import { renderTable } from "../src/lib/report/table";

function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--"));
  const all = listFixtures();
  if (!name || !all.includes(name)) {
    console.error(`usage: npm run scan:fixture <name>\nfixtures: ${all.join(", ")}`);
    process.exit(name ? 1 : 2);
  }
  const card = scanSnapshot(fixtureSnapshot(name), { agents: fixtureAgents() });
  if (!args.includes("--json")) {
    console.log(renderTable(card));
    console.log("");
  }
  console.log(JSON.stringify(card, null, 2));
}

main();
