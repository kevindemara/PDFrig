import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { resourceUsage } from 'node:process';

import { compressPdfLosslessly } from '../packages/pdf-engine/dist/index.js';

const requireFromEngine = createRequire(
  resolve(import.meta.dirname, '../packages/pdf-engine/package.json'),
);
const { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } =
  requireFromEngine('@cantoo/pdf-lib');

const [caseId, inputPath] = process.argv.slice(2);
if (caseId === undefined || !/^[a-z0-9-]{1,64}$/u.test(caseId) || inputPath === undefined) {
  process.stderr.write('Invalid isolated parser case request.\n');
  process.exitCode = 2;
} else {
  const bytes = new Uint8Array(await readFile(inputPath));
  const usageBefore = resourceUsage();
  const started = performance.now();
  let decodedBytes = 0;
  let outcome = 'success';
  let outputBytes = 0;
  try {
    if (caseId === 'flate-4mib') {
      const diagnostic = await PDFDocument.load(bytes, { updateMetadata: false });
      const stream = diagnostic.catalog.lookup(PDFName.of('PDFMasonDiagnosticStream'));
      if (!(stream instanceof PDFRawStream))
        throw new Error('Missing synthetic diagnostic stream.');
      decodedBytes = decodePDFRawStream(stream).decode().byteLength;
    }
    const result = await compressPdfLosslessly(bytes, 'balanced');
    outputBytes = result.bytes.byteLength;
  } catch (error) {
    outcome =
      error instanceof Error && /^UTILITY_[A-Z_]+$/u.test(error.message)
        ? error.message
        : 'UNREVIEWED_FAILURE';
  }
  const usage = resourceUsage();
  process.stdout.write(
    `${JSON.stringify({
      caseId,
      decodedBytes,
      elapsedMs: Math.round((performance.now() - started) * 1_000) / 1_000,
      inputBytes: bytes.byteLength,
      maxRssBytes: usage.maxRSS * 1_024,
      outcome,
      outputBytes,
      systemCpuMs: Math.round(usage.systemCPUTime - usageBefore.systemCPUTime) / 1_000,
      userCpuMs: Math.round(usage.userCPUTime - usageBefore.userCPUTime) / 1_000,
    })}\n`,
  );
  if (outcome === 'UNREVIEWED_FAILURE') process.exitCode = 2;
}
