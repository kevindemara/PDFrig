import { createStoredZip, type ZipEntry } from './zip.js';
import { TABLE_LIMITS, TABLE_MIME } from './table-extraction.js';

/** Only accepts our bounded writer's STORED ODS output, never uploaded archives.
 * ODF 1.3 part 2 section 3.3 requires mimetype first, uncompressed, with no extra field.
 * Repackaging preserves the library's XML bytes and does not interpret them.
 */
export function normalizeOdsPackage(bytes: Uint8Array): Uint8Array {
  const fail = (): never => {
    throw new Error('TABLE_ODS_PACKAGE_INVALID');
  };
  if (bytes.length < 30 || bytes.length > TABLE_LIMITS.outputBytes) return fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder('utf-8', { fatal: true });
  const allowed = new Set([
    'META-INF/manifest.xml',
    'meta.xml',
    'mimetype',
    'content.xml',
    'styles.xml',
    'manifest.rdf',
    'settings.xml',
  ]);
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    if (offset + 30 > bytes.length || entries.length >= allowed.size) return fail();
    const flags = view.getUint16(offset + 6, true),
      method = view.getUint16(offset + 8, true),
      size = view.getUint32(offset + 18, true),
      rawSize = view.getUint32(offset + 22, true),
      nameLength = view.getUint16(offset + 26, true),
      extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength,
      end = start + size;
    if (
      (flags & ~0x0800) !== 0 ||
      method !== 0 ||
      size !== rawSize ||
      nameLength > 100 ||
      start > bytes.length ||
      end > bytes.length
    )
      return fail();
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    if (!allowed.has(name) || names.has(name)) return fail();
    entries.push({ name, bytes: bytes.slice(start, end) });
    names.add(name);
    offset = end;
  }
  if (
    offset + 4 > bytes.length ||
    view.getUint32(offset, true) !== 0x02014b50 ||
    !names.has('META-INF/manifest.xml') ||
    !names.has('content.xml')
  )
    return fail();
  const mime = entries.find((entry) => entry.name === 'mimetype');
  if (!mime || decoder.decode(mime.bytes) !== TABLE_MIME.ods) return fail();
  const result = createStoredZip([mime, ...entries.filter((entry) => entry !== mime)], 'ods');
  if (result.length > TABLE_LIMITS.outputBytes) return fail();
  return result;
}
