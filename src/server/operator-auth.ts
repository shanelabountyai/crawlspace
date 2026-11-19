import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Operator access (PRD §2/§6: password env var, no accounts; D-39, D-76..D-80).
 *
 * Session cookie: an expiry plus an HMAC-SHA256 of it, keyed by 32 random bytes that exist only in the running
 * process (D-79). Nothing in the cookie can be recomputed from the password, so a copied cookie gives no way to test
 * password guesses offline. Nothing is stored per session; a restart signs the operator out, and so does changing
 * the password. Unset or short password → the operator page is disabled.
 *
 * Sign-in limit: attempts are counted per client address, in one synchronous step before the request body is read
 * (D-76, D-77). The address comes from X-Forwarded-For only when CRAWLSPACE_TRUSTED_PROXY_HOPS says how many proxies
 * in front of the app write to it; otherwise every request shares one bucket (D-78).
 */
export const OPERATOR_COOKIE = "cs_op";
export const MIN_PASSWORD_LENGTH = 12;
export const SESSION_MS = 12 * 3_600_000;
export const LOGIN_WINDOW_MS = 15 * 60_000;
/** Wrong passwords one client address may have counted against it inside the window. */
export const LOGIN_MAX_FAILURES = 10;
/** Counted attempts from all addresses together inside the window before sign-in slows down (it never stops). */
export const LOGIN_GLOBAL_FREE = 50;
/** While slowed, passwords are checked one at a time, this far apart. */
export const LOGIN_SLOW_GAP_MS = 1_000;
/** Addresses remembered at once; beyond it, new addresses share one bucket until old ones expire. */
export const LOGIN_MAX_CLIENTS = 5_000;
/** The bucket for requests whose address is unknown or not trusted. */
export const SHARED_CLIENT = "shared";
export const TRUSTED_PROXY_HOPS_ENV = "CRAWLSPACE_TRUSTED_PROXY_HOPS";
export const MAX_TRUSTED_PROXY_HOPS = 5;

export type OperatorConfig = { enabled: true; password: string } | { enabled: false; reason: string };

export function operatorConfig(env: NodeJS.ProcessEnv = process.env): OperatorConfig {
  const password = env.CRAWLSPACE_OPERATOR_PASSWORD ?? "";
  if (!password) return { enabled: false, reason: "CRAWLSPACE_OPERATOR_PASSWORD is not set" };
  if (password.length < MIN_PASSWORD_LENGTH) return { enabled: false, reason: `CRAWLSPACE_OPERATOR_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters` };
  return { enabled: true, password };
}

const KEY_SYMBOL = Symbol.for("crawlspace.operator.session-key");
/** 32 random bytes made on first use and kept only in this process's memory (D-79). Never logged, never stored. */
function processKey(): Buffer {
  const g = globalThis as { [KEY_SYMBOL]?: Buffer };
  g[KEY_SYMBOL] ??= randomBytes(32);
  return g[KEY_SYMBOL];
}

const keyed = (label: string, msg: string) => createHmac("sha256", processKey()).update(`crawlspace-operator-v2:${label}:${msg}`).digest();

/** Compare two strings without leaking where they differ: equal-length digests under the process key, then timingSafeEqual. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(keyed("cmp", a), keyed("cmp", b));
}

export function checkPassword(cfg: OperatorConfig, attempt: unknown): boolean {
  return cfg.enabled && typeof attempt === "string" && safeEqual(attempt, cfg.password);
}

/**
 * The signature covers the expiry and a tag of the current password, both under the process key. Without the key
 * the signature says nothing about the password; with a different password (D-39) or a new process it stops verifying.
 */
function sign(password: string, exp: string): string {
  return keyed("session", `${exp}:${keyed("password", password).toString("base64url")}`).toString("base64url");
}

export function issueToken(cfg: Extract<OperatorConfig, { enabled: true }>, now: number = Date.now()): string {
  const exp = String(now + SESSION_MS);
  return `${exp}.${sign(cfg.password, exp)}`;
}

export function verifyToken(cfg: OperatorConfig, token: string | undefined | null, now: number = Date.now()): boolean {
  if (!cfg.enabled || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  if (!/^\d{1,16}$/.test(exp) || Number(exp) <= now) return false;
  return safeEqual(token.slice(dot + 1), sign(cfg.password, exp));
}

/** Read one cookie from a Cookie header. */
export function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${OPERATOR_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? "; Secure" : ""}`;
}

export function clearCookie(secure: boolean): string {
  return `${OPERATOR_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** POSTs from another origin are refused when the browser says where they came from (D-39). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function isSecure(req: Request): boolean {
  return (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
}

/** How many proxies in front of the app write to X-Forwarded-For (D-78). Unset, empty or not 1..5 → 0: trust nothing. */
export function trustedProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env[TRUSTED_PROXY_HOPS_ENV] ?? "").trim();
  if (!/^\d$/.test(raw)) return 0;
  const n = Number(raw);
  return n >= 1 && n <= MAX_TRUSTED_PROXY_HOPS ? n : 0;
}

function ipv4Key(s: string): string | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts.join(".") : null;
}

/** IPv6 → its eight groups, or null. Zone ids and anything else that is not plain hex groups are refused. */
function ipv6Groups(s: string): number[] | null {
  if (!/^[0-9a-f:.]{2,45}$/.test(s) || !s.includes(":")) return null;
  let text = s;
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".")) {
    // Embedded IPv4 in the last 32 bits (for example ::ffff:203.0.113.9).
    const v4 = ipv4Key(text.slice(lastColon + 1));
    if (!v4) return null;
    const [a, b, c, d] = v4.split(".").map(Number) as [number, number, number, number];
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    return groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? groups.map((g) => parseInt(g, 16)) : null;
  };
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const gap = 8 - head.length - tail.length;
  return gap >= 1 ? [...head, ...Array<number>(gap).fill(0), ...tail] : null;
}

/**
 * One X-Forwarded-For entry → the key its attempts are counted under, or null when it is not an IP address.
 * IPv4 (a port is dropped; IPv4-mapped IPv6 counts as that IPv4 address) → the address. IPv6 → its first 64 bits,
 * because one customer line usually holds a whole /64 and could otherwise use a new address for every guess.
 */
export function addressKey(entry: string): string | null {
  let s = entry.trim().toLowerCase();
  if (s.length === 0 || s.length > 60) return null;
  const bracket = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(s);
  if (bracket) s = bracket[1]!;
  else if (/^[\d.]+:\d{1,5}$/.test(s)) s = s.slice(0, s.indexOf(":"));
  const v4 = ipv4Key(s);
  if (v4) return v4;
  const g = ipv6Groups(s);
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/**
 * Which bucket a sign-in attempt is counted in (D-78). With N trusted proxies the client is the Nth entry from the
 * right of X-Forwarded-For: the entries to its left came from the client and are ignored. Everything that cannot be
 * tied to an address (no trusted proxy configured, header missing or shorter than N, entry not an IP address) goes
 * to one shared bucket, so an unknown address never gets attempts of its own.
 */
export function clientKey(req: Request, hops: number = trustedProxyHops()): string {
  if (hops < 1) return SHARED_CLIENT;
  const entries = (req.headers.get("x-forwarded-for") ?? "").split(",");
  if (entries.length < hops) return SHARED_CLIENT;
  return addressKey(entries[entries.length - hops]!) ?? SHARED_CLIENT;
}

/** Sliding window of counted attempts for one bucket, in process (D-39). */
export class LoginLimiter {
  private failures: number[] = [];
  constructor(
    private readonly max = LOGIN_MAX_FAILURES,
    private readonly windowMs = LOGIN_WINDOW_MS,
  ) {}

  blocked(now: number = Date.now()): boolean {
    this.failures = this.failures.filter((t) => t > now - this.windowMs);
    return this.failures.length >= this.max;
  }

  fail(now: number = Date.now()) {
    this.failures.push(now);
  }

  /** Check and count in one step with nothing awaited in between: false when the bucket is full (D-76). */
  reserve(now: number = Date.now()): boolean {
    if (this.blocked(now)) return false;
    this.failures.push(now);
    return true;
  }

  /** Take back one attempt counted at `at` (the password was right, or it was never checked). */
  refund(at: number) {
    const i = this.failures.lastIndexOf(at);
    if (i >= 0) this.failures.splice(i, 1);
  }

  /** Attempts counted in the window right now. */
  count(now: number = Date.now()): number {
    this.failures = this.failures.filter((t) => t > now - this.windowMs);
    return this.failures.length;
  }

  idle(now: number = Date.now()): boolean {
    return this.count(now) === 0;
  }
}

export type LoginTicket =
  | { ok: false; reason: "locked" }
  | {
      ok: true;
      /** The bucket this attempt was counted in. */
      client: string;
      /** Resolves when the password may be checked: at once normally, after a wait while sign-in is slowed. Never refuses. */
      turn(): Promise<void>;
      /** Give the counted attempt back: the password was right, or the request ended before it was checked. */
      release(): void;
    };

export interface LoginGateOptions {
  max?: number;
  windowMs?: number;
  globalFree?: number;
  slowGapMs?: number;
  maxClients?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Sign-in limit (D-76, D-77), in process. `enter` counts the attempt against its client's bucket before anything is
 * awaited, so requests that arrive together cannot all slip under the limit; a full bucket refuses only that client.
 * Past `globalFree` counted attempts from all clients together, `turn` lines checks up one at a time, `slowGapMs`
 * apart, the client with the fewest counted attempts first: a slowdown for everyone, never a refusal. A client that
 * has not guessed before is therefore checked ahead of every client that has.
 */
export class LoginGate {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly globalFree: number;
  private readonly slowGapMs: number;
  private readonly maxClients: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clients = new Map<string, LoginLimiter>();
  private counted: number[] = [];
  private readonly queue: { limiter: LoginLimiter; go: () => void }[] = [];
  private pumping = false;
  private lastSlowAt = Number.NEGATIVE_INFINITY;

  constructor(o: LoginGateOptions = {}) {
    this.max = o.max ?? LOGIN_MAX_FAILURES;
    this.windowMs = o.windowMs ?? LOGIN_WINDOW_MS;
    this.globalFree = o.globalFree ?? LOGIN_GLOBAL_FREE;
    this.slowGapMs = o.slowGapMs ?? LOGIN_SLOW_GAP_MS;
    this.maxClients = o.maxClients ?? LOGIN_MAX_CLIENTS;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Buckets currently remembered (for tests and the memory bound). */
  get size(): number {
    return this.clients.size;
  }

  /** Attempts waiting for their turn while sign-in is slowed. */
  get waiting(): number {
    return this.queue.length;
  }

  /** Lets waiting attempts through one at a time, `slowGapMs` apart, fewest counted attempts first (ties: first come). */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const wait = this.lastSlowAt + this.slowGapMs - this.now();
        if (wait > 0) await this.sleep(wait);
        const now = this.now();
        let best = 0;
        for (let i = 1; i < this.queue.length; i++) if (this.queue[i]!.limiter.count(now) < this.queue[best]!.limiter.count(now)) best = i;
        const [next] = this.queue.splice(best, 1);
        this.lastSlowAt = now;
        next!.go();
      }
    } finally {
      this.pumping = false;
    }
  }

  private bucket(client: string, now: number): { name: string; limiter: LoginLimiter } {
    let name = client;
    let limiter = this.clients.get(name);
    if (!limiter && name !== SHARED_CLIENT && this.clients.size >= this.maxClients) {
      for (const [k, l] of this.clients) if (l.idle(now)) this.clients.delete(k);
      if (this.clients.size >= this.maxClients) {
        // Still full of addresses with live counts: an unknown newcomer is counted with the shared bucket.
        name = SHARED_CLIENT;
        limiter = this.clients.get(name);
      }
    }
    if (!limiter) {
      limiter = new LoginLimiter(this.max, this.windowMs);
      this.clients.set(name, limiter);
    }
    return { name, limiter };
  }

  /** Synchronous on purpose: call it before the first `await` of the request. */
  enter(client: string): LoginTicket {
    const at = this.now();
    this.counted = this.counted.filter((t) => t > at - this.windowMs);
    const { name, limiter } = this.bucket(client, at);
    if (!limiter.reserve(at)) return { ok: false, reason: "locked" };
    this.counted.push(at);
    let held = true;
    let turned = false;
    const release = () => {
      if (!held) return;
      held = false;
      limiter.refund(at);
      const i = this.counted.lastIndexOf(at);
      if (i >= 0) this.counted.splice(i, 1);
      if (this.clients.get(name) === limiter && limiter.idle(this.now())) this.clients.delete(name);
    };
    const turn = async (): Promise<void> => {
      if (!held || turned) return;
      turned = true;
      const now = this.now();
      this.counted = this.counted.filter((t) => t > now - this.windowMs);
      if (this.counted.length <= this.globalFree) return;
      await new Promise<void>((go) => {
        this.queue.push({ limiter, go });
        void this.pump();
      });
    };
    return { ok: true, client: name, turn, release };
  }
}

const LIMITER_KEY = Symbol.for("crawlspace.operator.limiter");
export function loginGate(): LoginGate {
  const g = globalThis as { [LIMITER_KEY]?: LoginGate };
  g[LIMITER_KEY] ??= new LoginGate();
  return g[LIMITER_KEY];
}

/** For route handlers: 404 when disabled, 401 without a valid session, 403 cross-origin POST, else null (go on). */
export function guardOperator(req: Request, cfg: OperatorConfig = operatorConfig()): Response | null {
  if (!cfg.enabled) return Response.json({ error: "not found" }, { status: 404 });
  if (req.method !== "GET" && !sameOrigin(req)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  if (!verifyToken(cfg, cookieValue(req.headers.get("cookie"), OPERATOR_COOKIE))) return Response.json({ error: "sign in first" }, { status: 401 });
  return null;
}
