import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
  applyInternalWindowsProfile,
  internalWindowsProfile,
} from './internal-windows-profile.mjs';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root));

test('VIEW-001 VIEW-007 customer-facing web and Windows copy uses PDFrig while internal identity stays stable', async () => {
  const inspect = async (directory) => {
    for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await inspect(relative);
      else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
        assert.doesNotMatch((await read(relative)).toString(), /\bPDFMason\b/u, relative);
      }
    }
  };
  await Promise.all(['apps/web/app', 'apps/desktop/src', 'packages/ui/src'].map(inspect));
  const workspace = (await read('packages/ui/src/workspace-shell.tsx')).toString();
  assert.match(workspace, /Read-only metadata\. PDFrig does not open or extract embedded files\./u);
  const config = (await read('packages/config/src/public.ts')).toString();
  assert.match(config, /NEXT_PUBLIC_LEGAL_ENTITY: 'PDFrig development'/u);
  assert.match(
    (await read('.env.example')).toString(),
    /NEXT_PUBLIC_LEGAL_ENTITY=PDFrig development/u,
  );
  assert.doesNotMatch(
    (await read('packages/contracts/src/feature-registry.ts')).toString(),
    /\bPDFMason\b/u,
  );
  const secureSession = (await read('apps/desktop/src-tauri/src/secure_session.rs')).toString();
  assert.match(secureSession, /b"PDFMason desktop entitlement v1"/u);
  assert.match(secureSession, /b"PDFMason desktop session v1"/u);
});

test('approved PDFrig exports are present and their manifest detects asset drift', async () => {
  const manifest = JSON.parse(await read('docs/brand/pdfrig-export-manifest.json'));
  assert.equal(manifest.brand, 'PDFrig');
  assert.equal(manifest.exports.length, 28);
  for (const asset of manifest.exports) {
    assert.equal(
      createHash('sha256')
        .update(await read(asset.path))
        .digest('hex'),
      asset.sha256,
      asset.path,
    );
  }
  const approved = await read('docs/brand/pdfrig-logo.png');
  for (const app of ['web', 'desktop']) {
    assert.deepEqual(await read(`apps/${app}/public/brand/pdfrig-logo.png`), approved);
    assert.deepEqual(
      await read(`apps/${app}/public/brand/pdfrig-mark.svg`),
      await read('docs/brand/pdfrig-mark.svg'),
    );
  }
  assert.deepEqual(await read('apps/web/app/icon.svg'), await read('docs/brand/pdfrig-mark.svg'));
});

test('Windows icons retain square RGBA PNGs with useful small and large sizes', async () => {
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    const name = size === 256 ? '128x128@2x.png' : `${size}x${size}.png`;
    const png = await read(`apps/desktop/src-tauri/icons/${name}`);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.equal(png[25], 6, 'Icons must carry an alpha channel.');
  }
});

test('browser and Windows ICO exports are identical and contain bounded valid frames', async () => {
  const ico = await read('apps/desktop/src-tauri/icons/icon.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 3 && count <= 16);
  const sizes = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const size = ico[entry] || 256;
    sizes.push(size);
    assert.equal(ico[entry + 1] || 256, size);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(length > 0 && offset >= 6 + count * 16 && offset + length <= ico.length);
  }
  assert.ok(sizes.includes(16));
  assert.ok(sizes.includes(32));
  assert.ok(sizes.includes(256));
  assert.deepEqual(await read('apps/web/app/favicon.ico'), ico);
  assert.deepEqual(await read('apps/desktop/public/favicon.ico'), ico);
});

test('native icon application does not change desktop identity, capabilities or release gates', async () => {
  const config = JSON.parse(await read('apps/desktop/src-tauri/tauri.conf.json'));
  assert.equal(config.productName, 'PDFrig');
  assert.equal(config.identifier, 'com.pdfmason.desktop.dev');
  assert.equal(config.bundle.active, false);
  assert.deepEqual(config.app.security.capabilities, ['foundation']);
  assert.ok(config.bundle.icon.includes('icons/icon.ico'));
  const html = (await read('apps/desktop/index.html')).toString();
  assert.match(html, /rel="icon" href="\/favicon\.ico"/u);
  const nativeFiles = (await read('apps/desktop/src-tauri/src/native_files.rs')).toString();
  assert.match(nativeFiles, /set_title\("Open a PDF in PDFrig"\)/u);
  assert.match(nativeFiles, /set_title\("Save a new PDFrig copy"\)/u);
  assert.doesNotMatch(nativeFiles, /(?:set_title|add_filter)\("[^"\n]*PDFMason/u);
});

test('internal installer orchestration stays separate from public distribution and credentials', async () => {
  const build = (await read('scripts/build-internal-windows.mjs')).toString();
  assert.match(build, /applyInternalWindowsProfile\(config, profile\)/u);
  const profile = internalWindowsProfile();
  assert.equal(profile.productName, 'PDFrig Internal Test');
  assert.equal(profile.identifier, 'com.pdfmason.desktop.internal');
  assert.deepEqual(
    applyInternalWindowsProfile({ bundle: {} }, profile).bundle.fileAssociations,
    [],
  );
  assert.match(build, /updates\.example\.invalid\/alpha/u);
  assert.match(build, /PDFMASON_ALLOW_UNSIGNED_INTERNAL_ALPHA: 'true'/u);
  assert.match(build, /VITE_PDFMASON_PERMISSIONS_ENABLED: 'false'/u);
  assert.match(build, /VITE_PDFMASON_REDACTION_ENABLED: 'false'/u);
  assert.match(build, /verify_updater_artifact/u);
  assert.match(build, /Refusing to replace existing test signing material/u);
  assert.match(build, /finally[\s\S]*await unlink\(keyFile\)/u);
  assert.doesNotMatch(build, /console\.(?:log|error)\([^)]*(?:privateKey|environment|error)/u);
  assert.doesNotMatch(build, /Start-Process|['"]\/S['"]|git push|\bupload\b/iu);
});

test('branded private installer uses PDFrig labels without enabling production distribution', () => {
  const profile = internalWindowsProfile(['--private-test']);
  assert.equal(profile.version, '0.1.0-alpha.20261020.2');
  assert.equal(profile.buildId, 'private-test-20261020-no-replace-save');
  assert.equal(profile.identifier, 'com.pdfmason.desktop.privatetest');
  const config = applyInternalWindowsProfile(
    { bundle: {}, plugins: { updater: { active: false } } },
    profile,
  );
  assert.equal(config.productName, 'PDFrig');
  assert.equal(config.app.windows[0].title, 'PDFrig');
  assert.equal(config.app.windows[0].dragDropEnabled, false);
  assert.equal(config.bundle.publisher, 'PDFrig');
  assert.deepEqual(config.bundle.fileAssociations, []);
  assert.doesNotMatch(
    JSON.stringify(config),
    /Installer QA|Internal Test|development|Internal testing/u,
  );
  assert.equal(config.plugins.updater.active, false);
  assert.equal(internalWindowsProfile(['--installer-qa']).productName, 'PDFrig Installer QA');
  assert.throws(() => internalWindowsProfile(['--installer-qa', '--private-test']));
  assert.throws(() => internalWindowsProfile(['--public-release']));
});

test('Windows-facing tools retain feature IDs in code, not developer setup notes in the UI', async () => {
  const account = (await read('apps/desktop/src/desktop-account.tsx')).toString();
  assert.doesNotMatch(
    account,
    /Add the public Supabase URL|publishable key described|this internal build|This local build/u,
  );
  const tools = (await read('packages/ui/src/utility-workbench.tsx')).toString();
  assert.match(tools, /data-feature-ids=\{utility\.matrix\}/u);
  assert.doesNotMatch(tools, />\{(?:utility|activeUtility)\.matrix\}</u);
  assert.doesNotMatch(tools, /Paid beta|qpdf and PDF reader verification|sandbox evidence/u);
  const workspace = (await read('packages/ui/src/workspace-shell.tsx')).toString();
  assert.doesNotMatch(workspace, />ANNO-\d{3}|>REDACT-\d{3}|release kill switch/u);
  assert.match(workspace, /data-feature-id="ANNO-006"/u);
  assert.match(workspace, /data-feature-id="ANNO-007"/u);
});
