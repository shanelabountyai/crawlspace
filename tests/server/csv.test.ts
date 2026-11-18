import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/server/csv";
import { newScanId, SCAN_ID_RE } from "@/server/store";

describe("operator CSV export (D-40)", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", null]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",\r\n');
  });

  it.each(["=HYPERLINK(\"http://x\")", "+1", "-1+2", "@SUM(A1)", "\tx"])("neutralises formula-like cell %j", (v) => {
    expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("leaves ordinary values alone", () => {
    expect(csvCell("https://shop.example/")).toBe("https://shop.example/");
    expect(csvCell(72.5)).toBe("72.5");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("scan ids survive the CSV export exactly (D-46)", () => {
  // randomBytes base64url ids start with "-" about 1 time in 64; the formula guard then rewrote them to "'-…",
  // so leads.csv / scans.csv carried an id that matches no scan (seen in CI run 44359791467).
  it("a new scan id never starts with a character the formula guard rewrites", () => {
    for (let i = 0; i < 5000; i++) {
      const id = newScanId();
      expect(id).toMatch(SCAN_ID_RE);
      expect(csvCell(id)).toBe(id);
    }
  });
});
