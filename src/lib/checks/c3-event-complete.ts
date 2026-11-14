import { EVENT_TYPES } from "../sitetype";
import { completeness } from "./completeness";
import type { CheckDefinition } from "./types";

export const c3EventComplete: CheckDefinition = {
  id: "C3",
  category: "C",
  title: "Event data is complete",
  appliesTo: ["event"],
  run(ctx) {
    return completeness(ctx.keyPages, EVENT_TYPES, "Event", {
      name: (n) => n.name,
      startDate: (n) => n.startDate,
      location: (n) => n.location,
      offers: (n) => n.offers,
    });
  },
};
