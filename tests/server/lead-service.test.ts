import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureAgents, fixtureSnapshot } from "@/lib/fixtures";
import { generateFixList } from "@/lib/fixlist";
import { scanSnapshot } from "@/lib/scan";
import { openDb, type Db } from "@/server/db";
import { HubSpotForms, type HttpPost, type HttpRequest } from "@/server/hubspot";
import { LEADS_PER_SCAN_PER_HOUR, LeadService, normaliseEmail, scanPdf } from "@/server/lead-service";
import { LeadStore, listScans, ScanStore } from "@/server/store";
import { pdfText } from "../helpers/pdf-text";

const dir = mkdtempSync(join(tmpdir(), "cs-leads-"));
const opened: Db[] = [];
let n = 0;
function fresh() {
  const db = openDb(join(dir, `l${n++}.db`));
  opened.push(db);
  return { db, scans: new ScanStore(db), leads: new LeadStore(db) };
}
afterAll(async () => {
  for (const db of opened) await db.$disconnect();
});

async function doneScan(scans: ScanStore, fixture = "js-only-shop") {
  const card = scanSnapshot(fixtureSnapshot(fixture), { agents: fixtureAgents() });
  const id = await scans.create(card.url);
  await scans.markRunning(id);
  await scans.markDone(id, card, await generateFixList(card), { pageRequests: 4, assetRequests: 1, blockedBrowserRequests: 0, skipped: [], notes: [] });
  return { id, card };
}

/** A mock HubSpot transport: records every request, answers with the given status or throws. */
function mockHttp(answer: number | Error | "hang") {
  const calls: HttpRequest[] = [];
  const http: HttpPost = async (req) => {
    calls.push(req);
    if (answer === "hang")
      return new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }))));
    if (answer instanceof Error) throw answer;
    return { status: answer };
  };
  return { http, calls };
}

describe("email validation (D-38)", () => {
  it.each(["you@company.com", "  First.Last+tag@Sub.Example.CO.uk ", "a@b.io"])("accepts %s", (e) => {
    expect(normaliseEmail(e)).not.toBeNull();
  });
  it.each(["", "   ", "no-at-sign", "a@b", "a@@b.com", "a b@c.com", "<a@b.com>", "a@-b.com", `${"x".repeat(250)}@b.com`, 42, null, undefined, ["a@b.com"]])("refuses %j", (e) => {
    expect(normaliseEmail(e)).toBeNull();
  });
  it("lower-cases the domain only", () => {
    expect(normaliseEmail(" Ann.Lee@Example.COM ")).toBe("Ann.Lee@example.com");
  });
});

describe("PDF gate and local lead storage (D-35, D-36, D-38)", () => {
  it("a valid email on a finished scan stores the lead and returns the branded PDF; HubSpot off by default", async () => {
    const { scans, leads } = fresh();
    const { id, card } = await doneScan(scans);
    const svc = new LeadService(scans, leads, null);
    expect(svc.hubspotEnabled).toBe(false);
    const r = await svc.requestPdf(id, "buyer@shop.example", `http://localhost/scans/${id}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lead).toMatchObject({ scanId: id, email: "buyer@shop.example", hubspotStatus: "off", hubspotError: null, scanUrl: card.url });
    expect(r.pdf.fileName).toBe("crawlspace-js-only-shop.example-2026-11-01.pdf");
    const text = pdfText(r.pdf.bytes);
    expect(text).toContain("Crawlspace · by Lab Intelligence");
    expect(text).toContain(card.url);
    expect(await leads.list()).toHaveLength(1);
  });

  it("refuses a bad email, an unknown scan and an unfinished scan without storing anything", async () => {
    const { scans, leads } = fresh();
    const { id } = await doneScan(scans);
    const queued = await scans.create("https://queued.example/");
    const svc = new LeadService(scans, leads, null);
    expect(await svc.requestPdf(id, "nope", "")).toMatchObject({ ok: false, status: 400 });
    expect(await svc.requestPdf("AAAAAAAAAAAAAAAA", "a@b.com", "")).toMatchObject({ ok: false, status: 404 });
    expect(await svc.requestPdf("../../etc", "a@b.com", "")).toMatchObject({ ok: false, status: 404 });
    expect(await svc.requestPdf(queued, "a@b.com", "")).toMatchObject({ ok: false, status: 409 });
    expect(await leads.list()).toHaveLength(0);
  });

  it(`allows ${LEADS_PER_SCAN_PER_HOUR} gate submissions per scan per hour, then 429; the window slides`, async () => {
    const { db, scans } = fresh();
    const { id } = await doneScan(scans);
    let now = new Date("2026-11-18T10:00:00Z");
    const svc = new LeadService(scans, new LeadStore(db, () => now), null, () => now);
    for (let i = 0; i < LEADS_PER_SCAN_PER_HOUR; i++) expect((await svc.requestPdf(id, `p${i}@x.example`, "")).ok).toBe(true);
    expect(await svc.requestPdf(id, "late@x.example", "")).toMatchObject({ ok: false, status: 429 });
    now = new Date("2026-11-18T11:00:01Z");
    expect((await svc.requestPdf(id, "later@x.example", "")).ok).toBe(true);
  });

  it("deleting a scan deletes its leads (cascade) and the operator list counts leads per scan", async () => {
    const { db, scans, leads } = fresh();
    const a = await doneScan(scans);
    const b = await doneScan(scans, "good-event");
    const svc = new LeadService(scans, leads, null);
    await svc.requestPdf(a.id, "one@x.example", "");
    await svc.requestPdf(a.id, "two@x.example", "");
    const list = await listScans(db);
    expect(Object.fromEntries(list.map((s) => [s.id, s.leadCount]))).toEqual({ [a.id]: 2, [b.id]: 0 });
    expect(list.find((s) => s.id === b.id)!.categories).toEqual(b.card.categories);
    await db.scan.delete({ where: { id: a.id } });
    expect(await leads.list()).toHaveLength(0);
  });

  it("scanPdf is null for unknown or unfinished scans", async () => {
    const { scans } = fresh();
    expect(await scanPdf(scans, "AAAAAAAAAAAAAAAA")).toBeNull();
    expect(await scanPdf(scans, await scans.create("https://q.example/"))).toBeNull();
  });
});

describe("HubSpot submission through the gate (mocked HTTP only, D-36)", () => {
  it("flag on + 200 → the lead is marked sent, with the documented Forms payload", async () => {
    const { scans, leads } = fresh();
    const { id, card } = await doneScan(scans);
    const m = mockHttp(200);
    const svc = new LeadService(scans, leads, new HubSpotForms("123456", "abc-guid", m.http));
    const r = await svc.requestPdf(id, "lead@co.example", "https://crawlspace.example/scans/x");
    expect(r.ok && r.lead.hubspotStatus).toBe("sent");
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.url).toBe("https://api.hsforms.com/submissions/v3/integration/submit/123456/abc-guid");
    expect(m.calls[0]!.method).toBe("POST");
    expect(JSON.parse(m.calls[0]!.body)).toEqual({
      fields: [{ objectTypeId: "0-1", name: "email", value: "lead@co.example" }],
      context: { pageUri: "https://crawlspace.example/scans/x", pageName: `Crawlspace report: ${card.url}` },
    });
    expect((await leads.list())[0]!.hubspotStatus).toBe("sent");
  });

  it.each([
    [400, "HubSpot answered HTTP 400"],
    [new Error("ECONNRESET"), "could not reach HubSpot"],
    ["hang", "HubSpot did not answer in time"],
  ] as const)("HubSpot failure (%s) is recorded on the lead and the PDF is still served", async (answer, error) => {
    const { scans, leads } = fresh();
    const { id } = await doneScan(scans);
    const m = mockHttp(answer);
    const svc = new LeadService(scans, leads, new HubSpotForms("1", "g", m.http, 50));
    const r = await svc.requestPdf(id, "lead@co.example", "");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lead).toMatchObject({ hubspotStatus: "failed", hubspotError: error });
    expect(r.pdf.bytes.length).toBeGreaterThan(1000);
    expect((await leads.list())[0]).toMatchObject({ hubspotStatus: "failed", hubspotError: error });
  });
});
