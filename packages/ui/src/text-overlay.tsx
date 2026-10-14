import { useEffect, useState, type KeyboardEvent } from 'react';
import type { NormalizedRect, TextAnnotation } from '@pdfmason/editor-core';
import {
  getOverlayFontMetrics,
  layoutTextOverlay,
  type OverlayFontMetrics,
  type PdfPageMetrics,
} from '@pdfmason/pdf-engine/browser';

import { PlaceableOverlay, transformPlaceableRect } from './placeable-overlay.js';

export const transformTextBox = transformPlaceableRect;

export const TextOverlay = ({
  annotation,
  selected,
  disabled,
  scope,
  pageMetrics,
  onSelect,
  onCommit,
  onKeyDown,
}: {
  readonly annotation: TextAnnotation;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly scope: string;
  readonly pageMetrics?: PdfPageMetrics | undefined;
  readonly onSelect: () => void;
  readonly onCommit: (rect: NormalizedRect) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) => {
  const [metrics, setMetrics] = useState<OverlayFontMetrics | null>(null);
  useEffect(() => {
    let current = true;
    void getOverlayFontMetrics()
      .then((value) => {
        if (current) setMetrics(value);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return (
    <PlaceableOverlay
      rect={annotation.rect}
      name="Text overlay"
      resizeName="text box"
      className="text-overlay"
      bodyClassName="annotation-item--text"
      bodyStyle={{
        color: annotation.color,
        background: annotation.variant === 'plain' ? 'transparent' : undefined,
      }}
      selected={selected}
      disabled={disabled}
      scope={scope}
      onSelect={onSelect}
      onCommit={onCommit}
      onKeyDown={onKeyDown}
    >
      {(rect) => {
        const textLayout = (() => {
          if (metrics === null || pageMetrics === undefined) return null;
          try {
            return layoutTextOverlay(
              { ...annotation, rect },
              pageMetrics.width,
              pageMetrics.height,
              metrics,
            );
          } catch {
            return null;
          }
        })();
        return (
          <>
            <span className="visually-hidden">{annotation.text}</span>
            {textLayout !== null ? (
              <svg
                aria-hidden="true"
                className="text-overlay__preview"
                viewBox={`0 0 ${textLayout.width} ${textLayout.height}`}
                preserveAspectRatio="none"
              >
                {textLayout.lines.map((line, index) => (
                  <text
                    key={index}
                    x={line.x}
                    y={line.baseline}
                    fontSize={textLayout.fontSize}
                    textLength={line.width > 0 ? line.width : undefined}
                    lengthAdjust="spacingAndGlyphs"
                    fontFamily="Helvetica, Arial, sans-serif"
                    fontWeight="normal"
                    fontStyle="normal"
                    style={{ fontKerning: 'none', fontVariantLigatures: 'none' }}
                    letterSpacing="0"
                    fill={annotation.color}
                    xmlSpace="preserve"
                  >
                    {line.text}
                  </text>
                ))}
              </svg>
            ) : (
              <span className="text-overlay__notice">
                {metrics === null || pageMetrics === undefined
                  ? 'Preparing text…'
                  : 'Text cannot be exported with this font.'}
              </span>
            )}
            {textLayout !== null && !textLayout.fits && (
              <span className="text-overlay__notice">
                Text does not fit. Enlarge the box or reduce font size before exporting.
              </span>
            )}
          </>
        );
      }}
    </PlaceableOverlay>
  );
};
