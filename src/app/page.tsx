import { ScanForm } from "./components/ScanForm";

export default function Home() {
  return (
    <main className="page narrow">
      <h1>Crawlspace</h1>
      <p className="lede">How well can AI agents read and act on your site? Paste an address and get a scorecard plus a ranked fix list.</p>
      <ScanForm />
      <ul className="facts">
        <li>18 checks across access, readability without JavaScript, structured data, machine guidance, actionability and speed.</li>
        <li>A polite crawl: obeys robots.txt, reads at most 15 pages, one request per second, never submits a form.</li>
        <li>Fixes only cite what the scan actually found.</li>
      </ul>
    </main>
  );
}
