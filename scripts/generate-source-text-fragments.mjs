/** CC0 synthetic internal test input; no customer content or published artifact. */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.argv[2] ?? '');
if (!['test-results', 'tmp'].some((name) => output.startsWith(path.join(root, name) + path.sep)))
  throw new Error('SYNTHETIC_OUTPUT_PATH_INVALID');
const require = createRequire(path.join(root, 'packages/pdf-engine/package.json'));
const { PDFDocument, PDFName, StandardFonts } = require('@cantoo/pdf-lib');
const document = await PDFDocument.create(),
  page = document.addPage([612, 792]);
const font = await document.embedFont(StandardFonts.Helvetica);
page.node.set(PDFName.of('Resources'), document.context.obj({ Font: { H: font.ref } }));
let content = '';
for (const [mode, text, y] of [
  ['Tj', 'FIRST SOURCE AFTER', 600],
  ['positioned', 'SECOND SOURCE AFTER', 480],
  ['TJ', 'ARRAY WORDS AFTER', 360],
]) {
  content += `BT /H 18 Tf 1 0 0 1 54 ${y} Tm `;
  if (mode === 'TJ')
    content += `[${Array.from(text, (character) => `(${character}) -1`).join(' ')}] TJ `;
  else if (mode === 'Tj') content += Array.from(text, (character) => `(${character}) Tj`).join(' ');
  else {
    let x = 54;
    for (const character of text) {
      content += `1 0 0 1 ${x.toFixed(6)} ${y} Tm (${character}) Tj `;
      x += font.widthOfTextAtSize(character, 18);
    }
  }
  content += '\nET\n';
}
page.node.set(
  PDFName.of('Contents'),
  document.context.register(document.context.flateStream(content)),
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, await document.save());
