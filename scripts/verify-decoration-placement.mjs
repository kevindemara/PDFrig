import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  decorationReviewGeometrySupported,
  decoratePdf,
  measureDecorationTextAreas,
  reviewDecorationPlacement,
} from '../packages/pdf-engine/dist/index.js';

// EDIT-006: independent-render evaluation, including deliberate false-positive/negative cases.
const source = resolve('packages/test-corpus/fixtures/decoration-placement.pdf');
const qpdf =
  process.env.PDFMASON_QPDF_PATH ??
  (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
const pdfInfo = process.env.PDFMASON_PDFINFO_PATH ?? 'pdfinfo';
const renderer =
  process.env.PDFMASON_PDFTOPPM_PATH ??
  (pdfInfo === 'pdfinfo' ? 'pdftoppm' : join(dirname(pdfInfo), 'pdftoppm.exe'));
const keep = process.env.PDFMASON_KEEP_VERIFICATION_OUTPUT === '1';
const temporaryRoot = resolve('tmp/pdfs');
await mkdir(temporaryRoot, { recursive: true });
const directory = await mkdtemp(join(temporaryRoot, 'placement-'));
const options = {
  header: { text: 'Review', alignment: 'left', color: '#17232d', fontSize: 9 },
  footer: { text: 'Page', alignment: 'right', color: '#17232d', fontSize: 9 },
  watermark: null,
  marginPoints: 28,
  pageSelection: 'all',
};
const expected = [
  [false, false],
  [true, false],
  [false, true],
  [true, false],
  [true, false],
  [false, false],
  [true, true],
  [true, false],
  [true, false],
  [true, false],
];
const readRaster = async (path) => {
  const bytes = await readFile(path);
  const header = bytes
    .subarray(0, 100)
    .toString('ascii')
    .match(/^P6\s+(\d+)\s+(\d+)\s+255\s/u);
  assert.ok(header);
  const width = Number(header[1]);
  const height = Number(header[2]);
  const pixels = bytes.subarray(Buffer.byteLength(header[0], 'ascii'));
  assert.equal(pixels.length, width * height * 3);
  return { width, height, pixels };
};
try {
  execFileSync(qpdf, ['--check', source], { stdio: 'pipe' });
  assert.match(execFileSync(pdfInfo, [source], { encoding: 'utf8' }), /^Pages:\s+11$/mu);
  for (const [index, findings] of expected.entries()) {
    const prefix = join(directory, `source-${index + 1}`);
    execFileSync(
      renderer,
      [
        '-cropbox',
        '-f',
        String(index + 1),
        '-l',
        String(index + 1),
        '-singlefile',
        '-r',
        '72',
        source,
        prefix,
      ],
      { stdio: 'pipe' },
    );
    const { width, height, pixels: rgb } = await readRaster(`${prefix}.ppm`);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      data.set([rgb[pixel * 3], rgb[pixel * 3 + 1], rgb[pixel * 3 + 2], 255], pixel * 4);
    }
    const areas = await measureDecorationTextAreas({ width, height }, options, index + 1, 11);
    const review = reviewDecorationPlacement(
      { width, height, data },
      { width, height },
      options,
      areas,
    );
    assert.equal(review.status, 'sampled');
    assert.deepEqual(
      review.bands.map((band) => band.finding === 'ink-detected'),
      findings,
      `Unexpected findings on synthetic page ${index + 1}`,
    );
    assert.ok(review.bands.every((band) => band.textArea.status === 'sampled'));
    if ([0, 2, 5, 7, 8].includes(index))
      assert.ok(review.bands.every((band) => band.textArea.finding === 'no-ink-detected'));
    if (index === 6)
      assert.ok(review.bands.every((band) => band.textArea.finding === 'ink-detected'));
    if (keep)
      execFileSync(
        renderer,
        [
          '-cropbox',
          '-f',
          String(index + 1),
          '-l',
          String(index + 1),
          '-singlefile',
          '-png',
          '-r',
          '96',
          source,
          prefix,
        ],
        { stdio: 'pipe' },
      );
  }
  assert.equal(decorationReviewGeometrySupported(3000, 3000), false);
  // Independently verify metric boxes contain actual rendered glyphs, including unkerned Tj.
  const metricSourcePath = resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');
  const metricSource = new Uint8Array(await readFile(metricSourcePath));
  const sourcePrefix = join(directory, 'metric-source');
  execFileSync(renderer, ['-cropbox', '-singlefile', '-r', '72', metricSourcePath, sourcePrefix], {
    stdio: 'pipe',
  });
  const originalRaster = await readRaster(`${sourcePrefix}.ppm`);
  let metricCases = 0;
  for (const alignment of ['left', 'center', 'right']) {
    const plan = {
      ...options,
      header: {
        ...options.header,
        text: 'AV'.repeat(18) + ' {page}/{pages}',
        alignment,
        fontSize: 12,
      },
      footer: { ...options.footer, text: 'gyp AV 1', alignment, fontSize: 12 },
    };
    const output = join(directory, `metric-${alignment}.pdf`);
    await writeFile(output, await decoratePdf(metricSource, plan));
    execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
    const prefix = join(directory, `metric-${alignment}`);
    execFileSync(renderer, ['-cropbox', '-singlefile', '-r', '72', output, prefix], {
      stdio: 'pipe',
    });
    const { width, height, pixels } = await readRaster(`${prefix}.ppm`);
    assert.equal(width, originalRaster.width);
    assert.equal(height, originalRaster.height);
    const areas = await measureDecorationTextAreas({ width, height }, plan, 1, 1);
    const changedPixels = areas.map(() => 0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 3;
        if (
          pixels
            .subarray(offset, offset + 3)
            .equals(originalRaster.pixels.subarray(offset, offset + 3))
        )
          continue;
        const areaIndex = areas.findIndex(
          (area) =>
            x >= Math.floor(area.left * width) &&
            x < Math.ceil(area.right * width) &&
            y >= Math.floor(area.top * height) &&
            y < Math.ceil(area.bottom * height),
        );
        assert.ok(areaIndex >= 0, 'Output changed outside its guarded text areas');
        changedPixels[areaIndex]++;
      }
    }
    assert.ok(
      changedPixels.every((count) => count > 10),
      'Expected visible decoration glyphs',
    );
    if (keep)
      execFileSync(renderer, ['-singlefile', '-png', '-r', '96', output, prefix], {
        stdio: 'pipe',
      });
    metricCases++;
  }
  process.stdout.write(
    `EDIT-006 independent source sampling passed: 10 Poppler page checks; ${metricCases} metric-box export renders; uncertainty and oversized guards retained.\n`,
  );
  if (keep) process.stdout.write(`Synthetic review renders retained at ${directory}.\n`);
} finally {
  if (!keep) await rm(directory, { recursive: true, force: true });
}
