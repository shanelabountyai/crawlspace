import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/server/csv";

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
