// Dependency metadata/notice audit; no compilation, signer, installer or network.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectDesktopLicenseNotices,
  loadDesktopLicenseSupplements,
  loadDesktopNpmPartialNotices,
  loadFontkitDerivedNotice,
} from './desktop-license-texts.mjs';
import { desktopNoticeScope } from './desktop-notice-scope.mjs';

export async function prepareDesktopNotices({
  root,
  pnpmCli,
  output,
  productName = 'PDFrig internal notice audit',
  version = '0.0.0',
}) {
  if (!pnpmCli) throw new Error('DESKTOP_NOTICES_USE_PNPM');
  const readCargo = (extra = []) =>
    JSON.parse(
      execFileSync(
        process.env.PDFRIG_CARGO_PATH ?? 'cargo',
        [
          'metadata',
          '--locked',
          '--offline',
          ...extra,
          '--format-version',
          '1',
          '--manifest-path',
          'apps/desktop/src-tauri/Cargo.toml',
        ],
        {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      ),
    );
  const cargo = readCargo();
  const targetCargo = readCargo(['--filter-platform', 'x86_64-pc-windows-msvc']);
  const licenses = JSON.parse(
    execFileSync(
      process.execPath,
      [pnpmCli, '--filter', '@pdfmason/desktop...', 'licenses', 'list', '--prod', '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    ),
  );
  const packages = cargo.packages
    .filter((pkg) => !cargo.workspace_members.includes(pkg.id))
    .map((pkg) => ({
      ecosystem: 'cargo',
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      licenseFile: pkg.license_file,
      directory: path.dirname(pkg.manifest_path),
    }));
  for (const entries of Object.values(licenses))
    for (const entry of entries)
      for (const directory of entry.paths) {
        const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
        packages.push({
          ecosystem: 'npm',
          name: manifest.name,
          version: manifest.version,
          license: entry.license,
          directory,
        });
      }
  const result = await collectDesktopLicenseNotices(packages, {
    root,
    supplements: await loadDesktopLicenseSupplements(root),
    npmPartials: await loadDesktopNpmPartialNotices(root),
    fontkitDerivative: await loadFontkitDerivedNotice(root),
  });
  const targetScope = desktopNoticeScope(
    cargo,
    targetCargo,
    packages.filter((pkg) => pkg.ecosystem === 'npm'),
    result.gaps,
  );
  await mkdir(output, { recursive: true });
  for (const [filename, value] of [
    [
      'build-inputs.cdx.json',
      {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        version: 1,
        metadata: { component: { type: 'application', name: productName, version } },
        components: result.components,
      },
    ],
    ['license-text-gaps.json', result.gaps],
    ['windows-msvc-scope.json', targetScope],
    [
      'license-text-provenance.json',
      {
        schemaVersion: 1,
        publicReleaseApproved: false,
        declaredInputCount: packages.length,
        uniqueComponentCount: result.components.length,
        missingTextCount: result.gaps.length,
        files: result.provenance,
      },
    ],
  ])
    await writeFile(path.join(output, filename), JSON.stringify(value, null, 2) + '\n');
  await writeFile(path.join(output, 'UPSTREAM-LICENSE-TEXTS.txt'), result.text);
  return { ...result, declaredInputCount: packages.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    await mkdir(path.join(root, 'tmp'), { recursive: true });
    const output = await mkdtemp(path.join(root, 'tmp/desktop-notices-'));
    const result = await prepareDesktopNotices({ root, output, pnpmCli: process.env.npm_execpath });
    console.log(
      `Desktop notice audit: ${result.declaredInputCount} declared inputs; ${result.gaps.length} missing text entries. Reports: ${path.relative(root, output)}. No native build or installer was started; public release remains gated.`,
    );
    if (process.argv.includes('--require-complete') && result.gaps.length) process.exitCode = 1;
  } catch {
    console.error(
      'DESKTOP_NOTICES_AUDIT_FAILED: check the pinned offline toolchain/cache and reviewed text bindings. No installer or signing operation was started.',
    );
    process.exitCode = 1;
  }
}
