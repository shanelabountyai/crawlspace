/** Minimal robots.txt parser (RFC 9309 matching: longest match wins, Allow wins ties, `*` and `$`). */

export interface RobotsRule {
  allow: boolean;
  path: string;
  line: number;
}
export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  line: number;
}

export function parseRobots(body: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  body.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) return;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) return;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], line: i + 1 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if (!current) return;
    if (key === "allow" || key === "disallow") {
      // An empty Disallow means "allow everything"; skip it.
      if (key === "disallow" && value === "") return;
      current.rules.push({ allow: key === "allow", path: value, line: i + 1 });
    }
  });
  return groups;
}

function groupFor(groups: RobotsGroup[], token: string): RobotsGroup[] {
  const t = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(t));
  if (specific.length) return specific;
  return groups.filter((g) => g.agents.includes("*"));
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    "^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""),
  );
  return re.test(path);
}

export interface RobotsVerdict {
  allowed: boolean;
  rule?: RobotsRule;
}

export function isAllowed(groups: RobotsGroup[], token: string, path: string): RobotsVerdict {
  const rules = groupFor(groups, token).flatMap((g) => g.rules);
  let best: RobotsRule | undefined;
  for (const r of rules) {
    if (!patternMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) {
      best = r;
    }
  }
  return { allowed: best ? best.allow : true, rule: best };
}

/** `Sitemap:` lines (they are global, not tied to a user-agent group). */
export function sitemapsFromRobots(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => /^\s*sitemap\s*:\s*(\S+)/i.exec(l)?.[1])
    .filter((x): x is string => Boolean(x));
}

/** The outcome of fetching a robots.txt: an HTTP answer, or the error that prevented one. */
export type RobotsFetch = { status: number; body: string } | { error: string };
export type RobotsAccess = { ok: true; groups: RobotsGroup[] } | { ok: false; why: string };

/**
 * What a robots.txt fetch means for a crawler (RFC 9309 section 2.3.1; D-24; PRD-02 requirement 2, Decision 10a):
 * unreachable (network error) or 5xx → disallow everything; 200 → its rules; anything else (4xx) → no rules.
 * `why` is a short clause the caller puts after the file's name ("robots.txt returned 503").
 */
export function robotsAccess(fetched: RobotsFetch): RobotsAccess {
  if ("error" in fetched) return { ok: false, why: `could not be read (${fetched.error})` };
  if (fetched.status >= 500) return { ok: false, why: `returned ${fetched.status}` };
  return { ok: true, groups: fetched.status === 200 ? parseRobots(fetched.body) : [] };
}
