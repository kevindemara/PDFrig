import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  FEATURE_IDS,
  FEATURE_REGISTRY,
  isFeatureId,
  PDF_OPERATION_REGISTRY,
  pdfOperationContractSchema,
} from './index.js';

describe('feature registry', () => {
  it('records VIEW-008 as a viewer capability without claiming a PDF mutation operation', () => {
    expect(FEATURE_REGISTRY['VIEW-008']).toMatchObject({ priority: 'N', state: 'implemented' });
    expect(
      Object.values(PDF_OPERATION_REGISTRY).flatMap((contract) => contract.featureIds),
    ).not.toContain('VIEW-008');
  });
  it('keeps every key aligned with its stable feature ID', () => {
    expect(FEATURE_IDS.length).toBeGreaterThan(80);
    for (const id of FEATURE_IDS) {
      expect(FEATURE_REGISTRY[id].id).toBe(id);
      expect(FEATURE_REGISTRY[id].state).toBeTruthy();
    }
  });

  it('keeps reviewed operation contracts valid and traceable', () => {
    expect(Object.keys(PDF_OPERATION_REGISTRY)).toEqual([
      'annotations.apply',
      'forms.fill',
      'forms.data.exchange',
      'document.crop',
      'document.resize',
      'document.decorate',
      'document.number',
      'forms.flatten',
      'pages.assemble',
      'pages.extract',
      'signatures.visual',
      'view.open',
      'optimize.compress',
      'security.protect',
      'security.permissions',
      'security.decrypt',
      'metadata.edit',
      'convert.pdf.image',
      'convert.text.pdf',
      'create.blank.pdf',
      'create.images.pdf',
      'create.image.page',
      'convert.office.pdf',
      'ocr.searchable.pdf',
      'redaction.raster.apply',
    ]);
    for (const contract of Object.values(PDF_OPERATION_REGISTRY)) {
      expect(pdfOperationContractSchema.safeParse(contract).success).toBe(true);
      expect(contract.featureIds.every(isFeatureId)).toBe(true);
      expect(['local', 'cloud']).toContain(contract.executionLocation);
    }
    expect(PDF_OPERATION_REGISTRY['convert.office.pdf'].executionLocation).toBe('cloud');
    expect(PDF_OPERATION_REGISTRY['create.blank.pdf']).toMatchObject({
      featureIds: ['CREATE-001'],
      input: { acceptedMimeTypes: [], maximumFiles: 0 },
      version: '1.1.0',
    });
    expect(PDF_OPERATION_REGISTRY['create.images.pdf']).toMatchObject({
      input: { acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
      version: '1.1.0',
    });
    expect(PDF_OPERATION_REGISTRY['convert.pdf.image']).toMatchObject({
      input: { maximumFiles: 1, maximumPages: 500 },
      version: '1.1.0',
    });
    expect(PDF_OPERATION_REGISTRY['convert.pdf.image'].options.map(({ key }) => key)).toEqual([
      'format',
      'scale',
      'pageRange',
      'jpegQuality',
      'transparentBackground',
    ]);
    expect(PDF_OPERATION_REGISTRY['create.image.page']).toMatchObject({
      featureIds: ['ORG-008'],
      input: { acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maximumFiles: 1 },
      version: '1.0.0',
    });
    expect(PDF_OPERATION_REGISTRY['pages.assemble']).toMatchObject({
      featureIds: ['ORG-001', 'ORG-003', 'ORG-004', 'ORG-005', 'ORG-007', 'ORG-008'],
      version: '1.0.1',
    });
    expect(PDF_OPERATION_REGISTRY['pages.assemble'].warningCodes).toEqual(
      expect.arrayContaining([
        'ATTACHMENTS_BLOCKED',
        'INCREMENTAL_REVISIONS_BLOCKED',
        'OUTLINES_BLOCKED',
      ]),
    );
    expect(PDF_OPERATION_REGISTRY['pages.extract']).toMatchObject({
      featureIds: ['ORG-002', 'ORG-006'],
      version: '1.0.1',
    });
    expect(PDF_OPERATION_REGISTRY['ocr.searchable.pdf'].featureIds).toEqual(['OCR-001']);
    expect(PDF_OPERATION_REGISTRY['document.decorate'].featureIds).toEqual([
      'EDIT-006',
      'EDIT-007',
    ]);
    expect(PDF_OPERATION_REGISTRY['document.decorate'].version).toBe('1.1.1');
    expect(PDF_OPERATION_REGISTRY['document.number'].version).toBe('1.0.3');
    expect(PDF_OPERATION_REGISTRY['document.decorate'].warningCodes).toContain(
      'PLACEMENT_REQUIRES_VISUAL_REVIEW',
    );
    expect(FEATURE_REGISTRY['EDIT-006'].state).toBe('implemented');
    expect(FEATURE_REGISTRY['EDIT-007'].state).toBe('engine_selected');
    expect(FEATURE_REGISTRY['VIEW-003'].state).toBe('fixture_verified');
    expect(FEATURE_REGISTRY['VIEW-006'].state).toBe('fixture_verified');
    expect(FEATURE_REGISTRY['VIEW-007'].state).toBe('fixture_verified');
    expect(FEATURE_REGISTRY['PRINT-001'].state).toBe('implemented');
    expect(FEATURE_REGISTRY['CREATE-001'].state).toBe('fixture_verified');
    expect(FEATURE_REGISTRY['ORG-001'].state).toBe('fixture_verified');
    expect(FEATURE_REGISTRY['ORG-002'].state).toBe('fixture_verified');
    expect(FEATURE_REGISTRY['ORG-006'].state).toBe('fixture_verified');
    expect(FEATURE_REGISTRY['ORG-007'].state).toBe('fixture_verified');
    expect(FEATURE_REGISTRY['ORG-008'].state).toBe('fixture_verified');
    expect(FEATURE_REGISTRY['ANNO-003'].state).toBe('fixture_verified');
    expect(FEATURE_REGISTRY['CONV-001'].state).toBe('fixture_verified');
    expect(PDF_OPERATION_REGISTRY['document.crop'].featureIds).toEqual(['ORG-009']);
    expect(PDF_OPERATION_REGISTRY['document.resize'].featureIds).toEqual(['ORG-010']);
    expect(PDF_OPERATION_REGISTRY['document.number'].featureIds).toEqual(['ORG-011', 'ORG-012']);
    expect(PDF_OPERATION_REGISTRY['optimize.compress']).toMatchObject({
      featureIds: ['OPT-001', 'SEC-006', 'SEC-007'],
      version: '1.0.5',
    });
    expect(FEATURE_REGISTRY['SEC-007'].state).toBe('implemented');
    expect(FEATURE_REGISTRY['FORM-003'].state).toBe('implemented');
    expect(FEATURE_REGISTRY['SIGN-003'].state).toBe('implemented');
    expect(PDF_OPERATION_REGISTRY['signatures.visual']).toMatchObject({
      featureIds: ['SIGN-001', 'SIGN-002', 'SIGN-003'],
      version: '1.1.0',
      secretOptionKeys: ['visualAppearance', 'destinationPageIds'],
    });
    expect(PDF_OPERATION_REGISTRY['signatures.visual'].warningCodes).toContain(
      'PLACEMENT_REQUIRES_VISUAL_REVIEW',
    );
    expect(PDF_OPERATION_REGISTRY['forms.data.exchange'].secretOptionKeys).toEqual(['fieldValues']);
    expect(PDF_OPERATION_REGISTRY['annotations.apply'].featureIds).toContain('ANNO-006');
    expect(PDF_OPERATION_REGISTRY['annotations.apply'].featureIds).toContain('ANNO-007');
    expect(FEATURE_REGISTRY['ANNO-008'].state).toBe('implemented');
    expect(PDF_OPERATION_REGISTRY['annotations.apply'].featureIds).not.toContain('ANNO-008');
    expect(PDF_OPERATION_REGISTRY['redaction.raster.apply'].fidelityEffects).toContain(
      'may_rasterize',
    );
    expect(PDF_OPERATION_REGISTRY['security.protect'].secretOptionKeys).toEqual(['password']);
    for (const operation of ['security.protect', 'security.decrypt'] as const) {
      expect(PDF_OPERATION_REGISTRY[operation].version).toBe('1.0.1');
      expect(PDF_OPERATION_REGISTRY[operation].fidelityEffects).toEqual([]);
      expect(PDF_OPERATION_REGISTRY[operation].warningCodes).toContain('SIGNATURES_BLOCKED');
    }
    expect(PDF_OPERATION_REGISTRY['security.permissions'].secretOptionKeys).toEqual([
      'ownerPassword',
      'openPassword',
    ]);
    expect(PDF_OPERATION_REGISTRY['security.permissions'].featureIds).toEqual(['SEC-003']);
    expect(FEATURE_REGISTRY['SEC-003'].state).toBe('implemented');
  });

  it('requires source-free contracts to align zero files and MIME types', () => {
    const blank = PDF_OPERATION_REGISTRY['create.blank.pdf'];
    expect(
      pdfOperationContractSchema.safeParse({
        ...blank,
        input: { ...blank.input, acceptedMimeTypes: ['application/pdf'] },
      }).success,
    ).toBe(false);
    expect(
      pdfOperationContractSchema.safeParse({
        ...blank,
        input: { ...blank.input, maximumFiles: 1 },
      }).success,
    ).toBe(false);
  });

  it('matches every stable ID in the product scope authority', async () => {
    const matrix: unknown = JSON.parse(
      await readFile(new URL('../../../docs/product-scope.json', import.meta.url), 'utf8'),
    );
    expect(matrix).toMatchObject({ schemaVersion: 1, publicReleaseApproved: false });
    if (
      typeof matrix !== 'object' ||
      matrix === null ||
      !('features' in matrix) ||
      !Array.isArray(matrix.features)
    )
      throw new Error('Invalid feature scope authority');
    const matrixIds = new Set(
      matrix.features.map((entry: unknown) => {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          !('id' in entry) ||
          typeof entry.id !== 'string'
        )
          throw new Error('Invalid stable feature ID');
        const definition = FEATURE_REGISTRY[entry.id as keyof typeof FEATURE_REGISTRY];
        expect(definition).toBeDefined();
        expect(entry).toMatchObject({
          id: definition.id,
          priority: definition.priority,
          state: definition.state,
        });
        return entry.id;
      }),
    );
    expect(matrixIds.size).toBe(matrix.features.length);
    expect([...FEATURE_IDS].sort()).toEqual([...matrixIds].sort());
  });
});
