'use client';

export default function ErrorPage({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <main className="system-state" role="alert">
      <p className="eyebrow">Workspace unavailable</p>
      <h1>The shell could not start.</h1>
      <p>Your original file was not changed. Try loading the workspace again.</p>
      <button className="button button--primary" onClick={reset} type="button">
        Try again
      </button>
    </main>
  );
}
