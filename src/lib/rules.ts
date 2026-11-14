import { z } from "zod";
import weightsJson from "../../rules/weights.json";
import agentsJson from "../../rules/agents.json";

export const STATUSES = ["pass", "partial", "fail", "not-applicable"] as const;
export type Status = (typeof STATUSES)[number];

export const WeightsSchema = z
  .object({
    version: z.number().int(),
    statusValues: z.object({ pass: z.number(), partial: z.number(), fail: z.number() }).strict(),
    checks: z.record(z.string().regex(/^[A-F]\d+$/), z.number().nonnegative()),
  })
  .passthrough();
export type Weights = z.infer<typeof WeightsSchema>;

export const AgentSchema = z
  .object({
    token: z.string().min(1),
    operator: z.string().min(1),
    purpose: z.string().optional(),
    verifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.string().url(),
  })
  .strict();
export type Agent = z.infer<typeof AgentSchema>;

export const AgentsFileSchema = z
  .object({
    agents: z.array(AgentSchema),
  })
  .passthrough();

export function loadWeights(data: unknown = weightsJson): Weights {
  return WeightsSchema.parse(data);
}

export function loadAgents(data: unknown = agentsJson): Agent[] {
  return AgentsFileSchema.parse(data).agents;
}
