'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { PageNode } from '@pdfmason/editor-core';
import type { BrowserPdfDocument } from '@pdfmason/pdf-engine/browser';
import { thumbnailWindow, ThumbnailRenderQueue } from './thumbnail-window.js';

interface PageThumbnailsProps {
  readonly canMove: boolean;
  readonly documentFor: (page: PageNode) => BrowserPdfDocument | undefined;
  readonly onMove: (pageId: string, index: number) => void;
  readonly onSelect: (pageId: string) => void;
  readonly pages: readonly PageNode[];
  readonly renderQueue?: ThumbnailRenderQueue;
  readonly selectedId: string | undefined;
}

const ThumbnailCanvas = ({
  document,
  page,
  queue,
}: {
  readonly document: BrowserPdfDocument | undefined;
  readonly page: PageNode;
  readonly queue: ThumbnailRenderQueue;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'pending' | 'ready' | 'unavailable'>('pending');
  useEffect(() => {
    const lifecycle = new AbortController();
    const canvas = canvasRef.current;
    const publish = (value: 'ready' | 'unavailable'): void => {
      if (!lifecycle.signal.aborted) setState(value);
    };
    const cancel = queue.schedule(async () => {
      if (lifecycle.signal.aborted || canvas === null) return;
      try {
        if (document === undefined) throw new Error('Preview unavailable.');
        await document.renderPage(canvas, page.sourcePageIndex, 0.18, page.rotation);
        publish('ready');
      } catch {
        publish('unavailable');
      }
    });
    return () => {
      lifecycle.abort();
      cancel();
    };
  }, [document, page.rotation, page.sourcePageIndex, queue]);
  return (
    <span className="page-thumbnail__canvas" data-preview={state}>
      <canvas aria-hidden="true" ref={canvasRef} />
      {state === 'unavailable' && (
        <span className="page-thumbnail__error">Preview unavailable</span>
      )}
    </span>
  );
};

// VIEW-004 / ORG-003: one shared, measured viewport and stable page identities.
export const PageThumbnails = ({
  canMove,
  documentFor,
  onMove,
  onSelect,
  pages,
  renderQueue,
  selectedId,
}: PageThumbnailsProps) => {
  const railRef = useRef<HTMLDivElement>(null);
  const keyboardHelpId = useId();
  const firstRowRef = useRef<HTMLLIElement>(null);
  const draggedId = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const focusWithin = useRef(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [fallbackQueue] = useState(() => new ThumbnailRenderQueue());
  const queue = renderQueue ?? fallbackQueue;
  const [viewport, setViewport] = useState({ height: 600, rowHeight: 200, top: 0 });
  const selectedIndex = Math.max(
    0,
    pages.findIndex(({ id }) => id === selectedId),
  );
  const focusedIndex = pages.findIndex(({ id }) => id === focusedId);
  const visible = thumbnailWindow(pages.length, viewport.top, viewport.height, viewport.rowHeight);
  // A focus or Tab entry never disappears because the user scrolls elsewhere.
  const indices = [...new Set([...visible, selectedIndex, focusedIndex])]
    .filter((index) => index >= 0 && index < pages.length)
    .sort((left, right) => left - right);
  const firstIndex = visible[0];
  const tabId = pages[focusedIndex >= 0 ? focusedIndex : selectedIndex]?.id;

  useEffect(() => {
    const clearDrag = () => {
      draggedId.current = null;
    };
    globalThis.addEventListener('dragend', clearDrag);
    globalThis.addEventListener('drop', clearDrag);
    return () => {
      globalThis.removeEventListener('dragend', clearDrag);
      globalThis.removeEventListener('drop', clearDrag);
    };
  }, []);

  const measure = useCallback(() => {
    const rail = railRef.current;
    if (rail === null) return;
    const measuredRow = firstRowRef.current?.getBoundingClientRect().height ?? 0;
    setViewport((previous) => {
      const next = {
        height: rail.clientHeight || previous.height,
        rowHeight: measuredRow >= 32 ? measuredRow : previous.rowHeight,
        top: rail.scrollTop,
      };
      return next.height === previous.height &&
        next.rowHeight === previous.rowHeight &&
        next.top === previous.top
        ? previous
        : next;
    });
  }, []);

  useLayoutEffect(() => {
    measure();
    const observer = 'ResizeObserver' in globalThis ? new ResizeObserver(measure) : undefined;
    if (railRef.current !== null) observer?.observe(railRef.current);
    if (firstRowRef.current !== null) observer?.observe(firstRowRef.current);
    globalThis.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener('resize', measure);
    };
  }, [firstIndex, measure]);

  const reveal = useCallback(
    (index: number) => {
      const rail = railRef.current;
      if (rail === null) return;
      const top = index * viewport.rowHeight;
      const height = rail.clientHeight || viewport.height;
      if (top < rail.scrollTop) rail.scrollTop = top;
      else if (top + viewport.rowHeight > rail.scrollTop + height)
        rail.scrollTop = top + viewport.rowHeight - height;
      measure();
    },
    [measure, viewport.height, viewport.rowHeight],
  );

  useLayoutEffect(() => {
    reveal(selectedIndex);
  }, [reveal, selectedIndex, selectedId]);

  useLayoutEffect(() => {
    const requested = pendingFocus.current;
    const restore = focusWithin.current && focusedId !== null && focusedIndex === -1;
    const id = requested ?? (restore ? pages[selectedIndex]?.id : undefined);
    if (id === undefined) return;
    const row = Array.from(railRef.current?.querySelectorAll<HTMLLIElement>('li') ?? []).find(
      (element) => element.dataset.pageId === id,
    );
    const button = row?.querySelector('button');
    if (button === null || button === undefined) return;
    pendingFocus.current = null;
    button.focus({ preventScroll: true });
  });

  return (
    <div
      className="page-thumbnails"
      ref={railRef}
      onScroll={measure}
      onFocusCapture={() => {
        focusWithin.current = true;
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focusWithin.current = false;
          setFocusedId(null);
        }
      }}
      onDragOver={(event) => {
        if (!canMove || draggedId.current === null) return;
        event.preventDefault();
        const rail = event.currentTarget;
        const bounds = rail.getBoundingClientRect();
        if (event.clientY < bounds.top + 32) rail.scrollTop -= viewport.rowHeight / 3;
        else if (event.clientY > bounds.bottom - 32) rail.scrollTop += viewport.rowHeight / 3;
        measure();
      }}
    >
      <span className="visually-hidden" id={keyboardHelpId}>
        Use Arrow Up and Arrow Down to change pages. Home and End go to the first and last page.
      </span>
      <ul
        aria-label="Page thumbnails"
        className="page-thumbnails__window"
        style={{ height: pages.length * viewport.rowHeight }}
      >
        {indices.map((index) => {
          const page = pages[index];
          if (page === undefined) return null;
          return (
            <li
              aria-posinset={index + 1}
              aria-setsize={pages.length}
              className="page-thumbnails__row"
              data-page-id={page.id}
              draggable={canMove}
              key={page.id}
              ref={index === firstIndex ? firstRowRef : undefined}
              style={{ top: index * viewport.rowHeight }}
              onDragStart={() => {
                draggedId.current = canMove ? page.id : null;
              }}
              onDragEnd={() => {
                draggedId.current = null;
              }}
              onDrop={(event) => {
                event.preventDefault();
                const id = draggedId.current;
                draggedId.current = null;
                if (id !== null) event.stopPropagation();
                if (canMove && id !== null && pages.some((candidate) => candidate.id === id))
                  onMove(id, index);
              }}
            >
              <div
                className={page.id === selectedId ? 'page-thumbnail is-selected' : 'page-thumbnail'}
              >
                <button
                  aria-describedby={keyboardHelpId}
                  aria-current={page.id === selectedId ? 'page' : undefined}
                  onClick={() => onSelect(page.id)}
                  onFocus={() => setFocusedId(page.id)}
                  onKeyDown={(event) => {
                    if (event.altKey || event.ctrlKey || event.metaKey) return;
                    const next =
                      event.key === 'ArrowDown'
                        ? index + 1
                        : event.key === 'ArrowUp'
                          ? index - 1
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? pages.length - 1
                              : event.key === 'PageDown'
                                ? index +
                                  Math.max(1, Math.floor(viewport.height / viewport.rowHeight))
                                : event.key === 'PageUp'
                                  ? index -
                                    Math.max(1, Math.floor(viewport.height / viewport.rowHeight))
                                  : null;
                    if (next === null) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const targetIndex = Math.max(0, Math.min(pages.length - 1, next));
                    const target = pages[targetIndex];
                    if (target === undefined) return;
                    pendingFocus.current = target.id;
                    reveal(targetIndex);
                    onSelect(target.id);
                  }}
                  tabIndex={page.id === tabId ? 0 : -1}
                  type="button"
                >
                  <ThumbnailCanvas
                    key={`${page.id}:${page.rotation}`}
                    document={documentFor(page)}
                    page={page}
                    queue={queue}
                  />
                  <span>Page {index + 1}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
