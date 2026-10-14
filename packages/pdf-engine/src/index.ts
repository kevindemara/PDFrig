import type { FailureCategory, JsonValue, PdfOperationContract } from '@pdfmason/contracts';

export * from './assembly.js';
export * from './browser-document.js';
export * from './decoration-placement.js';
export * from './decoration-text-areas.js';
export { decoratePdf } from './decorations.js';
export {
  isPdfDecorationOptions,
  parseDecorationPageRange,
  resolveDecorationPages,
} from './decoration-options.js';
export type {
  DecorationAlignment,
  DecorationPageSelection,
  PdfDecorationOptions,
  RepeatingTextDecoration,
  WatermarkDecoration,
} from './decorations.js';
export { inspectPdfGeometry, isPdfGeometryOptions, modifyPdfGeometry } from './geometry.js';
export type {
  PdfCropOptions,
  PdfGeometryInspection,
  PdfGeometryOptions,
  PdfGeometryReport,
  PdfGeometryResult,
  PdfPageGeometry,
  PdfRectangle,
  PdfResizeOptions,
} from './geometry.js';
export {
  formatNumberingIdentifier,
  formatPageLabel,
  numberPdf,
  previewNumbering,
} from './numbering.js';
export type {
  BatesNumberingOptions,
  NumberingPosition,
  PageLabelNumberingOptions,
  PageLabelStyle,
  PdfNumberingOptions,
  PdfNumberingReport,
  PdfNumberingResult,
} from './numbering.js';
export * from './editing.js';
export * from './image-normalization.js';
export * from './modification-risks.js';
export * from './pdf-image-options.js';
export * from './redaction.js';
export * from './utilities.js';
export * from './text-pdf.js';
export * from './permissions.js';
export * from './worker.js';
export * from './worker-runtime.js';
export * from './zip.js';

export interface PdfSource {
  readonly byteLength: number;
  readonly contentHash: string;
  readonly sourceId: string;
}

export interface OperationRequest {
  readonly operation: string;
  readonly options: JsonValue;
  readonly sources: readonly PdfSource[];
  readonly version: string;
}

export interface OperationWarning {
  readonly code: string;
  readonly message: string;
}

export type OperationResult =
  | {
      readonly category: FailureCategory;
      readonly message: string;
      readonly ok: false;
      readonly retryable: boolean;
    }
  | {
      readonly mimeType: string;
      readonly ok: true;
      readonly outputId: string;
      readonly warnings: readonly OperationWarning[];
    };

export interface PdfEngine {
  execute(request: OperationRequest, signal: AbortSignal): Promise<OperationResult>;
  listCapabilities(): readonly PdfOperationContract[];
}

/** Explicitly unavailable adapter for surfaces where no reviewed engine is configured. */
export class UnavailablePdfEngine implements PdfEngine {
  public execute(request: OperationRequest, signal: AbortSignal): Promise<OperationResult> {
    void request;
    void signal;
    return Promise.resolve({
      category: 'capability_unavailable',
      message: 'No PDF operation adapter is configured for this surface.',
      ok: false,
      retryable: false,
    });
  }

  public listCapabilities(): readonly PdfOperationContract[] {
    return [];
  }
}
