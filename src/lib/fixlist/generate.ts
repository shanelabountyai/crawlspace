import { loadWeights, type Weights } from "../rules";
import type { Scorecard } from "../scan";
import { fixInputs } from "./input";
import { buildPrompt } from "./prompt";
import { templateFix } from "./templates";
import { DROP_REASONS, type DropReason, type FixInput, type FixList, type FixListModel } from "./types";
import { parseModelOutput, validateFixes } from "./validate";

export interface GenerateOptions {
  /** Absent → template fallback (PRD §3: "Without an API key, a template per check ID is used"). */
  model?: FixListModel | null;
  weights?: Weights;
}

const noDrops = (): Record<DropReason, number> => Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as Record<DropReason, number>;

/** Points a check loses in the overall score: weight × (1 − status value). */
export function pointsLost(input: FixInput, weights: Weights): number {
  return input.weight * (1 - weights.statusValues[input.status]);
}

/** Template items, ranked by points lost (ties: rubric order). D-30. */
export function rankTemplates(inputs: readonly FixInput[], weights: Weights) {
  return inputs
    .map((input, order) => ({ input, order, lost: pointsLost(input, weights) }))
    .sort((a, b) => b.lost - a.lost || a.order - b.order)
    .map(({ input }) => templateFix(input));
}

export function templateFixList(card: Scorecard, weights: Weights = loadWeights(), note?: string): FixList {
  const items = rankTemplates(fixInputs(card), weights);
  return { source: "template", items, dropped: { total: 0, byReason: noDrops(), items: [] }, ...(note ? { note } : {}) };
}

/**
 * Turn a scorecard into a ranked fix list. With a model: prompt → validate (CS-04) → templates for anything the model
 * did not validly cover. Without one, or if the model fails or returns something unparseable: templates only.
 */
export async function generateFixList(card: Scorecard, opts: GenerateOptions = {}): Promise<FixList> {
  const weights = opts.weights ?? loadWeights();
  const inputs = fixInputs(card);
  if (inputs.length === 0) return templateFixList(card, weights);
  if (!opts.model) return templateFixList(card, weights, "no language model configured; template fixes used");

  let raw: unknown[];
  try {
    const text = await opts.model.complete(buildPrompt(card.url, inputs));
    raw = parseModelOutput(text);
  } catch (e) {
    return templateFixList(card, weights, `${opts.model.name} not used (${e instanceof Error ? e.message : String(e)}); template fixes used`);
  }

  const v = validateFixes(raw, inputs);
  const covered = new Set(v.kept.map((k) => k.checkId));
  const rest = rankTemplates(inputs.filter((i) => !covered.has(i.checkId)), weights);
  const items = [...v.kept, ...rest];
  const source = v.kept.length === 0 ? "template" : rest.length === 0 ? "llm" : "mixed";
  return { source, items, dropped: { total: v.dropped.length, byReason: v.byReason, items: v.dropped } };
}
