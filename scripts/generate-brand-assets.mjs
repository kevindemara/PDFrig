import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Owner-approved artwork only. No network, new dependencies, signing or installation.
const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = path.join(root, 'apps/desktop');
const requireDesktop = createRequire(path.join(desktop, 'package.json'));
const cli = path.join(
  path.dirname(requireDesktop.resolve('@tauri-apps/cli/package.json')),
  'tauri.js',
);
const mark = path.join(root, 'docs/brand/pdfrig-mark.svg');
const logo = path.join(root, 'docs/brand/pdfrig-logo.png');
await mkdir(path.join(root, 'tmp'), { recursive: true });
const temporary = await mkdtemp(path.join(root, 'tmp/pdfrig-icons-'));
const run = (args) => {
  const result = spawnSync(process.execPath, [cli, 'icon', mark, ...args], {
    cwd: desktop,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('PDFrig icon export failed.');
};
run(['--output', temporary]);
run([
  '--output',
  path.join(temporary, 'sizes'),
  ...[16, 24, 48, 64, 180, 512].flatMap((size) => ['--png', String(size)]),
]);

const exports = [];
const copy = async (source, relative) => {
  const destination = path.join(root, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  exports.push({
    path: relative,
    sha256: createHash('sha256')
      .update(await readFile(destination))
      .digest('hex'),
  });
};
const windows = [
  'icon.ico',
  'icon.png',
  '32x32.png',
  '128x128.png',
  '128x128@2x.png',
  'StoreLogo.png',
  'Square30x30Logo.png',
  'Square44x44Logo.png',
  'Square71x71Logo.png',
  'Square89x89Logo.png',
  'Square107x107Logo.png',
  'Square142x142Logo.png',
  'Square150x150Logo.png',
  'Square284x284Logo.png',
  'Square310x310Logo.png',
];
for (const name of windows)
  await copy(path.join(temporary, name), `apps/desktop/src-tauri/icons/${name}`);
for (const size of [16, 24, 48, 64, 512]) {
  await copy(
    path.join(temporary, 'sizes', `${size}x${size}.png`),
    `apps/desktop/src-tauri/icons/${size}x${size}.png`,
  );
}
for (const app of ['web', 'desktop']) {
  await copy(logo, `apps/${app}/public/brand/pdfrig-logo.png`);
  await copy(mark, `apps/${app}/public/brand/pdfrig-mark.svg`);
}
await copy(mark, 'apps/web/app/icon.svg');
await copy(path.join(temporary, 'icon.ico'), 'apps/web/app/favicon.ico');
await copy(path.join(temporary, 'icon.ico'), 'apps/desktop/public/favicon.ico');
await copy(path.join(temporary, 'sizes/180x180.png'), 'apps/web/app/apple-icon.png');
const manifest = {
  brand: 'PDFrig',
  approval: 'Owner approved logo and site/favicon/Windows icon application on 2026-10-12.',
  source: { logo: 'docs/brand/pdfrig-logo.png', mark: 'docs/brand/pdfrig-mark.svg' },
  method:
    'Approved imagegen wordmark retained unchanged; folded-page/r mark refined as repo-native SVG. Existing locked Tauri CLI rasterizes icon exports.',
  clearance:
    'Preliminary screen only; formal trademark and public-release gates remain outstanding.',
  exports,
};
await writeFile(
  path.join(root, 'docs/brand/pdfrig-export-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write(`Exported ${exports.length} PDFrig brand assets.\n`);
