import { CATEGORIES, type Category } from "@/lib/checks/types";
import { formatScore, letterFor } from "@/lib/report/grade";
import { FIX_SOURCE_TEXT } from "@/lib/report/words";
import type { ReportView } from "@/server/store";
import { formatWhen, hostOf, LABEL_TEXT, readinessFor, SITE_TYPE_SOURCE, SITE_TYPE_WORD, STATUS, toneClass } from "./present";

const SOURCE_TEXT = FIX_SOURCE_TEXT;

function Sparkle() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M7 1l1.6 3.6L12 6l-3.4 1.4L7 11 5.4 7.4 2 6l3.4-1.4z" fill="none" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

/** The report (Main.dc.html desktop, Phone.dc.html at 390 px). Every value comes from the stored scan. */
export function Report({ report, scannedAt }: { report: ReportView; scannedAt: string | null }) {
  const { scorecard: card, fixList, crawl } = report;
  const counts = { pass: 0, partial: 0, fail: 0, "not-applicable": 0 };
  for (const c of card.checks) counts[c.status]++;
  const applicable = card.checks.length - counts["not-applicable"];
  const ready = readinessFor(card.overall);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <>
      <section aria-label="Scan details" className="scan-details">
        <span className="scan-host">{hostOf(report.finalUrl)}</span>
        <span>
          Site type: <strong data-testid="site-type">{SITE_TYPE_WORD[card.siteType] ?? card.siteType}</strong> ({SITE_TYPE_SOURCE[card.siteTypeSource] ?? card.siteTypeSource})
        </span>
        <span>
          {plural(crawl.pageRequests, "page request", "page requests")} (15 at most){scannedAt ? <> · {formatWhen(scannedAt)}</> : null}
        </span>
        <span>
          Scanned URL <code data-testid="final-url">{report.finalUrl}</code> · rubric v{card.rubricVersion}
        </span>
      </section>

      <section aria-labelledby="score-h" className="score-card">
        <div className="score-main" data-testid="overall-score">
          <h1 id="score-h" className="score-h">
            Agent-readiness score
          </h1>
          <div className="score-line">
            <span className="overall-num">{formatScore(card.overall)}</span>
            {card.overall === null ? null : <span className="overall-outof">/ 100</span>}
          </div>
          <span className={`pill pill-lg tone-${ready.tone}`} data-testid="readiness">
            <span aria-hidden="true">{ready.glyph}</span>
            {ready.word}
          </span>
        </div>
        <div className="score-text">
          <p data-testid="score-summary">
            {applicable === 0
              ? "No check applied to this site, so there is nothing to score."
              : `${counts.pass} of ${applicable} checks that apply passed, ${counts.partial} passed in part and ${counts.fail} failed.`}{" "}
            {fixList.items.length ? "Start with the first fix below." : ""}
          </p>
          {counts["not-applicable"] > 0 ? (
            <p className="meta">
              {plural(counts["not-applicable"], "check", "checks")} did not apply to this site and {counts["not-applicable"] === 1 ? "is" : "are"} left out of the score, not counted as{" "}
              {counts["not-applicable"] === 1 ? "a pass" : "passes"}.
            </p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="cat-h" className="stack">
        <h2 id="cat-h" className="section-title">
          Score by category
        </h2>
        <ul className="categories">
          {(Object.keys(CATEGORIES) as Category[]).map((k) => {
            const v = card.categories[k];
            const letter = letterFor(v);
            const tone = toneClass(v);
            return (
              <li key={k} className="cat" data-testid={`category-${k}`} data-grade={letter}>
                <div className="cat-top">
                  <span className="cat-key" aria-hidden="true">
                    {k} · {CATEGORIES[k].split(" ")[0]}
                  </span>
                  <span>
                    <span className="sr-only">Grade </span>
                    <span className={`cat-grade fg-${tone}`}>{letter}</span>
                  </span>
                </div>
                <span className="cat-name">{CATEGORIES[k]}</span>
                <div className="cat-bar" aria-hidden="true">
                  <span className={`bg-${tone}`} style={{ width: `${v === null ? 0 : Math.max(0, Math.min(100, v))}%` }} />
                </div>
                <span className="cat-score">{v === null ? "No checks apply" : `${formatScore(v)} / 100 · ${readinessFor(v).word}`}</span>
              </li>
            );
          })}
        </ul>
        <p className="meta grade-key">Grades: A 90–100 · B 80–89 · C 70–79 · D 60–69 · F below 60.</p>
      </section>

      <section aria-labelledby="fixes-h" className="stack">
        <div className="fix-head">
          <h2 id="fixes-h" className="section-title">
            Fix these first
          </h2>
          {fixList.items.length ? (
            <span className="chip" data-testid="fix-source">
              <Sparkle />
              {SOURCE_TEXT[fixList.source]}
            </span>
          ) : null}
        </div>
        {fixList.items.length === 0 ? (
          <p className="callout good" data-testid="no-fixes">
            <span className="callout-glyph" aria-hidden="true">
              ✓
            </span>
            <span>
              <strong>Nothing to fix.</strong> Every applicable check passed.
            </span>
          </p>
        ) : (
          <>
            {fixList.dropped.total > 0 ? (
              <p className="callout mid" data-testid="fix-dropped">
                <span className="callout-glyph" aria-hidden="true">
                  ◐
                </span>
                <span>
                  {fixList.dropped.total} AI suggestion{fixList.dropped.total === 1 ? " was" : "s were"} dropped because {fixList.dropped.total === 1 ? "it" : "they"} cited a check or page
                  that is not in this scan.
                </span>
              </p>
            ) : null}
            <ol className="fixes" data-testid="fix-list">
              {fixList.items.map((f, i) => (
                <li key={f.checkId} className="card fix" data-check={f.checkId} data-source={f.source}>
                  <span className="fix-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="fix-body">
                    <h3 className="fix-title">{f.title}</h3>
                    <p>{f.why}</p>
                    <p className="fix-how">
                      <strong>Fix:</strong> {f.how}
                    </p>
                    <p className="fix-ev">
                      {f.evidenceUrls.length ? (
                        <>
                          Evidence:{" "}
                          {f.evidenceUrls.map((u) => (
                            <code key={u} className="code-chip">
                              {u}
                            </code>
                          ))}{" "}
                          ·{" "}
                        </>
                      ) : null}
                      Check <span className="check-id">{f.checkId}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section aria-labelledby="checks-h" className="stack">
        <h2 id="checks-h" className="section-title">
          Every check
        </h2>
        <div className="table-wrap">
          <table className="data checks" data-testid="checks">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Result</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {card.checks.map((c) => {
                const s = STATUS[c.status];
                return (
                  <tr key={c.id} data-check={c.id} data-status={c.status} className={c.status === "not-applicable" ? "check-na" : undefined}>
                    <td>
                      <div className="check-name">
                        <span>
                          {c.id} · {c.title}
                        </span>
                        {c.label ? <span className="check-label">{LABEL_TEXT[c.label] ?? c.label}</span> : null}
                      </div>
                    </td>
                    <td className="nowrap">
                      <span className={`pill tone-${s.tone}`}>
                        <span aria-hidden="true">{s.glyph}</span>
                        {s.word}
                      </span>
                    </td>
                    <td>
                      <ul className="evidence">
                        {c.evidence.map((e, i) => (
                          <li key={i}>
                            {e.detail}
                            {e.url ? <code>{e.url}</code> : null}
                            {e.selector ? <code>{e.selector}</code> : null}
                            {e.line ? <span className="meta"> line {e.line}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="crawl-h" className="stack crawl">
        <h2 id="crawl-h" className="section-title">
          How this site was read
        </h2>
        <p data-testid="crawl-summary">
          {crawl.pageRequests} page requests and {crawl.assetRequests} script requests, all GET, at most one per second, as CrawlspaceBot; {crawl.blockedBrowserRequests} other browser
          requests blocked.
        </p>
        {crawl.skipped.length ? (
          <ul>
            {crawl.skipped.map((s) => (
              <li key={s.url}>
                Skipped <code>{s.url}</code>: {s.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {crawl.notes.length ? (
          <ul>
            {crawl.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}
