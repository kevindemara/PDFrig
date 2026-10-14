export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite" className="system-state">
      <p className="eyebrow">PDFrig</p>
      <h1>Preparing the workspace…</h1>
      <p>No document has been opened or uploaded.</p>
    </main>
  );
}
