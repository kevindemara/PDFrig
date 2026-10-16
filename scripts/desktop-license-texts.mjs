// Notice retention is not licence compatibility, legal advice or artifact approval.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

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

/** Reads only packaged notice files or exact-version/source reviewed supplements.
 * Does not fetch dependencies, synthesize templates or treat a README as a licence. */
export async function retainPackageLicenseTexts(pkg, { root, supplements }) {
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
  return [
    {
      file: textEntry.path,
      sha256: hash(bytes),
      origin: 'reviewed-source-supplement',
      commit: reviewed.commit,
      text: bytes.toString('utf8'),
    },
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
    if (!files.length) gaps.push(`${pkg.name}@${pkg.version}`);
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
