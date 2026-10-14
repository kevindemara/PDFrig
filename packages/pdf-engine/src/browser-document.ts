import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

import type { FormFieldType, NormalizedRect, QuarterTurn } from '@pdfmason/editor-core';

export const LOCAL_PDF_LIMITS = Object.freeze({
  maximumAssemblyBytes: 100 * 1024 * 1024,
  maximumBytes: 50 * 1024 * 1024,
  maximumImagePixels: 20_000_000,
  maximumPages: 500,
  maximumSources: 20,
});

export type PdfRiskCode =
  | 'ACTIVE_CONTENT'
  | 'ATTACHMENTS'
  | 'ENCRYPTED'
  | 'FORMS'
  | 'INCREMENTAL_REVISIONS'
  | 'MALFORMED_STRUCTURE'
  | 'OUTLINES'
  | 'SIGNATURES'
  | 'TAGGED_CONTENT'
  | 'XFA';

export interface PdfInspection {
  readonly canAnnotateSafely: boolean;
  readonly canOrganizeSafely: boolean;
  readonly hasAttachments: boolean;
  readonly hasForms: boolean;
  readonly hasJavaScript: boolean;
  readonly hasOutline: boolean;
  readonly hasSignatures: boolean;
  readonly isEncrypted: boolean;
  readonly isPureXfa: boolean;
  readonly isTagged: boolean;
  readonly pageCount: number;
  readonly riskCodes: readonly PdfRiskCode[];
  readonly signatureDetection: PdfSignatureDetection;
}

export type PdfSignatureDetection = 'field-only' | 'none' | 'signature-metadata';

export interface PdfPageMetrics {
  readonly height: number;
  readonly rotation: number;
  readonly width: number;
}

export interface PdfFormField {
  readonly fieldName: string;
  readonly id: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly pageIndex: number;
  readonly readOnly: boolean;
  readonly maximumLength?: number;
  readonly rect: NormalizedRect;
  readonly required: boolean;
  readonly sourceType: string;
  readonly type: FormFieldType;
  readonly value: boolean | string;
}

export interface PdfSearchHit {
  readonly excerpt: string;
  readonly pageIndex: number;
}

export const PDF_OUTLINE_LIMITS = Object.freeze({
  maximumDepth: 8,
  maximumEntries: 200,
  maximumNamedDestinationLength: 512,
  maximumTitleLength: 200,
});

export interface PdfOutlineEntry {
  readonly depth: number;
  readonly id: string;
  readonly pageIndex: number | null;
  readonly title: string;
}

export interface PdfOutlineSnapshot {
  readonly entries: readonly PdfOutlineEntry[];
  readonly truncated: boolean;
}

export const PDF_STRUCTURE_INSPECTION_LIMITS = Object.freeze({
  maximumAttachments: 50,
  maximumDescriptionLength: 500,
  maximumLayerDepth: 8,
  maximumLabelLength: 200,
  maximumLayers: 100,
  maximumRadioGroupMembers: 100,
  maximumRadioGroupsPerLayer: 20,
});

export interface PdfAttachmentMetadata {
  readonly description: string | null;
  readonly id: string;
  readonly name: string;
}

export interface PdfLayerMetadata {
  readonly id: string;
  readonly mutuallyExclusive: boolean;
  readonly name: string;
  readonly path: readonly string[];
  readonly visible: boolean;
}

export interface PdfStructureInspection {
  readonly attachments: readonly PdfAttachmentMetadata[];
  readonly attachmentsTruncated: boolean;
  readonly layerConfigurationName: string | null;
  readonly layers: readonly PdfLayerMetadata[] | null;
  readonly layersTruncated: boolean;
}

const EMPTY_OUTLINE: PdfOutlineSnapshot = Object.freeze({
  entries: Object.freeze([]),
  truncated: false,
});

const normalizeStructureText = (value: unknown, fallback: string, limit: number): string => {
  if (typeof value !== 'string') return fallback;
  const normalized = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return (normalized.length === 0 ? fallback : normalized).slice(0, limit);
};

interface PageReference {
  readonly gen: number;
  readonly num: number;
}

export interface OpenPdfOptions {
  readonly strictParsing?: boolean;
  readonly password?: string;
  readonly wasEncrypted?: boolean;
}

const hasEntries = (value: object | null): boolean =>
  value !== null && Object.keys(value).length > 0;

const containsSignature = (fields: object | null): boolean => {
  if (fields === null) return false;
  return Object.values(fields).some((widgets) => {
    if (!Array.isArray(widgets)) return false;
    return widgets.some((widget: unknown) => {
      if (typeof widget !== 'object' || widget === null) return false;
      const candidate = widget as Record<string, unknown>;
      return candidate.type === 'signature' || candidate.fieldType === 'Sig';
    });
  });
};

type SignatureAnnotationInspection = 'failed' | 'none' | 'signature';

const inspectSignatureAnnotations = async (
  document: PDFDocumentProxy,
): Promise<SignatureAnnotationInspection> => {
  try {
    // PDF.js can omit an orphaned signature widget from both getFieldObjects()
    // and getSignatures(). Inspect the already bounded page set so malformed
    // field-tree membership cannot silently remove the edit warning.
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: 'display' });
      if (!Array.isArray(annotations)) return 'failed';
      for (const annotation of annotations) {
        if (!isRecord(annotation)) return 'failed';
        if (annotation.subtype === 'Widget' && annotation.fieldType === 'Sig') return 'signature';
      }
    }
    return 'none';
  } catch {
    return 'failed';
  }
};

const fieldAnnotationIds = (fields: object | null): ReadonlySet<string> => {
  const ids = new Set<string>();
  if (fields === null) return ids;
  for (const widgets of Object.values(fields)) {
    if (!Array.isArray(widgets)) continue;
    for (const widget of widgets) {
      if (isRecord(widget) && typeof widget.id === 'string') ids.add(widget.id);
    }
  }
  return ids;
};

const containsUnresolvedAnnotationActions = async (
  document: PDFDocumentProxy,
  fields: object | null,
): Promise<boolean> => {
  const knownFieldIds = fieldAnnotationIds(fields);
  try {
    // The signature-widget false positive can only be proven when every page is
    // free of annotation actions. Restricting this scan to signature pages lets
    // an unrelated action elsewhere in the bounded document bypass the lock.
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: 'display' });
      if (!Array.isArray(annotations)) return true;
      for (const annotation of annotations) {
        if (!isRecord(annotation)) return true;
        if (isRecord(annotation.actions) && Object.keys(annotation.actions).length > 0) return true;
        if (annotation.subtype === 'Widget' && annotation.fieldType === 'Sig') continue;
        if (
          annotation.subtype === 'Widget' &&
          typeof annotation.id === 'string' &&
          knownFieldIds.has(annotation.id)
        )
          continue;
        // Some PDF.js annotation classes omit additional actions entirely.
        // With `hasJSActions()` true, an unaccounted-for annotation means the
        // signature-widget false-positive exception cannot be proven.
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
};

const containsFieldActions = (fields: object | null): boolean => {
  if (fields === null) return false;
  return Object.values(fields).some((widgets) => {
    if (!Array.isArray(widgets)) return false;
    return widgets.some((widget: unknown) => {
      if (!isRecord(widget)) return false;
      const actions = widget.actions;
      return isRecord(actions) && Object.keys(actions).length > 0;
    });
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPageReference = (value: unknown): value is PageReference =>
  isRecord(value) &&
  typeof value.num === 'number' &&
  Number.isInteger(value.num) &&
  value.num > 0 &&
  typeof value.gen === 'number' &&
  Number.isInteger(value.gen) &&
  value.gen >= 0;

const normalizeOutlineTitle = (value: unknown): string => {
  if (typeof value !== 'string') return 'Untitled bookmark';
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) return 'Untitled bookmark';
  return normalized.slice(0, PDF_OUTLINE_LIMITS.maximumTitleLength);
};

const isRect = (value: unknown): value is readonly [number, number, number, number] =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));

const toFormType = (type: unknown): FormFieldType | null => {
  if (type === 'text') return 'text';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radiobutton') return 'radio';
  if (type === 'combobox' || type === 'listbox') return 'dropdown';
  return null;
};

export class BrowserPdfDocument {
  readonly #document: PDFDocumentProxy;
  readonly #loadingTask: PDFDocumentLoadingTask;
  readonly #wasEncrypted: boolean;
  #outlinePromise: Promise<PdfOutlineSnapshot> | undefined;
  #structureInspectionPromise: Promise<PdfStructureInspection> | undefined;

  public constructor(
    document: PDFDocumentProxy,
    loadingTask: PDFDocumentLoadingTask,
    wasEncrypted: boolean,
  ) {
    this.#document = document;
    this.#loadingTask = loadingTask;
    this.#wasEncrypted = wasEncrypted;
  }

  public get pageCount(): number {
    return this.#document.numPages;
  }

  public async destroy(): Promise<void> {
    await this.#loadingTask.destroy();
  }

  public async getFormFields(): Promise<readonly PdfFormField[]> {
    const objects = await this.#document.getFieldObjects();
    if (objects === null) return [];
    const fields: PdfFormField[] = [];
    for (const candidates of Object.values(objects)) {
      if (!Array.isArray(candidates)) continue;
      for (const candidateValue of candidates) {
        if (!isRecord(candidateValue)) continue;
        const candidate = candidateValue;
        const type = toFormType(candidate.type);
        if (
          type === null ||
          typeof candidate.id !== 'string' ||
          typeof candidate.name !== 'string' ||
          typeof candidate.page !== 'number' ||
          !Number.isInteger(candidate.page) ||
          candidate.page < 0 ||
          !isRect(candidate.rect) ||
          candidate.hidden === true
        )
          continue;
        const page = await this.#document.getPage(candidate.page + 1);
        const viewport = page.getViewport({ scale: 1 });
        const firstPoint: unknown = viewport.convertToViewportPoint(
          candidate.rect[0],
          candidate.rect[1],
        );
        const secondPoint: unknown = viewport.convertToViewportPoint(
          candidate.rect[2],
          candidate.rect[3],
        );
        if (
          !Array.isArray(firstPoint) ||
          !Array.isArray(secondPoint) ||
          typeof firstPoint[0] !== 'number' ||
          typeof firstPoint[1] !== 'number' ||
          typeof secondPoint[0] !== 'number' ||
          typeof secondPoint[1] !== 'number'
        )
          continue;
        const firstX = firstPoint[0];
        const firstY = firstPoint[1];
        const secondX = secondPoint[0];
        const secondY = secondPoint[1];
        const x = Math.min(firstX, secondX) / viewport.width;
        const y = Math.min(firstY, secondY) / viewport.height;
        const width = Math.abs(secondX - firstX) / viewport.width;
        const height = Math.abs(secondY - firstY) / viewport.height;
        const items = Array.isArray(candidate.items) ? candidate.items : [];
        const options = items.flatMap((item): { label: string; value: string }[] => {
          if (!isRecord(item)) return [];
          const value = typeof item.exportValue === 'string' ? item.exportValue : null;
          if (value === null) return [];
          return [
            {
              label: typeof item.displayValue === 'string' ? item.displayValue : value,
              value,
            },
          ];
        });
        if (type === 'radio' && typeof candidate.exportValues === 'string') {
          options.push({ label: candidate.exportValues, value: candidate.exportValues });
        }
        fields.push(
          Object.freeze({
            fieldName: candidate.name,
            id: candidate.id,
            options: Object.freeze(options),
            pageIndex: candidate.page,
            readOnly: candidate.editable === false,
            ...(typeof candidate.charLimit === 'number' &&
            Number.isInteger(candidate.charLimit) &&
            candidate.charLimit > 0
              ? { maximumLength: candidate.charLimit }
              : {}),
            rect: Object.freeze({ height, width, x, y }),
            required: candidate.required === true,
            sourceType: typeof candidate.type === 'string' ? candidate.type : '',
            type,
            value:
              type === 'checkbox'
                ? candidate.value !== 'Off' && candidate.value !== false
                : typeof candidate.value === 'string'
                  ? candidate.value
                  : '',
          }),
        );
      }
    }
    return Object.freeze(fields);
  }

  public getOutline(): Promise<PdfOutlineSnapshot> {
    this.#outlinePromise ??= this.#readOutline();
    return this.#outlinePromise;
  }

  async #readOutline(): Promise<PdfOutlineSnapshot> {
    const rawOutline: unknown = await this.#document.getOutline();
    if (!Array.isArray(rawOutline)) {
      return EMPTY_OUTLINE;
    }

    const entries: PdfOutlineEntry[] = [];
    let truncated = false;

    const resolvePageIndex = async (destination: unknown): Promise<number | null> => {
      let explicitDestination = destination;
      if (typeof destination === 'string') {
        if (destination.length > PDF_OUTLINE_LIMITS.maximumNamedDestinationLength) return null;
        try {
          explicitDestination = await this.#document.getDestination(destination);
        } catch {
          return null;
        }
      }
      if (!Array.isArray(explicitDestination) || explicitDestination.length === 0) return null;
      const target: unknown = explicitDestination[0];
      if (typeof target === 'number' && Number.isInteger(target)) {
        return target >= 0 && target < this.#document.numPages ? target : null;
      }
      if (!isPageReference(target)) return null;
      try {
        const pageIndex = await this.#document.getPageIndex(target);
        return Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < this.#document.numPages
          ? pageIndex
          : null;
      } catch {
        return null;
      }
    };

    const walk = async (values: readonly unknown[], depth: number, path: string): Promise<void> => {
      for (let index = 0; index < values.length; index += 1) {
        if (entries.length >= PDF_OUTLINE_LIMITS.maximumEntries) {
          truncated = true;
          return;
        }
        const value = values[index];
        if (!isRecord(value)) continue;
        const id = path.length === 0 ? `${index}` : `${path}.${index}`;
        entries.push(
          Object.freeze({
            depth,
            id,
            pageIndex: await resolvePageIndex(value.dest),
            title: normalizeOutlineTitle(value.title),
          }),
        );
        const children = value.items;
        if (!Array.isArray(children) || children.length === 0) continue;
        if (depth + 1 >= PDF_OUTLINE_LIMITS.maximumDepth) {
          truncated = true;
          continue;
        }
        await walk(children, depth + 1, id);
        if (entries.length >= PDF_OUTLINE_LIMITS.maximumEntries) return;
      }
    };

    await walk(rawOutline, 0, '');
    return Object.freeze({ entries: Object.freeze(entries), truncated });
  }

  public getStructureInspection(): Promise<PdfStructureInspection> {
    this.#structureInspectionPromise ??= this.#readStructureInspection();
    return this.#structureInspectionPromise;
  }

  async #readStructureInspection(): Promise<PdfStructureInspection> {
    const [rawAttachments, optionalContentConfig] = await Promise.all([
      this.#document.getAttachments(),
      this.#document.getOptionalContentConfig({ intent: 'display' }).catch(() => null),
    ]);
    const attachments: PdfAttachmentMetadata[] = [];
    if (rawAttachments !== null) {
      let index = 0;
      for (const [, attachmentValue] of rawAttachments) {
        if (attachments.length >= PDF_STRUCTURE_INSPECTION_LIMITS.maximumAttachments) break;
        const attachment: unknown = attachmentValue;
        if (!isRecord(attachment)) continue;
        const description = normalizeStructureText(
          attachment.description,
          '',
          PDF_STRUCTURE_INSPECTION_LIMITS.maximumDescriptionLength,
        );
        attachments.push(
          Object.freeze({
            description: description.length === 0 ? null : description,
            id: `attachment-${index}`,
            name: normalizeStructureText(
              attachment.filename,
              'Unnamed attachment',
              PDF_STRUCTURE_INSPECTION_LIMITS.maximumLabelLength,
            ),
          }),
        );
        index += 1;
      }
    }

    let layers: PdfLayerMetadata[] | null = null;
    let layerConfigurationName: string | null = null;
    let layersTruncated = false;
    if (optionalContentConfig !== null) {
      const configRecord: unknown = optionalContentConfig;
      if (isRecord(configRecord)) {
        const normalizedName = normalizeStructureText(
          configRecord.name,
          '',
          PDF_STRUCTURE_INSPECTION_LIMITS.maximumLabelLength,
        );
        layerConfigurationName = normalizedName.length === 0 ? null : normalizedName;
      }
      try {
        layers = [];
        const entries = optionalContentConfig as unknown as Iterable<readonly [unknown, unknown]>;
        const groups = new Map<string, Record<string, unknown>>();
        for (const [idValue, groupValue] of entries) {
          if (groups.size >= PDF_STRUCTURE_INSPECTION_LIMITS.maximumLayers) {
            layersTruncated = true;
            break;
          }
          if (typeof idValue !== 'string' || !isRecord(groupValue)) continue;
          groups.set(idValue, groupValue);
        }

        const seen = new Set<string>();
        const isMutuallyExclusive = (id: string, group: Record<string, unknown>): boolean => {
          if (!Array.isArray(group.rbGroups)) return false;
          for (let groupIndex = 0; groupIndex < group.rbGroups.length; groupIndex += 1) {
            if (groupIndex >= PDF_STRUCTURE_INSPECTION_LIMITS.maximumRadioGroupsPerLayer) {
              layersTruncated = true;
              break;
            }
            const radioGroup: unknown = group.rbGroups[groupIndex];
            if (!Array.isArray(radioGroup) && !(radioGroup instanceof Set)) continue;
            let includesLayer = false;
            let includesPeer = false;
            let memberIndex = 0;
            for (const member of radioGroup) {
              if (memberIndex >= PDF_STRUCTURE_INSPECTION_LIMITS.maximumRadioGroupMembers) {
                layersTruncated = true;
                break;
              }
              memberIndex += 1;
              if (typeof member !== 'string' || !groups.has(member)) continue;
              if (member === id) includesLayer = true;
              else includesPeer = true;
            }
            if (includesLayer && includesPeer) return true;
          }
          return false;
        };
        const appendLayer = (id: string, path: readonly string[]): void => {
          if (seen.has(id)) return;
          const group = groups.get(id);
          if (group === undefined) return;
          if (layers !== null && layers.length >= PDF_STRUCTURE_INSPECTION_LIMITS.maximumLayers) {
            layersTruncated = true;
            return;
          }
          seen.add(id);
          layers?.push(
            Object.freeze({
              id: id.slice(0, PDF_STRUCTURE_INSPECTION_LIMITS.maximumLabelLength),
              mutuallyExclusive: isMutuallyExclusive(id, group),
              name: normalizeStructureText(
                group.name,
                'Unnamed layer',
                PDF_STRUCTURE_INSPECTION_LIMITS.maximumLabelLength,
              ),
              path: Object.freeze([...path]),
              visible: group.visible === true,
            }),
          );
        };

        const visitedOrders = new WeakSet<object>();
        const walkOrder = (
          values: readonly unknown[],
          path: readonly string[],
          depth: number,
        ): void => {
          if (visitedOrders.has(values)) {
            layersTruncated = true;
            return;
          }
          visitedOrders.add(values);
          for (const value of values) {
            if (typeof value === 'string') {
              appendLayer(value, path);
              continue;
            }
            if (!isRecord(value) || !Array.isArray(value.order)) continue;
            if (depth >= PDF_STRUCTURE_INSPECTION_LIMITS.maximumLayerDepth) {
              layersTruncated = true;
              continue;
            }
            const name = normalizeStructureText(
              value.name,
              'Unnamed group',
              PDF_STRUCTURE_INSPECTION_LIMITS.maximumLabelLength,
            );
            walkOrder(value.order, [...path, name], depth + 1);
          }
        };

        if (isRecord(configRecord) && typeof configRecord.getOrder === 'function') {
          try {
            const order: unknown = Reflect.apply(configRecord.getOrder, optionalContentConfig, []);
            if (Array.isArray(order)) walkOrder(order, [], 0);
          } catch {
            layersTruncated = true;
          }
        }
        for (const id of groups.keys()) {
          appendLayer(id, []);
        }
      } catch {
        layers = null;
        layersTruncated = false;
      }
    }

    return Object.freeze({
      attachments: Object.freeze(attachments),
      attachmentsTruncated:
        rawAttachments !== null &&
        rawAttachments.size > PDF_STRUCTURE_INSPECTION_LIMITS.maximumAttachments,
      layerConfigurationName,
      layers: layers === null ? null : Object.freeze(layers),
      layersTruncated,
    });
  }

  public async getPageMetrics(
    pageIndex: number,
    rotationOffset: QuarterTurn = 0,
  ): Promise<PdfPageMetrics> {
    const page = await this.#document.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1, rotation: page.rotate + rotationOffset });
    return { height: viewport.height, rotation: viewport.rotation, width: viewport.width };
  }

  public async inspect(): Promise<PdfInspection> {
    const [structure, fields, javaScript, hasFieldActions, signatures, markInfo, outline] =
      await Promise.all([
        this.getStructureInspection(),
        this.#document.getFieldObjects(),
        this.#document.getJSActions(),
        this.#document.hasJSActions(),
        this.#document.getSignatures().catch(() => undefined),
        this.#document.getMarkInfo(),
        this.getOutline().catch(() => EMPTY_OUTLINE),
      ]);
    const hasAttachments = structure.attachments.length > 0;
    const hasSignatureFields = containsSignature(fields);
    const signatureInspectionFailed = signatures === undefined;
    const hasSignatureMetadata = (signatures?.length ?? 0) > 0;
    const signatureAnnotationInspection =
      hasSignatureFields || hasSignatureMetadata || signatureInspectionFailed
        ? 'none'
        : await inspectSignatureAnnotations(this.#document);
    const hasSignatureAnnotation = signatureAnnotationInspection === 'signature';
    const hasMalformedSignatureAnnotationBoundary = signatureAnnotationInspection !== 'none';
    const hasForms = hasEntries(fields) || hasSignatureAnnotation;
    const hasExplicitFieldActions = containsFieldActions(fields);
    const hasUnresolvedAnnotationActions =
      hasFieldActions && hasSignatureFields && !hasExplicitFieldActions
        ? await containsUnresolvedAnnotationActions(this.#document, fields)
        : false;
    // PDF.js reports `hasJSActions()` for signature widgets that omit an
    // `actions` member. Inspect every page in the already bounded document to
    // prove the exception; any explicit action or inspection failure stays locked.
    const hasJavaScript =
      hasEntries(javaScript) ||
      hasExplicitFieldActions ||
      (hasFieldActions && (!hasSignatureFields || hasUnresolvedAnnotationActions));
    const hasSignatures =
      hasSignatureFields ||
      hasSignatureMetadata ||
      signatureInspectionFailed ||
      hasSignatureAnnotation;
    const signatureDetection: PdfSignatureDetection = hasSignatureMetadata
      ? 'signature-metadata'
      : hasSignatureFields || signatureInspectionFailed || hasSignatureAnnotation
        ? 'field-only'
        : 'none';
    const isTagged = markInfo?.Marked === true;
    const hasOutline = outline.entries.length > 0;
    const risks: PdfRiskCode[] = [];
    if (hasJavaScript) risks.push('ACTIVE_CONTENT');
    if (hasAttachments) risks.push('ATTACHMENTS');
    if (this.#wasEncrypted) risks.push('ENCRYPTED');
    if (hasForms) risks.push('FORMS');
    if (hasMalformedSignatureAnnotationBoundary) risks.push('MALFORMED_STRUCTURE');
    if (hasOutline) risks.push('OUTLINES');
    if (hasSignatures) risks.push('SIGNATURES');
    if (isTagged) risks.push('TAGGED_CONTENT');
    if (this.#document.isPureXfa) risks.push('XFA');
    return Object.freeze({
      // Direct export verifies bookmarks, the tag graph and original content streams.
      // Page assembly cannot remap destinations or tagged reading-order references.
      canAnnotateSafely: risks.every(
        (risk) => risk === 'FORMS' || risk === 'OUTLINES' || risk === 'TAGGED_CONTENT',
      ),
      canOrganizeSafely: risks.length === 0,
      hasAttachments,
      hasForms,
      hasJavaScript,
      hasOutline,
      hasSignatures,
      isEncrypted: this.#wasEncrypted,
      isPureXfa: this.#document.isPureXfa,
      isTagged,
      pageCount: this.#document.numPages,
      riskCodes: Object.freeze(risks),
      signatureDetection,
    });
  }

  public async renderPage(
    canvas: HTMLCanvasElement,
    pageIndex: number,
    scale: number,
    rotationOffset: QuarterTurn = 0,
    pixelRatioOverride?: 1,
    background: 'opaque' | 'transparent' = 'opaque',
    signal?: AbortSignal,
  ): Promise<RenderTask> {
    const page = await this.#document.getPage(pageIndex + 1);
    if (signal?.aborted) throw new Error('RENDER_CANCELLED');
    const viewport = page.getViewport({ scale, rotation: page.rotate + rotationOffset });
    const pixelRatio = pixelRatioOverride ?? Math.min(globalThis.devicePixelRatio, 2);
    canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const context = canvas.getContext('2d', { alpha: background === 'transparent' });
    if (context === null) throw new Error('Canvas rendering is unavailable.');
    const renderTask = page.render({
      canvas,
      canvasContext: context,
      transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      viewport,
      background: background === 'opaque' ? 'rgb(255,255,255)' : 'rgba(0,0,0,0)',
    });
    const cancel = (): void => renderTask.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await renderTask.promise;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    return renderTask;
  }

  public async renderSelectableText(
    container: HTMLElement,
    pageIndex: number,
    scale: number,
    rotationOffset: QuarterTurn,
    signal: AbortSignal,
  ): Promise<'ready' | 'empty' | 'restricted' | 'limited' | 'cancelled'> {
    // AbortSignal is mutable across awaits; do not carry TypeScript's previous
    // property narrowing into a later lifecycle boundary.
    const isCancelled = (): boolean => signal.aborted;
    const permissions = await this.#document.getPermissions();
    if (isCancelled()) return 'cancelled';
    const { TextLayer, PermissionFlag } = await import('pdfjs-dist/webpack.mjs');
    if (isCancelled()) return 'cancelled';
    if (permissions !== null && !permissions.includes(PermissionFlag.COPY)) return 'restricted';
    const page = await this.#document.getPage(pageIndex + 1);
    if (isCancelled()) return 'cancelled';
    const content = await page.getTextContent();
    if (isCancelled()) return 'cancelled';
    if (
      content.items.length > 10_000 ||
      content.items.reduce((count, item) => count + ('str' in item ? item.str.length : 0), 0) >
        1_000_000
    )
      return 'limited';
    if (!content.items.some((item) => 'str' in item && item.str.length > 0)) return 'empty';
    const rotation = (((page.rotate + rotationOffset) % 360) + 360) % 360;
    const viewport = page.getViewport({ scale, rotation });
    container.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
    container.style.setProperty('--scale-round-x', '1px');
    container.style.setProperty('--scale-round-y', '1px');
    container.style.transform =
      viewport.rotation === 90
        ? 'rotate(90deg) translateY(-100%)'
        : viewport.rotation === 180
          ? 'rotate(180deg) translate(-100%, -100%)'
          : viewport.rotation === 270
            ? 'rotate(270deg) translateX(-100%)'
            : '';
    const layer = new TextLayer({ container, textContentSource: content, viewport });
    const cancel = (): void => layer.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await layer.render();
    } finally {
      signal.removeEventListener('abort', cancel);
    }
    return isCancelled() ? 'cancelled' : 'ready';
  }

  public async search(query: string): Promise<readonly PdfSearchHit[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length === 0) return [];
    const hits: PdfSearchHit[] = [];
    for (let pageNumber = 1; pageNumber <= this.#document.numPages; pageNumber += 1) {
      const page = await this.#document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .filter((item): item is typeof item & { readonly str: string } => 'str' in item)
        .map((item) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const matchIndex = text.toLocaleLowerCase().indexOf(needle);
      if (matchIndex >= 0) {
        const start = Math.max(0, matchIndex - 34);
        hits.push({ excerpt: text.slice(start, start + 92), pageIndex: pageNumber - 1 });
      }
    }
    return Object.freeze(hits);
  }
}

export const openBrowserPdf = async (
  bytes: Uint8Array,
  options: OpenPdfOptions = {},
): Promise<BrowserPdfDocument> => {
  if (bytes.byteLength > LOCAL_PDF_LIMITS.maximumBytes) {
    throw new Error('LIMIT_BYTES');
  }
  const firstBytes = new TextDecoder('ascii').decode(bytes.subarray(0, 5));
  if (firstBytes !== '%PDF-') throw new Error('NOT_PDF');
  const { getDocument } = await import('pdfjs-dist/webpack.mjs');
  const task = getDocument({
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
    data: bytes.slice(),
    enableXfa: false,
    maxImageSize: LOCAL_PDF_LIMITS.maximumImagePixels,
    password: options.password,
    stopAtErrors: options.strictParsing ?? false,
    useWasm: false,
    verbosity: 0,
  });
  const document = await task.promise.catch(async (error: unknown) => {
    await task.destroy().catch(() => undefined);
    throw error;
  });
  if (document.numPages > LOCAL_PDF_LIMITS.maximumPages) {
    await task.destroy();
    throw new Error('LIMIT_PAGES');
  }
  return new BrowserPdfDocument(
    document,
    task,
    options.wasEncrypted ?? options.password !== undefined,
  );
};
