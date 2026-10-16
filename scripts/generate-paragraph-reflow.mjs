/** CC0 fixed synthetic reflow fixture, never a user-document adapter. */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'),
  output = path.resolve(process.argv[2] ?? '');
if (!['tmp', 'test-results'].some((name) => output.startsWith(path.join(root, name) + path.sep)))
  throw new Error('SYNTHETIC_OUTPUT_PATH_INVALID');
const require = createRequire(path.join(root, 'packages/pdf-engine/package.json'));
const { PDFDocument, PDFName, StandardFonts, degrees } = require('@cantoo/pdf-lib');
const document = await PDFDocument.create(),
  page = document.addPage([612, 792]);
const variant = process.argv[3] ?? 'normal';
if (!['normal', 'crop-rotated'].includes(variant)) throw new Error('SYNTHETIC_MODE_INVALID');
if (variant === 'crop-rotated') {
  page.setCropBox(12, 18, 580, 750);
  page.setRotation(degrees(90));
}
const font = await document.embedFont(StandardFonts.Helvetica);
page.node.set(PDFName.of('Resources'), document.context.obj({ Font: { H: font.ref } }));
page.node.set(
  PDFName.of('Contents'),
  document.context.register(
    document.context.flateStream(
      'BT /H 18 Tf 22 TL 1 0 0 1 54 650 Tm (This is the first line of a short paragraph.) Tj T* (The second line keeps the same natural font.) Tj 1 0 0 1 54 350 Tm (UNCHANGED FOOTER) Tj ET',
    ),
  ),
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, await document.save());
