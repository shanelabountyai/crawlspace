import { nodesOfType } from "../html";
import type { CheckDefinition } from "./types";

const ORG_TYPES = ["Organization", "Corporation", "LocalBusiness", "OnlineStore", "OnlineBusiness", "Store", "NGO", "EducationalOrganization"];

export const c4Organization: CheckDefinition = {
  id: "C4",
  category: "C",
  title: "Organization is described in structured data",
  appliesTo: "all",
  run({ snapshot }) {
    const raw = snapshot.pages.find((p) => nodesOfType(p.rawHtml, ORG_TYPES).length > 0);
    if (raw) return { status: "pass", evidence: [{ url: raw.url, detail: "Organization JSON-LD in raw HTML" }] };
    const rendered = snapshot.pages.find((p) => nodesOfType(p.renderedHtml, ORG_TYPES).length > 0);
    if (rendered) return { status: "partial", evidence: [{ url: rendered.url, detail: "Organization JSON-LD appears only after JavaScript runs" }] };
    return { status: "fail", evidence: [{ detail: "no Organization JSON-LD on any page" }] };
  },
};
