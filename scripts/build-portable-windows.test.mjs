import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPortableModules } from './portable-bundle-audit.mjs';
import { portableBuildConfig, portableBuildEnvironment } from './build-portable-windows.mjs';
import { LOCAL_PORTABLE_ID, preparePortableDirectory } from './package-portable-windows.mjs';
test('local portable build has tables/OCR, isolated identity and no signing/account/update configuration', () => {
  const environment = portableBuildEnvironment({
    PATH: 'keep',
    VITE_SUPABASE_URL: 'https://must-not-ship.invalid',
    TAURI_SIGNING_PRIVATE_KEY: 'synthetic',
    PDFMASON_WINDOWS_CERTIFICATE_THUMBPRINT: 'synthetic',
  });
  assert.equal(environment.PATH, 'keep');
  assert.equal(environment.VITE_SUPABASE_URL, undefined);
  assert.equal(environment.VITE_PDFMASON_ENTITLEMENT_KEY_ID, undefined);
  assert.equal(environment.VITE_PDFMASON_TABLES_ENABLED, 'true');
  assert.equal(environment.VITE_PDFMASON_OCR_ENABLED, 'true');
  assert.equal(environment.TAURI_SIGNING_PRIVATE_KEY, undefined);
  assert.equal(environment.PDFMASON_WINDOWS_CERTIFICATE_THUMBPRINT, undefined);
  const config = portableBuildConfig();
  assert.equal(config.version, '0.1.0-alpha.20261024.2');
  assert.equal(config.identifier, 'com.pdfrig.desktop.portabletest');
  assert.equal(config.bundle.active, false);
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(config.bundle.fileAssociations, []);
  assert.deepEqual(config.plugins.updater.endpoints, []);
  assert.equal(config.plugins.updater.pubkey, '');
});
test('positive bundle audit refuses native Canvas imports and .node binaries', () => {
  for (const id of [
    'K:/node_modules/@napi-rs/canvas/index.js',
    'K:/node_modules/.pnpm/@napi-rs+canvas-win32-x64-msvc@1.0.7/node_modules/x/index.js',
    'K:\\native\\skia.node',
  ])
    assert.throws(() => assertPortableModules([id]), /PORTABLE_NATIVE_CANVAS_INCLUDED/u);
  assert.equal(
    assertPortableModules([
      'K:/node_modules/pdfjs-dist/build/pdf.mjs',
      'K:/packages/sheetjs-ce/xlsx.mjs',
    ]).nativeCanvasIncluded,
    false,
  );
});
test('incomplete local source provenance cannot authorize packaging', async () => {
  await assert.rejects(
    preparePortableDirectory({
      artifact: {
        id: LOCAL_PORTABLE_ID,
        installer: { sourceCommit: 'a'.repeat(40) },
        localBuild: { publicReleaseApproved: false, manualAcceptancePending: true },
      },
    }),
    /PORTABLE_ARTIFACT_UNREVIEWED/u,
  );
});
