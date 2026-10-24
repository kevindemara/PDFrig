import { describe, it, expect } from 'vitest';
import { normalizeOdsPackage } from './ods-package.js';
import { createStoredZip, type ZipEntry } from './zip.js';
import { TABLE_MIME } from './table-extraction.js';
const encode = (text: string) => new TextEncoder().encode(text);
const entries: ZipEntry[] = [
  { name: 'content.xml', bytes: encode('<content/>') },
  { name: 'META-INF/manifest.xml', bytes: encode('<manifest/>') },
  { name: 'mimetype', bytes: encode(TABLE_MIME.ods) },
];
describe('CONV-007 bounded ODS packaging normalization', () => {
  it('places mimetype at the standard magic positions, stored without an extra header field', () => {
    const bytes = normalizeOdsPackage(createStoredZip(entries, 'ods')),
      view = new DataView(bytes.buffer);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint16(28, true)).toBe(0);
    expect(new TextDecoder().decode(bytes.subarray(30, 38))).toBe('mimetype');
    expect(new TextDecoder().decode(bytes.subarray(38, 38 + TABLE_MIME.ods.length))).toBe(
      TABLE_MIME.ods,
    );
    expect(normalizeOdsPackage(bytes)).toEqual(bytes);
  });
  it.each([
    'compressed',
    'descriptor',
    'size',
    'name',
    'truncated',
    'duplicate',
    'mime',
    'missing',
  ])('refuses %s archive shapes', (mode) => {
    let source = createStoredZip(entries, 'ods');
    const view = new DataView(source.buffer);
    if (mode === 'compressed') view.setUint16(8, 8, true);
    if (mode === 'descriptor') view.setUint16(6, 8, true);
    if (mode === 'size') view.setUint32(18, 0xffffffff, true);
    if (mode === 'name')
      source = createStoredZip([...entries, { name: 'evil.xml', bytes: encode('x') }], 'ods');
    if (mode === 'truncated') source = source.slice(0, 29);
    if (mode === 'duplicate')
      source = createStoredZip(
        [...entries, entries[0] ?? { name: 'content.xml', bytes: encode('x') }],
        'ods',
      );
    if (mode === 'mime')
      source = createStoredZip(
        entries.map((e) => (e.name === 'mimetype' ? { ...e, bytes: encode('wrong') } : e)),
        'ods',
      );
    if (mode === 'missing')
      source = createStoredZip(
        entries.filter((e) => e.name !== 'content.xml'),
        'ods',
      );
    expect(() => normalizeOdsPackage(source)).toThrow('TABLE_ODS_PACKAGE_INVALID');
  });
  it('keeps flat export filenames strict; ODS adds only its exact manifest path', () => {
    expect(() => createStoredZip(entries)).toThrow('ZIP_NAME_INVALID');
    expect(() =>
      createStoredZip([{ name: 'META-INF/other.xml', bytes: encode('x') }], 'ods'),
    ).toThrow('ZIP_NAME_INVALID');
    expect(() => createStoredZip([{ name: '../content.xml', bytes: encode('x') }], 'ods')).toThrow(
      'ZIP_NAME_INVALID',
    );
  });
});
