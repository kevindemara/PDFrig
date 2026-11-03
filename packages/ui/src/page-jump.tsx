'use client';
import { useId, useState } from 'react';

// VIEW-004: page numbers always refer to the current working copy.
export const pageJumpIndex = (value: string, count: number): number | null => {
  if (!/^[0-9]+$/u.test(value.trim())) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= count ? page - 1 : null;
};

export function PageJump({
  current,
  count,
  onJump,
}: {
  readonly current: number;
  readonly count: number;
  readonly onJump: (index: number) => void;
}) {
  const [draft, setDraft] = useState(String(current));
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  return (
    <form
      className="page-jump"
      onSubmit={(event) => {
        event.preventDefault();
        const index = pageJumpIndex(draft, count);
        setInvalid(index === null);
        if (index !== null) {
          setDraft(String(index + 1));
          onJump(index);
        }
      }}
    >
      <label>
        Page{' '}
        <input
          aria-label="Go to page"
          inputMode="numeric"
          type="text"
          value={draft}
          maxLength={6}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setDraft(String(current));
              setInvalid(false);
            }
          }}
        />
      </label>
      <span>/ {count}</span>
      <button type="submit" aria-label="Go to page">
        Go
      </button>
      {invalid && (
        <span id={errorId} role="alert">
          Enter a page from 1 to {count}.
        </span>
      )}
    </form>
  );
}
