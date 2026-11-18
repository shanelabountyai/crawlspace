import { inflateSync } from "node:zlib";

/**
 * Minimal text extraction for PDFs written by src/lib/report/pdf.ts (pdf-lib, standard fonts, no object streams):
 * walk the page tree (/Kids order), inflate each page's content streams and decode the strings shown with Tj.
 * Returns one string per page, in page order.
 */
export function pdfPageTexts(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  const objects = new Map<number, { dict: string; stream?: Buffer }>();
  const re = /(\d+) 0 obj\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endobj", start);
    const body = raw.slice(start, end);
    const s = body.search(/stream\r?\n/);
    if (s >= 0) {
      const dataStart = start + s + (/stream\r\n/.test(body.slice(s, s + 8)) ? 8 : 7);
      const dataEnd = raw.indexOf("endstream", dataStart);
      const dict = body.slice(0, s);
      let data = buf.subarray(dataStart, dataEnd);
      if (/\/FlateDecode/.test(dict)) data = inflateSync(data);
      objects.set(Number(m[1]), { dict, stream: data });
    } else {
      objects.set(Number(m[1]), { dict: body });
    }
  }
  const pagesRoot = [...objects.values()].find((o) => /\/Type\s*\/Pages\b/.test(o.dict));
  const kids = [...(pagesRoot?.dict.match(/\/Kids\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((k) => Number(k[1]));
  return kids.map((id) => {
    const page = objects.get(id)!.dict;
    const contents = page.match(/\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/)?.[1] ?? "";
    const parts: string[] = [];
    for (const ref of contents.matchAll(/(\d+) 0 R/g)) {
      const content = objects.get(Number(ref[1]))?.stream?.toString("latin1") ?? "";
      for (const t of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
        parts.push(t[1] !== undefined ? Buffer.from(t[1], "hex").toString("latin1") : t[2]!.replace(/\\(.)/g, "$1"));
      }
    }
    return parts.join("\n");
  });
}

export const pdfText = (bytes: Uint8Array) => pdfPageTexts(bytes).join("\n");
