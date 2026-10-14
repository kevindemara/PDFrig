import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { decoratePdf } from '../packages/pdf-engine/dist/index.js';

// EDIT-006: compare visible output with the immutable synthetic source, not a generated golden.
const qpdf =
  process.env.PDFMASON_QPDF_PATH ??
  (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
const pdfInfo = process.env.PDFMASON_PDFINFO_PATH ?? 'pdfinfo';
const renderer =
  process.env.PDFMASON_PDFTOPPM_PATH ??
  (pdfInfo === 'pdfinfo' ? 'pdftoppm' : join(dirname(pdfInfo), 'pdftoppm.exe'));
const configuredPython = process.env.PDFMASON_PYTHON_PATH;
const python = configuredPython ?? (process.platform === 'win32' ? 'py' : 'python');
const pythonArgs = configuredPython === undefined && process.platform === 'win32' ? ['-3'] : [];
const keepOutput = process.env.PDFMASON_KEEP_VERIFICATION_OUTPUT === '1';
const directory = await mkdtemp(join(tmpdir(), 'pdfmason-decoration-review-'));
const cases = [
  { name: 'multipage-three', pages: 3, selected: [1, 3], range: '1,3' },
  { name: 'rotated-pages', pages: 4, selected: [1, 2, 3, 4], range: '1-4' },
  { name: 'cropped-page', pages: 1, selected: [1], range: '1', margin: 12 },
  { name: 'mixed-page-sizes', pages: 3, selected: [1, 2, 3], range: '1-3' },
  { name: 'acroform-text-field', pages: 1, selected: [1], range: '1' },
];
const ppm = (bytes) => {
  const match = bytes
    .subarray(0, 100)
    .toString('ascii')
    .match(/^P6\s+(\d+)\s+(\d+)\s+255\s/u);
  assert.ok(match, 'Expected an uncompressed RGB Poppler render');
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = bytes.subarray(Buffer.byteLength(match[0], 'ascii'));
  assert.equal(pixels.length, width * height * 3);
  return { width, height, pixels };
};

try {
  const manifest = [];
  let renderedPages = 0;
  for (const item of cases) {
    const margin = item.margin ?? 28;
    const source = resolve(`packages/test-corpus/fixtures/${item.name}.pdf`);
    const output = join(directory, `${item.name}.pdf`);
    const original = await readFile(source);
    const bytes = await decoratePdf(new Uint8Array(original), {
      header: { text: 'HEADER {page}/{pages}', alignment: 'left', fontSize: 9, color: '#17232d' },
      footer: { text: 'FOOTER {page}/{pages}', alignment: 'right', fontSize: 9, color: '#17232d' },
      watermark: null,
      marginPoints: margin,
      pageSelection: 'custom',
      pageRange: item.range,
    });
    assert.equal(Buffer.compare(original, await readFile(source)), 0, 'Source bytes changed');
    await writeFile(output, bytes);
    execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
    manifest.push({ ...item, source, output });
    for (let page = 1; page <= item.pages; page += 1) {
      const bases = [
        join(directory, `${item.name}-${page}-before`),
        join(directory, `${item.name}-${page}-after`),
      ];
      for (const [index, file] of [source, output].entries()) {
        execFileSync(
          renderer,
          [
            '-cropbox',
            '-f',
            String(page),
            '-l',
            String(page),
            '-singlefile',
            '-r',
            '72',
            file,
            bases[index],
          ],
          { stdio: 'pipe' },
        );
      }
      const before = ppm(await readFile(`${bases[0]}.ppm`));
      const after = ppm(await readFile(`${bases[1]}.ppm`));
      assert.equal(after.width, before.width);
      assert.equal(after.height, before.height);
      let topChanges = 0;
      let bottomChanges = 0;
      let otherChanges = 0;
      for (let y = 0; y < after.height; y += 1) {
        for (let x = 0; x < after.width; x += 1) {
          const offset = (y * after.width + x) * 3;
          const differs = [0, 1, 2].some(
            (channel) => before.pixels[offset + channel] !== after.pixels[offset + channel],
          );
          if (!differs) continue;
          if (y >= margin - 13 && y <= margin + 5) topChanges += 1;
          else if (y >= after.height - margin - 14 && y <= after.height - margin + 8)
            bottomChanges += 1;
          else otherChanges += 1;
        }
      }
      assert.equal(
        otherChanges,
        0,
        `${item.name} page ${page}: content changed outside header/footer bands`,
      );
      if (item.selected.includes(page)) {
        assert.ok(
          topChanges > 20 && bottomChanges > 20,
          `${item.name} page ${page}: marks missing from visible top/bottom`,
        );
      } else {
        assert.equal(topChanges + bottomChanges, 0, 'Unselected page render changed');
      }
      // Keep readable representative renders only when explicitly requested for human QA.
      if (keepOutput)
        execFileSync(
          renderer,
          [
            '-cropbox',
            '-f',
            String(page),
            '-l',
            String(page),
            '-singlefile',
            '-png',
            '-r',
            '96',
            output,
            bases[1],
          ],
          { stdio: 'pipe' },
        );
      renderedPages += 1;
    }
  }
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  execFileSync(
    python,
    [...pythonArgs, resolve('scripts/verify-pdf-decorations.py'), manifestPath],
    { stdio: 'inherit' },
  );
  process.stdout.write(
    `EDIT-006 independent verification passed: ${cases.length} outputs, ${renderedPages} source/output render comparisons, qpdf, pypdf structure/text/forms.\n`,
  );
  await import('./verify-decoration-placement.mjs');
  if (keepOutput) process.stdout.write(`Kept synthetic review outputs at ${directory}.\n`);
} finally {
  if (!keepOutput) await rm(directory, { recursive: true, force: true });
}
