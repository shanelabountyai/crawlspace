import { z } from "zod";

export const SITE_TYPES = ["ecommerce", "event", "other"] as const;
export const SiteTypeSchema = z.enum(SITE_TYPES);
export type SiteType = z.infer<typeof SiteTypeSchema>;

export const PAGE_KINDS = ["home", "product", "event", "cart", "registration", "other"] as const;
export const PageKindSchema = z.enum(PAGE_KINDS);
export type PageKind = z.infer<typeof PageKindSchema>;

/** A fetched text resource (robots.txt, sitemap, llms.txt). `body` is null when status != 200. */
export const ResourceSchema = z
  .object({
    url: z.string().url(),
    status: z.number().int().min(0).max(599),
    body: z.string().nullable(),
  })
  .strict();
export type Resource = z.infer<typeof ResourceSchema>;

export const PageSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().url(),
    kind: PageKindSchema,
    status: z.number().int().min(0).max(599),
    ttfbMs: z.number().nonnegative(),
    rawHtml: z.string(),
    renderedHtml: z.string(),
  })
  .strict();
export type Page = z.infer<typeof PageSchema>;

/** The in-memory snapshot every check reads. Plain data only (no Dates, no functions). */
export const SnapshotSchema = z
  .object({
    url: z.string().url(),
    fetchedAt: z.string().datetime({ offset: true }),
    siteTypeOverride: SiteTypeSchema.nullable(),
    robots: ResourceSchema.nullable(),
    sitemap: ResourceSchema.nullable(),
    llms: ResourceSchema.nullable(),
    pages: z.array(PageSchema).min(1),
    /**
     * False when any page's `renderedHtml` is not a real rendering (the headless browser failed, or rendering was
     * switched off) and is only a copy of `rawHtml`. The checks that read the rendered view then return N/A instead
     * of judging raw HTML as if it had been rendered (PRD-02 requirement 6). Absent = true, so snapshots stored
     * before the flag existed, and every committed fixture, read as rendered.
     */
    rendered: z.boolean().default(true),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (!s.pages.some((p) => p.kind === "home")) {
      ctx.addIssue({ code: "custom", message: "snapshot needs a page with kind 'home'", path: ["pages"] });
    }
    const ids = new Set<string>();
    for (const p of s.pages) {
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", message: `duplicate page id '${p.id}'`, path: ["pages"] });
      ids.add(p.id);
    }
  });
export type Snapshot = z.infer<typeof SnapshotSchema>;

/** On-disk manifest (`snapshot.json`): same shape, but file paths instead of contents. */
const ManifestResourceSchema = z
  .object({
    status: z.number().int().min(0).max(599),
    file: z.string().nullable(),
  })
  .strict();

export const ManifestSchema = z
  .object({
    url: z.string().url(),
    fetchedAt: z.string().datetime({ offset: true }),
    siteTypeOverride: SiteTypeSchema.nullable().default(null),
    robots: ManifestResourceSchema.nullable(),
    sitemap: ManifestResourceSchema.nullable(),
    llms: ManifestResourceSchema.nullable(),
    /** See `SnapshotSchema.rendered`. Written only when false, so manifests of rendered snapshots are unchanged. */
    rendered: z.boolean().default(true),
    pages: z
      .array(
        z
          .object({
            id: z.string().min(1),
            url: z.string().url(),
            kind: PageKindSchema,
            status: z.number().int().min(0).max(599),
            ttfbMs: z.number().nonnegative(),
            raw: z.string(),
            rendered: z.string(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type Manifest = z.infer<typeof ManifestSchema>;
