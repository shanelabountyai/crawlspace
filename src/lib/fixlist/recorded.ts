import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FixListModel, Prompt } from "./types";

export const LLM_FIXTURES_DIR = join(process.cwd(), "fixtures", "llm");

/**
 * A model that replays a committed response (tests and e2e; no network). `{{origin}}` in the text is replaced
 * by `vars.origin` so one recording works for a fixture served on any test port.
 */
export class RecordedModel implements FixListModel {
  readonly prompts: Prompt[] = [];
  constructor(private readonly response: string | Error, readonly name = "recorded model", private readonly vars: Record<string, string> = {}) {}

  static fromFixture(file: string, vars: Record<string, string> = {}): RecordedModel {
    if (!/^[a-z0-9.-]+$/.test(file)) throw new Error(`invalid recorded response name: ${file}`);
    return new RecordedModel(readFileSync(join(LLM_FIXTURES_DIR, file), "utf8"), `recorded model (${file})`, vars);
  }

  async complete(prompt: Prompt): Promise<string> {
    this.prompts.push(prompt);
    if (this.response instanceof Error) throw this.response;
    return Object.entries(this.vars).reduce((t, [k, v]) => t.split(`{{${k}}}`).join(v), this.response);
  }
}
