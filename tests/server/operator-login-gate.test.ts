import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as clientAddress } from "@/app/api/operator/client-address/route";
import { POST } from "@/app/api/operator/login/route";
import { POST as logout } from "@/app/api/operator/logout/route";
import {
  addressKey,
  clientKey,
  cookieValue,
  guardOperator,
  issueToken,
  LOGIN_GLOBAL_FREE,
  LOGIN_MAX_BODY_BYTES,
  LOGIN_MAX_FAILURES,
  LOGIN_MAX_WAIT_MS,
  LOGIN_MAX_WAITING,
  LOGIN_SLOW_GAP_MS,
  LOGIN_WINDOW_MS,
  LoginGate,
  networkOf,
  OPERATOR_COOKIE,
  operatorConfig,
  readSmallBody,
  SHARED_CLIENT,
  trustedProxyHops,
  type OperatorConfig,
} from "@/server/operator-auth";

// The sign-in limit and the address it counts by (Phase 4 review items 1 and 2; D-76, D-77, D-78).
const env = (v?: string) => (v === undefined ? {} : { CRAWLSPACE_TRUSTED_PROXY_HOPS: v }) as unknown as NodeJS.ProcessEnv;
const req = (xff?: string) => new Request("http://app.local/api/operator/login", { method: "POST", headers: xff === undefined ? {} : { "x-forwarded-for": xff } });
/** Address number i, each in its own /24. */
const addr = (i: number) => `10.${i >> 8}.${i & 255}.1`;

/** A gate on a clock the test moves; `sleep` records the wait, moves the clock and returns. */
function gateOnClock(opts: ConstructorParameters<typeof LoginGate>[0] = {}) {
  const clock = { t: 1_000_000 };
  const sleeps: number[] = [];
  const checked: string[] = [];
  const gate = new LoginGate({
    ...opts,
    now: () => clock.t,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
  });
  /** One request from `client`: wait for a turn, then have the password checked. */
  const tryOnce = async (client: string, right = false, label = client) => {
    const pass = await gate.turn(client);
    if (!pass) return "busy" as const;
    return gate.attempt(pass, () => {
      checked.push(label);
      return right;
    });
  };
  return { gate, clock, sleeps, checked, tryOnce };
}

describe("LoginGate: check, compare and count are one step (D-76)", () => {
  it("of 40 permissions held at the same moment, only the limit get their password compared", async () => {
    const g = gateOnClock();
    const passes = await Promise.all(Array.from({ length: 40 }, () => g.gate.turn("a")));
    let compared = 0;
    const outcomes = passes.map((p) =>
      g.gate.attempt(p!, () => {
        compared++;
        return false;
      }),
    );
    expect(compared).toBe(LOGIN_MAX_FAILURES);
    expect(outcomes.filter((o) => o === "wrong")).toHaveLength(LOGIN_MAX_FAILURES);
    expect(outcomes.filter((o) => o === "locked")).toHaveLength(40 - LOGIN_MAX_FAILURES);
  });

  it("a permission is good for one check", async () => {
    const g = gateOnClock();
    const pass = (await g.gate.turn("a"))!;
    let compared = 0;
    const check = () => {
      compared++;
      return false;
    };
    expect(g.gate.attempt(pass, check)).toBe("wrong");
    expect(g.gate.attempt(pass, check)).toBe("locked");
    expect(compared).toBe(1);
    expect(g.gate.count("a")).toBe(1);
  });

  it("only wrong passwords are counted: right ones, and requests that never reach the check, take nothing", async () => {
    const g = gateOnClock();
    for (let i = 0; i < LOGIN_MAX_FAILURES * 5; i++) expect(await g.tryOnce("a", true)).toBe("right");
    for (let i = 0; i < 200; i++) await g.gate.turn("a"); // permission asked for, never used
    expect(g.gate.count()).toBe(0);
    expect(g.gate.blocked("a")).toBe(false);
  });
});

describe("LoginGate: one bucket per client (D-77)", () => {
  it(`a client is refused, unchecked, after ${LOGIN_MAX_FAILURES} wrong passwords in 15 minutes; other clients are not; the window slides`, async () => {
    const g = gateOnClock();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect(await g.tryOnce("203.0.113.9")).toBe("wrong");
    expect(g.gate.blocked("203.0.113.9")).toBe(true);
    expect(await g.tryOnce("203.0.113.9", true)).toBe("locked");
    expect(g.checked).toHaveLength(LOGIN_MAX_FAILURES);
    expect(await g.tryOnce("198.51.100.7", true)).toBe("right");
    g.clock.t += LOGIN_WINDOW_MS - 1;
    expect(await g.tryOnce("203.0.113.9", true)).toBe("locked");
    g.clock.t += 1;
    expect(await g.tryOnce("203.0.113.9", true)).toBe("right");
  });

  it("being refused is not counted, so it does not extend the lock", async () => {
    const g = gateOnClock();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await g.tryOnce("a");
    g.clock.t += LOGIN_WINDOW_MS - 10;
    for (let i = 0; i < 100; i++) expect(await g.tryOnce("a")).toBe("locked");
    g.clock.t += 10;
    expect(await g.tryOnce("a")).toBe("wrong");
  });

  it("what is remembered is bounded by what is checked: 20,000 addresses asking at once leave no record until a password is wrong", async () => {
    const g = gateOnClock();
    const passes = await Promise.all(Array.from({ length: 20_000 }, (_, i) => g.gate.turn(addr(i))));
    expect(g.gate.count()).toBe(0);
    expect(passes.filter((p) => p !== null).length).toBeLessThanOrEqual(LOGIN_GLOBAL_FREE + LOGIN_MAX_WAITING + 1);
  });
});

describe("LoginGate: a flood of wrong passwords from many addresses slows sign-in (D-77)", () => {
  /** `n` different networks, one wrong password each. */
  async function flood(g: ReturnType<typeof gateOnClock>, n: number) {
    for (let i = 0; i < n; i++) expect(await g.tryOnce(addr(i))).toBe("wrong");
  }

  it(`the first ${LOGIN_GLOBAL_FREE} wrong passwords in the window are checked at once`, async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    expect(g.sleeps).toEqual([]);
  });

  it(`requests that arrive together cannot all use the free allowance: at most ${LOGIN_GLOBAL_FREE} go through unslowed`, async () => {
    const g = gateOnClock({ maxWaiting: 1_000, maxWaitMs: 10_000_000 });
    const all = Array.from({ length: 200 }, (_, i) => g.tryOnce(addr(i)));
    expect((await Promise.all(all)).every((o) => o === "wrong")).toBe(true);
    // 150 had to wait in line; the first of them was let through at once, each of the other 149 after a full gap.
    expect(g.sleeps).toEqual(Array(200 - LOGIN_GLOBAL_FREE - 1).fill(LOGIN_SLOW_GAP_MS));
  });

  it(`after that, checks are let through one at a time, ${LOGIN_SLOW_GAP_MS} ms apart, in order of arrival`, async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    const started = g.clock.t;
    const turns = Array.from({ length: 6 }, (_, i) => g.tryOnce(addr(1_000 + i)));
    expect(g.gate.waiting).toBe(5); // the first went straight through; the other five wait
    await Promise.all(turns);
    expect(g.checked.slice(-6)).toEqual(Array.from({ length: 6 }, (_, i) => addr(1_000 + i)));
    // The gate waited one full gap before each of the five, on its own clock: nothing was let through early.
    expect(g.sleeps).toEqual(Array(5).fill(LOGIN_SLOW_GAP_MS));
    expect(g.clock.t - started).toBe(5 * LOGIN_SLOW_GAP_MS);
    expect(g.gate.waiting).toBe(0);
  });

  it("a newcomer goes ahead of addresses that have guessed before", async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    const turns = [g.tryOnce(addr(900)), g.tryOnce(addr(1)), g.tryOnce(addr(1)), g.tryOnce(addr(2)), g.tryOnce(addr(3))];
    turns.push(g.tryOnce("198.51.100.7", true, "operator"));
    const res = await Promise.all(turns);
    expect(res.at(-1)).toBe("right");
    // addr(900) was let through at once; the operator is the next one checked.
    expect(g.checked.slice(LOGIN_GLOBAL_FREE, LOGIN_GLOBAL_FREE + 2)).toEqual([addr(900), "operator"]);
  });

  it("one address cannot fill the line with fresh requests: only its first waits level with a newcomer", async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    const turns = [g.tryOnce(addr(900))]; // takes the immediate turn
    for (let i = 0; i < 8; i++) turns.push(g.tryOnce("203.0.113.9", false, "one-address")); // never guessed before, 8 at once
    turns.push(g.tryOnce("198.51.100.7", true, "operator"));
    expect((await Promise.all(turns)).at(-1)).toBe("right");
    expect(g.checked.slice(LOGIN_GLOBAL_FREE, LOGIN_GLOBAL_FREE + 3)).toEqual([addr(900), "one-address", "operator"]);
  });

  it("one block of addresses cannot pose as many newcomers: other addresses in an IPv6 /48 or IPv4 /24 that has guessed go behind", async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    const turns = [g.tryOnce(addr(900))];
    for (let i = 0; i < 6; i++) turns.push(g.tryOnce(`2001:db8:77:${i.toString(16)}::/64`, false, "block-v6"));
    for (let i = 2; i < 8; i++) turns.push(g.tryOnce(`203.0.113.${i}`, false, "block-v4"));
    turns.push(g.tryOnce("198.51.100.7", true, "operator"));
    expect((await Promise.all(turns)).at(-1)).toBe("right");
    // First of each block is level with the operator and arrived earlier; everything else from the blocks is behind.
    expect(g.checked.slice(LOGIN_GLOBAL_FREE, LOGIN_GLOBAL_FREE + 4)).toEqual([addr(900), "block-v6", "block-v4", "operator"]);
    expect(networkOf("2001:db8:77:5::/64")).toBe("2001:db8:77::/48");
    expect(networkOf("203.0.113.9")).toBe("203.0.113.0/24");
    expect(networkOf(SHARED_CLIENT)).toBe(SHARED_CLIENT);
  });

  it(`at most ${LOGIN_MAX_WAITING} requests wait; when the line is full the one with the most behind it is sent away, not the newcomer`, async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    const turns = [g.tryOnce(addr(900))];
    for (let i = 0; i < LOGIN_MAX_WAITING; i++) turns.push(g.tryOnce("203.0.113.9", false, "one-address"));
    expect(g.gate.waiting).toBe(LOGIN_MAX_WAITING);
    const operator = g.tryOnce("198.51.100.7", true, "operator");
    expect(g.gate.waiting).toBe(LOGIN_MAX_WAITING);
    expect(await operator).toBe("right");
    const res = await Promise.all(turns);
    expect(res.filter((o) => o === "busy").length).toBeGreaterThanOrEqual(1);
    // Sent-away and locked requests were never compared: the address still got no more than its limit.
    expect(g.checked.filter((c) => c === "one-address").length).toBeLessThanOrEqual(LOGIN_MAX_FAILURES);
  });

  it("the residual, stated plainly: when the line is full of newcomers from different networks, the next newcomer is told to try again", async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    const turns = [g.tryOnce(addr(900))];
    for (let i = 0; i < LOGIN_MAX_WAITING; i++) turns.push(g.tryOnce(addr(2_000 + i)));
    expect(await g.tryOnce("198.51.100.7", true, "operator")).toBe("busy");
    expect(g.gate.count("198.51.100.7")).toBe(0); // nothing counted against it
    await Promise.all(turns);
    expect(await g.tryOnce("198.51.100.7", true, "operator")).toBe("right"); // the line has drained
  });

  it(`nobody is kept waiting longer than ${LOGIN_MAX_WAIT_MS / 1000} s: a request overtaken for that long is told to try again, uncounted`, async () => {
    const g = gateOnClock({ maxWaiting: 1_000 });
    await flood(g, LOGIN_GLOBAL_FREE);
    const turns = [g.tryOnce(addr(900))];
    const repeat = g.tryOnce(addr(1), false, "repeat-guesser"); // has one wrong password already: behind every newcomer
    for (let i = 0; i < 40; i++) turns.push(g.tryOnce(addr(3_000 + i)));
    expect(await repeat).toBe("busy");
    expect(g.checked).not.toContain("repeat-guesser");
    await Promise.all(turns);
  });

  it("no turn is spent on an address that filled up while its requests were waiting", async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    const turns = Array.from({ length: 25 }, () => g.tryOnce("203.0.113.9", false, "one-address"));
    const res = await Promise.all(turns);
    expect(res.filter((o) => o === "wrong")).toHaveLength(LOGIN_MAX_FAILURES);
    expect(g.checked.filter((c) => c === "one-address")).toHaveLength(LOGIN_MAX_FAILURES);
    expect(g.sleeps.length).toBeLessThanOrEqual(LOGIN_MAX_FAILURES + 1);
  });

  it("with 300 networks flooding one after another, a new address is not locked and gets its turn", async () => {
    const g = gateOnClock();
    await flood(g, 300);
    expect(g.gate.blocked("198.51.100.7")).toBe(false);
    expect(await g.tryOnce("198.51.100.7", true)).toBe("right");
  });

  it("the slowdown ends when the flood's wrong passwords leave the window", async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE + 5);
    g.clock.t += LOGIN_WINDOW_MS + 1;
    const before = g.sleeps.length;
    expect(await g.tryOnce("198.51.100.7", true)).toBe("right");
    expect(g.sleeps.length).toBe(before);
    expect(g.gate.count()).toBe(0);
  });

  it("the default clock cannot go backwards (it is not the wall clock)", async () => {
    const real = Date.now;
    const gate = new LoginGate({ slowGapMs: 1, globalFree: 1 });
    try {
      for (let i = 0; i < 3; i++) gate.attempt((await gate.turn(addr(i)))!, () => false);
      Date.now = () => real() - 3_600_000; // the wall clock steps back an hour
      const t0 = performance.now();
      expect(await gate.turn("198.51.100.7")).not.toBeNull();
      expect(performance.now() - t0).toBeLessThan(1_000);
    } finally {
      Date.now = real;
    }
  });
});

describe("the sign-in body is small or it is not read (D-80)", () => {
  const body = (b: BodyInit, headers: Record<string, string> = {}) => new Request("http://app.local/api/operator/login", { method: "POST", headers, body: b });
  it("returns the bytes of a small body and null for one over the limit, declared or not", async () => {
    expect(new TextDecoder().decode((await readSmallBody(body("password=x")))!)).toBe("password=x");
    expect(await readSmallBody(body("x".repeat(LOGIN_MAX_BODY_BYTES)))).not.toBeNull();
    expect(await readSmallBody(body("x".repeat(LOGIN_MAX_BODY_BYTES + 1)))).toBeNull();
    expect(await readSmallBody(body("x", { "content-length": "999999999" }))).toBeNull();
    expect(await readSmallBody(body("x", { "content-length": "abc" }))).toBeNull();
    // No Content-Length (a stream): cut off once the limit is passed.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1_024));
      },
    });
    expect(await readSmallBody(new Request("http://app.local/x", { method: "POST", body: stream, duplex: "half" } as RequestInit))).toBeNull();
    expect(pulled).toBeLessThan(20);
    expect((await readSmallBody(new Request("http://app.local/x", { method: "POST" })))!.byteLength).toBe(0);
  });
});

describe("which address an attempt is counted under (D-78)", () => {
  it("CRAWLSPACE_TRUSTED_PROXY_HOPS: a whole number from 1 to 5; anything else means trust nothing", () => {
    expect(trustedProxyHops(env())).toBe(0);
    for (const [v, n] of [["1", 1], ["2", 2], ["5", 5], [" 3 ", 3]] as const) expect(trustedProxyHops(env(v))).toBe(n);
    for (const v of ["", "0", "6", "9", "10", "-1", "1.5", "one", "true", "1e0", "0x1", "１"]) expect(trustedProxyHops(env(v))).toBe(0);
  });

  it("trust nothing (the default): every request is counted in the shared bucket, whatever the header says", () => {
    for (const xff of [undefined, "203.0.113.9", "203.0.113.9, 10.0.0.1"]) expect(clientKey(req(xff), 0)).toBe(SHARED_CLIENT);
  });

  it("N trusted proxies: the Nth entry from the right; entries further left are the client's own words and are ignored", () => {
    expect(clientKey(req("203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientKey(req("1.1.1.1, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientKey(req("1.1.1.1, 2.2.2.2, 203.0.113.9, 10.0.0.1"), 2)).toBe("203.0.113.9");
    expect(clientKey(req("203.0.113.9,10.0.0.1,10.0.0.2"), 3)).toBe("203.0.113.9");
  });

  it("header missing, shorter than N, or the entry is not an IP address: the shared bucket", () => {
    expect(clientKey(req(), 1)).toBe(SHARED_CLIENT);
    expect(clientKey(req(""), 1)).toBe(SHARED_CLIENT);
    expect(clientKey(req("203.0.113.9"), 2)).toBe(SHARED_CLIENT);
    expect(clientKey(req("unknown, 10.0.0.1"), 2)).toBe(SHARED_CLIENT);
    expect(clientKey(req(", 10.0.0.1"), 2)).toBe(SHARED_CLIENT);
  });

  it("an address has one key however it is written; IPv6 is counted by its first 64 bits", () => {
    for (const s of ["203.0.113.9", " 203.0.113.9 ", "203.0.113.9:443", "::ffff:203.0.113.9", "::FFFF:CB00:7109", "[::ffff:203.0.113.9]:8080", "0:0:0:0:0:ffff:203.0.113.9"]) expect(addressKey(s), s).toBe("203.0.113.9");
    for (const s of ["2001:db8:1:2::1", "2001:DB8:1:2:a:b:c:d", "[2001:db8:1:2::1]:443", "[2001:db8:1:2::1]", "2001:0db8:0001:0002:0000:0000:0000:0001"]) expect(addressKey(s), s).toBe("2001:db8:1:2::/64");
    expect(addressKey("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(addressKey("::1")).toBe("0:0:0:0::/64");
    expect(addressKey("::")).toBe("0:0:0:0::/64");
    expect(addressKey("1::")).toBe("1:0:0:0::/64");
  });

  it("anything that is not an IP address has no key", () => {
    const bad = ["", " ", "unknown", "localhost", "256.1.1.1", "1.2.3", "1.2.3.4.5", "1.2.3.4:", "1.2.3.4:999999", "01.2.3.4567", "-1.2.3.4", "1.2.3.4/24", ":", ":::", "1::2::3", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7::8", "12345::1", "g::1", "fe80::1%eth0", "[::1", "::1]", "[1.2.3.4]:80x", "::ffff:999.1.1.1", "1.2.3.4, 5.6.7.8", "<b>", "x".repeat(200), "1".repeat(61)];
    for (const s of bad) expect(addressKey(s), JSON.stringify(s)).toBeNull();
  });
});

describe("through the route: flood, then the operator (D-77)", () => {
  const PASSWORD = "correct horse battery";
  const KEY = Symbol.for("crawlspace.operator.limiter");
  const g = globalThis as Record<symbol, unknown>;
  const saved = { password: process.env.CRAWLSPACE_OPERATOR_PASSWORD, hops: process.env.CRAWLSPACE_TRUSTED_PROXY_HOPS };
  const login = (password: string, xff: string) =>
    POST(new Request("http://app.local/api/operator/login", { method: "POST", headers: { host: "app.local", "content-type": "application/json", "x-forwarded-for": xff }, body: JSON.stringify({ password }) }));

  beforeEach(() => {
    process.env.CRAWLSPACE_OPERATOR_PASSWORD = PASSWORD;
    process.env.CRAWLSPACE_TRUSTED_PROXY_HOPS = "1";
    g[KEY] = new LoginGate({ slowGapMs: 3 }); // the real gate with a short gap, so the test does not wait seconds
  });
  afterAll(() => {
    delete g[KEY];
    for (const [k, v] of [["CRAWLSPACE_OPERATOR_PASSWORD", saved.password], ["CRAWLSPACE_TRUSTED_PROXY_HOPS", saved.hops]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("70 networks have sent wrong passwords, then 20 requests from one of them and the operator's right password arrive together: the operator signs in", async () => {
    for (let i = 0; i < 70; i++) expect((await login(`wrong password ${i}`, `203.${i}.113.1`)).status).toBe(401);
    const burst = Array.from({ length: 20 }, (_, i) => login(`more ${i}`, "203.1.113.1"));
    const mine = await login(PASSWORD, "198.51.100.7");
    expect(mine.status).toBe(200);
    expect(mine.headers.get("set-cookie")).toMatch(new RegExp(`^${OPERATOR_COOKIE}=`));
    const res = await Promise.all(burst);
    // That address had 1 wrong password counted: 9 more are checked, the rest are refused unchecked.
    expect(res.filter((r) => r.status === 401)).toHaveLength(LOGIN_MAX_FAILURES - 1);
    expect(res.filter((r) => r.status === 429)).toHaveLength(20 - (LOGIN_MAX_FAILURES - 1));
  });

  it("a request sent away from a full line gets 429 'busy' (JSON) or a redirect to ?error=busy (form), and no cookie", async () => {
    g[KEY] = new LoginGate({ slowGapMs: 40, maxWaiting: 2 });
    for (let i = 0; i < LOGIN_GLOBAL_FREE; i++) await login(`wrong password ${i}`, `203.${i}.113.1`);
    const form = (xff: string) =>
      POST(new Request("http://app.local/api/operator/login", { method: "POST", headers: { host: "app.local", "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": xff }, body: "password=nope-nope-nope" }));
    const held = [login("w", "192.0.2.1"), login("w", "192.0.3.1"), login("w", "192.0.4.1")]; // one through, two waiting
    await new Promise((r) => setTimeout(r, 5));
    const [json, redirect] = await Promise.all([login("w", "192.0.5.1"), form("192.0.6.1")]);
    expect(json.status).toBe(429);
    expect(await json.json()).toEqual({ error: "sign-in is busy; try again in a minute" });
    expect(json.headers.get("set-cookie")).toBeNull();
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("location")).toBe("/operator?error=busy");
    await Promise.all(held);
  });

  it("a body over the limit is refused with 400 and its password is never compared, right or wrong", async () => {
    const big = (password: string) =>
      POST(new Request("http://app.local/api/operator/login", { method: "POST", headers: { host: "app.local", "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ password, pad: "x".repeat(LOGIN_MAX_BODY_BYTES) }) }));
    expect((await big(PASSWORD)).status).toBe(400);
    for (let i = 0; i < LOGIN_MAX_FAILURES + 5; i++) expect((await big("wrong")).status).toBe(400);
    expect((await login(PASSWORD, "203.0.113.9")).status).toBe(200);
  });
});

describe("GET /api/operator/client-address (D-78): the operator's way to see what the host's proxies send", () => {
  const cfg = operatorConfig({ CRAWLSPACE_OPERATOR_PASSWORD: "correct horse battery" } as unknown as NodeJS.ProcessEnv) as Extract<OperatorConfig, { enabled: true }>;
  const saved = { password: process.env.CRAWLSPACE_OPERATOR_PASSWORD, hops: process.env.CRAWLSPACE_TRUSTED_PROXY_HOPS };
  const get = (headers: Record<string, string>) => clientAddress(new Request("http://app.local/api/operator/client-address", { headers: { host: "app.local", ...headers } }));
  beforeEach(() => {
    process.env.CRAWLSPACE_OPERATOR_PASSWORD = cfg.password;
    delete process.env.CRAWLSPACE_TRUSTED_PROXY_HOPS;
  });
  afterAll(() => {
    for (const [k, v] of [["CRAWLSPACE_OPERATOR_PASSWORD", saved.password], ["CRAWLSPACE_TRUSTED_PROXY_HOPS", saved.hops]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("401 without a session, 404 when the operator page is off", () => {
    expect(get({ "x-forwarded-for": "203.0.113.9" }).status).toBe(401);
    delete process.env.CRAWLSPACE_OPERATOR_PASSWORD;
    expect(get({}).status).toBe(404);
  });

  it("signed in: the list as received, the setting, and the bucket an attempt would be counted in", async () => {
    const cookie = `${OPERATOR_COOKIE}=${issueToken(cfg)}`;
    const off = get({ cookie, "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
    expect(off.status).toBe(200);
    expect(off.headers.get("cache-control")).toBe("no-store");
    expect(await off.json()).toEqual({ setting: "CRAWLSPACE_TRUSTED_PROXY_HOPS", trustedProxyHops: 0, forwardedFor: ["198.51.100.7", "10.0.0.1"], countedAs: SHARED_CLIENT, perAddress: false });
    process.env.CRAWLSPACE_TRUSTED_PROXY_HOPS = "2";
    expect(await get({ cookie, "x-forwarded-for": "198.51.100.7, 10.0.0.1" }).json()).toEqual({ setting: "CRAWLSPACE_TRUSTED_PROXY_HOPS", trustedProxyHops: 2, forwardedFor: ["198.51.100.7", "10.0.0.1"], countedAs: "198.51.100.7", perAddress: true });
    expect(await get({ cookie }).json()).toMatchObject({ forwardedFor: [], countedAs: SHARED_CLIENT, perAddress: false });
  });
});

describe("sign-out ends the session everywhere (D-79)", () => {
  const PASSWORD = "correct horse battery";
  const saved = process.env.CRAWLSPACE_OPERATOR_PASSWORD;
  const g = globalThis as Record<symbol, unknown>;
  beforeEach(() => {
    process.env.CRAWLSPACE_OPERATOR_PASSWORD = PASSWORD;
    delete g[Symbol.for("crawlspace.operator.limiter")];
    delete g[Symbol.for("crawlspace.operator.session-key")];
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.CRAWLSPACE_OPERATOR_PASSWORD;
    else process.env.CRAWLSPACE_OPERATOR_PASSWORD = saved;
  });
  const signIn = async () => {
    const res = await POST(new Request("http://app.local/api/operator/login", { method: "POST", headers: { host: "app.local", "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) }));
    return /^cs_op=([^;]+)/.exec(res.headers.get("set-cookie")!)![1]!;
  };
  const signedIn = (t: string) => guardOperator(new Request("http://app.local/api/operator/export/scans", { headers: { host: "app.local", cookie: `${OPERATOR_COOKIE}=${t}` } })) === null;
  const signOut = (headers: Record<string, string>) => logout(new Request("http://app.local/api/operator/logout", { method: "POST", headers: { host: "app.local", ...headers } }));

  it("after the operator signs out, a copy of the cookie no longer works", async () => {
    const t = await signIn();
    const copy = t; // what a thief would hold
    expect(signedIn(copy)).toBe(true);
    const res = await signOut({ cookie: `${OPERATOR_COOKIE}=${t}` });
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toMatch(/^cs_op=; .*Max-Age=0/);
    expect(signedIn(copy)).toBe(false);
    expect(signedIn(await signIn())).toBe(true);
  });

  it("a sign-out request without a valid session, or from another site, signs nobody out", async () => {
    const t = await signIn();
    for (const headers of [{}, { cookie: `${OPERATOR_COOKIE}=nope` }, { cookie: `${OPERATOR_COOKIE}=%` }, { cookie: `${OPERATOR_COOKIE}=${t}`, origin: "https://evil.example" }] as Record<string, string>[]) {
      expect((await signOut(headers)).status).toBe(303);
      expect(signedIn(t)).toBe(true);
    }
  });

  it("a cookie that is not valid percent-encoding is no session: 401, not an error", () => {
    expect(cookieValue("cs_op=%", OPERATOR_COOKIE)).toBeNull();
    expect(cookieValue("cs_op=%E0%A4%A", OPERATOR_COOKIE)).toBeNull();
    expect(guardOperator(new Request("http://app.local/api/operator/export/scans", { headers: { host: "app.local", cookie: "cs_op=%" } }))!.status).toBe(401);
  });
});
