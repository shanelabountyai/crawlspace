import type { FixListModel, Prompt } from "@/lib/fixlist";

/**
 * Live fix-list model: Anthropic Messages API. Used only when ANTHROPIC_API_KEY is set (D-25, D-31).
 * Never called by tests or CI. Any error makes the fix list fall back to templates.
 */
export const DEFAULT_FIXLIST_MODEL = "claude-sonnet-4-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export class AnthropicModel implements FixListModel {
  readonly name: string;
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_FIXLIST_MODEL,
    private readonly timeoutMs = 20_000,
    private readonly maxTokens = 2_000,
  ) {
    this.name = `Anthropic ${model}`;
  }

  async complete(prompt: Prompt): Promise<string> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`model API returned HTTP ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    if (!text) throw new Error("model API returned no text");
    return text;
  }
}

/** The configured live model, or null (→ templates) when no key is set. */
export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): FixListModel | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return new AnthropicModel(key, env.CRAWLSPACE_FIXLIST_MODEL?.trim() || DEFAULT_FIXLIST_MODEL);
}
