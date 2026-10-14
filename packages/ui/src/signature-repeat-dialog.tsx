import {
  repeatVisualSignatureCommand,
  signatureRepeatPageIndices,
  type EditorCommand,
  type EditorDocumentState,
} from '@pdfmason/editor-core';
import type { BrowserPdfDocument } from '@pdfmason/pdf-engine/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialogFocus } from './dialog-focus.js';

export type SignatureRepeatPreviewDocument = Pick<
  BrowserPdfDocument,
  'destroy' | 'getPageMetrics' | 'pageCount' | 'renderPage'
>;
type Command = EditorCommand<EditorDocumentState>;
const disposePreview = (document: SignatureRepeatPreviewDocument | null): void => {
  void document?.destroy().catch(() => undefined);
};
interface Props {
  readonly before: EditorDocumentState;
  readonly signatureId: string;
  readonly onClose: () => void;
  readonly onPrepare: (command: Command) => Promise<SignatureRepeatPreviewDocument>;
  readonly onApply: (command: Command) => void;
}

const PreviewPage = ({
  document,
  index,
  onReady,
  onError,
}: {
  readonly document: SignatureRepeatPreviewDocument;
  readonly index: number;
  readonly onReady: (index: number) => void;
  readonly onError: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const lifecycle = { active: true };
    const isCurrent = (): boolean => lifecycle.active;
    void (async () => {
      const { width, height } = await document.getPageMetrics(index);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
        throw new Error('PREVIEW_INVALID');
      if (!isCurrent()) return;
      await document.renderPage(canvas, index, Math.min(1, 560 / width, 640 / height), 0, 1);
      if (isCurrent()) onReady(index);
    })().catch(() => {
      if (isCurrent()) onError();
    });
    return () => {
      lifecycle.active = false;
      canvas.width = 1;
      canvas.height = 1;
    };
  }, [document, index, onError, onReady]);
  return (
    <canvas ref={canvasRef} aria-label={`Proposed signature placement on page ${index + 1}`} />
  );
};

/** SIGN-003: sequential review of actual proposed output, with no save/upload. */
export const SignatureRepeatDialog = ({
  before,
  signatureId,
  onClose,
  onPrepare,
  onApply,
}: Props) => {
  const { closeRef, dialogRef } = useDialogFocus(onClose);
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{
    command: Command;
    document: SignatureRepeatPreviewDocument;
    indices: readonly number[];
  } | null>(null);
  const [position, setPosition] = useState(0);
  const [readyIndex, setReadyIndex] = useState<number | null>(null);
  const [reviewed, setReviewed] = useState<ReadonlySet<number>>(() => new Set());
  const generation = useRef(0);
  const documentRef = useRef<SignatureRepeatPreviewDocument | null>(null);
  useEffect(
    () => () => {
      generation.current += 1;
      disposePreview(documentRef.current);
      documentRef.current = null;
    },
    [],
  );
  const onReady = useCallback((index: number) => setReadyIndex(index), []);
  const onRenderError = useCallback(() => {
    setReadyIndex(null);
    setError('This placement could not be rendered. Cancel and try again. No copies were added.');
  }, []);
  const reset = (): void => {
    generation.current += 1;
    disposePreview(documentRef.current);
    documentRef.current = null;
    setPrepared(null);
    setReviewed(new Set());
    setReadyIndex(null);
    setPosition(0);
    setError(null);
  };
  const prepare = async (): Promise<void> => {
    reset();
    const request = generation.current;
    setBusy(true);
    let document: SignatureRepeatPreviewDocument | null = null;
    try {
      const indices = signatureRepeatPageIndices(range, before.pageGraph.pages.length);
      const pageIds = indices.map((index) => {
        const page = before.pageGraph.pages[index];
        if (page === undefined) throw new Error('SIGNATURE_REPEAT_INVALID');
        return page.id;
      });
      const command = repeatVisualSignatureCommand(before, signatureId, pageIds, () =>
        crypto.randomUUID(),
      );
      document = await onPrepare(command);
      if (request !== generation.current) return;
      if (document.pageCount !== before.pageGraph.pages.length) throw new Error('PREVIEW_INVALID');
      documentRef.current = document;
      setPrepared({ command, document, indices });
      document = null;
    } catch {
      if (request === generation.current)
        setError(
          'Choose up to 20 different destination pages without existing visual signatures. If valid pages fail, cancel and try again. No copies were added.',
        );
    } finally {
      disposePreview(document);
      if (request === generation.current) setBusy(false);
    }
  };
  const index = prepared?.indices[position];
  const allReviewed = prepared?.indices.every((page) => reviewed.has(page)) ?? false;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="editor-dialog signature-repeat-dialog"
        aria-labelledby="signature-repeat-title"
        aria-modal="true"
        role="dialog"
        ref={dialogRef}
      >
        <div className="dialog-heading">
          <div>
            <span className="panel-kicker">Fill & sign</span>
            <h2 id="signature-repeat-title">Review signature copies</h2>
          </div>
          <button
            aria-label="Cancel signature copies"
            type="button"
            onClick={onClose}
            ref={closeRef}
          >
            Cancel
          </button>
        </div>
        <p className="dialog-disclosure">
          Runs on this device. Reuse only your selected visual mark in this document. Nothing is
          saved for future documents or uploaded. This is not a certificate-backed signature and
          does not verify identity.
        </p>
        <p>
          Copies keep the same relative position and size. Review every destination for overlapping
          content. Preview includes current edits and flattened visual marks; form fields remain
          interactive. Cancel to adjust the original mark. One Undo removes all new copies.
        </p>
        <label className="field-stack">
          Destination pages (for example 2-4, 6)
          <input
            autoComplete="off"
            disabled={busy}
            maxLength={256}
            value={range}
            onChange={(event) => {
              reset();
              setRange(event.target.value);
            }}
          />
        </label>
        <button disabled={busy || range.length === 0} type="button" onClick={() => void prepare()}>
          Build placement preview
        </button>
        {busy && <p role="status">Building the proposed PDF on this device…</p>}
        {error !== null && <p role="alert">{error}</p>}
        {prepared !== null && index !== undefined && (
          <>
            <p role="status">
              {reviewed.size} of {prepared.indices.length} destinations reviewed. Page {index + 1}.
            </p>
            <div className="signature-repeat-preview" aria-busy={readyIndex !== index}>
              <PreviewPage
                key={index}
                document={prepared.document}
                index={index}
                onReady={onReady}
                onError={onRenderError}
              />
            </div>
            {readyIndex !== index && error === null && (
              <p role="status">Rendering this placement…</p>
            )}
            <label className="signature-repeat-acknowledgement">
              <input
                type="checkbox"
                disabled={readyIndex !== index || error !== null}
                checked={reviewed.has(index)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setReviewed((current) => {
                    const next = new Set(current);
                    if (checked) next.add(index);
                    else next.delete(index);
                    return next;
                  });
                }}
              />{' '}
              I reviewed the placement on page {index + 1}
            </label>
            <div className="dialog-actions">
              <button
                disabled={position === 0}
                type="button"
                onClick={() => {
                  setReadyIndex(null);
                  setPosition(position - 1);
                }}
              >
                Previous destination
              </button>
              <button
                disabled={position >= prepared.indices.length - 1}
                type="button"
                onClick={() => {
                  setReadyIndex(null);
                  setPosition(position + 1);
                }}
              >
                Next destination
              </button>
            </div>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Keep current signatures
          </button>
          <button
            className="button button--primary"
            disabled={!allReviewed || busy || error !== null || readyIndex !== index}
            type="button"
            onClick={() => {
              if (prepared === null) return;
              try {
                onApply(prepared.command);
                onClose();
              } catch {
                setError('The document changed. Cancel and review again. No copies were added.');
              }
            }}
          >
            Apply reviewed signature copies
          </button>
        </div>
      </section>
    </div>
  );
};
