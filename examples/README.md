# Live scan examples

Only domains Shane owns are committed here (D-06). To add one:

```bash
npm run scan yoursite.com -- --save examples/yoursite
```

That writes the snapshot in the same on-disk format as `fixtures/sites/` (raw + rendered HTML, robots.txt, sitemap, llms.txt, `snapshot.json`), so `loadSnapshotFromDir` can rescore it offline. The Phase 2 gate's live example is still open: no domain has been chosen yet (D-18).
