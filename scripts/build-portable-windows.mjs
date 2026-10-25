// Local source-build candidate only. No installer, publisher signing, upload or
// permission to clear public release/native OCR gates.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryFiles } from './repository-files.mjs';
import { prepareDesktopNotices } from './prepare-desktop-notices.mjs';
import {
  LOCAL_PORTABLE_ID,
  preparePortableDirectory,
  writePortableArchive,
} from './package-portable-windows.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function portableBuildEnvironment(environment) {
  const safe = Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !/^(?:VITE_|TAURI_SIGNING_|PDFMASON_WINDOWS_)/u.test(name),
    ),
  );
  return {
    ...safe,
    CARGO_NET_OFFLINE: 'true',
    VITE_PDFMASON_ENTITLEMENT_ENFORCED: 'false',
    ...Object.fromEntries(
      ['COMMENT_REVIEW', 'MEASUREMENT', 'STAMPS', 'TEXT', 'TABLES', 'OCR'].map((feature) => [
        `VITE_PDFMASON_${feature}_ENABLED`,
        'true',
      ]),
    ),
    VITE_PDFMASON_PERMISSIONS_ENABLED: 'false',
    VITE_PDFMASON_REDACTION_ENABLED: 'false',
  };
}
export function portableBuildConfig() {
  return {
    productName: 'PDFrig',
    version: '0.1.0-alpha.20261024.2',
    identifier: 'com.pdfrig.desktop.portabletest',
    app: {
      windows: [
        {
          label: 'main',
          title: 'PDFrig',
          width: 1440,
          height: 960,
          minWidth: 760,
          minHeight: 600,
          dragDropEnabled: false,
          resizable: true,
        },
      ],
    },
    bundle: { active: false, createUpdaterArtifacts: false, fileAssociations: [] },
    // The plugin requires this string at startup even with no update endpoints.
    // Empty verification material + no endpoints provides no update channel.
    plugins: { updater: { endpoints: [], pubkey: '' } },
  };
}
async function sourceSnapshot() {
  const files = await repositoryFiles();
  const entries = await Promise.all(
    files.map(async (file) => ({
      path: file.relative,
      sha256: digest(await readFile(file.absolute)),
    })),
  );
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { sha256: digest(JSON.stringify(entries)), entries };
}
async function build(output) {
  if (process.platform !== 'win32' || process.arch !== 'x64' || !process.env.npm_execpath)
    throw new Error('PORTABLE_BUILD_REQUIRES_WINDOWS_X64_PNPM');
  const pnpmCli = process.env.npm_execpath;
  const environment = portableBuildEnvironment(process.env);
  const run = (args) =>
    execFileSync(process.execPath, [pnpmCli, ...args], {
      cwd: root,
      env: environment,
      stdio: 'inherit',
    });
  // Source hygiene and dependency binding are mandatory even for a local test.
  run(['repo:check']);
  run(['secret:scan']);
  run(['security:audit']);
  execFileSync(process.execPath, ['--test', 'scripts/table-dependency.test.mjs'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  });
  const snapshot = await sourceSnapshot();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const destination = path.resolve(output);
  await mkdir(destination); // unused directory only; never delete/replace an earlier candidate
  const staging = path.join(destination, 'build-evidence');
  await mkdir(staging);
  const config = portableBuildConfig();
  const configPath = path.join(staging, 'tauri-local-config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  const noticeResult = await prepareDesktopNotices({
    root,
    pnpmCli,
    output: staging,
    productName: 'PDFrig local portable test',
    version: config.version,
  });
  const scope = JSON.parse(await readFile(path.join(staging, 'windows-msvc-scope.json'), 'utf8'));
  if (scope.candidateGaps.some((gap) => gap !== '@napi-rs/canvas-win32-x64-msvc@1.0.7'))
    throw new Error('PORTABLE_WINDOWS_NOTICE_GAPS');
  // Do not clear this known optional gap based on metadata. Before packaging,
  // require the bundler graph and exact copied frontend to prove it is absent.
  environment.PDFRIG_PORTABLE_AUDIT_OUTPUT = path.join(staging, 'bundle-module-audit.json');
  if (!noticeResult.text.includes('xlsx') || !noticeResult.text.includes('0.20.3'))
    throw new Error('PORTABLE_TABLE_NOTICE_MISSING');
  await copyFile(
    path.join(root, 'docs/dependencies/THIRD_PARTY_NOTICES.txt'),
    path.join(staging, 'THIRD_PARTY_NOTICES.txt'),
  );
  run(['build:packages']);
  const desktopRequire = createRequire(path.join(root, 'apps/desktop/package.json'));
  const cli = path.join(
    path.dirname(desktopRequire.resolve('@tauri-apps/cli/package.json')),
    'tauri.js',
  );
  execFileSync(
    process.execPath,
    [cli, 'build', '--ci', '--no-bundle', '--config', configPath, '--', '--locked', '--offline'],
    { cwd: path.join(root, 'apps/desktop'), env: environment, stdio: 'inherit' },
  );
  if ((await sourceSnapshot()).sha256 !== snapshot.sha256)
    throw new Error('PORTABLE_SOURCE_CHANGED_DURING_BUILD');
  const payload = path.join(staging, 'payload');
  await mkdir(path.join(payload, 'licenses'), { recursive: true });
  await copyFile(
    path.join(root, 'apps/desktop/src-tauri/target/release/pdfmason-desktop.exe'),
    path.join(payload, 'pdfmason-desktop.exe'),
  );
  for (const name of [
    'PDFrig-LICENSE.txt',
    'THIRD_PARTY_NOTICES.txt',
    'UPSTREAM-LICENSE-TEXTS.txt',
  ])
    await copyFile(path.join(staging, name), path.join(payload, 'licenses', name));
  const artifact = {
    id: LOCAL_PORTABLE_ID,
    installer: { sourceCommit: commit },
    payload: [],
    localBuild: {
      version: config.version,
      sourceSnapshotSha256: snapshot.sha256,
      identifier: config.identifier,
      publicReleaseApproved: false,
      manualAcceptancePending: true,
      features: { tables: true, ocr: true, xlsx: true, ods: true },
    },
  };
  for (const name of [
    'pdfmason-desktop.exe',
    'licenses/PDFrig-LICENSE.txt',
    'licenses/THIRD_PARTY_NOTICES.txt',
    'licenses/UPSTREAM-LICENSE-TEXTS.txt',
  ]) {
    const bytes = await readFile(path.join(payload, name));
    artifact.payload.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
  }
  await writeFile(
    path.join(staging, 'source-manifest.json'),
    JSON.stringify({ baseCommit: commit, modifiedWorktree: true, ...snapshot }, null, 2) + '\n',
  );
  const frontend = [];
  async function inventory(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isDirectory())
        await inventory(path.join(directory, item.name), prefix + item.name + '/');
      else if (item.isFile()) {
        const bytes = await readFile(path.join(directory, item.name));
        frontend.push({ path: prefix + item.name, bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  await inventory(path.join(root, 'apps/desktop/dist'));
  const moduleAudit = JSON.parse(await readFile(environment.PDFRIG_PORTABLE_AUDIT_OUTPUT, 'utf8'));
  if (
    moduleAudit.nativeCanvasIncluded !== false ||
    !moduleAudit.modules.length ||
    frontend.some((file) => /(?:\.node$|icudtl\.dat$|@napi-rs)/iu.test(file.path))
  )
    throw new Error('PORTABLE_NATIVE_CANVAS_ABSENCE_UNPROVEN');
  await writeFile(
    path.join(staging, 'optional-native-gap-scope.json'),
    JSON.stringify(
      {
        prospectiveGaps: scope.candidateGaps,
        nativeCanvasAbsentFromBundleGraphAndFrontend: true,
        appPayloadContainsOnlyPinnedExeAndNotices: true,
        publicReleaseApproved: false,
        scope:
          'Build and artifact exclusion evidence only; unresolved original native package terms are not cleared.',
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    path.join(staging, 'frontend-assets.json'),
    JSON.stringify(frontend, null, 2) + '\n',
  );
  const archiveOutput = path.join(destination, 'package');
  const instructions = await readFile(
    path.join(root, 'docs/operations/windows-portable-source-read-first.txt'),
    'utf8',
  );
  await preparePortableDirectory({
    source: payload,
    output: archiveOutput,
    artifact,
    instructions,
  });
  const zip = await writePortableArchive(archiveOutput);
  await writeFile(
    path.join(staging, 'artifact-pin.json'),
    JSON.stringify({ ...artifact, zip: { bytes: zip.bytes, sha256: zip.sha256 } }, null, 2) + '\n',
  );
  console.log(
    `Local portable build ready: ${zip.archive}\nSHA-256 ${zip.sha256}\nModified source snapshot ${snapshot.sha256}. Manual acceptance pending; no upload.`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--output')
    throw new Error('Usage: pnpm desktop:portable-build --output <unused directory>');
  await build(process.argv[3]);
}
