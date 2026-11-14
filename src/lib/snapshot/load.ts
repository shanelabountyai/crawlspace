import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { ManifestSchema, SnapshotSchema, type Snapshot } from "./schema";

function readInside(dir: string, rel: string): string {
  const root = resolve(dir);
  const full = resolve(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`snapshot file escapes its directory: ${rel}`);
  }
  return readFileSync(full, "utf8");
}

/** Load a snapshot stored on disk (fixtures/sites/<name>/snapshot.json + referenced files). */
export function loadSnapshotFromDir(dir: string): Snapshot {
  const manifest = ManifestSchema.parse(JSON.parse(readInside(dir, "snapshot.json")));
  const origin = new URL(manifest.url).origin;
  const resource = (r: { status: number; file: string | null } | null, path: string) =>
    r === null
      ? null
      : { url: `${origin}${path}`, status: r.status, body: r.file === null ? null : readInside(dir, r.file) };

  return SnapshotSchema.parse({
    url: manifest.url,
    fetchedAt: manifest.fetchedAt,
    siteTypeOverride: manifest.siteTypeOverride,
    robots: resource(manifest.robots, "/robots.txt"),
    sitemap: resource(manifest.sitemap, "/sitemap.xml"),
    llms: resource(manifest.llms, "/llms.txt"),
    pages: manifest.pages.map((p) => ({
      id: p.id,
      url: p.url,
      kind: p.kind,
      status: p.status,
      ttfbMs: p.ttfbMs,
      rawHtml: readInside(dir, p.raw),
      renderedHtml: readInside(dir, p.rendered),
    })),
  });
}
