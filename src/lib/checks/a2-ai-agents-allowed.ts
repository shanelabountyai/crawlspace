import { pathOf } from "../html";
import { isAllowed, parseRobots } from "../robots";
import { scannedPages, type CheckDefinition, type Evidence } from "./types";

export const a2AiAgentsAllowed: CheckDefinition = {
  id: "A2",
  category: "A",
  title: "AI user agents are allowed by robots.txt",
  appliesTo: "all",
  run(ctx) {
    const { snapshot, agents } = ctx;
    if (agents.length === 0) {
      return { status: "not-applicable", evidence: [{ detail: "no verified AI user agents in the agent list (rules/agents.json)" }] };
    }
    const r = snapshot.robots;
    if (!r || r.status === 404 || (r.status >= 400 && r.status < 500)) {
      return { status: "pass", evidence: [{ url: r?.url, detail: "no robots.txt: all agents are allowed by default" }] };
    }
    if (r.status !== 200 || r.body === null) {
      return { status: "partial", evidence: [{ url: r.url, detail: `robots.txt returned ${r.status}: some agents treat this as 'disallow all'` }] };
    }
    const groups = parseRobots(r.body);
    const paths = ["/", ...scannedPages(ctx).map((p) => pathOf(p.url)), ...ctx.actionPages.map((p) => pathOf(p.url))];
    const unique = [...new Set(paths)];
    const evidence: Evidence[] = [];
    let blocked = 0;
    for (const a of agents) {
      const hit = unique.map((p) => ({ p, v: isAllowed(groups, a.token, p) })).find((x) => !x.v.allowed);
      if (hit) {
        blocked++;
        evidence.push({ url: r.url, line: hit.v.rule?.line, detail: `${a.token} is blocked from ${hit.p} (rule "Disallow: ${hit.v.rule?.path}")` });
      }
    }
    if (blocked === 0) {
      return { status: "pass", evidence: [{ url: r.url, detail: `all ${agents.length} listed AI agents may fetch the home, key and action pages` }] };
    }
    return { status: blocked === agents.length ? "fail" : "partial", evidence };
  },
};
