import { describe, expect, it } from "vitest";
import {
  checkPassword,
  clearCookie,
  cookieValue,
  guardOperator,
  issueToken,
  LOGIN_MAX_FAILURES,
  LoginLimiter,
  MIN_PASSWORD_LENGTH,
  OPERATOR_COOKIE,
  operatorConfig,
  sameOrigin,
  SESSION_MS,
  sessionCookie,
  verifyToken,
  type OperatorConfig,
} from "@/server/operator-auth";

const cfg = operatorConfig({ CRAWLSPACE_OPERATOR_PASSWORD: "correct horse battery" } as unknown as NodeJS.ProcessEnv) as Extract<OperatorConfig, { enabled: true }>;

describe("operator access (D-39)", () => {
  it("disabled without a password or with one shorter than 12 characters", () => {
    expect(operatorConfig({} as unknown as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(operatorConfig({ CRAWLSPACE_OPERATOR_PASSWORD: "x".repeat(MIN_PASSWORD_LENGTH - 1) } as unknown as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(operatorConfig({ CRAWLSPACE_OPERATOR_PASSWORD: "x".repeat(MIN_PASSWORD_LENGTH) } as unknown as NodeJS.ProcessEnv).enabled).toBe(true);
  });

  it("checks the password exactly", () => {
    expect(checkPassword(cfg, "correct horse battery")).toBe(true);
    for (const bad of ["correct horse batter", "correct horse battery ", "", undefined, 1, ["correct horse battery"]]) expect(checkPassword(cfg, bad)).toBe(false);
    expect(checkPassword({ enabled: false, reason: "" }, "")).toBe(false);
  });

  it("a token verifies until it expires", () => {
    const now = 1_800_000_000_000;
    const t = issueToken(cfg, now);
    expect(verifyToken(cfg, t, now + 1)).toBe(true);
    expect(verifyToken(cfg, t, now + SESSION_MS - 1)).toBe(true);
    expect(verifyToken(cfg, t, now + SESSION_MS)).toBe(false);
  });

  it("tampered, malformed or foreign tokens fail; changing the password signs everyone out", () => {
    const now = 1_800_000_000_000;
    const t = issueToken(cfg, now);
    const [exp, sig] = t.split(".");
    expect(verifyToken(cfg, `${Number(exp) + 999_999}.${sig}`, now)).toBe(false);
    // Swap the last and the first character of the signature for one that is guaranteed to differ. A fixed "A" left the
    // token unchanged, and so valid, whenever the signature already ended in "A": about 1 run in 16 (D-124, D-126).
    const other64 = (c: string) => (c === "A" ? "B" : "A");
    const tamperedLast = `${exp}.${sig!.slice(0, -1)}${other64(sig!.at(-1)!)}`;
    const tamperedFirst = `${exp}.${other64(sig![0]!)}${sig!.slice(1)}`;
    expect(tamperedLast).not.toBe(t);
    expect(tamperedFirst).not.toBe(t);
    expect(verifyToken(cfg, tamperedLast, now)).toBe(false);
    expect(verifyToken(cfg, tamperedFirst, now)).toBe(false);
    for (const bad of ["", ".", "abc", `${exp}.`, `.${sig}`, "1e99.x", null, undefined]) expect(verifyToken(cfg, bad as string, now)).toBe(false);
    const other = operatorConfig({ CRAWLSPACE_OPERATOR_PASSWORD: "a different password" } as unknown as NodeJS.ProcessEnv);
    expect(verifyToken(other, t, now)).toBe(false);
    expect(verifyToken({ enabled: false, reason: "" }, t, now)).toBe(false);
  });

  it("session cookie is HttpOnly + SameSite=Strict, Secure on https; cookies parse", () => {
    expect(sessionCookie("v", false)).toBe(`${OPERATOR_COOKIE}=v; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`);
    expect(sessionCookie("v", true)).toMatch(/; Secure$/);
    expect(clearCookie(false)).toMatch(/Max-Age=0/);
    expect(cookieValue("a=1; cs_op=12.ab%3D; b=2", OPERATOR_COOKIE)).toBe("12.ab=");
    expect(cookieValue(null, OPERATOR_COOKIE)).toBeNull();
    expect(cookieValue("xcs_op=1", OPERATOR_COOKIE)).toBeNull();
  });

  it(`locks login after ${LOGIN_MAX_FAILURES} failures in 15 minutes`, () => {
    const l = new LoginLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      expect(l.blocked(t0)).toBe(false);
      l.fail(t0);
    }
    expect(l.blocked(t0 + 1)).toBe(true);
    expect(l.blocked(t0 + 15 * 60_000 + 1)).toBe(false);
  });

  it("refuses cross-origin POSTs", () => {
    const req = (origin?: string) => new Request("http://app.local/api/operator/x", { method: "POST", headers: { host: "app.local", ...(origin ? { origin } : {}) } });
    expect(sameOrigin(req())).toBe(true);
    expect(sameOrigin(req("http://app.local"))).toBe(true);
    expect(sameOrigin(req("https://evil.example"))).toBe(false);
    expect(sameOrigin(req("null"))).toBe(false);
  });

  it("guardOperator: 404 disabled, 401 without a session, 403 cross-origin, null when signed in", () => {
    const now = Date.now();
    const signed = `${OPERATOR_COOKIE}=${issueToken(cfg, now)}`;
    const get = (cookie?: string) => new Request("http://app.local/api/operator/export/scans", { headers: { host: "app.local", ...(cookie ? { cookie } : {}) } });
    expect(guardOperator(get(signed), { enabled: false, reason: "" })!.status).toBe(404);
    expect(guardOperator(get(), cfg)!.status).toBe(401);
    expect(guardOperator(get(`${OPERATOR_COOKIE}=nope`), cfg)!.status).toBe(401);
    expect(guardOperator(get(signed), cfg)).toBeNull();
    const cross = new Request("http://app.local/api/operator/scans/x/rerun", { method: "POST", headers: { host: "app.local", origin: "https://evil.example", cookie: signed } });
    expect(guardOperator(cross, cfg)!.status).toBe(403);
  });
});
