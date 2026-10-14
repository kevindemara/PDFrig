import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  compressPdfLosslessly,
  createBlankPdf,
  createStoredZip,
  decoratePdf,
  imagesToPdf,
  modifyPdfGeometry,
  numberPdf,
  protectPdf,
  unlockPdf,
  updatePdfMetadata,
} from '../packages/pdf-engine/dist/index.js';

const qpdf =
  process.env.PDFMASON_QPDF_PATH ??
  (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
const pdfInfo = process.env.PDFMASON_PDFINFO_PATH ?? 'pdfinfo';
const pdfToPpm =
  process.env.PDFMASON_PDFTOPPM_PATH ??
  (pdfInfo === 'pdfinfo' ? 'pdftoppm' : join(dirname(pdfInfo), 'pdftoppm.exe'));
const configuredPython = process.env.PDFMASON_PYTHON_PATH;
const python = configuredPython ?? (process.platform === 'win32' ? 'py' : 'python');
const pythonPrefixArguments =
  configuredPython === undefined && process.platform === 'win32' ? ['-3'] : [];
const password = 'synthetic-utility-password';
const keepOutput = process.env.PDFMASON_KEEP_VERIFICATION_OUTPUT === '1';
const outputDirectory = await mkdtemp(join(tmpdir(), 'pdfmason-utilities-'));

const ppmContainsVisibleInk = (bytes) => {
  const header = bytes
    .subarray(0, 100)
    .toString('ascii')
    .match(/^P6\s+(\d+)\s+(\d+)\s+255\s/u);
  if (header === null) throw new Error('Invalid independent PPM render.');
  const width = Number(header[1]);
  const height = Number(header[2]);
  const pixelOffset = Buffer.byteLength(header[0], 'ascii');
  if (bytes.byteLength !== pixelOffset + width * height * 3)
    throw new Error('Incomplete independent PPM render.');
  let inkPixels = 0;
  for (let offset = pixelOffset; offset < bytes.byteLength; offset += 3) {
    if (
      (bytes[offset] ?? 255) < 245 ||
      (bytes[offset + 1] ?? 255) < 245 ||
      (bytes[offset + 2] ?? 255) < 245
    ) {
      inkPixels += 1;
      if (inkPixels >= 30) return true;
    }
  }
  return false;
};

try {
  const source = new Uint8Array(
    await readFile(resolve('packages/test-corpus/fixtures/smoke-one-page.pdf')),
  );
  const decorationSource = new Uint8Array(
    await readFile(resolve('packages/test-corpus/fixtures/multipage-three.pdf')),
  );
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const compressed = await compressPdfLosslessly(source, 'smaller');
  const blankBytes = await createBlankPdf({
    pageCount: 3,
    marginPoints: 72,
    orientation: 'landscape',
    pageSize: 'a4',
  });
  const protectedBytes = await protectPdf(source, password);
  const unlockedBytes = await unlockPdf(protectedBytes, password, true);
  const metadataBytes = await updatePdfMetadata(source, {
    author: 'PDFMason synthetic verification',
    subject: 'Milestone 4 utility fixture',
    title: 'Synthetic utility output',
  });
  const decoratedBytes = await decoratePdf(decorationSource, {
    footer: {
      alignment: 'right',
      color: '#17232d',
      fontSize: 9,
      text: 'Page {page} of {pages}',
    },
    header: {
      alignment: 'left',
      color: '#17232d',
      fontSize: 9,
      text: 'Synthetic review copy',
    },
    marginPoints: 28,
    pageSelection: 'all',
    watermark: {
      color: '#60717c',
      fontSize: 48,
      opacity: 0.16,
      rotation: -35,
      text: 'INTERNAL',
    },
  });
  const labeled = await numberPdf(decorationSource, {
    alignment: 'center',
    color: '#17232d',
    endPage: null,
    fontSize: 9,
    kind: 'page-labels',
    marginPoints: 28,
    position: 'footer',
    prefix: 'SEC-',
    replaceExistingLabels: false,
    startNumber: 1,
    startPage: 1,
    style: 'roman-lower',
  });
  const bates = await numberPdf(labeled.bytes, {
    alignment: 'right',
    color: '#17232d',
    digits: 6,
    endPage: null,
    fontSize: 9,
    kind: 'bates',
    marginPoints: 40,
    position: 'header',
    prefix: 'CASE-',
    startNumber: 42,
    startPage: 1,
    suffix: '',
  });
  const cropped = await modifyPdfGeometry(decorationSource, {
    endPage: null,
    kind: 'crop',
    margins: { bottom: 30, left: 36, right: 24, top: 18 },
    startPage: 1,
  });
  const resized = await modifyPdfGeometry(decorationSource, {
    endPage: null,
    fit: 'contain',
    kind: 'resize',
    startPage: 1,
    targetHeight: 595.28,
    targetWidth: 841.89,
  });
  if (
    bates.report.firstIdentifier !== 'CASE-000042' ||
    bates.report.lastIdentifier !== 'CASE-000044' ||
    bates.report.appliedPages !== 3
  ) {
    throw new Error('The local Bates report did not describe the deterministic sequence.');
  }
  const imagePdfBytes = await imagesToPdf(
    [
      { bytes: png, mimeType: 'image/png' },
      { bytes: png, mimeType: 'image/png' },
    ],
    { fit: 'contain', pageSize: 'letter' },
  );

  const outputs = {
    bates: join(outputDirectory, 'bates.pdf'),
    blank: join(outputDirectory, 'blank.pdf'),
    compressed: join(outputDirectory, 'compressed.pdf'),
    cropped: join(outputDirectory, 'cropped.pdf'),
    decorated: join(outputDirectory, 'decorated.pdf'),
    images: join(outputDirectory, 'images.pdf'),
    imagesArchive: join(outputDirectory, 'images.zip'),
    metadata: join(outputDirectory, 'metadata.pdf'),
    pageLabels: join(outputDirectory, 'page-labels.pdf'),
    protected: join(outputDirectory, 'protected.pdf'),
    resized: join(outputDirectory, 'resized.pdf'),
    unlocked: join(outputDirectory, 'unlocked.pdf'),
  };
  await Promise.all([
    writeFile(outputs.bates, bates.bytes),
    writeFile(outputs.blank, blankBytes),
    writeFile(outputs.compressed, compressed.bytes),
    writeFile(outputs.cropped, cropped.bytes),
    writeFile(outputs.decorated, decoratedBytes),
    writeFile(outputs.images, imagePdfBytes),
    writeFile(
      outputs.imagesArchive,
      createStoredZip([
        { bytes: png, name: 'page-001.png' },
        { bytes: png, name: 'page-002.png' },
      ]),
    ),
    writeFile(outputs.metadata, metadataBytes),
    writeFile(outputs.pageLabels, labeled.bytes),
    writeFile(outputs.protected, protectedBytes),
    writeFile(outputs.resized, resized.bytes),
    writeFile(outputs.unlocked, unlockedBytes),
  ]);

  for (const output of [
    outputs.blank,
    outputs.compressed,
    outputs.cropped,
    outputs.decorated,
    outputs.bates,
    outputs.images,
    outputs.metadata,
    outputs.pageLabels,
    outputs.resized,
    outputs.unlocked,
  ]) {
    execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  }
  execFileSync(qpdf, [`--password=${password}`, '--check', outputs.protected], { stdio: 'pipe' });
  const encryption = execFileSync(
    qpdf,
    [`--password=${password}`, '--show-encryption', outputs.protected],
    { encoding: 'utf8' },
  );
  if (!/R = 6/u.test(encryption) || !/AESv3/u.test(encryption)) {
    throw new Error('qpdf did not report AES-256 revision 6 encryption.');
  }

  execFileSync(
    python,
    [
      ...pythonPrefixArguments,
      resolve('scripts/verify-pdf-utilities.py'),
      outputs.compressed,
      outputs.decorated,
      outputs.pageLabels,
      outputs.bates,
      outputs.cropped,
      outputs.resized,
      outputs.protected,
      outputs.unlocked,
      outputs.metadata,
      outputs.images,
      outputs.imagesArchive,
      outputs.blank,
      password,
    ],
    { stdio: 'inherit' },
  );
  const renderBase = join(outputDirectory, 'images-first-page');
  execFileSync(pdfToPpm, [
    '-f',
    '1',
    '-singlefile',
    '-png',
    '-r',
    '96',
    outputs.images,
    renderBase,
  ]);
  const render = await readFile(`${renderBase}.png`);
  if (render.byteLength < 1_000 || render.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new Error('Poppler did not render the images-to-PDF output successfully.');
  }
  for (const pageNumber of [1, 2, 3]) {
    const blankRenderBase = join(outputDirectory, `blank-page-${pageNumber}`);
    execFileSync(pdfToPpm, [
      '-f',
      String(pageNumber),
      '-singlefile',
      '-r',
      '72',
      outputs.blank,
      blankRenderBase,
    ]);
    const blankRender = await readFile(`${blankRenderBase}.ppm`);
    if (ppmContainsVisibleInk(blankRender)) {
      throw new Error('The blank PDF render unexpectedly contains visible ink.');
    }
  }
  const decoratedRenderBase = join(outputDirectory, 'decorated-first-page');
  execFileSync(pdfToPpm, [
    '-f',
    '1',
    '-singlefile',
    '-png',
    '-r',
    '96',
    outputs.decorated,
    decoratedRenderBase,
  ]);
  const decoratedRender = await readFile(`${decoratedRenderBase}.png`);
  if (
    decoratedRender.byteLength < 1_000 ||
    decoratedRender.subarray(1, 4).toString('ascii') !== 'PNG'
  ) {
    throw new Error('Poppler did not render the decorated PDF output successfully.');
  }
  const batesRenderBase = join(outputDirectory, 'bates-first-page');
  execFileSync(pdfToPpm, [
    '-f',
    '1',
    '-singlefile',
    '-png',
    '-r',
    '96',
    outputs.bates,
    batesRenderBase,
  ]);
  const batesRender = await readFile(`${batesRenderBase}.png`);
  if (batesRender.byteLength < 1_000 || batesRender.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new Error('Poppler did not render the Bates-numbered PDF output successfully.');
  }
  for (const [name, output] of [
    ['cropped', outputs.cropped],
    ['resized', outputs.resized],
  ]) {
    const renderBase = join(outputDirectory, `${name}-first-page`);
    execFileSync(pdfToPpm, ['-f', '1', '-singlefile', '-r', '96', output, renderBase]);
    const geometryRender = await readFile(`${renderBase}.ppm`);
    if (!ppmContainsVisibleInk(geometryRender)) {
      throw new Error(`Poppler did not render visible ${name} PDF content successfully.`);
    }
  }

  process.stdout.write(
    `Independent utility verification passed: qpdf AES-256/checks, pypdf reopen/metadata/page-label/page-box/blank-ArtBox/artifact inspection, Python ZIP reopen, and Poppler renders including three ink-free blank pages. Lossless output ${compressed.report.outputBytes}/${compressed.report.originalBytes} bytes.\n`,
  );
  if (keepOutput)
    process.stdout.write(`Kept utility verification outputs at ${outputDirectory}.\n`);
  await import('./verify-numbering-placement.mjs');
} finally {
  if (!keepOutput) await rm(outputDirectory, { force: true, recursive: true });
}
