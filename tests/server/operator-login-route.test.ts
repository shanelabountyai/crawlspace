import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/operator/login/route";
import { guardOperator, LOGIN_MAX_FAILURES, OPERATOR_COOKIE } from "@/server/operator-auth";

// The login route itself, driven the way the server drives it (Phase 4 review items 1, 2, 5 and 7; D-76..D-79).
// Each test starts like a freshly started process: no counted attempts, no signing key.
const PASSWORD = "correct horse battery";
const HOPS = "CRAWLSPACE_TRUSTED_PROXY_HOPS";
const saved = { password: process.env.CRAWLSPACE_OPERATOR_PASSWORD, hops: process.env[HOPS] };

function freshProcess() {
  const g = globalThis as Record<symbol, unknown>;
  delete g[Symbol.for("crawlspace.operator.limiter")];
  delete g[Symbol.for("crawlspace.operator.session-key")];
}

beforeEach(() => {
  process.env.CRAWLSPACE_OPERATOR_PASSWORD = PASSWORD;
  delete process.env[HOPS];
  freshProcess();
});

afterAll(() => {
  for (const [k, v] of [["CRAWLSPACE_OPERATOR_PASSWORD", saved.password], [HOPS, saved.hops]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  freshProcess();
});

type Opts = { xff?: string; form?: boolean; https?: boolean };
function login(password: string, { xff, form, https }: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { host: "app.local", "content-type": form ? "application/x-www-form-urlencoded" : "application/json" };
  if (xff !== undefined) headers["x-forwarded-for"] = xff;
  if (https) headers["x-forwarded-proto"] = "https";
  const body = form ? new URLSearchParams({ password }).toString() : JSON.stringify({ password });
  return POST(new Request("http://app.local/api/operator/login", { method: "POST", headers, body }));
}
const statuses = async (rs: Promise<Response>[]) => (await Promise.all(rs)).map((r) => r.status);
const count = (xs: number[], s: number) => xs.filter((x) => x === s).length;
const token = (res: Response) => new RegExp(`^${OPERATOR_COOKIE}=([^;]+)`).exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null;
const signedIn = (t: string) => guardOperator(new Request("http://app.local/api/operator/export/scans", { headers: { host: "app.local", cookie: `${OPERATOR_COOKIE}=${t}` } })) === null;

describe("login route: the limit holds for requests that arrive together (review item 1, D-76)", () => {
  it(`of 40 wrong passwords sent at once, ${LOGIN_MAX_FAILURES} are checked and the rest are refused unchecked`, async () => {
    const got = await statuses(Array.from({ length: 40 }, (_, i) => login(`wrong password ${i}`)));
    expect(count(got, 401)).toBe(LOGIN_MAX_FAILURES);
    expect(count(got, 429)).toBe(40 - LOGIN_MAX_FAILURES);
  });

  it("a guess that arrives in the same burst after the limit is not checked, even when it is the right password", async () => {
    const burst = [...Array.from({ length: 25 }, (_, i) => login(`wrong password ${i}`)), login(PASSWORD)];
    const res = await Promise.all(burst);
    expect(count(res.map((r) => r.status), 401)).toBe(LOGIN_MAX_FAILURES);
    expect(res.at(-1)!.status).toBe(429);
    expect(res.at(-1)!.headers.get("set-cookie")).toBeNull();
  });

  it("form posts sent at once are held to the same limit", async () => {
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => login(`wrong password ${i}`, { form: true })));
    const to = res.map((r) => r.headers.get("location"));
    expect(to.filter((l) => l === "/operator?error=wrong")).toHaveLength(LOGIN_MAX_FAILURES);
    expect(to.filter((l) => l === "/operator?error=locked")).toHaveLength(30 - LOGIN_MAX_FAILURES);
  });

  it("a request whose body cannot be read is not counted as a wrong password", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES + 5; i++) {
      const res = await POST(new Request("http://app.local/api/operator/login", { method: "POST", headers: { host: "app.local", "content-type": "application/json" }, body: "{not json" }));
      expect(res.status).toBe(400);
    }
    expect((await login(PASSWORD)).status).toBe(200);
  });
});

describe("login route: the 429 path (review item 7, first half)", () => {
  it(`after ${LOGIN_MAX_FAILURES} wrong passwords the next attempt gets 429 (JSON) or a redirect to ?error=locked (form), and no cookie`, async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await login(`wrong password ${i}`)).status).toBe(401);
    const json = await login("wrong password again");
    expect(json.status).toBe(429);
    expect(await json.json()).toEqual({ error: "too many attempts; wait 15 minutes" });
    expect(json.headers.get("set-cookie")).toBeNull();
    const form = await login("wrong password again", { form: true });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/operator?error=locked");
    expect(form.headers.get("set-cookie")).toBeNull();
  });

  it("while an address is locked, its guesses are not checked: the right password from that same address gets 429 too", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await login(`wrong password ${i}`);
    const res = await login(PASSWORD);
    expect(res.status).toBe(429);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a right password is not counted: signing in many times never locks", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES * 3; i++) expect((await login(PASSWORD)).status).toBe(200);
  });
});

describe("login route: someone else's wrong passwords do not lock the operator out (review item 2, D-77, D-78)", () => {
  const ATTACKER = "203.0.113.9";
  const OPERATOR = "198.51.100.7";

  it("with one trusted proxy, an address that used up its attempts is locked and another address still signs in", async () => {
    process.env[HOPS] = "1";
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await login(`wrong password ${i}`, { xff: ATTACKER })).status).toBe(401);
    expect((await login("one more", { xff: ATTACKER })).status).toBe(429);
    const res = await login(PASSWORD, { xff: OPERATOR });
    expect(res.status).toBe(200);
    expect(token(res)).not.toBeNull();
    // The attacker stays locked after the operator signed in.
    expect((await login("one more", { xff: ATTACKER })).status).toBe(429);
  });

  it("many addresses that each used up their attempts do not lock a different address", async () => {
    process.env[HOPS] = "1";
    for (let a = 1; a <= 4; a++) for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await login(`wrong password ${i}`, { xff: `203.0.113.${a}` });
    expect((await login(PASSWORD, { xff: OPERATOR })).status).toBe(200);
  });

  it("only the entry the proxy wrote counts: a made-up address in front of it neither frames the operator nor buys more attempts", async () => {
    process.env[HOPS] = "1";
    // The attacker sends `X-Forwarded-For: <anything>`; the proxy appends the address it really saw.
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await login(`wrong password ${i}`, { xff: `${i % 2 ? OPERATOR : `192.0.2.${i}`}, ${ATTACKER}` })).status).toBe(401);
    expect((await login("one more", { xff: `192.0.2.200, ${ATTACKER}` })).status).toBe(429);
    expect((await login(PASSWORD, { xff: OPERATOR })).status).toBe(200);
  });

  it("with two trusted proxies the second entry from the right is the client", async () => {
    process.env[HOPS] = "2";
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await login(`wrong password ${i}`, { xff: `192.0.2.${i}, ${ATTACKER}, 10.0.0.1` });
    expect((await login("one more", { xff: `${ATTACKER}, 10.0.0.1` })).status).toBe(429);
    expect((await login(PASSWORD, { xff: `${OPERATOR}, 10.0.0.1` })).status).toBe(200);
  });

  it("no trusted proxy configured (the default): the header is ignored, so varying it buys no extra attempts", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await login(`wrong password ${i}`, { xff: `192.0.2.${i}` })).status).toBe(401);
    expect((await login("one more", { xff: "192.0.2.99" })).status).toBe(429);
    expect((await login(PASSWORD, { xff: OPERATOR })).status).toBe(429);
  });

  it("header missing, too short or not an address: those requests share one bucket, and a well-formed address is not locked by it", async () => {
    process.env[HOPS] = "2";
    const odd = [undefined, "", "203.0.113.9", "not-an-address, 10.0.0.1", "999.1.1.1, 10.0.0.1", "<script>, 10.0.0.1", ", 10.0.0.1", "1.2.3.4.5, 10.0.0.1", "12345::1::2, 10.0.0.1", "203.0.113.9:x, 10.0.0.1"];
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await login(`wrong password ${i}`, { xff: odd[i % odd.length] })).status).toBe(401);
    expect((await login("one more", { xff: undefined })).status).toBe(429);
    expect((await login("one more", { xff: "garbage, 10.0.0.1" })).status).toBe(429);
    expect((await login(PASSWORD, { xff: `${OPERATOR}, 10.0.0.1` })).status).toBe(200);
  });

  it("the same address written differently is one client (port, IPv4-mapped IPv6, IPv6 inside one /64)", async () => {
    process.env[HOPS] = "1";
    const v4 = ["203.0.113.9", "203.0.113.9:51234", "::ffff:203.0.113.9", "[::ffff:203.0.113.9]:443", " 203.0.113.9 "];
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await login(`wrong password ${i}`, { xff: v4[i % v4.length] })).status).toBe(401);
    expect((await login("one more", { xff: "::FFFF:203.0.113.9" })).status).toBe(429);
    const v6 = ["2001:db8:1:2::1", "2001:DB8:1:2:ffff:ffff:ffff:ffff", "[2001:db8:1:2::abcd]:8443", "2001:0db8:0001:0002:0000:0000:0000:0001"];
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await login(`wrong password ${i}`, { xff: v6[i % v6.length] })).status).toBe(401);
    expect((await login("one more", { xff: "2001:db8:1:2:9::9" })).status).toBe(429);
    expect((await login(PASSWORD, { xff: "2001:db8:1:3::1" })).status).toBe(200);
  });
});

describe("login route: the cookie does not let anyone test password guesses offline (review item 5, D-79)", () => {
  it("the token cannot be recomputed from the password: the old password-keyed formula does not match", async () => {
    const t = token(await login(PASSWORD))!;
    const [exp, sig] = t.split(".");
    expect(sig).not.toBe(createHmac("sha256", PASSWORD).update(`crawlspace-operator-v1:${exp}`).digest("base64url"));
  });

  it("the token depends on a key that lives only in the running process: after a restart the same cookie is refused", async () => {
    const t = token(await login(PASSWORD))!;
    expect(signedIn(t)).toBe(true);
    freshProcess(); // same password, new process
    expect(signedIn(t)).toBe(false);
    const again = token(await login(PASSWORD))!;
    expect(signedIn(again)).toBe(true);
  });

  it("changing the password signs everyone out (D-39)", async () => {
    const t = token(await login(PASSWORD))!;
    process.env.CRAWLSPACE_OPERATOR_PASSWORD = "a different password";
    expect(signedIn(t)).toBe(false);
    process.env.CRAWLSPACE_OPERATOR_PASSWORD = PASSWORD;
    expect(signedIn(t)).toBe(true);
  });

  it("cookie flags: HttpOnly, SameSite=Strict, Path=/, 12 h; Secure when the request came over HTTPS", async () => {
    const plain = (await login(PASSWORD)).headers.get("set-cookie")!;
    expect(plain).toMatch(new RegExp(`^${OPERATOR_COOKIE}=\\d+\\.[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200$`));
    const https = (await login(PASSWORD, { https: true, form: true })).headers.get("set-cookie")!;
    expect(https).toMatch(/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
  });

  it("a cookie value sent by the client before signing in is never adopted as the session", async () => {
    const planted = "9999999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const res = await POST(
      new Request("http://app.local/api/operator/login", { method: "POST", headers: { host: "app.local", "content-type": "application/json", cookie: `${OPERATOR_COOKIE}=${planted}` }, body: JSON.stringify({ password: PASSWORD }) }),
    );
    expect(res.status).toBe(200);
    expect(token(res)).not.toBe(planted);
    expect(signedIn(planted)).toBe(false);
  });
});
