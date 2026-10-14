import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, parse, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

export const OFFICE_OPERATION = 'convert.office.pdf';
export const OFFICE_ENGINE_VERSION = '26.2.5.2';
export const OFFICE_INPUT_LIMIT_BYTES = 50_000_000;
export const OFFICE_OUTPUT_LIMIT_BYTES = 200_000_000;
export const OFFICE_TIMEOUT_MILLISECONDS = 120_000;
export const OFFICE_ARCHIVE_UNCOMPRESSED_LIMIT_BYTES = 250_000_000;

export interface OfficeLimits {
  readonly expandedLimitBytes: number;
  readonly inputLimitBytes: number;
  readonly outputLimitBytes: number;
  readonly timeoutMilliseconds: number;
}

const boundedEnvironmentInteger = (
  input: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const raw = input[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/u.test(raw)) throw new Error('OFFICE_CONFIGURATION_INVALID');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('OFFICE_CONFIGURATION_INVALID');
  }
  return value;
};

export const parseOfficeLimits = (
  input: Readonly<Record<string, string | undefined>>,
): OfficeLimits =>
  Object.freeze({
    expandedLimitBytes: boundedEnvironmentInteger(
      input,
      'PDFMASON_OFFICE_EXPANDED_LIMIT_BYTES',
      OFFICE_ARCHIVE_UNCOMPRESSED_LIMIT_BYTES,
      10_000_000,
      1_000_000_000,
    ),
    inputLimitBytes: boundedEnvironmentInteger(
      input,
      'PDFMASON_OFFICE_INPUT_LIMIT_BYTES',
      OFFICE_INPUT_LIMIT_BYTES,
      1_000_000,
      100_000_000,
    ),
    outputLimitBytes: boundedEnvironmentInteger(
      input,
      'PDFMASON_OFFICE_OUTPUT_LIMIT_BYTES',
      OFFICE_OUTPUT_LIMIT_BYTES,
      1_000_000,
      1_000_000_000,
    ),
    timeoutMilliseconds:
      boundedEnvironmentInteger(
        input,
        'PDFMASON_OFFICE_JOB_TIMEOUT_SECONDS',
        OFFICE_TIMEOUT_MILLISECONDS / 1_000,
        10,
        600,
      ) * 1_000,
  });

const allowedExtensions = new Set(['.docx', '.pptx', '.xlsx']);
const allowedInputNames = new Set(['source.docx', 'source.pptx', 'source.xlsx']);
const blockedArchiveEntry =
  /(?:^|\/)(?:vbaProject\.bin|macros\/|externalLinks\/|embeddings\/|attachedTemplate)/iu;

export interface OfficeConversionMetrics {
  readonly engineName: 'LibreOffice';
  readonly engineVersion: typeof OFFICE_ENGINE_VERSION;
  readonly inputBytes: number;
  readonly operation: typeof OFFICE_OPERATION;
  readonly outputBytes: number;
  readonly wallMilliseconds: number;
}

export interface OfficeCommand {
  readonly args: readonly string[];
  readonly executable: string;
}

export const assertOfficeArchiveEntriesSafe = (entries: readonly string[]): void => {
  if (entries.length === 0 || entries.length > 25_000) throw new Error('OFFICE_ARCHIVE_INVALID');
  if (
    entries.some((entry) => {
      const normalized = entry.replaceAll('\\', '/');
      return (
        entry.length > 500 ||
        normalized.startsWith('/') ||
        normalized.split('/').includes('..') ||
        blockedArchiveEntry.test(normalized)
      );
    })
  ) {
    throw new Error('OFFICE_ACTIVE_CONTENT_BLOCKED');
  }
};

export const inspectOfficeArchive = (
  bytes: Uint8Array,
  expandedLimitBytes = OFFICE_ARCHIVE_UNCOMPRESSED_LIMIT_BYTES,
): readonly string[] => {
  const archive = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEocdOffset = Math.max(0, archive.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = archive.byteLength - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('OFFICE_ARCHIVE_INVALID');
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDisk = archive.readUInt16LE(eocdOffset + 6);
  const diskEntries = archive.readUInt16LE(eocdOffset + 8);
  const totalEntries = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries ||
    totalEntries === 0xffff ||
    totalEntries === 0 ||
    totalEntries > 25_000 ||
    centralOffset + centralSize > eocdOffset
  ) {
    throw new Error('OFFICE_ARCHIVE_INVALID');
  }

  const entries: string[] = [];
  let offset = centralOffset;
  let uncompressedTotal = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > archive.byteLength || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('OFFICE_ARCHIVE_INVALID');
    }
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const compressedBytes = archive.readUInt32LE(offset + 20);
    const uncompressedBytes = archive.readUInt32LE(offset + 24);
    const filenameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + filenameLength + extraLength + commentLength;
    if (
      (flags & 1) !== 0 ||
      (method !== 0 && method !== 8) ||
      compressedBytes === 0xffffffff ||
      uncompressedBytes === 0xffffffff ||
      nextOffset > archive.byteLength ||
      uncompressedBytes > Math.max(1_000_000, compressedBytes * 500)
    ) {
      throw new Error('OFFICE_ARCHIVE_INVALID');
    }
    uncompressedTotal += uncompressedBytes;
    if (uncompressedTotal > expandedLimitBytes) {
      throw new Error('OFFICE_ARCHIVE_LIMIT');
    }
    entries.push(archive.subarray(offset + 46, offset + 46 + filenameLength).toString('utf8'));
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralSize) throw new Error('OFFICE_ARCHIVE_INVALID');
  assertOfficeArchiveEntriesSafe(entries);
  return Object.freeze(entries);
};

export const resolveOfficeInput = (inputRoot: string, candidate: string): string => {
  const root = resolve(inputRoot);
  const input = resolve(candidate);
  if (
    !input.startsWith(`${root}${sep}`) ||
    !allowedExtensions.has(extname(input).toLowerCase()) ||
    !allowedInputNames.has(basename(input).toLowerCase())
  ) {
    throw new Error('OFFICE_INPUT_UNSUPPORTED');
  }
  return input;
};

export const buildOfficeCommand = (
  inputPath: string,
  outputDirectory: string,
  profileDirectory: string,
  executable = '/opt/libreoffice26.2/program/soffice',
): OfficeCommand => ({
  args: Object.freeze([
    '--headless',
    '--nologo',
    '--nodefault',
    '--nofirststartwizard',
    '--norestore',
    '--invisible',
    `-env:UserInstallation=file://${profileDirectory.replaceAll('\\', '/')}`,
    '--convert-to',
    'pdf',
    '--outdir',
    outputDirectory,
    inputPath,
  ]),
  executable,
});

const macroSecurityProfile = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
</oor:items>
`;

const run = async (
  executable: string,
  args: readonly string[],
  timeoutMilliseconds: number,
): Promise<{ readonly stdout: string }> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      env: { HOME: '/tmp', LANG: 'C.UTF-8', PATH: process.env.PATH ?? '/usr/bin:/bin' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let outputBytes = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= 1_000_000) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('OFFICE_TIMEOUT'));
    }, timeoutMilliseconds);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('OFFICE_ENGINE_UNAVAILABLE'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout });
      else reject(new Error('OFFICE_CONVERSION_FAILED'));
    });
  });

const assertNetworkDisabled = async (): Promise<void> => {
  const interfaces = await readdir('/sys/class/net');
  if (interfaces.some((name) => name !== 'lo')) throw new Error('OFFICE_NETWORK_NOT_DISABLED');
};

export const convertOfficeDocument = async (
  candidatePath: string,
  options: {
    readonly executable?: string;
    readonly inputRoot?: string;
    readonly limits?: OfficeLimits;
    readonly outputRoot?: string;
    readonly requireNetworkIsolation?: boolean;
    readonly timeoutMilliseconds?: number;
  } = {},
): Promise<OfficeConversionMetrics> => {
  if (process.env.PDFMASON_OFFICE_CONVERSION_ENABLED !== 'true') {
    throw new Error('OFFICE_KILL_SWITCH_DISABLED');
  }
  const inputRoot = options.inputRoot ?? '/job/input';
  const outputRoot = options.outputRoot ?? '/job/output';
  const limits = options.limits ?? parseOfficeLimits(process.env);
  const inputPath = resolveOfficeInput(inputRoot, candidatePath);
  if (options.requireNetworkIsolation ?? true) await assertNetworkDisabled();
  const inputStat = await lstat(inputPath);
  if (!inputStat.isFile() || inputStat.size <= 0 || inputStat.size > limits.inputLimitBytes) {
    throw new Error('OFFICE_INPUT_LIMIT');
  }
  const inputBytes = await readFile(inputPath);
  const header = inputBytes.subarray(0, 4);
  if (header[0] !== 0x50 || header[1] !== 0x4b) throw new Error('OFFICE_ARCHIVE_INVALID');
  inspectOfficeArchive(inputBytes, limits.expandedLimitBytes);

  const profileDirectory = `/tmp/pdfmason-office-${process.pid}`;
  await rm(profileDirectory, { force: true, recursive: true });
  await mkdir(join(profileDirectory, 'user'), { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    join(profileDirectory, 'user', 'registrymodifications.xcu'),
    macroSecurityProfile,
    {
      encoding: 'utf8',
      flag: 'wx',
    },
  );
  const command = buildOfficeCommand(inputPath, outputRoot, profileDirectory, options.executable);
  const startedAt = performance.now();
  try {
    await run(
      command.executable,
      command.args,
      options.timeoutMilliseconds ?? limits.timeoutMilliseconds,
    );
    const generatedPath = join(outputRoot, `${parse(basename(inputPath)).name}.pdf`);
    const outputPath = join(outputRoot, 'output.pdf');
    const generatedStat = await stat(generatedPath);
    if (
      !generatedStat.isFile() ||
      generatedStat.size <= 0 ||
      generatedStat.size > limits.outputLimitBytes
    ) {
      throw new Error('OFFICE_OUTPUT_LIMIT');
    }
    const generated = await readFile(generatedPath);
    if (new TextDecoder('ascii').decode(generated.subarray(0, 5)) !== '%PDF-') {
      throw new Error('OFFICE_OUTPUT_INVALID');
    }
    if (generatedPath !== outputPath) {
      await copyFile(generatedPath, outputPath);
      await rm(generatedPath, { force: true });
    }
    return Object.freeze({
      engineName: 'LibreOffice',
      engineVersion: OFFICE_ENGINE_VERSION,
      inputBytes: inputStat.size,
      operation: OFFICE_OPERATION,
      outputBytes: generated.byteLength,
      wallMilliseconds: Math.ceil(performance.now() - startedAt),
    });
  } finally {
    await rm(profileDirectory, { force: true, recursive: true });
  }
};
