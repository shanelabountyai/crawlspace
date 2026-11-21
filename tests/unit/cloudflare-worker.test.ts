import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { matchesBasePath, readConfig, rewriteResponse, toOriginRequest, type ProxyConfig } from "../../deploy/cloudflare-worker/worker";
import { parseBasePath } from "@/lib/base-path";

// The proxy template in deploy/cloudflare-worker (D-106). Runs the Worker's logic with Node's fetch classes; the
// Cloudflare runtime itself is not exercised here.
const CFG: ProxyConfig = { origin: "https://crawlspace.onrender.com", basePath: "/agent-check" };
const PUBLIC = "https://assess.labintelligence.co";

describe("readConfig", () => {
  it("accepts an https origin with no path and a valid base path", () => {
    expect(readConfig({ ORIGIN: "https://crawlspace.onrender.com", BASE_PATH: "/agent-check" })).toEqual(CFG);
    expect(readConfig({ ORIGIN: "https://crawlspace.onrender.com/", BASE_PATH: " /agent-check " })).toEqual(CFG);
  });

  it.each([
    [{}],
    [{ ORIGIN: "https://crawlspace.onrender.com" }],
    [{ BASE_PATH: "/agent-check" }],
    [{ ORIGIN: "http://crawlspace.onrender.com", BASE_PATH: "/agent-check" }],
    [{ ORIGIN: "https://crawlspace.onrender.com/x", BASE_PATH: "/agent-check" }],
    [{ ORIGIN: "https://user:pw@crawlspace.onrender.com", BASE_PATH: "/agent-check" }],
    [{ ORIGIN: "https://crawlspace.onrender.com?x=1", BASE_PATH: "/agent-check" }],
    [{ ORIGIN: "not a url", BASE_PATH: "/agent-check" }],
    [{ ORIGIN: "https://crawlspace.onrender.com", BASE_PATH: "/agent-check/" }],
    [{ ORIGIN: "https://crawlspace.onrender.com", BASE_PATH: "agent-check" }],
  ])("refuses %j (then every request passes through)", (env) => {
    expect(readConfig(env)).toBeNull();
  });

  it.each(["/agent-check", "/a/b", "/x_y", "/", "/a/", "a", "//a", "/a.b", "/_next", "/-a", "/a b", `/${"a".repeat(64)}`, `/${"a".repeat(63)}`])(
    "agrees with the app's own validator on %j",
    (bp) => {
      let app: string | null;
      try {
        app = parseBasePath(bp) || null;
      } catch {
        app = null;
      }
      expect(readConfig({ ORIGIN: CFG.origin, BASE_PATH: bp })?.basePath ?? null).toBe(app);
    },
  );
});

describe("which paths are forwarded", () => {
  it.each([
    ["/agent-check", true],
    ["/agent-check/", true],
    ["/agent-check/scans/abc", true],
    ["/agent-check/api/scans/abc/pdf", true],
    ["/agent-checkout", false],
    ["/agent-check-old/x", false],
    ["/", false],
    ["/use-case-scorer", false],
    ["/AGENT-CHECK", false],
  ])("%s → %s", (path, yes) => {
    expect(matchesBasePath(path, "/agent-check")).toBe(yes);
    expect(toOriginRequest(new Request(`${PUBLIC}${path}`), CFG) !== null).toBe(yes);
  });
});

describe("toOriginRequest", () => {
  it("keeps the same path and query on the origin", () => {
    const r = toOriginRequest(new Request(`${PUBLIC}/agent-check/scans/abc?pdf=pdf-email`), CFG)!;
    expect(r.url).toBe("https://crawlspace.onrender.com/agent-check/scans/abc?pdf=pdf-email");
    expect(r.method).toBe("GET");
    expect(r.redirect).toBe("manual");
  });

  it("passes method, body and headers through and sets the forwarded headers", async () => {
    const incoming = new Request(`${PUBLIC}/agent-check/api/scans/abc/pdf`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "cs_op=abc",
        origin: PUBLIC,
        "user-agent": "test",
        "CF-Connecting-IP": "203.0.113.9",
        "X-Forwarded-For": "198.51.100.77",
        "X-Forwarded-Host": "evil.example",
      },
      body: "email=a%40b.co",
    });
    const r = toOriginRequest(incoming, CFG)!;
    expect(r.method).toBe("POST");
    expect(await r.text()).toBe("email=a%40b.co");
    expect(r.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(r.headers.get("cookie")).toBe("cs_op=abc");
    expect(r.headers.get("origin")).toBe(PUBLIC);
    expect(r.headers.get("user-agent")).toBe("test");
    expect(r.headers.get("x-forwarded-host")).toBe("assess.labintelligence.co");
    expect(r.headers.get("x-forwarded-proto")).toBe("https");
    // the visitor's own X-Forwarded-For is replaced by the address Cloudflare saw
    expect(r.headers.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  it("drops a visitor-sent X-Forwarded-For when Cloudflare gave no address", () => {
    const r = toOriginRequest(new Request(`${PUBLIC}/agent-check`, { headers: { "X-Forwarded-For": "198.51.100.77" } }), CFG)!;
    expect(r.headers.get("x-forwarded-for")).toBeNull();
  });
});

describe("rewriteResponse", () => {
  it("leaves Crawlspace's relative redirects alone (the browser resolves them on the public host)", () => {
    const res = new Response(null, { status: 303, headers: { location: "/agent-check/scans/abc" } });
    expect(rewriteResponse(res, CFG, PUBLIC)).toBe(res);
  });

  it("rewrites a redirect that names the origin to the public host", () => {
    const res = new Response(null, { status: 307, headers: { location: "https://crawlspace.onrender.com/agent-check/operator" } });
    const out = rewriteResponse(res, CFG, PUBLIC);
    expect(out.status).toBe(307);
    expect(out.headers.get("location")).toBe("https://assess.labintelligence.co/agent-check/operator");
  });
});

describe("the fetch handler", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards base-path requests to the origin and passes everything else through unchanged", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (req: Request) => {
      seen.push(req.url);
      return new Response("ok");
    });
    const env = { ORIGIN: CFG.origin, BASE_PATH: CFG.basePath };
    await worker.fetch(new Request(`${PUBLIC}/agent-check/api/health`), env);
    const other = new Request(`${PUBLIC}/use-case-scorer?x=1`);
    await worker.fetch(other, env);
    expect(seen).toEqual(["https://crawlspace.onrender.com/agent-check/api/health", `${PUBLIC}/use-case-scorer?x=1`]);
  });

  it("passes every request through when misconfigured", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (req: Request) => {
      seen.push(req.url);
      return new Response("ok");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await worker.fetch(new Request(`${PUBLIC}/agent-check/api/health`), { BASE_PATH: "/agent-check" });
    expect(seen).toEqual([`${PUBLIC}/agent-check/api/health`]);
  });
});
