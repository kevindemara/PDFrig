import type { EditorAnnotation, NormalizedPoint } from '@pdfmason/editor-core';
import type { PdfPageMetrics } from '@pdfmason/pdf-engine/browser';
import { ScriptSignaturePreview } from './script-signature-preview.js';
import { ImageSignaturePreview } from './image-signature-preview.js';

// ANNO-001/003/004: SVG units are displayed-page PDF points, not CSS pixels.
// The same renderer paints both a placement draft and its committed annotation.
export const AnnotationPreview = ({
  annotation,
  pageMetrics,
}: {
  readonly annotation: EditorAnnotation;
  readonly pageMetrics?: PdfPageMetrics | undefined;
}) => {
  const pageWidth = pageMetrics?.width ?? 612;
  const pageHeight = pageMetrics?.height ?? 792;
  const width = annotation.rect.width * pageWidth;
  const height = annotation.rect.height * pageHeight;
  const point = ({ x, y }: NormalizedPoint) => ({
    x: (x - annotation.rect.x) * pageWidth,
    y: (y - annotation.rect.y) * pageHeight,
  });
  let content;
  if (annotation.kind === 'ink') {
    const path = annotation.points
      .slice(1)
      .map((next, index) => {
        const previous = annotation.points[index];
        if (previous === undefined) return '';
        const a = point(previous);
        const b = point(next);
        return `M${a.x} ${a.y} L${b.x} ${b.y}`;
      })
      .join(' ');
    content = (
      <path d={path} fill="none" stroke={annotation.color} strokeWidth={annotation.strokeWidth} />
    );
  } else if (annotation.kind === 'shape') {
    const fill = annotation.fillColor ?? 'none';
    if (annotation.shape === 'rectangle') {
      content = (
        <rect
          width={width}
          height={height}
          fill={fill}
          fillOpacity={0.2}
          stroke={annotation.strokeColor}
          strokeWidth={annotation.strokeWidth}
        />
      );
    } else if (annotation.shape === 'ellipse') {
      content = (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={width / 2}
          ry={height / 2}
          fill={fill}
          fillOpacity={0.2}
          stroke={annotation.strokeColor}
          strokeWidth={annotation.strokeWidth}
        />
      );
    } else {
      const from = point(
        annotation.from ?? { x: annotation.rect.x, y: annotation.rect.y + annotation.rect.height },
      );
      const to = point(
        annotation.to ?? { x: annotation.rect.x + annotation.rect.width, y: annotation.rect.y },
      );
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const size = Math.max(6, annotation.strokeWidth * 4);
      content = (
        <>
          <line
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={annotation.strokeColor}
            strokeWidth={annotation.strokeWidth}
          />
          {annotation.shape === 'arrow' &&
            [-Math.PI / 7, Math.PI / 7].map((offset) => (
              <line
                key={offset}
                x1={to.x}
                y1={to.y}
                x2={to.x - Math.cos(angle + offset) * size}
                y2={to.y - Math.sin(angle + offset) * size}
                stroke={annotation.strokeColor}
                strokeWidth={annotation.strokeWidth}
              />
            ))}
        </>
      );
    }
  } else if (annotation.kind === 'markup') {
    content =
      annotation.style === 'highlight' ? (
        <rect width={width} height={height} fill={annotation.color} opacity={annotation.opacity} />
      ) : (
        <line
          x1={0}
          x2={width}
          y1={annotation.style === 'underline' ? height : height / 2}
          y2={annotation.style === 'underline' ? height : height / 2}
          stroke={annotation.color}
          strokeWidth={1.5}
          opacity={annotation.opacity}
        />
      );
  } else if (annotation.kind === 'utility-mark' && annotation.mark === 'checkmark') {
    content = (
      <polyline
        points={`${width * 0.12},${height * 0.55} ${width * 0.42},${height * 0.82} ${width * 0.9},${height * 0.16}`}
        fill="none"
        stroke={annotation.color}
        strokeWidth={2.5}
      />
    );
  } else if (annotation.kind === 'visual-signature' && annotation.appearance.kind === 'drawn') {
    const appearance = annotation.appearance;
    content = appearance.points.slice(1).map((next, index) => {
      const previous = appearance.points[index];
      return previous === undefined ? null : (
        <line
          key={index}
          x1={previous.x * width}
          y1={previous.y * height}
          x2={next.x * width}
          y2={next.y * height}
          stroke={appearance.color}
          strokeWidth={1.8}
        />
      );
    });
  } else if (annotation.kind === 'visual-signature' && annotation.appearance.kind === 'typed') {
    return (
      <ScriptSignaturePreview
        text={annotation.appearance.text}
        label={annotation.label}
        rect={annotation.rect}
        color={annotation.appearance.color}
        pageMetrics={pageMetrics}
      />
    );
  } else if (annotation.kind === 'visual-signature' && annotation.appearance.kind === 'image') {
    return (
      <ImageSignaturePreview
        bytes={annotation.appearance.bytes}
        mimeType={annotation.appearance.mimeType}
      />
    );
  } else if (annotation.kind === 'comment') {
    return (
      <span>
        <strong>Comment</strong>
        {annotation.text}
      </span>
    );
  } else if (
    annotation.kind === 'stamp' ||
    annotation.kind === 'text' ||
    annotation.kind === 'utility-mark'
  ) {
    return <span>{annotation.text}</span>;
  }
  return (
    <svg
      aria-hidden="true"
      className="annotation-vector-preview"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {content}
    </svg>
  );
};
