import type { CheckDefinition } from "./types";

export const d1LlmsTxt: CheckDefinition = {
  id: "D1",
  category: "D",
  title: "/llms.txt is present and well-formed",
  label: "proposed convention",
  appliesTo: "all",
  run({ snapshot }) {
    const l = snapshot.llms;
    const url = l?.url ?? new URL("/llms.txt", snapshot.url).href;
    if (!l || l.status !== 200 || l.body === null || l.body.trim() === "") {
      return { status: "fail", evidence: [{ url, detail: `no /llms.txt (${l ? `HTTP ${l.status}` : "not fetched"}); it is a proposed convention, so this is weighted low` }] };
    }
    const lines = l.body.split(/\r?\n/);
    const firstIdx = lines.findIndex((s) => s.trim() !== "");
    const hasH1 = /^# \S/.test(lines[firstIdx] ?? "");
    const links = (l.body.match(/\[[^\]]+\]\([^)\s]+\)/g) ?? []).length;
    const problems = [!hasH1 && "first line is not a '# Title' heading", links === 0 && "no markdown links"].filter(Boolean);
    if (problems.length === 0) {
      return { status: "pass", evidence: [{ url, detail: `well-formed: H1 title and ${links} link(s)` }] };
    }
    return { status: "partial", evidence: [{ url, line: hasH1 ? undefined : firstIdx + 1, detail: `present but malformed: ${problems.join("; ")}` }] };
  },
};
