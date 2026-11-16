import { CATEGORIES } from "../checks/types";
import { inputUrls } from "./input";
import type { FixInput, Prompt } from "./types";

export const SYSTEM_PROMPT = `You write the fix list for Crawlspace, a scanner that checks how well AI agents can read and act on a website.
You receive the checks that failed or partly passed, each with the evidence the scanner found.
Write one fix per check, most important first, in plain English for a marketer or site owner (no jargon without a short explanation).

Hard rules:
- Only use check IDs from the input. Never invent a check, and never mention any other check ID.
- Only cite URLs that appear in the input evidence. Do not include any other URL, not even documentation links.
- Do not claim anything the evidence does not show. If a check is labelled "heuristic" or "proposed convention", say so.
- Return JSON only, no prose around it, exactly in this shape:
{"fixes":[{"checkId":"B1","title":"short imperative title","why":"why this matters to an agent, citing the evidence","how":"concrete steps to fix it","evidenceUrls":["<url from the input>"]}]}`;

/** Deterministic prompt: same input, same text. */
export function buildPrompt(siteUrl: string, inputs: readonly FixInput[]): Prompt {
  const payload = {
    site: siteUrl,
    allowedCheckIds: inputs.map((i) => i.checkId),
    allowedUrls: [...inputUrls(inputs)].sort(),
    checks: inputs.map((i) => ({
      checkId: i.checkId,
      category: CATEGORIES[i.category],
      title: i.title,
      status: i.status,
      weight: i.weight,
      ...(i.label ? { label: i.label } : {}),
      evidence: i.evidence,
    })),
  };
  return { system: SYSTEM_PROMPT, user: `Checks to fix (JSON):\n${JSON.stringify(payload, null, 2)}` };
}
