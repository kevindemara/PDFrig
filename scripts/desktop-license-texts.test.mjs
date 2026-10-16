import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectDesktopLicenseNotices,
  loadDesktopLicenseSupplements,
  retainPackageLicenseTexts,
} from './desktop-license-texts.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  await mkdir(path.join(repository, 'tmp'), { recursive: true });
  const root = await mkdtemp(path.join(repository, 'tmp/notice-test-'));
  const directory = path.join(root, 'registry/src/index.test/sample-1.0.0');
  const cache = path.join(root, 'registry/cache/index.test');
  await mkdir(directory, { recursive: true });
  await mkdir(cache, { recursive: true });
  const text = 'Synthetic notice text for collector QA.\n',
    manifest = 'Synthetic original package manifest\n',
    archive = 'Synthetic crate archive';
  await writeFile(path.join(root, 'notice.txt'), text);
  await writeFile(path.join(directory, 'Cargo.toml.orig'), manifest);
  await writeFile(
    path.join(directory, '.cargo_vcs_info.json'),
    JSON.stringify({ git: { sha1: 'a'.repeat(40) }, path_in_vcs: 'crates/sample' }),
  );
  await writeFile(path.join(cache, 'sample-1.0.0.crate'), archive);
  const supplements = {
    schemaVersion: 1,
    publicReleaseApproved: false,
    texts: [
      {
        id: 'synthetic',
        path: 'notice.txt',
        sha256: hash(text),
        gitBlob: createHash('sha1')
          .update(`blob ${Buffer.byteLength(text)}\0`)
          .update(text)
          .digest('hex'),
      },
    ],
    packages: [
      {
        name: 'sample',
        version: '1.0.0',
        license: 'MIT',
        commit: 'a'.repeat(40),
        pathInVcs: 'crates/sample',
        manifestSha256: hash(manifest),
        archiveSha256: hash(archive),
        textId: 'synthetic',
      },
    ],
  };
  return {
    root,
    directory,
    cache,
    supplements,
    pkg: { ecosystem: 'cargo', name: 'sample', version: '1.0.0', license: 'MIT', directory },
  };
}
test('desktop notice retention preserves all packaged texts and explicit nested license_file', async () => {
  const f = await fixture();
  await mkdir(path.join(f.directory, 'legal'));
  for (const file of ['LICENSE-MIT', 'NOTICE', 'COPYING', 'legal/custom.txt'])
    await writeFile(path.join(f.directory, file), `Synthetic ${file}\n`);
  const texts = await retainPackageLicenseTexts({ ...f.pkg, licenseFile: 'legal/custom.txt' }, f);
  assert.equal(texts.length, 4);
  assert.ok(
    texts.every((entry) => entry.origin === 'packaged' && hash(entry.text) === entry.sha256),
  );
  assert.ok(texts.some((entry) => entry.file === 'legal/custom.txt'));
});
test('README/licence declarations alone are gaps, never generic template permission', async () => {
  const f = await fixture();
  await writeFile(path.join(f.directory, 'README.md'), 'Synthetic MIT declaration only');
  const result = await collectDesktopLicenseNotices([{ ...f.pkg, ecosystem: 'npm' }], f);
  assert.deepEqual(result.gaps, ['sample@1.0.0']);
  assert.deepEqual(result.provenance, []);
  assert.ok(!result.text.includes('declaration only'));
});
test('exact reviewed supplements bind archive, original manifest, VCS commit/path, expression and notice hash', async () => {
  const f = await fixture();
  const result = await collectDesktopLicenseNotices([f.pkg], f);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.provenance[0].origin, 'reviewed-source-supplement');
  assert.equal(result.provenance[0].commit, 'a'.repeat(40));
  assert.ok(result.text.includes('Synthetic notice text'));
  assert.ok(!JSON.stringify(result).includes(f.root));
  assert.deepEqual(await retainPackageLicenseTexts({ ...f.pkg, version: '1.0.1' }, f), []);
});
for (const mutation of ['commit', 'path', 'manifest', 'archive', 'license', 'text', 'directory'])
  test(`desktop supplemental evidence refuses ${mutation} drift`, async () => {
    const f = await fixture();
    if (mutation === 'commit') f.supplements.packages[0].commit = 'b'.repeat(40);
    if (mutation === 'path') f.supplements.packages[0].pathInVcs = 'crates/other';
    if (mutation === 'manifest')
      await writeFile(path.join(f.directory, 'Cargo.toml.orig'), 'changed');
    if (mutation === 'archive')
      await writeFile(path.join(f.cache, 'sample-1.0.0.crate'), 'changed');
    if (mutation === 'license') f.pkg.license = 'Apache-2.0';
    if (mutation === 'text') await writeFile(path.join(f.root, 'notice.txt'), 'changed');
    if (mutation === 'directory') {
      f.pkg.directory = path.join(f.root, 'wrong-package-directory');
      await mkdir(f.pkg.directory);
    }
    await assert.rejects(
      retainPackageLicenseTexts(f.pkg, f),
      /DESKTOP_NOTICES_(?:SUPPLEMENT_BINDING|SUPPLEMENT_TEXT)_MISMATCH/u,
    );
  });
test('desktop text paths cannot escape the package or repository root', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'private.txt'), 'Synthetic outside file');
  for (const file of ['../../../../private.txt', path.join(f.root, 'private.txt')])
    await assert.rejects(
      retainPackageLicenseTexts({ ...f.pkg, licenseFile: file }, f),
      /UNSAFE_TEXT_PATH/u,
    );
  f.supplements.texts[0].path = '../private.txt';
  await assert.rejects(retainPackageLicenseTexts(f.pkg, f), /UNSAFE_TEXT_PATH/u);
});
test('unreadable/empty/oversized notice inputs fail, not silently become complete', async () => {
  const f = await fixture();
  await writeFile(path.join(f.directory, 'LICENSE'), '');
  await assert.rejects(retainPackageLicenseTexts(f.pkg, f), /INVALID_TEXT_FILE/u);
  await writeFile(path.join(f.directory, 'LICENSE'), Buffer.alloc(1024 * 1024 + 1, 65));
  await assert.rejects(retainPackageLicenseTexts(f.pkg, f), /INVALID_TEXT_FILE/u);
});
test('reviewed real WebView2 text and source metadata stay integrity bound, without granting release approval', async () => {
  const manifest = await loadDesktopLicenseSupplements(repository);
  assert.equal(manifest.publicReleaseApproved, false);
  assert.equal(manifest.packages.length, 3);
  assert.ok(
    manifest.packages.every(
      (pkg) => pkg.license === 'MIT' && /^[a-f0-9]{64}$/u.test(pkg.archiveSha256),
    ),
  );
  const text = await readFile(path.join(repository, manifest.texts[0].path), 'utf8');
  assert.match(text, /Copyright \(c\) 2021 Bill Avery/u);
  assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS"/u);
  const build = await readFile(path.join(repository, 'scripts/build-internal-windows.mjs'), 'utf8');
  assert.match(build, /await prepareDesktopNotices\(/u);
  const audit = await readFile(
    path.join(repository, 'scripts/prepare-desktop-notices.mjs'),
    'utf8',
  );
  assert.match(audit, /'metadata',\s*'--locked',\s*'--offline'/u);
  assert.doesNotMatch(audit, /['"](?:build|signer|install|publish|push|fetch)['"]/u);
  assert.match(audit, /--require-complete/u);
});
