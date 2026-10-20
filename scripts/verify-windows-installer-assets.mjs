// Read-only recheck of an already-extracted, explicitly reviewed artifact.
// Extraction and execution are deliberately outside this verifier.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { installedNpmEvidence } from './npm-notice-evidence.mjs';
import { pinnedWindowsAssets, windowsPackageFootprints } from './windows-pe-assets.mjs';

const [id, directory] = process.argv.slice(2);
assert.ok(
  id && directory && process.argv.length === 4,
  'Usage: node scripts/verify-windows-installer-assets.mjs <artifact-id> <extracted-directory>',
);
const record = JSON.parse(
  await readFile(
    new URL('../docs/dependencies/windows-installer-dependency-audit.json', import.meta.url),
    'utf8',
  ),
);
const pin = record.artifacts.find((entry) => entry.id === id);
assert.ok(pin, 'Unreviewed artifact: do not infer absence');
const files = await installedNpmEvidence(directory);
assert.deepEqual(
  [...files].map(([path, value]) => ({ path, bytes: value.bytes, sha256: value.sha256 })),
  pin.payload,
);
const assets = pinnedWindowsAssets(
  await readFile(path.join(directory, 'pdfmason-desktop.exe')),
  pin.executable,
);
const names = ['fontkit', 'dfa', 'brotli', '@napi-rs/canvas', '@napi-rs/canvas-win32-x64-msvc'];
assert.deepEqual(windowsPackageFootprints(assets, names), pin.packageFootprints);
if (pin.findings.nativeCanvasAndIcuDataAbsent) {
  for (const key of [...files.keys(), ...assets.keys()])
    assert.doesNotMatch(key, /(?:\.node$|icudtl\.dat$)/iu);
  assert.ok(!pin.packageFootprints.some((entry) => entry.package.startsWith('@napi-rs/canvas')));
}
if (!pin.findings.fontkitDfaBrotliPresent) assert.equal(pin.packageFootprints.length, 0);
console.log(
  `${id}: ${files.size} extracted files and ${assets.size} embedded assets match reviewed hashes. No general security/legal clearance inferred.`,
);
