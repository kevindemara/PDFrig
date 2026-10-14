import { readFile } from 'node:fs/promises';

import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { FormValue } from '@pdfmason/editor-core';

import { exportEditedPdf } from './editing.js';

const fixture = () =>
  readFile(new URL('../../test-corpus/fixtures/acroform-text-field.pdf', import.meta.url));
const exportValues = (bytes: Uint8Array, formValues: readonly FormValue[], flattenForms = false) =>
  exportEditedPdf({
    annotations: [],
    formValues,
    options: { flattenForms },
    pages: [{ pageId: 'page-1', rotation: 0, sourceId: 'source', sourcePageIndex: 0 }],
    sources: [{ bytes, sourceId: 'source' }],
  });

describe('FORM-001/002 export authority', () => {
  it.each(['radio', 'dropdown'] as const)(
    'rejects unlisted %s values without rewriting the source',
    async (type) => {
      const bytes = new Uint8Array(await fixture());
      const before = bytes.slice();
      for (const flatten of [false, true]) {
        await expect(
          exportValues(
            bytes,
            [
              {
                sourceId: 'source',
                fieldName: type === 'radio' ? 'synthetic.choice' : 'synthetic.province',
                type,
                value: 'PRIVATE_OPTION_CANARY',
              },
            ],
            flatten,
          ),
        ).rejects.toThrow(/^EDIT_FORM_VALUE_INVALID$/u);
      }
      expect(bytes).toEqual(before);
    },
  );
  it.each(['text', 'checkbox', 'radio', 'dropdown'] as const)(
    'refuses a read-only %s field even without the UI',
    async (type) => {
      const document = await PDFDocument.load(await fixture(), { updateMetadata: false });
      const fieldName = {
        text: 'synthetic.name',
        checkbox: 'synthetic.approved',
        radio: 'synthetic.choice',
        dropdown: 'synthetic.province',
      }[type];
      document.getForm().getField(fieldName).enableReadOnly();
      const bytes = await document.save();
      const before = bytes.slice();
      for (const flatten of [false, true]) {
        await expect(
          exportValues(
            bytes,
            [
              {
                sourceId: 'source',
                fieldName,
                type,
                value:
                  type === 'checkbox'
                    ? true
                    : type === 'radio'
                      ? 'B'
                      : type === 'dropdown'
                        ? 'QC'
                        : 'PRIVATE_VALUE_CANARY',
              },
            ],
            flatten,
          ),
        ).rejects.toThrow(/^EDIT_FORM_READ_ONLY$/u);
      }
      // Existing read-only values do not make a no-op export invalid.
      await expect(exportValues(bytes, [])).resolves.toBeInstanceOf(Uint8Array);
      expect(bytes).toEqual(before);
    },
  );
  it('rejects text longer than the source constraint with a content-free error', async () => {
    const document = await PDFDocument.load(await fixture(), { updateMetadata: false });
    const field = document.getForm().getTextField('synthetic.name');
    field.setText('');
    field.setMaxLength(3);
    const bytes = await document.save();
    await expect(
      exportValues(bytes, [
        {
          sourceId: 'source',
          fieldName: 'synthetic.name',
          type: 'text',
          value: 'PRIVATE_VALUE_CANARY',
        },
      ]),
    ).rejects.toThrow(/^EDIT_FORM_VALUE_INVALID$/u);
  });
});
