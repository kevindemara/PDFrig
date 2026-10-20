import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { brotliCompressSync } from 'node:zlib';
import test from 'node:test';
import {
  readWindowsAssetTable,
  pinnedWindowsAssets,
  windowsPackageFootprints,
} from './windows-pe-assets.mjs';

function fixture() {
  const bytes = Buffer.alloc(8192),
    base = 0x140000000n;
  bytes.write('MZ');
  bytes.writeUInt32LE(128, 0x3c);
  bytes.writeUInt32LE(0x4550, 128);
  bytes.writeUInt16LE(0x8664, 132);
  bytes.writeUInt16LE(1, 134);
  bytes.writeUInt16LE(240, 148);
  bytes.writeUInt16LE(0x20b, 152);
  bytes.writeBigUInt64LE(base, 176);
  bytes.write('.rdata', 392);
  bytes.writeUInt32LE(4096, 404);
  bytes.writeUInt32LE(4096, 408);
  bytes.writeUInt32LE(1024, 412);
  let data = 1600;
  for (const [index, [key, text]] of [
    ['/index.html', '<title>synthetic</title>'],
    [
      '/assets/a.js.map',
      JSON.stringify({
        sources: ['../../node_modules/.pnpm/sample@1/node_modules/sample/a.js'],
        sourcesContent: ['// Synthetic source only'],
      }),
    ],
  ].entries()) {
    const at = 1200 + index * 32,
      keyAt = 1400 + index * 64;
    bytes.write(key, keyAt);
    bytes.writeBigUInt64LE(base + BigInt(4096 + keyAt - 1024), at);
    bytes.writeBigUInt64LE(BigInt(key.length), at + 8);
    const compressed = brotliCompressSync(Buffer.from(text));
    compressed.copy(bytes, data);
    bytes.writeBigUInt64LE(base + BigInt(4096 + data - 1024), at + 16);
    bytes.writeBigUInt64LE(BigInt(compressed.length), at + 24);
    data += compressed.length;
  }
  return bytes;
}

test('PE asset inspection reads bounded data without executing binary or source-map JS', () => {
  const bytes = fixture(),
    assets = readWindowsAssetTable(bytes, 1200, 2);
  assert.equal(assets.get('/index.html').content.toString(), '<title>synthetic</title>');
  assert.equal(windowsPackageFootprints(assets, ['sample']).length, 1);
  assert.deepEqual(windowsPackageFootprints(assets, ['unrelated']), []);
  const pin = {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    tableOffset: 1200,
    assets: [...assets].map(([path, record]) => ({
      path,
      bytes: record.bytes,
      sha256: record.sha256,
      encodedBytes: record.encodedBytes,
      encodedSha256: record.encodedSha256,
    })),
  };
  assert.equal(pinnedWindowsAssets(bytes, pin).size, 2);
  assert.throws(
    () => pinnedWindowsAssets(bytes, { ...pin, sha256: '0'.repeat(64) }),
    /WINDOWS_ASSET_AUDIT_INVALID/u,
  );
  assert.throws(
    () =>
      pinnedWindowsAssets(bytes, {
        ...pin,
        assets: [{ ...pin.assets[0], sha256: '0'.repeat(64) }, pin.assets[1]],
      }),
    /WINDOWS_ASSET_AUDIT_INVALID/u,
  );
});

test('malformed headers, pointers, bounds, keys, compression and unfamiliar layouts refuse', () => {
  const original = fixture();
  const mutations = [
    (b) => b.write('NO', 0),
    (b) => b.writeUInt32LE(8190, 0x3c),
    (b) => b.writeUInt16LE(0x14c, 132),
    (b) => b.writeUInt16LE(97, 134),
    (b) => b.writeUInt16LE(0x10b, 152),
    (b) => b.writeUInt32LE(9000, 408),
    (b) => b.writeBigUInt64LE(0n, 1200),
    (b) => b.writeBigUInt64LE(513n, 1208),
    (b) => b.writeBigUInt64LE(0n, 1216),
    (b) => b.writeBigUInt64LE(16777217n, 1224),
    (b) => b.writeBigUInt64LE(0x140001fffn, 1216),
    (b) => b.fill(0, 1600, 1650),
    (b) => b.write('/../bad.txt', 1400),
    (b) => b.copy(b, 1232, 1200, 1232),
  ];
  for (const mutate of mutations) {
    const bytes = Buffer.from(original);
    mutate(bytes);
    assert.throws(() => readWindowsAssetTable(bytes, 1200, 2), /WINDOWS_ASSET_AUDIT_INVALID/u);
  }
  for (const [offset, count] of [
    [-1, 2],
    [1201, 2],
    [8184, 2],
    [1200, 0],
    [1200, 129],
  ])
    assert.throws(
      () => readWindowsAssetTable(original, offset, count),
      /WINDOWS_ASSET_AUDIT_INVALID/u,
    );
});

test('malformed or incomplete source maps never become absence evidence', () => {
  for (const content of [
    'not JSON',
    '{"sources":[],"sourcesContent":[null]}',
    '{"sources":["x"],"sourcesContent":[null]}',
  ])
    assert.throws(
      () =>
        windowsPackageFootprints(new Map([['/x.map', { content: Buffer.from(content) }]]), ['x']),
      /WINDOWS_ASSET_AUDIT_INVALID/u,
    );
});
