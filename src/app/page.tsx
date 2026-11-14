export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Crawlspace</h1>
      <p>Agent-readiness scanner. Phase 1 ships the pure scoring engine only.</p>
      <p>
        Try it from the command line: <code>npm run scan:fixture good-shop</code>. The web UI arrives in Phase 3.
      </p>
    </main>
  );
}
