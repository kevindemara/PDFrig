import { execFile as execFileCallback } from 'node:child_process';
import { open, lstat, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const FIXED_INPUT = '/job/input/source.pdf';
const FIXED_OUTPUT = '/job/output/output.pdf';
const SUPPORTED_LANGUAGES = Object.freeze(['eng', 'fra'] as const);
const DEFAULT_LIMITS = Object.freeze({
  inputBytes: 50_000_000,
  maximumPages: 50,
  maximumPixelsPerPage: 20_000_000,
  outputBytes: 200_000_000,
  timeoutMilliseconds: 180_000,
});

export interface OcrMetrics {
  readonly engineName: 'tesseract';
  readonly engineVersion: string;
  readonly inputBytes: number;
  readonly languageCount: number;
  readonly outputBytes: number;
  readonly pageCount: number;
}

interface OcrLimits {
  readonly inputBytes: number;
  readonly maximumPages: number;
  readonly maximumPixelsPerPage: number;
  readonly outputBytes: number;
  readonly timeoutMilliseconds: number;
}

interface PdfInfo {
  readonly pageCount: number;
  readonly pageSizes: readonly { readonly height: number; readonly width: number }[];
}

const safeInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const limitsFromEnvironment = (): OcrLimits => ({
  inputBytes: safeInteger(process.env.PDFMASON_OCR_INPUT_LIMIT_BYTES, DEFAULT_LIMITS.inputBytes),
  maximumPages: safeInteger(process.env.PDFMASON_OCR_MAXIMUM_PAGES, DEFAULT_LIMITS.maximumPages),
  maximumPixelsPerPage: safeInteger(
    process.env.PDFMASON_OCR_MAXIMUM_PIXELS,
    DEFAULT_LIMITS.maximumPixelsPerPage,
  ),
  outputBytes: safeInteger(process.env.PDFMASON_OCR_OUTPUT_LIMIT_BYTES, DEFAULT_LIMITS.outputBytes),
  timeoutMilliseconds: safeInteger(process.env.PDFMASON_OCR_TIMEOUT_SECONDS, 180) * 1_000,
});

const languagesFromEnvironment = (): readonly string[] => {
  const configured = (process.env.PDFMASON_OCR_LANGUAGES ?? 'eng,fra')
    .split(',')
    .map((language) => language.trim())
    .filter((language, index, all) => language.length > 0 && all.indexOf(language) === index);
  if (
    configured.length === 0 ||
    configured.some(
      (language) => !SUPPORTED_LANGUAGES.includes(language as (typeof SUPPORTED_LANGUAGES)[number]),
    )
  )
    throw new Error('OCR_LANGUAGE_UNSUPPORTED');
  return Object.freeze(configured);
};

const run = async (
  command: string,
  arguments_: readonly string[],
  timeoutMilliseconds: number,
): Promise<string> => {
  try {
    const { stdout } = await execFile(command, arguments_, {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      shell: false,
      timeout: timeoutMilliseconds,
      windowsHide: true,
    });
    return stdout;
  } catch {
    throw new Error('OCR_ENGINE_FAILED');
  }
};

const parsePdfInfo = (output: string): PdfInfo => {
  const pageMatch = /^Pages:\s+(\d+)\s*$/imu.exec(output);
  if (pageMatch?.[1] === undefined) throw new Error('OCR_INPUT_UNSUPPORTED');
  const pageCount = Number(pageMatch[1]);
  const pageSizes = Array.from(
    output.matchAll(/^Page\s+\d+\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/gimu),
    (match) => ({ width: Number(match[1]), height: Number(match[2]) }),
  );
  if (pageSizes.length === 0) {
    const defaultSize = /^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/imu.exec(output);
    if (defaultSize?.[1] === undefined || defaultSize[2] === undefined)
      throw new Error('OCR_INPUT_UNSUPPORTED');
    return {
      pageCount,
      pageSizes: Object.freeze(
        Array.from({ length: pageCount }, () => ({
          height: Number(defaultSize[2]),
          width: Number(defaultSize[1]),
        })),
      ),
    };
  }
  if (pageSizes.length !== pageCount) throw new Error('OCR_INPUT_UNSUPPORTED');
  return { pageCount, pageSizes: Object.freeze(pageSizes) };
};

const assertPdfInput = async (input: string, limits: OcrLimits): Promise<number> => {
  if (resolve(input) !== FIXED_INPUT || basename(input) !== 'source.pdf')
    throw new Error('OCR_INPUT_PATH_BLOCKED');
  const inputStat = await lstat(input);
  if (!inputStat.isFile() || inputStat.isSymbolicLink()) throw new Error('OCR_INPUT_PATH_BLOCKED');
  if (inputStat.size <= 0 || inputStat.size > limits.inputBytes) throw new Error('OCR_INPUT_LIMIT');
  const handle = await open(input, 'r');
  try {
    const magic = Buffer.alloc(5);
    await handle.read(magic, 0, magic.length, 0);
    if (magic.toString('ascii') !== '%PDF-') throw new Error('OCR_INPUT_UNSUPPORTED');
  } finally {
    await handle.close();
  }
  return inputStat.size;
};

const engineVersion = async (timeoutMilliseconds: number): Promise<string> => {
  const output = await run('tesseract', ['--version'], timeoutMilliseconds);
  const version = /^tesseract\s+([0-9.]+)/imu.exec(output)?.[1];
  if (version === undefined) throw new Error('OCR_ENGINE_FAILED');
  return version;
};

export const createSearchablePdf = async (
  input = FIXED_INPUT,
  output = FIXED_OUTPUT,
): Promise<OcrMetrics> => {
  const limits = limitsFromEnvironment();
  const languages = languagesFromEnvironment();
  const inputBytes = await assertPdfInput(input, limits);
  if (resolve(output) !== FIXED_OUTPUT) throw new Error('OCR_OUTPUT_PATH_BLOCKED');
  await mkdir('/job/output', { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), 'pdfmason-ocr-'));
  try {
    const info = parsePdfInfo(
      await run(
        'pdfinfo',
        ['-f', '1', '-l', String(limits.maximumPages + 1), '-box', input],
        limits.timeoutMilliseconds,
      ),
    );
    if (info.pageCount < 1 || info.pageCount > limits.maximumPages)
      throw new Error('OCR_PAGE_LIMIT');
    for (const size of info.pageSizes) {
      const pixels = Math.ceil((size.width / 72) * 200) * Math.ceil((size.height / 72) * 200);
      if (!Number.isFinite(pixels) || pixels > limits.maximumPixelsPerPage)
        throw new Error('OCR_PAGE_PIXEL_LIMIT');
    }

    const pagePrefix = join(scratch, 'page');
    await run(
      'pdftoppm',
      ['-f', '1', '-l', String(info.pageCount), '-png', '-r', '200', input, pagePrefix],
      limits.timeoutMilliseconds,
    );
    const pageFiles = (await readdir(scratch))
      .filter((filename) => /^page-\d+\.png$/u.test(filename))
      .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
      .map((filename) => join(scratch, filename));
    if (pageFiles.length !== info.pageCount) throw new Error('OCR_RENDER_FAILED');
    const listPath = join(scratch, 'pages.txt');
    await writeFile(listPath, `${pageFiles.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    const layerStem = join(scratch, 'text-layer');
    await run(
      'tesseract',
      [
        listPath,
        layerStem,
        '-l',
        languages.join('+'),
        '--dpi',
        '200',
        '-c',
        'textonly_pdf=1',
        'pdf',
      ],
      limits.timeoutMilliseconds,
    );
    const layerPath = `${layerStem}.pdf`;
    await run('qpdf', [input, '--overlay', layerPath, '--', output], limits.timeoutMilliseconds);
    await run('qpdf', ['--check', output], limits.timeoutMilliseconds);
    const outputStat = await stat(output);
    if (outputStat.size <= 0 || outputStat.size > limits.outputBytes)
      throw new Error('OCR_OUTPUT_LIMIT');
    const outputInfo = parsePdfInfo(
      await run(
        'pdfinfo',
        ['-f', '1', '-l', String(info.pageCount), '-box', output],
        limits.timeoutMilliseconds,
      ),
    );
    if (outputInfo.pageCount !== info.pageCount) throw new Error('OCR_VERIFICATION_FAILED');
    const fonts = await run('pdffonts', [output], limits.timeoutMilliseconds);
    if (fonts.trim().split(/\r?\n/u).length < 3) throw new Error('OCR_VERIFICATION_FAILED');
    return Object.freeze({
      engineName: 'tesseract',
      engineVersion: await engineVersion(limits.timeoutMilliseconds),
      inputBytes,
      languageCount: languages.length,
      outputBytes: outputStat.size,
      pageCount: info.pageCount,
    });
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
};
