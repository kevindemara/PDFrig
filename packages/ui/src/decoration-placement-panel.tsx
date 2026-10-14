import type { DecorationPlacementReview, DecorationReviewBand } from '@pdfmason/pdf-engine/browser';

const findingCopy = (band: DecorationReviewBand): string => {
  if (band.textArea?.status === 'sampled') {
    if (band.textArea.finding === 'ink-detected')
      return 'Possible overlap: existing ink near the added text. Inspect placement.';
    if (band.finding === 'ink-detected')
      return 'Ink detected elsewhere in this margin band; none detected in the estimated text area. Still inspect visually.';
    return 'No ink detected at sampled resolution. Still inspect visually.';
  }
  return band.finding === 'ink-detected'
    ? 'Warning: existing ink detected. Inspect for overlap.'
    : 'No ink detected at sampled resolution. Still inspect visually.';
};

interface Props {
  readonly pageNumber: number;
  readonly selectedPages: readonly number[];
  readonly reviews: Readonly<Partial<Record<number, DecorationPlacementReview>>>;
  readonly busy: boolean;
  readonly hasWatermark: boolean;
  readonly onNavigate: (page: number) => void;
}

/** EDIT-006: coverage is explicit, and a negative sample is never called clear or safe. */
export const DecorationPlacementPanel = ({
  pageNumber,
  selectedPages,
  reviews,
  busy,
  hasWatermark,
  onNavigate,
}: Props) => {
  const review = reviews[pageNumber];
  const unchecked = selectedPages.filter((page) => reviews[page] === undefined);
  const sampled = selectedPages.filter((page) => reviews[page]?.status === 'sampled');
  const unavailable = selectedPages.filter((page) => reviews[page]?.status === 'unavailable');
  const notApplicable = selectedPages.filter((page) => reviews[page]?.status === 'not-applicable');
  const attention = selectedPages.filter((page) => {
    const item = reviews[page];
    return (
      item?.status === 'unavailable' ||
      (item?.status === 'sampled' && item.bands.some((band) => band.finding === 'ink-detected'))
    );
  });
  const next = unchecked.find((page) => page > pageNumber) ?? unchecked[0];
  return (
    <section className="decoration-placement" aria-label="Placement warnings">
      <h4>Source-page margin check</h4>
      <p>
        {sampled.length} of {selectedPages.length} selected pages sampled. {unchecked.length} not
        checked. {unavailable.length} unavailable.
      </p>
      {notApplicable.length > 0 && (
        <p>{notApplicable.length} visited pages have no header or footer to sample.</p>
      )}
      {!selectedPages.includes(pageNumber) ? (
        <p>No marks on this page; no placement check is needed.</p>
      ) : review?.status === 'sampled' ? (
        <dl className="decoration-placement__findings">
          {review.bands.map((band) => (
            <div
              key={band.kind}
              data-finding={band.finding}
              data-text-area={
                band.textArea?.status === 'sampled' ? band.textArea.finding : 'unavailable'
              }
            >
              <dt>{band.kind === 'header' ? 'Header band' : 'Footer band'}</dt>
              <dd>
                {findingCopy(band)}
                {band.textArea?.status !== 'sampled' && (
                  <span className="decoration-placement__detail">
                    Text-area check unavailable. This result covers the full margin band only.
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : review?.status === 'unavailable' ? (
        <p className="decoration-placement__unavailable">
          Check unavailable for this page. Inspect the complete preview manually; no safe-placement
          result was produced.
        </p>
      ) : review?.status === 'not-applicable' ? (
        <p>No header or footer to sample.</p>
      ) : (
        <p>This page has not been checked.</p>
      )}
      <div className="decoration-placement__actions">
        {next !== undefined && (
          <button type="button" disabled={busy} onClick={() => onNavigate(next)}>
            Review next unchecked page
          </button>
        )}
        {attention.length > 0 && (
          <label>
            Pages needing attention
            <select
              aria-label="Pages needing attention"
              value=""
              disabled={busy}
              onChange={(event) => {
                if (event.currentTarget.value !== '') onNavigate(Number(event.currentTarget.value));
              }}
            >
              <option value="">Choose a page</option>
              {attention.map((page) => (
                <option key={page} value={page}>
                  Page {page}
                  {reviews[page]?.status === 'unavailable'
                    ? ' — check unavailable'
                    : ' — ink detected'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="fidelity-note">
        Advisory only: checks visible pixels in full-width bands and estimates the added text area
        from font metrics, including spaces and a small guard. It does not trace individual letters.
        Backgrounds can trigger warnings. Faint, tiny, hidden, or unrendered content may be missed.
        Unvisited pages are not checked. Nothing here certifies safe placement.
      </p>
      {hasWatermark && (
        <p className="fidelity-note">
          Watermark placement is not sampled. Review it manually on every relevant page.
        </p>
      )}
    </section>
  );
};
