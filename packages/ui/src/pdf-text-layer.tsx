import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { BrowserPdfDocument } from '@pdfmason/pdf-engine/browser';
import { rotateNormalizedRect, type QuarterTurn } from '@pdfmason/editor-core';
import type { PdfTextSelection } from './source-text-selection.js';

export const PdfTextLayer = ({
  document,
  pageIndex,
  scale,
  rotation,
  enabled,
  onSelection,
  selectionReaderRef,
}: {
  readonly document: BrowserPdfDocument;
  readonly pageIndex: number;
  readonly scale: number;
  readonly rotation: QuarterTurn;
  readonly enabled: boolean;
  readonly onSelection?: (selection: PdfTextSelection | null) => void;
  readonly selectionReaderRef?: RefObject<(() => PdfTextSelection | null) | null>;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Preparing selectable text…');
  const actualRotation = useRef<number | null>(null);
  useEffect(() => {
    const target = container.current;
    if (target === null) return;
    const controller = new AbortController();
    void document
      .renderSelectableText(target, pageIndex, scale, rotation, controller.signal)
      .then(async (result) => {
        const metrics = await document.getPageMetrics(pageIndex, rotation);
        if (controller.signal.aborted) return;
        actualRotation.current = metrics.rotation;
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
      actualRotation.current = null;
      target.replaceChildren();
    };
  }, [document, pageIndex, scale, rotation]);
  const readSelection = useCallback((): PdfTextSelection | null => {
    const target = container.current;
    const selection = target?.ownerDocument.getSelection();
    if (!target || selection?.rangeCount !== 1 || selection.isCollapsed) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (!target.contains(range.startContainer) || !target.contains(range.endContainer)) {
      return null;
    }
    const page = target.parentElement?.getBoundingClientRect(),
      box = range.getBoundingClientRect();
    if (
      !page?.width ||
      !page.height ||
      actualRotation.current === null ||
      !box.width ||
      !box.height
    )
      return null;
    const rect = {
      x: (box.x - page.x) / page.width,
      y: (box.y - page.y) / page.height,
      width: box.width / page.width,
      height: box.height / page.height,
    };
    const inverse = ((360 - actualRotation.current) % 360) as QuarterTurn;
    return {
      text: selection.toString(),
      rect: inverse === 0 ? rect : rotateNormalizedRect(rect, inverse),
    };
  }, []);
  const captureSelection = useCallback(
    (clearEmpty = false) => {
      const value = readSelection();
      const nativeSelection = container.current?.ownerDocument.getSelection();
      if (value || clearEmpty || (nativeSelection && !nativeSelection.isCollapsed))
        onSelection?.(value);
    },
    [onSelection, readSelection],
  );
  useEffect(() => {
    if (!selectionReaderRef) return;
    selectionReaderRef.current = readSelection;
    return () => {
      if (selectionReaderRef.current === readSelection) selectionReaderRef.current = null;
    };
  }, [selectionReaderRef, readSelection]);
  useEffect(() => {
    const target = container.current;
    if (!target || !enabled) return;
    const owner = target.ownerDocument;
    const capture = () => captureSelection();
    owner.addEventListener('selectionchange', capture);
    return () => owner.removeEventListener('selectionchange', capture);
  }, [enabled, captureSelection]);
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
        onMouseUp={() => captureSelection(true)}
        onKeyUp={() => captureSelection()}
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
