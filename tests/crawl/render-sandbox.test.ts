import { describe, expect, it, vi } from "vitest";
import type { Browser, LaunchOptions } from "playwright";
import type { Fetcher, FetchResult } from "@/lib/crawl/fetcher";
import { PlaywrightRenderer, summarizeLaunchError } from "@/lib/crawl/render";

// PRD-01 Phase A, requirement 3: try Chromium's own sandbox. Where the host refuses it (no user namespaces), keep
// today's `--no-sandbox` launch and say so, rather than fail every scan (D-108). Launch options captured by injection.

const noFetch = {
  get: async () => {
    throw new Error("no asset fetches in this test");
  },
} as unknown as Fetcher;

const main: FetchResult = { requestedUrl: "http://sandbox.test/", url: "http://sandbox.test/", status: 200, contentType: "text/html", body: "<p>x</p>", ttfbMs: 0, redirects: [] };

/** A browser whose first use stops the render with a sentinel, so a test can tell "launched" from "launch failed". */
const launched = { newContext: async () => { throw new Error("sentinel: launched"); }, close: async () => undefined } as unknown as Browser;

/** A launcher that records each call and refuses the sandboxed launch when told to. */
function recorder(refuseSandbox: boolean) {
  const calls: LaunchOptions[] = [];
  const launch = async (options: LaunchOptions): Promise<Browser> => {
    calls.push(options);
    if (options.chromiumSandbox && refuseSandbox) throw new Error("browserType.launch: No usable sandbox! (test)");
    return launched;
  };
  return { calls, launch };
}

describe("PRD-01 requirement 3: Chromium's sandbox is tried first", () => {
  it("launches with chromiumSandbox: true when the host allows it, and only once", async () => {
    const { calls, launch } = recorder(false);
    const renderer = new PlaywrightRenderer(noFetch, { launch });
    await expect(renderer.render(main)).rejects.toThrow("sentinel: launched");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.chromiumSandbox).toBe(true);
    expect(calls[0]?.args ?? []).not.toContain("--no-sandbox");
  });

  it("falls back to the unsandboxed launch when the sandbox is refused, keeps the env and guards, and records why", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { calls, launch } = recorder(true);
    const renderer = new PlaywrightRenderer(noFetch, { launch });
    await expect(renderer.render(main)).rejects.toThrow("sentinel: launched");
    expect(calls.map((c) => c.chromiumSandbox)).toEqual([true, false]);
    const [first, second] = calls as [LaunchOptions, LaunchOptions];
    expect(second.env).toEqual(first.env);
    expect(second.args).toEqual(first.args);
    expect(second.proxy).toEqual(first.proxy);
    expect(renderer.sandbox).toEqual({ enabled: false, refusal: expect.stringContaining("No usable sandbox") });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("No usable sandbox"));
    warn.mockRestore();
  });

  it("reports the sandbox as on after a sandboxed launch", async () => {
    const fake = { newContext: async () => ({ addInitScript: async () => undefined, routeWebSocket: async () => undefined, newPage: async () => { throw new Error("sentinel: page"); }, close: async () => undefined }), close: async () => undefined } as unknown as Browser;
    const renderer = new PlaywrightRenderer(noFetch, { launch: async () => fake });
    await expect(renderer.render(main)).rejects.toThrow("sentinel: page");
    expect(renderer.sandbox).toEqual({ enabled: true });
    await renderer.close();
  });
});

describe("summarizeLaunchError", () => {
  it("keeps Chromium's own error line from Playwright's call log, without colour codes or the command line", () => {
    const message = [
      "browserType.launch: Target page, context or browser has been closed",
      "Browser logs:",
      "Chromium sandboxing failed!",
      "Call log:",
      "\u001b[2m  - <launching> /ms-playwright/chrome-headless-shell --headless --user-data-dir=/tmp/x\u001b[22m",
      "\u001b[2m  - [pid=42][err] [1122/011316.066842:FATAL:zygote_host_impl_linux.cc(128)] No usable sandbox! Update your kernel\u001b[22m",
      "\u001b[2m  - [pid=42] <process did exit: exitCode=1, signal=null>\u001b[22m",
    ].join("\n");
    const s = summarizeLaunchError(message);
    expect(s).toContain("FATAL:zygote_host_impl_linux.cc(128)] No usable sandbox!");
    expect(s).not.toContain("--user-data-dir");
    expect(s).not.toContain("\u001b");
  });

  it("falls back to the first line", () => {
    expect(summarizeLaunchError("browserType.launch: Executable doesn't exist\nmore")).toBe("browserType.launch: Executable doesn't exist");
  });
});
