import { parse } from "../html";
import type { CheckDefinition } from "./types";

const TAGS = ["og:title", "og:type", "og:image", "og:url"];

export const d2OpenGraph: CheckDefinition = {
  id: "D2",
  category: "D",
  title: "OpenGraph basics on the home page",
  appliesTo: "all",
  run({ home }) {
    const $ = parse(home.rawHtml);
    const found = TAGS.filter((t) => ($(`meta[property="${t}"]`).attr("content") ?? "").trim() !== "");
    const missing = TAGS.filter((t) => !found.includes(t));
    const detail = missing.length ? `missing ${missing.join(", ")}` : "og:title, og:type, og:image and og:url present";
    const status = found.length === TAGS.length ? "pass" : found.length === 0 ? "fail" : "partial";
    return { status, evidence: [{ url: home.url, selector: 'head meta[property^="og:"]', detail }] };
  },
};
