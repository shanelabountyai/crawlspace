import { z } from "zod";
import type { Category, Evidence } from "../checks/types";
import type { Status } from "../rules";

/** One failed or partial check, as handed to the model and the templates. Pass and N/A never get here. */
export interface FixInput {
  checkId: string;
  title: string;
  category: Category;
  status: Extract<Status, "fail" | "partial">;
  weight: number;
  label?: "heuristic" | "proposed convention";
  evidence: Evidence[];
}

export type FixSource = "llm" | "template";

export interface FixItem {
  checkId: string;
  title: string;
  /** Why it matters to an agent, citing the evidence. */
  why: string;
  /** What to change. */
  how: string;
  /** Evidence URLs this fix refers to (always a subset of the input's evidence URLs). */
  evidenceUrls: string[];
  source: FixSource;
}

export const DROP_REASONS = ["malformed", "unknown-check", "unknown-url", "unknown-check-in-text", "duplicate"] as const;
export type DropReason = (typeof DROP_REASONS)[number];

export interface DroppedItem {
  reason: DropReason;
  detail: string;
}

export interface FixList {
  /** `llm` = every item from the model; `mixed` = model items plus templates for what it missed; `template` = no model output used. */
  source: "llm" | "mixed" | "template";
  items: FixItem[];
  dropped: { total: number; byReason: Record<DropReason, number>; items: DroppedItem[] };
  /** Why the model was not used (no key, error, unparseable output). */
  note?: string;
}

export interface Prompt {
  system: string;
  user: string;
}

/** The only thing the fix list needs from a language model. Live adapters live outside src/lib (no network here). */
export interface FixListModel {
  readonly name: string;
  complete(prompt: Prompt): Promise<string>;
}

/** What the model is asked to return (one entry per fix). */
export const ModelFixSchema = z
  .object({
    checkId: z.string().min(1),
    title: z.string().min(1).max(200),
    why: z.string().min(1).max(1200),
    how: z.string().min(1).max(2000),
    evidenceUrls: z.array(z.string()).max(20).default([]),
  })
  .strip();
export type ModelFix = z.infer<typeof ModelFixSchema>;
