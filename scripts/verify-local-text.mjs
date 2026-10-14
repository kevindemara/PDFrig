/** Synthetic source-operator fidelity, checked by independent readers/renders. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { inspectSourceText, replaceSourceText } from '../packages/pdf-engine/dist/source-text.js';
import { embedSignatureFont } from '../packages/pdf-engine/dist/signature-font.js';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'packages/pdf-engine/package.json'));
const { PDFDocument, PDFName, StandardFonts, degrees } = require('@cantoo/pdf-lib');
const base = path.join(root, 'tmp/local-text-verification');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'run-'));
for (const [index, mode] of [
  'following-text',
  'TJ-array',
  'rotated-cropped',
  'embedded-font',
].entries()) {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font =
    mode === 'embedded-font'
      ? await embedSignatureFont(document)
      : await document.embedFont(StandardFonts.Helvetica);
  if (mode === 'following-text' || mode === 'TJ-array') {
    page.node.set(PDFName.of('Resources'), document.context.obj({ Font: { H: font.ref } }));
    page.node.set(
      PDFName.of('Contents'),
      document.context.register(
        document.context.flateStream(
          `BT /H 18 Tf 54 600 Td ${mode === 'TJ-array' ? '[(SOURCE WORDS) -20 ( FOLLOWING)] TJ' : '(SOURCE WORDS) Tj ( FOLLOWING) Tj'} ET`,
        ),
      ),
    );
  } else page.drawText('SOURCE WORDS', { font, size: 22, x: 80, y: 600 });
  if (mode === 'rotated-cropped') {
    page.setCropBox(36, 36, 540, 720);
    page.setRotation(degrees(90));
  }
  const source = await document.save();
  const run = (await inspectSourceText(source, 0)).find((item) =>
    item.text.startsWith('SOURCE WORDS'),
  );
  assert.ok(run, `Missing synthetic run ${index}`);
  const output = await replaceSourceText(source, run.id, run.text, 'CHANGE', {
    start: 0,
    end: 'SOURCE WORDS'.length,
  });
  const originalPath = path.join(directory, `${index}-source.pdf`);
  const outputPath = path.join(directory, `${index}-output.pdf`);
  await writeFile(originalPath, source);
  await writeFile(outputPath, output);
  execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', outputPath], {
    stdio: 'pipe',
    timeout: 20_000,
  });
  const report = JSON.parse(
    execFileSync(
      process.env.PDFMASON_PYTHON_PATH ?? 'python',
      [
        'scripts/verify-source-text-spike.py',
        originalPath,
        outputPath,
        'SOURCE WORDS',
        'CHANGE',
        'auto',
      ],
      { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 30_000 },
    ),
  );
  assert.ok(
    Object.values(report).every((value) => value === true),
    `Independent source fidelity failed ${index}`,
  );
  assert.deepEqual(await readFile(originalPath), Buffer.from(source));
}
console.log(
  'EDIT-002 independent fidelity passed: following-text advance, TJ arrays, crop/rotation and embedded font; original text replaced, font/size/effective matrix and unrelated pixels retained.',
);
