import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSocket, type Socket } from "node:dgram";
import type { Fetcher, FetchResult } from "@/lib/crawl/fetcher";
import { CHROMIUM_LAUNCH, PlaywrightRenderer } from "@/lib/crawl/render";

// CS-03, second line (D-20): the headless browser never sends anything to the network itself. A scanned page's own
// JavaScript must not reach private or loopback addresses through WebRTC (STUN/TURN over UDP), which bypasses the
// request interception, the disabled DNS and the dead proxy. Review 2026-11-20, SEC-1 (docs/REVIEW-2026-11-20.md).

const noFetch = {
  get: async () => {
    throw new Error("no asset fetches in this test");
  },
} as unknown as Fetcher;

describe("CS-03: page JavaScript in the renderer cannot open WebRTC connections", () => {
  let sock: Socket;
  let port = 0;
  const packets: string[] = [];
  const renderer = new PlaywrightRenderer(noFetch);

  beforeAll(async () => {
    sock = createSocket("udp4");
    sock.on("message", (m, r) => packets.push(`${r.address}:${r.port} ${m.length}B`));
    await new Promise<void>((done) => sock.bind(0, "127.0.0.1", done));
    port = sock.address().port;
  });
  afterAll(async () => {
    await renderer.close();
    sock.close();
  });

  it("sends no UDP to a STUN server on loopback and exposes no RTCPeerConnection", async () => {
    const body = `<!doctype html><html><head><title>t</title></head><body><p id="out">start</p><script>
      const out = document.getElementById("out");
      const names = ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceCandidate", "RTCSessionDescription"];
      out.dataset.present = names.filter((n) => typeof window[n] !== "undefined").join(",");
      try {
        const Ctor = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        const pc = new Ctor({ iceServers: [{ urls: "stun:127.0.0.1:${"${PORT}"}" }, { urls: "stun:10.0.0.1:${"${PORT}"}" }] });
        pc.createDataChannel("x");
        pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
        out.textContent = "opened";
      } catch (e) {
        out.textContent = "refused";
      }
    </script></body></html>`.replaceAll("${PORT}", String(port));
    const main: FetchResult = { requestedUrl: "http://webrtc.test/", url: "http://webrtc.test/", status: 200, contentType: "text/html; charset=utf-8", body, ttfbMs: 1, redirects: [] };
    const html = await renderer.render(main);
    await new Promise((r) => setTimeout(r, 3000)); // ICE gathering runs after load; give it time to send
    expect(packets, "UDP packets that reached the loopback STUN server").toEqual([]);
    expect(html).toContain(">refused<");
    expect(html).toContain('data-present=""');
  }, 30_000);
});

// The launch flags alone, without the init script: if a Chromium update stops honouring them, this fails even though
// the init script still hides WebRTC from pages. Covers STUN, TURN over UDP and a peer connectivity check aimed at a
// candidate the page made up (D-100).
describe("CS-03: the renderer's launch flags alone stop WebRTC UDP", () => {
  it("sends no UDP to loopback with WebRTC still present in the page", async () => {
    const sock = createSocket("udp4");
    const packets: string[] = [];
    sock.on("message", (m, r) => packets.push(`${r.address}:${r.port} ${m.length}B`));
    await new Promise<void>((done) => sock.bind(0, "127.0.0.1", done));
    const port = sock.address().port;
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ args: [...CHROMIUM_LAUNCH.args], proxy: { ...CHROMIUM_LAUNCH.proxy } });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><title>t</title><p>x</p>");
      const present = await page.evaluate((p) => {
        if (typeof RTCPeerConnection === "undefined") return false;
        const pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${p}` }, { urls: `turn:127.0.0.1:${p}?transport=udp`, username: "u", credential: "c" }] });
        pc.createDataChannel("x");
        void pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
        const a = new RTCPeerConnection();
        const b = new RTCPeerConnection();
        a.createDataChannel("y");
        void a
          .createOffer()
          .then(async (o) => {
            await a.setLocalDescription(o);
            await b.setRemoteDescription(o);
            const ans = await b.createAnswer();
            await b.setLocalDescription(ans);
            await a.setRemoteDescription(ans);
            await a.addIceCandidate({ candidate: `candidate:1 1 udp 2122260223 127.0.0.1 ${p} typ host`, sdpMid: "0", sdpMLineIndex: 0 });
          })
          .catch(() => {});
        return true;
      }, port);
      expect(present, "this test needs WebRTC in the page: it checks the flags, not the init script").toBe(true);
      await new Promise((r) => setTimeout(r, 3000));
      expect(packets, "UDP packets that reached 127.0.0.1").toEqual([]);
    } finally {
      await browser.close();
      sock.close();
    }
  }, 30_000);
});
