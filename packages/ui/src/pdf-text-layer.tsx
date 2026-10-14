import { useEffect, useRef, useState } from 'react';
import type { BrowserPdfDocument } from '@pdfmason/pdf-engine/browser';
import type { QuarterTurn } from '@pdfmason/editor-core';

export const PdfTextLayer = ({
  document,
  pageIndex,
  scale,
  rotation,
  enabled,
}: {
  readonly document: BrowserPdfDocument;
  readonly pageIndex: number;
  readonly scale: number;
  readonly rotation: QuarterTurn;
  readonly enabled: boolean;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Preparing selectable text…');
  useEffect(() => {
    const target = container.current;
    if (target === null) return;
    const controller = new AbortController();
    void document
      .renderSelectableText(target, pageIndex, scale, rotation, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setStatus(
          result === 'ready'
            ? 'Text is selectable. Focus the text layer and press Ctrl+A to select this page; Ctrl+C copies locally.'
            : result === 'empty'
              ? 'No searchable text on this page. OCR is needed for image-only scans.'
              : result === 'restricted'
                ? 'This PDF restricts copying text.'
                : result === 'limited'
                  ? 'This page exceeds the selectable-text limit.'
                  : '',
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('Selectable text is unavailable on this page.');
      });
    return () => {
      controller.abort();
      target.replaceChildren();
    };
  }, [document, pageIndex, scale, rotation]);
  return (
    <>
      {/* A focusable document region intentionally supports page-scoped select/copy,
          without pretending the source is an editable textbox or application. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        aria-label="Selectable PDF text"
        aria-describedby="pdf-text-selection-status"
        className={`pdf-text-layer${enabled ? '' : ' pdf-text-layer--inactive'}`}
        ref={container}
        role="region"
        tabIndex={enabled ? 0 : -1}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            const target = container.current;
            if (target === null || target.childElementCount === 0) return;
            event.preventDefault();
            event.stopPropagation();
            const range = target.ownerDocument.createRange();
            range.selectNodeContents(target);
            const selection = target.ownerDocument.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
        }}
      />
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <span className="pdf-text-status" id="pdf-text-selection-status" aria-live="polite">
        {status}
      </span>
    </>
  );
};
