import { useState } from 'react';

/** UI credit only: never included in document content or exported PDFs. */
export const DeveloperCredit = ({
  openProfile,
}: {
  readonly openProfile?: (() => Promise<void>) | undefined;
}) => {
  const [failed, setFailed] = useState(false);
  return (
    <div className="status-bar__credit">
      <span className="status-bar__credit-label">Developed by </span>
      <a
        aria-label="Kevin DeMara on GitHub"
        href="https://github.com/kevindemara"
        onClick={
          openProfile === undefined
            ? undefined
            : (event) => {
                event.preventDefault();
                setFailed(false);
                void openProfile().catch(() => setFailed(true));
              }
        }
        rel="noopener noreferrer"
        target="_blank"
        title="Kevin DeMara on GitHub (opens in your browser)"
      >
        Kevin DeMara <span aria-hidden="true">↗</span>
      </a>
      {failed && <span role="status">Couldn’t open GitHub.</span>}
    </div>
  );
};
