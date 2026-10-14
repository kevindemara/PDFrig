import type {
  EditorAnnotation,
  FormValue,
  NormalizedPoint,
  NormalizedRect,
} from '@pdfmason/editor-core';

import type { AssemblyPage, AssemblySource } from './assembly.js';
import { LOCAL_PDF_LIMITS } from './browser-document.js';
import { isPdfDecorationOptions, type PdfDecorationOptions } from './decoration-options.js';
import type {
  EditedPagePlan,
  EditedPdfOptions,
  EditedPdfRequest,
  EditedPdfWarningCode,
} from './editing.js';
import { isPdfGeometryOptions } from './geometry.js';
import type {
  PdfGeometryInspection,
  PdfGeometryOptions,
  PdfGeometryReport,
  PdfGeometryResult,
} from './geometry.js';
import type { PdfNumberingOptions, PdfNumberingReport, PdfNumberingResult } from './numbering.js';
import type {
  BlankPdfOptions,
  CompressionPreset,
  CompressionReport,
  ImagePdfSource,
  ImagesToPdfOptions,
  PdfMetadata,
  PdfMetadataPatch,
} from './utilities.js';
import { isBlankPdfOptions, LOCAL_UTILITY_LIMITS } from './utilities.js';
import type { SupportedImageMimeType } from './image-normalization.js';
import type { RasterRedactionResult, RedactionMark } from './redaction.js';
import { LOCAL_REDACTION_LIMITS } from './redaction.js';
import { isTextPdfBytes, isTextPdfOptions, type TextPdfOptions } from './text-pdf.js';
import {
  isPdfPermissionOptions,
  isPermissionPassword,
  type PdfPermissionOptions,
} from './permissions.js';

export type PdfWorkerRequest =
  | {
      readonly id: string;
      readonly kind: 'permissions';
      readonly bytes: Uint8Array;
      readonly options: PdfPermissionOptions;
      readonly ownerPassword: string;
      readonly openPassword: string;
      readonly authorized: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'text-to-pdf';
      readonly bytes: Uint8Array;
      readonly options: TextPdfOptions;
    }
  | {
      readonly id: string;
      readonly kind: 'assemble';
      readonly pages: readonly AssemblyPage[];
      readonly sources: readonly AssemblySource[];
    }
  | {
      readonly id: string;
      readonly kind: 'blank-pdf';
      readonly options: BlankPdfOptions;
    }
  | ({
      readonly id: string;
      readonly kind: 'export-edited';
    } & EditedPdfRequest)
  | {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'decorate';
      readonly options: PdfDecorationOptions;
    }
  | {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'geometry-inspect';
    }
  | {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'geometry-modify';
      readonly options: PdfGeometryOptions;
    }
  | {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'number';
      readonly options: PdfNumberingOptions;
    }
  | {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'image-to-pdf';
      readonly mimeType: SupportedImageMimeType;
    }
  | {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'compress';
      readonly preset: CompressionPreset;
    }
  | {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'protect';
      readonly password: string;
    }
  | {
      readonly authorized: boolean;
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'unlock';
      readonly password: string;
    }
  | {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'metadata-read';
    }
  | {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'metadata-update';
      readonly patch: PdfMetadataPatch;
    }
  | {
      readonly bytes: Uint8Array;
      readonly id: string;
      readonly kind: 'metadata-remove';
    }
  | {
      readonly id: string;
      readonly kind: 'images-to-pdf';
      readonly options: ImagesToPdfOptions;
      readonly sources: readonly ImagePdfSource[];
    }
  | {
      readonly bytes: Uint8Array;
      readonly confirmPermanentRemoval: boolean;
      readonly confirmRasterization: boolean;
      readonly id: string;
      readonly kind: 'redact-raster';
      readonly marks: readonly RedactionMark[];
    };

export type PdfWorkerSuccessPayload =
  | {
      readonly bytes: Uint8Array;
      readonly kind: 'bytes';
      readonly warnings?: readonly EditedPdfWarningCode[];
    }
  | {
      readonly bytes: Uint8Array;
      readonly kind: 'compression';
      readonly report: CompressionReport;
    }
  | { readonly kind: 'metadata'; readonly metadata: PdfMetadata }
  | {
      readonly bytes: Uint8Array;
      readonly kind: 'geometry-result';
      readonly report: PdfGeometryReport;
    }
  | { readonly inspection: PdfGeometryInspection; readonly kind: 'geometry-inspection' }
  | {
      readonly bytes: Uint8Array;
      readonly kind: 'numbering';
      readonly report: PdfNumberingReport;
    }
  | { readonly kind: 'redaction'; readonly result: RasterRedactionResult };

export type PdfWorkerResponse =
  | { readonly id: string; readonly ok: true; readonly payload: PdfWorkerSuccessPayload }
  | { readonly id: string; readonly message: string; readonly ok: false };

export interface PdfWorkerClient {
  setPermissions(
    bytes: Uint8Array,
    options: PdfPermissionOptions,
    ownerPassword: string,
    openPassword: string,
    authorized: boolean,
  ): Promise<Uint8Array>;
  textToPdf(bytes: Uint8Array, options: TextPdfOptions): Promise<Uint8Array>;
  assemble(sources: readonly AssemblySource[], pages: readonly AssemblyPage[]): Promise<Uint8Array>;
  createBlankPdf(options: BlankPdfOptions): Promise<Uint8Array>;
  compress(
    bytes: Uint8Array,
    preset: CompressionPreset,
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly report: CompressionReport;
  }>;
  decorate(bytes: Uint8Array, options: PdfDecorationOptions): Promise<Uint8Array>;
  exportEdited(request: EditedPdfRequest): Promise<Uint8Array>;
  imageToPdf(bytes: Uint8Array, mimeType: SupportedImageMimeType): Promise<Uint8Array>;
  imagesToPdf(sources: readonly ImagePdfSource[], options: ImagesToPdfOptions): Promise<Uint8Array>;
  inspectGeometry(bytes: Uint8Array): Promise<PdfGeometryInspection>;
  modifyGeometry(bytes: Uint8Array, options: PdfGeometryOptions): Promise<PdfGeometryResult>;
  number(bytes: Uint8Array, options: PdfNumberingOptions): Promise<PdfNumberingResult>;
  readMetadata(bytes: Uint8Array): Promise<PdfMetadata>;
  removeMetadata(bytes: Uint8Array): Promise<Uint8Array>;
  protect(bytes: Uint8Array, password: string): Promise<Uint8Array>;
  redactRaster(
    bytes: Uint8Array,
    marks: readonly RedactionMark[],
    confirmations: {
      readonly permanentRemoval: boolean;
      readonly rasterization: boolean;
    },
  ): Promise<RasterRedactionResult>;
  terminate(): void;
  unlock(bytes: Uint8Array, password: string, authorized: boolean): Promise<Uint8Array>;
  updateMetadata(bytes: Uint8Array, patch: PdfMetadataPatch): Promise<Uint8Array>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isAssemblyPage = (value: unknown): value is AssemblyPage => {
  if (!isRecord(value)) return false;
  return (
    typeof value.sourceId === 'string' &&
    Number.isInteger(value.sourcePageIndex) &&
    typeof value.sourcePageIndex === 'number' &&
    value.sourcePageIndex >= 0 &&
    (value.rotation === 0 ||
      value.rotation === 90 ||
      value.rotation === 180 ||
      value.rotation === 270)
  );
};

const isBoundedString = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum;

const isUnit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isPoint = (value: unknown): value is NormalizedPoint =>
  isRecord(value) && isUnit(value.x) && isUnit(value.y);

const isRect = (value: unknown): value is NormalizedRect =>
  isRecord(value) &&
  isUnit(value.x) &&
  isUnit(value.y) &&
  isUnit(value.width) &&
  isUnit(value.height) &&
  value.width > 0 &&
  value.height > 0 &&
  value.x + value.width <= 1.000_001 &&
  value.y + value.height <= 1.000_001;

const isColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);

const hasAnnotationBase = (value: Record<string, unknown>): boolean =>
  isBoundedString(value.id, 100) && isBoundedString(value.pageId, 100) && isRect(value.rect);

const isPoints = (value: unknown, maximum = 2_000): value is readonly NormalizedPoint[] =>
  Array.isArray(value) && value.length >= 2 && value.length <= maximum && value.every(isPoint);

const isAnnotation = (value: unknown): value is EditorAnnotation => {
  if (!isRecord(value) || !hasAnnotationBase(value)) return false;
  if (value.kind === 'text') {
    return (
      isBoundedString(value.text, 2_000) &&
      typeof value.fontSize === 'number' &&
      value.fontSize >= 6 &&
      value.fontSize <= 96 &&
      isColor(value.color) &&
      (value.alignment === 'left' || value.alignment === 'center' || value.alignment === 'right') &&
      (value.variant === 'plain' || value.variant === 'box' || value.variant === 'callout')
    );
  }
  if (value.kind === 'markup') {
    return (
      (value.style === 'highlight' || value.style === 'underline' || value.style === 'strikeout') &&
      isColor(value.color) &&
      typeof value.opacity === 'number' &&
      value.opacity >= 0.1 &&
      value.opacity <= 1
    );
  }
  if (value.kind === 'ink') {
    return (
      isPoints(value.points) &&
      isColor(value.color) &&
      typeof value.strokeWidth === 'number' &&
      value.strokeWidth >= 0.5 &&
      value.strokeWidth <= 20
    );
  }
  if (value.kind === 'shape') {
    return (
      (value.shape === 'rectangle' ||
        value.shape === 'ellipse' ||
        value.shape === 'line' ||
        value.shape === 'arrow') &&
      isColor(value.strokeColor) &&
      (value.fillColor === null || isColor(value.fillColor)) &&
      typeof value.strokeWidth === 'number' &&
      value.strokeWidth >= 0.5 &&
      value.strokeWidth <= 20 &&
      (value.from === undefined || isPoint(value.from)) &&
      (value.to === undefined || isPoint(value.to))
    );
  }
  if (value.kind === 'comment') {
    return (
      isBoundedString(value.text, 2_000) &&
      isBoundedString(value.author, 100) &&
      isBoundedString(value.createdAt, 40) &&
      (value.status === 'open' || value.status === 'resolved') &&
      isColor(value.color)
    );
  }
  if (value.kind === 'stamp') {
    return (
      isBoundedString(value.text, 40) &&
      value.text.length >= 1 &&
      /^[\x20-\x7e]+$/u.test(value.text) &&
      (value.source === 'built-in' || value.source === 'custom') &&
      isColor(value.color)
    );
  }
  if (value.kind === 'utility-mark') {
    return (
      (value.mark === 'checkmark' || value.mark === 'date') &&
      isBoundedString(value.text, 100) &&
      isColor(value.color)
    );
  }
  if (
    value.kind !== 'visual-signature' ||
    (value.label !== 'signature' && value.label !== 'initials')
  )
    return false;
  if (!isRecord(value.appearance)) return false;
  if (value.appearance.kind === 'typed') {
    return isBoundedString(value.appearance.text, 200) && isColor(value.appearance.color);
  }
  if (value.appearance.kind === 'drawn') {
    return isPoints(value.appearance.points) && isColor(value.appearance.color);
  }
  return (
    value.appearance.kind === 'image' &&
    value.appearance.bytes instanceof Uint8Array &&
    value.appearance.bytes.byteLength > 0 &&
    value.appearance.bytes.byteLength <= 5 * 1024 * 1024 &&
    (value.appearance.mimeType === 'image/png' || value.appearance.mimeType === 'image/jpeg')
  );
};

const isFormValue = (value: unknown): value is FormValue =>
  isRecord(value) &&
  isBoundedString(value.fieldName, 500) &&
  isBoundedString(value.sourceId, 100) &&
  ((value.type === 'checkbox' && typeof value.value === 'boolean') ||
    ((value.type === 'text' || value.type === 'radio' || value.type === 'dropdown') &&
      isBoundedString(value.value, 5_000)));

const isEditedPage = (value: unknown): value is EditedPagePlan =>
  isAssemblyPage(value) && isRecord(value) && isBoundedString(value.pageId, 100);

const isEditedOptions = (value: unknown): value is EditedPdfOptions =>
  isRecord(value) && typeof value.flattenForms === 'boolean';

const isAssemblySource = (value: unknown): value is AssemblySource =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  isBoundedString(value.sourceId, 100) &&
  value.sourceId.length > 0 &&
  isPdfBytes(value.bytes);

const isPdfBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array &&
  value.byteLength > 0 &&
  value.byteLength <= LOCAL_PDF_LIMITS.maximumBytes;

const isPassword = (value: unknown): value is string =>
  typeof value === 'string' && new TextEncoder().encode(value).byteLength <= 127;

const isMetadataPatch = (value: unknown): value is PdfMetadataPatch => {
  if (!isRecord(value)) return false;
  const allowed = new Set(['author', 'creator', 'keywords', 'producer', 'subject', 'title']);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    Object.values(value).every((field) => typeof field === 'string' && field.length <= 2_000)
  );
};

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const isNumberingBase = (value: Record<string, unknown>): boolean =>
  (value.alignment === 'center' || value.alignment === 'left' || value.alignment === 'right') &&
  isColor(value.color) &&
  (value.endPage === null || isIntegerInRange(value.endPage, 1, 500)) &&
  isIntegerInRange(value.fontSize, 6, 24) &&
  isIntegerInRange(value.marginPoints, 12, 72) &&
  (value.position === 'footer' || value.position === 'header') &&
  isIntegerInRange(value.startPage, 1, 500);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const isNumberingOptions = (value: unknown): value is PdfNumberingOptions => {
  if (!isRecord(value) || !isNumberingBase(value)) return false;
  if (value.kind === 'page-labels') {
    return (
      hasOnlyKeys(value, [
        'alignment',
        'color',
        'endPage',
        'fontSize',
        'kind',
        'marginPoints',
        'position',
        'prefix',
        'replaceExistingLabels',
        'startNumber',
        'startPage',
        'style',
      ]) &&
      typeof value.prefix === 'string' &&
      value.prefix.length <= 40 &&
      typeof value.replaceExistingLabels === 'boolean' &&
      isIntegerInRange(value.startNumber, 1, 999_999_999) &&
      (value.style === 'decimal' ||
        value.style === 'letters-lower' ||
        value.style === 'letters-upper' ||
        value.style === 'roman-lower' ||
        value.style === 'roman-upper')
    );
  }
  return (
    value.kind === 'bates' &&
    hasOnlyKeys(value, [
      'alignment',
      'color',
      'digits',
      'endPage',
      'fontSize',
      'kind',
      'marginPoints',
      'position',
      'prefix',
      'startNumber',
      'startPage',
      'suffix',
    ]) &&
    isIntegerInRange(value.digits, 3, 12) &&
    typeof value.prefix === 'string' &&
    value.prefix.length <= 40 &&
    isIntegerInRange(value.startNumber, 1, 999_999_999) &&
    typeof value.suffix === 'string' &&
    value.suffix.length <= 40
  );
};

const isImageSource = (value: unknown): value is ImagePdfSource =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  isPdfBytes(value.bytes) &&
  (value.mimeType === 'image/jpeg' ||
    value.mimeType === 'image/png' ||
    value.mimeType === 'image/webp');

const isRedactionMark = (value: unknown): value is RedactionMark =>
  isRecord(value) &&
  typeof value.pageIndex === 'number' &&
  Number.isInteger(value.pageIndex) &&
  value.pageIndex >= 0 &&
  isRect(value.rect);

export const parsePdfWorkerRequest = (value: unknown): PdfWorkerRequest => {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length > 100) {
    throw new Error('The local PDF request is invalid.');
  }
  if (value.kind === 'assemble') {
    if (
      !Array.isArray(value.pages) ||
      value.pages.length < 1 ||
      value.pages.length > LOCAL_PDF_LIMITS.maximumPages ||
      !value.pages.every(isAssemblyPage) ||
      !Array.isArray(value.sources) ||
      value.sources.length < 1 ||
      value.sources.length > LOCAL_PDF_LIMITS.maximumSources ||
      !value.sources.every(isAssemblySource)
    ) {
      throw new Error('The local PDF assembly request exceeds its safe limits.');
    }
    const pages = value.pages;
    const sources = value.sources;
    const sourceIds = new Set(sources.map(({ sourceId }) => sourceId));
    if (
      sources.reduce((total, source) => total + source.bytes.byteLength, 0) >
        LOCAL_PDF_LIMITS.maximumAssemblyBytes ||
      sourceIds.size !== sources.length ||
      !pages.every(({ sourceId }) => sourceIds.has(sourceId))
    ) {
      throw new Error('The local PDF assembly request exceeds its safe limits.');
    }
    return { id: value.id, kind: 'assemble', pages, sources };
  }
  if (value.kind === 'blank-pdf' && isBlankPdfOptions(value.options)) {
    return { id: value.id, kind: value.kind, options: value.options };
  }
  if (
    value.kind === 'text-to-pdf' &&
    Object.keys(value).length === 4 &&
    ['id', 'kind', 'bytes', 'options'].every((key) => Object.hasOwn(value, key)) &&
    isTextPdfBytes(value.bytes) &&
    isTextPdfOptions(value.options)
  ) {
    return {
      id: value.id,
      kind: value.kind,
      bytes: value.bytes,
      options: { pageSize: value.options.pageSize },
    };
  }
  if (value.kind === 'export-edited') {
    if (
      !Array.isArray(value.pages) ||
      value.pages.length < 1 ||
      value.pages.length > LOCAL_PDF_LIMITS.maximumPages ||
      !value.pages.every(isEditedPage) ||
      !Array.isArray(value.sources) ||
      value.sources.length < 1 ||
      value.sources.length > LOCAL_PDF_LIMITS.maximumSources ||
      !value.sources.every(isAssemblySource) ||
      value.sources.reduce((total, source) => total + source.bytes.byteLength, 0) >
        LOCAL_PDF_LIMITS.maximumAssemblyBytes ||
      !Array.isArray(value.annotations) ||
      value.annotations.length > 1_000 ||
      !value.annotations.every(isAnnotation) ||
      !Array.isArray(value.formValues) ||
      value.formValues.length > 500 ||
      !value.formValues.every(isFormValue) ||
      !isEditedOptions(value.options)
    ) {
      throw new Error('The local PDF edit request exceeds its safe limits.');
    }
    const pageIds = new Set(value.pages.map(({ pageId }) => pageId));
    const sourceIds = new Set(value.sources.map(({ sourceId }) => sourceId));
    if (sourceIds.size !== value.sources.length) {
      throw new Error('The local PDF edit request exceeds its safe limits.');
    }
    if (!value.annotations.every(({ pageId }) => pageIds.has(pageId))) {
      throw new Error('The local PDF edit request references an unavailable page.');
    }
    if (
      !value.pages.every(({ sourceId }) => sourceIds.has(sourceId)) ||
      !value.formValues.every(({ sourceId }) => sourceIds.has(sourceId))
    ) {
      throw new Error('The local PDF edit request references an unavailable source.');
    }
    return {
      annotations: value.annotations,
      formValues: value.formValues,
      id: value.id,
      kind: value.kind,
      options: value.options,
      pages: value.pages,
      sources: value.sources,
    };
  }
  if (
    value.kind === 'decorate' &&
    isPdfBytes(value.bytes) &&
    isPdfDecorationOptions(value.options)
  ) {
    return { bytes: value.bytes, id: value.id, kind: value.kind, options: value.options };
  }
  if (value.kind === 'geometry-inspect' && isPdfBytes(value.bytes)) {
    return { bytes: value.bytes, id: value.id, kind: value.kind };
  }
  if (
    value.kind === 'geometry-modify' &&
    isPdfBytes(value.bytes) &&
    isPdfGeometryOptions(value.options)
  ) {
    return { bytes: value.bytes, id: value.id, kind: value.kind, options: value.options };
  }
  if (value.kind === 'number' && isPdfBytes(value.bytes) && isNumberingOptions(value.options)) {
    return { bytes: value.bytes, id: value.id, kind: value.kind, options: value.options };
  }
  if (
    value.kind === 'image-to-pdf' &&
    value.bytes instanceof Uint8Array &&
    value.bytes.byteLength <= LOCAL_PDF_LIMITS.maximumBytes &&
    (value.mimeType === 'image/jpeg' ||
      value.mimeType === 'image/png' ||
      value.mimeType === 'image/webp')
  ) {
    return { bytes: value.bytes, id: value.id, kind: value.kind, mimeType: value.mimeType };
  }
  if (
    value.kind === 'compress' &&
    isPdfBytes(value.bytes) &&
    (value.preset === 'highest-quality' ||
      value.preset === 'balanced' ||
      value.preset === 'smaller')
  ) {
    return { bytes: value.bytes, id: value.id, kind: value.kind, preset: value.preset };
  }
  if (
    value.kind === 'permissions' &&
    Object.keys(value).length === 7 &&
    ['id', 'kind', 'bytes', 'options', 'ownerPassword', 'openPassword', 'authorized'].every((key) =>
      Object.hasOwn(value, key),
    ) &&
    isPdfBytes(value.bytes) &&
    isPdfPermissionOptions(value.options) &&
    isPermissionPassword(value.ownerPassword) &&
    isPermissionPassword(value.openPassword, true) &&
    value.ownerPassword !== value.openPassword &&
    typeof value.authorized === 'boolean'
  ) {
    return {
      id: value.id,
      kind: value.kind,
      bytes: value.bytes,
      options: { ...value.options },
      ownerPassword: value.ownerPassword,
      openPassword: value.openPassword,
      authorized: value.authorized,
    };
  }
  if (
    value.kind === 'protect' &&
    Object.keys(value).length === 4 &&
    ['id', 'kind', 'bytes', 'password'].every((key) => Object.hasOwn(value, key)) &&
    isPdfBytes(value.bytes) &&
    isPassword(value.password)
  ) {
    return { bytes: value.bytes, id: value.id, kind: value.kind, password: value.password };
  }
  if (
    value.kind === 'unlock' &&
    Object.keys(value).length === 5 &&
    ['id', 'kind', 'bytes', 'password', 'authorized'].every((key) => Object.hasOwn(value, key)) &&
    isPdfBytes(value.bytes) &&
    isPassword(value.password) &&
    typeof value.authorized === 'boolean'
  ) {
    return {
      authorized: value.authorized,
      bytes: value.bytes,
      id: value.id,
      kind: value.kind,
      password: value.password,
    };
  }
  if (
    (value.kind === 'metadata-read' || value.kind === 'metadata-remove') &&
    isPdfBytes(value.bytes)
  ) {
    return { bytes: value.bytes, id: value.id, kind: value.kind };
  }
  if (value.kind === 'metadata-update' && isPdfBytes(value.bytes) && isMetadataPatch(value.patch)) {
    return { bytes: value.bytes, id: value.id, kind: value.kind, patch: value.patch };
  }
  if (
    value.kind === 'images-to-pdf' &&
    Array.isArray(value.sources) &&
    value.sources.length > 0 &&
    value.sources.length <= LOCAL_UTILITY_LIMITS.maximumImageCount &&
    value.sources.every(isImageSource) &&
    value.sources.reduce((total, source) => total + source.bytes.byteLength, 0) <=
      LOCAL_UTILITY_LIMITS.maximumImageInputBytes &&
    isRecord(value.options) &&
    (value.options.fit === 'contain' || value.options.fit === 'cover') &&
    (value.options.pageSize === 'a4' ||
      value.options.pageSize === 'image' ||
      value.options.pageSize === 'letter')
  ) {
    return {
      id: value.id,
      kind: value.kind,
      options: { fit: value.options.fit, pageSize: value.options.pageSize },
      sources: value.sources,
    };
  }
  if (
    value.kind === 'redact-raster' &&
    isPdfBytes(value.bytes) &&
    Array.isArray(value.marks) &&
    value.marks.length > 0 &&
    value.marks.length <= LOCAL_REDACTION_LIMITS.maximumRegions &&
    value.marks.every(isRedactionMark) &&
    typeof value.confirmPermanentRemoval === 'boolean' &&
    typeof value.confirmRasterization === 'boolean'
  ) {
    return {
      bytes: value.bytes,
      confirmPermanentRemoval: value.confirmPermanentRemoval,
      confirmRasterization: value.confirmRasterization,
      id: value.id,
      kind: value.kind,
      marks: value.marks,
    };
  }
  throw new Error('The local PDF request is invalid.');
};

export const createPdfWorkerClient = (worker: Worker): PdfWorkerClient => {
  const pending = new Map<
    string,
    {
      readonly reject: (reason?: unknown) => void;
      readonly resolve: (payload: PdfWorkerSuccessPayload) => void;
    }
  >();
  worker.addEventListener('message', (event: MessageEvent<PdfWorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (request === undefined) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.payload);
    else request.reject(new Error(response.message));
  });
  worker.addEventListener('error', () => {
    for (const request of pending.values()) request.reject(new Error('Local PDF worker stopped.'));
    pending.clear();
  });
  const dispatch = (request: PdfWorkerRequest): Promise<PdfWorkerSuccessPayload> =>
    new Promise((resolve, reject) => {
      pending.set(request.id, { reject, resolve });
      worker.postMessage(request);
    });
  const bytesOnly = async (request: PdfWorkerRequest): Promise<Uint8Array> => {
    const payload = await dispatch(request);
    if (payload.kind !== 'bytes') throw new Error('Local PDF worker returned an invalid result.');
    return payload.bytes;
  };
  return {
    assemble: (sources, pages) =>
      bytesOnly({ id: crypto.randomUUID(), kind: 'assemble', pages, sources }),
    createBlankPdf: (options) => bytesOnly({ id: crypto.randomUUID(), kind: 'blank-pdf', options }),
    textToPdf: (bytes, options) =>
      bytesOnly({ id: crypto.randomUUID(), kind: 'text-to-pdf', bytes, options }),
    compress: async (bytes, preset) => {
      const payload = await dispatch({ bytes, id: crypto.randomUUID(), kind: 'compress', preset });
      if (payload.kind !== 'compression')
        throw new Error('Local PDF worker returned an invalid result.');
      return { bytes: payload.bytes, report: payload.report };
    },
    decorate: (bytes, options) =>
      bytesOnly({ bytes, id: crypto.randomUUID(), kind: 'decorate', options }),
    exportEdited: (request) =>
      bytesOnly({ ...request, id: crypto.randomUUID(), kind: 'export-edited' }),
    imageToPdf: (bytes, mimeType) =>
      bytesOnly({ bytes, id: crypto.randomUUID(), kind: 'image-to-pdf', mimeType }),
    imagesToPdf: (sources, options) =>
      bytesOnly({ id: crypto.randomUUID(), kind: 'images-to-pdf', options, sources }),
    inspectGeometry: async (bytes) => {
      const payload = await dispatch({ bytes, id: crypto.randomUUID(), kind: 'geometry-inspect' });
      if (payload.kind !== 'geometry-inspection') {
        throw new Error('Local PDF worker returned an invalid result.');
      }
      return payload.inspection;
    },
    modifyGeometry: async (bytes, options) => {
      const payload = await dispatch({
        bytes,
        id: crypto.randomUUID(),
        kind: 'geometry-modify',
        options,
      });
      if (payload.kind !== 'geometry-result') {
        throw new Error('Local PDF worker returned an invalid result.');
      }
      return { bytes: payload.bytes, report: payload.report };
    },
    number: async (bytes, options) => {
      const payload = await dispatch({ bytes, id: crypto.randomUUID(), kind: 'number', options });
      if (payload.kind !== 'numbering')
        throw new Error('Local PDF worker returned an invalid result.');
      return { bytes: payload.bytes, report: payload.report };
    },
    setPermissions: (bytes, options, ownerPassword, openPassword, authorized) =>
      bytesOnly({
        bytes,
        options,
        ownerPassword,
        openPassword,
        authorized,
        id: crypto.randomUUID(),
        kind: 'permissions',
      }),
    protect: (bytes, password) =>
      bytesOnly({ bytes, id: crypto.randomUUID(), kind: 'protect', password }),
    redactRaster: async (bytes, marks, confirmations) => {
      const payload = await dispatch({
        bytes,
        confirmPermanentRemoval: confirmations.permanentRemoval,
        confirmRasterization: confirmations.rasterization,
        id: crypto.randomUUID(),
        kind: 'redact-raster',
        marks,
      });
      if (payload.kind !== 'redaction')
        throw new Error('Local PDF worker returned an invalid result.');
      return payload.result;
    },
    readMetadata: async (bytes) => {
      const payload = await dispatch({ bytes, id: crypto.randomUUID(), kind: 'metadata-read' });
      if (payload.kind !== 'metadata')
        throw new Error('Local PDF worker returned an invalid result.');
      return payload.metadata;
    },
    removeMetadata: (bytes) =>
      bytesOnly({ bytes, id: crypto.randomUUID(), kind: 'metadata-remove' }),
    terminate: () => {
      worker.terminate();
      for (const request of pending.values())
        request.reject(new Error('Local PDF worker stopped.'));
      pending.clear();
    },
    unlock: (bytes, password, authorized) =>
      bytesOnly({ authorized, bytes, id: crypto.randomUUID(), kind: 'unlock', password }),
    updateMetadata: (bytes, patch) =>
      bytesOnly({ bytes, id: crypto.randomUUID(), kind: 'metadata-update', patch }),
  };
};
