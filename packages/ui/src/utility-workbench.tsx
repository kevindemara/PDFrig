'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';

import {
  BLANK_PAGE_SIZES,
  createPdfWorkerClient,
  createStoredZip,
  isPdfGeometryOptions,
  LOCAL_PDF_LIMITS,
  LOCAL_UTILITY_LIMITS,
  openBrowserPdf,
  previewNumbering,
  resolvePdfImagePages,
  validatePdfImagePixelCount,
  type BlankPageSize,
  type CompressionPreset,
  type DecorationAlignment,
  type PdfGeometryInspection,
  type PdfGeometryOptions,
  type PdfImageJpegQuality,
  type PdfImageScale,
  type NumberingPosition,
  type PageLabelStyle,
  type PdfMetadata,
  type PdfNumberingOptions,
  type PdfNumberingReport,
  type PdfWorkerClient,
} from '@pdfmason/pdf-engine/browser';

import { BrandLockup } from './brand-lockup.js';
import { DecorationWorkbench } from './decoration-workbench.js';
import { TextPdfWorkbench } from './text-pdf-workbench.js';
import { PermissionWorkbench } from './permission-workbench.js';
import { supportedImageMimeType } from './image-input.js';

export type UtilityId =
  | 'blank'
  | 'compress'
  | 'decorate'
  | 'geometry'
  | 'images'
  | 'metadata'
  | 'number'
  | 'permissions'
  | 'protect'
  | 'render'
  | 'text';
// CONV-005 uses an isolated shared lifecycle, not a second host implementation.
type WorkState = 'idle' | 'ready' | 'working' | 'done' | 'error';

interface DownloadResult {
  readonly bytes: Uint8Array;
  readonly detail: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly numberingReport?: PdfNumberingReport;
}

export interface UtilityWorkbenchProps {
  readonly createWorker?: () => Worker;
  readonly enabledFeatures?: Readonly<Record<UtilityId, boolean>>;
  readonly marketingHref?: string;
  readonly surface: 'Web' | 'Windows';
  readonly workspaceHref?: string;
}

const utilities = [
  {
    description: 'Structural optimization with measured before-and-after size.',
    id: 'compress',
    label: 'Compress',
    matrix: 'OPT-001',
  },
  {
    description: 'Add AES-256 open protection or remove it with authorization.',
    id: 'protect',
    label: 'Protect / unlock',
    matrix: 'SEC-001 · SEC-002',
  },
  {
    description: 'Review, update, or clear common document metadata.',
    id: 'metadata',
    label: 'Metadata',
    matrix: 'SEC-004',
  },
  {
    id: 'permissions',
    label: 'PDF permissions',
    description: 'Set reader-enforced permissions with separate owner and open-password roles.',
    matrix: 'SEC-003',
  },
  {
    description: 'Add repeating headers, footers, page tokens, and a visible watermark.',
    id: 'decorate',
    label: 'Header, footer + watermark',
    matrix: 'EDIT-006 · EDIT-007',
  },
  {
    description: 'Add matching logical page labels, visible numbers, or a stable Bates sequence.',
    id: 'number',
    label: 'Page + Bates numbering',
    matrix: 'ORG-011 · ORG-012',
  },
  {
    description: 'Crop the visible boundary or normalize mixed page sizes with measured controls.',
    id: 'geometry',
    label: 'Crop + resize pages',
    matrix: 'ORG-009 · ORG-010',
  },
  {
    description: 'Render PDF pages to PNG or JPEG without an upload.',
    id: 'render',
    label: 'PDF to images',
    matrix: 'CONV-001',
  },
  {
    description: 'Create measured blank pages with a standard content-safe ArtBox.',
    id: 'blank',
    label: 'Create blank PDF',
    matrix: 'CREATE-001',
  },
  {
    description: 'Compose PNG, JPEG, and WebP files into measured PDF pages.',
    id: 'images',
    label: 'Images to PDF',
    matrix: 'CREATE-002',
  },
  {
    id: 'text',
    label: 'Text to PDF',
    description: 'Convert bounded UTF-8 plain text with explicit character and layout limits.',
    matrix: 'CONV-005',
  },
] as const satisfies readonly {
  readonly description: string;
  readonly id: UtilityId;
  readonly label: string;
  readonly matrix: string;
}[];

const emptyMetadata: PdfMetadata = {
  author: '',
  creationDate: null,
  creator: '',
  hasXmpPacket: false,
  keywords: '',
  modificationDate: null,
  producer: '',
  subject: '',
  title: '',
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
};

const readBytes = async (file: File): Promise<Uint8Array> =>
  new Uint8Array(await file.arrayBuffer());

const canvasBytes = async (
  canvas: HTMLCanvasElement,
  mimeType: string,
  jpegQuality: PdfImageJpegQuality,
): Promise<Uint8Array> => {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value === null ? reject(new Error('Image encoding is unavailable.')) : resolve(value),
      mimeType,
      mimeType === 'image/jpeg' ? jpegQuality : undefined,
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
};

const download = ({ bytes, filename, mimeType }: DownloadResult): void => {
  const blob = new Blob([bytes.slice().buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.download = filename;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
};

const errorCopy = (error: unknown): string => {
  const code = error instanceof Error ? error.message : '';
  const messages: Readonly<Record<string, string>> = {
    DECORATION_ACTIVE_CONTENT_BLOCKED:
      'This PDF contains active content. Decorations are blocked to avoid changing hidden behavior.',
    DECORATION_ATTACHMENTS_BLOCKED:
      'This PDF contains file attachments. Decorations are blocked because attachment fidelity is not verified.',
    DECORATION_PASSWORD_REQUIRED: 'Unlock an authorized copy before adding decorations.',
    DECORATION_PAGE_LIMIT: 'This PDF contains more than 500 pages.',
    DECORATION_SIGNATURES_BLOCKED:
      'Certificate-signed PDFs are not decorated because any added mark would invalidate the signature.',
    DECORATION_TEXT_ENCODING_UNSUPPORTED:
      'Use basic Latin characters for this decoration in the current build.',
    DECORATION_XFA_BLOCKED:
      'XFA documents are not decorated because their form behavior cannot be preserved safely.',
    GEOMETRY_ACTIVE_CONTENT_BLOCKED:
      'This PDF contains active content. Page geometry changes are blocked to avoid changing hidden behavior.',
    GEOMETRY_ANNOTATIONS_RESIZE_BLOCKED:
      'Resize is not available because this PDF has links, comments, widgets, or other annotations whose positions are not yet transformed safely. Crop mode remains available.',
    GEOMETRY_ATTACHMENTS_BLOCKED:
      'This PDF contains file attachments. Page geometry changes are blocked because attachment fidelity is not verified.',
    GEOMETRY_CROP_TOO_SMALL: 'The selected margins leave a page smaller than 36 × 36 points.',
    GEOMETRY_FORMS_RESIZE_BLOCKED:
      'Resize is not available for interactive forms because widget positions are not yet transformed safely. Crop mode remains available.',
    GEOMETRY_PAGE_BOX_UNSUPPORTED:
      'A page has missing, invalid, or unusually large geometry that this build cannot change safely.',
    GEOMETRY_PAGE_LIMIT: 'This PDF contains more than 500 pages.',
    GEOMETRY_PAGE_RANGE_INVALID: 'Use a page range that exists in this PDF.',
    GEOMETRY_PASSWORD_REQUIRED: 'Unlock an authorized copy before changing page geometry.',
    GEOMETRY_PREPRESS_RESIZE_BLOCKED:
      'Resize is blocked because this PDF uses print-production boxes or page metadata that must not be normalized silently.',
    GEOMETRY_ROTATION_UNSUPPORTED: 'A page uses a rotation other than 0°, 90°, 180°, or 270°.',
    GEOMETRY_SIGNATURES_BLOCKED:
      'Certificate-signed PDFs are not cropped or resized because the change would invalidate the signature.',
    GEOMETRY_TAGGED_RESIZE_BLOCKED:
      'Resize is blocked for tagged PDFs because transformed content has not passed reading-order verification. Crop mode remains available.',
    GEOMETRY_USER_UNIT_RESIZE_BLOCKED:
      'Resize is blocked because a page uses a non-standard physical unit.',
    GEOMETRY_XFA_BLOCKED:
      'XFA documents are not cropped or resized because their form behavior cannot be preserved safely.',
    NUMBERING_ACTIVE_CONTENT_BLOCKED:
      'This PDF contains active content. Numbering is blocked to avoid changing hidden behavior.',
    NUMBERING_ATTACHMENTS_BLOCKED:
      'This PDF contains file attachments. Numbering is blocked because attachment fidelity is not verified.',
    NUMBERING_IDENTIFIER_LIMIT:
      'An identifier exceeds the 120-character limit. Shorten the prefix or suffix, or use a smaller alphabetic start value.',
    NUMBERING_OPTIONS_INVALID: 'Enter a valid positive sequence and page range.',
    NUMBERING_PAGE_LABELS_EXIST:
      'This PDF already has logical page labels. Confirm replacement or use Bates numbering, which preserves them.',
    NUMBERING_PAGE_LIMIT: 'This PDF contains more than 500 pages.',
    NUMBERING_PAGE_BOX_UNSUPPORTED:
      'A selected page has unsupported page bounds or physical units. Choose a supported copy or a range that excludes it. Your original was not changed.',
    NUMBERING_PAGE_RANGE_INVALID: 'Use a page range that exists in this PDF.',
    NUMBERING_PASSWORD_REQUIRED: 'Unlock an authorized copy before adding numbering.',
    NUMBERING_ROMAN_RANGE_UNSUPPORTED: 'Roman numeral sequences must stay between 1 and 3999.',
    NUMBERING_SEQUENCE_LIMIT: 'Numbering sequences must stay between 1 and 999999999.',
    NUMBERING_ROTATION_UNSUPPORTED:
      'A selected page has an unsupported rotation. Use a copy with quarter-turn page rotations. Your original was not changed.',
    NUMBERING_SIGNATURES_BLOCKED:
      'Certificate-signed PDFs are not numbered because any added mark would invalidate the signature.',
    NUMBERING_TEXT_ENCODING_UNSUPPORTED:
      'Use basic Latin characters for the visible numbering in the current build.',
    NUMBERING_TEXT_CONTROL_UNSUPPORTED:
      'Use a single-line prefix and suffix without tabs or control characters. Ordinary spaces are kept exactly as entered.',
    NUMBERING_TEXT_DOES_NOT_FIT:
      'Numbering would clip on a selected page. Shorten the prefix or suffix, or choose a range with larger pages. Your original was not changed.',
    NUMBERING_XFA_BLOCKED:
      'XFA documents are not numbered because their form behavior cannot be preserved safely.',
    LIMIT_BYTES: 'This PDF is larger than the 50 MB local limit.',
    LIMIT_PAGES: 'This PDF contains more than 500 pages.',
    NOT_PDF: 'Choose a valid PDF file.',
    UTILITY_AUTHORIZATION_REQUIRED: 'Confirm that you are authorized to remove this protection.',
    UTILITY_BLANK_OPTIONS_INVALID:
      'Choose a supported page size, orientation, and content-safe margin.',
    UTILITY_BLANK_VERIFICATION_FAILED:
      'Blank PDF creation stopped because the page boxes could not be verified.',
    UTILITY_ACTIVE_CONTENT_BLOCKED:
      'This PDF contains active content. Processing is blocked to avoid changing hidden behavior. Your original was not changed.',
    UTILITY_ATTACHMENTS_BLOCKED:
      'This PDF contains attachments. Processing is blocked because attachment fidelity is not verified. Your original was not changed.',
    UTILITY_IMAGE_INVALID: 'One of the selected images could not be decoded.',
    UTILITY_IMAGE_ANIMATION_UNSUPPORTED:
      'Animated WebP is not supported. Choose a still image or export one frame first.',
    UTILITY_IMAGE_DECODE_MISMATCH:
      'An image decoder returned unexpected dimensions. No PDF was created.',
    UTILITY_IMAGE_DECODER_UNAVAILABLE:
      'This browser cannot safely decode WebP or apply image orientation on this device.',
    UTILITY_IMAGE_ENCODING_FAILED:
      'An oriented image could not be normalized safely. No PDF was created.',
    UTILITY_IMAGE_PIXELS_LIMIT: 'One of the selected images exceeds the safe pixel limit.',
    UTILITY_IMAGE_TOTAL_SIZE_LIMIT: 'Choose images totalling no more than 100 MB.',
    UTILITY_INCREMENTAL_REVISIONS_BLOCKED:
      'This PDF contains earlier revisions. Processing is blocked because rewriting revision history has not been verified safely. Your original was not changed.',
    UTILITY_METADATA_KEYWORDS_LIMIT: 'Use no more than 50 short keywords.',
    UTILITY_NOT_ENCRYPTED: 'This PDF does not have open-password protection.',
    UTILITY_PASSWORD_INCORRECT: 'That password did not open the PDF.',
    UTILITY_PASSWORD_REQUIRED: 'This PDF needs a password before it can be processed.',
    UTILITY_PASSWORD_TOO_LONG: 'Use a password no longer than 127 UTF-8 bytes.',
    UTILITY_PASSWORD_TOO_SHORT: 'Use at least 12 characters for a new password.',
    UTILITY_PASSWORD_CHARACTERS_UNSUPPORTED:
      'Use 12–127 printable ASCII characters for a new password. No characters are substituted.',
    UTILITY_PERMISSIONS_PAGE_LIMIT:
      'Protection supports PDFs up to 500 pages. Choose a smaller PDF. Your original was not changed.',
    UTILITY_PERMISSIONS_STRING_LAYOUT_BLOCKED:
      'This PDF has a string layout the protection engine cannot safely encrypt. No export was made; your original is unchanged.',
    UTILITY_PERMISSIONS_EXTENSIONS_BLOCKED:
      'This PDF declares extensions the protection engine has not verified. No export was made; your original is unchanged.',
    UTILITY_PERMISSIONS_VERIFICATION_FAILED:
      'Protection could not be verified without changing document content. No export was made; your original is unchanged.',
    UTILITY_DECRYPT_VERIFICATION_FAILED:
      'Password removal could not be verified without changing document content. No export was made; your original is unchanged.',
    UTILITY_PDF_MALFORMED:
      'This PDF has damaged or incomplete structure that PDFrig cannot safely process. Try exporting a fresh copy from the source application. Your original was not changed.',
    UTILITY_PDF_PAGE_LIMIT: `Compression supports PDFs up to ${LOCAL_PDF_LIMITS.maximumPages} pages. Choose a smaller PDF. Your original was not changed.`,
    UTILITY_PRESERVATION_FAILED:
      'Compression stopped because PDFrig could not verify that the document structure was preserved. Your original was not changed.',
    UTILITY_SIGNATURES_BLOCKED:
      'This PDF has a digital-signature structure. Processing is blocked because rewriting may invalidate it. Your original was not changed.',
    UTILITY_XFA_BLOCKED:
      'This PDF uses XFA. Processing is blocked because its form behavior cannot be preserved safely. Your original was not changed.',
    UTILITY_RENDER_PAGE_LIMIT: 'PDF-to-image jobs are limited to 50 pages at a time.',
    UTILITY_RENDER_OPTIONS_INVALID: 'Choose supported PDF image settings.',
    UTILITY_RENDER_PAGE_RANGE_INVALID:
      'Use “all” or a valid page range such as 1-3, 5 without duplicates.',
    UTILITY_RENDER_PIXELS_LIMIT:
      'A selected page would create an image larger than the 20-megapixel local limit. Choose a lower resolution.',
    UTILITY_RENDER_XFA_BLOCKED:
      'Pure XFA pages are not rendered because their visible content is not supported safely.',
  };
  return messages[code] ?? 'Local processing stopped safely. Your original was not changed.';
};

export const DEFAULT_UTILITY_FEATURES: Readonly<Record<UtilityId, boolean>> = Object.freeze({
  blank: true,
  compress: true,
  decorate: true,
  geometry: true,
  images: true,
  metadata: true,
  number: true,
  permissions: false,
  protect: true,
  render: true,
  text: false,
});

// CREATE-002 and the shared utility IDs: server HTML must not accept actions
// until client handlers attach. Native disabled controls also cover file input.
const subscribeToHydration = () => () => undefined;
const clientHydrated = () => true;
const serverHydrated = () => false;

export const UtilityWorkbench = ({
  createWorker,
  enabledFeatures = DEFAULT_UTILITY_FEATURES,
  marketingHref = '/',
  surface,
  workspaceHref = '/workspace',
}: UtilityWorkbenchProps) => {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);
  const [active, setActive] = useState<UtilityId>(
    () => utilities.find(({ id }) => enabledFeatures[id])?.id ?? 'compress',
  );
  const [authorized, setAuthorized] = useState(false);
  const [blankMarginPoints, setBlankMarginPoints] = useState(36);
  const [blankOrientation, setBlankOrientation] = useState<'landscape' | 'portrait'>('portrait');
  const [blankPageSize, setBlankPageSize] = useState<BlankPageSize>('letter');
  const [blankPageCountInput, setBlankPageCountInput] = useState('1');
  const blankPageCount = Number(blankPageCountInput);
  const blankPageCountValid =
    /^[1-9]\d{0,2}$/u.test(blankPageCountInput) && blankPageCount <= LOCAL_PDF_LIMITS.maximumPages;
  const [compressionPreset, setCompressionPreset] = useState<CompressionPreset>('balanced');
  const [geometryBottom, setGeometryBottom] = useState('36');
  const [geometryEndPage, setGeometryEndPage] = useState('');
  const [geometryFit, setGeometryFit] = useState<'contain' | 'cover'>('contain');
  const [geometryInspection, setGeometryInspection] = useState<PdfGeometryInspection | null>(null);
  const [geometryLeft, setGeometryLeft] = useState('36');
  const [geometryMode, setGeometryMode] = useState<'crop' | 'resize'>('crop');
  const [geometryOrientation, setGeometryOrientation] = useState<'landscape' | 'portrait'>(
    'portrait',
  );
  const [geometryPreset, setGeometryPreset] = useState<'a4' | 'custom' | 'legal' | 'letter'>(
    'letter',
  );
  const [geometryRight, setGeometryRight] = useState('36');
  const [geometryStartPage, setGeometryStartPage] = useState('1');
  const [geometryTargetHeight, setGeometryTargetHeight] = useState('792');
  const [geometryTargetWidth, setGeometryTargetWidth] = useState('612');
  const [geometryTop, setGeometryTop] = useState('36');
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [imageFiles, setImageFiles] = useState<readonly File[]>([]);
  const [imageFormat, setImageFormat] = useState<'jpeg' | 'png'>('png');
  const [imageJpegQuality, setImageJpegQuality] = useState<PdfImageJpegQuality>(0.92);
  const [imageScale, setImageScale] = useState<PdfImageScale>(2);
  const [imageTransparentBackground, setImageTransparentBackground] = useState(false);
  const [message, setMessage] = useState('Choose a file to begin.');
  const [metadata, setMetadata] = useState<PdfMetadata>(emptyMetadata);
  const [mode, setMode] = useState<'protect' | 'unlock'>('protect');
  const [numberingAlignment, setNumberingAlignment] = useState<DecorationAlignment>('right');
  const [numberingDigits, setNumberingDigits] = useState('6');
  const [numberingEndPage, setNumberingEndPage] = useState('');
  const [numberingMode, setNumberingMode] = useState<'bates' | 'page-labels'>('page-labels');
  const [numberingPosition, setNumberingPosition] = useState<NumberingPosition>('footer');
  const [numberingPrefix, setNumberingPrefix] = useState('PDFM-');
  const [numberingStartNumber, setNumberingStartNumber] = useState('1');
  const [numberingStartPage, setNumberingStartPage] = useState('1');
  const [numberingStyle, setNumberingStyle] = useState<PageLabelStyle>('decimal');
  const [numberingSuffix, setNumberingSuffix] = useState('');
  const [pageSize, setPageSize] = useState<'a4' | 'image' | 'letter'>('image');
  const [password, setPassword] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [result, setResult] = useState<DownloadResult | null>(null);
  const [replaceExistingPageLabels, setReplaceExistingPageLabels] = useState(false);
  const [renderPageRange, setRenderPageRange] = useState('all');
  const [state, setState] = useState<WorkState>('idle');
  const geometryRequest = useRef(0);
  const operationRequest = useRef(0);
  const workerClient = useRef<PdfWorkerClient | null>(null);

  // OPT-001 / ORG-009–012: invalidate synchronously, including resolved worker promises.
  // Shared guards also prevent a previous utility from publishing into the current screen.
  const release = (): void => {
    operationRequest.current += 1;
    geometryRequest.current += 1;
    workerClient.current?.terminate();
    workerClient.current = null;
  };
  useEffect(() => release, []);

  const invalidateResult = (): void => {
    release();
    setResult(null);
    setState(active === 'blank' || pdfFile !== null ? 'ready' : 'idle');
    setMessage(
      active === 'blank'
        ? 'Settings changed. Create a new blank PDF.'
        : pdfFile === null
          ? 'Choose a file to begin.'
          : 'Settings changed. Create a new export. Your original remains unchanged.',
    );
  };

  const invalidateGeometry = (): void => {
    // ORG-009/010: inspection measures the immutable source, not the editable options.
    // Let it finish; once measured, settings invalidate only the export and keep the source.
    if (pdfFile !== null && geometryInspection === null) return;
    invalidateResult();
  };

  const selectUtility = (utility: UtilityId): void => {
    release();
    setActive(utility);
    setAuthorized(false);
    setImageFiles([]);
    setMessage(
      utility === 'blank'
        ? 'Page settings ready · no source file needed.'
        : 'Choose a file to begin.',
    );
    setMetadata(emptyMetadata);
    setGeometryInspection(null);
    setPassword('');
    setPdfFile(null);
    setResult(null);
    setState(utility === 'blank' ? 'ready' : 'idle');
  };

  const selectPdf = (file: File | undefined): void => {
    release();
    setAuthorized(false);
    const request = geometryRequest.current;
    setPassword('');
    setGeometryInspection(null);
    setResult(null);
    if (file === undefined) {
      setPdfFile(null);
      setMessage('Choose a file to begin.');
      setState('idle');
      return;
    }
    if (file.type !== 'application/pdf' || file.size > 50 * 1024 * 1024) {
      setPdfFile(null);
      setMessage('Choose a PDF up to 50 MB.');
      setState('error');
      return;
    }
    setPdfFile(file);
    if (active === 'geometry') {
      setMessage('Measuring page boxes locally…');
      setState('working');
      void (async () => {
        try {
          const input = await readBytes(file);
          if (geometryRequest.current !== request) return;
          const inspection = await requireWorker().inspectGeometry(input);
          if (geometryRequest.current !== request) return;
          setGeometryInspection(inspection);
          setMessage(
            `PDF ready · ${inspection.pageCount} page${inspection.pageCount === 1 ? '' : 's'} measured locally · ${formatBytes(file.size)}.`,
          );
          setState('ready');
        } catch (error: unknown) {
          if (geometryRequest.current !== request) return;
          setPdfFile(null);
          setMessage(errorCopy(error));
          setState('error');
        }
      })();
      return;
    }
    setMessage(
      `PDF ready · ${formatBytes(file.size)} · held only in this ${surface.toLowerCase()} session.`,
    );
    setState('ready');
  };

  const selectImages = (files: readonly File[]): void => {
    release();
    const typeAndFileSizeAccepted = files.filter(
      (file) => supportedImageMimeType(file) !== null && file.size <= 50 * 1024 * 1024,
    );
    const accepted: File[] = [];
    let totalBytes = 0;
    for (const file of typeAndFileSizeAccepted) {
      if (accepted.length >= LOCAL_UTILITY_LIMITS.maximumImageCount) break;
      if (totalBytes + file.size > LOCAL_UTILITY_LIMITS.maximumImageInputBytes) break;
      accepted.push(file);
      totalBytes += file.size;
    }
    setImageFiles(accepted);
    setResult(null);
    setMessage(
      accepted.length === 0
        ? 'Choose PNG, JPEG, or WebP images up to 50 MB each.'
        : `${accepted.length} image${accepted.length === 1 ? '' : 's'} ready · ${formatBytes(totalBytes)} total · original order preserved.`,
    );
    setState(accepted.length === 0 ? 'error' : 'ready');
  };

  const requireWorker = (): PdfWorkerClient => {
    if (workerClient.current === null) {
      if (createWorker === undefined) throw new Error('WORKER_UNAVAILABLE');
      workerClient.current = createPdfWorkerClient(createWorker());
    }
    return workerClient.current;
  };

  const currentNumberingOptions = (): PdfNumberingOptions => {
    const base = {
      alignment: numberingAlignment,
      color: '#17232d',
      endPage: numberingEndPage.trim().length === 0 ? null : Number(numberingEndPage),
      fontSize: 9,
      marginPoints: 32,
      position: numberingPosition,
      startNumber: Number(numberingStartNumber),
      startPage: Number(numberingStartPage),
    } as const;
    return numberingMode === 'bates'
      ? {
          ...base,
          digits: Number(numberingDigits),
          kind: 'bates',
          prefix: numberingPrefix,
          suffix: numberingSuffix,
        }
      : {
          ...base,
          kind: 'page-labels',
          prefix: numberingPrefix,
          replaceExistingLabels: replaceExistingPageLabels,
          style: numberingStyle,
        };
  };

  const currentGeometryOptions = (): PdfGeometryOptions => {
    const range = {
      endPage: geometryEndPage.trim().length === 0 ? null : Number(geometryEndPage),
      startPage: Number(geometryStartPage),
    } as const;
    if (geometryMode === 'crop') {
      return {
        ...range,
        kind: 'crop',
        margins: {
          bottom: Number(geometryBottom),
          left: Number(geometryLeft),
          right: Number(geometryRight),
          top: Number(geometryTop),
        },
      };
    }
    const portraitSize =
      geometryPreset === 'a4'
        ? { height: 841.89, width: 595.28 }
        : geometryPreset === 'legal'
          ? { height: 1008, width: 612 }
          : geometryPreset === 'letter'
            ? { height: 792, width: 612 }
            : {
                height: Number(geometryTargetHeight),
                width: Number(geometryTargetWidth),
              };
    const target =
      geometryPreset !== 'custom' && geometryOrientation === 'landscape'
        ? { height: portraitSize.width, width: portraitSize.height }
        : portraitSize;
    return {
      ...range,
      fit: geometryFit,
      kind: 'resize',
      targetHeight: target.height,
      targetWidth: target.width,
    };
  };

  const run = async (): Promise<void> => {
    if (!canRun) return;
    release();
    const request = operationRequest.current;
    const current = () => operationRequest.current === request;
    const publish = (output: DownloadResult): void => {
      if (current()) setResult(output);
    };
    setResult(null);
    setState('working');
    setMessage('Working locally…');
    try {
      const worker = requireWorker();
      if (active === 'blank') {
        const bytes = await worker.createBlankPdf({
          marginPoints: blankMarginPoints,
          orientation: blankOrientation,
          pageSize: blankPageSize,
          pageCount: blankPageCount,
        });
        publish({
          bytes,
          detail: `${blankPageCount} blank page${blankPageCount === 1 ? '' : 's'} · ${BLANK_PAGE_SIZES[blankPageSize].label} · ${blankOrientation} · ${blankMarginPoints} pt content-safe margin · ${formatBytes(bytes.byteLength)}`,
          filename: `pdfmason-blank-${blankPageSize}-${blankOrientation}.pdf`,
          mimeType: 'application/pdf',
        });
      } else if (active === 'images') {
        const sources = await Promise.all(
          imageFiles.map(async (file) => {
            const mimeType = supportedImageMimeType(file);
            if (mimeType === null) throw new Error('UTILITY_IMAGE_INVALID');
            return { bytes: await readBytes(file), mimeType };
          }),
        );
        if (!current()) return;
        const bytes = await worker.imagesToPdf(sources, { fit, pageSize });
        publish({
          bytes,
          detail: `${sources.length} image${sources.length === 1 ? '' : 's'} · ${fit} fit · ${formatBytes(bytes.byteLength)}`,
          filename: 'pdfmason-images.pdf',
          mimeType: 'application/pdf',
        });
      } else {
        if (pdfFile === null) throw new Error('NOT_PDF');
        const input = await readBytes(pdfFile);
        if (!current()) return;
        if (active === 'compress') {
          const output = await worker.compress(input, compressionPreset);
          publish({
            bytes: output.bytes,
            detail: output.report.usedOriginal
              ? `Already structurally optimized · kept ${formatBytes(output.report.outputBytes)}`
              : `${formatBytes(output.report.originalBytes)} → ${formatBytes(output.report.outputBytes)} · ${output.report.reductionPercent}% smaller`,
            filename: 'pdfmason-optimized.pdf',
            mimeType: 'application/pdf',
          });
        } else if (active === 'geometry') {
          const output = await worker.modifyGeometry(input, currentGeometryOptions());
          publish({
            bytes: output.bytes,
            detail: `${output.report.appliedPages} page${output.report.appliedPages === 1 ? '' : 's'} · ${Math.round(output.report.firstPageAfter.visibleWidth)} × ${Math.round(output.report.firstPageAfter.visibleHeight)} pt first result · ${formatBytes(output.bytes.byteLength)}`,
            filename:
              output.report.kind === 'crop' ? 'pdfmason-cropped.pdf' : 'pdfmason-resized.pdf',
            mimeType: 'application/pdf',
          });
        } else if (active === 'number') {
          const output = await worker.number(input, currentNumberingOptions());
          publish({
            bytes: output.bytes,
            detail: `${output.report.appliedPages} page${output.report.appliedPages === 1 ? '' : 's'} · ${output.report.firstIdentifier} → ${output.report.lastIdentifier} · ${formatBytes(output.bytes.byteLength)}`,
            filename:
              output.report.kind === 'bates'
                ? 'pdfmason-bates-numbered.pdf'
                : 'pdfmason-page-numbered.pdf',
            mimeType: 'application/pdf',
            numberingReport: output.report,
          });
        } else if (active === 'protect') {
          const bytes =
            mode === 'protect'
              ? await worker.protect(input, password)
              : await worker.unlock(input, password, authorized);
          publish({
            bytes,
            detail:
              mode === 'protect'
                ? `AES-256 open protection · ${formatBytes(bytes.byteLength)}`
                : `Open protection removed · ${formatBytes(bytes.byteLength)}`,
            filename: mode === 'protect' ? 'pdfmason-protected.pdf' : 'pdfmason-unlocked.pdf',
            mimeType: 'application/pdf',
          });
        } else if (active === 'metadata') {
          const bytes = await worker.updateMetadata(input, {
            author: metadata.author,
            creator: metadata.creator,
            keywords: metadata.keywords,
            producer: metadata.producer,
            subject: metadata.subject,
            title: metadata.title,
          });
          publish({
            bytes,
            detail: `Common document information updated · ${formatBytes(bytes.byteLength)}`,
            filename: 'pdfmason-metadata-updated.pdf',
            mimeType: 'application/pdf',
          });
        } else {
          const document = await openBrowserPdf(input, password.length === 0 ? {} : { password });
          try {
            if (!current()) return;
            const inspection = await document.inspect();
            if (inspection.isPureXfa) throw new Error('UTILITY_RENDER_XFA_BLOCKED');
            const pageIndices = resolvePdfImagePages(
              {
                format: imageFormat,
                jpegQuality: imageJpegQuality,
                pageRange: renderPageRange,
                scale: imageScale,
                transparentBackground: imageTransparentBackground,
              },
              document.pageCount,
            );
            const entries: { bytes: Uint8Array; name: string }[] = [];
            for (let selectionIndex = 0; selectionIndex < pageIndices.length; selectionIndex += 1) {
              const pageIndex = pageIndices[selectionIndex];
              if (pageIndex === undefined) continue;
              if (!current()) return;
              setMessage(
                `Rendering selected page ${selectionIndex + 1} of ${pageIndices.length} locally…`,
              );
              const metrics = await document.getPageMetrics(pageIndex);
              validatePdfImagePixelCount(metrics.width, metrics.height, imageScale);
              const canvas = window.document.createElement('canvas');
              await document.renderPage(
                canvas,
                pageIndex,
                imageScale,
                0,
                1,
                imageFormat === 'png' && imageTransparentBackground ? 'transparent' : 'opaque',
              );
              const mimeType = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
              entries.push({
                bytes: await canvasBytes(canvas, mimeType, imageJpegQuality),
                name: `page-${String(pageIndex + 1).padStart(3, '0')}.${imageFormat === 'png' ? 'png' : 'jpg'}`,
              });
            }
            const bytes = createStoredZip(entries);
            publish({
              bytes,
              detail: `${entries.length} ${imageFormat.toUpperCase()} page image${entries.length === 1 ? '' : 's'} · ${imageScale}× · ${formatBytes(bytes.byteLength)}`,
              filename: 'pdfmason-pages.zip',
              mimeType: 'application/zip',
            });
          } finally {
            await document.destroy();
          }
        }
      }
      if (!current()) return;
      setMessage('Export ready. Your original remains unchanged.');
      setState('done');
    } catch (error: unknown) {
      if (!current()) return;
      setMessage(errorCopy(error));
      setState('error');
    } finally {
      if (current() && (active === 'protect' || active === 'render')) setPassword('');
      if (current() && active === 'protect') {
        workerClient.current?.terminate();
        workerClient.current = null;
      }
    }
  };

  const readMetadata = async (): Promise<void> => {
    if (pdfFile === null) return;
    release();
    const request = operationRequest.current;
    setResult(null);
    setState('working');
    setMessage('Reading document information locally…');
    try {
      const input = await readBytes(pdfFile);
      if (operationRequest.current !== request) return;
      const value = await requireWorker().readMetadata(input);
      if (operationRequest.current !== request) return;
      setMetadata(value);
      setMessage(
        value.hasXmpPacket
          ? 'Metadata loaded · an XMP packet is also present.'
          : 'Metadata loaded.',
      );
      setState('ready');
    } catch (error: unknown) {
      if (operationRequest.current !== request) return;
      setMessage(errorCopy(error));
      setState('error');
    }
  };

  const removeMetadata = async (): Promise<void> => {
    if (pdfFile === null) return;
    release();
    const request = operationRequest.current;
    setResult(null);
    setState('working');
    setMessage('Removing common document information and XMP locally…');
    try {
      const input = await readBytes(pdfFile);
      if (operationRequest.current !== request) return;
      const bytes = await requireWorker().removeMetadata(input);
      if (operationRequest.current !== request) return;
      setMetadata(emptyMetadata);
      setResult({
        bytes,
        detail: `Common document information and XMP removed · ${formatBytes(bytes.byteLength)}`,
        filename: 'pdfmason-metadata-removed.pdf',
        mimeType: 'application/pdf',
      });
      setMessage('Cleaned export ready. Your original remains unchanged.');
      setState('done');
    } catch (error: unknown) {
      if (operationRequest.current !== request) return;
      setMessage(errorCopy(error));
      setState('error');
    }
  };

  const activeUtility = utilities.find(({ id }) => id === active);
  if (activeUtility === undefined) throw new Error('The selected utility is unavailable.');
  const blankBase = BLANK_PAGE_SIZES[blankPageSize];
  const blankWidth = blankOrientation === 'landscape' ? blankBase.height : blankBase.width;
  const blankHeight = blankOrientation === 'landscape' ? blankBase.width : blankBase.height;
  const blankPageStyle: CSSProperties = { aspectRatio: `${blankWidth} / ${blankHeight}` };
  const blankSafeAreaStyle: CSSProperties = {
    bottom: `${(blankMarginPoints / blankHeight) * 100}%`,
    left: `${(blankMarginPoints / blankWidth) * 100}%`,
    right: `${(blankMarginPoints / blankWidth) * 100}%`,
    top: `${(blankMarginPoints / blankHeight) * 100}%`,
  };
  let numberingPreview: readonly string[] = [];
  let numberingPreviewError = '';
  try {
    numberingPreview = previewNumbering(currentNumberingOptions());
  } catch (error: unknown) {
    numberingPreview = [];
    numberingPreviewError = errorCopy(error);
  }
  let geometryOptions: PdfGeometryOptions | null = null;
  let geometryPreviewPage = null as PdfGeometryInspection['pages'][number] | null;
  let geometrySourceStyle: CSSProperties = {};
  let geometryTargetStyle: CSSProperties = {};
  let geometryContentStyle: CSSProperties = {};
  let geometryValid = false;
  try {
    const candidate = currentGeometryOptions();
    if (isPdfGeometryOptions(candidate) && geometryInspection !== null) {
      const endPage = candidate.endPage ?? geometryInspection.pageCount;
      if (candidate.startPage <= endPage && endPage <= geometryInspection.pageCount) {
        const selectedPages = geometryInspection.pages.slice(candidate.startPage - 1, endPage);
        geometryPreviewPage = selectedPages[0] ?? null;
        geometryValid =
          selectedPages.length > 0 &&
          (candidate.kind === 'resize' ||
            (candidate.margins.bottom +
              candidate.margins.left +
              candidate.margins.right +
              candidate.margins.top >
              0 &&
              selectedPages.every(
                (page) =>
                  page.visibleWidth - candidate.margins.left - candidate.margins.right >= 36 &&
                  page.visibleHeight - candidate.margins.top - candidate.margins.bottom >= 36,
              )));
        if (geometryPreviewPage !== null) {
          geometrySourceStyle = {
            aspectRatio: `${geometryPreviewPage.visibleWidth} / ${geometryPreviewPage.visibleHeight}`,
          };
          if (candidate.kind === 'crop') {
            geometryContentStyle = {
              bottom: `${(candidate.margins.bottom / geometryPreviewPage.visibleHeight) * 100}%`,
              left: `${(candidate.margins.left / geometryPreviewPage.visibleWidth) * 100}%`,
              right: `${(candidate.margins.right / geometryPreviewPage.visibleWidth) * 100}%`,
              top: `${(candidate.margins.top / geometryPreviewPage.visibleHeight) * 100}%`,
            };
          } else {
            geometryTargetStyle = {
              aspectRatio: `${candidate.targetWidth} / ${candidate.targetHeight}`,
            };
            const scale =
              candidate.fit === 'cover'
                ? Math.max(
                    candidate.targetWidth / geometryPreviewPage.visibleWidth,
                    candidate.targetHeight / geometryPreviewPage.visibleHeight,
                  )
                : Math.min(
                    candidate.targetWidth / geometryPreviewPage.visibleWidth,
                    candidate.targetHeight / geometryPreviewPage.visibleHeight,
                  );
            const width = geometryPreviewPage.visibleWidth * scale;
            const height = geometryPreviewPage.visibleHeight * scale;
            geometryContentStyle = {
              height: `${(height / candidate.targetHeight) * 100}%`,
              left: `${((candidate.targetWidth - width) / 2 / candidate.targetWidth) * 100}%`,
              top: `${((candidate.targetHeight - height) / 2 / candidate.targetHeight) * 100}%`,
              width: `${(width / candidate.targetWidth) * 100}%`,
            };
          }
        }
        geometryOptions = candidate;
      }
    }
  } catch {
    geometryOptions = null;
    geometryValid = false;
  }
  const canRun =
    state !== 'working' &&
    enabledFeatures[active] &&
    (active === 'blank' || (active === 'images' ? imageFiles.length > 0 : pdfFile !== null)) &&
    (active !== 'protect' || (password.length > 0 && (mode === 'protect' || authorized))) &&
    (active !== 'geometry' || geometryValid) &&
    (active !== 'blank' || blankPageCountValid) &&
    (active !== 'number' || numberingPreview.length > 0);

  return (
    <main className="utility-page">
      <header className="utility-header">
        <a aria-label="PDFrig home" className="brand-link" href={marketingHref}>
          <BrandLockup />
        </a>
        <div className="utility-header__context">
          <span className="utility-header__surface">{surface}</span>
          <span aria-hidden="true">/</span>
          <strong>Local tools</strong>
        </div>
        <a className="button button--quiet" href={workspaceHref}>
          Open editor
        </a>
      </header>

      <section className="utility-intro">
        <div>
          <p className="eyebrow">Measured utility bench</p>
          <h1>Finish a PDF job without surrendering the file.</h1>
        </div>
        <p>
          These launch utilities work on this device. Files and passwords stay in memory, exports
          are new copies, and every fidelity trade-off is stated before processing.
        </p>
      </section>

      <div className="utility-layout">
        <nav aria-label="PDF utility tools" className="utility-rail">
          {utilities.map((utility, index) => (
            <button
              aria-current={active === utility.id ? 'page' : undefined}
              className="utility-rail__item"
              disabled={!hydrated || !enabledFeatures[utility.id]}
              key={utility.id}
              onClick={() => selectUtility(utility.id)}
              type="button"
            >
              <span className="utility-rail__number">{String(index + 1).padStart(2, '0')}</span>
              <span>
                <strong>{utility.label}</strong>
                <small>{utility.matrix}</small>
                {!enabledFeatures[utility.id] ? <small>Temporarily unavailable</small> : null}
              </span>
            </button>
          ))}
        </nav>

        <fieldset className="utility-bench" aria-labelledby="utility-title" disabled={!hydrated}>
          <header className="utility-bench__heading">
            <div>
              <p className="eyebrow">{activeUtility.matrix}</p>
              <h2 id="utility-title">{activeUtility.label}</h2>
              <p>{activeUtility.description}</p>
            </div>
            <span className="location-pill">
              <span aria-hidden="true" className="status-dot status-dot--local" />
              On this device
            </span>
          </header>

          <div className="job-ruler" aria-label="Processing path">
            <span>Immutable input</span>
            <span aria-hidden="true">→</span>
            <strong>Local worker</strong>
            <span aria-hidden="true">→</span>
            <span>New export</span>
          </div>

          {active !== 'blank' &&
            active !== 'decorate' &&
            active !== 'text' &&
            active !== 'permissions' && (
              <label className="utility-dropzone">
                <input
                  accept={
                    active === 'images' ? 'image/png,image/jpeg,image/webp' : 'application/pdf,.pdf'
                  }
                  key={active}
                  multiple={active === 'images'}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    if (active === 'images') selectImages(files);
                    else selectPdf(files[0]);
                  }}
                  type="file"
                />
                <span className="utility-dropzone__mark" aria-hidden="true">
                  +
                </span>
                <strong>
                  {active === 'images' ? 'Choose PNG, JPEG, or WebP files' : 'Choose a PDF'}
                </strong>
                <span>
                  {active === 'images'
                    ? 'Up to 100 images · 100 MB total · 20 megapixels each'
                    : active === 'render'
                      ? 'One PDF · up to 50 MB and 50 rendered pages'
                      : 'One PDF · up to 50 MB and 500 pages'}
                </span>
              </label>
            )}

          {active === 'blank' ? (
            <div className="blank-pdf-panel" onChangeCapture={invalidateResult}>
              <div className="metadata-grid">
                <label className="field-label">
                  Number of pages
                  <input
                    aria-describedby="blank-page-count-help"
                    aria-invalid={!blankPageCountValid}
                    inputMode="numeric"
                    min={1}
                    max={LOCAL_PDF_LIMITS.maximumPages}
                    step={1}
                    type="number"
                    value={blankPageCountInput}
                    onChange={(event) => setBlankPageCountInput(event.currentTarget.value)}
                  />
                </label>
                <label className="field-label">
                  Page size
                  <select
                    onChange={(event) =>
                      setBlankPageSize(event.currentTarget.value as BlankPageSize)
                    }
                    value={blankPageSize}
                  >
                    <option value="letter">US Letter · 8.5 × 11 in</option>
                    <option value="a4">A4 · 210 × 297 mm</option>
                    <option value="legal">US Legal · 8.5 × 14 in</option>
                  </select>
                </label>
                <label className="field-label">
                  Orientation
                  <select
                    onChange={(event) =>
                      setBlankOrientation(event.currentTarget.value as 'landscape' | 'portrait')
                    }
                    value={blankOrientation}
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
                <label className="field-label">
                  Content-safe margin
                  <select
                    onChange={(event) => setBlankMarginPoints(Number(event.currentTarget.value))}
                    value={blankMarginPoints}
                  >
                    <option value={0}>None · 0 pt</option>
                    <option value={36}>Compact · 36 pt / 0.5 in</option>
                    <option value={72}>Generous · 72 pt / 1 in</option>
                  </select>
                </label>
              </div>
              <p id="blank-page-count-help" className="fidelity-note">
                1–{LOCAL_PDF_LIMITS.maximumPages} identical pages. The preview shows one page’s
                geometry; no source file is needed.
              </p>
              {!blankPageCountValid && (
                <p role="alert">
                  Enter a whole page count from 1 to {LOCAL_PDF_LIMITS.maximumPages}.
                </p>
              )}
              <section aria-label="Blank page preview" className="blank-page-preview">
                <div
                  aria-label={`${blankBase.label} ${blankOrientation} blank page with ${blankMarginPoints} point content-safe margin`}
                  className="blank-page-preview__page"
                  role="img"
                  style={blankPageStyle}
                >
                  <span className="blank-page-preview__safe-area" style={blankSafeAreaStyle}>
                    ArtBox
                  </span>
                </div>
                <div>
                  <p className="eyebrow">Measured page</p>
                  <strong>
                    {blankWidth.toFixed(2).replace(/\.00$/u, '')} ×{' '}
                    {blankHeight.toFixed(2).replace(/\.00$/u, '')} pt
                  </strong>
                  <span>
                    {blankPageCountValid
                      ? `${blankPageCount} blank page${blankPageCount === 1 ? '' : 's'} · no source file`
                      : 'Page count needs correction'}
                  </span>
                </div>
              </section>
              <p className="fidelity-note">
                Every PDF page stays completely blank. The selected margin is stored as the standard
                ArtBox content-safe area; ordinary readers may not display that guide. MediaBox and
                CropBox keep the full selected page size.
              </p>
            </div>
          ) : null}

          {active === 'compress' ? (
            <fieldset className="option-group" onChangeCapture={invalidateResult}>
              <legend>Compression preset</legend>
              {(
                [
                  ['highest-quality', 'Highest quality', 'Compatibility-first structural rewrite'],
                  ['balanced', 'Balanced', 'Lossless object-stream optimization'],
                  ['smaller', 'Smaller', 'Full lossless structural rewrite'],
                ] as const
              ).map(([value, label, detail]) => (
                <label className="choice-card" key={value}>
                  <input
                    aria-label={label}
                    checked={compressionPreset === value}
                    name="compression-preset"
                    onChange={() => setCompressionPreset(value)}
                    type="radio"
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </span>
                </label>
              ))}
              <p className="fidelity-note">
                Lossless only: no image resampling or quality reduction. A smaller file is not
                guaranteed; the original-sized copy is kept when rewriting would add bytes.
              </p>
              <p className="field-hint">
                Changing the preset discards the previous download and stops an unfinished export.
                Create a new export when you are ready; your original stays unchanged.
              </p>
            </fieldset>
          ) : null}

          {active === 'protect' ? (
            <div className="utility-options">
              <div className="segmented-control" aria-label="Protection action">
                <button
                  aria-pressed={mode === 'protect'}
                  onClick={() => {
                    invalidateResult();
                    setMode('protect');
                    setAuthorized(false);
                    setPassword('');
                  }}
                  type="button"
                >
                  Add protection
                </button>
                <button
                  aria-pressed={mode === 'unlock'}
                  onClick={() => {
                    invalidateResult();
                    setMode('unlock');
                    setAuthorized(false);
                    setPassword('');
                  }}
                  type="button"
                >
                  Unlock a copy
                </button>
              </div>
              <label className="field-label">
                {mode === 'protect' ? 'New open password' : 'Current open password'}
                <input
                  autoComplete={mode === 'protect' ? 'new-password' : 'current-password'}
                  onChange={(event) => {
                    invalidateResult();
                    setPassword(event.currentTarget.value);
                  }}
                  spellCheck={false}
                  type="password"
                  value={password}
                />
              </label>
              {mode === 'protect' ? (
                <p className="fidelity-note">
                  AES-256 · 12–127 printable ASCII characters · PDFrig cannot recover this password.
                  Signed, XFA, active, attached, incremental, PDF/A, existing-extension and
                  unsupported string layouts stop without an export. Inspect the saved copy in your
                  reader.
                </p>
              ) : (
                <label className="authorization-check">
                  <input
                    checked={authorized}
                    onChange={(event) => {
                      invalidateResult();
                      setAuthorized(event.currentTarget.checked);
                    }}
                    type="checkbox"
                  />
                  I am authorized to remove this document’s open protection.
                </label>
              )}
              {mode === 'unlock' ? (
                <p className="fidelity-note">
                  Saves an unencrypted copy. Signed, XFA, active, attached, incremental, damaged or
                  unsupported string layouts stop without an export. Inspect the saved copy in your
                  reader; your original stays unchanged.
                </p>
              ) : null}
            </div>
          ) : null}

          {active === 'metadata' ? (
            <div className="metadata-panel">
              <div className="metadata-panel__actions">
                <button
                  className="button button--secondary"
                  disabled={pdfFile === null || state === 'working'}
                  onClick={() => void readMetadata()}
                  type="button"
                >
                  Read metadata
                </button>
                <button
                  className="text-button text-button--danger"
                  disabled={pdfFile === null || state === 'working'}
                  onClick={() => void removeMetadata()}
                  type="button"
                >
                  Remove common + XMP
                </button>
              </div>
              <div className="metadata-grid">
                {(['title', 'author', 'subject', 'keywords', 'creator', 'producer'] as const).map(
                  (key) => (
                    <label className="field-label" key={key}>
                      {key.charAt(0).toUpperCase() + key.slice(1)}
                      <input
                        maxLength={2_000}
                        onChange={(event) =>
                          setMetadata((current) => ({
                            ...current,
                            [key]: event.currentTarget.value,
                          }))
                        }
                        value={metadata[key]}
                      />
                    </label>
                  ),
                )}
              </div>
              <p className="fidelity-note">
                XMP packet:{' '}
                {metadata.hasXmpPacket
                  ? 'present (removed only by “Remove common + XMP”)'
                  : 'not detected'}
                .
              </p>
            </div>
          ) : null}

          {active === 'decorate' ? (
            <DecorationWorkbench {...(createWorker === undefined ? {} : { createWorker })} />
          ) : null}
          {active === 'text' ? (
            <TextPdfWorkbench {...(createWorker === undefined ? {} : { createWorker })} />
          ) : null}
          {active === 'permissions' && enabledFeatures.permissions ? (
            <PermissionWorkbench {...(createWorker === undefined ? {} : { createWorker })} />
          ) : null}

          {active === 'geometry' ? (
            <div className="geometry-panel" onChangeCapture={invalidateGeometry}>
              <div className="segmented-control" aria-label="Page geometry type">
                <button
                  aria-pressed={geometryMode === 'crop'}
                  onClick={() => {
                    invalidateGeometry();
                    setGeometryMode('crop');
                  }}
                  type="button"
                >
                  Crop visible area
                </button>
                <button
                  aria-pressed={geometryMode === 'resize'}
                  onClick={() => {
                    invalidateGeometry();
                    setGeometryMode('resize');
                  }}
                  type="button"
                >
                  Normalize page size
                </button>
              </div>
              <div className="metadata-grid">
                <label className="field-label">
                  First PDF page
                  <input
                    inputMode="numeric"
                    max={500}
                    min={1}
                    onChange={(event) => setGeometryStartPage(event.currentTarget.value)}
                    type="number"
                    value={geometryStartPage}
                  />
                </label>
                <label className="field-label">
                  Last PDF page (optional)
                  <input
                    inputMode="numeric"
                    max={500}
                    min={1}
                    onChange={(event) => setGeometryEndPage(event.currentTarget.value)}
                    placeholder="Last page"
                    type="number"
                    value={geometryEndPage}
                  />
                </label>
                {geometryMode === 'crop' ? (
                  <>
                    <label className="field-label">
                      Top margin (pt)
                      <input
                        inputMode="decimal"
                        max={1440}
                        min={0}
                        onChange={(event) => setGeometryTop(event.currentTarget.value)}
                        step={1}
                        type="number"
                        value={geometryTop}
                      />
                    </label>
                    <label className="field-label">
                      Right margin (pt)
                      <input
                        inputMode="decimal"
                        max={1440}
                        min={0}
                        onChange={(event) => setGeometryRight(event.currentTarget.value)}
                        step={1}
                        type="number"
                        value={geometryRight}
                      />
                    </label>
                    <label className="field-label">
                      Bottom margin (pt)
                      <input
                        inputMode="decimal"
                        max={1440}
                        min={0}
                        onChange={(event) => setGeometryBottom(event.currentTarget.value)}
                        step={1}
                        type="number"
                        value={geometryBottom}
                      />
                    </label>
                    <label className="field-label">
                      Left margin (pt)
                      <input
                        inputMode="decimal"
                        max={1440}
                        min={0}
                        onChange={(event) => setGeometryLeft(event.currentTarget.value)}
                        step={1}
                        type="number"
                        value={geometryLeft}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="field-label">
                      Target size
                      <select
                        onChange={(event) =>
                          setGeometryPreset(
                            event.currentTarget.value as 'a4' | 'custom' | 'legal' | 'letter',
                          )
                        }
                        value={geometryPreset}
                      >
                        <option value="letter">Letter · 8.5 × 11 in</option>
                        <option value="a4">A4 · 210 × 297 mm</option>
                        <option value="legal">Legal · 8.5 × 14 in</option>
                        <option value="custom">Custom points</option>
                      </select>
                    </label>
                    {geometryPreset === 'custom' ? (
                      <>
                        <label className="field-label">
                          Target width (pt)
                          <input
                            inputMode="decimal"
                            max={2000}
                            min={72}
                            onChange={(event) => setGeometryTargetWidth(event.currentTarget.value)}
                            type="number"
                            value={geometryTargetWidth}
                          />
                        </label>
                        <label className="field-label">
                          Target height (pt)
                          <input
                            inputMode="decimal"
                            max={2000}
                            min={72}
                            onChange={(event) => setGeometryTargetHeight(event.currentTarget.value)}
                            type="number"
                            value={geometryTargetHeight}
                          />
                        </label>
                      </>
                    ) : (
                      <label className="field-label">
                        Orientation
                        <select
                          onChange={(event) =>
                            setGeometryOrientation(
                              event.currentTarget.value as 'landscape' | 'portrait',
                            )
                          }
                          value={geometryOrientation}
                        >
                          <option value="portrait">Portrait</option>
                          <option value="landscape">Landscape</option>
                        </select>
                      </label>
                    )}
                    <label className="field-label">
                      Content fit
                      <select
                        onChange={(event) =>
                          setGeometryFit(event.currentTarget.value as 'contain' | 'cover')
                        }
                        value={geometryFit}
                      >
                        <option value="contain">Fit · show the whole page</option>
                        <option value="cover">Fill · cover the target</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
              <p className="field-hint">
                Changing settings discards the previous download and stops an unfinished export.
                Source inspection can finish while you adjust settings. Create a new export when you
                are ready; your original stays unchanged.
              </p>
              <section className="geometry-preview" aria-label="Page geometry preview">
                <div className="geometry-preview__heading">
                  <div>
                    <p className="eyebrow">Measured preview</p>
                    <strong>
                      {geometryPreviewPage === null
                        ? 'Choose a PDF to measure its page boxes.'
                        : `PDF page ${geometryPreviewPage.pageNumber} · ${Math.round(geometryPreviewPage.visibleWidth)} × ${Math.round(geometryPreviewPage.visibleHeight)} pt`}
                    </strong>
                  </div>
                  {geometryInspection === null ? null : (
                    <span>{geometryInspection.pageCount} pages inspected locally</span>
                  )}
                </div>
                {geometryPreviewPage === null || geometryOptions === null ? null : (
                  <div className="geometry-preview__stage">
                    {geometryOptions.kind === 'crop' ? (
                      <>
                        <div
                          aria-label="Current visible page and proposed crop boundary"
                          className="geometry-preview__page geometry-preview__page--source"
                          role="img"
                          style={geometrySourceStyle}
                        >
                          <span className="geometry-preview__page-label">Current visible area</span>
                          <span
                            className="geometry-preview__crop-boundary"
                            style={geometryContentStyle}
                          >
                            New CropBox
                          </span>
                        </div>
                        <p className="geometry-preview__dimensions">
                          Result:{' '}
                          {Math.round(
                            geometryPreviewPage.visibleWidth -
                              geometryOptions.margins.left -
                              geometryOptions.margins.right,
                          )}{' '}
                          ×{' '}
                          {Math.round(
                            geometryPreviewPage.visibleHeight -
                              geometryOptions.margins.top -
                              geometryOptions.margins.bottom,
                          )}{' '}
                          pt
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="geometry-preview__comparison">
                          <div
                            className="geometry-preview__page geometry-preview__page--source"
                            style={geometrySourceStyle}
                          >
                            <span className="geometry-preview__page-label">Source</span>
                          </div>
                          <span aria-hidden="true" className="geometry-preview__arrow">
                            →
                          </span>
                          <div
                            aria-label="Target page with scaled source content"
                            className="geometry-preview__page geometry-preview__page--target"
                            role="img"
                            style={geometryTargetStyle}
                          >
                            <span
                              className="geometry-preview__scaled-content"
                              style={geometryContentStyle}
                            >
                              Source content
                            </span>
                          </div>
                        </div>
                        <p className="geometry-preview__dimensions">
                          Result: {Math.round(geometryOptions.targetWidth)} ×{' '}
                          {Math.round(geometryOptions.targetHeight)} pt ·{' '}
                          {geometryOptions.fit === 'contain'
                            ? 'whole visible page retained'
                            : 'edges may sit outside the visible target'}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </section>
              <p className="fidelity-note fidelity-note--warning">
                {geometryMode === 'crop'
                  ? 'Cropping changes only the visible page boundary. Hidden content remains in the PDF and may be recovered. This is not redaction; use the separately verified redaction workflow for permanent removal.'
                  : geometryFit === 'contain'
                    ? 'Fit scales the whole visible page and may add whitespace. Resize stops on forms, annotations, tags, print-production boxes, unusual page units, signatures, encryption, attachments, XFA, and active content.'
                    : 'Fill scales the page to cover the target and can hide content at the edges without deleting it. Resize stops on forms, annotations, tags, print-production boxes, unusual page units, signatures, encryption, attachments, XFA, and active content.'}
              </p>
            </div>
          ) : null}

          {active === 'number' ? (
            <div className="numbering-panel" onChangeCapture={invalidateResult}>
              <div className="segmented-control" aria-label="Numbering type">
                <button
                  aria-pressed={numberingMode === 'page-labels'}
                  onClick={() => {
                    invalidateResult();
                    setNumberingMode('page-labels');
                  }}
                  type="button"
                >
                  Page labels + numbers
                </button>
                <button
                  aria-pressed={numberingMode === 'bates'}
                  onClick={() => {
                    invalidateResult();
                    setNumberingMode('bates');
                  }}
                  type="button"
                >
                  Bates sequence
                </button>
              </div>
              <div className="metadata-grid">
                <label className="field-label">
                  Prefix (optional)
                  <input
                    maxLength={40}
                    onChange={(event) => setNumberingPrefix(event.currentTarget.value)}
                    value={numberingPrefix}
                  />
                </label>
                {numberingMode === 'bates' ? (
                  <label className="field-label">
                    Suffix (optional)
                    <input
                      maxLength={40}
                      onChange={(event) => setNumberingSuffix(event.currentTarget.value)}
                      value={numberingSuffix}
                    />
                  </label>
                ) : (
                  <label className="field-label">
                    Number style
                    <select
                      onChange={(event) =>
                        setNumberingStyle(event.currentTarget.value as PageLabelStyle)
                      }
                      value={numberingStyle}
                    >
                      <option value="decimal">1, 2, 3</option>
                      <option value="roman-lower">i, ii, iii</option>
                      <option value="roman-upper">I, II, III</option>
                      <option value="letters-lower">a–z, aa, bb</option>
                      <option value="letters-upper">A–Z, AA, BB</option>
                    </select>
                  </label>
                )}
                <label className="field-label">
                  Start number
                  <input
                    inputMode="numeric"
                    max={999_999_999}
                    min={1}
                    onChange={(event) => setNumberingStartNumber(event.currentTarget.value)}
                    type="number"
                    value={numberingStartNumber}
                  />
                </label>
                {numberingMode === 'bates' ? (
                  <label className="field-label">
                    Minimum digits
                    <input
                      inputMode="numeric"
                      max={12}
                      min={3}
                      onChange={(event) => setNumberingDigits(event.currentTarget.value)}
                      type="number"
                      value={numberingDigits}
                    />
                  </label>
                ) : null}
                <label className="field-label">
                  First PDF page
                  <input
                    inputMode="numeric"
                    max={500}
                    min={1}
                    onChange={(event) => setNumberingStartPage(event.currentTarget.value)}
                    type="number"
                    value={numberingStartPage}
                  />
                </label>
                <label className="field-label">
                  Last PDF page (optional)
                  <input
                    inputMode="numeric"
                    max={500}
                    min={1}
                    onChange={(event) => setNumberingEndPage(event.currentTarget.value)}
                    placeholder="Last page"
                    type="number"
                    value={numberingEndPage}
                  />
                </label>
                <label className="field-label">
                  Position
                  <select
                    onChange={(event) =>
                      setNumberingPosition(event.currentTarget.value as NumberingPosition)
                    }
                    value={numberingPosition}
                  >
                    <option value="footer">Footer</option>
                    <option value="header">Header</option>
                  </select>
                </label>
                <label className="field-label">
                  Alignment
                  <select
                    onChange={(event) =>
                      setNumberingAlignment(event.currentTarget.value as DecorationAlignment)
                    }
                    value={numberingAlignment}
                  >
                    <option value="left">Left</option>
                    <option value="center">Centre</option>
                    <option value="right">Right</option>
                  </select>
                </label>
              </div>
              {numberingMode === 'page-labels' ? (
                <label className="authorization-check">
                  <input
                    checked={replaceExistingPageLabels}
                    onChange={(event) => setReplaceExistingPageLabels(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  Replace existing logical page labels if this PDF already has them. Outside the
                  selected range, standard 1-based decimal labels are restored.
                </label>
              ) : null}
              <section className="numbering-preview" aria-label="Numbering preview">
                <p className="eyebrow">Sequence preview</p>
                {numberingPreview.length > 0 ? (
                  <ol>
                    {numberingPreview.map((identifier) => (
                      <li
                        key={identifier}
                        style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}
                      >
                        {identifier}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>{numberingPreviewError}</p>
                )}
              </section>
              <p className="fidelity-note">
                Visible identifiers are marked as PDF artifacts. Page-label mode makes logical
                viewer labels match the visible number; Bates mode preserves existing logical labels
                and produces a local JSON export report. Signed, encrypted, XFA, attached-file, and
                active-content PDFs stop before export. Identifiers that do not fit and unsupported
                page geometry also stop safely. This sequence preview does not check placement;
                inspect the exported copy for overlap with existing content. Alphabetic labels use
                the PDF sequence A–Z, AA–ZZ, AAA–ZZZ. Spaces are literal; line breaks, tabs, and
                control characters are not accepted. When the last page is unknown, the preview
                shows only the next supported identifiers, not the final count. Changing numbering
                settings or the input discards the previous result and stops unfinished numbering.
                Create a new export before downloading again.
              </p>
            </div>
          ) : null}

          {active === 'render' ? (
            <div
              className="utility-options utility-options--row"
              onChangeCapture={invalidateResult}
            >
              <div className="metadata-grid">
                <label className="field-label">
                  PDF page range
                  <input
                    onChange={(event) => setRenderPageRange(event.currentTarget.value)}
                    placeholder="all or 1-3, 5"
                    spellCheck={false}
                    value={renderPageRange}
                  />
                </label>
                <label className="field-label">
                  Resolution
                  <select
                    onChange={(event) =>
                      setImageScale(Number(event.currentTarget.value) as PdfImageScale)
                    }
                    value={imageScale}
                  >
                    <option value="1">Standard · 72 px/in</option>
                    <option value="2">High · 144 px/in</option>
                    <option value="3">Very high · 216 px/in</option>
                  </select>
                </label>
                <label className="field-label">
                  Image format
                  <select
                    onChange={(event) => {
                      const format = event.currentTarget.value as 'jpeg' | 'png';
                      setImageFormat(format);
                      if (format === 'jpeg') setImageTransparentBackground(false);
                    }}
                    value={imageFormat}
                  >
                    <option value="png">PNG · lossless</option>
                    <option value="jpeg">JPEG · smaller photographic files</option>
                  </select>
                </label>
                {imageFormat === 'jpeg' ? (
                  <label className="field-label">
                    JPEG quality
                    <select
                      onChange={(event) =>
                        setImageJpegQuality(
                          Number(event.currentTarget.value) as PdfImageJpegQuality,
                        )
                      }
                      value={imageJpegQuality}
                    >
                      <option value="0.72">Smaller · 72%</option>
                      <option value="0.85">Balanced · 85%</option>
                      <option value="0.92">Highest · 92%</option>
                    </select>
                  </label>
                ) : null}
                <label className="field-label">
                  Password, if required
                  <input
                    autoComplete="off"
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    type="password"
                    value={password}
                  />
                </label>
              </div>
              <label className="authorization-check">
                <input
                  checked={imageTransparentBackground}
                  disabled={imageFormat !== 'png'}
                  onChange={(event) => setImageTransparentBackground(event.currentTarget.checked)}
                  type="checkbox"
                />
                Keep unpainted page areas transparent in PNG output. Page artwork that paints a
                background remains opaque.
              </label>
              <p className="fidelity-note">
                Selected pages are rasterized at the exact resolution above. JPEG always uses a
                white background and has no transparency. Text, links, forms, tags, and vectors are
                not retained in the images. Browser canvas conversion does not preserve PDF print
                colour profiles; inspect colour-critical output. At most 50 selected pages are
                rendered per export; original page numbers are kept in filenames.
              </p>
            </div>
          ) : null}

          {active === 'images' ? (
            <div className="utility-options utility-options--row">
              <label className="field-label">
                Page size
                <select
                  onChange={(event) => setPageSize(event.currentTarget.value as typeof pageSize)}
                  value={pageSize}
                >
                  <option value="image">Match each image</option>
                  <option value="a4">A4 portrait</option>
                  <option value="letter">US Letter portrait</option>
                </select>
              </label>
              <label className="field-label">
                Image fit
                <select
                  onChange={(event) => setFit(event.currentTarget.value as typeof fit)}
                  value={fit}
                >
                  <option value="contain">Contain · no cropping</option>
                  <option value="cover">Cover · may crop edges</option>
                </select>
              </label>
              <p className="fidelity-note">
                Top-left PNG and JPEG pixels are embedded directly. WebP and EXIF-oriented images
                are normalized to PNG after orientation is applied; their image metadata is not
                copied. Cover fit can crop at the page boundary.
              </p>
            </div>
          ) : null}

          {active !== 'decorate' && active !== 'text' && active !== 'permissions' && (
            <>
              <div className={`utility-status utility-status--${state}`} role="status">
                <span aria-hidden="true" className="utility-status__indicator" />
                <span>{message}</span>
              </div>

              <footer className="utility-actions">
                <span>
                  {active === 'blank'
                    ? 'No source file is needed.'
                    : 'No source file is overwritten.'}
                </span>
                {result === null ? (
                  <button
                    className="button button--primary"
                    disabled={!canRun}
                    onClick={() => void run()}
                    type="button"
                  >
                    {state === 'working'
                      ? 'Working…'
                      : active === 'metadata'
                        ? 'Save metadata copy'
                        : 'Create export'}
                  </button>
                ) : (
                  <div className="result-actions">
                    <span>{result.detail}</span>
                    <div className="result-actions__buttons">
                      <button
                        className="button button--primary"
                        onClick={() => download(result)}
                        type="button"
                      >
                        Download new copy
                      </button>
                      {result.numberingReport === undefined ? null : (
                        <button
                          className="button button--secondary"
                          onClick={() =>
                            download({
                              bytes: new TextEncoder().encode(
                                `${JSON.stringify(result.numberingReport, null, 2)}\n`,
                              ),
                              detail: 'Local numbering report',
                              filename: 'pdfmason-numbering-report.json',
                              mimeType: 'application/json',
                            })
                          }
                          type="button"
                        >
                          Download numbering report
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </footer>
            </>
          )}
        </fieldset>

        <aside className="utility-notes" aria-label="Tool safeguards">
          <p className="eyebrow">Safeguards</p>
          <ol>
            <li>
              <strong>Memory only</strong>
              <span>No upload, history, or file telemetry.</span>
            </li>
            <li>
              <strong>Bounded work</strong>
              <span>File, page, image, and pixel limits apply.</span>
            </li>
            <li>
              <strong>Independent output</strong>
              <span>Exports are suitable for qpdf and PDF reader verification.</span>
            </li>
          </ol>
          <div className="beta-note">
            <span>Paid beta · CONV-002–004</span>
            <strong>Office to PDF</strong>
            <p>
              Dedicated cloud worker is disabled by default while font-fidelity and sandbox evidence
              is reviewed.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
};
