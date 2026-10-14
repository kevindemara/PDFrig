import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';

import {
  BrowserPdfDocument,
  PDF_OUTLINE_LIMITS,
  PDF_STRUCTURE_INSPECTION_LIMITS,
} from './browser-document.js';

const makeDocument = (overrides: Partial<PDFDocumentProxy> = {}): BrowserPdfDocument => {
  const proxy = {
    getAttachments: vi.fn(() => Promise.resolve(null)),
    getDestination: vi.fn(() => Promise.resolve(null)),
    getOptionalContentConfig: vi.fn(() => Promise.resolve([])),
    getOutline: vi.fn(() => Promise.resolve([])),
    getPage: vi.fn(() =>
      Promise.resolve({ getAnnotations: vi.fn(() => Promise.resolve([])) }),
    ) as unknown as PDFDocumentProxy['getPage'],
    getPageIndex: vi.fn(() => Promise.resolve(0)),
    getSignatures: vi.fn(() => Promise.resolve(null)),
    numPages: 3,
    ...overrides,
  } as unknown as PDFDocumentProxy;
  const loadingTask = {
    destroy: vi.fn(() => Promise.resolve()),
  } as unknown as PDFDocumentLoadingTask;
  return new BrowserPdfDocument(proxy, loadingTask, false);
};

describe('FORM-003 field length boundary', () => {
  it('retains positive PDF.js character limits without coercion', async () => {
    const document = makeDocument({
      getFieldObjects: vi.fn(() =>
        Promise.resolve({
          name: [3, 0, -1, '3'].map((charLimit, index) => ({
            id: `field-${index}`,
            name: `name-${index}`,
            page: 0,
            rect: [0, 0, 10, 10],
            type: 'text',
            value: '',
            charLimit,
          })),
        }),
      ),
      getPage: vi.fn(() =>
        Promise.resolve({
          getViewport: () => ({
            width: 100,
            height: 100,
            convertToViewportPoint: (x: number, y: number) => [x, y],
          }),
        }),
      ) as unknown as PDFDocumentProxy['getPage'],
    });
    const fields = await document.getFormFields();
    expect(fields.map(({ maximumLength }) => maximumLength)).toEqual([
      3,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('VIEW-006 bounded document outlines', () => {
  it.each([false, true])(
    'allows tagged annotations with bookmarks=%s but not page assembly',
    async (outline) => {
      const document = makeDocument({
        getFieldObjects: vi.fn(() => Promise.resolve(null)),
        getJSActions: vi.fn(() => Promise.resolve(null)),
        getMarkInfo: vi.fn(() =>
          Promise.resolve({ Marked: true, Suspects: false, UserProperties: false }),
        ),
        getOutline: vi.fn(() =>
          Promise.resolve(outline ? [{ title: 'Synthetic', dest: [0], items: [] }] : []),
        ) as unknown as PDFDocumentProxy['getOutline'],
        hasJSActions: vi.fn(() => Promise.resolve(false)),
        isPureXfa: false,
      });
      await expect(document.inspect()).resolves.toMatchObject({
        canAnnotateSafely: true,
        canOrganizeSafely: false,
        isTagged: true,
        riskCodes: outline ? ['OUTLINES', 'TAGGED_CONTENT'] : ['TAGGED_CONTENT'],
      });
    },
  );
  it.each([false, true])(
    'allows direct annotations with bookmarks (forms=%s), not organizing',
    async (forms) => {
      const document = makeDocument({
        getFieldObjects: vi.fn(() =>
          Promise.resolve(forms ? { name: [{ type: 'text' }] } : null),
        ) as unknown as PDFDocumentProxy['getFieldObjects'],
        getJSActions: vi.fn(() => Promise.resolve(null)),
        getMarkInfo: vi.fn(() => Promise.resolve(null)),
        getOutline: vi.fn(() =>
          Promise.resolve([{ title: 'Synthetic', dest: [0], items: [] }]),
        ) as unknown as PDFDocumentProxy['getOutline'],
        hasJSActions: vi.fn(() => Promise.resolve(false)),
        isPureXfa: false,
      });
      await expect(document.inspect()).resolves.toMatchObject({
        canAnnotateSafely: true,
        canOrganizeSafely: false,
        hasOutline: true,
        riskCodes: forms ? ['FORMS', 'OUTLINES'] : ['OUTLINES'],
      });
    },
  );

  it.each([false, true])(
    'bookmarks/tags never override an active-content lock (tagged=%s)',
    async (tagged) => {
      const document = makeDocument({
        getFieldObjects: vi.fn(() => Promise.resolve(null)),
        getJSActions: vi.fn(() =>
          Promise.resolve({ OpenAction: ['sensitive-canary'] }),
        ) as unknown as PDFDocumentProxy['getJSActions'],
        getMarkInfo: vi.fn(() =>
          Promise.resolve(tagged ? { Marked: true, Suspects: false, UserProperties: false } : null),
        ),
        getOutline: vi.fn(() =>
          Promise.resolve([{ title: 'Synthetic', dest: [0], items: [] }]),
        ) as unknown as PDFDocumentProxy['getOutline'],
        hasJSActions: vi.fn(() => Promise.resolve(false)),
        isPureXfa: false,
      });
      const inspection = await document.inspect();
      expect(inspection).toMatchObject({
        canAnnotateSafely: false,
        canOrganizeSafely: false,
        riskCodes: tagged
          ? ['ACTIVE_CONTENT', 'OUTLINES', 'TAGGED_CONTENT']
          : ['ACTIVE_CONTENT', 'OUTLINES'],
      });
      expect(JSON.stringify(inspection)).not.toContain('sensitive-canary');
    },
  );

  it('flattens nested entries and resolves direct, named, and referenced destinations', async () => {
    const document = makeDocument({
      getDestination: vi.fn((name: string) => Promise.resolve(name === 'chapter-two' ? [1] : null)),
      getOutline: vi.fn(() =>
        Promise.resolve([
          {
            title: '  Chapter   one  ',
            dest: [{ num: 10, gen: 0 }],
            items: [{ title: 'Section', dest: 'chapter-two', items: [] }],
          },
          { title: '', dest: [2], items: [] },
        ]),
      ) as unknown as PDFDocumentProxy['getOutline'],
      getPageIndex: vi.fn(() => Promise.resolve(0)),
    });

    await expect(document.getOutline()).resolves.toEqual({
      entries: [
        { depth: 0, id: '0', pageIndex: 0, title: 'Chapter one' },
        { depth: 1, id: '0.0', pageIndex: 1, title: 'Section' },
        { depth: 0, id: '1', pageIndex: 2, title: 'Untitled bookmark' },
      ],
      truncated: false,
    });
  });

  it('never exposes or follows action-only, malformed, or failed destinations', async () => {
    const document = makeDocument({
      getDestination: vi.fn(() => Promise.reject(new Error('sensitive destination detail'))),
      getOutline: vi.fn(() =>
        Promise.resolve([
          { title: 'External action', url: 'https://example.invalid/private', items: [] },
          { title: 'Missing named target', dest: 'missing', items: [] },
          { title: 'Bad page', dest: [99], items: [] },
        ]),
      ) as unknown as PDFDocumentProxy['getOutline'],
    });

    const result = await document.getOutline();
    expect(result.entries.map(({ pageIndex }) => pageIndex)).toEqual([null, null, null]);
    expect(JSON.stringify(result)).not.toContain('example.invalid');
    expect(JSON.stringify(result)).not.toContain('sensitive destination detail');
  });

  it('isolates a top-level outline parse failure from document inspection', async () => {
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() => Promise.resolve(null)),
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      getOutline: vi.fn(() => Promise.reject(new Error('malformed outline detail'))),
      hasJSActions: vi.fn(() => Promise.resolve(false)),
      isPureXfa: false,
    });

    await expect(document.inspect()).resolves.toMatchObject({ hasOutline: false, pageCount: 3 });
    await expect(document.getOutline()).rejects.toThrow('malformed outline detail');
  });

  it('caps untrusted outline breadth and depth', async () => {
    const deep = { title: 'Deep', dest: [0], items: [] as unknown[] };
    let cursor = deep;
    for (let depth = 0; depth < PDF_OUTLINE_LIMITS.maximumDepth + 2; depth += 1) {
      const child = { title: `Depth ${depth}`, dest: [0], items: [] as unknown[] };
      cursor.items = [child];
      cursor = child;
    }
    const wide = Array.from({ length: PDF_OUTLINE_LIMITS.maximumEntries + 5 }, (_, index) => ({
      title: `Entry ${index}`,
      dest: [0],
      items: [],
    }));
    const document = makeDocument({
      getOutline: vi.fn(() =>
        Promise.resolve([deep, ...wide]),
      ) as unknown as PDFDocumentProxy['getOutline'],
    });

    const result = await document.getOutline();
    expect(result.entries).toHaveLength(PDF_OUTLINE_LIMITS.maximumEntries);
    expect(Math.max(...result.entries.map(({ depth }) => depth))).toBe(
      PDF_OUTLINE_LIMITS.maximumDepth - 1,
    );
    expect(result.truncated).toBe(true);
  });
});

describe('VIEW-007 bounded attachment and layer inspection', () => {
  it('returns metadata and visibility without exposing embedded bytes or raw paths', async () => {
    const secret = 'never expose attachment payload';
    const document = makeDocument({
      getAttachments: vi.fn(() =>
        Promise.resolve(
          new Map([
            [
              'catalog-secret-id',
              {
                content: new TextEncoder().encode(secret),
                description: '  Local   review note  ',
                filename: 'synthetic-note.txt',
                rawFilename: 'C:\\private\\synthetic-note.txt',
              },
            ],
          ]),
        ),
      ),
      getOptionalContentConfig: vi.fn(() => {
        const groups = Object.assign(
          new Map([
            [
              'ocg-visible',
              {
                name: '  Review   layer ',
                rbGroups: [new Set(['ocg-visible', 'ocg-hidden'])],
                visible: true,
              },
            ],
            [
              'ocg-hidden',
              {
                name: 'Hidden layer',
                rbGroups: [new Set(['ocg-visible', 'ocg-hidden'])],
                visible: false,
              },
            ],
          ]),
          {
            creator: 'private creator metadata',
            name: '  Synthetic   display configuration  ',
          },
        );
        return Promise.resolve(groups);
      }) as unknown as PDFDocumentProxy['getOptionalContentConfig'],
    });

    const result = await document.getStructureInspection();
    expect(result).toEqual({
      attachments: [
        {
          description: 'Local review note',
          id: 'attachment-0',
          name: 'synthetic-note.txt',
        },
      ],
      attachmentsTruncated: false,
      layerConfigurationName: 'Synthetic display configuration',
      layers: [
        {
          id: 'ocg-visible',
          mutuallyExclusive: true,
          name: 'Review layer',
          path: [],
          visible: true,
        },
        {
          id: 'ocg-hidden',
          mutuallyExclusive: true,
          name: 'Hidden layer',
          path: [],
          visible: false,
        },
      ],
      layersTruncated: false,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('C:\\private');
    expect(JSON.stringify(result)).not.toContain('catalog-secret-id');
    expect(JSON.stringify(result)).not.toContain('private creator metadata');
  });

  it('bounds untrusted counts and text while isolating unavailable layer metadata', async () => {
    const attachments = new Map(
      Array.from({ length: PDF_STRUCTURE_INSPECTION_LIMITS.maximumAttachments + 2 }, (_, index) => [
        `raw-${index}`,
        {
          description: 'd'.repeat(PDF_STRUCTURE_INSPECTION_LIMITS.maximumDescriptionLength + 5),
          filename: 'n'.repeat(PDF_STRUCTURE_INSPECTION_LIMITS.maximumLabelLength + 5),
          rawFilename: '',
        },
      ]),
    );
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(attachments)),
      getOptionalContentConfig: vi.fn(() => Promise.reject(new Error('private parse detail'))),
    });

    const result = await document.getStructureInspection();
    expect(result.attachments).toHaveLength(PDF_STRUCTURE_INSPECTION_LIMITS.maximumAttachments);
    expect(result.attachments[0]?.name).toHaveLength(
      PDF_STRUCTURE_INSPECTION_LIMITS.maximumLabelLength,
    );
    expect(result.attachments[0]?.description).toHaveLength(
      PDF_STRUCTURE_INSPECTION_LIMITS.maximumDescriptionLength,
    );
    expect(result.attachmentsTruncated).toBe(true);
    expect(result.layers).toBeNull();
    expect(result.layerConfigurationName).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private parse detail');

    const malformedIterator = makeDocument({
      getOptionalContentConfig: vi.fn(() =>
        Promise.resolve({
          [Symbol.iterator](): Iterator<readonly [unknown, unknown]> {
            throw new Error('private iterator detail');
          },
        }),
      ) as unknown as PDFDocumentProxy['getOptionalContentConfig'],
    });
    const malformedResult = await malformedIterator.getStructureInspection();
    expect(malformedResult.layers).toBeNull();
    expect(JSON.stringify(malformedResult)).not.toContain('private iterator detail');
  });

  it('reuses the sanitized snapshot for security inspection', async () => {
    const getAttachments = vi.fn(() =>
      Promise.resolve(
        new Map([['one', { description: '', filename: 'note.txt', rawFilename: 'secret/path' }]]),
      ),
    );
    const document = makeDocument({
      getAttachments,
      getFieldObjects: vi.fn(() => Promise.resolve(null)),
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      hasJSActions: vi.fn(() => Promise.resolve(false)),
      isPureXfa: false,
    });

    await expect(document.inspect()).resolves.toMatchObject({ hasAttachments: true });
    await document.getStructureInspection();
    expect(getAttachments).toHaveBeenCalledTimes(1);
  });

  it('preserves bounded nested layer order and appends unordered groups safely', async () => {
    const groups = new Map([
      ['first', { name: 'First layer', visible: true }],
      ['second', { name: 'Second layer', visible: false }],
      ['unordered', { name: 'Unordered layer', visible: true }],
    ]);
    const orderedConfig = {
      [Symbol.iterator]: () => groups[Symbol.iterator](),
      getOrder: () => [
        {
          name: '  Review   controls ',
          order: ['second', { name: 'Nested', order: ['first', 'second'] }],
        },
      ],
    };
    const document = makeDocument({
      getOptionalContentConfig: vi.fn(() =>
        Promise.resolve(orderedConfig),
      ) as unknown as PDFDocumentProxy['getOptionalContentConfig'],
    });

    await expect(document.getStructureInspection()).resolves.toMatchObject({
      layers: [
        {
          id: 'second',
          mutuallyExclusive: false,
          name: 'Second layer',
          path: ['Review controls'],
          visible: false,
        },
        {
          id: 'first',
          mutuallyExclusive: false,
          name: 'First layer',
          path: ['Review controls', 'Nested'],
          visible: true,
        },
        {
          id: 'unordered',
          mutuallyExclusive: false,
          name: 'Unordered layer',
          path: [],
          visible: true,
        },
      ],
      layersTruncated: false,
    });
  });

  it('caps layer breadth and cycles without leaking parser details', async () => {
    const groups = new Map(
      Array.from({ length: PDF_STRUCTURE_INSPECTION_LIMITS.maximumLayers + 2 }, (_, index) => [
        `layer-${index}`,
        { name: `Layer ${index}`, visible: true },
      ]),
    );
    const cyclicOrder: unknown[] = ['layer-0'];
    cyclicOrder.push({ name: 'Cycle', order: cyclicOrder, privateDetail: 'do not expose' });
    const document = makeDocument({
      getOptionalContentConfig: vi.fn(() =>
        Promise.resolve({
          [Symbol.iterator]: () => groups[Symbol.iterator](),
          getOrder: () => cyclicOrder,
        }),
      ) as unknown as PDFDocumentProxy['getOptionalContentConfig'],
    });

    const result = await document.getStructureInspection();
    expect(result.layers).toHaveLength(PDF_STRUCTURE_INSPECTION_LIMITS.maximumLayers);
    expect(result.layersTruncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain('do not expose');
  });

  it('bounds malformed radio-group metadata and reports incomplete semantics', async () => {
    const oversizedRadioGroup = Array.from(
      { length: PDF_STRUCTURE_INSPECTION_LIMITS.maximumRadioGroupMembers + 1 },
      (_, index) => `layer-${index}`,
    );
    const groups = new Map([
      [
        'layer-0',
        {
          name: 'Bounded choice',
          rbGroups: [new Set(oversizedRadioGroup)],
          visible: true,
        },
      ],
      ['layer-1', { name: 'Peer choice', visible: false }],
    ]);
    const document = makeDocument({
      getOptionalContentConfig: vi.fn(() =>
        Promise.resolve({ [Symbol.iterator]: () => groups[Symbol.iterator]() }),
      ) as unknown as PDFDocumentProxy['getOptionalContentConfig'],
    });

    await expect(document.getStructureInspection()).resolves.toMatchObject({
      layers: [
        { id: 'layer-0', mutuallyExclusive: true },
        { id: 'layer-1', mutuallyExclusive: false },
      ],
      layersTruncated: true,
    });

    const outerBoundGroups = new Map([
      [
        'only-layer',
        {
          name: 'Outer bound',
          rbGroups: Array.from(
            { length: PDF_STRUCTURE_INSPECTION_LIMITS.maximumRadioGroupsPerLayer + 1 },
            () => new Set(['unknown-layer']),
          ),
          visible: true,
        },
      ],
    ]);
    const outerBoundDocument = makeDocument({
      getOptionalContentConfig: vi.fn(() =>
        Promise.resolve({ [Symbol.iterator]: () => outerBoundGroups[Symbol.iterator]() }),
      ) as unknown as PDFDocumentProxy['getOptionalContentConfig'],
    });
    await expect(outerBoundDocument.getStructureInspection()).resolves.toMatchObject({
      layers: [{ id: 'only-layer', mutuallyExclusive: false }],
      layersTruncated: true,
    });
  });
});

describe('SEC-007 signature-field inspection', () => {
  it('reports no signature state for an ordinary document', async () => {
    const result = await makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() => Promise.resolve(null)),
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      hasJSActions: vi.fn(() => Promise.resolve(false)),
      isPureXfa: false,
    }).inspect();

    expect(result).toMatchObject({
      hasSignatures: false,
      signatureDetection: 'none',
    });
  });

  it('detects an orphaned signature widget outside the AcroForm field tree', async () => {
    const getPage = vi.fn((pageNumber: number) =>
      Promise.resolve({
        getAnnotations: vi.fn(() =>
          Promise.resolve(
            pageNumber === 2
              ? [{ fieldType: 'Sig', id: 'orphan-signature', subtype: 'Widget' }]
              : [],
          ),
        ),
      }),
    ) as unknown as PDFDocumentProxy['getPage'];
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() => Promise.resolve(null)),
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      getPage,
      hasJSActions: vi.fn(() => Promise.resolve(false)),
      isPureXfa: false,
      numPages: 3,
    });

    await expect(document.inspect()).resolves.toMatchObject({
      canAnnotateSafely: false,
      hasForms: true,
      hasSignatures: true,
      riskCodes: ['FORMS', 'MALFORMED_STRUCTURE', 'SIGNATURES'],
      signatureDetection: 'field-only',
    });
    expect(getPage).toHaveBeenNthCalledWith(1, 1);
    expect(getPage).toHaveBeenNthCalledWith(2, 2);
    expect(getPage).toHaveBeenCalledTimes(2);
  });

  it('fails closed without inventing a signature when orphan-widget inspection fails', async () => {
    const parserCanary = 'sensitive-orphan-widget-parser-detail';
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() => Promise.resolve(null)),
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      getPage: vi.fn(() => Promise.reject(new Error(parserCanary))),
      hasJSActions: vi.fn(() => Promise.resolve(false)),
      isPureXfa: false,
    });

    const result = await document.inspect();
    expect(result).toMatchObject({
      canAnnotateSafely: false,
      hasForms: false,
      hasSignatures: false,
      riskCodes: ['MALFORMED_STRUCTURE'],
      signatureDetection: 'none',
    });
    expect(JSON.stringify(result)).not.toContain(parserCanary);
  });

  it('reports a signature field without claiming cryptographic validity', async () => {
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() =>
        Promise.resolve({
          'synthetic.signature-field': [{ id: 'field-1', page: 0, type: 'signature', value: null }],
        }),
      ) as unknown as PDFDocumentProxy['getFieldObjects'],
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      hasJSActions: vi.fn(() => Promise.resolve(true)),
      isPureXfa: false,
    });

    const result = await document.inspect();
    expect(result).toMatchObject({
      hasJavaScript: false,
      hasSignatures: true,
      riskCodes: ['FORMS', 'SIGNATURES'],
      signatureDetection: 'field-only',
    });
    expect(JSON.stringify(result)).not.toMatch(/valid|certificate|signer/iu);
  });

  it('reports recognized signature metadata without returning its sensitive fields', async () => {
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() => Promise.resolve(null)),
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      getSignatures: vi.fn(() =>
        Promise.resolve([
          {
            name: 'sensitive-signer-canary',
            reason: 'sensitive-reason-canary',
          },
        ]),
      ) as unknown as PDFDocumentProxy['getSignatures'],
      hasJSActions: vi.fn(() => Promise.resolve(false)),
      isPureXfa: false,
    });

    const result = await document.inspect();
    expect(result).toMatchObject({
      hasSignatures: true,
      riskCodes: ['SIGNATURES'],
      signatureDetection: 'signature-metadata',
    });
    expect(JSON.stringify(result)).not.toMatch(/sensitive|signer|reason/iu);
  });

  it('keeps malformed signature metadata content-free when extraction fails', async () => {
    const parserCanary = 'sensitive-malformed-signature-parser-detail';
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() => Promise.resolve(null)),
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      getSignatures: vi.fn(() => Promise.reject(new Error(parserCanary))),
      hasJSActions: vi.fn(() => Promise.resolve(false)),
      isPureXfa: false,
    });

    const result = await document.inspect();
    expect(result).toMatchObject({
      hasJavaScript: false,
      hasForms: false,
      hasSignatures: true,
      riskCodes: ['SIGNATURES'],
      signatureDetection: 'field-only',
    });
    expect(JSON.stringify(result)).not.toContain(parserCanary);
  });

  it('does not let signature handling hide an explicit field action', async () => {
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() =>
        Promise.resolve({
          signature: [
            {
              actions: { 'Mouse Up': ['app.alert("synthetic")'] },
              id: 'field-1',
              type: 'signature',
              value: null,
            },
          ],
        }),
      ) as unknown as PDFDocumentProxy['getFieldObjects'],
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      hasJSActions: vi.fn(() => Promise.resolve(true)),
      isPureXfa: false,
    });

    await expect(document.inspect()).resolves.toMatchObject({
      hasJavaScript: true,
      riskCodes: ['ACTIVE_CONTENT', 'FORMS', 'SIGNATURES'],
    });
  });

  it('fails closed when a signature annotation action is omitted from field objects', async () => {
    const actionCanary = 'sensitive-signature-action-canary';
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() =>
        Promise.resolve({
          signature: [{ id: 'field-1', page: 0, type: 'signature', value: null }],
        }),
      ) as unknown as PDFDocumentProxy['getFieldObjects'],
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      getPage: vi.fn(() =>
        Promise.resolve({
          getAnnotations: vi.fn(() =>
            Promise.resolve([{ actions: { 'Mouse Up': [actionCanary] } }]),
          ),
        }),
      ) as unknown as PDFDocumentProxy['getPage'],
      hasJSActions: vi.fn(() => Promise.resolve(true)),
      isPureXfa: false,
    });

    const result = await document.inspect();
    expect(result).toMatchObject({
      hasJavaScript: true,
      riskCodes: ['ACTIVE_CONTENT', 'FORMS', 'SIGNATURES'],
    });
    expect(JSON.stringify(result)).not.toContain(actionCanary);
  });

  it('does not let a signature widget hide an unresolved annotation on another page', async () => {
    const getPage = vi.fn((pageNumber: number) =>
      Promise.resolve({
        getAnnotations: vi.fn(() =>
          Promise.resolve(
            pageNumber === 2
              ? [{ id: 'link-1', subtype: 'Link' }]
              : [{ fieldType: 'Sig', id: 'field-1', subtype: 'Widget' }],
          ),
        ),
      }),
    ) as unknown as PDFDocumentProxy['getPage'];
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() =>
        Promise.resolve({
          signature: [{ id: 'field-1', page: 0, type: 'signature', value: null }],
        }),
      ) as unknown as PDFDocumentProxy['getFieldObjects'],
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      getPage,
      hasJSActions: vi.fn(() => Promise.resolve(true)),
      isPureXfa: false,
      numPages: 2,
    });

    const result = await document.inspect();
    expect(result).toMatchObject({
      hasJavaScript: true,
      riskCodes: ['ACTIVE_CONTENT', 'FORMS', 'SIGNATURES'],
    });
    expect(getPage).toHaveBeenNthCalledWith(1, 1);
    expect(getPage).toHaveBeenNthCalledWith(2, 2);
  });

  it('does not mistake a known action-free form widget for active content', async () => {
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() =>
        Promise.resolve({
          name: [{ id: 'text-1', page: 0, type: 'text', value: '' }],
          signature: [{ id: 'signature-1', page: 0, type: 'signature', value: null }],
        }),
      ) as unknown as PDFDocumentProxy['getFieldObjects'],
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      getPage: vi.fn(() =>
        Promise.resolve({
          getAnnotations: vi.fn(() =>
            Promise.resolve([
              { fieldType: 'Tx', id: 'text-1', subtype: 'Widget' },
              { fieldType: 'Sig', id: 'signature-1', subtype: 'Widget' },
            ]),
          ),
        }),
      ) as unknown as PDFDocumentProxy['getPage'],
      hasJSActions: vi.fn(() => Promise.resolve(true)),
      isPureXfa: false,
    });

    await expect(document.inspect()).resolves.toMatchObject({
      hasJavaScript: false,
      riskCodes: ['FORMS', 'SIGNATURES'],
      signatureDetection: 'field-only',
    });
  });

  it('does not let a known form widget hide an explicit action', async () => {
    const actionCanary = 'sensitive-text-field-action-canary';
    const getPage = vi.fn();
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() =>
        Promise.resolve({
          name: [
            {
              actions: { 'Mouse Up': [actionCanary] },
              id: 'text-1',
              page: 0,
              type: 'text',
              value: '',
            },
          ],
          signature: [{ id: 'signature-1', page: 0, type: 'signature', value: null }],
        }),
      ) as unknown as PDFDocumentProxy['getFieldObjects'],
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      getPage: getPage as unknown as PDFDocumentProxy['getPage'],
      hasJSActions: vi.fn(() => Promise.resolve(true)),
      isPureXfa: false,
    });

    const result = await document.inspect();
    expect(result).toMatchObject({
      hasJavaScript: true,
      riskCodes: ['ACTIVE_CONTENT', 'FORMS', 'SIGNATURES'],
    });
    expect(getPage).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(actionCanary);
  });

  it('keeps signature documents locked when action inspection fails', async () => {
    const document = makeDocument({
      getAttachments: vi.fn(() => Promise.resolve(null)),
      getFieldObjects: vi.fn(() =>
        Promise.resolve({
          signature: [{ id: 'field-1', page: 0, type: 'signature', value: null }],
        }),
      ) as unknown as PDFDocumentProxy['getFieldObjects'],
      getJSActions: vi.fn(() => Promise.resolve(null)),
      getMarkInfo: vi.fn(() => Promise.resolve(null)),
      getPage: vi.fn(() => Promise.reject(new Error('sensitive parser detail'))),
      hasJSActions: vi.fn(() => Promise.resolve(true)),
      isPureXfa: false,
    });

    const result = await document.inspect();
    expect(result).toMatchObject({ hasJavaScript: true });
    expect(JSON.stringify(result)).not.toContain('sensitive parser detail');
  });
});
