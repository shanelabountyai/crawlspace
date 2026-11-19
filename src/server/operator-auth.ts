import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Operator access (PRD §2/§6: password env var, no accounts; D-39, D-76..D-80).
 *
 * Session cookie: an expiry plus an HMAC-SHA256 of it, keyed by 32 random bytes that exist only in the running
 * process (D-79). Nothing in the cookie can be recomputed from the password, so a copied cookie gives no way to test
 * password guesses offline. Nothing is stored per session; a restart signs the operator out, and so does changing
 * the password. Unset or short password → the operator page is disabled.
 *
 * Sign-in limit (D-76, D-77): wrong passwords are counted per client address. The check "is this address full?", the
 * password comparison and the count happen in one synchronous step after the body has been read, so requests that
 * arrive together cannot all slip under the limit, and a request that never sends a password takes nothing. The
 * address comes from X-Forwarded-For only when CRAWLSPACE_TRUSTED_PROXY_HOPS says how many proxies in front of the
 * app write to it; otherwise every request shares one bucket (D-78).
 */
export const OPERATOR_COOKIE = "cs_op";
export const MIN_PASSWORD_LENGTH = 12;
export const SESSION_MS = 12 * 3_600_000;
export const LOGIN_WINDOW_MS = 15 * 60_000;
/** Wrong passwords one client address may have counted against it inside the window. */
export const LOGIN_MAX_FAILURES = 10;
/** Wrong passwords from all addresses together inside the window before sign-in slows down. */
export const LOGIN_GLOBAL_FREE = 50;
/** While slowed, passwords are checked one at a time, this far apart. */
export const LOGIN_SLOW_GAP_MS = 1_000;
/** While slowed, at most this many requests wait for their turn. */
export const LOGIN_MAX_WAITING = 30;
/** While slowed, a request that has waited this long is told to try again instead of being kept open. */
export const LOGIN_MAX_WAIT_MS = 30_000;
/** A sign-in request body larger than this is refused unread. */
export const LOGIN_MAX_BODY_BYTES = 8_192;
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

/** Sign-out: a new key, so every cookie issued so far stops working, copies included (D-79). There is one operator. */
export function endAllSessions(): void {
  (globalThis as { [KEY_SYMBOL]?: Buffer })[KEY_SYMBOL] = randomBytes(32);
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
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null; // a value that is not valid percent-encoding is no session
      }
    }
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

/**
 * The wider network an address sits in: IPv4 /24, IPv6 /56. Used only to order the line while sign-in is slowed
 * (D-77), never for the per-address limit: one holder of a block cannot pose as many unrelated newcomers.
 */
export function networkOf(client: string): string {
  if (client === SHARED_CLIENT) return SHARED_CLIENT;
  if (client.endsWith("::/64")) {
    const g = client.split(":");
    return `${g.slice(0, 3).join(":")}:${(parseInt(g[3]!, 16) & 0xff00).toString(16)}::/56`;
  }
  return `${client.split(".").slice(0, 3).join(".")}.0/24`;
}

/** Failed-login window for one bucket, in process (D-39). Kept as the simple building block it was; `LoginGate` is what the route uses. */
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
}

/** Permission to check one password, from `LoginGate.turn`. Used once. */
export interface LoginPass {
  readonly client: string;
}

export interface LoginGateOptions {
  max?: number;
  windowMs?: number;
  globalFree?: number;
  slowGapMs?: number;
  maxWaiting?: number;
  maxWaitMs?: number;
  /** A clock that never goes backwards (milliseconds). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type Waiter = { client: string; network: string; since: number; go: (granted: boolean) => void };
type Pass = LoginPass & { free: boolean; used: boolean };

/**
 * Sign-in limit, in process (D-76, D-77).
 *
 * - `attempt` is synchronous: "is this client full?", the password comparison and the count are one step, so
 *   requests that arrive together are settled one after another and no more than `max` wrong passwords per client are
 *   ever compared inside the window. A full client is refused without its password being looked at; other clients
 *   are not affected.
 * - `turn` hands out the permission to make that step. The first `globalFree` wrong passwords in the window (from
 *   all clients together) cost no wait. Past that, permissions are handed out one at a time, `slowGapMs` apart, to
 *   the waiting request whose network has the fewest wrong passwords counted (ties: first come). That bounds the
 *   total guessing rate whatever the number of addresses, and puts a newcomer ahead of everyone who has guessed.
 *   "Fewest" counts the network (IPv4 /24, IPv6 /56) and the requests from it already waiting, so one address or one
 *   block cannot fill the line. Only when more than `maxWaiting` requests wait, or one has waited `maxWaitMs`, is a
 *   waiting request told to come back (the one with the most behind it first); nothing is counted against it.
 *
 * Memory: one small record per counted wrong password in the window, and those are bounded by the two limits above;
 * at most `maxWaiting` waiting requests.
 */
export class LoginGate {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly globalFree: number;
  private readonly slowGapMs: number;
  private readonly maxWaiting: number;
  private readonly maxWaitMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private wrong: { at: number; client: string; network: string }[] = [];
  /** Free permissions handed out and not yet used (with the time they were given). */
  private freeOut: number[] = [];
  /** Turns handed out while slowed and not yet used: they count towards their network's place in the line. */
  private slowOut: { at: number; network: string }[] = [];
  private readonly queue: Waiter[] = [];
  private pumping = false;
  private lastSlowAt = Number.NEGATIVE_INFINITY;

  constructor(o: LoginGateOptions = {}) {
    this.max = o.max ?? LOGIN_MAX_FAILURES;
    this.windowMs = o.windowMs ?? LOGIN_WINDOW_MS;
    this.globalFree = o.globalFree ?? LOGIN_GLOBAL_FREE;
    this.slowGapMs = o.slowGapMs ?? LOGIN_SLOW_GAP_MS;
    this.maxWaiting = o.maxWaiting ?? LOGIN_MAX_WAITING;
    this.maxWaitMs = o.maxWaitMs ?? LOGIN_MAX_WAIT_MS;
    this.now = o.now ?? (() => performance.now());
    this.sleep = o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private prune(now: number) {
    if (this.wrong.length > 0 && this.wrong[0]!.at <= now - this.windowMs) this.wrong = this.wrong.filter((w) => w.at > now - this.windowMs);
    // A free permission that was never used (the request died) stops counting after the longest a request may wait.
    if (this.freeOut.length > 0 && this.freeOut[0]! <= now - this.maxWaitMs) this.freeOut = this.freeOut.filter((t) => t > now - this.maxWaitMs);
    if (this.slowOut.length > 0 && this.slowOut[0]!.at <= now - this.maxWaitMs) this.slowOut = this.slowOut.filter((o) => o.at > now - this.maxWaitMs);
  }

  /** Wrong passwords counted in the window: for one client, or for all. */
  count(client?: string): number {
    this.prune(this.now());
    return client === undefined ? this.wrong.length : this.wrong.filter((w) => w.client === client).length;
  }

  /** Requests waiting for their turn while sign-in is slowed. */
  get waiting(): number {
    return this.queue.length;
  }

  /** True when this client has used up its wrong passwords for the window. Counts nothing. */
  blocked(client: string): boolean {
    return this.count(client) >= this.max;
  }

  /** Wrong passwords counted for the waiter's network, plus its turns being used right now, plus its requests waiting ahead. */
  private rank(i: number): number {
    const network = this.queue[i]!.network;
    let n = 0;
    for (const w of this.wrong) if (w.network === network) n++;
    for (const o of this.slowOut) if (o.network === network) n++;
    for (let j = 0; j < i; j++) if (this.queue[j]!.network === network) n++;
    return n;
  }

  /** Send away, uncounted, every waiting request for which `gone` is true. */
  private dismiss(gone: (w: Waiter) => boolean) {
    for (let i = this.queue.length - 1; i >= 0; i--) if (gone(this.queue[i]!)) this.queue.splice(i, 1)[0]!.go(false);
  }

  /** Index of the waiting request to serve next (`best`) or to send away first (`!best`). */
  private pick(best: boolean): number {
    let at = 0;
    let rank = this.rank(0);
    for (let i = 1; i < this.queue.length; i++) {
      const r = this.rank(i);
      // Serve: lowest rank, earliest arrival. Send away: highest rank, latest arrival.
      if (best ? r < rank : r >= rank) {
        at = i;
        rank = r;
      }
    }
    return at;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const wait = this.lastSlowAt + this.slowGapMs - this.now();
        if (wait > 0) await this.sleep(wait);
        const now = this.now();
        this.prune(now);
        // No turn is spent on a request that has waited too long or whose address has filled up in the meantime.
        this.dismiss((w) => now - w.since >= this.maxWaitMs || this.blocked(w.client));
        if (this.queue.length === 0) break;
        const [next] = this.queue.splice(this.pick(true), 1);
        this.lastSlowAt = now;
        this.slowOut.push({ at: now, network: next!.network });
        next!.go(true);
      }
    } finally {
      this.pumping = false;
    }
  }

  /**
   * Resolves with a pass when this request may have its password checked, or null when sign-in is slowed and the
   * request should come back later (see the class comment). Call it after the body has been read.
   */
  async turn(client: string): Promise<LoginPass | null> {
    const now = this.now();
    this.prune(now);
    if (this.wrong.length + this.freeOut.length < this.globalFree) {
      this.freeOut.push(now);
      return { client, free: true, used: false } as Pass;
    }
    const granted = await new Promise<boolean>((go) => {
      this.queue.push({ client, network: networkOf(client), since: now, go });
      if (this.queue.length > this.maxWaiting) this.queue.splice(this.pick(false), 1)[0]!.go(false);
      void this.pump();
    });
    return granted ? ({ client, free: false, used: false } as Pass) : null;
  }

  /**
   * One synchronous step: refuse a full client unchecked, otherwise run `check` once and count a wrong answer.
   * Nothing is awaited between the three, which is what makes the limit hold for requests that arrive together.
   */
  attempt(pass: LoginPass, check: () => boolean): "right" | "wrong" | "locked" {
    const p = pass as Pass;
    if (p.used) return "locked";
    p.used = true;
    if (p.free) this.freeOut.shift();
    else {
      const network = networkOf(p.client);
      const i = this.slowOut.findIndex((o) => o.network === network);
      if (i >= 0) this.slowOut.splice(i, 1);
    }
    if (this.blocked(p.client)) return "locked";
    if (check()) return "right";
    this.wrong.push({ at: this.now(), client: p.client, network: networkOf(p.client) });
    return "wrong";
  }
}

const LIMITER_KEY = Symbol.for("crawlspace.operator.limiter");
export function loginGate(): LoginGate {
  const g = globalThis as { [LIMITER_KEY]?: LoginGate };
  g[LIMITER_KEY] ??= new LoginGate();
  return g[LIMITER_KEY];
}

/**
 * Read at most `max` bytes of a request body. Null when it is longer (by its Content-Length, or by what arrives) or
 * cannot be read: nothing larger than a password form is ever buffered or hashed.
 */
export async function readSmallBody(req: Request, max: number = LOGIN_MAX_BODY_BYTES): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d{1,15}$/.test(declared) || Number(declared) > max)) return null;
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(new ArrayBuffer(size));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** For route handlers: 404 when disabled, 401 without a valid session, 403 cross-origin POST, else null (go on). */
export function guardOperator(req: Request, cfg: OperatorConfig = operatorConfig()): Response | null {
  if (!cfg.enabled) return Response.json({ error: "not found" }, { status: 404 });
  if (req.method !== "GET" && !sameOrigin(req)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  if (!verifyToken(cfg, cookieValue(req.headers.get("cookie"), OPERATOR_COOKIE))) return Response.json({ error: "sign in first" }, { status: 401 });
  return null;
}
