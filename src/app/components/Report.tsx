import { CATEGORIES, type Category } from "@/lib/checks/types";
import { formatScore, gradeTone, letterFor } from "@/lib/report/grade";
import type { ReportView } from "@/server/store";

const STATUS_TEXT = { pass: "Pass", partial: "Partial", fail: "Fail", "not-applicable": "N/A" } as const;

/** Colour follows the letter grade (D-34). */
const scoreClass = (v: number | null) => `score-${gradeTone(letterFor(v))}`;

export function Report({ report, scannedAt }: { report: ReportView; scannedAt: string | null }) {
  const { scorecard: card, fixList, crawl } = report;
  const sourceText =
    fixList.source === "llm" ? "Written by AI, checked against the scan evidence" : fixList.source === "mixed" ? "AI-written where it passed validation, templates for the rest" : "Standard fixes for each failed check";
  return (
    <div className="report">
      <section className="summary" aria-label="Score">
        <div className={`overall ${scoreClass(card.overall)}`} data-testid="overall-score">
          <span className="overall-num">{formatScore(card.overall)}</span>
          {card.overall === null ? null : <span className="overall-outof">/100</span>}
          <span className="overall-label">overall</span>
        </div>
        <div>
          <p className="site-url" data-testid="final-url">{report.finalUrl}</p>
          <p className="meta">
            Site type <strong data-testid="site-type">{card.siteType}</strong> ({card.siteTypeSource}) · rubric v{card.rubricVersion}
            {scannedAt ? <> · scanned {new Date(scannedAt).toUTCString()}</> : null}
          </p>
          <ul className="categories">
            {(Object.keys(CATEGORIES) as Category[]).map((k) => {
              const letter = letterFor(card.categories[k]);
              return (
                <li key={k} className={scoreClass(card.categories[k])} data-testid={`category-${k}`} data-grade={letter}>
                  <span className="cat-grade" aria-label={`grade ${letter}`}>
                    {letter}
                  </span>
                  <span className="cat-name">{CATEGORIES[k]}</span>
                  <span className="cat-score">{formatScore(card.categories[k])}</span>
                </li>
              );
            })}
          </ul>
          <p className="meta grade-key">Grades: A 90+, B 80+, C 70+, D 60+, F below 60. Checks that do not apply are left out of the score.</p>
        </div>
      </section>

      <section aria-labelledby="fixes-h">
        <h2 id="fixes-h">Fix list</h2>
        {fixList.items.length === 0 ? (
          <p data-testid="no-fixes">Nothing to fix: every applicable check passed.</p>
        ) : (
          <>
            <p className="meta" data-testid="fix-source">{sourceText}.</p>
            {fixList.dropped.total > 0 ? (
              <p className="notice" data-testid="fix-dropped">
                {fixList.dropped.total} AI suggestion{fixList.dropped.total === 1 ? " was" : "s were"} dropped because{" "}
                {fixList.dropped.total === 1 ? "it" : "they"} cited a check or page that is not in this scan.
              </p>
            ) : null}
            <ol className="fixes" data-testid="fix-list">
              {fixList.items.map((f) => (
                <li key={f.checkId} data-check={f.checkId} data-source={f.source}>
                  <h3>
                    {f.title} <span className="check-id">{f.checkId}</span>
                  </h3>
                  <p>{f.why}</p>
                  <p>
                    <strong>Fix:</strong> {f.how}
                  </p>
                  {f.evidenceUrls.length ? (
                    <p className="evidence-urls">
                      Evidence:{" "}
                      {f.evidenceUrls.map((u) => (
                        <code key={u}>{u}</code>
                      ))}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section aria-labelledby="checks-h">
        <h2 id="checks-h">All checks</h2>
        <div className="table-wrap">
          <table className="checks" data-testid="checks">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Check</th>
                <th scope="col">Result</th>
                <th scope="col">Weight</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {card.checks.map((c) => (
                <tr key={c.id} data-check={c.id} data-status={c.status}>
                  <td>{c.id}</td>
                  <td>
                    {c.title}
                    {c.label ? <span className="label">{c.label}</span> : null}
                  </td>
                  <td>
                    <span className={`status status-${c.status}`}>{STATUS_TEXT[c.status]}</span>
                  </td>
                  <td>{c.weight}</td>
                  <td>
                    <ul className="evidence">
                      {c.evidence.map((e, i) => (
                        <li key={i}>
                          {e.detail}
                          {e.url ? <code>{e.url}</code> : null}
                          {e.selector ? <code>{e.selector}</code> : null}
                          {e.line ? <span className="line">line {e.line}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="crawl-h" className="crawl">
        <h2 id="crawl-h">How this site was read</h2>
        <p data-testid="crawl-summary">
          {crawl.pageRequests} page requests and {crawl.assetRequests} script requests, all GET, at most one per second, as CrawlspaceBot;{" "}
          {crawl.blockedBrowserRequests} other browser requests blocked. N/A checks do not count toward the score.
        </p>
        {crawl.skipped.length ? (
          <ul>
            {crawl.skipped.map((s) => (
              <li key={s.url}>
                skipped <code>{s.url}</code>: {s.reason}
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
    </div>
  );
}
