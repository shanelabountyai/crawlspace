import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { ManifestSchema, Snapshot } from "./schema";

/** Write a snapshot in the on-disk fixture format, so `loadSnapshotFromDir` can read it back. */
export function writeSnapshotToDir(s: Snapshot, dir: string): void {
  mkdirSync(join(dir, "pages"), { recursive: true });
  const res = (r: Snapshot["robots"], file: string) => {
    if (r === null) return null;
    if (r.body !== null) writeFileSync(join(dir, file), r.body);
    return { status: r.status, file: r.body === null ? null : file };
  };
  const manifest: z.input<typeof ManifestSchema> = {
    url: s.url,
    fetchedAt: s.fetchedAt,
    siteTypeOverride: s.siteTypeOverride,
    robots: res(s.robots, "robots.txt"),
    sitemap: res(s.sitemap, "sitemap.xml"),
    llms: res(s.llms, "llms.txt"),
    ...(s.rendered ? {} : { rendered: false }),
    pages: s.pages.map((p) => {
      const raw = `pages/${p.id}.raw.html`;
      const rendered = `pages/${p.id}.rendered.html`;
      writeFileSync(join(dir, raw), p.rawHtml);
      writeFileSync(join(dir, rendered), p.renderedHtml);
      return { id: p.id, url: p.url, kind: p.kind, status: p.status, ttfbMs: p.ttfbMs, raw, rendered };
    }),
  };
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify(manifest, null, 2) + "\n");
}
