import type { Browser, BrowserContext, Route } from "playwright";
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

  constructor(private readonly fetcher: Fetcher) {}

  private async ctx(): Promise<BrowserContext> {
    if (this.context) return this.context;
    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({ args: [...CHROMIUM_LAUNCH.args], proxy: { ...CHROMIUM_LAUNCH.proxy } });
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
