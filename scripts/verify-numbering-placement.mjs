import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { numberPdf } from '../packages/pdf-engine/dist/index.js';

const engineRequire = createRequire(
  new URL('../packages/pdf-engine/package.json', import.meta.url),
);
const { getDocument } = await import(
  pathToFileURL(engineRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
);

// ORG-011/ORG-012: independent readers and full-page differences, synthetic corpus only.
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
const keep = process.env.PDFMASON_KEEP_VERIFICATION_OUTPUT === '1';
const temporaryRoot = resolve('tmp/pdfs');
await mkdir(temporaryRoot, { recursive: true });
const directory = await mkdtemp(join(temporaryRoot, 'numbering-'));
const cases = [
  {
    name: 'rotated-pages',
    pages: 4,
    kind: 'bates',
    position: 'header',
    alignment: 'left',
    startPage: 1,
  },
  {
    name: 'cropped-page',
    pages: 1,
    kind: 'page-labels',
    position: 'footer',
    alignment: 'center',
    startPage: 1,
  },
  {
    name: 'mixed-page-sizes',
    pages: 3,
    kind: 'bates',
    position: 'footer',
    alignment: 'right',
    startPage: 1,
  },
  {
    name: 'multipage-three',
    pages: 3,
    kind: 'page-labels',
    position: 'header',
    alignment: 'center',
    startPage: 2,
  },
  {
    name: 'acroform-text-field',
    pages: 1,
    kind: 'bates',
    position: 'footer',
    alignment: 'right',
    startPage: 1,
  },
  {
    name: 'alphabetic-upper-boundary',
    fixture: 'multipage-three',
    pages: 3,
    kind: 'page-labels',
    position: 'footer',
    alignment: 'right',
    startPage: 1,
    style: 'letters-upper',
    prefix: 'QA-',
    startNumber: 26,
    expectedIdentifiers: ['QA-Z', 'QA-AA', 'QA-BB'],
  },
  {
    name: 'alphabetic-lower-boundary',
    fixture: 'multipage-three',
    pages: 3,
    kind: 'page-labels',
    position: 'header',
    alignment: 'left',
    startPage: 1,
    style: 'letters-lower',
    prefix: 'QA-',
    startNumber: 51,
    expectedIdentifiers: ['QA-yy', 'QA-zz', 'QA-aaa'],
  },
  {
    name: 'literal-page-label-spaces',
    fixture: 'multipage-three',
    pages: 3,
    kind: 'page-labels',
    position: 'footer',
    alignment: 'center',
    startPage: 1,
    prefix: ' QA  ',
    expectedIdentifiers: [' QA  37', ' QA  38', ' QA  39'],
  },
  {
    name: 'literal-bates-spaces',
    fixture: 'multipage-three',
    pages: 3,
    kind: 'bates',
    position: 'header',
    alignment: 'right',
    startPage: 1,
    prefix: ' QA  ',
    suffix: ' -X ',
    expectedIdentifiers: [' QA  000037 -X ', ' QA  000038 -X ', ' QA  000039 -X '],
  },
];
const readRaster = async (path) => {
  const bytes = await readFile(path);
  const match = bytes
    .subarray(0, 100)
    .toString('ascii')
    .match(/^P6\s+(\d+)\s+(\d+)\s+255\s/u);
  assert.ok(match);
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = bytes.subarray(Buffer.byteLength(match[0], 'ascii'));
  assert.equal(pixels.length, width * height * 3);
  return { width, height, pixels };
};
try {
  const manifest = [];
  let comparisons = 0;
  for (const item of cases) {
    const source = resolve(`packages/test-corpus/fixtures/${item.fixture ?? item.name}.pdf`);
    const output = join(directory, `${item.name}.pdf`);
    const input = new Uint8Array(await readFile(source));
    const snapshot = input.slice();
    const common = {
      alignment: item.alignment,
      color: '#17232d',
      endPage: item.pages,
      fontSize: 9,
      marginPoints: 28,
      position: item.position,
      prefix: item.prefix ?? 'QA-AVAV-',
      startNumber: item.startNumber ?? 37,
      startPage: item.startPage,
    };
    const plan =
      item.kind === 'bates'
        ? { ...common, kind: 'bates', digits: 6, suffix: item.suffix ?? '-gyp' }
        : {
            ...common,
            kind: 'page-labels',
            style: item.style ?? 'decimal',
            replaceExistingLabels: false,
          };
    const result = await numberPdf(input, plan);
    assert.deepEqual(input, snapshot);
    assert.equal(result.report.operationVersion, '1.0.3');
    if (item.kind === 'page-labels' && item.expectedIdentifiers !== undefined) {
      const reader = getDocument({
        data: result.bytes.slice(),
        isEvalSupported: false,
        useSystemFonts: false,
      });
      try {
        const document = await reader.promise;
        assert.deepEqual(await document.getPageLabels(), item.expectedIdentifiers);
      } finally {
        await reader.destroy();
      }
    }
    await writeFile(output, result.bytes);
    execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
    manifest.push({ ...item, source, output, report: result.report });
    for (let page = 1; page <= item.pages; page++) {
      const prefixes = [
        join(directory, `${item.name}-${page}-before`),
        join(directory, `${item.name}-${page}-after`),
      ];
      for (const [index, path] of [source, output].entries())
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
            path,
            prefixes[index],
          ],
          { stdio: 'pipe' },
        );
      const before = await readRaster(`${prefixes[0]}.ppm`);
      const after = await readRaster(`${prefixes[1]}.ppm`);
      assert.equal(after.width, before.width);
      assert.equal(after.height, before.height);
      const baseline = item.position === 'header' ? 28 : after.height - 28;
      let changes = 0;
      for (let y = 0; y < after.height; y++) {
        for (let x = 0; x < after.width; x++) {
          const offset = (y * after.width + x) * 3;
          if (
            after.pixels
              .subarray(offset, offset + 3)
              .equals(before.pixels.subarray(offset, offset + 3))
          )
            continue;
          assert.ok(
            y >= baseline - 12 && y <= baseline + 6 && x >= 26 && x < after.width - 26,
            'Numbering changed pixels outside its visible margin band',
          );
          changes++;
        }
      }
      if (page >= item.startPage) assert.ok(changes > 20, 'Expected visible numbering');
      else assert.equal(changes, 0, 'Unselected page changed');
      if (keep)
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
            prefixes[1],
          ],
          { stdio: 'pipe' },
        );
      comparisons++;
    }
  }
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  execFileSync(
    python,
    [...pythonArgs, resolve('scripts/verify-numbering-placement.py'), manifestPath],
    { stdio: 'inherit' },
  );
  process.stdout.write(
    `ORG-011/ORG-012 independent verification passed: ${cases.length} outputs, ${comparisons} full-page comparisons, qpdf, pypdf labels/text/forms, PDF.js label agreement.\n`,
  );
  if (keep) process.stdout.write(`Synthetic numbering renders retained at ${directory}.\n`);
} finally {
  if (!keep) await rm(directory, { recursive: true, force: true });
}
