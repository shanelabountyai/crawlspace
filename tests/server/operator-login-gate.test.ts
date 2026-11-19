import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as clientAddress } from "@/app/api/operator/client-address/route";
import { POST } from "@/app/api/operator/login/route";
import {
  addressKey,
  clientKey,
  issueToken,
  LOGIN_GLOBAL_FREE,
  LOGIN_MAX_FAILURES,
  LOGIN_SLOW_GAP_MS,
  LOGIN_WINDOW_MS,
  LoginGate,
  LoginLimiter,
  OPERATOR_COOKIE,
  operatorConfig,
  SHARED_CLIENT,
  trustedProxyHops,
  type LoginTicket,
  type OperatorConfig,
} from "@/server/operator-auth";

// The sign-in limit and the address it counts by (Phase 4 review items 1 and 2; D-76, D-77, D-78).
type Held = Extract<LoginTicket, { ok: true }>;
const env = (v?: string) => (v === undefined ? {} : { CRAWLSPACE_TRUSTED_PROXY_HOPS: v }) as unknown as NodeJS.ProcessEnv;
const req = (xff?: string) => new Request("http://app.local/api/operator/login", { method: "POST", headers: xff === undefined ? {} : { "x-forwarded-for": xff } });

/** A gate on a clock the test moves; `sleep` records the wait, moves the clock and returns. */
function gateOnClock(opts: ConstructorParameters<typeof LoginGate>[0] = {}) {
  const clock = { t: 1_000_000 };
  const sleeps: number[] = [];
  const gate = new LoginGate({
    ...opts,
    now: () => clock.t,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
  });
  const wrong = (client: string) => {
    const t = gate.enter(client);
    if (!t.ok) throw new Error(`${client} is locked`);
    return t;
  };
  return { gate, clock, sleeps, wrong };
}

describe("LoginLimiter: check and count in one step (D-76)", () => {
  it("reserve takes a place or refuses; refund gives exactly one place back", () => {
    const l = new LoginLimiter(3, 1_000);
    expect([l.reserve(10), l.reserve(10), l.reserve(11)]).toEqual([true, true, true]);
    expect(l.reserve(12)).toBe(false);
    expect(l.count(12)).toBe(3);
    l.refund(10);
    expect(l.count(12)).toBe(2);
    expect(l.reserve(12)).toBe(true);
    expect(l.reserve(12)).toBe(false);
    l.refund(999); // nothing counted at that time: no change
    expect(l.count(12)).toBe(3);
    expect(l.idle(1_011)).toBe(false);
    expect(l.idle(1_013)).toBe(true);
  });
});

describe("LoginGate: one bucket per client (D-77)", () => {
  it(`a client is refused after ${LOGIN_MAX_FAILURES} counted attempts in 15 minutes; other clients are not; the window slides`, () => {
    const { gate, clock, wrong } = gateOnClock();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) wrong("203.0.113.9");
    expect(gate.enter("203.0.113.9")).toEqual({ ok: false, reason: "locked" });
    expect(gate.enter("198.51.100.7").ok).toBe(true);
    clock.t += LOGIN_WINDOW_MS - 1;
    expect(gate.enter("203.0.113.9").ok).toBe(false);
    clock.t += 1;
    expect(gate.enter("203.0.113.9").ok).toBe(true);
  });

  it("a refused attempt is not counted, so being refused does not extend the lock", () => {
    const { gate, clock, wrong } = gateOnClock();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) wrong("a");
    clock.t += LOGIN_WINDOW_MS - 10;
    for (let i = 0; i < 100; i++) expect(gate.enter("a").ok).toBe(false);
    clock.t += 10;
    expect(gate.enter("a").ok).toBe(true);
  });

  it("release gives the place back (right password, or body never read) and forgets a client with nothing counted", () => {
    const { gate } = gateOnClock();
    for (let i = 0; i < LOGIN_MAX_FAILURES * 5; i++) {
      const t = gate.enter("198.51.100.7") as Held;
      expect(t.ok).toBe(true);
      t.release();
      t.release(); // twice is harmless
    }
    expect(gate.size).toBe(0);
    const kept = gate.enter("198.51.100.7") as Held;
    expect(kept.client).toBe("198.51.100.7");
    expect(gate.size).toBe(1);
  });

  it("places taken together are all counted before any is settled: no more than the limit can be held at once", () => {
    const { gate } = gateOnClock();
    const tickets = Array.from({ length: 40 }, () => gate.enter("a"));
    expect(tickets.filter((t) => t.ok)).toHaveLength(LOGIN_MAX_FAILURES);
    (tickets[0] as Held).release();
    expect(gate.enter("a").ok).toBe(true);
    expect(gate.enter("a").ok).toBe(false);
  });

  it("remembers a bounded number of addresses; past that, new addresses are counted together and nobody gets extra attempts", () => {
    const { gate, clock, wrong } = gateOnClock({ maxClients: 3 });
    for (const c of ["a", "b", "c"]) wrong(c);
    expect(gate.size).toBe(3);
    const overflow = wrong("d");
    expect(overflow.client).toBe(SHARED_CLIENT);
    for (let i = 1; i < LOGIN_MAX_FAILURES; i++) expect(wrong(`new-${i}`).client).toBe(SHARED_CLIENT);
    expect(gate.enter("yet-another").ok).toBe(false);
    expect(gate.enter("a").ok).toBe(true); // a remembered address keeps its own bucket
    expect(gate.size).toBe(4); // a, b, c and the shared bucket
    clock.t += LOGIN_WINDOW_MS + 1;
    expect(wrong("e").client).toBe("e"); // expired addresses made room
    expect(gate.size).toBe(1);
  });
});

describe("LoginGate: a flood from many addresses slows sign-in, it does not refuse it (D-77)", () => {
  /** `n` different addresses, one wrong password each. */
  async function flood(g: ReturnType<typeof gateOnClock>, n: number) {
    for (let i = 0; i < n; i++) await g.wrong(`10.0.${i >> 8}.${i & 255}`).turn();
  }

  it(`the first ${LOGIN_GLOBAL_FREE} counted attempts in the window are checked at once`, async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    expect(g.sleeps).toEqual([]);
  });

  it(`after that, checks are let through one at a time, ${LOGIN_SLOW_GAP_MS} ms apart`, async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    const order: number[] = [];
    const started = g.clock.t;
    const turns = Array.from({ length: 6 }, (_, i) =>
      g
        .wrong(`192.0.2.${i}`)
        .turn()
        .then(() => order.push(i)),
    );
    expect(g.gate.waiting).toBe(5); // the first went straight through; the other five wait
    await Promise.all(turns);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
    // The gate waited one full gap before each of the five, on its own clock: nothing was let through early.
    expect(g.sleeps).toEqual(Array(5).fill(LOGIN_SLOW_GAP_MS));
    expect(g.clock.t - started).toBe(5 * LOGIN_SLOW_GAP_MS);
    expect(g.gate.waiting).toBe(0);
  });

  it("while slowed, a client that has not guessed before goes ahead of every client that has", async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE);
    const order: string[] = [];
    const queue = (client: string, label: string) => g.wrong(client).turn().then(() => order.push(label));
    // Addresses already used in the flood guess again (the first of them is let through at once, the rest wait);
    // then the operator arrives last.
    const turns = [queue("10.0.0.9", "guesser-9"), queue("10.0.0.1", "guesser-1"), queue("10.0.0.1", "guesser-1"), queue("10.0.0.2", "guesser-2"), queue("10.0.0.3", "guesser-3"), queue("10.0.0.3", "guesser-3")];
    turns.push(queue("198.51.100.7", "operator"));
    await Promise.all(turns);
    expect(order).toHaveLength(7);
    expect(order.slice(0, 2)).toEqual(["guesser-9", "operator"]);
  });

  it("nobody is refused for someone else's attempts: with 300 addresses flooding, a new address still gets a place and its turn", async () => {
    const g = gateOnClock();
    await flood(g, 300);
    const t = g.gate.enter("198.51.100.7");
    expect(t.ok).toBe(true);
    await (t as Held).turn();
    (t as Held).release();
    expect(g.gate.enter("198.51.100.7").ok).toBe(true);
  });

  it("the slowdown ends when the flood's attempts leave the window", async () => {
    const g = gateOnClock();
    await flood(g, LOGIN_GLOBAL_FREE + 5);
    g.clock.t += LOGIN_WINDOW_MS + 1;
    const before = g.sleeps.length;
    await g.wrong("198.51.100.7").turn();
    expect(g.sleeps.length).toBe(before);
  });

  it("a right password is given back, so signing in does not push sign-in towards the slowdown", async () => {
    const g = gateOnClock();
    for (let i = 0; i < LOGIN_GLOBAL_FREE * 3; i++) {
      const t = g.wrong("198.51.100.7");
      await t.turn();
      t.release();
    }
    expect(g.sleeps).toEqual([]);
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

  it("120 addresses send wrong passwords at once and the operator's right password arrives in the same burst: every wrong one gets 401, the operator signs in", async () => {
    const burst = Array.from({ length: 120 }, (_, i) => login(`wrong password ${i}`, `203.0.113.${i}`));
    const operator = login(PASSWORD, "198.51.100.7");
    const res = await Promise.all(burst);
    expect(res.map((r) => r.status).filter((s) => s === 401)).toHaveLength(120);
    const mine = await operator;
    expect(mine.status).toBe(200);
    expect(mine.headers.get("set-cookie")).toMatch(new RegExp(`^${OPERATOR_COOKIE}=`));
  });

  it("each of those addresses is still held to its own limit while sign-in is slowed", async () => {
    await Promise.all(Array.from({ length: LOGIN_GLOBAL_FREE + 10 }, (_, i) => login(`wrong password ${i}`, `203.0.113.${i}`)));
    const again = await Promise.all(Array.from({ length: 30 }, (_, i) => login(`more ${i}`, "203.0.113.1")));
    expect(again.filter((r) => r.status === 401)).toHaveLength(LOGIN_MAX_FAILURES - 1);
    expect(again.filter((r) => r.status === 429)).toHaveLength(30 - (LOGIN_MAX_FAILURES - 1));
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
