import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Operator access (PRD §2/§6: password env var, no accounts; D-39). The session cookie holds an expiry and an
 * HMAC-SHA256 of it keyed by the password, so nothing is stored server side and changing the password signs
 * everyone out. Unset or short password → the operator page is disabled.
 */
export const OPERATOR_COOKIE = "cs_op";
export const MIN_PASSWORD_LENGTH = 12;
export const SESSION_MS = 12 * 3_600_000;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_FAILURES = 10;

export type OperatorConfig = { enabled: true; password: string } | { enabled: false; reason: string };

export function operatorConfig(env: NodeJS.ProcessEnv = process.env): OperatorConfig {
  const password = env.CRAWLSPACE_OPERATOR_PASSWORD ?? "";
  if (!password) return { enabled: false, reason: "CRAWLSPACE_OPERATOR_PASSWORD is not set" };
  if (password.length < MIN_PASSWORD_LENGTH) return { enabled: false, reason: `CRAWLSPACE_OPERATOR_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters` };
  return { enabled: true, password };
}

const mac = (password: string, msg: string) => createHmac("sha256", password).update(`crawlspace-operator-v1:${msg}`).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  // Compare fixed-length digests so neither content nor length leaks through timing.
  const da = createHmac("sha256", "cmp").update(a).digest();
  const db = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}

export function checkPassword(cfg: OperatorConfig, attempt: unknown): boolean {
  return cfg.enabled && typeof attempt === "string" && safeEqual(attempt, cfg.password);
}

export function issueToken(cfg: Extract<OperatorConfig, { enabled: true }>, now: number = Date.now()): string {
  const exp = String(now + SESSION_MS);
  return `${exp}.${mac(cfg.password, exp)}`;
}

export function verifyToken(cfg: OperatorConfig, token: string | undefined | null, now: number = Date.now()): boolean {
  if (!cfg.enabled || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  if (!/^\d{1,16}$/.test(exp) || Number(exp) <= now) return false;
  return safeEqual(token.slice(dot + 1), mac(cfg.password, exp));
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

/** Failed-login limiter, in process (D-39). */
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

const LIMITER_KEY = Symbol.for("crawlspace.operator.limiter");
export function loginLimiter(): LoginLimiter {
  const g = globalThis as { [LIMITER_KEY]?: LoginLimiter };
  g[LIMITER_KEY] ??= new LoginLimiter();
  return g[LIMITER_KEY];
}

/** For route handlers: 404 when disabled, 401 without a valid session, 403 cross-origin POST, else null (go on). */
export function guardOperator(req: Request, cfg: OperatorConfig = operatorConfig()): Response | null {
  if (!cfg.enabled) return Response.json({ error: "not found" }, { status: 404 });
  if (req.method !== "GET" && !sameOrigin(req)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  if (!verifyToken(cfg, cookieValue(req.headers.get("cookie"), OPERATOR_COOKIE))) return Response.json({ error: "sign in first" }, { status: 401 });
  return null;
}
