// Internal artifact orchestration only; public release configuration is unchanged.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { prepareDesktopNotices } from './prepare-desktop-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli || process.platform !== 'win32')
  throw new Error(
    'Run through pnpm desktop:internal-build in the Windows x64 developer environment.',
  );
const desktopRequire = createRequire(path.join(root, 'apps/desktop/package.json'));
const cli = path.join(
  path.dirname(desktopRequire.resolve('@tauri-apps/cli/package.json')),
  'tauri.js',
);
const qa = process.argv.includes('--installer-qa');
const version = qa ? '0.1.0-alpha.20261014.1' : '0.1.0-alpha.20261012.1';
const buildId = qa ? 'installer-qa-20261014' : 'internal-pdfrig-20261012';
const productName = qa ? 'PDFrig Installer QA' : 'PDFrig Internal Test';
const output = path.join(root, 'apps/desktop/src-tauri/target', buildId);
const privateDirectory = path.join(
  root,
  'apps/desktop/src-tauri/target/local-alpha-signing',
  buildId,
);
const privateKeyPath = path.join(privateDirectory, 'updater.key');
for (const keyFile of [privateKeyPath, `${privateKeyPath}.pub`]) {
  try {
    await access(keyFile);
    throw new Error('Refusing to replace existing test signing material.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
await mkdir(output, { recursive: true });
await mkdir(privateDirectory, { recursive: true });

try {
  // The signer prints sensitive material. Capture and discard its entire output.
  execFileSync(
    process.execPath,
    [cli, 'signer', 'generate', '--ci', '--password', '', '--write-keys', privateKeyPath],
    { stdio: 'pipe' },
  );
  const publicKey = (await readFile(`${privateKeyPath}.pub`, 'utf8')).trim();
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.startsWith('VITE_') &&
        !name.startsWith('TAURI_SIGNING_') &&
        !name.startsWith('PDFMASON_WINDOWS_'),
    ),
  );
  Object.assign(environment, {
    CARGO_NET_OFFLINE: 'true',
    PDFMASON_ALLOW_UNSIGNED_INTERNAL_ALPHA: 'true',
    PDFMASON_DESKTOP_IDENTIFIER: qa
      ? 'com.pdfmason.desktop.installerqa'
      : 'com.pdfmason.desktop.internal',
    PDFMASON_RELEASE_CHANNEL: 'alpha',
    PDFMASON_RELEASE_VERSION: version,
    PDFMASON_UPDATER_ENDPOINT:
      'https://updates.example.invalid/alpha/{{target}}/{{arch}}/{{current_version}}',
    PDFMASON_UPDATER_PUBLIC_KEY: publicKey,
    PDFMASON_RELEASE_CONFIG_OUTPUT: path.join(output, 'internal-build-config.json'),
    TAURI_SIGNING_PRIVATE_KEY: await readFile(privateKeyPath, 'utf8'),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '',
    VITE_PDFMASON_ENTITLEMENT_ENFORCED: 'false',
    VITE_PDFMASON_COMMENT_REVIEW_ENABLED: 'true',
    VITE_PDFMASON_MEASUREMENT_ENABLED: 'true',
    VITE_PDFMASON_STAMPS_ENABLED: 'true',
    VITE_PDFMASON_TEXT_ENABLED: 'true',
    VITE_PDFMASON_PERMISSIONS_ENABLED: 'false',
    VITE_PDFMASON_REDACTION_ENABLED: 'false',
  });
  execFileSync(process.execPath, ['scripts/create-tauri-release-config.mjs'], {
    env: environment,
    stdio: 'inherit',
  });
  const config = JSON.parse(await readFile(environment.PDFMASON_RELEASE_CONFIG_OUTPUT, 'utf8'));
  config.productName = 'PDFrig Internal Test';
  if (qa) config.productName = productName;
  config.app = {
    windows: [
      {
        label: 'main',
        title: 'PDFrig — Internal testing',
        width: 1280,
        height: 820,
        minWidth: 760,
        minHeight: 600,
        dragDropEnabled: false,
        resizable: true,
      },
    ],
  };
  config.bundle.fileAssociations = [];
  if (qa) config.app.windows[0].title = 'PDFrig — Installer QA';
  config.bundle.longDescription =
    'PDFrig internal test build. Not approved for public distribution.';
  await copyFile(
    path.join(root, 'docs/dependencies/THIRD_PARTY_NOTICES.txt'),
    path.join(output, 'THIRD_PARTY_NOTICES.txt'),
  );

  // Conservative build-input inventory; not an independently reviewed release SBOM.
  const notices = await prepareDesktopNotices({ root, pnpmCli, output, productName, version });
  config.bundle.resources = {
    [path.join(output, 'THIRD_PARTY_NOTICES.txt')]: 'licenses/THIRD_PARTY_NOTICES.txt',
    [path.join(output, 'UPSTREAM-LICENSE-TEXTS.txt')]: 'licenses/UPSTREAM-LICENSE-TEXTS.txt',
  };
  await writeFile(environment.PDFMASON_RELEASE_CONFIG_OUTPUT, JSON.stringify(config, null, 2));
  console.log(
    `Prepared internal-only build inputs (${notices.declaredInputCount} declared dependency records; ${notices.gaps.length} upstream text gaps).`,
  );
  execFileSync(
    process.execPath,
    [
      cli,
      'build',
      '--ci',
      '--config',
      environment.PDFMASON_RELEASE_CONFIG_OUTPUT,
      '--',
      '--locked',
      '--offline',
    ],
    { cwd: path.join(root, 'apps/desktop'), env: environment, stdio: 'inherit' },
  );
  const bundle = path.join(root, 'apps/desktop/src-tauri/target/release/bundle/nsis');
  const name = `${productName}_${version}_x64-setup.exe`;
  for (const suffix of ['', '.sig'])
    await copyFile(path.join(bundle, `${name}${suffix}`), path.join(output, `${name}${suffix}`));
  await copyFile(`${privateKeyPath}.pub`, path.join(output, 'updater-test-public-key.pub'));
  const installer = await readFile(path.join(output, name));
  const hash = createHash('sha256').update(installer).digest('hex');
  await writeFile(path.join(output, 'SHA256SUMS.txt'), `${hash}  ${name}\n`);
  console.log(`Internal installer produced: ${installer.length} bytes; SHA-256 ${hash}.`);
  const decodedPublic = path.join(output, 'updater-test-public-key.minisign.pub');
  const decodedSignature = path.join(output, 'installer.minisign.sig');
  await writeFile(decodedPublic, Buffer.from(publicKey, 'base64'));
  await writeFile(
    decodedSignature,
    Buffer.from((await readFile(path.join(output, `${name}.sig`), 'utf8')).trim(), 'base64'),
  );
  execFileSync(
    'cargo',
    [
      'run',
      '--locked',
      '--offline',
      '--manifest-path',
      'apps/desktop/src-tauri/Cargo.toml',
      '--example',
      'verify_updater_artifact',
      '--',
      path.join(output, name),
      decodedPublic,
      decodedSignature,
    ],
    { env: environment, stdio: 'inherit' },
  );
} catch {
  // Never print child exception objects: captured signer output can contain key material.
  console.error('Internal build failed; inspect only the preceding non-secret build diagnostics.');
  process.exitCode = 1;
} finally {
  // Delete only the exact test-key files created by this invocation, not their directory.
  for (const keyFile of [privateKeyPath, `${privateKeyPath}.pub`]) {
    await unlink(keyFile).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  console.log('Ephemeral internal signing-key files removed.');
}
