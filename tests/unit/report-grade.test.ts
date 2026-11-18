import { describe, expect, it } from "vitest";
import { GRADE_BANDS, formatOutOf100, formatScore, gradeTone, letterFor } from "@/lib/report/grade";
import { BRAND } from "@/lib/report/brand";

describe("score presentation (D-34)", () => {
  it.each([
    [100, "A"],
    [90, "A"],
    [89.9, "B"],
    [80, "B"],
    [79.9, "C"],
    [70, "C"],
    [69.9, "D"],
    [60, "D"],
    [59.9, "F"],
    [0, "F"],
  ] as const)("%s → %s", (score, letter) => {
    expect(letterFor(score)).toBe(letter);
  });

  it("a category with no applicable checks has no letter", () => {
    expect(letterFor(null)).toBe("N/A");
    expect(letterFor(Number.NaN)).toBe("N/A");
    expect(gradeTone("N/A")).toBe("na");
  });

  it("bands are A 90, B 80, C 70, D 60, best first", () => {
    expect(GRADE_BANDS.map((b) => `${b.letter}${b.min}`)).toEqual(["A90", "B80", "C70", "D60"]);
  });

  it("tones follow the letter", () => {
    expect(["A", "B", "C", "D", "F"].map((l) => gradeTone(l as "A"))).toEqual(["good", "good", "mid", "mid", "bad"]);
  });

  it("overall is shown over 100 with the stored precision, never re-rounded", () => {
    expect(formatOutOf100(72.5)).toBe("72.5/100");
    expect(formatOutOf100(100)).toBe("100.0/100");
    expect(formatOutOf100(null)).toBe("n/a");
    expect(formatScore(33.3)).toBe("33.3");
  });

  it("brand is Lab Intelligence with the public business address (D-33)", () => {
    expect(BRAND.wordmark).toBe("Crawlspace · by Lab Intelligence");
    expect(BRAND.address).toBe("9905 S Pennsylvania Ave, Oklahoma City, OK 73159");
  });
});
