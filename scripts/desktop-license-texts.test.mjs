import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectDesktopLicenseNotices,
  loadDesktopLicenseSupplements,
  loadDesktopNpmPartialNotices,
  retainPackageLicenseTexts,
} from './desktop-license-texts.mjs';
import { desktopNoticeScope } from './desktop-notice-scope.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(name = 'sample', version = '1.0.0') {
  await mkdir(path.join(repository, 'tmp'), { recursive: true });
  const root = await mkdtemp(path.join(repository, 'tmp/notice-test-'));
  const directory = path.join(root, `registry/src/index.test/${name}-${version}`);
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
  await writeFile(path.join(cache, `${name}-${version}.crate`), archive);
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
        name,
        version,
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
    pkg: { ecosystem: 'cargo', name, version, license: 'MIT', directory },
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

test('Brotli decoder attribution and full adopted terms are retained without clearing the package gap', async () => {
  const npmPartials = await loadDesktopNpmPartialNotices(repository);
  const pkg = {
    ecosystem: 'npm',
    name: 'brotli',
    version: '1.3.3',
    license: 'MIT',
    directory: path.join(repository, 'node_modules/.pnpm/brotli@1.3.3/node_modules/brotli'),
  };
  const options = { root: repository, npmPartials, supplements: { packages: [], texts: [] } };
  const result = await collectDesktopLicenseNotices([pkg], options);
  assert.deepEqual(result.gaps, ['brotli@1.3.3']);
  assert.equal(result.provenance.length, 8);
  assert.ok(result.provenance.every((entry) => entry.packageNoticeComplete === false));
  assert.ok(result.provenance.every((entry) => entry.scopeLicense === 'Apache-2.0'));
  assert.equal(result.components[0].licenses[0].expression, 'MIT');
  assert.match(result.text, /Copyright 2013 Google Inc/u);
  assert.match(result.text, /END OF TERMS AND CONDITIONS/u);
  for (const mutation of ['tree', 'terms', 'source', 'prefix']) {
    const changed = structuredClone(npmPartials);
    if (mutation === 'tree') changed.binding.tree.sha256 = '0'.repeat(64);
    if (mutation === 'terms') changed.terms.sha256 = '0'.repeat(64);
    if (mutation === 'source') changed.sources[0].sha256 = '0'.repeat(64);
    if (mutation === 'prefix') changed.noticePrefixSha256 = '0'.repeat(64);
    await assert.rejects(
      collectDesktopLicenseNotices([pkg], { ...options, npmPartials: changed }),
      /DESKTOP_NOTICES_PARTIAL_NOTICE_/u,
    );
  }
  const unknown = await collectDesktopLicenseNotices([{ ...pkg, name: 'unknown' }], options);
  assert.deepEqual(unknown.gaps, ['unknown@1.3.3']);
  assert.equal(unknown.provenance.length, 0);
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

test('a retained licence choice must be one of the exact upstream alternatives, not a new grant', async () => {
  const f = await fixture();
  f.supplements.packages[0].selectedLicense = 'BSD-3-Clause';
  await assert.rejects(retainPackageLicenseTexts(f.pkg, f), /SUPPLEMENT_LICENSE_CHOICE/u);
  f.supplements.packages[0].selectedLicense = 'MIT';
  assert.equal((await retainPackageLicenseTexts(f.pkg, f)).length, 1);
  for (const license of ['MIT OR Apache-2.0', 'MIT/Apache-2.0']) {
    f.pkg.license = license;
    f.supplements.packages[0].license = license;
    assert.equal((await retainPackageLicenseTexts(f.pkg, f)).length, 1);
  }
  f.supplements.packages[0].license = 'MIT AND BSD-3-Clause';
  await assert.rejects(retainPackageLicenseTexts(f.pkg, f), /SUPPLEMENT_LICENSE_CHOICE/u);
});

test('old archives without a VCS path still require exact manifest/archive/commit bindings', async () => {
  const f = await fixture();
  delete f.supplements.packages[0].pathInVcs;
  f.supplements.packages[0].sourceManifestPath = 'crates/sample/Cargo.toml';
  await writeFile(
    path.join(f.directory, '.cargo_vcs_info.json'),
    JSON.stringify({ git: { sha1: 'a'.repeat(40) } }),
  );
  assert.equal((await retainPackageLicenseTexts(f.pkg, f)).length, 1);
  await writeFile(path.join(f.directory, 'Cargo.toml.orig'), 'changed');
  await assert.rejects(retainPackageLicenseTexts(f.pkg, f), /SUPPLEMENT_BINDING_MISMATCH/u);
});
test('unreadable/empty/oversized notice inputs fail, not silently become complete', async () => {
  const f = await fixture();
  await writeFile(path.join(f.directory, 'LICENSE'), '');
  await assert.rejects(retainPackageLicenseTexts(f.pkg, f), /INVALID_TEXT_FILE/u);
  await writeFile(path.join(f.directory, 'LICENSE'), Buffer.alloc(1024 * 1024 + 1, 65));
  await assert.rejects(retainPackageLicenseTexts(f.pkg, f), /INVALID_TEXT_FILE/u);
});

test('MPL reference retains full steward terms, bound source notice and exact unmodified source location', async () => {
  const f = await fixture('selectors', '0.36.1');
  const notice =
    '/* Synthetic source notice for collector QA: Mozilla Public License v. 2.0. Obtain the referenced full licence at https://mozilla.org/MPL/2.0/. */';
  const source = notice + '\nSynthetic source body\n';
  await writeFile(path.join(f.directory, 'lib.rs'), source);
  f.pkg.license = 'MPL-2.0';
  const reviewed = f.supplements.packages[0];
  reviewed.license = 'MPL-2.0';
  reviewed.licenseReference = {
    file: 'lib.rs',
    sha256: hash(source),
    notice,
    url: 'https://mozilla.org/MPL/2.0/',
    source: `https://raw.githubusercontent.com/servo/stylo/${reviewed.commit}/selectors/lib.rs`,
    sourceArchive: 'https://static.crates.io/crates/selectors/selectors-0.36.1.crate',
    unmodified: true,
  };
  f.supplements.texts[0].canonicalUrl = 'https://www.mozilla.org/MPL/2.0/index.txt';
  const result = await collectDesktopLicenseNotices([f.pkg], f);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.provenance.length, 2);
  assert.ok(result.text.includes(notice));
  assert.ok(result.text.includes(reviewed.archiveSha256));
  assert.ok(result.text.includes(reviewed.licenseReference.sourceArchive));
  assert.ok(result.text.includes('Third-party source retains its MPL-2.0 rights'));
  const retained = await retainPackageLicenseTexts(f.pkg, f);
  assert.equal(retained[1].sha256, hash(retained[1].text));
  assert.equal(retained[1].sourceSha256, hash(source));
  const reference = reviewed.licenseReference;
  for (const [key, value] of [
    ['sha256', '0'.repeat(64)],
    ['notice', 'unbound'],
    ['sourceArchive', 'https://example.invalid/source'],
    ['unmodified', false],
    ['source', 'https://example.invalid/source'],
  ]) {
    const original = reference[key];
    reference[key] = value;
    await assert.rejects(
      retainPackageLicenseTexts(f.pkg, f),
      /STANDARD_REFERENCE_(?:INVALID|MISMATCH)/u,
    );
    reference[key] = original;
  }
  await writeFile(path.join(f.directory, 'lib.rs'), 'changed');
  await assert.rejects(retainPackageLicenseTexts(f.pkg, f), /STANDARD_REFERENCE_MISMATCH/u);
});

test('MSVC metadata narrows prospective scope but never removes full-audit gaps or certifies artifacts', () => {
  const cargo = {
    workspace_members: ['root'],
    packages: [
      { id: 'root', name: 'app', version: '1.0' },
      { id: 'win', name: 'win', version: '1.0' },
      { id: 'mac', name: 'mac', version: '1.0' },
    ],
  };
  const target = { resolve: { root: 'root', nodes: [{ id: 'root' }, { id: 'win' }] } };
  const gaps = ['win@1.0', 'mac@1.0', 'npm@2.0'];
  const report = desktopNoticeScope(cargo, target, [{ name: 'npm', version: '2.0' }], gaps);
  assert.deepEqual(report.candidateGaps, ['win@1.0', 'npm@2.0']);
  assert.deepEqual(report.outsideTargetCargoGaps, ['mac@1.0']);
  assert.deepEqual(gaps, ['win@1.0', 'mac@1.0', 'npm@2.0']);
  assert.equal(report.excludedCargoCount, 1);
  assert.equal(report.finalArtifactContentsVerified, false);
  for (const resolve of [
    {},
    { root: 'root', nodes: [] },
    { root: 'root', nodes: [{ id: 'root' }, { id: 'unknown' }] },
  ])
    assert.throws(() => desktopNoticeScope(cargo, { resolve }, [], []), /TARGET_GRAPH_INVALID/u);
});
test('reviewed real source texts and metadata stay integrity bound, without granting release approval', async () => {
  const manifest = await loadDesktopLicenseSupplements(repository);
  assert.equal(manifest.publicReleaseApproved, false);
  assert.equal(manifest.packages.length, 22);
  assert.ok(manifest.packages.every((pkg) => /^[a-f0-9]{64}$/u.test(pkg.archiveSha256)));
  const text = await readFile(path.join(repository, manifest.texts[0].path), 'utf8');
  assert.match(text, /Copyright \(c\) 2021 Bill Avery/u);
  assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS"/u);
  for (const pkg of manifest.packages) {
    const retained = manifest.texts.find((entry) => entry.id === pkg.textId);
    assert.ok(retained, `Missing retained text for ${pkg.name}`);
    assert.ok(
      pkg.licenseReference
        ? pkg.licenseReference.source.includes(`/${pkg.commit}/`)
        : retained.sources.some((source) => source.includes(`/${pkg.commit}/`)),
    );
    assert.match(pkg.manifestSha256, /^[a-f0-9]{64}$/u);
    if (pkg.selectedLicense) {
      assert.ok(pkg.license.replaceAll('/', ' OR ').split(' OR ').includes(pkg.selectedLicense));
      assert.match(pkg.sourceManifestSha256, /^[a-f0-9]{64}$/u);
      assert.ok(['byte-identical', 'line-endings-only'].includes(pkg.sourceManifestComparison));
      assert.equal(
        pkg.sourceManifestSha256 === pkg.manifestSha256,
        pkg.sourceManifestComparison === 'byte-identical',
      );
    }
  }
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
