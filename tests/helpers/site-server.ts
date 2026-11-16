import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultPolicy, type AddressPolicy, type Resolver } from "@/lib/crawl";

export interface Hit {
  method: string;
  host: string;
  path: string;
  at: number;
}

export interface Route {
  status?: number;
  type?: string;
  body?: string;
  headers?: Record<string, string>;
}

export type Routes = Record<string, Route | ((req: IncomingMessage) => Route)>;

/** Local HTTP server for crawler tests. Every request is logged (method, Host, path, time). */
export class SiteServer {
  readonly hits: Hit[] = [];
  private server: Server;
  port = 0;
  private sites = new Map<string, Routes>();

  constructor() {
    this.server = createServer((req, res) => {
      const host = (req.headers.host ?? "").replace(/:\d+$/, "");
      const path = req.url ?? "/";
      this.hits.push({ method: req.method ?? "?", host, path, at: Date.now() });
      req.resume();
      const routes = this.sites.get(host) ?? {};
      const r0 = routes[path] ?? routes[path.replace(/\?.*$/, "")];
      const r = typeof r0 === "function" ? r0(req) : r0;
      if (!r) {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("not found");
      }
      res.writeHead(r.status ?? 200, { "content-type": r.type ?? "text/html; charset=utf-8", ...(r.headers ?? {}) });
      res.end(r.body ?? "");
    });
  }

  async start(port = 0): Promise<this> {
    await new Promise<void>((ok) => this.server.listen(port, "127.0.0.1", ok));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  site(host: string, routes: Routes): string {
    this.sites.set(host, routes);
    return `http://${host}:${this.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((ok) => this.server.close(() => ok()));
  }
}

/** Tests may reach *.test hosts on loopback; everything else uses the real (public-only) policy and no DNS. */
export const testResolver: Resolver = async (host) => {
  if (host.endsWith(".test")) return ["127.0.0.1"];
  if (host === "localhost") return ["127.0.0.1"];
  throw Object.assign(new Error(`ENOTFOUND ${host} (tests never use real DNS)`), { code: "ENOTFOUND" });
};
export const testPolicy: AddressPolicy = (address, host) => (host.endsWith(".test") ? address === "127.0.0.1" : defaultPolicy(address, host));
export const testGuard = { resolver: testResolver, policy: testPolicy };

/** Serve a Phase 1 fixture's raw files, with its https://<name>.example origin rewritten to the test server. */
export function fixtureRoutes(name: string, base: string): Routes {
  const dir = join(process.cwd(), "fixtures/sites", name);
  const m = JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8"));
  const from = new URL(m.url).origin;
  const fix = (s: string) => s.split(from).join(base);
  const routes: Routes = {};
  for (const p of m.pages) {
    routes[new URL(p.url).pathname] = { status: p.status, body: fix(readFileSync(join(dir, p.raw), "utf8")) };
  }
  const res = (key: string, path: string, type: string) => {
    const r = m[key];
    if (r && r.file) routes[path] = { status: r.status, type, body: fix(readFileSync(join(dir, r.file), "utf8")) };
  };
  res("robots", "/robots.txt", "text/plain");
  res("sitemap", "/sitemap.xml", "application/xml");
  res("llms", "/llms.txt", "text/plain");
  return routes;
}
