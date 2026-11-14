import { CATEGORIES, type Category } from "../checks/types";
import type { Scorecard } from "../scan";

const ICON = { pass: "PASS", partial: "PART", fail: "FAIL", "not-applicable": "N/A " } as const;

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + "…" : s + " ".repeat(n - s.length);
}

export function renderTable(card: Scorecard): string {
  const lines: string[] = [];
  lines.push(`Crawlspace scorecard — ${card.url}`);
  lines.push(`site type: ${card.siteType} (${card.siteTypeSource})   snapshot: ${card.fetchedAt}   rubric v${card.rubricVersion}`);
  lines.push("");
  lines.push(`${pad("ID", 4)} ${pad("Status", 7)} ${pad("Wt", 4)} ${pad("Check", 58)} Evidence`);
  lines.push("-".repeat(120));
  for (const c of card.checks) {
    const title = c.label ? `${c.title} [${c.label}]` : c.title;
    const ev = c.evidence[0];
    const evText = ev ? `${ev.detail}${ev.line ? ` (line ${ev.line})` : ""}` : "";
    lines.push(`${pad(c.id, 4)} ${pad(ICON[c.status], 7)} ${pad(String(c.weight), 4)} ${pad(title, 58)} ${evText}`);
  }
  lines.push("-".repeat(120));
  for (const [k, name] of Object.entries(CATEGORIES)) {
    const v = card.categories[k as Category];
    lines.push(`${k} ${pad(name, 22)} ${v === null ? "n/a" : v.toFixed(1)}`);
  }
  lines.push(`Overall${" ".repeat(18)}${card.overall === null ? "n/a" : card.overall.toFixed(1)}`);
  return lines.join("\n");
}
