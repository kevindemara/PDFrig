// Notice retention is not licence compatibility, legal advice or artifact approval.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { installedNpmEvidence, npmTreeEvidence } from './npm-notice-evidence.mjs';
import { brotliDictionaryEvidence } from './brotli-dictionary-evidence.mjs';

const fail = (code) => {
  throw new Error(`DESKTOP_NOTICES_${code}`);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const selectedBranchMatches = (entry) =>
  entry.selectedLicense === undefined ||
  (typeof entry.license === 'string' &&
    typeof entry.selectedLicense === 'string' &&
    entry.license.replaceAll('/', ' OR ').split(' OR ').includes(entry.selectedLicense));
const within = (root, file) => {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};
async function boundedFile(directory, filename, max = 1024 * 1024) {
  const resolved = path.resolve(directory, filename);
  if (!within(directory, resolved)) return fail('UNSAFE_TEXT_PATH');
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > max)
    return fail('INVALID_TEXT_FILE');
  if (!within(await realpath(directory), await realpath(resolved))) return fail('UNSAFE_TEXT_PATH');
  return readFile(resolved);
}

export async function loadDesktopLicenseSupplements(root) {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'docs/dependencies/desktop-license-supplements.json'), 'utf8'),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.publicReleaseApproved !== false ||
    !Array.isArray(manifest.packages) ||
    !Array.isArray(manifest.texts)
  )
    return fail('INVALID_SUPPLEMENTS');
  const ids = new Set();
  for (const entry of manifest.packages) {
    if (!selectedBranchMatches(entry)) return fail('SUPPLEMENT_LICENSE_CHOICE');
    const id = `${entry.name}@${entry.version}`;
    if (ids.has(id)) return fail('DUPLICATE_SUPPLEMENT');
    ids.add(id);
  }
  const textIds = new Set();
  for (const entry of manifest.texts) {
    if (textIds.has(entry.id)) return fail('DUPLICATE_SUPPLEMENT');
    textIds.add(entry.id);
    const text = await boundedFile(root, entry.path);
    if (
      hash(text) !== entry.sha256 ||
      createHash('sha1').update(`blob ${text.length}\0`).update(text).digest('hex') !==
        entry.gitBlob
    )
      return fail('SUPPLEMENT_TEXT_MISMATCH');
  }
  return manifest;
}

export async function loadDesktopNpmPartialNotices(root) {
  const partial = JSON.parse(
    (await boundedFile(root, 'docs/dependencies/desktop-npm-partial-notices.json')).toString(
      'utf8',
    ),
  );
  const review = JSON.parse(
    (await boundedFile(root, 'docs/dependencies/windows-npm-notice-review.json')).toString('utf8'),
  );
  if (
    review.publicReleaseApproved !== false ||
    review.allNoticesComplete !== false ||
    partial.schemaVersion !== 1 ||
    partial.publicReleaseApproved !== false ||
    partial.packageNoticeComplete !== false ||
    partial.name !== 'brotli' ||
    partial.version !== '1.3.3' ||
    partial.license !== 'Apache-2.0' ||
    partial.sourceLicenseUrl !== 'http://www.apache.org/licenses/LICENSE-2.0' ||
    partial.terms.source !== 'https://www.apache.org/licenses/LICENSE-2.0.txt' ||
    partial.terms.sha256 !== 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' ||
    partial.sources.length !== 7 ||
    new Set(partial.sources.map((entry) => entry.file)).size !== 7 ||
    partial.derivedPayloads?.length !== 1 ||
    partial.derivedPayloads[0].file !== 'dec/dictionary.bin.js' ||
    partial.derivedPayloads[0].sourceFile !== 'dec/dictionary-data.js' ||
    partial.derivedPayloads[0].encoding !== 'brotli-base64-js-literal'
  )
    return fail('PARTIAL_NOTICE_INVALID');
  const binding = [...review.packages, ...review.removedInputs].find(
    (entry) => entry.name === partial.name && entry.version === partial.version,
  );
  if (!binding || binding.noticeComplete !== false || binding.gitHead !== partial.commit)
    return fail('PARTIAL_NOTICE_BINDING');
  return { ...partial, binding };
}

async function retainPartialNpmNotice(pkg, { root, npmPartials }) {
  if (!npmPartials || pkg.name !== npmPartials.name || pkg.version !== npmPartials.version)
    return [];
  const partial = npmPartials;
  const files = await installedNpmEvidence(pkg.directory);
  const tree = npmTreeEvidence(files);
  if (!['files', 'bytes', 'sha256'].every((key) => tree[key] === partial.binding.tree[key]))
    return fail('PARTIAL_NOTICE_BINDING');
  const terms = await boundedFile(root, partial.terms.path);
  if (hash(terms) !== partial.terms.sha256) return fail('PARTIAL_NOTICE_TEXT');
  const retained = [
    {
      file: partial.terms.path,
      sha256: hash(terms),
      origin: 'reviewed-partial-npm-terms',
      packageNoticeComplete: false,
      scopeLicense: partial.license,
      commit: partial.commit,
      text: terms.toString('utf8'),
    },
  ];
  for (const source of partial.sources) {
    const bytes = await boundedFile(pkg.directory, source.file);
    const prefix = bytes
      .toString('utf8')
      .match(/^\/\* Copyright[\s\S]*?limitations under the License\.\n/u)?.[0];
    if (
      hash(bytes) !== source.sha256 ||
      !prefix ||
      hash(Buffer.from(prefix)) !== partial.noticePrefixSha256 ||
      !prefix.includes(partial.sourceLicenseUrl)
    )
      return fail('PARTIAL_NOTICE_SOURCE');
    retained.push({
      file: source.file,
      sha256: hash(Buffer.from(prefix)),
      sourceSha256: hash(bytes),
      origin: 'reviewed-partial-npm-source-notice',
      packageNoticeComplete: false,
      scopeLicense: partial.license,
      commit: partial.commit,
      text: prefix,
    });
  }
  for (const payload of partial.derivedPayloads) {
    const source = await boundedFile(pkg.directory, payload.sourceFile);
    const packed = await boundedFile(pkg.directory, payload.file);
    let evidence;
    try {
      evidence = brotliDictionaryEvidence(source, packed);
    } catch {
      return fail('PARTIAL_NOTICE_DICTIONARY');
    }
    if (
      !['sourceSha256', 'payloadSha256', 'bytes', 'sha256'].every(
        (key) => evidence[key] === payload[key],
      ) ||
      !partial.sources.some(
        (entry) => entry.file === payload.sourceFile && entry.sha256 === payload.sourceSha256,
      )
    )
      return fail('PARTIAL_NOTICE_DICTIONARY');
    const notice = retained.find((entry) => entry.file === payload.sourceFile);
    if (!notice) return fail('PARTIAL_NOTICE_DICTIONARY');
    retained.push({
      file: payload.file,
      sha256: notice.sha256,
      sourceSha256: payload.payloadSha256,
      origin: 'reviewed-partial-npm-derived-data-notice',
      packageNoticeComplete: false,
      scopeLicense: partial.license,
      commit: partial.commit,
      derivation: { source: payload.sourceFile, bytes: payload.bytes, sha256: payload.sha256 },
      text: notice.text,
    });
  }
  return retained;
}

export async function loadFontkitDerivedNotice(root) {
  const partial = JSON.parse(
    (await boundedFile(root, 'docs/dependencies/fontkit-derived-notice.json')).toString('utf8'),
  );
  const review = JSON.parse(
    (await boundedFile(root, 'docs/dependencies/windows-npm-notice-review.json')).toString('utf8'),
  );
  if (
    partial.schemaVersion !== 1 ||
    partial.publicReleaseApproved !== false ||
    partial.packageNoticeComplete !== false ||
    partial.name !== 'fontkit' ||
    partial.version !== '2.0.4' ||
    partial.commit !== 'fbf3b9ef21eebd219eb73e666faed573af0fba09' ||
    partial.file !== 'src/utils.js' ||
    partial.sourceSha256 !== '3924250ad3044efdb5f0d3c07b8061a95b4ffea99b024b66ff4dcf643d824aef' ||
    partial.upstream.commit !== '5339d8f0abed59c893e87116a785bf52acdc17aa' ||
    partial.upstream.source !==
      `https://raw.githubusercontent.com/niklasvh/base64-arraybuffer/${partial.upstream.commit}/src/index.ts` ||
    partial.upstream.sourceSha256 !==
      'de5d6002ea60ce936013c75e3633ffe13c55d6fb7f6feb12af64134097dadc56' ||
    partial.upstream.terms !==
      `https://raw.githubusercontent.com/niklasvh/base64-arraybuffer/${partial.upstream.commit}/LICENSE` ||
    partial.terms.license !== 'MIT' ||
    partial.terms.sha256 !== 'f3eca6ff762533fa5a77caf954a143e48afa204668cf97dce758c45a9e006be3' ||
    partial.terms.gitBlob !== 'ed27b41b252ac2adbbbb3dfd6606a32c972948e9' ||
    review.publicReleaseApproved !== false ||
    review.allNoticesComplete !== false
  )
    return fail('DERIVATIVE_NOTICE_INVALID');
  const binding = [...review.packages, ...review.removedInputs].find(
    (entry) => entry.name === partial.name && entry.version === partial.version,
  );
  if (!binding || binding.noticeComplete !== false || binding.gitHead !== partial.commit)
    return fail('DERIVATIVE_NOTICE_BINDING');
  return { ...partial, binding };
}

async function retainFontkitDerivative(pkg, { root, fontkitDerivative }) {
  if (!fontkitDerivative || pkg.name !== 'fontkit' || pkg.version !== '2.0.4') return [];
  const partial = fontkitDerivative;
  if (
    partial.name !== pkg.name ||
    partial.version !== pkg.version ||
    partial.commit !== partial.binding.gitHead ||
    partial.binding.noticeComplete !== false ||
    partial.publicReleaseApproved !== false ||
    partial.packageNoticeComplete !== false ||
    partial.upstream.commit !== '5339d8f0abed59c893e87116a785bf52acdc17aa' ||
    partial.terms.license !== 'MIT'
  )
    return fail('DERIVATIVE_NOTICE_BINDING');
  const tree = npmTreeEvidence(await installedNpmEvidence(pkg.directory));
  if (!['files', 'bytes', 'sha256'].every((key) => tree[key] === partial.binding.tree[key]))
    return fail('DERIVATIVE_NOTICE_BINDING');
  const source = await boundedFile(pkg.directory, partial.file);
  const attribution = '// Based on https://github.com/niklasvh/base64-arraybuffer. MIT license.';
  if (
    hash(source) !== partial.sourceSha256 ||
    partial.attribution !== attribution ||
    !source.toString('utf8').includes(attribution)
  )
    return fail('DERIVATIVE_NOTICE_SOURCE');
  const terms = await boundedFile(root, partial.terms.path);
  if (
    hash(terms) !== partial.terms.sha256 ||
    createHash('sha1').update(`blob ${terms.length}\0`).update(terms).digest('hex') !==
      partial.terms.gitBlob
  )
    return fail('DERIVATIVE_NOTICE_TEXT');
  return [
    {
      file: partial.terms.path,
      sha256: hash(terms),
      sourceSha256: hash(source),
      origin: 'reviewed-partial-npm-derivative-terms',
      packageNoticeComplete: false,
      scopeLicense: 'MIT',
      commit: partial.commit,
      upstreamCommit: partial.upstream.commit,
      text: `${partial.name} ${partial.version} ${partial.file}\n${attribution}\nUpstream terms: ${partial.upstream.terms}\nScope: inherited Base64 decoder only; project terms remain unresolved.\n\n${terms.toString('utf8')}`,
    },
  ];
}

/** Reads only packaged notice files or exact-version/source reviewed supplements.
 * Does not fetch dependencies, synthesize templates or treat a README as a licence. */
export async function retainPackageLicenseTexts(
  pkg,
  { root, supplements, npmPartials, fontkitDerivative },
) {
  if (
    !/^(?:@[a-z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/u.test(pkg.name) ||
    !/^[a-zA-Z0-9.+_-]{1,100}$/u.test(pkg.version)
  )
    return fail('INVALID_PACKAGE');
  const entries = await readdir(pkg.directory, { withFileTypes: true });
  const candidates = new Set(
    entries
      .filter(
        (entry) => entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:[-._]|$)/iu.test(entry.name),
      )
      .map((entry) => entry.name),
  );
  if (pkg.licenseFile) candidates.add(pkg.licenseFile);
  if (candidates.size > 32) return fail('TEXT_LIMIT');
  const retained = [];
  for (const file of [...candidates].sort()) {
    if (/[\r\n\0]/u.test(file)) return fail('UNSAFE_TEXT_PATH');
    const bytes = await boundedFile(pkg.directory, file);
    retained.push({
      file: path.relative(pkg.directory, path.resolve(pkg.directory, file)).replaceAll('\\', '/'),
      sha256: hash(bytes),
      origin: 'packaged',
      text: bytes.toString('utf8'),
    });
  }
  if (pkg.ecosystem === 'npm')
    return [
      ...retained,
      ...(await retainPartialNpmNotice(pkg, { root, npmPartials })),
      ...(await retainFontkitDerivative(pkg, { root, fontkitDerivative })),
    ];
  if (retained.length || pkg.ecosystem !== 'cargo') return retained;
  const matches = supplements.packages.filter(
    (entry) => entry.name === pkg.name && entry.version === pkg.version,
  );
  if (!matches.length) return [];
  if (matches.length !== 1) return fail('DUPLICATE_SUPPLEMENT');
  const reviewed = matches[0];
  if (!selectedBranchMatches(reviewed)) return fail('SUPPLEMENT_LICENSE_CHOICE');
  const registry = path.dirname(pkg.directory);
  if (
    path.basename(pkg.directory) !== `${pkg.name}-${pkg.version}` ||
    path.basename(path.dirname(registry)) !== 'src' ||
    path.basename(path.dirname(path.dirname(registry))) !== 'registry' ||
    reviewed.license !== pkg.license
  )
    return fail('SUPPLEMENT_BINDING_MISMATCH');
  const vcs = JSON.parse(
    (await boundedFile(pkg.directory, '.cargo_vcs_info.json')).toString('utf8'),
  );
  const manifest = await boundedFile(pkg.directory, 'Cargo.toml.orig');
  const cache = path.join(path.dirname(path.dirname(registry)), 'cache', path.basename(registry));
  const archive = await boundedFile(cache, `${pkg.name}-${pkg.version}.crate`, 16 * 1024 * 1024);
  if (
    vcs.git?.sha1 !== reviewed.commit ||
    vcs.path_in_vcs !== reviewed.pathInVcs ||
    hash(manifest) !== reviewed.manifestSha256 ||
    hash(archive) !== reviewed.archiveSha256
  )
    return fail('SUPPLEMENT_BINDING_MISMATCH');
  const textEntry = supplements.texts.find((entry) => entry.id === reviewed.textId);
  if (!textEntry) return fail('SUPPLEMENT_TEXT_MISSING');
  const bytes = await boundedFile(root, textEntry.path);
  if (hash(bytes) !== textEntry.sha256) return fail('SUPPLEMENT_TEXT_MISMATCH');
  const reference = reviewed.licenseReference;
  let sourceNotice;
  if (reference) {
    if (
      pkg.name !== 'selectors' ||
      pkg.version !== '0.36.1' ||
      reviewed.license !== 'MPL-2.0' ||
      reference.unmodified !== true ||
      reference.file !== 'lib.rs' ||
      typeof reference.notice !== 'string' ||
      reference.notice.length < 100 ||
      reference.notice.length > 2048 ||
      reference.source !==
        `https://raw.githubusercontent.com/servo/stylo/${reviewed.commit}/selectors/lib.rs` ||
      reference.url !== 'https://mozilla.org/MPL/2.0/' ||
      reference.sourceArchive !==
        `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate` ||
      textEntry.canonicalUrl !== 'https://www.mozilla.org/MPL/2.0/index.txt'
    )
      return fail('STANDARD_REFERENCE_INVALID');
    const source = await boundedFile(pkg.directory, reference.file);
    if (
      hash(source) !== reference.sha256 ||
      !source.toString('utf8').startsWith(reference.notice) ||
      !reference.notice.includes(reference.url)
    )
      return fail('STANDARD_REFERENCE_MISMATCH');
    const noticeText = `${reference.notice}\n\nUnmodified ${pkg.name} ${pkg.version} source is available at:\n${reference.sourceArchive}\nSHA-256 ${reviewed.archiveSha256}\nThird-party source retains its MPL-2.0 rights; PDFrig terms do not restrict those rights.\n`;
    sourceNotice = {
      file: reference.file,
      sha256: hash(Buffer.from(noticeText)),
      sourceSha256: hash(source),
      origin: 'reviewed-standard-license-reference',
      commit: reviewed.commit,
      text: noticeText,
    };
  }
  return [
    {
      file: textEntry.path,
      sha256: hash(bytes),
      origin: 'reviewed-source-supplement',
      commit: reviewed.commit,
      ...(reviewed.selectedLicense ? { selectedLicense: reviewed.selectedLicense } : {}),
      text: bytes.toString('utf8'),
    },
    ...(sourceNotice ? [sourceNotice] : []),
  ];
}

export async function collectDesktopLicenseNotices(packages, options) {
  const components = new Map(),
    gaps = [],
    provenance = [],
    texts = [
      'Upstream licence texts for an internal build-input inventory. Includes optional/build dependencies; not a final-artifact SBOM, legal certification or public-release approval.\n',
    ];
  for (const pkg of packages) {
    const purl = `pkg:${pkg.ecosystem}/${pkg.name.replace('@', '%40')}@${pkg.version}`;
    components.set(purl, {
      type: 'library',
      name: pkg.name,
      version: pkg.version,
      purl,
      licenses: pkg.license ? [{ expression: pkg.license }] : [],
    });
    const files = await retainPackageLicenseTexts(pkg, options);
    // Retaining an explicit vendored-component notice must not clear the
    // package's other missing terms, binary/data attribution or provenance.
    if (!files.some((file) => file.packageNoticeComplete !== false))
      gaps.push(`${pkg.name}@${pkg.version}`);
    for (const { text, ...evidence } of files) {
      provenance.push({ purl, ...evidence });
      texts.push(`\n=== ${pkg.name} ${pkg.version} ${evidence.file} ===\n${text}\n`);
    }
  }
  return {
    components: [...components.values()],
    gaps: [...new Set(gaps)].sort(),
    provenance,
    text: texts.join('\n'),
  };
}
