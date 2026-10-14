import type { ReactNode } from 'react';

// Original PDFrig line drawings. Shared VIEW-001 / VIEW-004 editor chrome;
// no icon font, remote asset, or additional dependency is required.
const artwork = {
  collapse: <path d="m14 5-7 7 7 7M21 5l-7 7 7 7" />,
  expand: <path d="m3 5 7 7-7 7M10 5l7 7-7 7" />,
  open: <path d="M3 19V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 19l3-8h16l-3 8H3Z" />,
  pages: (
    <>
      <path d="M8 3h10a2 2 0 0 1 2 2v12M4 7h10a2 2 0 0 1 2 2v11H4V7Z" />
      <path d="M7 11h6M7 14h6M7 17h3" />
    </>
  ),
  text: (
    <>
      <path d="M3 5h13M3 10h9M3 15h7M3 20h11M17 8h4M19 8v12M17 20h4" />
    </>
  ),
  markup: (
    <>
      <path d="m6 14 8-10 5 4-8 10-5-4Zm0 0-2 5 5-2M3 21h12M12 7l5 4" />
    </>
  ),
  draw: (
    <>
      <path d="m14 4 3-1 4 4-1 3-9 9-5 1 1-5 7-11ZM14 4l6 6" />
      <path d="M3 7c7-5 8 4 3 5-6 2-4 7 0 8" />
    </>
  ),
  shapes: (
    <>
      <path d="M3 4h12v12H3z" />
      <circle cx="16" cy="16" r="5" />
    </>
  ),
  comment: (
    <>
      <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-6 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M7 8h10M7 12h7" />
    </>
  ),
  measure: (
    <>
      <path d="m3 15 12-12 6 6-12 12-6-6Z" />
      <path d="m6 12 2 2m1-5 3 3m0-6 2 2m1-5 3 3" />
    </>
  ),
  stamp: (
    <>
      <path d="M9 10V6a3 3 0 0 1 6 0v4c0 2 4 3 4 6H5c0-3 4-4 4-6ZM4 16h16v4H4zM7 23h10" />
    </>
  ),
  fill: (
    <>
      <path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h7M8 16h3" />
      <path d="m13 17 2 2 4-4" />
    </>
  ),
  sign: (
    <>
      <path d="M3 16c8-6 12-15 8-13-5 2-6 17-1 13l4-4c-2 7 2 5 4 2 0 3 2 3 4 1M3 21h18" />
    </>
  ),
  redact: (
    <>
      <path d="M5 3h10l4 4v14H5V3ZM14 3v5h5M8 11h8M8 15h8M8 18h5" strokeWidth="3" />
    </>
  ),
  pdf: (
    <>
      <path d="M14 3H4v18h9M14 3v5h5V8l-5-5ZM8 12h4M8 16h3M18 14v8M14 18h8" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8" cy="9" r="1.5" />
      <path d="m4 18 5-5 4 3 4-5 4 7" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type ToolIconName = keyof typeof artwork;

/** Decorative: the owning button always supplies its visible, accessible label. */
export const ToolIcon = ({ name }: { readonly name: ToolIconName }) => (
  <svg
    aria-hidden="true"
    className="tool-icon"
    data-tool-icon={name}
    fill="none"
    focusable="false"
    height="24"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.7"
    viewBox="0 0 24 24"
    width="24"
  >
    {artwork[name]}
  </svg>
);
