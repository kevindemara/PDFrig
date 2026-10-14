export interface ZipEntry {
  readonly bytes: Uint8Array;
  readonly name: string;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ (crcTable[(value ^ byte) & 0xff] ?? 0);
  return (value ^ 0xffffffff) >>> 0;
};

const set16 = (view: DataView, offset: number, value: number): void =>
  view.setUint16(offset, value, true);
const set32 = (view: DataView, offset: number, value: number): void =>
  view.setUint32(offset, value, true);

/** Creates a deterministic, dependency-free ZIP using stored entries (images are already compressed). */
export const createStoredZip = (entries: readonly ZipEntry[]): Uint8Array => {
  if (entries.length === 0 || entries.length > 500) throw new Error('ZIP_ENTRY_LIMIT');
  const encoder = new TextEncoder();
  const names = entries.map(({ name }) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(name)) throw new Error('ZIP_NAME_INVALID');
    return encoder.encode(name);
  });
  const localSize = entries.reduce((total, entry, index) => {
    const name = names[index];
    if (name === undefined) throw new Error('ZIP_NAME_INVALID');
    return total + 30 + name.length + entry.bytes.length;
  }, 0);
  const centralSize = entries.reduce((total, _entry, index) => {
    const name = names[index];
    if (name === undefined) throw new Error('ZIP_NAME_INVALID');
    return total + 46 + name.length;
  }, 0);
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let localOffset = 0;
  let centralOffset = localSize;
  entries.forEach((entry, index) => {
    const name = names[index];
    if (name === undefined) throw new Error('ZIP_NAME_INVALID');
    const checksum = crc32(entry.bytes);
    set32(view, localOffset, 0x04034b50);
    set16(view, localOffset + 4, 20);
    set16(view, localOffset + 6, 0x0800);
    set32(view, localOffset + 14, checksum);
    set32(view, localOffset + 18, entry.bytes.length);
    set32(view, localOffset + 22, entry.bytes.length);
    set16(view, localOffset + 26, name.length);
    output.set(name, localOffset + 30);
    output.set(entry.bytes, localOffset + 30 + name.length);

    set32(view, centralOffset, 0x02014b50);
    set16(view, centralOffset + 4, 20);
    set16(view, centralOffset + 6, 20);
    set16(view, centralOffset + 8, 0x0800);
    set32(view, centralOffset + 16, checksum);
    set32(view, centralOffset + 20, entry.bytes.length);
    set32(view, centralOffset + 24, entry.bytes.length);
    set16(view, centralOffset + 28, name.length);
    set32(view, centralOffset + 42, localOffset);
    output.set(name, centralOffset + 46);
    localOffset += 30 + name.length + entry.bytes.length;
    centralOffset += 46 + name.length;
  });
  set32(view, centralOffset, 0x06054b50);
  set16(view, centralOffset + 8, entries.length);
  set16(view, centralOffset + 10, entries.length);
  set32(view, centralOffset + 12, centralSize);
  set32(view, centralOffset + 16, localSize);
  return output;
};
