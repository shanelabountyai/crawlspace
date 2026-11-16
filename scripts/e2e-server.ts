/**
 * e2e harness (D-27, D-32): the production build of the app plus a local fixture-site server, in one process.
 * The app gets test crawl options in-process (`.test` hostnames → 127.0.0.1 only); nothing here is reachable
 * from env or HTTP. Run `npm run build` first. Used by playwright.config.ts.
 */
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import next from "next";
import { RecordedModel } from "../src/lib/fixlist";
import { INJECT_KEY, type InjectedScanDeps } from "../src/server/crawl-options";
import { fixtureRoutes, SiteServer, testGuard } from "../tests/helpers/site-server";

export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 7901);
export const SITES_PORT = Number(process.env.E2E_SITES_PORT ?? 7911);

async function main() {
  const sites = await new SiteServer().start(SITES_PORT);
  const base = (host: string) => `http://${host}:${SITES_PORT}`;
  sites.site("goodshop.test", fixtureRoutes("good-shop", base("goodshop.test")));
  sites.site("walledshop.test", fixtureRoutes("walled-shop", base("walledshop.test")));
  sites.site("closed.test", { "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" }, "/": { body: "<h1>closed</h1>" } });

  const deps: InjectedScanDeps = {
    crawl: { guard: testGuard },
    // A recorded reply with one invented check, one invented URL and one passing check named in prose.
    model: RecordedModel.fromFixture("walled-shop.invented.json", { origin: base("walledshop.test") }),
  };
  (globalThis as Record<symbol, unknown>)[INJECT_KEY] = deps;
  process.env.DATABASE_FILE = join(mkdtempSync(join(tmpdir(), "cs-e2e-")), "e2e.db");

  const app = next({ dev: false, dir: process.cwd(), hostname: "127.0.0.1", port: APP_PORT });
  await app.prepare();
  const handle = app.getRequestHandler();
  createServer((req, res) => void handle(req, res)).listen(APP_PORT, "127.0.0.1", () => {
    console.log(`e2e app on http://127.0.0.1:${APP_PORT}, fixture sites on port ${SITES_PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
