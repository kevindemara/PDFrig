/** EDIT-002 research only. Fixed CC0 corpus, no user input, no production import.
 * An evaluated artifact is not an approved runtime dependency or shipped feature.
 */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceTextEvaluationVerdict } from './source-text-evaluation-policy.mjs';

const root = resolve(import.meta.dirname, '..');
const { PDFDocument } = await import(
  pathToFileURL(resolve(root, 'packages/pdf-engine/node_modules/@cantoo/pdf-lib/es/index.js')).href
);
const { updateSourceTextAccessibility } = await import(
  pathToFileURL(resolve(root, 'packages/pdf-engine/dist/source-text-accessibility.js')).href
);
const { snapshotTagStructures } = await import(
  pathToFileURL(resolve(root, 'packages/pdf-engine/dist/tag-preservation.js')).href
);
const candidate = resolve(root, '.tooling/text-engine-evaluation/package/dist');
const output = resolve(root, '.tooling/text-engine-evaluation/results');
const hashes = {
  'index.js': '0e31ce6c207b371384392242c560b5e88d90221843dfbbaebf3f5cff1e22f2e0',
  'pdfium.wasm': '5e4cd023c3dad4a895b3571ca573d3fc51bac6de48360d95283134385b954eaa',
};
const cases = [
  'smoke-one-page.pdf',
  'outline-navigation.pdf',
  'rotated-pages.pdf',
  'tagged-bookmarks.pdf',
];
const manifest = JSON.parse(
  await readFile(resolve(root, 'packages/test-corpus/fixtures/manifest.json'), 'utf8'),
);
const fail = (code) => {
  throw new Error(code);
};
for (const [file, expected] of Object.entries(hashes)) {
  const bytes = await readFile(resolve(candidate, file));
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    fail('TEXT_SPIKE_ARTIFACT_MISMATCH');
}
const { init } = await import(pathToFileURL(resolve(candidate, 'index.js')).href);
const engine = await init({
  wasmBinary: await readFile(resolve(candidate, 'pdfium.wasm')),
  print: () => {
    /* Suppress native diagnostic output; only the bounded report leaves this harness. */
  },
  printErr: () => {
    /* Never forward parser/native stderr as a product diagnostic. */
  },
});
engine.PDFiumExt_Init();
const memory = engine.pdfium;
// The shipped runtime declaration exposes allocation through wasmExports.
// Keep heap views on the live module (a copied view can become stale after growth).
memory.malloc = memory.wasmExports.malloc;
memory.free = memory.wasmExports.free;
await mkdir(output, { recursive: true });
const results = [];
for (const [caseIndex, filename] of cases.entries()) {
  const entry = manifest.fixtures.find((item) => item.filename === filename);
  if (entry?.license !== 'CC0-1.0' || entry.sensitivity !== 'none')
    fail('TEXT_SPIKE_CORPUS_REQUIRED');
  const sourcePath = resolve(root, 'packages/test-corpus/fixtures', filename);
  const source = await readFile(sourcePath);
  const before = createHash('sha256').update(source).digest('hex');
  if (before !== entry.sha256) fail('TEXT_SPIKE_CORPUS_MISMATCH');
  const buffer = memory.malloc(source.length);
  memory.HEAPU8.set(source, buffer);
  const document = engine.FPDF_LoadMemDocument(buffer, source.length, '');
  if (!document) fail('TEXT_SPIKE_LOAD_FAILED');
  const page = engine.FPDF_LoadPage(document, 0);
  const textPage = engine.FPDFText_LoadPage(page);
  let object = 0;
  for (let index = 0; index < engine.FPDFPage_CountObjects(page); index++) {
    const current = engine.FPDFPage_GetObject(page, index);
    if (engine.FPDFPageObj_GetType(current) === 1) {
      object = current;
      break;
    }
  }
  if (!object) fail('TEXT_SPIKE_TEXT_MISSING');
  const originalTextSize = engine.FPDFTextObj_GetText(object, textPage, 0, 0);
  const textBuffer = memory.malloc(originalTextSize);
  engine.FPDFTextObj_GetText(object, textPage, textBuffer, originalTextSize);
  const originalText = memory.UTF16ToString(textBuffer);
  memory.free(textBuffer);
  const bounds = memory.malloc(16);
  if (!engine.FPDFPageObj_GetBounds(object, bounds, bounds + 4, bounds + 8, bounds + 12))
    fail('TEXT_SPIKE_BOUNDS_FAILED');
  const rectangle = Array.from(memory.HEAPF32.subarray(bounds / 4, bounds / 4 + 4));
  memory.free(bounds);
  const replacement = 'SOURCE EDIT';
  const markedContentId = engine.FPDFPageObj_GetMarkedContentID(object);
  const taggedCase = entry.expectedFeatures.includes('tagged-reading-order');
  if (taggedCase && markedContentId < 0) fail('TEXT_SPIKE_MARKED_CONTENT_MISSING');
  if (taggedCase) {
    let owners = 0;
    for (let index = 0; index < engine.FPDFPage_CountObjects(page); index++)
      if (
        engine.FPDFPageObj_GetMarkedContentID(engine.FPDFPage_GetObject(page, index)) ===
        markedContentId
      )
        owners++;
    if (owners !== 1) fail('TEXT_SPIKE_MARKED_CONTENT_AMBIGUOUS');
  }
  const replacementBuffer = memory.malloc((replacement.length + 1) * 2);
  memory.stringToUTF16(replacement, replacementBuffer, (replacement.length + 1) * 2);
  if (!engine.FPDFText_SetText(object, replacementBuffer)) fail('TEXT_SPIKE_REPLACE_FAILED');
  memory.free(replacementBuffer);
  engine.FPDFText_ClosePage(textPage);
  if (!engine.FPDFPage_GenerateContent(page)) fail('TEXT_SPIKE_GENERATE_FAILED');
  const writer = engine.PDFiumExt_OpenFileWriter();
  if (!writer || !engine.FPDF_SaveAsCopy(document, writer, 0)) fail('TEXT_SPIKE_SAVE_FAILED');
  const size = engine.PDFiumExt_GetFileWriterSize(writer);
  const savedBuffer = memory.malloc(size);
  engine.PDFiumExt_GetFileWriterData(writer, savedBuffer, size);
  let saved = memory.HEAPU8.slice(savedBuffer, savedBuffer + size);
  memory.free(savedBuffer);
  engine.PDFiumExt_CloseFileWriter(writer);
  engine.FPDF_ClosePage(page);
  engine.FPDF_CloseDocument(document);
  memory.free(buffer);
  if (taggedCase) {
    const semanticChange = {
      pageIndex: 0,
      markedContentId,
      expectedText: originalText,
      replacementText: replacement,
    };
    const expected = await PDFDocument.load(source, { updateMetadata: false });
    updateSourceTextAccessibility(expected, semanticChange);
    const expectedTags = await snapshotTagStructures(expected);
    const edited = await PDFDocument.load(saved, { updateMetadata: false });
    updateSourceTextAccessibility(edited, semanticChange);
    saved = await edited.save({ updateFieldAppearances: false });
    const reopened = await PDFDocument.load(saved, { updateMetadata: false });
    if (expectedTags?.graph !== (await snapshotTagStructures(reopened))?.graph)
      fail('TEXT_SPIKE_TAG_GRAPH_MISMATCH');
  }
  const outputPath = resolve(output, `case-${caseIndex}.pdf`);
  await writeFile(outputPath, saved);
  const qpdf = process.env.PDFMASON_QPDF_PATH ?? 'qpdf';
  execFileSync(qpdf, ['--check', outputPath], { stdio: 'pipe', timeout: 10_000 });
  const python = process.env.PDFMASON_PYTHON_PATH ?? 'python';
  const report = JSON.parse(
    execFileSync(
      python,
      [
        resolve(root, 'scripts/verify-source-text-spike.py'),
        sourcePath,
        outputPath,
        originalText,
        replacement,
        JSON.stringify(rectangle),
      ],
      { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
  if (
    createHash('sha256')
      .update(await readFile(sourcePath))
      .digest('hex') !== before
  )
    fail('TEXT_SPIKE_SOURCE_CHANGED');
  results.push({ caseIndex, ...report });
}
console.log(
  JSON.stringify({
    featureId: 'EDIT-002',
    engine: '@embedpdf/pdfium@2.15.1',
    ...sourceTextEvaluationVerdict(results),
    results,
  }),
);
