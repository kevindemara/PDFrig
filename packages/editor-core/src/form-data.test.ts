import { describe, expect, it } from 'vitest';
import { createInitialEditorDocument, type FormValue } from './document-state.js';
import { createInitialPageGraph } from './page-graph.js';
import { DocumentSession } from './session.js';
import {
  exportFormDataBytes,
  FORM_DATA_LIMITS,
  importFormDataCommand,
  parseFormData,
  parseFormDataBytes,
  validateFormDataForFields,
} from './form-data.js';

const definitions = [
  { fieldName: 'name', type: 'text' as const, readOnly: false, options: [] },
  { fieldName: 'approved', type: 'checkbox' as const, readOnly: false, options: [] },
  { fieldName: 'choice', type: 'radio' as const, readOnly: false, options: [{ value: 'A' }] },
  { fieldName: 'choice', type: 'radio' as const, readOnly: false, options: [{ value: 'B' }] },
  { fieldName: 'province', type: 'dropdown' as const, readOnly: false, options: [{ value: 'QC' }] },
  { fieldName: 'private', type: 'text' as const, readOnly: true, options: [] },
] as const;
const report = (fields: unknown[]) => ({ schema: 'pdfmason.form-data', version: 1, fields });
const entry = { fieldName: 'name', type: 'text', value: '  Synthetic Reviewer  ' };

describe('FORM-003 local JSON form data', () => {
  it('round trips deterministically without source IDs, filenames, or read-only fields', () => {
    const values: FormValue[] = [
      { ...entry, type: 'text', sourceId: 'source' },
      { fieldName: 'approved', type: 'checkbox', value: true, sourceId: 'source' },
      { fieldName: 'private', type: 'text', value: 'PRIVATE_CANARY', sourceId: 'source' },
      { fieldName: 'name', type: 'text', value: 'OTHER_SOURCE_CANARY', sourceId: 'other' },
    ];
    const bytes = exportFormDataBytes(definitions, values, 'source');
    expect(bytes).toEqual(exportFormDataBytes(definitions, [...values].reverse(), 'source'));
    expect(parseFormDataBytes(bytes).fields).toEqual([
      { fieldName: 'approved', type: 'checkbox', value: true },
      entry,
    ]);
    expect(new TextDecoder().decode(bytes)).not.toMatch(/CANARY|sourceId/);
  });

  it('imports atomically into only the selected source with one-step undo and redo', () => {
    const initial = createInitialEditorDocument(
      createInitialPageGraph('source', 1, () => 'page'),
      [
        { fieldName: 'name', type: 'text', value: 'Before', sourceId: 'source' },
        { fieldName: 'name', type: 'text', value: 'Other', sourceId: 'other' },
      ],
    );
    const session = new DocumentSession(
      { contentHash: 'memory-only', sourceId: 'source' },
      initial,
    );
    const command = importFormDataCommand(
      initial,
      report([entry, { fieldName: 'approved', type: 'checkbox', value: true }]),
      definitions,
      'source',
    );
    const next = session.execute(command).state;
    expect(next.formValues).toContainEqual({ ...entry, sourceId: 'source' });
    expect(next.formValues).toContainEqual({
      fieldName: 'name',
      type: 'text',
      value: 'Other',
      sourceId: 'other',
    });
    expect(session.undo().state).toBe(initial);
    expect(session.redo().state).toBe(next);
    expect(initial.formValues[0]?.value).toBe('Before');
    expect(() => importFormDataCommand(initial, report([entry]), definitions, 'missing')).toThrow(
      'FORM_DATA_INVALID',
    );
  });

  it.each([
    { fieldName: 'unknown', type: 'text', value: 'CONTENT_CANARY' },
    { fieldName: 'private', type: 'text', value: 'CONTENT_CANARY' },
    { fieldName: 'name', type: 'checkbox', value: true },
    { fieldName: 'province', type: 'dropdown', value: 'BAD_OPTION' },
    { fieldName: 'choice', type: 'radio', value: 'BAD_OPTION' },
  ])('rejects mismatched fields without leaking data: %j', (bad) => {
    expect(() => validateFormDataForFields(report([entry, bad]), definitions)).toThrow(
      /^FORM_DATA_INVALID$/,
    );
  });

  it('combines radio widget options and permits explicit empty choices', () => {
    for (const value of ['A', 'B', '']) {
      expect(
        validateFormDataForFields(
          report([{ fieldName: 'choice', type: 'radio', value }]),
          definitions,
        ).fields[0]?.value,
      ).toBe(value);
    }
    expect(() =>
      validateFormDataForFields(report([entry]), [
        ...definitions,
        { ...definitions[0], readOnly: true },
      ]),
    ).toThrow('FORM_DATA_INVALID');
  });

  it('rejects malformed, unknown-key, duplicate, coercible, and oversized schemas', () => {
    const badInputs = [
      null,
      [],
      {},
      { ...report([entry]), version: 2 },
      { ...report([entry]), filename: 'SECRET' },
      report([]),
      report([entry, entry]),
      report([{ ...entry, extra: 'SECRET' }]),
      report([{ ...entry, type: 'signature' }]),
      report([{ ...entry, value: 1 }]),
      report([{ ...entry, fieldName: '' }]),
      report([{ ...entry, fieldName: 'a\u0000' }]),
      report([{ ...entry, value: 'x'.repeat(2_001) }]),
      report([{ ...entry, value: '\u0000' }]),
      report([{ fieldName: 'approved', type: 'checkbox', value: 'true' }]),
      report(Array.from({ length: 501 }, (_, index) => ({ ...entry, fieldName: `field${index}` }))),
    ];
    for (const input of badInputs)
      expect(() => parseFormData(input)).toThrow(/^FORM_DATA_INVALID$/);
    for (const bytes of [
      new Uint8Array(),
      new Uint8Array([0xff]),
      new TextEncoder().encode('{"SECRET'),
      new Uint8Array(FORM_DATA_LIMITS.maximumBytes + 1),
    ]) {
      expect(() => parseFormDataBytes(bytes)).toThrow(/^FORM_DATA_INVALID$/);
    }
  });

  it('treats prototype-like names as inert data, not object properties', () => {
    const field = { ...definitions[0], fieldName: '__proto__' };
    expect(
      validateFormDataForFields(report([{ ...entry, fieldName: '__proto__' }]), [field]).fields,
    ).toHaveLength(1);
    expect({}).not.toHaveProperty('value');
  });

  it('refuses text exceeding the source field length without truncation', () => {
    expect(() =>
      validateFormDataForFields(report([entry]), [{ ...definitions[0], maximumLength: 3 }]),
    ).toThrow('FORM_DATA_INVALID');
    expect(
      validateFormDataForFields(report([{ ...entry, value: 'ABC' }]), [
        { ...definitions[0], maximumLength: 3 },
      ]).fields[0]?.value,
    ).toBe('ABC');
  });
});
