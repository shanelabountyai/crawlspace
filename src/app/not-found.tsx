import Link from "next/link";
import { BrandHeader } from "./components/BrandBar";

/** Unknown report link (ScanOutcomes.dc.html). */
export default function NotFound() {
  return (
    <>
      <BrandHeader />
      <main id="main" className="page narrow">
        <section className="card signin-card stack" aria-labelledby="nf-h" data-testid="not-found">
          <h1 id="nf-h" className="title">
            We can&apos;t find that page
          </h1>
          <p className="body-2">Report links are private and hard to guess. Check the link you were given, or scan the site again.</p>
          <p>
            <Link href="/" className="btn btn-primary">
              Scan a site
            </Link>
          </p>
        </section>
      </main>
    </>
  );
}
