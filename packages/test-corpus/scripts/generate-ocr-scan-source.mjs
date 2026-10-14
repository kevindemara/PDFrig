/** OCR-001: generate a realistic, purpose-created CC0 scan with the existing QA renderer.
 * No font program is redistributed; only pixels rendered from standard PDF text.
 */
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const renderer = process.env.PDFMASON_PDFTOPPM_PATH ?? 'pdftoppm';
const version = spawnSync(renderer, ['-v'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 10_000,
});
// pdftoppm prints its version to stderr; inspect both streams without logging it.
// The corpus pixels and recorded provenance require the pinned QA renderer.
if (
  version.error ||
  version.status !== 0 ||
  !`${version.stdout}${version.stderr}`.includes('pdftoppm version 26.07.0')
)
  throw new Error('OCR_FIXTURE_RENDERER_VERSION_MISMATCH');
const scratch = resolve(root, '.tooling/ocr-source-generation');
const sources = resolve(root, 'packages/test-corpus/fixtures/sources');
await mkdir(scratch, { recursive: true });
await mkdir(sources, { recursive: true });
const document = await PDFDocument.create();
document.setCreationDate(new Date('2026-10-13T00:00:00Z'));
document.setModificationDate(new Date('2026-10-13T00:00:00Z'));
const font = await document.embedFont(StandardFonts.Helvetica);
document.addPage([600, 180]).drawText('OCR FIXTURE 4827', { font, size: 32, x: 20, y: 90 });
const donor = resolve(scratch, 'donor.pdf');
await writeFile(donor, await document.save());
const prefix = resolve(scratch, 'scan');
execFileSync(renderer, ['-singlefile', '-r', '200', '-png', donor, prefix], {
  stdio: 'pipe',
  timeout: 10_000,
});
const bytes = await readFile(`${prefix}.png`);
await writeFile(resolve(sources, 'scanned-ocr.png'), bytes);
await writeFile(
  resolve(sources, 'scanned-ocr.manifest.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      featureIds: ['OCR-001'],
      license: 'CC0-1.0',
      sensitivity: 'none',
      origin: 'Purpose-created standard-font PDF rasterized with the existing Poppler QA renderer',
      fontProgramBundled: false,
      sourceFont: 'Helvetica',
      sourceFontSize: 32,
      expectedText: 'OCR FIXTURE 4827',
      renderer: 'Poppler QA 26.07.0, 200 DPI',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    null,
    2,
  )}\n`,
);
