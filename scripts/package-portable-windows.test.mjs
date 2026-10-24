import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  LOCAL_PORTABLE_ID,
  PORTABLE_ARTIFACT_ID,
  preparePortableDirectory,
} from './package-portable-windows.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pdfrig-portable-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'payload');
  await mkdir(path.join(source, 'licenses'), { recursive: true });
  const artifact = {
    id: PORTABLE_ARTIFACT_ID,
    installer: { sourceCommit: '1'.repeat(40), sha256: '2'.repeat(64) },
    payload: [],
  };
  for (const name of [
    'pdfmason-desktop.exe',
    'licenses/PDFrig-LICENSE.txt',
    'licenses/THIRD_PARTY_NOTICES.txt',
    'licenses/UPSTREAM-LICENSE-TEXTS.txt',
  ]) {
    const bytes = Buffer.from(
      name.endsWith('.exe')
        ? 'MZ synthetic executable, never executed'
        : `Synthetic notice: ${name}`,
    );
    await writeFile(path.join(source, name), bytes);
    artifact.payload.push({
      path: name,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return {
    source,
    output: path.join(directory, 'out'),
    artifact,
    instructions: 'WebView2 required. Synthetic instructions.',
  };
}

test('portable package copies the exact allowlist and preserves original provenance', async (t) => {
  const options = await fixture(t);
  for (const name of ['uninstall.exe', 'private.key', 'personal.pdf', 'unknown.dll'])
    await writeFile(path.join(options.source, name), 'must never ship');
  const result = await preparePortableDirectory(options);
  assert.deepEqual((await readdir(result.application)).sort(), [
    'BUILD_INFO.json',
    'PDFrig.exe',
    'READ_FIRST.txt',
    'SHA256SUMS.txt',
    'licenses',
  ]);
  assert.deepEqual((await readdir(path.join(result.application, 'licenses'))).sort(), [
    'PDFrig-LICENSE.txt',
    'THIRD_PARTY_NOTICES.txt',
    'UPSTREAM-LICENSE-TEXTS.txt',
  ]);
  assert.deepEqual(
    await readFile(path.join(result.application, 'PDFrig.exe')),
    await readFile(path.join(options.source, 'pdfmason-desktop.exe')),
  );
  const info = JSON.parse(await readFile(path.join(result.application, 'BUILD_INFO.json'), 'utf8'));
  assert.equal(info.sourceCommit, options.artifact.installer.sourceCommit);
  assert.equal(info.rebuilt, false);
  assert.equal(info.publicReleaseApproved, false);
  assert.equal(info.manualAcceptancePending, true);
  assert.equal(info.webview2Bundled, false);
  assert.equal(info.installerAndPortableShareSettings, true);
  assert.equal(
    (await readFile(path.join(result.application, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n')
      .length,
    6,
  );
});

test('local source build preserves actual snapshot and isolated test profile', async (t) => {
  const options = await fixture(t);
  options.artifact.id = LOCAL_PORTABLE_ID;
  options.artifact.localBuild = {
    publicReleaseApproved: false,
    manualAcceptancePending: true,
    version: '0.1.0-alpha.20261024.1',
    sourceSnapshotSha256: '3'.repeat(64),
    features: { tables: true, ocr: true, xlsx: true, ods: true },
  };
  delete options.artifact.installer.sha256;
  const { info } = await preparePortableDirectory(options);
  assert.equal(info.rebuilt, true);
  assert.equal(info.installerSha256, null);
  assert.equal(info.installerAndPortableShareSettings, false);
  assert.equal(info.sourceSnapshotSha256, '3'.repeat(64));
  assert.equal(info.features.tables, true);
});

test('tampered executable or notices refuse before creating output', async (t) => {
  for (const name of ['pdfmason-desktop.exe', 'licenses/THIRD_PARTY_NOTICES.txt']) {
    const options = await fixture(t);
    await writeFile(path.join(options.source, name), 'tampered');
    await assert.rejects(preparePortableDirectory(options), /PORTABLE_PAYLOAD_HASH_MISMATCH/u);
    await assert.rejects(access(options.output));
  }
});

test('unreviewed or incomplete pins refuse before output', async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    preparePortableDirectory({ ...options, artifact: { ...options.artifact, id: 'unknown' } }),
    /PORTABLE_ARTIFACT_UNREVIEWED/u,
  );
  await assert.rejects(
    preparePortableDirectory({
      ...options,
      artifact: { ...options.artifact, payload: options.artifact.payload.slice(1) },
    }),
    /PORTABLE_PIN_MISSING/u,
  );
  await assert.rejects(access(options.output));
});

test('existing output and output inside source are never replaced', async (t) => {
  const options = await fixture(t);
  await mkdir(options.output);
  await writeFile(path.join(options.output, 'keep.txt'), 'keep');
  await assert.rejects(preparePortableDirectory(options), /EEXIST/u);
  assert.equal(await readFile(path.join(options.output, 'keep.txt'), 'utf8'), 'keep');
  await assert.rejects(
    preparePortableDirectory({ ...options, output: path.join(options.source, 'out') }),
    /PORTABLE_OUTPUT_INSIDE_SOURCE/u,
  );
});

test('notice directory junctions and symlinks are refused', async (t) => {
  const options = await fixture(t);
  const linked = path.join(path.dirname(options.source), 'linked');
  await mkdir(linked);
  await writeFile(
    path.join(linked, 'pdfmason-desktop.exe'),
    await readFile(path.join(options.source, 'pdfmason-desktop.exe')),
  );
  await symlink(
    path.join(options.source, 'licenses'),
    path.join(linked, 'licenses'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    preparePortableDirectory({ ...options, source: linked }),
    /PORTABLE_SOURCE_NOT_PLAIN_FILE/u,
  );
  await assert.rejects(access(options.output));
});

test('portable pin matches published installer and instructions retain runtime/security limits', async () => {
  const load = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
  const audit = JSON.parse(await load('docs/dependencies/windows-installer-dependency-audit.json'));
  const release = JSON.parse(await load('docs/operations/windows-save-race-release.json'));
  const artifact = audit.artifacts.find((entry) => entry.id === PORTABLE_ARTIFACT_ID);
  assert.equal(artifact.installer.sha256, release.assetSha256);
  const guide = await load('docs/operations/windows-portable-read-first.txt');
  for (const phrase of [
    'PDFrig.exe',
    'Extract ALL files',
    'WebView2 Runtime',
    'unsigned alpha',
    'SAME application identity',
    'not been rebuilt',
    'table extraction',
    'Stop if Windows',
    'user profile',
    'licenses/',
  ])
    assert.ok(guide.includes(phrase), phrase);
  assert.doesNotMatch(guide, /disable (?:your )?(?:antivirus|Defender)|ExecutionPolicy Bypass/iu);
});
