import type { Browser, BrowserContext, LaunchOptions, Route } from "playwright";
import { MAX_ASSETS_PER_PAGE, RENDER_IDLE_MS, RENDER_TIMEOUT_MS, USER_AGENT } from "./config";
import type { FetchResult, Fetcher } from "./fetcher";

export interface RenderEvent {
  page: string;
  url: string;
  method: string;
  resourceType: string;
  action: "fulfilled" | "blocked" | "failed";
  reason?: string;
}

export interface Renderer {
  render(main: FetchResult): Promise<string>;
  readonly events: RenderEvent[];
  close(): Promise<void>;
}

/** Fallback when rendering is switched off: the rendered view equals the raw HTML. */
export class NoRenderer implements Renderer {
  readonly events: RenderEvent[] = [];
  async render(main: FetchResult): Promise<string> {
    return main.body;
  }
  async close(): Promise<void> {}
}

/** How the rendering browser is launched (D-20, D-100). Exported so tests can check each guard layer on its own. */
export const CHROMIUM_LAUNCH = {
  args: [
    "--host-resolver-rules=MAP * ~NOTFOUND",
    "--proxy-bypass-list=<-loopback>",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-pings",
    // WebRTC sends UDP by IP literal, past request interception, DNS and the proxy: allow only proxied UDP,
    // and the proxy is dead (review 2026-11-20, SEC-1; D-100)
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  ],
  proxy: { server: "http://127.0.0.1:9" },
};

/**
 * The only environment variables the rendering browser gets (PRD-01 Phase A, requirement 1; review 2026-11-20, SEC-2).
 * Chromium renders pages chosen by anonymous visitors, so it never inherits the server's environment: no
 * `ANTHROPIC_API_KEY`, `CRAWLSPACE_*` (operator password included), `HUBSPOT_*` or `DATABASE_FILE`, and nothing else
 * that is not listed here. Playwright passes `process.env` to the browser when `env` is left out, so it is always set.
 */
export const CHROMIUM_ENV_ALLOWLIST: readonly string[] = ["HOME", "PATH", "TZ", "LANG", "LC_ALL", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH"];

/** The browser's environment: the allowlisted names that are set in `source`, nothing else. */
export function chromiumLaunchEnv(source: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of CHROMIUM_ENV_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined && value !== "") env[name] = value;
  }
  return env;
}

/** Starts the browser. Injected in tests to capture the launch options (tests/crawl/render-env.test.ts). */
export type ChromiumLaunch = (options: LaunchOptions) => Promise<Browser>;

export interface PlaywrightRendererOptions {
  launch?: ChromiumLaunch;
}

/** Whether the browser runs inside Chromium's own sandbox, and if not, what the host said when it was tried. */
export type SandboxOutcome = { enabled: true } | { enabled: false; refusal: string };

/**
 * PRD-01 Phase A, requirement 3 (D-108): the default launcher's sandbox refusal, remembered for the life of the process
 * so that a host without user namespaces pays for the refused launch once, not on every scan. Injected launchers
 * (tests) never read or write it.
 */
let processSandboxRefusal: string | null = null;

/**
 * The part of a refused launch worth logging: Chromium's own error lines from Playwright's call log (for example
 * "No usable sandbox!" or "Running as root without --no-sandbox is not supported"), without colour codes or the
 * full command line. Falls back to the first line of the message.
 */
export function summarizeLaunchError(message: string): string {
  const lines = message.replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const chromium = lines.filter((l) => /\[err\]|FATAL|ERROR:/.test(l)).map((l) => l.replace(/^- \[pid=\d+\]\[err\]\s*/, ""));
  const picked = chromium.length ? chromium : lines.slice(0, 1);
  return picked.join(" | ").slice(0, 600);
}

const ASSET_TYPES = new Set(["script", "xhr", "fetch"]);

/**
 * Headless Chromium that never touches the network itself. Every request the page makes is intercepted:
 * the page's own document is served from the bytes the fetcher already downloaded, scripts/XHR go through the
 * same guarded GET-only fetcher (rate limit, SSRF guard, budget), everything else is aborted. As a second line,
 * Chromium's DNS is disabled and it is pointed at a dead proxy, so anything that slips past interception fails.
 */
export class PlaywrightRenderer implements Renderer {
  readonly events: RenderEvent[] = [];
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private sandboxOutcome: SandboxOutcome | null = null;

  constructor(
    private readonly fetcher: Fetcher,
    private readonly options: PlaywrightRendererOptions = {},
  ) {}

  private async launch(options: LaunchOptions): Promise<Browser> {
    if (this.options.launch) return this.options.launch(options);
    const { chromium } = await import("playwright");
    return chromium.launch(options);
  }

  /** How the current browser was launched; null before the first render. */
  get sandbox(): SandboxOutcome | null {
    return this.sandboxOutcome;
  }

  /**
   * Chromium's sandbox first (PRD-01 Phase A, requirement 3). If the host refuses it (typically: no user namespaces
   * for an unprivileged user), launch as before with Playwright's `--no-sandbox` and log the refusal once, instead
   * of failing every scan. A page cannot cause the fallback: it happens at launch, before any page is opened. Every
   * other guard (allowlisted env, DNS off, dead proxy, WebRTC flags) is the same in both launches (D-108).
   */
  private async launchBrowser(): Promise<Browser> {
    const base: LaunchOptions = { args: [...CHROMIUM_LAUNCH.args], proxy: { ...CHROMIUM_LAUNCH.proxy }, env: chromiumLaunchEnv() };
    const injected = this.options.launch !== undefined;
    if (injected || processSandboxRefusal === null) {
      try {
        const browser = await this.launch({ ...base, chromiumSandbox: true });
        this.sandboxOutcome = { enabled: true };
        return browser;
      } catch (e) {
        const refusal = summarizeLaunchError(e instanceof Error ? e.message : String(e));
        console.warn(`crawlspace: Chromium sandbox refused, rendering with --no-sandbox (PRD-01 Phase A, D-108): ${refusal}`);
        if (!injected) processSandboxRefusal = refusal;
        this.sandboxOutcome = { enabled: false, refusal };
      }
    } else {
      this.sandboxOutcome = { enabled: false, refusal: processSandboxRefusal };
    }
    return this.launch({ ...base, chromiumSandbox: false });
  }

  private async ctx(): Promise<BrowserContext> {
    if (this.context) return this.context;
    this.browser = await this.launchBrowser();
    this.context = await this.browser.newContext({ userAgent: USER_AGENT, serviceWorkers: "block", acceptDownloads: false, javaScriptEnabled: true });
    // And page scripts never get WebRTC at all, in every frame (D-100). Removed before any page script runs.
    await this.context.addInitScript(() => {
      for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceCandidate", "RTCSessionDescription", "RTCRtpSender", "RTCRtpReceiver", "RTCRtpTransceiver", "RTCDtlsTransport", "RTCIceTransport", "RTCSctpTransport", "RTCCertificate"]) {
        try {
          delete (globalThis as Record<string, unknown>)[name];
        } catch {
          // a non-configurable global stays; the launch flags above still block its UDP
        }
      }
    });
    await this.context.routeWebSocket(/.*/, (ws) => {
      this.events.push({ page: "", url: ws.url(), method: "GET", resourceType: "websocket", action: "blocked", reason: "websockets are never opened" });
      void ws.close();
    });
    return this.context;
  }

  async render(main: FetchResult): Promise<string> {
    const context = await this.ctx();
    const page = await context.newPage();
    let assets = 0;
    const log = (route: Route, action: RenderEvent["action"], reason?: string) => {
      const r = route.request();
      this.events.push({ page: main.url, url: r.url(), method: r.method(), resourceType: r.resourceType(), action, reason });
    };
    await page.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() !== "GET") {
        log(route, "blocked", "non-GET");
        return route.abort("blockedbyclient");
      }
      if (req.isNavigationRequest()) {
        if (req.frame() === page.mainFrame() && req.url() === main.url && !req.redirectedFrom()) {
          log(route, "fulfilled", "main document from fetcher");
          return route.fulfill({ status: main.status, contentType: main.contentType ?? "text/html; charset=utf-8", body: main.body });
        }
        log(route, "blocked", "navigation away from the scanned page");
        return route.abort("blockedbyclient");
      }
      if (!ASSET_TYPES.has(req.resourceType())) {
        log(route, "blocked", `resource type ${req.resourceType()}`);
        return route.abort("blockedbyclient");
      }
      if (assets >= MAX_ASSETS_PER_PAGE) {
        log(route, "blocked", "per-page asset budget used up");
        return route.abort("blockedbyclient");
      }
      assets++;
      try {
        const res = await this.fetcher.get(req.url(), "asset");
        log(route, "fulfilled");
        return route.fulfill({ status: res.status, contentType: res.contentType ?? undefined, body: res.body });
      } catch (e) {
        log(route, "failed", e instanceof Error ? e.message : String(e));
        return route.abort("blockedbyclient");
      }
    });
    try {
      await page.goto(main.url, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
      await page.waitForLoadState("networkidle", { timeout: RENDER_IDLE_MS }).catch(() => undefined);
      return await page.content();
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
  }
}
