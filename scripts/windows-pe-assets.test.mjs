import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { brotliCompressSync } from 'node:zlib';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
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

test('replacement installer evidence binds exclusions, MIT notice, tested binary and README without granting clearance', async () => {
  const load = async (file) =>
    JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  const audit = await load('docs/dependencies/windows-installer-dependency-audit.json');
  const build = await load('docs/operations/windows-license-audit-build.json');
  const release = await load('docs/operations/windows-license-audit-release.json');
  const [older, next] = audit.artifacts;
  assert.equal(older.findings.fontkitDfaBrotliPresent, true);
  assert.ok(older.packageFootprints.some((entry) => entry.package === 'fontkit'));
  assert.equal(audit.publicReleaseApproved, false);
  assert.equal(next.id, release.tag);
  assert.equal(next.installer.sha256, build.installerSha256);
  assert.equal(next.installer.bytes, build.installerBytes);
  assert.equal(next.installer.sourceCommit, build.sourceCommit);
  assert.equal(next.executable.sha256, build.installedBinarySha256);
  assert.equal(next.payload.length, 11);
  assert.equal(next.executable.assets.length, 28);
  assert.deepEqual(next.packageFootprints, []);
  assert.equal(next.findings.fontkitDfaBrotliPresent, false);
  assert.equal(next.findings.nativeCanvasAndIcuDataAbsent, true);
  assert.equal(next.findings.licensesCleared, false);
  assert.equal(next.buildAssetComparisons.filter((item) => item.sha256Matched).length, 27);
  assert.equal(
    next.payload.find((item) => item.path === 'licenses/PDFrig-LICENSE.txt').sha256,
    build.notices.mitLicenseSha256,
  );
  for (const entry of [build, release]) assert.equal(entry.publicReleaseApproved, false);
  assert.equal(build.installedSmokeTest.ocrExport144DpiPngByteIdenticalToOriginal, true);
  assert.equal(
    build.installedSmokeTest.signatureExportSearchableAndOriginalFontStreamHashMatched,
    true,
  );
  assert.equal(build.installedSmokeTest.nativeSaveAsNewFilePassed, true);
  assert.equal(release.assetSha256, build.installerSha256);
  assert.equal(release.assetBytes, build.installerBytes);
  assert.equal(release.executableSourceCommit, build.sourceCommit);
  assert.equal(release.releaseTargetCommit, build.sourceCommit);
  assert.equal(release.githubAssetDigest, `sha256:${build.installerSha256}`);
  for (const key of [
    'repositoryPrivateAtUploadAndVerification',
    'downloadedArtifactHashVerified',
    'downloadedCompanionHashesVerified',
    'uploadedChecksumListingVerified',
    'downloadedInstallerSignatureVerifiedWithNegativeCases',
    'publishedTagTargetVerified',
  ])
    assert.equal(release[key], true);
  assert.ok(release.assets.includes('PDFrig-LICENSE.txt'));
  assert.ok(release.assets.every((name) => !name.endsWith('.key')));
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  // Historical evidence remains linked, but the README recommends the newer
  // no-replace-save installer rather than this superseded download.
  assert.ok(readme.includes('docs/operations/windows-license-audit-build.json'));
  assert.ok(readme.includes('docs/operations/windows-license-audit-release.json'));
  assert.ok(readme.includes('docs/operations/windows-release-checklist.txt'));
  const cleanup = release.obsoleteReleaseCleanup;
  assert.equal(cleanup.userApproved, true);
  assert.equal(cleanup.assetsRemoved, 14);
  assert.equal(cleanup.allBackupAssetSizesAndGithubSha256DigestsVerified, true);
  assert.equal(cleanup.gitTagTargetsUnchanged, true);
  assert.equal(cleanup.gitHistoryRewritten, false);
  assert.equal(cleanup.backupTrackedInGit, false);
  assert.equal(cleanup.remainingRelease, release.tag);
});

test('historical no-replace-save installer evidence remains hash-bound when superseded', async () => {
  const load = async (name) =>
    JSON.parse(await readFile(new URL(`../docs/operations/${name}`, import.meta.url), 'utf8'));
  const build = await load('windows-save-race-build.json');
  const release = await load('windows-save-race-release.json');
  const review = await load('windows-save-race-review.json');
  const audit = JSON.parse(
    await readFile(
      new URL('../docs/dependencies/windows-installer-dependency-audit.json', import.meta.url),
      'utf8',
    ),
  );
  const artifact = audit.artifacts.find((item) => item.id === release.tag);
  assert.ok(artifact);
  assert.equal(artifact.installer.sha256, build.installerSha256);
  assert.equal(artifact.installer.bytes, build.installerBytes);
  assert.equal(artifact.installer.sourceCommit, build.sourceCommit);
  assert.equal(artifact.executable.sha256, build.installedBinarySha256);
  assert.equal(artifact.payload.length, 11);
  assert.equal(artifact.executable.assets.length, 28);
  assert.deepEqual(artifact.packageFootprints, []);
  assert.equal(artifact.findings.licensesCleared, false);
  assert.equal(artifact.buildAssetComparisons.filter((item) => item.sha256Matched).length, 27);
  assert.equal(build.checks.nativeUnitTests, 20);
  assert.equal(build.installedSmokeTest.saveAsCancellationRetainsEdits, true);
  assert.equal(build.installedSmokeTest.nativeSaveAsNewUnicodeFilenamePassed, true);
  assert.equal(build.installedSmokeTest.ocrExport144DpiPngByteIdenticalToOriginal, true);
  assert.equal(
    build.installedSmokeTest.signatureExportSearchableAndOriginalFontStreamHashMatched,
    true,
  );
  assert.equal(build.installedSmokeTest.allToolsUnsavedWarningAndCancelRetainEdit, true);
  assert.equal(build.installedSmokeTest.allToolsAfterSuccessfulExportPassed, true);
  assert.equal(review.verification.installedApp.installerSha256, build.installerSha256);
  assert.equal(release.assetSha256, build.installerSha256);
  assert.equal(release.assetBytes, build.installerBytes);
  assert.equal(release.executableSourceCommit, build.sourceCommit);
  assert.equal(release.releaseTargetCommit, build.sourceCommit);
  assert.equal(release.githubAssetDigest, `sha256:${build.installerSha256}`);
  for (const key of [
    'repositoryPrivateAtUploadAndVerification',
    'downloadedArtifactHashVerified',
    'uploadedChecksumListingVerified',
    'downloadedCompanionHashesVerified',
    'downloadedInstallerSignatureVerifiedWithNegativeCases',
    'publishedTagTargetVerified',
    'installedAppTested',
  ])
    assert.equal(release[key], true, key);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, true);
  assert.equal(release.authenticode, 'NotSigned');
  for (const record of [build, release, review]) {
    assert.equal(record.publicReleaseApproved, false);
    assert.equal(record.securityPolicyChanges, false);
    assert.equal(record.billingChanges, false);
  }
  const current = await load('windows-security-patch-release.json');
  assert.ok(current.supersedes.includes(release.tag));
  assert.notEqual(current.assetSha256, release.assetSha256);
  assert.ok(release.assets.every((name) => !name.endsWith('.key')));
});
