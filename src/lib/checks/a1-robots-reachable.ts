import type { CheckDefinition } from "./types";

export const a1RobotsReachable: CheckDefinition = {
  id: "A1",
  category: "A",
  title: "robots.txt is reachable",
  appliesTo: "all",
  run({ snapshot }) {
    const r = snapshot.robots;
    if (r && r.status === 200 && r.body !== null) {
      return { status: "pass", evidence: [{ url: r.url, detail: "robots.txt returned 200" }] };
    }
    if (r && r.status === 404) {
      return { status: "partial", evidence: [{ url: r.url, detail: "robots.txt returned 404: crawlers fall back to 'allow all', but there is no guidance or sitemap pointer" }] };
    }
    return {
      status: "fail",
      evidence: [{ url: r?.url ?? new URL("/robots.txt", snapshot.url).href, detail: r ? `robots.txt returned ${r.status}` : "robots.txt could not be fetched" }],
    };
  },
};
