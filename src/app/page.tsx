import { BrandHeader } from "./components/BrandBar";
import { ScanForm } from "./components/ScanForm";

/** Scan form (Form.dc.html desktop, PhoneForm.dc.html at 390 px). */
export default function Home() {
  return (
    <>
      <BrandHeader />
      <main id="main" className="page narrow">
        <div className="stack">
          <h1 className="display">Can AI agents shop, book or buy on your site?</h1>
          <p className="lede">Paste your website. Usually in under a minute you&apos;ll get a score out of 100, a grade for each of six areas and a ranked list of fixes. Free, no account.</p>
        </div>
        <ScanForm />
        <div className="info-grid">
          <section className="card info-card" aria-labelledby="does-h">
            <h2 id="does-h">What the scan does</h2>
            <ul>
              <li>Reads up to 15 public pages, one per second</li>
              <li>Reads each page the way an agent does, with and without JavaScript</li>
              <li>Follows your robots.txt, as CrawlspaceBot/0.1</li>
            </ul>
          </section>
          <section className="card info-card" aria-labelledby="never-h">
            <h2 id="never-h">What it never does</h2>
            <ul>
              <li>Submit forms, add to cart or check out</li>
              <li>Log in or read pages behind an account</li>
              <li>Scan private or internal addresses</li>
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
