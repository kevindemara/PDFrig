import { useEffect, useState } from 'react';
import type { NormalizedRect } from '@pdfmason/editor-core';
import {
  layoutScriptSignature,
  type ScriptSignatureLayout,
  type PdfPageMetrics,
} from '@pdfmason/pdf-engine/browser';

export const ScriptSignaturePreview = ({
  text,
  label,
  rect,
  color,
  pageMetrics,
}: {
  readonly text: string;
  readonly label: 'initials' | 'signature';
  readonly rect: NormalizedRect;
  readonly color: string;
  readonly pageMetrics?: PdfPageMetrics | undefined;
}) => {
  const width = pageMetrics?.width ?? 612;
  const height = pageMetrics?.height ?? 792;
  const rectWidth = rect.width;
  const rectHeight = rect.height;
  const scope = `${text}:${label}:${rect.width}:${rect.height}:${width}:${height}`;
  const [result, setResult] = useState<{
    scope: string;
    layout: ScriptSignatureLayout | null;
  } | null>(null);
  useEffect(() => {
    let current = true;
    void layoutScriptSignature(
      text,
      label,
      { x: 0, y: 0, width: rectWidth, height: rectHeight },
      width,
      height,
    )
      .then((layout) => {
        if (current) setResult({ scope, layout });
      })
      .catch(() => {
        if (current) setResult({ scope, layout: null });
      });
    return () => {
      current = false;
    };
  }, [text, label, rectWidth, rectHeight, width, height, scope]);
  const layout = result?.scope === scope ? result.layout : undefined;
  return (
    <>
      <span className="visually-hidden">{text}</span>
      {layout === undefined ? (
        <span className="text-overlay__notice">Preparing signature…</span>
      ) : layout === null ? (
        <span className="text-overlay__notice">
          Signature does not fit or contains unsupported characters. Enlarge the box or change the
          text.
        </span>
      ) : (
        <svg
          aria-hidden="true"
          className="annotation-vector-preview"
          data-signature-font="Dancing Script"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="none"
        >
          <g
            fill={color}
            transform={`translate(${layout.x} ${layout.baseline}) scale(${layout.glyphScale} ${-layout.glyphScale})`}
          >
            {layout.glyphs.map((glyph, index) => (
              <path key={index} d={glyph.path} transform={`translate(${glyph.x} 0)`} />
            ))}
          </g>
        </svg>
      )}
    </>
  );
};
