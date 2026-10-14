const startXref = new TextEncoder().encode('startxref');
const endOfFile = new TextEncoder().encode('%%EOF');
const xref = new TextEncoder().encode('xref');

const matchesAt = (bytes: Uint8Array, offset: number, token: Uint8Array): boolean => {
  if (offset < 0 || offset + token.byteLength > bytes.byteLength) return false;
  return token.every((byte, index) => bytes[offset + index] === byte);
};

const isWhitespace = (byte: number | undefined): boolean =>
  byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;

const skipWhitespace = (bytes: Uint8Array, initial: number): number => {
  let offset = initial;
  while (offset < bytes.byteLength && isWhitespace(bytes[offset])) offset += 1;
  return offset;
};

const pointsToCrossReference = (bytes: Uint8Array, offset: number): boolean => {
  if (matchesAt(bytes, offset, xref)) return true;
  const prefix = new TextDecoder('ascii').decode(
    bytes.subarray(offset, Math.min(offset + 64, bytes.byteLength)),
  );
  return /^\d+\s+\d+\s+obj(?:\s|<)/u.test(prefix);
};

const validStartXrefAt = (bytes: Uint8Array, offset: number): number | null => {
  let cursor = skipWhitespace(bytes, offset + startXref.byteLength);
  const firstDigit = cursor;
  while (cursor < bytes.byteLength && bytes[cursor] !== undefined) {
    const byte = bytes[cursor];
    if (byte === undefined || byte < 48 || byte > 57) break;
    cursor += 1;
  }
  if (cursor === firstDigit) return null;
  const target = Number(new TextDecoder('ascii').decode(bytes.subarray(firstDigit, cursor)));
  if (!Number.isSafeInteger(target) || target < 0 || target >= bytes.byteLength) return null;
  cursor = skipWhitespace(bytes, cursor);
  return matchesAt(bytes, cursor, endOfFile) && pointsToCrossReference(bytes, target)
    ? cursor + endOfFile.byteLength
    : null;
};

export type PdfRevisionStructure = 'incremental' | 'malformed' | 'single';

/** Classifies bounded top-level revision terminators without parsing PDF objects. */
export const inspectPdfRevisionStructure = (bytes: Uint8Array): PdfRevisionStructure => {
  let revisions = 0;
  let finalEnd = -1;
  for (let offset = 0; offset <= bytes.byteLength - startXref.byteLength; offset += 1) {
    if (!matchesAt(bytes, offset, startXref)) continue;
    const end = validStartXrefAt(bytes, offset);
    if (end === null) continue;
    revisions += 1;
    finalEnd = end;
    offset += startXref.byteLength - 1;
  }
  if (revisions === 0) return 'malformed';
  for (let offset = finalEnd; offset < bytes.byteLength; offset += 1)
    if (!isWhitespace(bytes[offset])) return 'malformed';
  return revisions > 1 ? 'incremental' : 'single';
};

export const hasIncrementalPdfRevisions = (bytes: Uint8Array): boolean =>
  inspectPdfRevisionStructure(bytes) === 'incremental';
