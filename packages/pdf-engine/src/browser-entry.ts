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
export { inspectPdfRevisionStructure } from './incremental-revisions.js';
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
export * from './redaction.js';
export * from './pdf-image-options.js';
export type { SupportedImageMimeType } from './image-normalization.js';
export * from './utilities.js';
export * from './text-pdf.js';
export * from './text-overlay-layout.js';
export * from './signature-font.js';
export * from './permissions.js';
export * from './worker.js';
export * from './zip.js';
export type { AssemblyPage, AssemblySource } from './assembly.js';
export type { EditedPagePlan, EditedPdfOptions, EditedPdfRequest } from './editing.js';
export type { PdfModificationRisk } from './modification-risks.js';
