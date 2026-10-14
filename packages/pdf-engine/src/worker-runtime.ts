import { assemblePdf, imageToPdf } from './assembly.js';
import { decoratePdf } from './decorations.js';
import { exportEditedPdfResult } from './editing.js';
import { inspectPdfGeometry, modifyPdfGeometry } from './geometry.js';
import { numberPdf } from './numbering.js';
import { applyRasterRedactions } from './redaction.js';
import { textToPdf } from './text-pdf.js';
import { setPdfPermissions } from './permissions.js';
import {
  compressPdfLosslessly,
  createBlankPdf,
  imagesToPdf,
  protectPdf,
  readPdfMetadata,
  removePdfMetadata,
  unlockPdf,
  updatePdfMetadata,
} from './utilities.js';
import {
  parsePdfWorkerRequest,
  type PdfWorkerRequest,
  type PdfWorkerResponse,
  type PdfWorkerSuccessPayload,
} from './worker.js';

export const startPdfWorker = (): void => {
  globalThis.addEventListener('message', (event: MessageEvent<unknown>) => {
    let request: PdfWorkerRequest;
    try {
      request = parsePdfWorkerRequest(event.data);
    } catch (error: unknown) {
      const response: PdfWorkerResponse = {
        id: 'invalid',
        message: error instanceof Error ? error.message : 'The local PDF request is invalid.',
        ok: false,
      };
      globalThis.postMessage(response);
      return;
    }
    const work: Promise<PdfWorkerSuccessPayload> = (() => {
      if (request.kind === 'text-to-pdf')
        return textToPdf(request.bytes, request.options).then((bytes) => ({
          kind: 'bytes',
          bytes,
        }));
      if (request.kind === 'blank-pdf')
        return createBlankPdf(request.options).then((bytes) => ({ kind: 'bytes', bytes }));
      if (request.kind === 'assemble')
        return assemblePdf(request.sources, request.pages).then((bytes) => ({
          kind: 'bytes',
          bytes,
        }));
      if (request.kind === 'export-edited')
        return exportEditedPdfResult(request).then(({ bytes, warnings }) => ({
          kind: 'bytes',
          bytes,
          warnings,
        }));
      if (request.kind === 'decorate')
        return decoratePdf(request.bytes, request.options).then((bytes) => ({
          kind: 'bytes',
          bytes,
        }));
      if (request.kind === 'geometry-inspect')
        return inspectPdfGeometry(request.bytes).then((inspection) => ({
          inspection,
          kind: 'geometry-inspection',
        }));
      if (request.kind === 'geometry-modify')
        return modifyPdfGeometry(request.bytes, request.options).then(({ bytes, report }) => ({
          bytes,
          kind: 'geometry-result',
          report,
        }));
      if (request.kind === 'number')
        return numberPdf(request.bytes, request.options).then(({ bytes, report }) => ({
          bytes,
          kind: 'numbering',
          report,
        }));
      if (request.kind === 'image-to-pdf')
        return imageToPdf(request.bytes, request.mimeType).then((bytes) => ({
          kind: 'bytes',
          bytes,
        }));
      if (request.kind === 'images-to-pdf')
        return imagesToPdf(request.sources, request.options).then((bytes) => ({
          kind: 'bytes',
          bytes,
        }));
      if (request.kind === 'compress')
        return compressPdfLosslessly(request.bytes, request.preset).then(({ bytes, report }) => ({
          bytes,
          kind: 'compression',
          report,
        }));
      if (request.kind === 'permissions')
        return setPdfPermissions(
          request.bytes,
          request.options,
          request.ownerPassword,
          request.openPassword,
          request.authorized,
        ).then((bytes) => ({ kind: 'bytes', bytes }));
      if (request.kind === 'protect')
        return protectPdf(request.bytes, request.password).then((bytes) => ({
          kind: 'bytes',
          bytes,
        }));
      if (request.kind === 'unlock')
        return unlockPdf(request.bytes, request.password, request.authorized).then((bytes) => ({
          kind: 'bytes',
          bytes,
        }));
      if (request.kind === 'metadata-read')
        return readPdfMetadata(request.bytes).then((metadata) => ({ kind: 'metadata', metadata }));
      if (request.kind === 'metadata-update')
        return updatePdfMetadata(request.bytes, request.patch).then((bytes) => ({
          kind: 'bytes',
          bytes,
        }));
      if (request.kind === 'redact-raster')
        return request.confirmPermanentRemoval && request.confirmRasterization
          ? applyRasterRedactions({
              bytes: request.bytes,
              confirmPermanentRemoval: true,
              confirmRasterization: true,
              marks: request.marks,
            }).then((result) => ({ kind: 'redaction', result }))
          : Promise.reject(new Error('REDACTION_CONFIRMATION_REQUIRED'));
      return removePdfMetadata(request.bytes).then((bytes) => ({ kind: 'bytes', bytes }));
    })();
    void work
      .then((payload) => {
        const response: PdfWorkerResponse = { id: request.id, ok: true, payload };
        if (payload.kind === 'geometry-inspection' || payload.kind === 'metadata')
          globalThis.postMessage(response);
        else if (payload.kind === 'redaction')
          globalThis.postMessage(response, { transfer: [payload.result.bytes.buffer] });
        else globalThis.postMessage(response, { transfer: [payload.bytes.buffer] });
      })
      .catch((error: unknown) => {
        const response: PdfWorkerResponse = {
          id: request.id,
          message:
            error instanceof Error &&
            /^(?:DECORATION|EDIT|GEOMETRY|NUMBERING|REDACTION|UTILITY)_[A-Z_]+$/u.test(
              error.message,
            )
              ? error.message
              : 'Local PDF processing stopped safely. Your original was not changed.',
          ok: false,
        };
        globalThis.postMessage(response);
      });
  });
};
