// Repackage only the hash-bound, already reviewed Windows application payload.
// No compilation, installer execution, downloads, registration or release upload.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const PORTABLE_ARTIFACT_ID = 'private-test-20261020-2';
export const PORTABLE_ZIP_NAME = 'PDFrig-portable-windows-x64.zip';
export const LOCAL_PORTABLE_ID = 'local-portable-20261024-tables-ocr';
const inputs = [
  ['pdfmason-desktop.exe', 'PDFrig.exe'],
  ['licenses/PDFrig-LICENSE.txt', 'licenses/PDFrig-LICENSE.txt'],
  ['licenses/THIRD_PARTY_NOTICES.txt', 'licenses/THIRD_PARTY_NOTICES.txt'],
  ['licenses/UPSTREAM-LICENSE-TEXTS.txt', 'licenses/UPSTREAM-LICENSE-TEXTS.txt'],
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function plainFile(directory, relative) {
  let current = directory;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw new Error('PORTABLE_SOURCE_NOT_PLAIN_FILE');
    if (i === parts.length - 1 && info.size > 64 * 1024 * 1024)
      throw new Error('PORTABLE_SOURCE_TOO_LARGE');
  }
  return readFile(current);
}

/** The caller supplies a reviewed pin; the CLI always loads the repository audit. */
export async function preparePortableDirectory({ source, output, artifact, instructions }) {
  const localBuild =
    artifact?.id === LOCAL_PORTABLE_ID &&
    artifact.localBuild?.publicReleaseApproved === false &&
    artifact.localBuild?.manualAcceptancePending === true &&
    /^[a-f0-9]{64}$/u.test(artifact.localBuild?.sourceSnapshotSha256);
  if (
    (!localBuild && artifact?.id !== PORTABLE_ARTIFACT_ID) ||
    !/^[a-f0-9]{40}$/u.test(artifact.installer?.sourceCommit)
  )
    throw new Error('PORTABLE_ARTIFACT_UNREVIEWED');
  const sourceRoot = await realpath(source);
  const destination = path.resolve(output);
  const sourceRelative = path.relative(sourceRoot, destination);
  if (
    sourceRelative === '' ||
    (!sourceRelative.startsWith(`..${path.sep}`) &&
      sourceRelative !== '..' &&
      !path.isAbsolute(sourceRelative))
  )
    throw new Error('PORTABLE_OUTPUT_INSIDE_SOURCE');
  // Read and verify the complete allowlist before creating any output. Never copy
  // profiles, documents, NSIS plugins, uninstallers, unknown DLLs or test keys.
  const payload = [];
  for (const [input, name] of inputs) {
    const matches = artifact.payload.filter((entry) => entry.path === input);
    if (matches.length !== 1) throw new Error('PORTABLE_PIN_MISSING');
    const bytes = await plainFile(sourceRoot, input);
    if (bytes.length !== matches[0].bytes || sha256(bytes) !== matches[0].sha256)
      throw new Error('PORTABLE_PAYLOAD_HASH_MISMATCH');
    payload.push({ name, bytes, sha256: sha256(bytes) });
  }
  if (payload[0].bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('PORTABLE_EXE_INVALID');
  if (typeof instructions !== 'string' || !instructions.includes('WebView2'))
    throw new Error('PORTABLE_INSTRUCTIONS_REQUIRED');
  // mkdir without recursive/force refuses existing files, directories and links.
  // Failed attempts are left for inspection; no automatic recursive deletion.
  await mkdir(destination);
  const application = path.join(destination, 'PDFrig');
  await mkdir(application);
  await mkdir(path.join(application, 'licenses'));
  for (const entry of payload)
    await writeFile(path.join(application, entry.name), entry.bytes, { flag: 'wx' });
  const info = {
    schemaVersion: 1,
    application: 'PDFrig',
    version: localBuild ? artifact.localBuild.version : '0.1.0-alpha.20261020.2',
    architecture: 'windows-x64',
    sourceArtifact: artifact.id,
    sourceCommit: artifact.installer.sourceCommit,
    installerSha256: localBuild ? null : artifact.installer.sha256,
    executable: { path: 'PDFrig.exe', bytes: payload[0].bytes.length, sha256: payload[0].sha256 },
    rebuilt: Boolean(localBuild),
    ...(localBuild
      ? {
          sourceSnapshotSha256: artifact.localBuild.sourceSnapshotSha256,
          sourceWorktreeModified: true,
          features: artifact.localBuild.features,
        }
      : {}),
    authenticodeSigned: false,
    webview2Bundled: false,
    settingsLocation: localBuild
      ? 'Separate local test app identity in the Windows user profile; not beside the executable.'
      : 'Existing PDFrig Windows user-profile storage; not beside the executable.',
    installerAndPortableShareSettings: !localBuild,
    publicReleaseApproved: false,
    manualAcceptancePending: true,
  };
  const documents = [
    { name: 'READ_FIRST.txt', bytes: Buffer.from(instructions) },
    { name: 'BUILD_INFO.json', bytes: Buffer.from(JSON.stringify(info, null, 2) + '\n') },
  ];
  for (const entry of documents)
    await writeFile(path.join(application, entry.name), entry.bytes, { flag: 'wx' });
  await writeFile(
    path.join(application, 'SHA256SUMS.txt'),
    [...payload, ...documents].map((entry) => `${sha256(entry.bytes)}  ${entry.name}\n`).join(''),
    { flag: 'wx' },
  );
  return { application, info };
}

export async function writePortableArchive(output) {
  const archive = path.resolve(output, PORTABLE_ZIP_NAME);
  const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', archive, '-C', path.resolve(output), 'PDFrig'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const bytes = await readFile(archive);
  if (bytes.length > 64 * 1024 * 1024 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw new Error('PORTABLE_ZIP_INVALID');
  const hash = sha256(bytes);
  await writeFile(path.resolve(output, 'SHA256SUMS.txt'), `${hash}  ${PORTABLE_ZIP_NAME}\n`, {
    flag: 'wx',
  });
  return { archive, sha256: hash, bytes: bytes.length };
}

export async function packagePortableWindows({ source, output }) {
  if (process.platform !== 'win32' || !process.env.SystemRoot)
    throw new Error('PORTABLE_PACKAGING_REQUIRES_WINDOWS');
  const audit = JSON.parse(
    await readFile(
      path.join(root, 'docs/dependencies/windows-installer-dependency-audit.json'),
      'utf8',
    ),
  );
  const artifact = audit.artifacts.find((entry) => entry.id === PORTABLE_ARTIFACT_ID);
  const instructions = await readFile(
    path.join(root, 'docs/operations/windows-portable-read-first.txt'),
    'utf8',
  );
  const result = await preparePortableDirectory({ source, output, artifact, instructions });
  // Windows' existing bsdtar writes ZIP directly. No downloaded archiver or
  // PowerShell policy override. Arguments are passed separately without a shell.
  return { ...result, ...(await writePortableArchive(output)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--output') {
    console.error(
      'Usage: pnpm desktop:portable --source <reviewed extracted/installed payload> --output <unused directory>',
    );
    process.exitCode = 1;
  } else {
    const result = await packagePortableWindows({ source: args[1], output: args[3] });
    console.log(
      `Portable ZIP prepared locally: ${result.archive}\nSHA-256 ${result.sha256}\nNo installer ran. Manual acceptance and release review remain pending; nothing was uploaded.`,
    );
  }
}
