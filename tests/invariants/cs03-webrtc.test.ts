import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSocket, type Socket } from "node:dgram";
import type { Fetcher, FetchResult } from "@/lib/crawl/fetcher";
import { PlaywrightRenderer } from "@/lib/crawl/render";

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
