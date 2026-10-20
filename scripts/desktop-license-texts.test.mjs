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
  loadFontkitDerivedNotice,
  retainPackageLicenseTexts,
} from './desktop-license-texts.mjs';
import { desktopNoticeScope } from './desktop-notice-scope.mjs';
import { brotliDictionaryEvidence } from './brotli-dictionary-evidence.mjs';
import { brotliCompressSync } from 'node:zlib';
import { installedNpmEvidence, npmTreeEvidence } from './npm-notice-evidence.mjs';

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

function syntheticDictionary() {
  const bytes = Buffer.from(Array.from({ length: 122784 }, (_, index) => index % 256));
  return {
    source: Buffer.from(
      `exports.dictionary = new Uint8Array([${[...bytes].map((value) => `0x${value.toString(16).padStart(2, '0')},`).join('')}]);`,
    ),
    packed: Buffer.from(`module.exports="${brotliCompressSync(bytes).toString('base64')}";`),
  };
}

test('historical partial-notice retention refuses gaps and drift using self-contained synthetic inputs', async () => {
  const npmPartials = await loadDesktopNpmPartialNotices(repository);
  const f = await fixture();
  const prefix =
    '/* Copyright 2026 Synthetic Test Authors.\nhttp://www.apache.org/licenses/LICENSE-2.0\nlimitations under the License.\n';
  npmPartials.noticePrefixSha256 = hash(prefix);
  for (const source of npmPartials.sources) {
    const content = Buffer.from(
      prefix + '*/\n// Synthetic collector control, not upstream code.\n',
    );
    await mkdir(path.dirname(path.join(f.directory, source.file)), { recursive: true });
    await writeFile(path.join(f.directory, source.file), content);
    source.sha256 = hash(content);
  }
  const dictionary = syntheticDictionary();
  const source = Buffer.concat([Buffer.from(prefix + '*/\n'), dictionary.source]);
  const packed = dictionary.packed;
  npmPartials.sources.find((item) => item.file === 'dec/dictionary-data.js').sha256 = hash(source);
  await writeFile(path.join(f.directory, 'dec/dictionary-data.js'), source);
  await writeFile(path.join(f.directory, 'dec/dictionary.bin.js'), packed);
  Object.assign(npmPartials.derivedPayloads[0], brotliDictionaryEvidence(source, packed));
  npmPartials.binding.tree = npmTreeEvidence(await installedNpmEvidence(f.directory));
  const pkg = {
    ecosystem: 'npm',
    name: 'brotli',
    version: '1.3.3',
    license: 'MIT',
    directory: f.directory,
  };
  const options = { root: repository, npmPartials, supplements: { packages: [], texts: [] } };
  const result = await collectDesktopLicenseNotices([pkg], options);
  assert.deepEqual(result.gaps, ['brotli@1.3.3']);
  assert.equal(result.provenance.length, 9);
  const retainedDictionary = result.provenance.find(
    (entry) => entry.origin === 'reviewed-partial-npm-derived-data-notice',
  );
  assert.equal(retainedDictionary?.file, 'dec/dictionary.bin.js');
  assert.equal(retainedDictionary?.derivation.bytes, 122784);
  assert.ok(result.provenance.every((entry) => entry.packageNoticeComplete === false));
  assert.ok(result.provenance.every((entry) => entry.scopeLicense === 'Apache-2.0'));
  assert.equal(result.components[0].licenses[0].expression, 'MIT');
  assert.match(result.text, /Copyright 2026 Synthetic Test Authors/u);
  assert.match(result.text, /END OF TERMS AND CONDITIONS/u);
  for (const mutation of ['tree', 'terms', 'source', 'prefix', 'dictionary']) {
    const changed = structuredClone(npmPartials);
    if (mutation === 'tree') changed.binding.tree.sha256 = '0'.repeat(64);
    if (mutation === 'terms') changed.terms.sha256 = '0'.repeat(64);
    if (mutation === 'source') changed.sources[0].sha256 = '0'.repeat(64);
    if (mutation === 'prefix') changed.noticePrefixSha256 = '0'.repeat(64);
    if (mutation === 'dictionary') changed.derivedPayloads[0].sha256 = '0'.repeat(64);
    await assert.rejects(
      collectDesktopLicenseNotices([pkg], { ...options, npmPartials: changed }),
      /DESKTOP_NOTICES_PARTIAL_NOTICE_/u,
    );
  }
  const unknown = await collectDesktopLicenseNotices([{ ...pkg, name: 'unknown' }], options);
  assert.deepEqual(unknown.gaps, ['unknown@1.3.3']);
  assert.equal(unknown.provenance.length, 0);
});

test('Brotli browser dictionary evidence refuses code, corruption, mismatches and excessive decoded bytes without executing package code', async () => {
  const { source, packed } = syntheticDictionary();
  assert.equal(brotliDictionaryEvidence(source, packed).bytes, 122784);
  const oversized = Buffer.from(
    `module.exports="${brotliCompressSync(Buffer.alloc(122785)).toString('base64')}";`,
  );
  for (const [raw, payload] of [
    [source, Buffer.concat([packed, Buffer.from('globalThis.executed = true;')])],
    [Buffer.from(source.toString('utf8').replace('0x74', '0x75')), packed],
    [source, Buffer.from('module.exports="AAAA";')],
    [source, oversized],
    [Buffer.concat([source, source]), packed],
    [source, Buffer.alloc(128 * 1024 + 1)],
  ])
    assert.throws(
      () => brotliDictionaryEvidence(raw, payload),
      /^Error: BROTLI_DICTIONARY_EVIDENCE_INVALID$/u,
    );
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

test('Fontkit inherited Base64 notice is retained without inventing project permission', async () => {
  const fontkitDerivative = await loadFontkitDerivedNotice(repository);
  const f = await fixture();
  await mkdir(path.join(f.directory, 'src'));
  const content = Buffer.from(
    fontkitDerivative.attribution + '\n// Synthetic collector input, not Fontkit implementation.\n',
  );
  await writeFile(path.join(f.directory, 'src/utils.js'), content);
  fontkitDerivative.sourceSha256 = hash(content);
  fontkitDerivative.binding.tree = npmTreeEvidence(await installedNpmEvidence(f.directory));
  const pkg = {
    ecosystem: 'npm',
    name: 'fontkit',
    version: '2.0.4',
    license: 'MIT',
    directory: f.directory,
  };
  const options = { root: repository, fontkitDerivative, supplements: { packages: [], texts: [] } };
  const result = await collectDesktopLicenseNotices([pkg], options);
  assert.deepEqual(result.gaps, ['fontkit@2.0.4']);
  assert.equal(result.provenance.length, 1);
  assert.equal(result.provenance[0].packageNoticeComplete, false);
  assert.match(result.text, /Copyright \(c\) 2012 Niklas von Hertzen/u);
  assert.match(result.text, /project terms remain unresolved/u);
  for (const mutation of [
    'tree',
    'source',
    'attribution',
    'terms',
    'blob',
    'commit',
    'approval',
    'complete',
    'license',
  ]) {
    const changed = structuredClone(fontkitDerivative);
    if (mutation === 'tree') changed.binding.tree.sha256 = '0'.repeat(64);
    if (mutation === 'source') changed.sourceSha256 = '0'.repeat(64);
    if (mutation === 'attribution') changed.attribution = 'changed';
    if (mutation === 'terms') changed.terms.sha256 = '0'.repeat(64);
    if (mutation === 'blob') changed.terms.gitBlob = '0'.repeat(40);
    if (mutation === 'commit') changed.commit = '0'.repeat(40);
    if (mutation === 'approval') changed.publicReleaseApproved = true;
    if (mutation === 'complete') changed.packageNoticeComplete = true;
    if (mutation === 'license') changed.terms.license = 'other';
    await assert.rejects(
      collectDesktopLicenseNotices([pkg], { ...options, fontkitDerivative: changed }),
      /DESKTOP_NOTICES_DERIVATIVE_NOTICE_/u,
    );
  }
  const other = await collectDesktopLicenseNotices([{ ...pkg, name: 'unknown' }], options);
  assert.deepEqual(other.gaps, ['unknown@2.0.4']);
  assert.equal(other.provenance.length, 0);
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
