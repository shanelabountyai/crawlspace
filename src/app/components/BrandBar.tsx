import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/report/brand";

/** The Lab Intelligence mark from the design canvas (inline SVG, no logo file; D-33, D-48). */
function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect className="brand-mark-bg" x="1" y="1" width="26" height="26" rx="7" />
      <path className="brand-mark-fg" d="M9 7v11a3 3 0 0 0 3 3h7" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle className="brand-mark-dot" cx="19" cy="9" r="2.4" />
    </svg>
  );
}

/** Lab Intelligence branding on every page (D-33): "Lab Intelligence / Crawlspace" as in the artboards. */
export function BrandHeader({ trail, action }: { trail?: string; action?: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header" data-testid="brand-header">
        <div className="site-header-inner">
          <Link href="/" className="brand" aria-label={`${BRAND.wordmark}: new scan`}>
            <Mark />
            <span className="brand-name">{BRAND.company}</span>
            <span className="brand-trail">
              / {BRAND.product}
              {trail ? ` / ${trail}` : ""}
            </span>
          </Link>
          {action}
        </div>
      </header>
    </>
  );
}

export function BrandFooter() {
  return (
    <footer className="site-footer" data-testid="brand-footer">
      <div className="site-footer-inner">
        <p>CrawlspaceBot/0.1 read up to 15 public pages at one request per second and obeyed robots.txt. It never submits forms, logs in, or reads private addresses.</p>
        <p>
          A {BRAND.company} tool. Scores describe how an AI agent sees a site at the time of the scan; they are not a ranking of the business.
        </p>
        <p>
          {BRAND.wordmark} · {BRAND.address}
        </p>
      </div>
    </footer>
  );
}
