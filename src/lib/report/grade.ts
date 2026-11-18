/**
 * How scores are shown (D-34, owner decision 2026-11-17): the overall score over 100 and an A–F letter per category.
 * Presentation only: the scores themselves come from src/lib/score.ts and are never changed here.
 */
export type Letter = "A" | "B" | "C" | "D" | "F" | "N/A";
export type Tone = "good" | "mid" | "bad" | "na";

/** Lowest score (inclusive) for each letter, best first. Anything below the last band is F. */
export const GRADE_BANDS: readonly { letter: Exclude<Letter, "F" | "N/A">; min: number }[] = [
  { letter: "A", min: 90 },
  { letter: "B", min: 80 },
  { letter: "C", min: 70 },
  { letter: "D", min: 60 },
];

/** Letter for a 0–100 score; `N/A` when the category had no applicable checks (score null). */
export function letterFor(score: number | null): Letter {
  if (score === null || !Number.isFinite(score)) return "N/A";
  for (const b of GRADE_BANDS) if (score >= b.min) return b.letter;
  return "F";
}

export function gradeTone(letter: Letter): Tone {
  if (letter === "A" || letter === "B") return "good";
  if (letter === "C" || letter === "D") return "mid";
  if (letter === "F") return "bad";
  return "na";
}

/** The score as stored (one decimal), without the "/100". */
export function formatScore(score: number | null): string {
  return score === null || !Number.isFinite(score) ? "n/a" : score.toFixed(1);
}

/** `72.5/100`, or `n/a` when nothing applicable was scored. */
export function formatOutOf100(score: number | null): string {
  const s = formatScore(score);
  return s === "n/a" ? s : `${s}/100`;
}
