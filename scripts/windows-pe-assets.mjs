// Read-only PE64 data inspection. Never loads an executable or evaluates JS.
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';

const fail = () => {
  throw new Error('WINDOWS_ASSET_AUDIT_INVALID');
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Read the explicitly reviewed Tauri/phf asset-table layout, not arbitrary PEs.
 * The caller must bind the table offset/count to an exact executable digest.
 * An unfamiliar layout is refused, never treated as proof that assets are absent.
 */
export function readWindowsAssetTable(bytes, tableOffset, assetCount) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 512 ||
    bytes.length > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(tableOffset) ||
    tableOffset < 0 ||
    tableOffset % 8 ||
    !Number.isSafeInteger(assetCount) ||
    assetCount < 1 ||
    assetCount > 128
  )
    fail();
  const inside = (offset, length) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > bytes.length
    )
      fail();
    return offset;
  };
  if (bytes.toString('ascii', 0, 2) !== 'MZ') fail();
  const pe = bytes.readUInt32LE(0x3c);
  inside(pe, 24);
  if (bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(pe + 4) !== 0x8664) fail();
  const sectionCount = bytes.readUInt16LE(pe + 6),
    optionalBytes = bytes.readUInt16LE(pe + 20);
  if (sectionCount < 1 || sectionCount > 96 || optionalBytes < 112) fail();
  const optional = inside(pe + 24, optionalBytes);
  if (bytes.readUInt16LE(optional) !== 0x20b) fail();
  const base = bytes.readBigUInt64LE(optional + 24);
  const sections = [];
  for (let i = 0; i < sectionCount; i++) {
    const at = inside(optional + optionalBytes + i * 40, 40);
    const size = bytes.readUInt32LE(at + 16),
      offset = bytes.readUInt32LE(at + 20);
    const rva = bytes.readUInt32LE(at + 12);
    inside(offset, size);
    if (rva + size > 0x100000000) fail();
    if (size) sections.push({ offset, size, rva });
  }
  for (let i = 0; i < sections.length; i++)
    for (let j = i + 1; j < sections.length; j++) {
      const a = sections[i],
        b = sections[j];
      if (
        (a.offset < b.offset + b.size && b.offset < a.offset + a.size) ||
        (a.rva < b.rva + b.size && b.rva < a.rva + a.size)
      )
        fail();
    }
  const tableBytes = assetCount * 32;
  if (
    !sections.some(
      (section) =>
        tableOffset >= section.offset && tableOffset + tableBytes <= section.offset + section.size,
    )
  )
    fail();
  const resolve = (pointer, size) => {
    if (pointer < base || pointer - base > 0xffffffffn) fail();
    const rva = Number(pointer - base);
    const section = sections.find(
      (entry) => rva >= entry.rva && rva + size <= entry.rva + entry.size,
    );
    if (!section) fail();
    return inside(section.offset + rva - section.rva, size);
  };
  const assets = new Map();
  let total = 0;
  for (let index = 0; index < assetCount; index++) {
    const at = tableOffset + index * 32;
    const keySize = bytes.readBigUInt64LE(at + 8),
      dataSize = bytes.readBigUInt64LE(at + 24);
    if (keySize < 2n || keySize > 512n || dataSize < 1n || dataSize > 16n * 1024n * 1024n) fail();
    const keyAt = resolve(bytes.readBigUInt64LE(at), Number(keySize));
    const key = bytes.toString('utf8', keyAt, keyAt + Number(keySize));
    if (
      !/^\/[A-Za-z0-9_./-]+$/u.test(key) ||
      key.includes('//') ||
      key.split('/').some((part) => part === '..' || part === '.') ||
      assets.has(key)
    )
      fail();
    const dataAt = resolve(bytes.readBigUInt64LE(at + 16), Number(dataSize));
    const encoded = bytes.subarray(dataAt, dataAt + Number(dataSize));
    let content;
    try {
      content = brotliDecompressSync(encoded, { maxOutputLength: 16 * 1024 * 1024 });
    } catch {
      fail();
    }
    total += content.length;
    if (total > 128 * 1024 * 1024) fail();
    assets.set(key, {
      content,
      bytes: content.length,
      sha256: hash(content),
      encodedSha256: hash(encoded),
      encodedBytes: encoded.length,
    });
  }
  return assets;
}

export function pinnedWindowsAssets(bytes, pin) {
  if (bytes.length !== pin.bytes || hash(bytes) !== pin.sha256) fail();
  const assets = readWindowsAssetTable(bytes, pin.tableOffset, pin.assets.length);
  for (const expected of pin.assets) {
    const actual = assets.get(expected.path);
    if (
      !actual ||
      actual.bytes !== expected.bytes ||
      actual.sha256 !== expected.sha256 ||
      actual.encodedSha256 !== expected.encodedSha256 ||
      actual.encodedBytes !== expected.encodedBytes
    )
      fail();
  }
  return assets;
}

export function windowsPackageFootprints(assets, packages) {
  const found = [];
  for (const [assetPath, { content }] of assets) {
    if (!assetPath.endsWith('.map')) continue;
    let map;
    try {
      map = JSON.parse(content.toString('utf8'));
    } catch {
      fail();
    }
    if (
      !Array.isArray(map.sources) ||
      !Array.isArray(map.sourcesContent) ||
      map.sources.length !== map.sourcesContent.length ||
      map.sources.length > 5000
    )
      fail();
    for (let index = 0; index < map.sources.length; index++) {
      const source = map.sources[index],
        text = map.sourcesContent[index];
      if (typeof source !== 'string' || typeof text !== 'string') fail();
      const at = source.lastIndexOf('/node_modules/');
      if (at < 0) continue;
      const relative = source.slice(at + '/node_modules/'.length);
      for (const name of packages)
        if (relative.startsWith(name + '/'))
          found.push({
            package: name,
            asset: assetPath,
            source: relative,
            bytes: Buffer.byteLength(text),
            sha256: hash(Buffer.from(text)),
          });
    }
  }
  return found;
}
