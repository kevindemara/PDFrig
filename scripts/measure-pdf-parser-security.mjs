import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpus, homedir, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

const workspace = resolve(import.meta.dirname, '..');
const requireFromEngine = createRequire(resolve(workspace, 'packages/pdf-engine/package.json'));
const { PDFDocument, PDFName } = requireFromEngine('@cantoo/pdf-lib');
const childRunner = resolve(workspace, 'scripts/measure-pdf-parser-case.mjs');
const smokePath = resolve(workspace, 'packages/test-corpus/fixtures/smoke-one-page.pdf');
const incrementalPath = resolve(
  workspace,
  'packages/test-corpus/fixtures/compression-incremental.pdf',
);
const childHeapMiB = 256;
const harnessTimeoutMs = 10_000;

const caseDefinitions = Object.freeze([
  { expectedOutcome: 'success', id: 'baseline' },
  { expectedOutcome: 'success', id: 'page-boundary-500', pageCount: 500 },
  { expectedOutcome: 'success', id: 'object-breadth-2048', objectBreadth: 2_048 },
  { expectedOutcome: 'success', id: 'nested-array-depth-48', nestingDepth: 48 },
  { expectedOutcome: 'success', expandedStreamBytes: 4 * 1024 * 1024, id: 'flate-4mib' },
  { expectedOutcome: 'UTILITY_PDF_MALFORMED', id: 'wrong-startxref' },
  { expectedOutcome: 'UTILITY_PDF_MALFORMED', id: 'damaged-object' },
  {
    expectedOutcome: 'UTILITY_INCREMENTAL_REVISIONS_BLOCKED',
    id: 'incremental-history',
  },
]);

const parseArguments = (argumentsToParse) => {
  let outputPath = resolve(workspace, 'tmp/parser-security/report.json');
  let selectedCase = null;
  for (let index = 0; index < argumentsToParse.length; index += 1) {
    const argument = argumentsToParse[index];
    if (argument === '--output') {
      const value = argumentsToParse[index + 1];
      if (value === undefined) throw new Error('Missing --output value.');
      outputPath = resolve(workspace, value);
      index += 1;
    } else if (argument === '--case') {
      const value = argumentsToParse[index + 1];
      if (value === undefined) throw new Error('Missing --case value.');
      selectedCase = value;
      index += 1;
    } else if (argument !== undefined) throw new Error('Unknown parser measurement argument.');
  }
  if (outputPath === workspace || outputPath === homedir())
    throw new Error('Unsafe parser report target.');
  return { outputPath, selectedCase };
};

const mutateSameLength = (bytes, pattern, replacement) => {
  const source = Buffer.from(bytes).toString('latin1');
  const candidate = source.replace(pattern, replacement);
  if (candidate === source || candidate.length !== source.length)
    throw new Error('Synthetic parser mutation failed.');
  return Buffer.from(candidate, 'latin1');
};

const createDiagnostic = async (definition, smoke, incremental) => {
  if (definition.id === 'baseline') return smoke;
  if (definition.id === 'incremental-history') return incremental;
  if (definition.id === 'wrong-startxref') {
    const source = Buffer.from(smoke).toString('latin1');
    const offset = /startxref\s+(\d+)\s+%%EOF\s*$/u.exec(source)?.[1];
    if (offset === undefined) throw new Error('Missing synthetic startxref.');
    return mutateSameLength(
      smoke,
      new RegExp(`startxref\\s+${offset}`, 'u'),
      `startxref\n${'0'.repeat(offset.length)}`,
    );
  }
  if (definition.id === 'damaged-object') return mutateSameLength(smoke, /1 0 obj/u, '1 0 obx');

  const source = await PDFDocument.load(smoke, { updateMetadata: false });
  if (definition.id === 'page-boundary-500') {
    const document = await PDFDocument.create({ updateMetadata: false });
    for (const page of await document.copyPages(source, Array(500).fill(0))) document.addPage(page);
    return document.save({ addDefaultPage: false, useObjectStreams: true });
  }
  const document = await PDFDocument.load(smoke, { updateMetadata: false });
  if (definition.id === 'object-breadth-2048') {
    const references = [];
    for (let index = 0; index < 2_048; index += 1)
      references.push(document.context.register(document.context.obj({ DiagnosticIndex: index })));
    document.catalog.set(PDFName.of('PDFMasonDiagnosticObjects'), document.context.obj(references));
  } else if (definition.id === 'nested-array-depth-48') {
    let nested = document.context.obj('synthetic-leaf');
    for (let depth = 0; depth < 48; depth += 1) nested = document.context.obj([nested]);
    document.catalog.set(PDFName.of('PDFMasonDiagnosticNesting'), nested);
  } else if (definition.id === 'flate-4mib') {
    const expanded = new Uint8Array(4 * 1024 * 1024).fill(65);
    const stream = document.context.register(document.context.flateStream(expanded));
    document.catalog.set(PDFName.of('PDFMasonDiagnosticStream'), stream);
  } else throw new Error('Unknown synthetic parser case.');
  return document.save({ addDefaultPage: false, useObjectStreams: true });
};

const run = async () => {
  const { outputPath, selectedCase } = parseArguments(process.argv.slice(2));
  const selected =
    selectedCase === null
      ? caseDefinitions
      : caseDefinitions.filter(({ id }) => id === selectedCase);
  if (selected.length === 0) throw new Error('Unknown synthetic parser case.');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'pdfmason-parser-security-'));
  try {
    const [smoke, incremental] = await Promise.all([
      readFile(smokePath),
      readFile(incrementalPath),
    ]);
    const measurements = [];
    for (const definition of selected) {
      const bytes = await createDiagnostic(definition, smoke, incremental);
      const inputPath = join(temporaryRoot, `${definition.id}.pdf`);
      await writeFile(inputPath, bytes);
      const child = spawnSync(
        process.execPath,
        [`--max-old-space-size=${childHeapMiB}`, childRunner, definition.id, inputPath],
        {
          cwd: workspace,
          encoding: 'utf8',
          env: { ...process.env, NODE_OPTIONS: '' },
          maxBuffer: 256 * 1024,
          shell: false,
          timeout: harnessTimeoutMs,
          windowsHide: true,
        },
      );
      if (child.error?.code === 'ETIMEDOUT')
        throw new Error(`Synthetic parser case timed out: ${definition.id}`);
      if (child.status !== 0)
        throw new Error(`Synthetic parser child stopped unexpectedly: ${definition.id}`);
      const line = child.stdout
        .trim()
        .split(/\r?\n/u)
        .findLast((candidate) => candidate.startsWith('{'));
      if (line === undefined)
        throw new Error(`Synthetic parser case returned no result: ${definition.id}`);
      const measurement = JSON.parse(line);
      if (
        measurement.caseId !== definition.id ||
        measurement.outcome !== definition.expectedOutcome
      )
        throw new Error(`Synthetic parser outcome changed: ${definition.id}`);
      if (
        definition.expandedStreamBytes !== undefined &&
        measurement.decodedBytes !== definition.expandedStreamBytes
      )
        throw new Error(`Synthetic stream expansion changed: ${definition.id}`);
      measurements.push({
        ...measurement,
        expectedOutcome: definition.expectedOutcome,
        inputSha256: createHash('sha256').update(bytes).digest('hex'),
        profile: Object.fromEntries(
          Object.entries(definition).filter(([key]) => key !== 'expectedOutcome' && key !== 'id'),
        ),
      });
    }
    const cpu = cpus();
    const report = {
      featureIds: ['OPT-001', 'SEC-006'],
      generatedAt: new Date().toISOString(),
      harnessSafetyCaps: {
        childHeapMiB,
        classification: 'measurement-process-only-not-product-limits',
        timeoutMs: harnessTimeoutMs,
      },
      measurements,
      referenceHost: {
        architecture: process.arch,
        cpuModel: cpu[0]?.model.trim() ?? 'unknown',
        logicalCpuCount: cpu.length,
        nodeVersion: process.versions.node,
        osRelease: release(),
        platform: platform(),
        totalMemoryBytes: totalmem(),
      },
      schemaVersion: 1,
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
};

try {
  await run();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Parser measurement stopped.'}\n`,
  );
  process.exitCode = 1;
}
