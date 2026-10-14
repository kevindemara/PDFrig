'use client';

import { DocumentNotice } from './document-notice.js';
import { SourceTextDialog } from './source-text-dialog.js';
import type { PdfTextSelection } from './source-text-selection.js';
import {
  addAnnotationCommand,
  createCommentSummaryReport,
  createInitialEditorDocument,
  createInitialPageGraph,
  createPageMeasurement,
  deleteAnnotationCommand,
  deleteEditorPageCommand,
  DocumentSession,
  duplicateEditorPageCommand,
  eraseInkAnnotationsCommand,
  insertEditorPagesCommand,
  importFormDataCommand,
  moveEditorPageCommand,
  normalizeRect,
  rotateEditorPageCommand,
  setFormValueCommand,
  setPageMeasurementCommand,
  transformAnnotationRect,
  updateAnnotationCommand,
  updateCommentStatusCommand,
  type CommentAnnotation,
  type EditorAnnotation,
  type EditorDocumentState,
  type FormValue,
  type NormalizedPoint,
  type NormalizedRect,
  type MeasurementMetrics,
  type PageNode,
  type PlatformAdapter,
  type PrintAdapter,
  type RecentFilesSnapshot,
  type SelectedFileHandle,
} from '@pdfmason/editor-core';
import {
  createPdfWorkerClient,
  inspectPdfRevisionStructure,
  LOCAL_PDF_LIMITS,
  openBrowserPdf,
  validatePdfImagePixelCount,
  type AssemblyPage,
  type BrowserPdfDocument,
  type PdfInspection,
  type PdfPageMetrics,
  type PdfOutlineSnapshot,
  type PdfSignatureDetection,
  type PdfStructureInspection,
  type PdfRiskCode,
  type PdfFormField,
  type PdfSearchHit,
  type PdfWorkerClient,
  type RedactionMark,
} from '@pdfmason/pdf-engine/browser';
import {
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { BrandLockup } from './brand-lockup.js';
import { FormDataPanel } from './form-data-panel.js';
import { useDialogFocus } from './dialog-focus.js';
import { supportedImageMimeType } from './image-input.js';
import { MeasurementOverlay, MeasurementPanel } from './measurement-panel.js';
import {
  resolvePrintPageIndices,
  validatePrintPixelBudget,
  type PrintOptions,
  type PrintResolution,
} from './print-options.js';
import { resolveSignatureEditPolicy } from './signature-edit-policy.js';
import { SignatureRepeatDialog } from './signature-repeat-dialog.js';
import { usePointerGesture } from './pointer-gesture.js';
import { PageThumbnails } from './page-thumbnails.js';
import { ThumbnailRenderQueue } from './thumbnail-window.js';
import { ToolIcon } from './tool-icon.js';
import { PlaceableOverlay } from './placeable-overlay.js';
import { AnnotationPreview } from './annotation-preview.js';
import { TextOverlay } from './text-overlay.js';
import { PdfTextLayer } from './pdf-text-layer.js';
import { fitPageScale } from './page-fit.js';
import { ScriptSignaturePreview } from './script-signature-preview.js';

export interface WorkspaceShellProps {
  readonly accountControl?: ReactNode;
  readonly commentReviewEnabled?: boolean;
  readonly createWorker?: () => Worker;
  readonly desktopAccess?: 'checking' | 'locked' | 'ready';
  readonly marketingHref?: string;
  readonly measurementEnabled?: boolean;
  readonly platformAdapter?: PlatformAdapter;
  readonly printAdapter?: PrintAdapter;
  readonly redactionEnabled?: boolean;
  readonly stampsEnabled?: boolean;
  readonly surface: 'Web' | 'Windows';
}

interface LocalSource {
  readonly bytes: Uint8Array;
  readonly document: BrowserPdfDocument;
  readonly inspection: PdfInspection;
  readonly formFields: readonly PdfFormField[];
  readonly outline: PdfOutlineSnapshot | null;
  readonly structure: PdfStructureInspection;
  readonly sourceId: string;
}

interface PendingPassword {
  readonly bytes: Uint8Array;
  readonly displayName: string;
}

interface PendingPdfInsert {
  readonly afterPageId: string;
  readonly afterPageNumber: number;
  readonly restoreFocusTo: HTMLElement | null;
  readonly source: LocalSource;
}

interface NativeFileTransfer {
  readonly completedBytes: number;
  readonly direction: 'opening' | 'saving';
  readonly totalBytes: number;
}

interface PreparedPrint {
  readonly document: BrowserPdfDocument;
  readonly pageIndices: readonly number[];
  readonly resolution: PrintResolution;
}

interface SearchResult extends PdfSearchHit {
  readonly graphIndex: number;
  readonly sourceId: string;
}

type ToolMode =
  | 'arrow'
  | 'callout'
  | 'checkmark'
  | 'comment'
  | 'date'
  | 'draw'
  | 'eraser'
  | 'ellipse'
  | 'fill'
  | 'highlight'
  | 'line'
  | 'measure'
  | 'pages'
  | 'redact'
  | 'rectangle'
  | 'sign'
  | 'stamp'
  | 'strikeout'
  | 'text'
  | 'underline';

const riskLabels: Readonly<Record<string, string>> = Object.freeze({
  ACTIVE_CONTENT: 'embedded JavaScript',
  ATTACHMENTS: 'file attachments',
  ENCRYPTED: 'password encryption',
  FORMS: 'interactive forms',
  INCREMENTAL_REVISIONS: 'earlier saved revisions',
  MALFORMED_STRUCTURE: 'damaged document structure',
  OUTLINES: 'bookmarks',
  SIGNATURES: 'signature fields',
  TAGGED_CONTENT: 'accessibility tags',
  XFA: 'XFA content',
});

const EMPTY_PAGES: readonly PageNode[] = Object.freeze([]);

const toolLabels: Readonly<Record<ToolMode, string>> = Object.freeze({
  arrow: 'Arrow',
  callout: 'Callout',
  checkmark: 'Checkmark',
  comment: 'Comment',
  date: 'Date',
  draw: 'Draw',
  eraser: 'Eraser',
  ellipse: 'Ellipse',
  fill: 'Fill fields',
  highlight: 'Highlight area',
  line: 'Line',
  measure: 'Measure',
  pages: 'Pages',
  redact: 'Permanent removal',
  rectangle: 'Rectangle',
  sign: 'Visual signature',
  stamp: 'Stamp',
  strikeout: 'Strike out area',
  text: 'Add text',
  underline: 'Underline area',
});

const pointFromEvent = (event: ReactPointerEvent): NormalizedPoint => {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
};

const rectFromPoints = (
  start: NormalizedPoint,
  end: NormalizedPoint,
  minimum: { readonly height: number; readonly width: number } = { height: 0.03, width: 0.03 },
): NormalizedRect => {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width >= minimum.width && height >= minimum.height) {
    return normalizeRect({
      height,
      width,
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
    });
  }
  return normalizeRect({
    height: minimum.height,
    width: minimum.width,
    x: start.x - minimum.width / 2,
    y: start.y - minimum.height / 2,
  });
};

type PlacementTool = Exclude<
  ToolMode,
  'eraser' | 'fill' | 'measure' | 'pages' | 'redact' | 'sign' | 'stamp'
>;

interface InkStyle {
  readonly color: string;
  readonly strokeWidth: number;
}

const DEFAULT_INK_STYLE: InkStyle = Object.freeze({ color: '#c65d3b', strokeWidth: 2 });

const rectFromPointCloud = (points: readonly NormalizedPoint[]): NormalizedRect => {
  const minimumX = points.reduce((min, point) => Math.min(min, point.x), 1);
  const minimumY = points.reduce((min, point) => Math.min(min, point.y), 1);
  const width = points.reduce((max, point) => Math.max(max, point.x), 0) - minimumX;
  const height = points.reduce((max, point) => Math.max(max, point.y), 0) - minimumY;
  return normalizeRect({
    height,
    width,
    x: Math.min(0.998, minimumX - Math.max(0, 0.002 - width) / 2),
    y: Math.min(0.998, minimumY - Math.max(0, 0.002 - height) / 2),
  });
};

interface PendingRedactionMark extends RedactionMark {
  readonly id: string;
  readonly pageId: string;
}

const createAnnotationForTool = (
  tool: PlacementTool,
  pageId: string,
  start: NormalizedPoint,
  end: NormalizedPoint,
  points: readonly NormalizedPoint[],
  inkStyle: InkStyle = DEFAULT_INK_STYLE,
  id: string = crypto.randomUUID(),
): EditorAnnotation => {
  if (tool === 'text' || tool === 'callout') {
    return {
      alignment: 'left',
      color: '#17232d',
      fontSize: 16,
      id,
      kind: 'text',
      pageId,
      rect: rectFromPoints(start, end, { height: 0.07, width: 0.32 }),
      text: 'Type here',
      variant: tool === 'callout' ? 'callout' : 'box',
    };
  }
  if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') {
    return {
      color: tool === 'highlight' ? '#f4d35e' : '#c65d3b',
      id,
      kind: 'markup',
      opacity: tool === 'highlight' ? 0.35 : 0.9,
      pageId,
      rect: rectFromPoints(start, end, { height: 0.035, width: 0.24 }),
      style: tool,
    };
  }
  if (tool === 'draw') {
    const inkPoints = points.length >= 2 ? points : [start, end];
    return {
      color: inkStyle.color,
      id,
      kind: 'ink',
      pageId,
      points: inkPoints,
      rect: rectFromPointCloud(inkPoints),
      strokeWidth: inkStyle.strokeWidth,
    };
  }
  if (tool === 'rectangle' || tool === 'ellipse' || tool === 'line' || tool === 'arrow') {
    const rect =
      tool === 'line' || tool === 'arrow'
        ? rectFromPointCloud([start, end])
        : rectFromPoints(start, end, { height: 0.08, width: 0.15 });
    return {
      fillColor: null,
      ...(tool === 'line' || tool === 'arrow' ? { from: start, to: end } : {}),
      id,
      kind: 'shape',
      pageId,
      rect,
      shape: tool,
      strokeColor: '#c65d3b',
      strokeWidth: 2,
    };
  }
  if (tool === 'comment') {
    return {
      author: 'Local author',
      color: '#a86200',
      createdAt: new Date().toISOString(),
      id,
      kind: 'comment',
      pageId,
      rect: rectFromPoints(start, end, { height: 0.13, width: 0.28 }),
      status: 'open',
      text: 'Add your comment',
    };
  }
  return {
    color: '#17232d',
    id,
    kind: 'utility-mark',
    mark: tool,
    pageId,
    rect: rectFromPoints(
      start,
      end,
      tool === 'checkmark' ? { height: 0.05, width: 0.05 } : { height: 0.04, width: 0.17 },
    ),
    text:
      tool === 'date'
        ? new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' }).format(new Date())
        : 'Checkmark',
  };
};

const annotationStyle = (rect: NormalizedRect): CSSProperties => ({
  height: `${rect.height * 100}%`,
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
});

const annotationPresentationStyle = (annotation: EditorAnnotation): CSSProperties => ({
  ...(annotation.kind === 'comment' ? { borderColor: annotation.color } : {}),
  ...(annotation.kind === 'stamp'
    ? { borderColor: annotation.color, color: annotation.color }
    : {}),
});

const annotationName = (annotation: EditorAnnotation): string => {
  if (annotation.kind === 'text') return 'Text overlay';
  if (annotation.kind === 'markup') return `${annotation.style} markup`;
  if (annotation.kind === 'ink') return 'Freehand drawing';
  if (annotation.kind === 'shape') return annotation.shape;
  if (annotation.kind === 'comment') return 'Comment';
  if (annotation.kind === 'stamp') return `Stamp: ${annotation.text}`;
  if (annotation.kind === 'visual-signature') return `Visual ${annotation.label}`;
  return annotation.mark;
};

interface SignatureDialogProps {
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
  readonly onPlace: (annotation: EditorAnnotation) => void;
  readonly pageId: string;
}

interface PdfInsertReviewDialogProps {
  readonly afterPageNumber: number;
  readonly incomingPageCount: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly restoreFocusTo: HTMLElement | null;
}

const PdfInsertReviewDialog = ({
  afterPageNumber,
  incomingPageCount,
  onCancel,
  onConfirm,
  restoreFocusTo,
}: PdfInsertReviewDialogProps) => {
  const { closeRef, dialogRef } = useDialogFocus(onCancel, restoreFocusTo);
  const firstInsertedPage = afterPageNumber + 1;
  const lastInsertedPage = afterPageNumber + incomingPageCount;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="insert-pdf-title"
        aria-modal="true"
        className="editor-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="panel-kicker">Organize</span>
            <h2 id="insert-pdf-title">Review PDF insertion</h2>
          </div>
          <button aria-label="Cancel PDF insertion" onClick={onCancel} ref={closeRef} type="button">
            Cancel
          </button>
        </div>
        <p className="dialog-disclosure">
          Add {incomingPageCount} {incomingPageCount === 1 ? 'page' : 'pages'} after page{' '}
          {afterPageNumber}. The new {incomingPageCount === 1 ? 'page' : 'pages'} will become{' '}
          {firstInsertedPage === lastInsertedPage
            ? `page ${firstInsertedPage}`
            : `pages ${firstInsertedPage}–${lastInsertedPage}`}
          .
        </p>
        <p>Runs on this device. Your PDFs are not uploaded, and both originals stay unchanged.</p>
        <div className="dialog-actions">
          <button className="button button--secondary" onClick={onCancel} type="button">
            Keep current pages
          </button>
          <button className="button button--primary" onClick={onConfirm} type="button">
            Insert {incomingPageCount === 1 ? 'page' : 'pages'}
          </button>
        </div>
      </section>
    </div>
  );
};

const SignatureDialog = ({ onClose, onError, onPlace, pageId }: SignatureDialogProps) => {
  const { closeRef, dialogRef } = useDialogFocus(onClose);
  const [mode, setMode] = useState<'drawn' | 'image' | 'typed'>('typed');
  const [label, setLabel] = useState<'initials' | 'signature'>('signature');
  const [typed, setTyped] = useState('');
  const [points, setPoints] = useState<readonly NormalizedPoint[]>([]);
  const signatureGesture = usePointerGesture(`${pageId}:${mode}:${label}`);
  const signaturePoints = signatureGesture.draft?.points ?? points;
  const [image, setImage] = useState<{
    readonly bytes: Uint8Array;
    readonly mimeType: 'image/jpeg' | 'image/png';
    readonly name: string;
  } | null>(null);

  const place = (): void => {
    const appearance =
      mode === 'typed'
        ? ({ color: '#17232d', kind: 'typed', text: typed.trim() } as const)
        : mode === 'drawn'
          ? ({ color: '#17232d', kind: 'drawn', points } as const)
          : image === null
            ? null
            : ({ bytes: image.bytes, kind: 'image', mimeType: image.mimeType } as const);
    if (
      appearance === null ||
      (appearance.kind === 'typed' && appearance.text.length === 0) ||
      (appearance.kind === 'drawn' && appearance.points.length < 2)
    ) {
      onError('Create or choose a visual signature before placing it.');
      return;
    }
    onPlace({
      appearance,
      id: crypto.randomUUID(),
      kind: 'visual-signature',
      label,
      pageId,
      rect: {
        height: label === 'initials' ? 0.07 : 0.09,
        width: label === 'initials' ? 0.18 : 0.36,
        x: 0.5,
        y: 0.76,
      },
    });
    onClose();
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="signature-title"
        aria-modal="true"
        className="editor-dialog signature-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="panel-kicker">Fill & sign</span>
            <h2 id="signature-title">Add a visual signature</h2>
          </div>
          <button
            aria-label="Close visual signature dialog"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            Close
          </button>
        </div>
        <p className="dialog-disclosure">
          This is a visual mark only. It is not a certificate-backed digital signature and does not
          verify identity.
        </p>
        <fieldset className="segmented-control">
          <legend>Mark type</legend>
          <label>
            <input
              checked={label === 'signature'}
              name="signature-label"
              onChange={() => setLabel('signature')}
              type="radio"
            />
            Signature
          </label>
          <label>
            <input
              checked={label === 'initials'}
              name="signature-label"
              onChange={() => setLabel('initials')}
              type="radio"
            />
            Initials
          </label>
        </fieldset>
        <div className="dialog-tabs" role="tablist" aria-label="Visual signature source">
          {(['typed', 'drawn', 'image'] as const).map((candidate) => (
            <button
              aria-selected={mode === candidate}
              key={candidate}
              onClick={() => setMode(candidate)}
              role="tab"
              type="button"
            >
              {candidate === 'image'
                ? 'Upload'
                : `${candidate.charAt(0).toUpperCase()}${candidate.slice(1)}`}
            </button>
          ))}
        </div>
        {mode === 'typed' && (
          <div className="field-stack">
            <label>
              Type your {label}
              <input
                autoComplete="off"
                maxLength={200}
                onChange={(event) => setTyped(event.target.value)}
                value={typed}
              />
            </label>
            <div className="signature-typed-preview" aria-label="Script signature preview">
              <ScriptSignaturePreview
                text={typed || 'Your signature'}
                label={label}
                rect={{ x: 0, y: 0, width: 1, height: 1 }}
                color="#17232d"
                pageMetrics={{ width: 340, height: 72, rotation: 0 }}
              />
            </div>
            <small>
              Dancing Script ·{' '}
              <a href="./third-party/DancingScript-OFL.txt" target="_blank" rel="noreferrer">
                Font licence
              </a>
              . Visual mark only; no identity verification.
            </small>
          </div>
        )}
        {mode === 'drawn' && (
          <div>
            <p className="field-label">Draw with a pointer or touch</p>
            <svg
              aria-label="Draw visual signature"
              className="signature-pad"
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return;
                const point = pointFromEvent(event);
                if (
                  signatureGesture.begin(
                    point,
                    event.pointerId,
                    event.currentTarget.getBoundingClientRect(),
                  )
                )
                  event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                // Read coordinates while currentTarget is valid, never inside a queued updater.
                const point = pointFromEvent(event);
                if (
                  signatureGesture.move(
                    point,
                    event.pointerId,
                    true,
                    event.currentTarget.getBoundingClientRect(),
                  ) === 'limit'
                )
                  onError(
                    'This signature exceeded the 2,000-point limit. Draw a shorter mark; the previous mark is unchanged.',
                  );
              }}
              onPointerUp={(event) => {
                const point = pointFromEvent(event);
                const draft = signatureGesture.finish(
                  event.pointerId,
                  event.currentTarget.getBoundingClientRect(),
                );
                if (draft !== null) setPoints([...draft.points, point]);
              }}
              onPointerCancel={(event) => signatureGesture.cancel(event.pointerId)}
              onLostPointerCapture={(event) => signatureGesture.cancel(event.pointerId)}
              role="img"
              viewBox="0 0 100 40"
            >
              {signaturePoints.length > 1 && (
                <polyline
                  fill="none"
                  points={signaturePoints.map(({ x, y }) => `${x * 100},${y * 40}`).join(' ')}
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.5"
                />
              )}
            </svg>
            <button onClick={() => setPoints([])} type="button">
              Clear drawing
            </button>
          </div>
        )}
        {mode === 'image' && (
          <label className="upload-card">
            Upload a PNG or JPEG (5 MB maximum)
            <input
              accept="image/png,image/jpeg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file === undefined) return;
                if (
                  (file.type !== 'image/png' && file.type !== 'image/jpeg') ||
                  file.size > 5 * 1024 * 1024
                ) {
                  onError('Choose a PNG or JPEG visual signature no larger than 5 MB.');
                  return;
                }
                void file.arrayBuffer().then((bytes) =>
                  setImage({
                    bytes: new Uint8Array(bytes),
                    mimeType: file.type as 'image/jpeg' | 'image/png',
                    name: file.name,
                  }),
                );
              }}
              type="file"
            />
            {image?.name ?? 'No image selected'}
          </label>
        )}
        <label className="disabled-option">
          <input disabled type="checkbox" />
          Save this signature for future documents{' '}
          <span>Coming later - one-time use is the privacy default.</span>
        </label>
        <div className="dialog-actions">
          <button className="button button--secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button button--primary" onClick={place} type="button">
            Place visual {label}
          </button>
        </div>
      </section>
    </div>
  );
};

const BUILT_IN_STAMPS = Object.freeze([
  Object.freeze({ color: '#26756f', text: 'Approved' }),
  Object.freeze({ color: '#c65d3b', text: 'Draft' }),
  Object.freeze({ color: '#17232d', text: 'Final' }),
  Object.freeze({ color: '#7b3f6c', text: 'Confidential' }),
  Object.freeze({ color: '#a86200', text: 'Received' }),
  Object.freeze({ color: '#356a8a', text: 'Reviewed' }),
] as const);
const STAMP_COLORS = Object.freeze(['#26756f', '#c65d3b', '#17232d', '#7b3f6c'] as const);
const CUSTOM_STAMP_STORAGE_KEY = 'pdfmason.custom-stamps.v1';

export interface SavedCustomStamp {
  readonly color: string;
  readonly id: string;
  readonly text: string;
}

const validStampText = (value: string): boolean =>
  value.length >= 1 && value.length <= 40 && /^[\x20-\x7e]+$/u.test(value);

const validStampColor = (value: string): boolean => /^#[0-9a-f]{6}$/iu.test(value);

const isSavedCustomStamp = (value: unknown): value is SavedCustomStamp => {
  if (typeof value !== 'object' || value === null) return false;
  const stamp = value as Record<string, unknown>;
  return (
    Object.keys(stamp).every((key) => ['color', 'id', 'text'].includes(key)) &&
    typeof stamp.color === 'string' &&
    validStampColor(stamp.color) &&
    typeof stamp.id === 'string' &&
    stamp.id.length >= 1 &&
    stamp.id.length <= 80 &&
    typeof stamp.text === 'string' &&
    validStampText(stamp.text)
  );
};

export const parseSavedCustomStamps = (raw: string | null): readonly SavedCustomStamp[] => {
  try {
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const candidates = parsed as readonly unknown[];
    return Object.freeze(
      candidates
        .filter(isSavedCustomStamp)
        .slice(0, 12)
        .map((stamp) => Object.freeze({ ...stamp })),
    );
  } catch {
    return [];
  }
};

const readSavedCustomStamps = (): readonly SavedCustomStamp[] => {
  try {
    return parseSavedCustomStamps(globalThis.localStorage.getItem(CUSTOM_STAMP_STORAGE_KEY));
  } catch {
    return [];
  }
};

interface StampDialogProps {
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
  readonly onPlace: (annotation: EditorAnnotation) => void;
  readonly pageId: string;
}

const StampDialog = ({ onClose, onError, onPlace, pageId }: StampDialogProps) => {
  const { closeRef, dialogRef } = useDialogFocus(onClose);
  const [color, setColor] = useState<string>(BUILT_IN_STAMPS[0].color);
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<readonly SavedCustomStamp[]>(readSavedCustomStamps);
  const [source, setSource] = useState<'built-in' | 'custom'>('built-in');
  const [text, setText] = useState<string>(BUILT_IN_STAMPS[0].text);

  const chooseBuiltIn = (stamp: (typeof BUILT_IN_STAMPS)[number]): void => {
    setColor(stamp.color);
    setSource('built-in');
    setText(stamp.text);
    setRemember(false);
  };

  const place = (): void => {
    const trimmed = text.trim().replace(/\s+/gu, ' ');
    if (!validStampText(trimmed)) {
      onError('Use 1–40 basic Latin characters for a custom stamp.');
      return;
    }
    if (source === 'custom' && remember) {
      const next = [
        ...saved.filter(
          (stamp) =>
            stamp.text.toLocaleLowerCase() !== trimmed.toLocaleLowerCase() || stamp.color !== color,
        ),
        { color, id: crypto.randomUUID(), text: trimmed },
      ].slice(-12);
      try {
        globalThis.localStorage.setItem(CUSTOM_STAMP_STORAGE_KEY, JSON.stringify(next));
        setSaved(Object.freeze(next));
      } catch {
        onError('The stamp can be placed, but this device could not save it for later.');
      }
    }
    onPlace({
      color,
      id: crypto.randomUUID(),
      kind: 'stamp',
      pageId,
      rect: { height: 0.09, width: 0.34, x: 0.33, y: 0.76 },
      source,
      text: trimmed,
    });
    onClose();
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="stamp-title"
        aria-modal="true"
        className="editor-dialog stamp-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="panel-kicker">ANNO-006 · On this device</span>
            <h2 id="stamp-title">Place a stamp</h2>
          </div>
          <button aria-label="Close stamp dialog" onClick={onClose} ref={closeRef} type="button">
            Close
          </button>
        </div>
        <p className="dialog-disclosure">
          Stamps become page content in a new copy. Custom text stays in this session unless you
          explicitly save it on this device.
        </p>
        <fieldset className="stamp-presets">
          <legend>Built-in stamps</legend>
          {BUILT_IN_STAMPS.map((stamp) => (
            <button
              aria-pressed={source === 'built-in' && text === stamp.text}
              key={stamp.text}
              onClick={() => chooseBuiltIn(stamp)}
              style={{ borderColor: stamp.color, color: stamp.color }}
              type="button"
            >
              {stamp.text}
            </button>
          ))}
        </fieldset>
        {saved.length > 0 && (
          <fieldset className="saved-stamps">
            <legend>Saved on this device</legend>
            <div>
              {saved.map((stamp) => (
                <button
                  aria-pressed={source === 'custom' && text === stamp.text && color === stamp.color}
                  key={stamp.id}
                  onClick={() => {
                    setColor(stamp.color);
                    setRemember(false);
                    setSource('custom');
                    setText(stamp.text);
                  }}
                  type="button"
                >
                  {stamp.text}
                </button>
              ))}
            </div>
            <button
              className="link-button"
              onClick={() => {
                try {
                  globalThis.localStorage.removeItem(CUSTOM_STAMP_STORAGE_KEY);
                } catch {
                  // The in-memory list can still be cleared when device storage is unavailable.
                }
                setSaved([]);
              }}
              type="button"
            >
              Clear saved stamps
            </button>
          </fieldset>
        )}
        <label className="field-stack">
          Custom stamp text
          <input
            autoComplete="off"
            maxLength={40}
            onChange={(event) => {
              setSource('custom');
              setText(event.target.value);
            }}
            value={source === 'custom' ? text : ''}
          />
          <small>1–40 basic Latin characters. Custom stamps are text—not identity proof.</small>
        </label>
        <fieldset className="stamp-colors">
          <legend>Stamp colour</legend>
          {STAMP_COLORS.map((candidate) => (
            <label key={candidate} style={{ color: candidate }}>
              <input
                checked={color === candidate}
                name="stamp-color"
                onChange={() => setColor(candidate)}
                type="radio"
                value={candidate}
              />
              <span aria-hidden="true" />
              {candidate === '#26756f'
                ? 'Teal'
                : candidate === '#c65d3b'
                  ? 'Brick'
                  : candidate === '#17232d'
                    ? 'Ink'
                    : 'Plum'}
            </label>
          ))}
        </fieldset>
        {source === 'custom' && (
          <label className="local-save-option">
            <input
              aria-label="Save this custom stamp on this device"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Save this custom stamp on this device</strong>
              <small>Off by default. No sync or team sharing.</small>
            </span>
          </label>
        )}
        <div className="stamp-preview" aria-label="Stamp preview">
          <span style={{ borderColor: color, color }}>
            {source === 'custom' ? text || 'Preview' : text}
          </span>
        </div>
        <div className="dialog-actions">
          <button className="button button--secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button button--primary" onClick={place} type="button">
            Place stamp
          </button>
        </div>
      </section>
    </div>
  );
};

interface ExportDialogProps {
  readonly hasTags: boolean;
  readonly flattenForms: boolean;
  readonly hasForms: boolean;
  readonly hasMeasurements: boolean;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onExport: () => void;
  readonly onFlattenFormsChange: (flatten: boolean) => void;
  readonly signatureDetection: PdfSignatureDetection;
}

const ExportDialog = ({
  hasTags,
  flattenForms,
  hasForms,
  hasMeasurements,
  loading,
  onClose,
  onExport,
  onFlattenFormsChange,
  signatureDetection,
}: ExportDialogProps) => {
  const { closeRef, dialogRef } = useDialogFocus(onClose);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="export-title"
        aria-modal="true"
        className="editor-dialog export-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="panel-kicker">Local export</span>
            <h2 id="export-title">Review your completed copy</h2>
          </div>
          <button aria-label="Close export dialog" onClick={onClose} ref={closeRef} type="button">
            Close
          </button>
        </div>
        <div className="export-summary">
          <strong>Annotations become page content.</strong>
          <p>
            Text, comments, drawings, shapes, stamps, and visual signatures will be flattened into
            the new PDF. The original file remains unchanged.
          </p>
        </div>
        {hasMeasurements && (
          <p className="dialog-disclosure">
            Measurement guides and page calibration are session-only and are not included in this
            PDF.
          </p>
        )}
        {hasTags && (
          <p className="dialog-disclosure" role="status">
            Existing accessibility tags and reading order are retained and checked after export.
            Added content is not tagged. This does not certify an accessible PDF.
            {hasForms && ' Keep fields interactive: flattening could break their tag references.'}
          </p>
        )}
        {signatureDetection !== 'none' && (
          <div className="export-summary export-summary--warning" role="status">
            <strong>
              {signatureDetection === 'signature-metadata'
                ? 'A digital-signature structure was detected.'
                : 'A signature field was detected.'}
            </strong>
            <p>
              {signatureDetection === 'signature-metadata'
                ? 'Editing this file may invalidate its current digital signature. '
                : 'Editing may invalidate a digital signature associated with this field. '}
              PDFrig does not verify signature validity. Export creates a new copy and leaves the
              original file unchanged.
            </p>
          </div>
        )}
        {hasForms && (
          <fieldset className="export-options">
            <legend>Form field handling</legend>
            <label aria-label="Keep fields interactive" htmlFor="keep-interactive-fields">
              <input
                checked={!flattenForms}
                id="keep-interactive-fields"
                name="form-export-mode"
                onChange={() => onFlattenFormsChange(false)}
                type="radio"
              />
              <span>
                <strong>Keep fields interactive</strong>
                <small>Values remain editable in compatible PDF readers.</small>
              </span>
            </label>
            <label aria-label="Flatten filled fields" htmlFor="flatten-filled-fields">
              <input
                checked={flattenForms}
                disabled={hasTags}
                id="flatten-filled-fields"
                name="form-export-mode"
                onChange={() => onFlattenFormsChange(true)}
                type="radio"
              />
              <span>
                <strong>Flatten filled fields</strong>
                <small>Removes field editability and form semantics from the exported copy.</small>
              </span>
            </label>
          </fieldset>
        )}
        <p className="dialog-disclosure">
          Processing stays on this device. PDFrig does not upload this document.
        </p>
        <div className="dialog-actions">
          <button className="button button--secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={loading}
            onClick={onExport}
            type="button"
          >
            {loading ? 'Preparing copy…' : 'Export completed copy'}
          </button>
        </div>
      </section>
    </div>
  );
};

interface PrintPreviewPageProps {
  readonly document: BrowserPdfDocument;
  readonly onError: () => void;
  readonly onReady: (pageIndex: number) => void;
  readonly pageIndex: number;
  readonly resolution: PrintResolution;
}

const PrintPreviewPage = ({
  document,
  onError,
  onReady,
  pageIndex,
  resolution,
}: PrintPreviewPageProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageSize, setPageSize] = useState<{ height: number; width: number } | null>(null);
  const [renderState, setRenderState] = useState<'measuring' | 'rendering' | 'ready'>('measuring');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let current = true;
    const isCurrent = (): boolean => current;
    void document
      .getPageMetrics(pageIndex)
      .then(async ({ height, width }) => {
        validatePdfImagePixelCount(width, height, resolution);
        if (!isCurrent()) return;
        setPageSize({ height, width });
        setRenderState('rendering');
        await document.renderPage(canvas, pageIndex, resolution, 0, 1, 'opaque');
        if (isCurrent()) {
          setRenderState('ready');
          onReady(pageIndex);
        }
      })
      .catch(() => {
        if (isCurrent()) onError();
      });
    return () => {
      current = false;
      canvas.width = 1;
      canvas.height = 1;
    };
  }, [document, onError, onReady, pageIndex, resolution]);

  const pageStyle =
    pageSize === null
      ? undefined
      : ({
          '--print-page-height': `${pageSize.height / 72}in`,
          '--print-page-width': `${pageSize.width / 72}in`,
        } as CSSProperties);
  return (
    <article
      aria-label={`Printable page ${pageIndex + 1}`}
      className="print-preview-page"
      data-page-number={pageIndex + 1}
      data-render-state={renderState}
      id={`print-page-${pageIndex + 1}`}
      style={pageStyle}
    >
      <canvas aria-label={`Rendered print preview for page ${pageIndex + 1}`} ref={canvasRef} />
      <a href={`#print-page-${pageIndex + 1}`}>Page {pageIndex + 1}</a>
    </article>
  );
};

interface PrintDialogProps {
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onOpenDialog: () => void;
  readonly onOptionsChange: (options: PrintOptions) => void;
  readonly onPrepare: () => void;
  readonly onPreviewError: () => void;
  readonly onPreviewReady: (pageIndex: number) => void;
  readonly options: PrintOptions;
  readonly prepared: PreparedPrint | null;
  readonly readyPageCount: number;
  readonly status: string | null;
}

const PrintDialog = ({
  loading,
  onClose,
  onOpenDialog,
  onOptionsChange,
  onPrepare,
  onPreviewError,
  onPreviewReady,
  options,
  prepared,
  readyPageCount,
  status,
}: PrintDialogProps) => {
  const { closeRef, dialogRef } = useDialogFocus(onClose);
  const previewReady =
    prepared !== null &&
    prepared.pageIndices.length > 0 &&
    readyPageCount === prepared.pageIndices.length;
  return (
    <div className="dialog-backdrop print-dialog" role="presentation">
      <section
        aria-describedby="print-description"
        aria-labelledby="print-title"
        aria-modal="true"
        className="editor-dialog print-dialog__panel"
        ref={dialogRef}
        role="dialog"
      >
        <div className="dialog-heading print-dialog__controls">
          <div>
            <span className="panel-kicker">Local print</span>
            <h2 id="print-title">Print this working copy</h2>
          </div>
          <button aria-label="Close print dialog" onClick={onClose} ref={closeRef} type="button">
            Close
          </button>
        </div>
        <p className="dialog-disclosure print-dialog__controls" id="print-description">
          PDFrig prepares selected pages on this device, then opens the browser or Windows print
          dialog. Your source PDF stays unchanged and is not uploaded.
        </p>
        <div className="print-options print-dialog__controls">
          <label>
            <span>Pages</span>
            <input
              aria-describedby="print-range-help"
              disabled={loading}
              onChange={(event) =>
                onOptionsChange({ ...options, pageRange: event.currentTarget.value })
              }
              placeholder="all or 1-3, 5"
              value={options.pageRange}
            />
          </label>
          <label>
            <span>Preview quality</span>
            <select
              disabled={loading}
              onChange={(event) =>
                onOptionsChange({
                  ...options,
                  resolution: Number(event.currentTarget.value) as PrintResolution,
                })
              }
              value={options.resolution}
            >
              <option value={2}>Standard · 144 px/in</option>
              <option value={3}>High · 216 px/in</option>
            </select>
          </label>
        </div>
        <p className="print-range-help print-dialog__controls" id="print-range-help">
          Up to 50 pages. Use page numbers from this working copy.
        </p>
        <div className="print-limitations print-dialog__controls">
          <strong>Review the native preview before printing.</strong>
          <p>
            Pages are rasterized, so selectable text, links, form semantics, tags, vectors, colour
            profiles, and measurement guides are not printed. Mixed page sizes may be scaled by the
            selected printer.
          </p>
        </div>
        <div className="dialog-actions print-dialog__controls">
          <button
            className="button button--secondary"
            disabled={loading}
            onClick={onPrepare}
            type="button"
          >
            {loading ? 'Preparing pages…' : prepared === null ? 'Prepare print' : 'Rebuild preview'}
          </button>
          <button
            className="button button--primary"
            disabled={!previewReady || loading}
            onClick={onOpenDialog}
            type="button"
          >
            Open print dialog
          </button>
        </div>
        <p aria-live="polite" className="print-status print-dialog__controls" role="status">
          {status ??
            (prepared === null
              ? 'No printable pages prepared.'
              : `${readyPageCount} of ${prepared.pageIndices.length} pages ready.`)}
        </p>
        {prepared !== null && (
          <div aria-label="Printable pages" className="print-preview-list">
            {prepared.pageIndices.map((pageIndex) => (
              <PrintPreviewPage
                document={prepared.document}
                key={pageIndex}
                onError={onPreviewError}
                onReady={onPreviewReady}
                pageIndex={pageIndex}
                resolution={prepared.resolution}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

interface RedactionDialogProps {
  readonly loading: boolean;
  readonly markCount: number;
  readonly onApply: () => void;
  readonly onClose: () => void;
}

const RedactionDialog = ({ loading, markCount, onApply, onClose }: RedactionDialogProps) => {
  const { closeRef, dialogRef } = useDialogFocus(onClose);
  const [confirmedPermanent, setConfirmedPermanent] = useState(false);
  const [confirmedRasterization, setConfirmedRasterization] = useState(false);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-describedby="redaction-description"
        aria-labelledby="redaction-title"
        aria-modal="true"
        className="editor-dialog redaction-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="panel-kicker">REDACT-001 · Local beta</span>
            <h2 id="redaction-title">
              Permanently remove {markCount} marked area{markCount === 1 ? '' : 's'}?
            </h2>
          </div>
          <button
            aria-label="Close redaction review"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            Close
          </button>
        </div>
        <p id="redaction-description">
          This creates a new image-only PDF and verifies every marked region is opaque black. If
          verification is uncertain, PDFrig returns no file.
        </p>
        <div className="redaction-losses">
          <strong>This method changes the whole document.</strong>
          <p>
            Searchable text, forms, links, annotations, accessibility tags, layers, attachments,
            signatures, and vector editability are removed. Image quality can change.
          </p>
        </div>
        <fieldset className="redaction-confirmations">
          <legend>Both confirmations are required</legend>
          <label>
            <input
              checked={confirmedPermanent}
              onChange={(event) => setConfirmedPermanent(event.target.checked)}
              type="checkbox"
            />
            I understand the marked content is permanently removed from the new copy.
          </label>
          <label>
            <input
              checked={confirmedRasterization}
              onChange={(event) => setConfirmedRasterization(event.target.checked)}
              type="checkbox"
            />
            I accept full-document rasterization and the listed fidelity losses.
          </label>
        </fieldset>
        <p className="dialog-disclosure">
          Processing stays on this device. The original PDF remains unchanged.
        </p>
        <div className="dialog-actions">
          <button className="button button--secondary" onClick={onClose} type="button">
            Keep reviewing
          </button>
          <button
            className="button button--primary button--danger"
            disabled={!confirmedPermanent || !confirmedRasterization || loading}
            onClick={onApply}
            type="button"
          >
            {loading ? 'Rebuilding and verifying…' : 'Apply permanent removal'}
          </button>
        </div>
      </section>
    </div>
  );
};

const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return 'The PDF could not be processed on this device.';
  if (error.message === 'LIMIT_BYTES') return 'That PDF exceeds the 50 MB local workspace limit.';
  if (error.message === 'LIMIT_PAGES')
    return 'That PDF exceeds the 500-page local workspace limit.';
  if (error.message === 'NOT_PDF') return 'This file does not have a valid PDF header.';
  if (error.message === 'UTILITY_IMAGE_INVALID') return 'Choose a valid PNG, JPEG, or WebP image.';
  if (error.message.startsWith('ORGANIZER_')) {
    return 'This PDF cannot be reorganized without risking document structure. Open it separately and keep the original unchanged.';
  }
  if (error.message === 'UTILITY_IMAGE_ANIMATION_UNSUPPORTED')
    return 'Animated WebP is not supported. Choose a still image or export one frame first.';
  if (error.message === 'UTILITY_IMAGE_PIXELS_LIMIT')
    return 'That image exceeds the 20-megapixel local limit.';
  if (
    error.message === 'UTILITY_IMAGE_DECODER_UNAVAILABLE' ||
    error.message === 'UTILITY_IMAGE_DECODE_MISMATCH' ||
    error.message === 'UTILITY_IMAGE_ENCODING_FAILED' ||
    error.message === 'UTILITY_IMAGE_VERIFICATION_FAILED'
  ) {
    return 'The image could not be normalized safely on this device. Your PDF was not changed.';
  }
  if (error.name === 'PasswordException' || error.message.toLowerCase().includes('password')) {
    return 'PASSWORD_REQUIRED';
  }
  if (error.message === 'EDIT_TEXT_ENCODING_UNSUPPORTED') {
    return 'This first editor release can export Latin text only. Remove unsupported characters and try again.';
  }
  if (error.message === 'EDIT_TEXT_BOX_TOO_SMALL') {
    return 'The text does not fit its box. Enlarge the box or reduce its font size, then export again. Your original is unchanged.';
  }
  if (error.message === 'EDIT_SIGNATURE_TEXT_UNSUPPORTED') {
    return 'The script font cannot render this signature. Use supported characters and a single line. Your original is unchanged.';
  }
  if (error.message === 'EDIT_SIGNATURE_BOX_TOO_SMALL') {
    return 'The signature does not fit. Enlarge its box or shorten the text, then export again. Your original is unchanged.';
  }
  if (error.message === 'EDIT_TAG_PRESERVATION_FAILED') {
    return 'The accessibility structure could not be preserved exactly. No copy was returned and your original is unchanged.';
  }
  if (error.message === 'EDIT_TAGGED_FORM_FLATTEN_UNSUPPORTED') {
    return 'Keep fields interactive for this tagged PDF. Flattening could break accessibility references. Your original is unchanged.';
  }
  if (error.message.startsWith('EDIT_')) {
    return 'The local edit could not be exported without risking document fidelity.';
  }
  if (error.message === 'REDACTION_CONFIRMATION_REQUIRED')
    return 'Both permanent-removal confirmations are required.';
  if (error.message === 'REDACTION_PAGE_LIMIT')
    return 'Verified redaction is limited to 25 pages in this beta.';
  if (error.message === 'REDACTION_SOURCE_OPEN_FAILED')
    return 'The source could not be reopened in the isolated redaction worker. No file was returned.';
  if (error.message === 'REDACTION_RENDER_FAILED')
    return 'A page could not be rendered safely for permanent removal. No file was returned.';
  if (error.message === 'REDACTION_REBUILD_FAILED')
    return 'The sanitized image-only copy could not be rebuilt. No file was returned.';
  if (error.message === 'REDACTION_ENGINE_UNAVAILABLE')
    return 'The isolated redaction engine could not start on this device. No file was returned.';
  if (error.message === 'REDACTION_CLEANUP_FAILED')
    return 'The isolated redaction worker could not prove cleanup. No file was returned.';
  if (error.message.startsWith('REDACTION_'))
    return 'Verification could not prove permanent removal, so no redacted file was returned. Your original is unchanged.';
  if (error.message === 'NATIVE_OVERWRITE_BLOCKED')
    return 'That file already exists. Choose a new filename so the existing file stays unchanged.';
  if (error.message === 'NATIVE_FILE_CHANGED')
    return 'The selected PDF changed before it could be opened. Select it again.';
  if (error.message.startsWith('COMMENT_SUMMARY_'))
    return 'The comment summary could not be built safely. Your PDF and comments were not changed.';
  if (error.message === 'NATIVE_TRANSFER_CANCELLED')
    return 'The file transfer was cancelled. Your existing files were not changed.';
  if (error.message.startsWith('NATIVE_'))
    return 'Windows could not complete that file operation safely. Your existing files were not changed.';
  return 'The PDF is damaged or uses a feature this local viewer cannot safely open.';
};

const safeOutputStem = (name: string): string => {
  const withoutExtension = name.replace(/\.pdf$/i, '');
  const sanitized = withoutExtension.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized.slice(0, 80) : 'document';
};

const downloadBytes = (bytes: Uint8Array, filename: string, mimeType = 'application/pdf'): void => {
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

const parsePageGroups = (value: string, pageCount: number): readonly (readonly number[])[] => {
  const groups = value
    .split(';')
    .map((group) => group.trim())
    .filter(Boolean);
  if (groups.length === 0 || groups.length > 20) throw new Error('Enter 1–20 page groups.');
  return groups.map((group) => {
    const pages = new Set<number>();
    for (const token of group.split(',').map((part) => part.trim())) {
      const range = /^(\d+)(?:-(\d+))?$/.exec(token);
      if (range === null) throw new Error('Use ranges such as 1-3; 4-6.');
      const start = Number(range[1]);
      const end = Number(range[2] ?? range[1]);
      if (start < 1 || end < start || end > pageCount) {
        throw new Error(`Page ranges must stay between 1 and ${pageCount}.`);
      }
      for (let page = start; page <= end; page += 1) pages.add(page - 1);
    }
    return Object.freeze([...pages]);
  });
};

interface CommentReviewLedgerProps {
  readonly comments: readonly CommentAnnotation[];
  readonly currentPageId: string | undefined;
  readonly onExport: () => void;
  readonly onSelect: (comment: CommentAnnotation) => void;
  readonly onStatusChange: (comment: CommentAnnotation) => void;
  readonly pages: readonly PageNode[];
  readonly saving: boolean;
  readonly statusMessage: string | null;
}

const formatReviewTime = (timestamp: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp));

const CommentReviewLedger = ({
  comments,
  currentPageId,
  onExport,
  onSelect,
  onStatusChange,
  pages,
  saving,
  statusMessage,
}: CommentReviewLedgerProps) => {
  const [pageFilter, setPageFilter] = useState<'all' | 'current'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const pageNumbers = new Map(pages.map((page, index) => [page.id, index + 1] as const));
  const openCount = comments.filter(({ status }) => status === 'open').length;
  const filtered = comments.filter(
    (comment) =>
      (statusFilter === 'all' || comment.status === statusFilter) &&
      (pageFilter === 'all' || comment.pageId === currentPageId),
  );

  return (
    <section className="review-ledger" aria-labelledby="review-ledger-title">
      <div className="review-ledger__heading">
        <div>
          <span className="panel-kicker">ANNO-007 · Local review</span>
          <h3 id="review-ledger-title">Review ledger</h3>
        </div>
        <div className="review-ledger__tally" aria-label={`${openCount} open comments`}>
          <strong>{openCount}</strong>
          <span>open</span>
        </div>
      </div>
      <p className="review-ledger__intro">
        Track local comments without uploading them. Status changes join undo history.
      </p>
      <div className="review-ledger__filters" aria-label="Comment filters">
        <label>
          Status
          <select
            aria-label="Comment status filter"
            onChange={(event) => setStatusFilter(event.target.value as 'all' | 'open' | 'resolved')}
            value={statusFilter}
          >
            <option value="all">All ({comments.length})</option>
            <option value="open">Open ({openCount})</option>
            <option value="resolved">Resolved ({comments.length - openCount})</option>
          </select>
        </label>
        <label>
          Pages
          <select
            aria-label="Comment page filter"
            onChange={(event) => setPageFilter(event.target.value as 'all' | 'current')}
            value={pageFilter}
          >
            <option value="all">All pages</option>
            <option value="current">Current page</option>
          </select>
        </label>
      </div>
      {filtered.length === 0 ? (
        <div className="review-ledger__empty">
          <strong>{comments.length === 0 ? 'No comments yet.' : 'No comments match.'}</strong>
          <span>
            {comments.length === 0
              ? 'Place a comment on the page to start a local review.'
              : 'Change the status or page filter to see more.'}
          </span>
        </div>
      ) : (
        <ol className="review-ledger__list">
          {filtered.map((comment) => {
            const pageNumber = pageNumbers.get(comment.pageId);
            return (
              <li key={comment.id}>
                <article className={`review-card review-card--${comment.status}`}>
                  <button
                    className="review-card__select"
                    onClick={() => onSelect(comment)}
                    type="button"
                  >
                    <span className="review-card__meta">
                      Page {pageNumber ?? '—'} · {comment.author}
                    </span>
                    <strong>{comment.text.trim() || 'Empty comment'}</strong>
                    <span className="review-card__detail">
                      <time dateTime={comment.createdAt}>
                        {formatReviewTime(comment.createdAt)}
                      </time>
                      <span aria-label={`Comment identity ${comment.id}`}>
                        ID {comment.id.slice(0, 8)}
                      </span>
                    </span>
                  </button>
                  <button
                    className="review-card__status"
                    onClick={() => onStatusChange(comment)}
                    type="button"
                  >
                    <span aria-hidden="true">{comment.status === 'open' ? '○' : '✓'}</span>
                    {comment.status === 'open' ? 'Mark resolved' : 'Reopen'}
                  </button>
                </article>
              </li>
            );
          })}
        </ol>
      )}
      <div className="review-ledger__export">
        <button disabled={comments.length === 0 || saving} onClick={onExport} type="button">
          {saving ? 'Preparing summary…' : 'Export all comments (.json)'}
        </button>
        <small>
          The summary contains comment text, author labels, dates, statuses, pages, and stable IDs.
          Keep it private.
        </small>
      </div>
      <p aria-live="polite" className="review-ledger__status">
        {statusMessage}
      </p>
    </section>
  );
};

export const WorkspaceShell = ({
  accountControl,
  commentReviewEnabled = false,
  createWorker,
  desktopAccess = 'ready',
  marketingHref = '/',
  measurementEnabled = false,
  platformAdapter,
  printAdapter,
  redactionEnabled = false,
  stampsEnabled = false,
  surface,
}: WorkspaceShellProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pasteboardRef = useRef<HTMLDivElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const pendingPdfInsertRef = useRef<PendingPdfInsert | null>(null);
  const pdfInsertTriggerRef = useRef<HTMLButtonElement | null>(null);
  const nativeTransferControllerRef = useRef<AbortController | null>(null);
  const presentationEnterRef = useRef<HTMLButtonElement>(null);
  const presentationExitRef = useRef<HTMLButtonElement>(null);
  const presentationZoomRef = useRef(1);
  const preparedPrintRef = useRef<PreparedPrint | null>(null);
  const printPreparationRef = useRef(0);
  const readSelectedPdfRef = useRef<((file: SelectedFileHandle) => Promise<void>) | null>(null);
  const sessionRef = useRef<DocumentSession<EditorDocumentState> | null>(null);
  const sourcesRef = useRef(new Map<string, LocalSource>());
  const workerRef = useRef<PdfWorkerClient | null>(null);
  const [displayName, setDisplayName] = useState('Untitled workspace');
  const [commentExportStatus, setCommentExportStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageMetrics, setPageMetrics] = useState<{
    pageId: string;
    rotation: number;
    value: PdfPageMetrics;
  } | null>(null);
  const [nativeFileTransfer, setNativeFileTransfer] = useState<NativeFileTransfer | null>(null);
  const [password, setPassword] = useState('');
  const [pendingPdfInsert, setPendingPdfInsert] = useState<PendingPdfInsert | null>(null);
  const [pendingPassword, setPendingPassword] = useState<PendingPassword | null>(null);
  const [query, setQuery] = useState('');
  const [recentFilesSnapshot, setRecentFilesSnapshot] = useState<RecentFilesSnapshot | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<readonly SearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thumbnailRenderQueue] = useState(() => new ThumbnailRenderQueue());
  const [session, setSession] = useState<DocumentSession<EditorDocumentState> | null>(null);
  const [sources, setSources] = useState<ReadonlyMap<string, LocalSource>>(() => new Map());
  const [splitRanges, setSplitRanges] = useState('1-2; 3-4');
  const [version, setVersion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [activeTool, setActiveTool] = useState<ToolMode>('pages');
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [inkColor, setInkColor] = useState(DEFAULT_INK_STYLE.color);
  const [inkStrokeWidth, setInkStrokeWidth] = useState(DEFAULT_INK_STYLE.strokeWidth);
  const [inkEraserRadius, setInkEraserRadius] = useState(0.04);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [sourceTextMode, setSourceTextMode] = useState<'edit' | 'ocr' | null>(null);
  const [sourceTextSelection, setSourceTextSelection] = useState<{
    sourceId: string;
    pageIndex: number;
    value: PdfTextSelection;
  } | null>(null);
  const [sourceTextInitialSelection, setSourceTextInitialSelection] =
    useState<PdfTextSelection | null>(null);
  const sourceTextSelectionReader = useRef<(() => PdfTextSelection | null) | null>(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [pendingSignatureRepeat, setPendingSignatureRepeat] = useState<{
    readonly before: EditorDocumentState;
    readonly signatureId: string;
    readonly version: number;
  } | null>(null);
  const closeSignatureRepeat = useCallback(() => setPendingSignatureRepeat(null), []);
  const [showStampDialog, setShowStampDialog] = useState(false);
  const [showRedactionDialog, setShowRedactionDialog] = useState(false);
  const [signatureEditAcknowledged, setSignatureEditAcknowledged] = useState(false);
  const [redactionMarks, setRedactionMarks] = useState<readonly PendingRedactionMark[]>([]);
  const [redactionStatus, setRedactionStatus] = useState<string | null>(null);
  const [flattenForms, setFlattenForms] = useState(false);
  const [preparedPrint, setPreparedPrint] = useState<PreparedPrint | null>(null);
  const [printOptions, setPrintOptions] = useState<PrintOptions>({
    pageRange: 'all',
    resolution: 2,
  });
  const [printLoading, setPrintLoading] = useState(false);
  const [printStatus, setPrintStatus] = useState<string | null>(null);
  const [readyPrintPages, setReadyPrintPages] = useState<ReadonlySet<number>>(() => new Set());
  const [isPresenting, setIsPresenting] = useState(false);
  const [measurementMetrics, setMeasurementMetrics] = useState<{
    pageId: string;
    rotation: number;
    value: MeasurementMetrics | null;
  } | null>(null);

  const clearPreparedPrint = useCallback((): void => {
    const prepared = preparedPrintRef.current;
    preparedPrintRef.current = null;
    setPreparedPrint(null);
    setReadyPrintPages(new Set());
    if (prepared !== null) void prepared.document.destroy();
  }, []);

  const closePrintDialog = useCallback((): void => {
    printPreparationRef.current += 1;
    clearPreparedPrint();
    setPrintLoading(false);
    setPrintStatus(null);
    setShowPrintDialog(false);
  }, [clearPreparedPrint]);

  const changePrintOptions = useCallback(
    (options: PrintOptions): void => {
      printPreparationRef.current += 1;
      clearPreparedPrint();
      setPrintOptions(options);
      setPrintStatus('Settings changed. Prepare the preview again.');
    },
    [clearPreparedPrint],
  );

  const markPrintPageReady = useCallback((pageIndex: number): void => {
    setReadyPrintPages((current) => {
      const next = new Set([...current, pageIndex]);
      const expected = preparedPrintRef.current?.pageIndices.length;
      if (expected !== undefined && next.size === expected) {
        setPrintStatus(`${expected} of ${expected} pages ready. Review each page before printing.`);
      }
      return next;
    });
  }, []);

  const reportPrintPreviewError = useCallback((): void => {
    printPreparationRef.current += 1;
    clearPreparedPrint();
    setPrintLoading(false);
    setPrintStatus(
      'A printable page could not be rendered within local safety limits. Nothing was printed.',
    );
  }, [clearPreparedPrint]);

  const stopPresentation = useCallback((): void => {
    setIsPresenting(false);
    setZoom(presentationZoomRef.current);
    queueMicrotask(() => presentationEnterRef.current?.focus());
  }, []);

  const startPresentation = useCallback((): void => {
    presentationZoomRef.current = zoom;
    setSelectedAnnotationId(null);
    setIsPresenting(true);
  }, [zoom]);

  useEffect(() => {
    if (isPresenting) queueMicrotask(() => presentationExitRef.current?.focus());
  }, [isPresenting]);

  const refreshRecentFiles = useCallback(async (): Promise<void> => {
    const recentFiles = platformAdapter?.recentFiles;
    if (recentFiles === undefined) return;
    setRecentFilesSnapshot(await recentFiles.getSnapshot());
  }, [platformAdapter]);

  useEffect(() => {
    let current = true;
    const recentFiles = platformAdapter?.recentFiles;
    if (recentFiles === undefined) return;
    void recentFiles
      .getSnapshot()
      .then((snapshot) => {
        if (current) setRecentFilesSnapshot(snapshot);
      })
      .catch(() => {
        if (current) setRecentFilesSnapshot(null);
      });
    return () => {
      current = false;
    };
  }, [platformAdapter]);

  const snapshot = session?.snapshot();
  const pages = snapshot?.state.pageGraph.pages ?? EMPTY_PAGES;
  const annotations = snapshot?.state.annotations ?? [];
  const comments = annotations.filter(
    (annotation): annotation is CommentAnnotation => annotation.kind === 'comment',
  );
  const formValues = snapshot?.state.formValues ?? [];
  const effectiveSelectedId = pages.some((page) => page.id === selectedId)
    ? selectedId
    : (pages[0]?.id ?? null);
  const selectedIndex = Math.max(
    0,
    pages.findIndex((page) => page.id === effectiveSelectedId),
  );
  const selectedPage = pages[selectedIndex];
  const gesture = usePointerGesture(
    `${effectiveSelectedId}:${activeTool}:${selectedPage?.rotation}:${zoom}:${version}:${loading}`,
  );
  const pointerDraft = gesture.draft;
  const selectedSource =
    selectedPage === undefined ? undefined : sources.get(selectedPage.sourceId);
  const outlineNavigationEntries = (selectedSource?.outline?.entries ?? []).map((entry) => ({
    ...entry,
    graphIndex:
      entry.pageIndex === null
        ? -1
        : pages.findIndex(
            (page) =>
              page.sourceId === selectedSource?.sourceId &&
              page.sourcePageIndex === entry.pageIndex,
          ),
  }));
  const currentMeasurement =
    selectedPage === undefined
      ? null
      : (snapshot?.state.measurements.find(({ pageId }) => pageId === selectedPage.id) ??
        createPageMeasurement(selectedPage.id));
  const currentMeasurementMetrics =
    selectedPage !== undefined &&
    measurementMetrics?.pageId === selectedPage.id &&
    measurementMetrics.rotation === selectedPage.rotation
      ? measurementMetrics.value
      : null;
  const allSourcesSafe = [...sources.values()].every(
    ({ inspection }) => inspection.canOrganizeSafely,
  );
  useEffect(() => {
    const target = pasteboardRef.current;
    if (
      target === null ||
      (!autoFit && !isPresenting) ||
      selectedPage === undefined ||
      pageMetrics?.pageId !== selectedPage.id ||
      pageMetrics.rotation !== selectedPage.rotation
    )
      return;
    const metrics = pageMetrics.value;
    const fit = (): void => {
      const style = getComputedStyle(target);
      const width =
        target.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
      const height =
        target.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 24;
      const scale = fitPageScale(metrics.width, metrics.height, width, height);
      if (scale !== null) setZoom(scale);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(target);
    return () => observer.disconnect();
  }, [autoFit, isPresenting, pageMetrics, selectedPage]);
  const signatureEditPolicy = resolveSignatureEditPolicy(
    [...sources.values()].map(({ inspection }) => inspection),
    signatureEditAcknowledged,
  );
  const allSourcesAnnotatable = signatureEditPolicy.canAnnotate;
  const selectedAnnotation = annotations.find(({ id }) => id === selectedAnnotationId);
  const selectedPageAnnotations =
    selectedPage === undefined
      ? []
      : annotations.filter(({ pageId }) => pageId === selectedPage.id);
  const selectedPageFields =
    selectedPage === undefined || selectedSource === undefined
      ? []
      : selectedSource.formFields.filter(
          ({ pageIndex }) => pageIndex === selectedPage.sourcePageIndex,
        );
  const hasForms = [...sources.values()].some(({ formFields }) => formFields.length > 0);
  const activeSources = [...sources.values()].filter((source) =>
    pages.some((page) => page.sourceId === source.sourceId),
  );
  const primarySource = activeSources.length === 1 ? activeSources[0] : undefined;
  const redactionDocumentEligible =
    primarySource === undefined
      ? false
      : !primarySource.inspection.isEncrypted &&
        !primarySource.inspection.isPureXfa &&
        pages.length > 0 &&
        pages.length <= 25 &&
        snapshot?.canUndo !== true &&
        pages.every(
          (page, index) =>
            page.sourceId === primarySource.sourceId &&
            page.sourcePageIndex === index &&
            page.rotation === 0,
        );

  useEffect(() => {
    if (createWorker === undefined) return;
    const client = createPdfWorkerClient(createWorker());
    workerRef.current = client;
    return () => {
      client.terminate();
      workerRef.current = null;
    };
  }, [createWorker]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || selectedPage === undefined || selectedSource === undefined) return;
    const controller = new AbortController();
    void selectedSource.document
      .renderPage(
        canvas,
        selectedPage.sourcePageIndex,
        zoom,
        selectedPage.rotation,
        undefined,
        'opaque',
        controller.signal,
      )
      .catch(() => {
        if (!controller.signal.aborted) setError('This page could not be rendered safely.');
      });
    return () => controller.abort();
  }, [selectedPage, selectedSource, zoom]);

  useEffect(() => {
    if (selectedPage === undefined || selectedSource === undefined) return;
    let current = true;
    void selectedSource.document
      .getPageMetrics(selectedPage.sourcePageIndex, selectedPage.rotation)
      .then((value) => {
        if (current)
          setPageMetrics({ pageId: selectedPage.id, rotation: selectedPage.rotation, value });
      })
      .catch(() => {
        if (current) setPageMetrics(null);
      });
    return () => {
      current = false;
    };
  }, [selectedPage, selectedSource]);

  useEffect(() => {
    if (!measurementEnabled || selectedPage === undefined || selectedSource === undefined) return;
    let current = true;
    void selectedSource.document
      .getPageMetrics(selectedPage.sourcePageIndex, selectedPage.rotation)
      .then((value) => {
        if (current)
          setMeasurementMetrics({
            pageId: selectedPage.id,
            rotation: selectedPage.rotation,
            value,
          });
      })
      .catch(() => {
        if (current)
          setMeasurementMetrics({
            pageId: selectedPage.id,
            rotation: selectedPage.rotation,
            value: null,
          });
      });
    return () => {
      current = false;
    };
  }, [measurementEnabled, selectedPage, selectedSource]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      if (isPresenting) {
        if (event.key === 'Escape') {
          event.preventDefault();
          stopPresentation();
          return;
        }
        if (target instanceof HTMLButtonElement && (event.key === 'Enter' || event.key === ' '))
          return;
        const requestedIndex =
          event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' '
            ? selectedIndex + 1
            : event.key === 'ArrowLeft' || event.key === 'PageUp'
              ? selectedIndex - 1
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? pages.length - 1
                  : null;
        if (requestedIndex !== null) {
          event.preventDefault();
          const nextPage = pages[Math.max(0, Math.min(pages.length - 1, requestedIndex))];
          if (nextPage !== undefined) setSelectedId(nextPage.id);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) sessionRef.current?.redo();
        else sessionRef.current?.undo();
        setVersion((value) => value + 1);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        sessionRef.current?.redo();
        setVersion((value) => value + 1);
      }
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [isPresenting, pages, selectedIndex, stopPresentation]);

  useEffect(
    () => () => {
      printPreparationRef.current += 1;
      void preparedPrintRef.current?.document.destroy();
      preparedPrintRef.current = null;
      void pendingPdfInsertRef.current?.source.document.destroy();
      pendingPdfInsertRef.current = null;
      for (const source of sourcesRef.current.values()) void source.document.destroy();
      sourcesRef.current.clear();
    },
    [],
  );

  const prepareSource = useCallback(
    async (
      bytes: Uint8Array,
      sourceId: string,
      suppliedPassword?: string,
    ): Promise<LocalSource> => {
      const document = await openBrowserPdf(
        bytes,
        suppliedPassword === undefined ? {} : { password: suppliedPassword, wasEncrypted: true },
      );
      try {
        const [browserInspection, formFields, outline, structure] = await Promise.all([
          document.inspect(),
          document.getFormFields(),
          document.getOutline().catch(() => null),
          document.getStructureInspection(),
        ]);
        const revisionStructure = inspectPdfRevisionStructure(bytes);
        const boundaryRisk: PdfRiskCode | null =
          revisionStructure === 'incremental'
            ? 'INCREMENTAL_REVISIONS'
            : revisionStructure === 'malformed'
              ? 'MALFORMED_STRUCTURE'
              : null;
        const inspection: PdfInspection =
          boundaryRisk === null
            ? browserInspection
            : Object.freeze({
                ...browserInspection,
                canAnnotateSafely: false,
                canOrganizeSafely: false,
                riskCodes: Object.freeze([...browserInspection.riskCodes, boundaryRisk]),
              });
        return Object.freeze({
          bytes,
          document,
          formFields,
          inspection,
          outline,
          sourceId,
          structure,
        });
      } catch (inspectionError) {
        await document.destroy();
        throw inspectionError;
      }
    },
    [],
  );

  const registerSource = useCallback(
    async (
      bytes: Uint8Array,
      sourceId: string,
      suppliedPassword?: string,
    ): Promise<LocalSource> => {
      const source = await prepareSource(bytes, sourceId, suppliedPassword);
      sourcesRef.current.set(sourceId, source);
      setSources(new Map(sourcesRef.current));
      return source;
    },
    [prepareSource, setSources],
  );

  const disposePendingPdfInsert = useCallback(async (): Promise<void> => {
    const pending = pendingPdfInsertRef.current;
    pendingPdfInsertRef.current = null;
    setPendingPdfInsert(null);
    await pending?.source.document.destroy();
  }, []);

  const openPrimaryBytes = async (
    bytes: Uint8Array,
    name: string,
    suppliedPassword?: string,
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await disposePendingPdfInsert();
      const sourceId = crypto.randomUUID();
      const source = await registerSource(bytes, sourceId, suppliedPassword);
      for (const [existingId, existing] of sourcesRef.current) {
        if (existingId !== sourceId) {
          void existing.document.destroy();
          sourcesRef.current.delete(existingId);
        }
      }
      setSources(new Map(sourcesRef.current));
      const graph = createInitialPageGraph(
        sourceId,
        source.document.pageCount,
        (index) => `${sourceId}:${index}:${crypto.randomUUID()}`,
      );
      const initialFormValues = source.formFields.reduce<FormValue[]>((values, field) => {
        const existingIndex = values.findIndex(
          (value) => value.sourceId === sourceId && value.fieldName === field.fieldName,
        );
        if (existingIndex >= 0) {
          const existing = values[existingIndex];
          if (existing !== undefined && field.type === 'radio' && field.value !== '') {
            values[existingIndex] = { ...existing, value: field.value };
          }
          return values;
        }
        values.push({
          fieldName: field.fieldName,
          sourceId,
          type: field.type,
          value: field.value,
        });
        return values;
      }, []);
      const nextSession = new DocumentSession(
        { contentHash: 'memory-only', sourceId },
        createInitialEditorDocument(graph, initialFormValues),
      );
      sessionRef.current = nextSession;
      setSession(nextSession);
      setDisplayName(name);
      setPendingPassword(null);
      setPassword('');
      setSelectedId(graph.pages[0]?.id ?? null);
      setSearchResults([]);
      setSelectedAnnotationId(null);
      setActiveTool(source.formFields.length > 0 ? 'fill' : 'pages');
      setFlattenForms(false);
      setShowExportDialog(false);
      setSourceTextMode(null);
      closePrintDialog();
      setShowRedactionDialog(false);
      setShowSignatureDialog(false);
      setSignatureEditAcknowledged(false);
      setIsPresenting(false);
      presentationZoomRef.current = 1;
      setRedactionMarks([]);
      setRedactionStatus(null);
      setZoom(1);
      setAutoFit(true);
      setVersion((value) => value + 1);
    } catch (openError) {
      const message = describeError(openError);
      if (message === 'PASSWORD_REQUIRED' && suppliedPassword === undefined) {
        setPendingPassword({ bytes, displayName: name });
        setError(null);
      } else if (message === 'PASSWORD_REQUIRED')
        setError('That password did not open the PDF. Try again.');
      else setError(message);
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const canReplaceWorkspace = (): boolean =>
    !(
      (sessionRef.current?.snapshot().exported === false ||
        redactionMarks.length > 0 ||
        (sessionRef.current?.snapshot().state.measurements.length ?? 0) > 0) &&
      !globalThis.confirm(
        'Starting another PDF clears working changes, removal marks, and session-only measurement guides. Your original file is unchanged. Continue?',
      )
    );

  const readSelectedPdf = async ({
    bytes,
    displayName: selectedName,
    size,
  }: SelectedFileHandle): Promise<void> => {
    if (size > LOCAL_PDF_LIMITS.maximumBytes || bytes.byteLength > LOCAL_PDF_LIMITS.maximumBytes) {
      setError('That PDF exceeds the 50 MB local workspace limit.');
      return;
    }
    if (size !== bytes.byteLength) {
      setError(describeError(new Error('NATIVE_FILE_CHANGED')));
      return;
    }
    if (!canReplaceWorkspace()) return;
    await openPrimaryBytes(bytes, selectedName);
  };

  useEffect(() => {
    readSelectedPdfRef.current = readSelectedPdf;
  });

  const readPdfFile = async (file: File): Promise<void> => {
    if (file.size > LOCAL_PDF_LIMITS.maximumBytes) {
      setError('That PDF exceeds the 50 MB local workspace limit.');
      return;
    }
    if (!canReplaceWorkspace()) return;
    await openPrimaryBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  };

  const choosePrimaryPdf = async (): Promise<void> => {
    if (platformAdapter === undefined) {
      openInputRef.current?.click();
      return;
    }
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    nativeTransferControllerRef.current = controller;
    try {
      const [selected] = await platformAdapter.chooseFiles({
        acceptedMimeTypes: ['application/pdf'],
        multiple: false,
        onProgress: ({ completedBytes, totalBytes }) =>
          setNativeFileTransfer({ completedBytes, direction: 'opening', totalBytes }),
        signal: controller.signal,
      });
      if (selected !== undefined) {
        await readSelectedPdf(selected);
        await refreshRecentFiles();
      }
    } catch (selectionError) {
      setError(describeError(selectionError));
    } finally {
      if (nativeTransferControllerRef.current === controller)
        nativeTransferControllerRef.current = null;
      setNativeFileTransfer(null);
      setLoading(false);
    }
  };

  const openRecentPdf = async (fileId: string): Promise<void> => {
    const recentFiles = platformAdapter?.recentFiles;
    if (recentFiles === undefined) return;
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    nativeTransferControllerRef.current = controller;
    try {
      const selected = await recentFiles.open(fileId, {
        onProgress: ({ completedBytes, totalBytes }) =>
          setNativeFileTransfer({ completedBytes, direction: 'opening', totalBytes }),
        signal: controller.signal,
      });
      await readSelectedPdf(selected);
      await refreshRecentFiles();
    } catch (selectionError) {
      setError(describeError(selectionError));
      await refreshRecentFiles().catch(() => undefined);
    } finally {
      if (nativeTransferControllerRef.current === controller)
        nativeTransferControllerRef.current = null;
      setNativeFileTransfer(null);
      setLoading(false);
    }
  };

  const setRecentFilesEnabled = async (enabled: boolean): Promise<void> => {
    const recentFiles = platformAdapter?.recentFiles;
    if (recentFiles === undefined) return;
    setError(null);
    try {
      await recentFiles.setEnabled(enabled);
      await refreshRecentFiles();
    } catch (recentError) {
      setError(describeError(recentError));
    }
  };

  const clearRecentFiles = async (): Promise<void> => {
    const recentFiles = platformAdapter?.recentFiles;
    if (recentFiles === undefined) return;
    setError(null);
    try {
      await recentFiles.clear();
      await refreshRecentFiles();
    } catch (recentError) {
      setError(describeError(recentError));
    }
  };

  useEffect(() => {
    const launchFiles = platformAdapter?.launchFiles;
    if (launchFiles === undefined) return;
    const lifecycle = new AbortController();
    const hasEnded = (): boolean => lifecycle.signal.aborted;
    let handling = false;
    let unsubscribe: (() => void) | undefined;

    const takeQueuedFiles = async (): Promise<void> => {
      if (hasEnded() || handling) return;
      handling = true;
      try {
        while (!hasEnded()) {
          const controller = new AbortController();
          nativeTransferControllerRef.current = controller;
          setLoading(true);
          const selected = await launchFiles.take({
            onProgress: ({ completedBytes, totalBytes }) =>
              setNativeFileTransfer({ completedBytes, direction: 'opening', totalBytes }),
            signal: controller.signal,
          });
          if (selected === null) break;
          await readSelectedPdfRef.current?.(selected);
          await refreshRecentFiles();
        }
      } catch (launchError) {
        if (!hasEnded()) setError(describeError(launchError));
      } finally {
        handling = false;
        nativeTransferControllerRef.current = null;
        if (!hasEnded()) {
          setNativeFileTransfer(null);
          setLoading(false);
        }
      }
    };

    void launchFiles
      .subscribe(() => void takeQueuedFiles())
      .then((stop) => {
        if (hasEnded()) stop();
        else unsubscribe = stop;
      });
    void takeQueuedFiles();
    return () => {
      lifecycle.abort();
      nativeTransferControllerRef.current?.abort();
      unsubscribe?.();
    };
  }, [platformAdapter, refreshRecentFiles]);

  const onOpenFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file !== undefined) void readPdfFile(file);
  };

  const onPasswordSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (pendingPassword !== null && password.length > 0)
      void openPrimaryBytes(pendingPassword.bytes, pendingPassword.displayName, password);
  };

  const execute = (
    command: Parameters<DocumentSession<EditorDocumentState>['execute']>[0],
  ): void => {
    sessionRef.current?.execute(command);
    setVersion((value) => value + 1);
  };

  const onInsertPdf = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined || sessionRef.current === null || selectedPage === undefined) return;
    const afterPageId = selectedPage.id;
    const afterPageNumber = selectedIndex + 1;
    setLoading(true);
    setError(null);
    let blockedStructures: string | null = null;
    let preparedSource: LocalSource | null = null;
    try {
      await disposePendingPdfInsert();
      if (file.size > LOCAL_PDF_LIMITS.maximumBytes) throw new Error('INSERT_FILE_LIMIT');
      if (sourcesRef.current.size >= LOCAL_PDF_LIMITS.maximumSources)
        throw new Error('INSERT_SOURCE_LIMIT');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const assemblyBytes = [...sourcesRef.current.values()].reduce(
        (total, source) => total + source.bytes.byteLength,
        bytes.byteLength,
      );
      if (assemblyBytes > LOCAL_PDF_LIMITS.maximumAssemblyBytes)
        throw new Error('INSERT_TOTAL_SIZE_LIMIT');
      const sourceId = crypto.randomUUID();
      preparedSource = await prepareSource(bytes, sourceId);
      if (!preparedSource.inspection.canOrganizeSafely) {
        blockedStructures = preparedSource.inspection.riskCodes
          .map((risk) => riskLabels[risk] ?? risk.toLowerCase())
          .join(', ');
        throw new Error('RISKY_INSERT');
      }
      if (pages.length + preparedSource.document.pageCount > LOCAL_PDF_LIMITS.maximumPages)
        throw new Error('INSERT_PAGE_LIMIT');
      const pending = Object.freeze({
        afterPageId,
        afterPageNumber,
        restoreFocusTo: pdfInsertTriggerRef.current,
        source: preparedSource,
      });
      pendingPdfInsertRef.current = pending;
      setPendingPdfInsert(pending);
      preparedSource = null;
    } catch (insertError) {
      await preparedSource?.document.destroy();
      const code = insertError instanceof Error ? insertError.message : '';
      setError(
        code === 'RISKY_INSERT'
          ? `That PDF contains ${blockedStructures ?? 'protected or interactive content'}. Open it separately to avoid losing document features.`
          : code === 'INSERT_FILE_LIMIT'
            ? 'That PDF exceeds the 50 MB local workspace limit. Your current document was not changed.'
            : code === 'INSERT_SOURCE_LIMIT'
              ? 'This workspace already has the maximum 20 PDF sources. Export or start another workspace before adding more.'
              : code === 'INSERT_TOTAL_SIZE_LIMIT'
                ? 'Adding that PDF would exceed the 100 MB organizer-source limit. Your current document was not changed.'
                : code === 'INSERT_PAGE_LIMIT'
                  ? 'Adding that PDF would exceed the 500-page local workspace limit. Your current document was not changed.'
                  : describeError(insertError),
      );
    } finally {
      setLoading(false);
    }
  };

  const confirmPdfInsert = (): void => {
    const pending = pendingPdfInsertRef.current;
    const activeSession = sessionRef.current;
    if (pending === null || activeSession === null) return;
    const state = activeSession.snapshot().state;
    const targetIndex = state.pageGraph.pages.findIndex(({ id }) => id === pending.afterPageId);
    if (targetIndex < 0) {
      void disposePendingPdfInsert();
      setError('The insertion point changed. Choose the PDF again.');
      return;
    }
    const { source } = pending;
    const inserted = createInitialPageGraph(
      source.sourceId,
      source.document.pageCount,
      (index) => `${source.sourceId}:${index}:${crypto.randomUUID()}`,
    ).pages;
    sourcesRef.current.set(source.sourceId, source);
    setSources(new Map(sourcesRef.current));
    pendingPdfInsertRef.current = null;
    setPendingPdfInsert(null);
    execute(insertEditorPagesCommand(state, inserted, targetIndex + 1));
    setSelectedId(inserted[0]?.id ?? pending.afterPageId);
  };

  const onInsertImage = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const client = workerRef.current;
    if (file === undefined || sessionRef.current === null || client === null) return;
    const mimeType = supportedImageMimeType(file);
    if (mimeType === null) {
      setError('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const pdfBytes = await client.imageToPdf(new Uint8Array(await file.arrayBuffer()), mimeType);
      const sourceId = crypto.randomUUID();
      const source = await registerSource(pdfBytes, sourceId);
      const inserted = createInitialPageGraph(
        sourceId,
        source.document.pageCount,
        () => `${sourceId}:0:${crypto.randomUUID()}`,
      ).pages[0];
      if (inserted === undefined) throw new Error('Image page creation failed.');
      execute(
        insertEditorPagesCommand(
          sessionRef.current.snapshot().state,
          [inserted],
          selectedIndex + 1,
        ),
      );
      setSelectedId(inserted.id);
    } catch (insertError) {
      setError(describeError(insertError));
    } finally {
      setLoading(false);
    }
  };

  const assemblySources = (): readonly {
    readonly bytes: Uint8Array;
    readonly sourceId: string;
  }[] =>
    [...sourcesRef.current.values()]
      .filter((source) =>
        currentState().pageGraph.pages.some((page) => page.sourceId === source.sourceId),
      )
      .map(({ bytes, sourceId }) => ({ bytes, sourceId }));

  const saveOutput = async (
    bytes: Uint8Array,
    filename: string,
    mimeType = 'application/pdf',
  ): Promise<boolean> => {
    if (platformAdapter === undefined) {
      downloadBytes(bytes, filename, mimeType);
      return true;
    }
    const controller = new AbortController();
    nativeTransferControllerRef.current = controller;
    try {
      return (
        (await platformAdapter.saveFile({
          bytes,
          filenameSuggestion: filename,
          mimeType,
          onProgress: ({ completedBytes, totalBytes }) =>
            setNativeFileTransfer({ completedBytes, direction: 'saving', totalBytes }),
          signal: controller.signal,
        })) === 'saved'
      );
    } finally {
      if (nativeTransferControllerRef.current === controller)
        nativeTransferControllerRef.current = null;
      setNativeFileTransfer(null);
    }
  };

  const exportCommentSummary = async (): Promise<void> => {
    setError(null);
    setCommentExportStatus(null);
    setLoading(true);
    try {
      const report = createCommentSummaryReport(currentState(), new Date().toISOString());
      const bytes = new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`);
      const saved = await saveOutput(bytes, 'pdfmason-comment-summary.json', 'application/json');
      if (saved) setCommentExportStatus('Comment summary saved on this device.');
    } catch (exportError) {
      setError(describeError(exportError));
    } finally {
      setLoading(false);
    }
  };

  const exportPages = async (
    pagesToExport: readonly PageNode[],
    filename: string,
  ): Promise<boolean> => {
    const client = workerRef.current;
    if (client === null) throw new Error('The local PDF worker is unavailable.');
    const plan: readonly AssemblyPage[] = pagesToExport.map(
      ({ rotation, sourceId, sourcePageIndex }) => ({ rotation, sourceId, sourcePageIndex }),
    );
    const output = await client.assemble(assemblySources(), plan);
    return saveOutput(output, filename);
  };

  const onExport = async (): Promise<void> => {
    const client = workerRef.current;
    if (pages.length === 0 || !allSourcesAnnotatable || client === null) return;
    setLoading(true);
    setError(null);
    try {
      const output = await client.exportEdited({
        annotations,
        formValues,
        options: { flattenForms },
        pages: pages.map(({ id: pageId, rotation, sourceId, sourcePageIndex }) => ({
          pageId,
          rotation,
          sourceId,
          sourcePageIndex,
        })),
        sources: assemblySources(),
      });
      if (!(await saveOutput(output, `${safeOutputStem(displayName)}-completed.pdf`))) return;
      sessionRef.current?.markExported();
      setShowExportDialog(false);
      setVersion((value) => value + 1);
    } catch (exportError) {
      setError(describeError(exportError));
    } finally {
      setLoading(false);
    }
  };

  const preparePrint = async (): Promise<void> => {
    const client = workerRef.current;
    if (
      pages.length === 0 ||
      !allSourcesAnnotatable ||
      client === null ||
      redactionMarks.length > 0
    )
      return;
    let pageIndices: readonly number[];
    try {
      pageIndices = resolvePrintPageIndices(printOptions, pages.length);
    } catch (printError) {
      setPrintStatus(
        printError instanceof Error && printError.message === 'PRINT_PAGE_LIMIT'
          ? 'Choose no more than 50 pages for one print job.'
          : 'Enter valid page numbers, such as all or 1-3, 5. Do not repeat pages.',
      );
      return;
    }

    const preparation = printPreparationRef.current + 1;
    printPreparationRef.current = preparation;
    clearPreparedPrint();
    setPrintStatus('Building a local raster preview…');
    setPrintLoading(true);
    let document: BrowserPdfDocument | null = null;
    try {
      const output = await client.exportEdited({
        annotations,
        formValues,
        options: { flattenForms: primarySource?.inspection.isTagged !== true },
        pages: pages.map(({ id: pageId, rotation, sourceId, sourcePageIndex }) => ({
          pageId,
          rotation,
          sourceId,
          sourcePageIndex,
        })),
        sources: assemblySources(),
      });
      if (printPreparationRef.current !== preparation) return;
      document = await openBrowserPdf(output);
      if (printPreparationRef.current !== preparation) return;
      if (document.pageCount !== pages.length) throw new Error('PRINT_OUTPUT_MISMATCH');
      const metrics: { height: number; width: number }[] = [];
      for (const pageIndex of pageIndices) {
        const { height, width } = await document.getPageMetrics(pageIndex);
        validatePdfImagePixelCount(width, height, printOptions.resolution);
        metrics.push({ height, width });
      }
      validatePrintPixelBudget(metrics, printOptions.resolution);
      if (printPreparationRef.current !== preparation) return;
      const prepared = Object.freeze({
        document,
        pageIndices,
        resolution: printOptions.resolution,
      });
      preparedPrintRef.current = prepared;
      setPreparedPrint(prepared);
      setReadyPrintPages(new Set());
      setPrintStatus(
        `Rendering ${pageIndices.length} printable page${pageIndices.length === 1 ? '' : 's'}…`,
      );
      document = null;
    } catch (printError) {
      setPrintStatus(
        printError instanceof Error && printError.message === 'PRINT_PIXEL_BUDGET'
          ? 'That range is too large to keep safely in one print preview. Choose fewer pages or Standard quality.'
          : 'The printable copy could not be prepared safely. The source PDF remains unchanged.',
      );
    } finally {
      if (document !== null) void document.destroy();
      if (printPreparationRef.current === preparation) setPrintLoading(false);
    }
  };

  const openPrintDialog = async (): Promise<void> => {
    if (printAdapter === undefined || preparedPrintRef.current === null) return;
    setPrintStatus('Opening the native print dialog…');
    try {
      await printAdapter.openDialog();
      setPrintStatus(
        'Print dialog closed. PDFrig cannot confirm whether pages were printed or saved.',
      );
    } catch {
      setPrintStatus('The native print dialog could not be opened on this device.');
    }
  };

  const onApplyRedactions = async (): Promise<void> => {
    const client = workerRef.current;
    if (
      client === null ||
      primarySource === undefined ||
      !redactionEnabled ||
      !redactionDocumentEligible ||
      redactionMarks.length === 0
    )
      return;
    setLoading(true);
    setError(null);
    setRedactionStatus(null);
    try {
      const result = await client.redactRaster(
        primarySource.bytes.slice(),
        redactionMarks.map(({ pageIndex, rect }) => ({ pageIndex, rect })),
        { permanentRemoval: true, rasterization: true },
      );
      if (!(await saveOutput(result.bytes, `${safeOutputStem(displayName)}-redacted.pdf`))) return;
      setShowRedactionDialog(false);
      setRedactionStatus(
        `Verified a new ${result.verification.pageCount}-page redacted copy. The original remains unchanged.`,
      );
    } catch (redactionError) {
      setShowRedactionDialog(false);
      setError(describeError(redactionError));
    } finally {
      setLoading(false);
    }
  };

  const onExtract = async (): Promise<void> => {
    if (selectedPage === undefined || !allSourcesSafe) return;
    setLoading(true);
    try {
      await exportPages(
        [selectedPage],
        `${safeOutputStem(displayName)}-page-${selectedIndex + 1}.pdf`,
      );
    } catch (extractError) {
      setError(describeError(extractError));
    } finally {
      setLoading(false);
    }
  };

  const onSplit = async (): Promise<void> => {
    if (pages.length === 0 || !allSourcesSafe) return;
    setLoading(true);
    setError(null);
    try {
      const groups = parsePageGroups(splitRanges, pages.length);
      for (let index = 0; index < groups.length; index += 1) {
        const indices = groups[index];
        if (indices === undefined) continue;
        const groupPages = indices.flatMap((pageIndex) =>
          pages[pageIndex] === undefined ? [] : ([pages[pageIndex]] as const),
        );
        const saved = await exportPages(
          groupPages,
          `${safeOutputStem(displayName)}-part-${index + 1}.pdf`,
        );
        if (!saved) break;
      }
    } catch (splitError) {
      setError(splitError instanceof Error ? splitError.message : 'The page ranges are invalid.');
    } finally {
      setLoading(false);
    }
  };

  const onSearch = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (query.trim().length === 0) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const results: SearchResult[] = [];
      for (const source of sourcesRef.current.values()) {
        if (!pages.some((page) => page.sourceId === source.sourceId)) continue;
        for (const result of await source.document.search(query)) {
          const graphIndex = pages.findIndex(
            (page) =>
              page.sourceId === source.sourceId && page.sourcePageIndex === result.pageIndex,
          );
          if (graphIndex >= 0) results.push({ ...result, graphIndex, sourceId: source.sourceId });
        }
      }
      setSearchResults(Object.freeze(results));
    } catch {
      setError('Text search is unavailable for this PDF.');
    } finally {
      setSearching(false);
    }
  };

  const selectIndex = (index: number): void => {
    const page = pages[Math.max(0, Math.min(index, pages.length - 1))];
    if (page !== undefined) setSelectedId(page.id);
  };

  const warningText = useMemo(() => {
    const risks = [...sources.values()].flatMap(({ inspection }) => inspection.riskCodes);
    const labels = [...new Set(risks)].map((risk) => riskLabels[risk] ?? risk.toLowerCase());
    if (labels.length === 0) return null;
    if (risks.every((risk) => risk === 'FORMS')) {
      return 'Fill mode is available. Page organizing stays locked to preserve interactive fields.';
    }
    if (
      risks.includes('TAGGED_CONTENT') &&
      [...sources.values()].every(({ inspection }) => inspection.canAnnotateSafely)
    ) {
      return 'Editing is available. Existing tags and bookmarks are retained and checked on export; added content is not tagged. Page organizing stays locked to preserve their references.';
    }
    if (
      risks.includes('OUTLINES') &&
      [...sources.values()].every(({ inspection }) => inspection.canAnnotateSafely)
    ) {
      return 'Text overlays, annotations and supported form filling are available. Bookmarks are preserved in the new copy. Page organizing stays locked to keep their destinations unchanged.';
    }
    if (signatureEditPolicy.canContinueAfterAcknowledgement) {
      if (signatureEditPolicy.signatureDetection === 'signature-metadata') {
        return signatureEditPolicy.requiresAcknowledgement
          ? 'A digital-signature structure was detected. Editing this file may invalidate its current digital signature. Continue only if you intend to create a new copy.'
          : 'You chose to edit a new copy. Any current digital signature may become invalid. PDFrig does not verify signature validity.';
      }
      return signatureEditPolicy.requiresAcknowledgement
        ? 'A signature field was detected. Editing may invalidate a digital signature associated with it. Continue only if you intend to create a new copy.'
        : 'You chose to edit a new copy. A signature associated with the detected field may become invalid. PDFrig does not verify signature validity.';
    }
    return `Viewing is local and safe. Editing export is locked because this PDF contains ${labels.join(', ')}.`;
  }, [signatureEditPolicy, sources]);

  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    // Native drag events can have no transfer; React's convenience type assumes one.
    const file = event.nativeEvent.dataTransfer?.files[0];
    if (file !== undefined) void readPdfFile(file);
  };

  const currentState = (): EditorDocumentState =>
    sessionRef.current?.snapshot().state ?? createInitialEditorDocument({ pages: [] });

  const placeAnnotation = (annotation: EditorAnnotation): void => {
    execute(addAnnotationCommand(currentState(), annotation));
    setSelectedAnnotationId(annotation.id);
  };

  const placeRedaction = (rect: NormalizedRect): void => {
    if (selectedPage === undefined || !redactionDocumentEligible) return;
    setRedactionMarks((marks) => [
      ...marks,
      {
        id: crypto.randomUUID(),
        pageId: selectedPage.id,
        pageIndex: selectedPage.sourcePageIndex,
        rect,
      },
    ]);
    setRedactionStatus(null);
  };

  const placeCurrentToolAtCenter = (): void => {
    if (selectedPage === undefined) return;
    if (activeTool === 'measure') return;
    if (activeTool === 'sign') {
      setShowSignatureDialog(true);
      return;
    }
    if (activeTool === 'stamp') {
      setShowStampDialog(true);
      return;
    }
    if (activeTool === 'redact') {
      placeRedaction({ height: 0.12, width: 0.42, x: 0.29, y: 0.44 });
      return;
    }
    if (activeTool === 'eraser' || activeTool === 'fill' || activeTool === 'pages') return;
    placeAnnotation(
      createAnnotationForTool(
        activeTool,
        selectedPage.id,
        { x: 0.34, y: 0.44 },
        { x: 0.66, y: 0.55 },
        [
          { x: 0.34, y: 0.5 },
          { x: 0.43, y: 0.45 },
          { x: 0.52, y: 0.55 },
          { x: 0.66, y: 0.48 },
        ],
        { color: inkColor, strokeWidth: inkStrokeWidth },
      ),
    );
  };

  const onOverlayPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      selectedPage === undefined ||
      loading ||
      (activeTool === 'redact' ? !redactionDocumentEligible : !allSourcesAnnotatable) ||
      activeTool === 'pages' ||
      activeTool === 'measure' ||
      activeTool === 'fill' ||
      activeTool === 'sign' ||
      activeTool === 'stamp'
    )
      return;
    const point = pointFromEvent(event);
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    if (gesture.begin(point, event.pointerId, event.currentTarget.getBoundingClientRect()))
      event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onOverlayPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const point = pointFromEvent(event);
    const result = gesture.move(
      point,
      event.pointerId,
      activeTool === 'draw' || activeTool === 'eraser',
      event.currentTarget.getBoundingClientRect(),
    );
    if (result === 'limit')
      setError(
        'This stroke exceeded the 2,000-point limit and was not added. Draw shorter strokes; existing artwork is unchanged.',
      );
  };

  const onOverlayPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const draft = gesture.finish(event.pointerId, event.currentTarget.getBoundingClientRect());
    if (
      draft === null ||
      selectedPage === undefined ||
      event.pointerId !== draft.pointerId ||
      activeTool === 'pages' ||
      activeTool === 'measure' ||
      activeTool === 'fill' ||
      activeTool === 'sign' ||
      activeTool === 'stamp'
    )
      return;
    const end = pointFromEvent(event);
    if (activeTool === 'eraser') {
      const command = eraseInkAnnotationsCommand(
        currentState(),
        selectedPage.id,
        [...draft.points, end],
        inkEraserRadius,
        () => crypto.randomUUID(),
      );
      if (command !== null) {
        execute(command);
        setSelectedAnnotationId(null);
      }
      return;
    }
    if (activeTool === 'redact') {
      placeRedaction(rectFromPoints(draft.start, end, { height: 0.04, width: 0.08 }));
      return;
    }
    placeAnnotation(
      createAnnotationForTool(
        activeTool,
        selectedPage.id,
        draft.start,
        end,
        [...draft.points, end],
        { color: inkColor, strokeWidth: inkStrokeWidth },
      ),
    );
  };

  const setFieldValue = (field: PdfFormField, value: boolean | string): void => {
    if (selectedSource === undefined || field.readOnly) return;
    execute(
      setFormValueCommand(currentState(), {
        fieldName: field.fieldName,
        sourceId: selectedSource.sourceId,
        type: field.type,
        value,
      }),
    );
  };

  const fieldValue = (field: PdfFormField): boolean | string =>
    formValues.find(
      (value) => value.sourceId === selectedSource?.sourceId && value.fieldName === field.fieldName,
    )?.value ?? field.value;

  const nudgeAnnotation = (annotation: EditorAnnotation, deltaX: number, deltaY: number): void => {
    execute(
      updateAnnotationCommand(
        currentState(),
        transformAnnotationRect(annotation, {
          ...annotation.rect,
          x: Math.max(0, Math.min(1 - annotation.rect.width, annotation.rect.x + deltaX)),
          y: Math.max(0, Math.min(1 - annotation.rect.height, annotation.rect.y + deltaY)),
        }),
      ),
    );
  };

  const eraseSelectedInkAtMiddle = (): void => {
    if (selectedAnnotation?.kind !== 'ink') return;
    const middlePoint = selectedAnnotation.points[Math.floor(selectedAnnotation.points.length / 2)];
    if (middlePoint === undefined) return;
    const command = eraseInkAnnotationsCommand(
      currentState(),
      selectedAnnotation.pageId,
      [middlePoint],
      inkEraserRadius,
      () => crypto.randomUUID(),
    );
    if (command !== null) {
      execute(command);
      setSelectedAnnotationId(null);
    }
  };

  const onAnnotationKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    annotation: EditorAnnotation,
  ): void => {
    const distance = event.shiftKey ? 0.05 : 0.01;
    const movement: Readonly<Record<string, readonly [number, number]>> = {
      ArrowDown: [0, distance],
      ArrowLeft: [-distance, 0],
      ArrowRight: [distance, 0],
      ArrowUp: [0, -distance],
    };
    const delta = movement[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      nudgeAnnotation(annotation, delta[0], delta[1]);
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      execute(deleteAnnotationCommand(currentState(), annotation.id));
      setSelectedAnnotationId(null);
    }
  };

  return (
    <main
      className={`app-frame${isPresenting ? ' app-frame--presenting' : ''}`}
      onDragOver={desktopAccess === 'ready' ? (event) => event.preventDefault() : undefined}
      onDrop={desktopAccess === 'ready' ? onDrop : undefined}
    >
      <header className="app-topbar">
        <a aria-label="Back to PDFrig home" className="brand-link" href={marketingHref}>
          <BrandLockup compact />
        </a>
        <div className="document-status" aria-label="Document status">
          <strong>{displayName}</strong>
          <span>
            {snapshot?.exported === false ? 'Changes not exported' : 'Original unchanged'}
          </span>
        </div>
        <div className="history-actions" aria-label="Editor history">
          <button
            disabled={snapshot?.canUndo !== true}
            onClick={() => {
              sessionRef.current?.undo();
              setVersion((value) => value + 1);
            }}
            type="button"
          >
            Undo
          </button>
          <button
            disabled={snapshot?.canRedo !== true}
            onClick={() => {
              sessionRef.current?.redo();
              setVersion((value) => value + 1);
            }}
            type="button"
          >
            Redo
          </button>
        </div>
        <span className="foundation-badge">{surface} · Local workspace</span>
        {accountControl}
        <button
          className="button button--secondary topbar-print"
          disabled={
            desktopAccess !== 'ready' ||
            printAdapter === undefined ||
            !allSourcesAnnotatable ||
            loading ||
            printLoading ||
            pages.length === 0 ||
            redactionMarks.length > 0
          }
          onClick={() => {
            setPrintStatus(null);
            setShowPrintDialog(true);
          }}
          type="button"
        >
          Print
        </button>
        <button
          className="button button--primary topbar-export"
          disabled={
            desktopAccess !== 'ready' ||
            !allSourcesAnnotatable ||
            loading ||
            pages.length === 0 ||
            redactionMarks.length > 0
          }
          onClick={() => setShowExportDialog(true)}
          type="button"
        >
          Review export
        </button>
      </header>

      {desktopAccess === 'ready' ? (
        <>
          <div
            className={`workspace-grid${activeTool === 'pages' ? ' workspace-grid--pages' : ''}${toolsCollapsed ? ' workspace-grid--tools-collapsed' : ''}${contextCollapsed ? ' workspace-grid--context-collapsed' : ''}`}
          >
            <nav aria-label="Editor tools" className="tool-rail">
              <div className="tool-rail__heading">
                <p>Tools</p>
                <button
                  aria-controls="workspace-tool-list"
                  aria-expanded={!toolsCollapsed}
                  aria-label={toolsCollapsed ? 'Expand tools' : 'Collapse tools'}
                  className="tool-rail__toggle"
                  onClick={() => setToolsCollapsed((collapsed) => !collapsed)}
                  title={toolsCollapsed ? 'Expand tools' : 'Collapse tools'}
                  type="button"
                >
                  <ToolIcon name={toolsCollapsed ? 'expand' : 'collapse'} />
                </button>
              </div>
              <ul id="workspace-tool-list">
                <li>
                  <button onClick={() => void choosePrimaryPdf()} title="Open PDF" type="button">
                    <span aria-hidden="true" className="tool-glyph">
                      <ToolIcon name="open" />
                    </span>
                    <span className="tool-label">Open</span>
                  </button>
                </li>
                {(
                  [
                    ['pages', 'pages', 'Pages'],
                    ['text', 'text', 'Text'],
                    ['highlight', 'markup', 'Markup'],
                    ['draw', 'draw', 'Draw'],
                    ['rectangle', 'shapes', 'Shapes'],
                    ['comment', 'comment', 'Comment'],
                    ...(measurementEnabled ? ([['measure', 'measure', 'Measure']] as const) : []),
                    ...(stampsEnabled ? ([['stamp', 'stamp', 'Stamp']] as const) : []),
                    ['fill', 'fill', 'Fill'],
                    ['sign', 'sign', 'Sign'],
                    ['redact', 'redact', 'Redact beta'],
                  ] as const
                ).map(([tool, icon, label]) => (
                  <li
                    className={
                      activeTool === tool ||
                      (tool === 'text' && activeTool === 'callout') ||
                      (tool === 'draw' && activeTool === 'eraser')
                        ? 'is-current'
                        : undefined
                    }
                    key={tool}
                  >
                    <button
                      aria-current={
                        activeTool === tool ||
                        (tool === 'text' && activeTool === 'callout') ||
                        (tool === 'draw' && activeTool === 'eraser')
                          ? 'true'
                          : undefined
                      }
                      disabled={
                        pages.length === 0 ||
                        (tool === 'redact'
                          ? !redactionEnabled || !redactionDocumentEligible
                          : tool !== 'pages' && tool !== 'measure' && !allSourcesAnnotatable)
                      }
                      onClick={() => {
                        setActiveTool(tool);
                        setContextCollapsed(false);
                        setSelectedAnnotationId(null);
                        if (tool === 'sign') setShowSignatureDialog(true);
                        if (tool === 'stamp') setShowStampDialog(true);
                      }}
                      type="button"
                      title={label}
                    >
                      <span aria-hidden="true" className="tool-glyph">
                        <ToolIcon name={icon} />
                      </span>
                      <span className="tool-label">{label}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    disabled={loading || pages.length === 0 || !allSourcesSafe}
                    onClick={(event) => {
                      pdfInsertTriggerRef.current = event.currentTarget;
                      insertInputRef.current?.click();
                    }}
                    type="button"
                    title="Insert PDF pages"
                  >
                    <span aria-hidden="true" className="tool-glyph">
                      <ToolIcon name="pdf" />
                    </span>
                    <span className="tool-label">PDF</span>
                  </button>
                </li>
                <li>
                  <button
                    disabled={loading || pages.length === 0 || !allSourcesSafe}
                    onClick={() => imageInputRef.current?.click()}
                    type="button"
                    title="Insert image"
                  >
                    <span aria-hidden="true" className="tool-glyph">
                      <ToolIcon name="image" />
                    </span>
                    <span className="tool-label">Image</span>
                  </button>
                </li>
              </ul>
              <input
                accept="application/pdf,.pdf"
                aria-label="Open PDF"
                className="visually-hidden"
                onChange={onOpenFile}
                ref={openInputRef}
                type="file"
              />
              <input
                accept="application/pdf,.pdf"
                aria-label="Insert PDF"
                className="visually-hidden"
                disabled={loading}
                onChange={(event) => void onInsertPdf(event)}
                ref={insertInputRef}
                type="file"
              />
              <input
                accept="image/png,image/jpeg,image/webp"
                aria-label="Insert image"
                className="visually-hidden"
                disabled={loading}
                onChange={(event) => void onInsertImage(event)}
                ref={imageInputRef}
                type="file"
              />
            </nav>

            <aside
              className={`context-panel${activeTool === 'pages' ? ' context-panel--pages' : ''}${contextCollapsed ? ' context-panel--collapsed' : ''}${
                (activeTool === 'comment' && commentReviewEnabled) || activeTool === 'measure'
                  ? ' context-panel--review'
                  : ''
              }`}
              aria-label={`${toolLabels[activeTool]} options`}
            >
              <div className="panel-heading">
                <div className="context-panel__title" hidden={contextCollapsed}>
                  <span className="panel-kicker">Tool</span>
                  <h2>{toolLabels[activeTool]}</h2>
                  {activeTool === 'pages' && (
                    <small className="context-panel__count">
                      {pages.length} {pages.length === 1 ? 'page' : 'pages'}
                    </small>
                  )}
                </div>
                <div className="context-panel__actions">
                  {((activeTool === 'comment' && commentReviewEnabled) ||
                    activeTool === 'measure') &&
                    !contextCollapsed && (
                      <button
                        className="panel-done"
                        onClick={() => setActiveTool('pages')}
                        type="button"
                      >
                        Close
                      </button>
                    )}
                  <button
                    aria-controls="workspace-context-content"
                    aria-expanded={!contextCollapsed}
                    aria-label={contextCollapsed ? 'Expand tool options' : 'Collapse tool options'}
                    className="tool-rail__toggle context-panel__toggle"
                    onClick={() => setContextCollapsed((collapsed) => !collapsed)}
                    title={
                      contextCollapsed
                        ? `Show ${toolLabels[activeTool]} options`
                        : `Hide ${toolLabels[activeTool]} options`
                    }
                    type="button"
                  >
                    <ToolIcon name={contextCollapsed ? 'expand' : 'collapse'} />
                  </button>
                </div>
              </div>
              <div
                className="context-panel__content"
                id="workspace-context-content"
                hidden={contextCollapsed}
              >
                {activeTool === 'pages' && pages.length === 0 ? (
                  <p className="panel-empty-copy panel-empty-copy--spaced">
                    Page thumbnails appear after you open a PDF.
                  </p>
                ) : activeTool === 'pages' ? (
                  <PageThumbnails
                    canMove={allSourcesSafe}
                    documentFor={(page) => sources.get(page.sourceId)?.document}
                    onMove={(pageId, index) => {
                      if (sessionRef.current !== null)
                        execute(
                          moveEditorPageCommand(sessionRef.current.snapshot().state, pageId, index),
                        );
                    }}
                    onSelect={setSelectedId}
                    pages={pages}
                    renderQueue={thumbnailRenderQueue}
                    selectedId={effectiveSelectedId ?? undefined}
                  />
                ) : activeTool === 'measure' && currentMeasurement !== null ? (
                  <MeasurementPanel
                    key={`${currentMeasurement.pageId}:${selectedPage?.rotation}`}
                    measurement={currentMeasurement}
                    metrics={currentMeasurementMetrics}
                    geometryUnavailable={
                      measurementMetrics?.pageId === selectedPage?.id &&
                      measurementMetrics?.rotation === selectedPage?.rotation &&
                      measurementMetrics?.value === null
                    }
                    onChange={(measurement) =>
                      execute(setPageMeasurementCommand(currentState(), measurement))
                    }
                  />
                ) : activeTool === 'redact' ? (
                  <div className="tool-options redaction-options">
                    <p className="redaction-method">Destructive privacy method</p>
                    <p>
                      Mark areas for permanent removal. PDFrig rebuilds every page as an image, then
                      independently verifies the new copy before download.
                    </p>
                    <ul>
                      <li>
                        Removes searchable text, forms, links, comments, tags, layers, and
                        attachments.
                      </li>
                      <li>Invalidates signatures and rasterizes vector artwork.</li>
                      <li>Your original file stays unchanged.</li>
                    </ul>
                    {!redactionEnabled && <p>This beta is disabled by the release kill switch.</p>}
                    {redactionEnabled && !redactionDocumentEligible && (
                      <p>
                        Start from one unmodified, unencrypted PDF with no more than 25 pages. XFA
                        files are blocked.
                      </p>
                    )}
                    <button
                      className="keyboard-place"
                      disabled={!redactionDocumentEligible}
                      onClick={placeCurrentToolAtCenter}
                      type="button"
                    >
                      Mark page centre
                    </button>
                    <button
                      disabled={redactionMarks.length === 0}
                      onClick={() => setRedactionMarks([])}
                      type="button"
                    >
                      Clear {redactionMarks.length} removal mark
                      {redactionMarks.length === 1 ? '' : 's'}
                    </button>
                    <button
                      className="button button--primary"
                      disabled={redactionMarks.length === 0 || loading}
                      onClick={() => setShowRedactionDialog(true)}
                      type="button"
                    >
                      Review permanent removal
                    </button>
                  </div>
                ) : activeTool === 'text' || activeTool === 'callout' ? (
                  <div className="tool-options">
                    <p>
                      Choose original-text editing, OCR search/copy for a scan, or drag to add an
                      overlay. Original-text replacements preserve the existing font and must fit;
                      OCR leaves scanned artwork unchanged.
                    </p>
                    <button
                      type="button"
                      disabled={!allSourcesAnnotatable || !selectedSource || sources.size >= 8}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setSourceTextInitialSelection(
                          sourceTextSelectionReader.current?.() ??
                            (sourceTextSelection?.sourceId === selectedSource?.sourceId &&
                            sourceTextSelection?.pageIndex === selectedPage?.sourcePageIndex
                              ? (sourceTextSelection?.value ?? null)
                              : null),
                        );
                        setSourceTextMode('edit');
                      }}
                    >
                      Edit existing text
                    </button>
                    <button
                      type="button"
                      disabled={!allSourcesAnnotatable || !selectedSource || sources.size >= 8}
                      onClick={() => setSourceTextMode('ocr')}
                    >
                      OCR this page
                    </button>
                    {(['text', 'callout'] as const).map((tool) => (
                      <button
                        aria-pressed={activeTool === tool}
                        className={activeTool === tool ? 'is-selected' : undefined}
                        key={tool}
                        onClick={() => setActiveTool(tool)}
                        type="button"
                      >
                        {tool === 'text' ? 'Text box' : toolLabels[tool]}
                      </button>
                    ))}
                    <button
                      className="keyboard-place"
                      onClick={placeCurrentToolAtCenter}
                      type="button"
                    >
                      Place at page centre
                    </button>
                  </div>
                ) : activeTool === 'draw' || activeTool === 'eraser' ? (
                  <div className="tool-options">
                    <p>
                      Draw a freehand line. Eraser removes only the part you cross; select a mark
                      and press Delete to remove the whole mark. Undo is always available.
                    </p>
                    <button
                      aria-pressed={activeTool === 'draw'}
                      className={activeTool === 'draw' ? 'is-selected' : undefined}
                      onClick={() => setActiveTool('draw')}
                      type="button"
                    >
                      Freehand
                    </button>
                    <button
                      aria-pressed={activeTool === 'eraser'}
                      className={activeTool === 'eraser' ? 'is-selected' : undefined}
                      onClick={() => setActiveTool('eraser')}
                      type="button"
                    >
                      Eraser
                    </button>
                    {activeTool === 'draw' ? (
                      <>
                        <label className="field-stack">
                          Stroke colour
                          <input
                            aria-label="Freehand stroke colour"
                            onChange={(event) => setInkColor(event.target.value)}
                            type="color"
                            value={inkColor}
                          />
                        </label>
                        <label className="field-stack">
                          Stroke thickness
                          <select
                            onChange={(event) => setInkStrokeWidth(Number(event.target.value))}
                            value={inkStrokeWidth}
                          >
                            <option value="1">Thin</option>
                            <option value="2">Regular</option>
                            <option value="4">Bold</option>
                            <option value="6">Heavy</option>
                          </select>
                        </label>
                        <button
                          className="keyboard-place"
                          onClick={placeCurrentToolAtCenter}
                          type="button"
                        >
                          Place at page centre
                        </button>
                      </>
                    ) : (
                      <>
                        <label className="field-stack">
                          Eraser size
                          <select
                            onChange={(event) => setInkEraserRadius(Number(event.target.value))}
                            value={inkEraserRadius}
                          >
                            <option value="0.025">Small</option>
                            <option value="0.04">Medium</option>
                            <option value="0.07">Large</option>
                          </select>
                        </label>
                        {selectedAnnotation?.kind === 'ink' && (
                          <button
                            className="keyboard-place"
                            onClick={eraseSelectedInkAtMiddle}
                            type="button"
                          >
                            Erase middle of selected stroke
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ) : activeTool === 'highlight' ||
                  activeTool === 'underline' ||
                  activeTool === 'strikeout' ? (
                  <div className="tool-options">
                    <p>Drag across an area on the page. Choose how the mark appears.</p>
                    {(['highlight', 'underline', 'strikeout'] as const).map((tool) => (
                      <button
                        aria-pressed={activeTool === tool}
                        className={activeTool === tool ? 'is-selected' : undefined}
                        key={tool}
                        onClick={() => setActiveTool(tool)}
                        type="button"
                      >
                        {toolLabels[tool]}
                      </button>
                    ))}
                    <button
                      className="keyboard-place"
                      onClick={placeCurrentToolAtCenter}
                      type="button"
                    >
                      Place at page centre
                    </button>
                  </div>
                ) : activeTool === 'rectangle' ||
                  activeTool === 'ellipse' ||
                  activeTool === 'line' ||
                  activeTool === 'arrow' ? (
                  <div className="tool-options">
                    <p>
                      Drag to draw a shape. Its position remains stable when you zoom or rotate.
                    </p>
                    {(['rectangle', 'ellipse', 'line', 'arrow'] as const).map((tool) => (
                      <button
                        aria-pressed={activeTool === tool}
                        className={activeTool === tool ? 'is-selected' : undefined}
                        key={tool}
                        onClick={() => setActiveTool(tool)}
                        type="button"
                      >
                        {toolLabels[tool]}
                      </button>
                    ))}
                    <button
                      className="keyboard-place"
                      onClick={placeCurrentToolAtCenter}
                      type="button"
                    >
                      Place at page centre
                    </button>
                  </div>
                ) : activeTool === 'comment' && commentReviewEnabled ? (
                  <div className="tool-options comment-review-options">
                    <p>
                      Place a local comment, then use the review ledger to navigate, resolve,
                      filter, and export a content-bearing summary.
                    </p>
                    <button
                      className="keyboard-place"
                      onClick={placeCurrentToolAtCenter}
                      type="button"
                    >
                      Place comment at page centre
                    </button>
                    <CommentReviewLedger
                      comments={comments}
                      currentPageId={selectedPage?.id}
                      onExport={() => void exportCommentSummary()}
                      onSelect={(comment) => {
                        setSelectedId(comment.pageId);
                        setSelectedAnnotationId(comment.id);
                      }}
                      onStatusChange={(comment) => {
                        execute(
                          updateCommentStatusCommand(
                            currentState(),
                            comment.id,
                            comment.status === 'open' ? 'resolved' : 'open',
                          ),
                        );
                        setCommentExportStatus(
                          comment.status === 'open' ? 'Comment resolved.' : 'Comment reopened.',
                        );
                      }}
                      pages={pages}
                      saving={loading}
                      statusMessage={commentExportStatus}
                    />
                  </div>
                ) : activeTool === 'sign' || activeTool === 'checkmark' || activeTool === 'date' ? (
                  <div className="tool-options">
                    <p>Visual marks are not certificate-backed digital signatures.</p>
                    <button onClick={() => setShowSignatureDialog(true)} type="button">
                      Create visual signature
                    </button>
                    <button onClick={() => setActiveTool('checkmark')} type="button">
                      Checkmark
                    </button>
                    <button onClick={() => setActiveTool('date')} type="button">
                      Today’s date
                    </button>
                    {(activeTool === 'checkmark' || activeTool === 'date') && (
                      <button
                        className="keyboard-place"
                        onClick={placeCurrentToolAtCenter}
                        type="button"
                      >
                        Place at page centre
                      </button>
                    )}
                  </div>
                ) : activeTool === 'stamp' ? (
                  <div className="tool-options stamp-options">
                    <p>
                      Choose a built-in review label or make a one-time custom text stamp. Export
                      flattens it into a new PDF copy.
                    </p>
                    <button onClick={() => setShowStampDialog(true)} type="button">
                      Choose stamp
                    </button>
                    <button
                      className="keyboard-place"
                      onClick={placeCurrentToolAtCenter}
                      type="button"
                    >
                      Place at page centre
                    </button>
                    <small>Custom stamps stay local. Team sharing is not enabled.</small>
                  </div>
                ) : activeTool === 'fill' ? (
                  <div className="tool-options">
                    <p>
                      {selectedPageFields.length === 0
                        ? 'No supported fields are visible on this page.'
                        : `${selectedPageFields.length} supported field${selectedPageFields.length === 1 ? '' : 's'} on this page.`}
                    </p>
                    <p>
                      Fill directly on the document, then choose whether fields stay editable at
                      export.
                    </p>
                  </div>
                ) : (
                  <div className="tool-options">
                    <p>
                      Drag on the page to place {toolLabels[activeTool].toLowerCase()}. Use the
                      button below for a keyboard-only placement.
                    </p>
                    <button
                      className="keyboard-place"
                      onClick={placeCurrentToolAtCenter}
                      type="button"
                    >
                      Place at page centre
                    </button>
                  </div>
                )}
              </div>
            </aside>

            <section
              className={`canvas-workspace${pages.length > 0 ? ' canvas-workspace--document' : ''}`}
              aria-labelledby="workspace-title"
            >
              {error !== null && (
                <div className="workspace-alert" role="alert">
                  <strong>Couldn’t finish that.</strong>
                  <span>{error}</span>
                  <button onClick={() => setError(null)} type="button">
                    Dismiss
                  </button>
                </div>
              )}
              {warningText !== null && (
                <DocumentNotice
                  key={[...sources.keys()].join('|')}
                  message={warningText}
                  title={
                    allSourcesAnnotatable && primarySource?.inspection.isTagged
                      ? 'Editing available'
                      : allSourcesAnnotatable && primarySource?.inspection.hasOutline
                        ? 'Bookmarks preserved'
                        : 'Protected document'
                  }
                >
                  {signatureEditPolicy.requiresAcknowledgement && (
                    <button onClick={() => setSignatureEditAcknowledged(true)} type="button">
                      Continue editing a new copy
                    </button>
                  )}
                </DocumentNotice>
              )}
              {redactionStatus !== null && (
                <div className="workspace-success" role="status">
                  <strong>Permanent removal verified</strong>
                  <span>{redactionStatus}</span>
                  <button onClick={() => setRedactionStatus(null)} type="button">
                    Dismiss
                  </button>
                </div>
              )}
              {pendingPassword !== null ? (
                <form className="empty-canvas password-card" onSubmit={onPasswordSubmit}>
                  <p className="eyebrow">Protected PDF</p>
                  <h1 id="workspace-title">Enter its password.</h1>
                  <p>
                    The password is used in memory to open this file. PDFrig does not save or log
                    it.
                  </p>
                  <label htmlFor="pdf-password">Document password</label>
                  <input
                    autoComplete="off"
                    id="pdf-password"
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    value={password}
                  />
                  <button
                    className="button button--primary"
                    disabled={loading || password.length === 0}
                    type="submit"
                  >
                    Open locally
                  </button>
                </form>
              ) : pages.length === 0 ? (
                <div className="empty-canvas drop-canvas">
                  <div aria-hidden="true" className="empty-canvas__pages">
                    <span />
                    <span />
                  </div>
                  <p className="eyebrow">Private by default</p>
                  <h1 id="workspace-title">Drop in a PDF.</h1>
                  <p>
                    View and organize up to 500 pages or 50 MB. Your document stays{' '}
                    {surface === 'Windows' ? 'in this app on your device' : 'in this browser tab'}{' '}
                    and is never uploaded.
                  </p>
                  <button
                    className="button button--primary"
                    disabled={loading}
                    onClick={() => void choosePrimaryPdf()}
                    type="button"
                  >
                    Choose a PDF
                  </button>
                  <div className="processing-note">
                    <span aria-hidden="true" className="status-dot status-dot--local" />
                    <span>
                      <strong>Runs on this device</strong>No account required.
                    </span>
                  </div>
                  {recentFilesSnapshot !== null && (
                    <section className="recent-files" aria-label="Recent PDFs on this device">
                      <div className="recent-files__setting">
                        <input
                          aria-describedby="remember-recent-pdfs-detail"
                          aria-labelledby="remember-recent-pdfs-label"
                          checked={recentFilesSnapshot.enabled}
                          id="remember-recent-pdfs"
                          onChange={(event) => void setRecentFilesEnabled(event.target.checked)}
                          type="checkbox"
                        />
                        <span>
                          <strong id="remember-recent-pdfs-label">Remember recent PDFs</strong>
                          <small id="remember-recent-pdfs-detail">
                            Off by default. Stores file locations on this PC, never a document copy.
                          </small>
                        </span>
                      </div>
                      {recentFilesSnapshot.enabled && (
                        <div className="recent-files__list">
                          <div className="recent-files__heading">
                            <strong>Recent on this device</strong>
                            {recentFilesSnapshot.entries.length > 0 && (
                              <button onClick={() => void clearRecentFiles()} type="button">
                                Clear list
                              </button>
                            )}
                          </div>
                          {recentFilesSnapshot.entries.length === 0 ? (
                            <p>PDFs you open next will appear here.</p>
                          ) : (
                            <ul>
                              {recentFilesSnapshot.entries.map((entry) => (
                                <li key={entry.id}>
                                  <button
                                    disabled={!entry.available || loading}
                                    onClick={() => void openRecentPdf(entry.id)}
                                    type="button"
                                  >
                                    <span>{entry.displayName}</span>
                                    <small>
                                      {entry.available
                                        ? new Date(entry.lastOpenedAt).toLocaleString()
                                        : 'File is no longer available'}
                                    </small>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </div>
              ) : (
                <div
                  aria-label={isPresenting ? 'Presentation view' : undefined}
                  className={`document-stage${isPresenting ? ' document-stage--presentation' : ''}`}
                  role={isPresenting ? 'region' : undefined}
                >
                  {isPresenting ? (
                    <div
                      aria-label="Presentation controls"
                      className="presentation-toolbar"
                      role="toolbar"
                    >
                      <div className="presentation-toolbar__status">
                        <span className="presentation-toolbar__mode">Presentation</span>
                        <span aria-atomic="true" aria-live="polite">
                          Page <strong>{selectedIndex + 1}</strong> of {pages.length}
                        </span>
                        <span className="presentation-toolbar__local">
                          <span aria-hidden="true" className="status-dot status-dot--local" />
                          Runs on this device
                        </span>
                      </div>
                      <p>Use ← and → to change pages. Press Esc to exit.</p>
                      <div className="presentation-toolbar__actions">
                        <button
                          disabled={selectedIndex === 0}
                          onClick={() => selectIndex(selectedIndex - 1)}
                          type="button"
                        >
                          Previous page
                        </button>
                        <button
                          disabled={selectedIndex >= pages.length - 1}
                          onClick={() => selectIndex(selectedIndex + 1)}
                          type="button"
                        >
                          Next page
                        </button>
                        <button onClick={stopPresentation} ref={presentationExitRef} type="button">
                          Exit presentation
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div aria-label="Document navigation" className="viewer-toolbar" role="toolbar">
                      <button
                        disabled={selectedIndex === 0}
                        onClick={() => selectIndex(selectedIndex - 1)}
                        type="button"
                      >
                        Previous
                      </button>
                      <span>
                        <strong>{selectedIndex + 1}</strong> / {pages.length}
                      </span>
                      <button
                        disabled={selectedIndex >= pages.length - 1}
                        onClick={() => selectIndex(selectedIndex + 1)}
                        type="button"
                      >
                        Next
                      </button>
                      <button
                        aria-pressed={activeTool === 'pages'}
                        onClick={() => setActiveTool('pages')}
                        type="button"
                      >
                        Select text
                      </button>
                      <button
                        disabled={
                          !allSourcesAnnotatable ||
                          sources.size >= 8 ||
                          !selectedSource ||
                          !selectedPage ||
                          sourceTextSelection?.sourceId !== selectedSource.sourceId ||
                          sourceTextSelection.pageIndex !== selectedPage.sourcePageIndex
                        }
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setSourceTextInitialSelection(
                            sourceTextSelectionReader.current?.() ??
                              sourceTextSelection?.value ??
                              null,
                          );
                          setSourceTextMode('edit');
                        }}
                        type="button"
                      >
                        Edit selected text
                      </button>
                      <span className="viewer-toolbar__divider" />
                      <button
                        aria-label="Zoom out"
                        disabled={zoom <= 0.01}
                        onClick={() => {
                          setAutoFit(false);
                          setZoom((value) => Math.max(0.01, value - 0.1));
                        }}
                        type="button"
                      >
                        −
                      </button>
                      <span>{Math.round(zoom * 100)}%</span>
                      <button
                        aria-label="Zoom in"
                        disabled={zoom >= 2.5}
                        onClick={() => {
                          setAutoFit(false);
                          setZoom((value) => Math.min(2.5, value + 0.1));
                        }}
                        type="button"
                      >
                        +
                      </button>
                      <button
                        aria-label="Fit full page"
                        aria-pressed={autoFit}
                        onClick={() => setAutoFit(true)}
                        type="button"
                      >
                        Fit
                      </button>
                      <button
                        aria-label="Actual size (100%)"
                        onClick={() => {
                          setAutoFit(false);
                          setZoom(1);
                        }}
                        type="button"
                      >
                        100%
                      </button>
                      <button onClick={startPresentation} ref={presentationEnterRef} type="button">
                        Present
                      </button>
                    </div>
                  )}
                  <details className="compact-organizer">
                    <summary>Page actions</summary>
                    <div>
                      <button
                        disabled={!allSourcesSafe || selectedIndex === 0}
                        onClick={() =>
                          selectedPage !== undefined &&
                          execute(
                            moveEditorPageCommand(
                              currentState(),
                              selectedPage.id,
                              selectedIndex - 1,
                            ),
                          )
                        }
                        type="button"
                      >
                        Move up
                      </button>
                      <button
                        disabled={!allSourcesSafe || selectedIndex === pages.length - 1}
                        onClick={() =>
                          selectedPage !== undefined &&
                          execute(
                            moveEditorPageCommand(
                              currentState(),
                              selectedPage.id,
                              selectedIndex + 1,
                            ),
                          )
                        }
                        type="button"
                      >
                        Move down
                      </button>
                      <button
                        disabled={!allSourcesSafe}
                        onClick={() =>
                          selectedPage !== undefined &&
                          execute(rotateEditorPageCommand(currentState(), selectedPage.id, true))
                        }
                        type="button"
                      >
                        Rotate
                      </button>
                      <button
                        disabled={!allSourcesSafe}
                        onClick={() =>
                          selectedPage !== undefined &&
                          execute(
                            duplicateEditorPageCommand(
                              currentState(),
                              selectedPage.id,
                              crypto.randomUUID(),
                              () => crypto.randomUUID(),
                            ),
                          )
                        }
                        type="button"
                      >
                        Duplicate
                      </button>
                      <button
                        disabled={!allSourcesSafe || pages.length <= 1}
                        onClick={() =>
                          selectedPage !== undefined &&
                          execute(deleteEditorPageCommand(currentState(), selectedPage.id))
                        }
                        type="button"
                      >
                        Delete
                      </button>
                      <button
                        disabled={loading || !allSourcesSafe}
                        onClick={(event) => {
                          pdfInsertTriggerRef.current = event.currentTarget;
                          insertInputRef.current?.click();
                        }}
                        type="button"
                      >
                        Add PDF
                      </button>
                    </div>
                  </details>
                  <div
                    aria-label={
                      isPresenting ? `Presented document page ${selectedIndex + 1}` : undefined
                    }
                    className={`page-pasteboard${
                      isPresenting ? ' page-pasteboard--presentation' : ''
                    }`}
                    ref={pasteboardRef}
                    role={isPresenting ? 'group' : undefined}
                    tabIndex={isPresenting ? 0 : undefined}
                  >
                    <div className="page-surface">
                      <canvas
                        aria-label={`Rendered page ${selectedIndex + 1}`}
                        className="pdf-page-canvas"
                        ref={canvasRef}
                      />
                      {selectedSource !== undefined && selectedPage !== undefined && (
                        <PdfTextLayer
                          selectionReaderRef={sourceTextSelectionReader}
                          document={selectedSource.document}
                          pageIndex={selectedPage.sourcePageIndex}
                          scale={zoom}
                          rotation={selectedPage.rotation}
                          enabled={activeTool === 'pages'}
                          onSelection={(value) =>
                            setSourceTextSelection(
                              value
                                ? {
                                    sourceId: selectedSource.sourceId,
                                    pageIndex: selectedPage.sourcePageIndex,
                                    value,
                                  }
                                : null,
                            )
                          }
                          key={`${selectedSource.sourceId}:${selectedPage.sourcePageIndex}:${selectedPage.rotation}:${zoom}`}
                        />
                      )}
                      {activeTool === 'measure' &&
                        currentMeasurement !== null &&
                        currentMeasurementMetrics !== null && (
                          <MeasurementOverlay
                            key={`${currentMeasurement.pageId}:${selectedPage?.rotation}`}
                            measurement={currentMeasurement}
                            onChange={(measurement) =>
                              execute(setPageMeasurementCommand(currentState(), measurement))
                            }
                          />
                        )}
                      <div
                        aria-label={`Editable layer for page ${selectedIndex + 1}`}
                        className={`document-overlay document-overlay--${activeTool}`}
                        onPointerCancel={(event) => gesture.cancel(event.pointerId)}
                        onLostPointerCapture={(event) => gesture.cancel(event.pointerId)}
                        onPointerDown={onOverlayPointerDown}
                        onPointerMove={onOverlayPointerMove}
                        onPointerUp={onOverlayPointerUp}
                        role="group"
                        tabIndex={-1}
                      >
                        {redactionMarks
                          .filter(({ pageId }) => pageId === effectiveSelectedId)
                          .map((mark, index) => (
                            <button
                              aria-label={`Removal mark ${index + 1}. Select to remove this mark.`}
                              className="redaction-mark"
                              key={mark.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                setRedactionMarks((marks) =>
                                  marks.filter(({ id }) => id !== mark.id),
                                );
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              style={annotationStyle(mark.rect)}
                              type="button"
                            >
                              <span>REMOVE</span>
                            </button>
                          ))}
                        {selectedPageAnnotations.map((annotation) =>
                          annotation.kind === 'text' && activeTool !== 'eraser' ? (
                            <TextOverlay
                              annotation={annotation}
                              pageMetrics={
                                selectedPage !== undefined &&
                                pageMetrics?.pageId === selectedPage.id &&
                                pageMetrics.rotation === selectedPage.rotation
                                  ? pageMetrics.value
                                  : undefined
                              }
                              key={`${annotation.id}:${effectiveSelectedId}:${activeTool}:${selectedPage?.rotation}:${zoom}`}
                              scope={`${version}:${allSourcesAnnotatable}:${loading}`}
                              disabled={!allSourcesAnnotatable || loading}
                              selected={annotation.id === selectedAnnotationId}
                              onSelect={() => setSelectedAnnotationId(annotation.id)}
                              onCommit={(rect) => {
                                if (!allSourcesAnnotatable || loading) return;
                                execute(
                                  updateAnnotationCommand(currentState(), { ...annotation, rect }),
                                );
                              }}
                              onKeyDown={(event) => onAnnotationKeyDown(event, annotation)}
                            />
                          ) : activeTool === 'eraser' ? (
                            <button
                              aria-label={`${annotationName(annotation)}. Arrow keys move it; Delete removes it.`}
                              className={`annotation-item annotation-item--${annotation.kind}`}
                              key={annotation.id}
                              style={{
                                ...annotationStyle(annotation.rect),
                                ...annotationPresentationStyle(annotation),
                              }}
                              type="button"
                              onKeyDown={(event) => onAnnotationKeyDown(event, annotation)}
                            >
                              <AnnotationPreview
                                annotation={annotation}
                                pageMetrics={pageMetrics?.value}
                              />
                            </button>
                          ) : (
                            <PlaceableOverlay
                              rect={annotation.rect}
                              name={annotationName(annotation)}
                              resizeName={annotationName(annotation).toLowerCase()}
                              bodyClassName={`annotation-item--${annotation.kind}`}
                              bodyStyle={annotationPresentationStyle(annotation)}
                              key={`${annotation.id}:${effectiveSelectedId}:${activeTool}:${selectedPage?.rotation}:${zoom}`}
                              scope={`${version}:${allSourcesAnnotatable}:${loading}`}
                              disabled={!allSourcesAnnotatable || loading}
                              selected={annotation.id === selectedAnnotationId}
                              onSelect={() => setSelectedAnnotationId(annotation.id)}
                              onCommit={(rect) => {
                                if (!allSourcesAnnotatable || loading) return;
                                execute(
                                  updateAnnotationCommand(
                                    currentState(),
                                    transformAnnotationRect(annotation, rect),
                                  ),
                                );
                              }}
                              onKeyDown={(event) => onAnnotationKeyDown(event, annotation)}
                            >
                              {(rect) => (
                                <AnnotationPreview
                                  annotation={transformAnnotationRect(annotation, rect)}
                                  pageMetrics={pageMetrics?.value}
                                />
                              )}
                            </PlaceableOverlay>
                          ),
                        )}
                        {activeTool === 'fill' &&
                          selectedPageFields.map((field) => {
                            const value = fieldValue(field);
                            const fieldLabel = `${field.fieldName}${field.required ? ' (required)' : ''}`;
                            if (field.type === 'checkbox') {
                              return (
                                <label
                                  className="form-field-overlay form-field-overlay--checkbox"
                                  key={field.id}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  style={annotationStyle(field.rect)}
                                  title={fieldLabel}
                                >
                                  <input
                                    aria-label={fieldLabel}
                                    checked={value === true}
                                    disabled={field.readOnly}
                                    onChange={(event) => setFieldValue(field, event.target.checked)}
                                    type="checkbox"
                                  />
                                </label>
                              );
                            }
                            if (field.type === 'radio') {
                              const option = field.options[0];
                              if (option === undefined) return null;
                              return (
                                <label
                                  className="form-field-overlay form-field-overlay--radio"
                                  key={field.id}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  style={annotationStyle(field.rect)}
                                  title={`${fieldLabel}: ${option.label}`}
                                >
                                  <input
                                    aria-label={`${fieldLabel}: ${option.label}`}
                                    checked={value === option.value}
                                    disabled={field.readOnly}
                                    name={`${selectedSource?.sourceId}:${field.fieldName}`}
                                    onChange={() => setFieldValue(field, option.value)}
                                    type="radio"
                                  />
                                </label>
                              );
                            }
                            if (field.type === 'dropdown') {
                              return (
                                <label
                                  className="form-field-overlay"
                                  key={field.id}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  style={annotationStyle(field.rect)}
                                >
                                  <span className="visually-hidden">{fieldLabel}</span>
                                  <select
                                    aria-label={fieldLabel}
                                    disabled={field.readOnly}
                                    onChange={(event) => setFieldValue(field, event.target.value)}
                                    value={String(value)}
                                  >
                                    {field.options.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              );
                            }
                            return (
                              <label
                                className="form-field-overlay"
                                key={field.id}
                                onPointerDown={(event) => event.stopPropagation()}
                                style={annotationStyle(field.rect)}
                              >
                                <span className="visually-hidden">{fieldLabel}</span>
                                <input
                                  aria-label={fieldLabel}
                                  disabled={field.readOnly}
                                  maxLength={2_000}
                                  onChange={(event) => setFieldValue(field, event.target.value)}
                                  type="text"
                                  value={String(value)}
                                />
                              </label>
                            );
                          })}
                        {pointerDraft !== null &&
                          activeTool !== 'pages' &&
                          activeTool !== 'measure' &&
                          activeTool !== 'eraser' &&
                          activeTool !== 'fill' &&
                          activeTool !== 'sign' &&
                          activeTool !== 'stamp' &&
                          (activeTool === 'redact' ? (
                            <span
                              aria-hidden="true"
                              className="annotation-draft annotation-draft--redaction"
                              style={annotationStyle(
                                rectFromPoints(pointerDraft.start, pointerDraft.current),
                              )}
                            />
                          ) : (
                            (() => {
                              const draft = createAnnotationForTool(
                                activeTool,
                                effectiveSelectedId ?? 'draft-page',
                                pointerDraft.start,
                                pointerDraft.current,
                                pointerDraft.points,
                                { color: inkColor, strokeWidth: inkStrokeWidth },
                                'placement-preview',
                              );
                              return (
                                <div
                                  aria-hidden="true"
                                  className={`annotation-placement-preview annotation-item--${draft.kind}`}
                                  style={{
                                    ...annotationStyle(draft.rect),
                                    ...annotationPresentationStyle(draft),
                                  }}
                                >
                                  <AnnotationPreview
                                    annotation={draft}
                                    pageMetrics={pageMetrics?.value}
                                  />
                                </div>
                              );
                            })()
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {loading && (
                <div aria-live="polite" className="processing-overlay">
                  <span className="processing-spinner" />
                  <div className="processing-overlay__copy">
                    <strong>
                      {nativeFileTransfer === null
                        ? 'Working on this device…'
                        : `${nativeFileTransfer.direction === 'opening' ? 'Opening' : 'Saving'} on this device…`}
                    </strong>
                    {nativeFileTransfer !== null && (
                      <>
                        <progress
                          aria-label={`PDF ${nativeFileTransfer.direction} progress`}
                          max={nativeFileTransfer.totalBytes}
                          value={nativeFileTransfer.completedBytes}
                        />
                        <button
                          className="button button--quiet"
                          onClick={() => nativeTransferControllerRef.current?.abort()}
                          type="button"
                        >
                          Cancel transfer
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </section>

            <aside
              className={`properties-panel${
                selectedAnnotation === undefined ? '' : ' properties-panel--annotation'
              }`}
              aria-label="Page properties and search"
            >
              <div className="panel-heading">
                <div>
                  <span className="panel-kicker">Selection</span>
                  <h2>
                    {selectedAnnotation !== undefined
                      ? annotationName(selectedAnnotation)
                      : selectedPage === undefined
                        ? 'Properties'
                        : `Page ${selectedIndex + 1}`}
                  </h2>
                </div>
                {selectedAnnotation !== undefined && (
                  <button
                    className="panel-done"
                    onClick={() => setSelectedAnnotationId(null)}
                    type="button"
                  >
                    Done
                  </button>
                )}
              </div>
              {primarySource !== undefined && hasForms && allSourcesAnnotatable && !loading && (
                <FormDataPanel
                  key={primarySource.sourceId}
                  definitions={primarySource.formFields}
                  values={formValues}
                  sourceId={primarySource.sourceId}
                  onApply={(report) =>
                    execute(
                      importFormDataCommand(
                        currentState(),
                        report,
                        primarySource.formFields,
                        primarySource.sourceId,
                      ),
                    )
                  }
                  onSave={(bytes) =>
                    saveOutput(bytes, 'pdfmason-form-data.json', 'application/json')
                  }
                />
              )}
              {selectedPage === undefined ? (
                <p className="panel-empty-copy panel-empty-copy--spaced">
                  Open a PDF to inspect and arrange its pages.
                </p>
              ) : selectedAnnotation !== undefined ? (
                <div className="annotation-properties">
                  {selectedAnnotation.kind === 'visual-signature' && pages.length > 1 && (
                    <button
                      disabled={!allSourcesAnnotatable || loading || redactionMarks.length > 0}
                      type="button"
                      onClick={() =>
                        setPendingSignatureRepeat({
                          before: currentState(),
                          signatureId: selectedAnnotation.id,
                          version,
                        })
                      }
                    >
                      Copy selected signature to other pages
                    </button>
                  )}
                  <p className="property-help">
                    Drag the selected item to move it. Drag its edges or corners to resize. Arrow
                    keys move the item or resize a focused handle; Shift takes larger steps. Escape
                    cancels a drag.
                  </p>
                  {(selectedAnnotation.kind === 'text' ||
                    selectedAnnotation.kind === 'comment' ||
                    selectedAnnotation.kind === 'stamp') && (
                    <label className="field-stack">
                      {selectedAnnotation.kind === 'comment'
                        ? 'Comment'
                        : selectedAnnotation.kind === 'stamp'
                          ? 'Stamp text'
                          : 'Text'}
                      <textarea
                        maxLength={selectedAnnotation.kind === 'stamp' ? 40 : 2_000}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (
                            selectedAnnotation.kind === 'stamp' &&
                            (!validStampText(value) || value.trim().length === 0)
                          )
                            return;
                          execute(
                            updateAnnotationCommand(currentState(), {
                              ...selectedAnnotation,
                              text: value,
                            }),
                          );
                        }}
                        rows={4}
                        value={selectedAnnotation.text}
                      />
                    </label>
                  )}
                  {selectedAnnotation.kind === 'text' && (
                    <div className="annotation-style-controls">
                      <label className="field-stack">
                        Font size (pt)
                        <input
                          type="number"
                          min="6"
                          max="96"
                          step="1"
                          value={selectedAnnotation.fontSize}
                          onChange={(event) => {
                            const size = Number(event.target.value);
                            if (Number.isFinite(size) && size >= 6 && size <= 96)
                              execute(
                                updateAnnotationCommand(currentState(), {
                                  ...selectedAnnotation,
                                  fontSize: size,
                                }),
                              );
                          }}
                        />
                      </label>
                      <label className="field-stack">
                        Text alignment
                        <select
                          value={selectedAnnotation.alignment}
                          onChange={(event) => {
                            const alignment = event.target.value;
                            if (
                              alignment === 'left' ||
                              alignment === 'center' ||
                              alignment === 'right'
                            )
                              execute(
                                updateAnnotationCommand(currentState(), {
                                  ...selectedAnnotation,
                                  alignment,
                                }),
                              );
                          }}
                        >
                          <option value="left">Left</option>
                          <option value="center">Centre</option>
                          <option value="right">Right</option>
                        </select>
                      </label>
                    </div>
                  )}
                  {selectedAnnotation.kind === 'comment' && (
                    <div className="comment-properties">
                      <dl>
                        <div>
                          <dt>Author</dt>
                          <dd>{selectedAnnotation.author}</dd>
                        </div>
                        <div>
                          <dt>Created</dt>
                          <dd>
                            <time dateTime={selectedAnnotation.createdAt}>
                              {formatReviewTime(selectedAnnotation.createdAt)} UTC
                            </time>
                          </dd>
                        </div>
                        <div>
                          <dt>Stable ID</dt>
                          <dd>{selectedAnnotation.id}</dd>
                        </div>
                      </dl>
                      <button
                        className="comment-status-action"
                        onClick={() =>
                          execute(
                            updateCommentStatusCommand(
                              currentState(),
                              selectedAnnotation.id,
                              selectedAnnotation.status === 'open' ? 'resolved' : 'open',
                            ),
                          )
                        }
                        type="button"
                      >
                        {selectedAnnotation.status === 'open' ? 'Mark resolved' : 'Reopen comment'}
                      </button>
                    </div>
                  )}
                  {selectedAnnotation.kind === 'ink' && (
                    <div className="annotation-style-controls">
                      <label className="field-stack">
                        Stroke colour
                        <input
                          aria-label="Selected stroke colour"
                          onChange={(event) =>
                            execute(
                              updateAnnotationCommand(currentState(), {
                                ...selectedAnnotation,
                                color: event.target.value,
                              }),
                            )
                          }
                          type="color"
                          value={selectedAnnotation.color}
                        />
                      </label>
                      <label className="field-stack">
                        Stroke thickness
                        <select
                          onChange={(event) =>
                            execute(
                              updateAnnotationCommand(currentState(), {
                                ...selectedAnnotation,
                                strokeWidth: Number(event.target.value),
                              }),
                            )
                          }
                          value={selectedAnnotation.strokeWidth}
                        >
                          <option value="1">Thin</option>
                          <option value="2">Regular</option>
                          <option value="4">Bold</option>
                          <option value="6">Heavy</option>
                        </select>
                      </label>
                    </div>
                  )}
                  <div className="position-grid" aria-label="Annotation position">
                    {(
                      [
                        ['x', 'Left'],
                        ['y', 'Top'],
                        ['width', 'Width'],
                        ['height', 'Height'],
                      ] as const
                    ).map(([coordinate, label]) => (
                      <label key={coordinate}>
                        {label} %
                        <input
                          max="100"
                          min="0"
                          onChange={(event) =>
                            execute(
                              updateAnnotationCommand(
                                currentState(),
                                transformAnnotationRect(selectedAnnotation, {
                                  ...selectedAnnotation.rect,
                                  [coordinate]: Number(event.target.value) / 100,
                                }),
                              ),
                            )
                          }
                          step="1"
                          type="number"
                          value={Math.round(selectedAnnotation.rect[coordinate] * 100)}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="nudge-grid" aria-label="Move annotation">
                    <button
                      onClick={() => nudgeAnnotation(selectedAnnotation, 0, -0.01)}
                      type="button"
                    >
                      Move up
                    </button>
                    <button
                      onClick={() => nudgeAnnotation(selectedAnnotation, -0.01, 0)}
                      type="button"
                    >
                      Move left
                    </button>
                    <button
                      onClick={() => nudgeAnnotation(selectedAnnotation, 0.01, 0)}
                      type="button"
                    >
                      Move right
                    </button>
                    <button
                      onClick={() => nudgeAnnotation(selectedAnnotation, 0, 0.01)}
                      type="button"
                    >
                      Move down
                    </button>
                  </div>
                  <button
                    className="button button--danger property-action"
                    onClick={() => {
                      execute(deleteAnnotationCommand(currentState(), selectedAnnotation.id));
                      setSelectedAnnotationId(null);
                    }}
                    type="button"
                  >
                    Delete selected mark
                  </button>
                </div>
              ) : (
                <>
                  <p className="fidelity-note">
                    Organizer copies selected pages into a new PDF. Page content, resources,
                    annotations, boxes, and rotation are retained; document-level metadata is not
                    copied. Bookmarks, forms, tags, signatures, attachments, active content, earlier
                    revisions, and damaged structures stop safely.
                  </p>
                  <div className="page-actions" aria-label="Selected page actions">
                    <button
                      disabled={!allSourcesSafe || selectedIndex === 0}
                      onClick={() =>
                        execute(
                          moveEditorPageCommand(currentState(), selectedPage.id, selectedIndex - 1),
                        )
                      }
                      type="button"
                    >
                      Move up
                    </button>
                    <button
                      disabled={!allSourcesSafe || selectedIndex === pages.length - 1}
                      onClick={() =>
                        execute(
                          moveEditorPageCommand(currentState(), selectedPage.id, selectedIndex + 1),
                        )
                      }
                      type="button"
                    >
                      Move down
                    </button>
                    <button
                      disabled={!allSourcesSafe}
                      onClick={() =>
                        execute(rotateEditorPageCommand(currentState(), selectedPage.id, false))
                      }
                      type="button"
                    >
                      Rotate left
                    </button>
                    <button
                      disabled={!allSourcesSafe}
                      onClick={() =>
                        execute(rotateEditorPageCommand(currentState(), selectedPage.id, true))
                      }
                      type="button"
                    >
                      Rotate right
                    </button>
                    <button
                      disabled={!allSourcesSafe}
                      onClick={() =>
                        execute(
                          duplicateEditorPageCommand(
                            currentState(),
                            selectedPage.id,
                            crypto.randomUUID(),
                            () => crypto.randomUUID(),
                          ),
                        )
                      }
                      type="button"
                    >
                      Duplicate
                    </button>
                    <button
                      disabled={!allSourcesSafe || pages.length <= 1}
                      onClick={() =>
                        execute(deleteEditorPageCommand(currentState(), selectedPage.id))
                      }
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                  <button
                    className="button button--secondary property-action"
                    disabled={!allSourcesSafe || loading}
                    onClick={() => void onExtract()}
                    type="button"
                  >
                    Extract this page
                  </button>
                  <section className="property-section">
                    <h3>Split into copies</h3>
                    <p>Separate groups with semicolons.</p>
                    <label htmlFor="split-ranges">Page ranges</label>
                    <input
                      id="split-ranges"
                      onChange={(event) => setSplitRanges(event.target.value)}
                      placeholder="1-2; 3-4"
                      value={splitRanges}
                    />
                    <button
                      disabled={!allSourcesSafe || loading}
                      onClick={() => void onSplit()}
                      type="button"
                    >
                      Export parts
                    </button>
                  </section>
                  <section className="property-section">
                    <h3>Find text</h3>
                    <form onSubmit={(event) => void onSearch(event)}>
                      <label className="visually-hidden" htmlFor="pdf-search">
                        Search this PDF
                      </label>
                      <input
                        id="pdf-search"
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search this PDF"
                        type="search"
                        value={query}
                      />
                      <button disabled={searching} type="submit">
                        {searching ? 'Searching…' : 'Find'}
                      </button>
                    </form>
                    {searchResults.length > 0 && (
                      <ol className="search-results">
                        {searchResults.map((result, index) => (
                          <li key={`${result.sourceId}:${result.pageIndex}:${index}`}>
                            <button onClick={() => selectIndex(result.graphIndex)} type="button">
                              <strong>Page {result.graphIndex + 1}</strong>
                              <span>{result.excerpt}</span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                    {query.length > 0 && !searching && searchResults.length === 0 && (
                      <p className="search-empty">
                        No matching searchable text. For an image-only scan, choose Text → OCR this
                        page to add local search/copy text without changing its appearance.
                      </p>
                    )}
                  </section>
                  <section
                    className="property-section outline-panel"
                    aria-labelledby="document-outline-title"
                  >
                    <h3 id="document-outline-title">Document outline</h3>
                    {selectedSource?.outline === null ? (
                      <p>Outline bookmarks could not be read safely.</p>
                    ) : outlineNavigationEntries.length === 0 ? (
                      <p>This PDF has no outline bookmarks.</p>
                    ) : (
                      <ol className="outline-results">
                        {outlineNavigationEntries.map((entry) => (
                          <li
                            key={`${selectedSource?.sourceId}:${entry.id}`}
                            style={{ '--outline-depth': entry.depth } as CSSProperties}
                          >
                            <button
                              disabled={entry.graphIndex < 0}
                              onClick={() => selectIndex(entry.graphIndex)}
                              type="button"
                            >
                              <span>{entry.title}</span>
                              <small>
                                {entry.graphIndex < 0
                                  ? 'No page destination'
                                  : `Page ${entry.graphIndex + 1}`}
                              </small>
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                    {selectedSource?.outline?.truncated === true && (
                      <p className="outline-limit-note">
                        Showing the first safely bounded outline entries.
                      </p>
                    )}
                  </section>
                  <section
                    className="property-section structure-panel"
                    aria-labelledby="document-contents-title"
                  >
                    <h3 id="document-contents-title">Document contents</h3>
                    <div className="structure-panel__group">
                      <h4>Embedded attachments</h4>
                      <p className="structure-panel__disclosure">
                        Read-only metadata. PDFrig does not open or extract embedded files.
                      </p>
                      {selectedSource?.structure.attachments.length === 0 ? (
                        <p>No embedded attachments.</p>
                      ) : (
                        <ul className="structure-results">
                          {selectedSource?.structure.attachments.map((attachment) => (
                            <li key={`${selectedSource.sourceId}:${attachment.id}`}>
                              <strong>{attachment.name}</strong>
                              {attachment.description !== null && (
                                <span>{attachment.description}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {selectedSource?.structure.attachmentsTruncated === true && (
                        <p className="structure-panel__limit">
                          Showing the first 50 attachment records.
                        </p>
                      )}
                    </div>
                    <div className="structure-panel__group">
                      <h4>Layers</h4>
                      <p className="structure-panel__disclosure">
                        Visibility is reported from the source and cannot be changed here.
                      </p>
                      {selectedSource?.structure.layerConfigurationName && (
                        <p className="structure-panel__configuration">
                          <strong>Display configuration:</strong>{' '}
                          {selectedSource.structure.layerConfigurationName}
                        </p>
                      )}
                      {selectedSource?.structure.layers === null ? (
                        <p>Layer metadata could not be read safely.</p>
                      ) : selectedSource?.structure.layers.length === 0 ? (
                        <p>No optional-content layers.</p>
                      ) : (
                        <ul className="structure-results">
                          {selectedSource?.structure.layers?.map((layer) => (
                            <li
                              key={`${selectedSource.sourceId}:${layer.id}`}
                              style={{ '--layer-depth': layer.path.length } as CSSProperties}
                            >
                              <strong>{layer.name}</strong>
                              {layer.path.length > 0 && <span>{layer.path.join(' › ')}</span>}
                              <span>
                                {layer.visible ? 'Visible in source' : 'Hidden in source'}
                              </span>
                              {layer.mutuallyExclusive && (
                                <span>Mutually exclusive layer set in source</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {selectedSource?.structure.layersTruncated === true && (
                        <p className="structure-panel__limit">
                          Showing the first 100 layer records.
                        </p>
                      )}
                    </div>
                  </section>
                </>
              )}
            </aside>
          </div>

          <footer className="status-bar">
            <span>
              {pages.length} {pages.length === 1 ? 'page' : 'pages'}
            </span>
            <span>{Math.round(zoom * 100)}%</span>
            <span className="status-bar__processing">
              <span aria-hidden="true" className="status-dot status-dot--local" /> On this device
            </span>
            <span>
              {allSourcesSafe
                ? 'Original unchanged'
                : allSourcesAnnotatable
                  ? primarySource?.inspection.hasOutline
                    ? 'Original unchanged · page organizing locked'
                    : 'Forms protected · filling available'
                  : 'Editing locked'}
            </span>
          </footer>
        </>
      ) : (
        <section aria-live="polite" className="desktop-access-gate">
          <span aria-hidden="true" className="desktop-access-gate__mark">
            PM
          </span>
          <p className="eyebrow">Windows access</p>
          <h1>
            {desktopAccess === 'checking' ? 'Checking this device.' : 'Connect your account.'}
          </h1>
          <p>
            {desktopAccess === 'checking'
              ? 'PDFrig is verifying a signed desktop access snapshot. Your documents are not part of this check.'
              : 'Use Account in the top bar to verify desktop access. Eligible local work remains available during a valid signed offline window.'}
          </p>
          <small>Cloud processing always requires a fresh online authorization.</small>
        </section>
      )}
      {pendingPdfInsert !== null && (
        <PdfInsertReviewDialog
          afterPageNumber={pendingPdfInsert.afterPageNumber}
          incomingPageCount={pendingPdfInsert.source.document.pageCount}
          onCancel={() => void disposePendingPdfInsert()}
          onConfirm={confirmPdfInsert}
          restoreFocusTo={pendingPdfInsert.restoreFocusTo}
        />
      )}
      {showExportDialog && (
        <ExportDialog
          hasTags={primarySource?.inspection.isTagged === true}
          flattenForms={flattenForms}
          hasForms={hasForms}
          hasMeasurements={(snapshot?.state.measurements.length ?? 0) > 0}
          loading={loading || printLoading}
          onClose={() => setShowExportDialog(false)}
          onExport={() => void onExport()}
          onFlattenFormsChange={setFlattenForms}
          signatureDetection={signatureEditPolicy.signatureDetection}
        />
      )}
      {showPrintDialog && (
        <PrintDialog
          loading={loading}
          onClose={closePrintDialog}
          onOpenDialog={() => void openPrintDialog()}
          onOptionsChange={changePrintOptions}
          onPrepare={() => void preparePrint()}
          onPreviewError={reportPrintPreviewError}
          onPreviewReady={markPrintPageReady}
          options={printOptions}
          prepared={preparedPrint}
          readyPageCount={readyPrintPages.size}
          status={printStatus}
        />
      )}
      {showSignatureDialog && selectedPage !== undefined && (
        <SignatureDialog
          onClose={() => setShowSignatureDialog(false)}
          onError={setError}
          onPlace={placeAnnotation}
          pageId={selectedPage.id}
        />
      )}
      {pendingSignatureRepeat !== null &&
        pendingSignatureRepeat.version === version &&
        pendingSignatureRepeat.before === snapshot?.state &&
        allSourcesAnnotatable &&
        !loading &&
        redactionMarks.length === 0 && (
          <SignatureRepeatDialog
            before={pendingSignatureRepeat.before}
            signatureId={pendingSignatureRepeat.signatureId}
            onClose={closeSignatureRepeat}
            onPrepare={async (command) => {
              const client = workerRef.current;
              if (client === null || currentState() !== pendingSignatureRepeat.before)
                throw new Error('SIGNATURE_REPEAT_STALE');
              const proposed = command.apply(pendingSignatureRepeat.before);
              const output = await client.exportEdited({
                annotations: proposed.annotations,
                formValues: proposed.formValues,
                options: { flattenForms: false },
                pages: proposed.pageGraph.pages.map(
                  ({ id: pageId, rotation, sourceId, sourcePageIndex }) => ({
                    pageId,
                    rotation,
                    sourceId,
                    sourcePageIndex,
                  }),
                ),
                sources: assemblySources(),
              });
              return openBrowserPdf(output, { strictParsing: true });
            }}
            onApply={(command) => {
              if (
                currentState() !== pendingSignatureRepeat.before ||
                !signatureEditPolicy.canAnnotate
              )
                throw new Error('SIGNATURE_REPEAT_STALE');
              execute(command);
            }}
          />
        )}
      {showStampDialog && selectedPage !== undefined && stampsEnabled && (
        <StampDialog
          onClose={() => setShowStampDialog(false)}
          onError={setError}
          onPlace={placeAnnotation}
          pageId={selectedPage.id}
        />
      )}
      {showRedactionDialog && (
        <RedactionDialog
          loading={loading}
          markCount={redactionMarks.length}
          onApply={() => void onApplyRedactions()}
          onClose={() => setShowRedactionDialog(false)}
        />
      )}
      {sourceTextMode !== null && selectedSource !== undefined && selectedPage !== undefined && (
        <SourceTextDialog
          key={`${selectedSource.sourceId}:${selectedPage.sourcePageIndex}:${sourceTextMode}`}
          bytes={selectedSource.bytes}
          document={selectedSource.document}
          pageIndex={selectedPage.sourcePageIndex}
          mode={sourceTextMode}
          initialSelection={sourceTextInitialSelection}
          onClose={() => setSourceTextMode(null)}
          onApply={async (bytes, signal) => {
            const before = currentState();
            const previousId = selectedSource.sourceId;
            if (
              !allSourcesAnnotatable ||
              signal.aborted ||
              sourcesRef.current.size >= 8 ||
              !before.pageGraph.pages.some((page) => page.sourceId === previousId)
            )
              throw new Error('SOURCE_REVISION_STALE');
            const nextId = crypto.randomUUID();
            const source = await prepareSource(bytes, nextId);
            // AbortSignal may change while PDF.js prepares the candidate revision.
            const cancelled = () => signal.aborted;
            if (cancelled() || currentState() !== before || !source.inspection.canAnnotateSafely) {
              await source.document.destroy();
              throw new Error('SOURCE_REVISION_STALE');
            }
            sourcesRef.current.set(nextId, source);
            setSources(new Map(sourcesRef.current));
            const after: EditorDocumentState = {
              ...before,
              pageGraph: {
                pages: before.pageGraph.pages.map((page) =>
                  page.sourceId === previousId ? { ...page, sourceId: nextId } : page,
                ),
              },
              formValues: before.formValues.map((value) =>
                value.sourceId === previousId ? { ...value, sourceId: nextId } : value,
              ),
            };
            execute({
              id: `source-revision:${nextId}`,
              version: 1,
              apply: () => after,
              revert: () => before,
            });
            setSearchResults([]);
          }}
        />
      )}
    </main>
  );
};
