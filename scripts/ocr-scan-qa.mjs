// Synthetic in-memory QA only. The caller supplies a purpose-created PNG, never customer files.
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
const require = createRequire(path.resolve('packages/pdf-engine/package.json'));
const { PDFDocument, rgb } = require('@cantoo/pdf-lib');
export async function loadOcrQaCandidate(file) {
  const root = path.resolve('.'); // Same repository-root contract as the browser QA command.
  const candidate = await realpath(path.resolve(file));
  const relative = path.relative(await realpath(path.join(root, 'tmp')), candidate);
  assert.ok(
    relative.startsWith('ocr-minimal-') && !relative.startsWith('..') && !path.isAbsolute(relative),
  );
  assert.equal(path.basename(candidate), 'tesseract-core-lstm.wasm.cjs');
  const receipt = JSON.parse(
    await readFile(path.join(path.dirname(candidate), 'candidate-build.json'), 'utf8'),
  );
  const pins = JSON.parse(
    await readFile(path.join(root, 'docs/dependencies/ocr-minimal-candidate.json'), 'utf8'),
  );
  assert.equal(receipt.publicReleaseApproved, false);
  assert.equal(receipt.runtimeReplacementApproved, false);
  assert.deepEqual(receipt.sourcePins, pins.sources);
  assert.equal(receipt.deniedRendererBindings.length, 9);
  assert.equal(receipt.deniedRawOutputBindings.length, 11);
  assert.equal(receipt.modifiedGlueSha256, pins.evidence.modifiedGlueSha256);
  assert.equal(receipt.sha256, pins.evidence.sha256);
  const bytes = await readFile(candidate);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.sha256);
  return bytes;
}
export async function createOcrScanQa(png, layout) {
  const document = await PDFDocument.create();
  const image = await document.embedPng(png);
  const cropped = layout === 'landscape-crop';
  const page = document.addPage(cropped ? [900, 650] : [612, 792]);
  if (cropped) page.setCropBox(80, 50, 720, 500);
  page.drawImage(
    image,
    cropped
      ? { x: 90, y: 65, width: 700, height: (700 * image.height) / image.width }
      : { x: 20, y: 330, width: 572, height: (572 * image.height) / image.width },
  );
  if (cropped) {
    const untouched = document.addPage([420, 300]);
    untouched.drawRectangle({ x: 20, y: 20, width: 200, height: 180, color: rgb(0.1, 0.5, 0.7) });
  }
  return document.save();
}
