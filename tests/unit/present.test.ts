import { describe, expect, it } from "vitest";
import { formatWhen, hostOf, plainError, readinessFor, STATUS, toneClass } from "@/app/components/present";
import { STATUSES } from "@/lib/rules";

// Design pass (D-48..D-53): presentation words only; the letter bands stay those of D-34.
describe("report presentation helpers", () => {
  it("every check status has a word, a glyph and a tone (word → glyph → colour)", () => {
    for (const s of STATUSES) {
      expect(STATUS[s].word.length, s).toBeGreaterThan(1);
      expect(STATUS[s].glyph.length, s).toBe(1);
      expect(STATUS[s].tone, s).toMatch(/^(pass|partial|fail|na)$/);
    }
  });

  it("readiness follows the D-34 letter tone at the band edges", () => {
    expect(readinessFor(80).word).toBe("Ready");
    expect(readinessFor(79.9).word).toBe("Partly ready");
    expect(readinessFor(60).word).toBe("Partly ready");
    expect(readinessFor(59.9).word).toBe("Not ready");
    expect(readinessFor(null).word).toBe("Nothing to score");
    expect(toneClass(95)).toBe("good");
    expect(toneClass(0)).toBe("bad");
  });

  it("refusals read as plain words and keep the server's reason verbatim", () => {
    expect(plainError("refused: 127.0.0.1 is a private, loopback, link-local or reserved address")).toEqual({
      lead: "Not scanned.",
      detail: "127.0.0.1 is a private, loopback, link-local or reserved address.",
    });
    expect(plainError("refused: robots.txt disallows CrawlspaceBot from /; not scanning").detail).toBe("robots.txt disallows CrawlspaceBot from /; not scanning.");
    expect(plainError("scan failed: boom").lead).toBe("The scan failed.");
    expect(plainError("enter a website address")).toEqual({ lead: "", detail: "Enter a website address." });
  });

  it("dates render in UTC with a fixed locale, so server and browser agree", () => {
    expect(formatWhen("2026-11-18T16:05:00.000Z")).toBe("Nov 18, 2026, 4:05 PM UTC");
    expect(formatWhen(null)).toBe("");
    expect(hostOf("http://goodshop.test:7911/")).toBe("goodshop.test:7911");
    expect(hostOf("not a url")).toBe("not a url");
  });
});
