import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
const fixture = join(workspace, 'packages', 'test-corpus', 'fixtures', 'scanned-ocr.pdf');
const image = 'pdfmason-ocr-worker:test';
const qpdf =
  process.env.PDFMASON_QPDF_PATH ??
  (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: workspace,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

run('docker', ['build', '--file', 'apps/worker/Dockerfile.ocr', '--tag', image, '.']);
const user = run('docker', ['image', 'inspect', image, '--format', '{{.Config.User}}'], {
  capture: true,
}).trim();
if (user !== 'node') throw new Error(`OCR image must run as node, received ${user || 'root'}.`);

const temporaryRoot = await mkdtemp(join(tmpdir(), 'pdfmason-ocr-test-'));
const inputDirectory = join(temporaryRoot, 'input');
const outputDirectory = join(temporaryRoot, 'output');
await mkdir(inputDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });
await chmod(outputDirectory, 0o777);
await cp(fixture, join(inputDirectory, 'source.pdf'));

const dockerArguments = [
  'run',
  '--rm',
  '--network',
  'none',
  '--read-only',
  '--cap-drop',
  'ALL',
  '--cpus',
  '1',
  '--memory',
  '768m',
  '--pids-limit',
  '64',
  '--security-opt',
  'no-new-privileges:true',
  '--tmpfs',
  '/tmp:rw,noexec,nosuid,size=256m',
  '--ulimit',
  'nofile=1024:2048',
  '--volume',
  `${inputDirectory}:/job/input:ro`,
  '--volume',
  `${outputDirectory}:/job/output:rw`,
  image,
];

try {
  const completed = spawnSync('docker', dockerArguments, { cwd: workspace, encoding: 'utf8' });
  if (completed.status !== 0) throw new Error(`OCR worker failed: ${completed.stderr}`);
  const result = JSON.parse(completed.stdout.trim());
  if (
    result.status !== 'completed' ||
    result.metrics?.engineName !== 'tesseract' ||
    result.metrics?.pageCount !== 1 ||
    !/^5\.5\.3$/u.test(result.metrics?.engineVersion ?? '')
  )
    throw new Error('OCR worker emitted invalid content-free metrics.');
  const serializedResult = JSON.stringify(result);
  if (/OCR FIXTURE|4827/iu.test(serializedResult))
    throw new Error('OCR worker leaked recognized content through metrics.');

  const output = join(outputDirectory, 'output.pdf');
  if ((await stat(output)).size === 0) throw new Error('OCR worker produced an empty output.');
  run(qpdf, ['--check', output]);
  const recognized = run('pdftotext', [output, '-'], { capture: true });
  const sourceText = run('pdftotext', [fixture, '-'], { capture: true });
  if (sourceText.trim().length !== 0 || recognized.trim().length < 4)
    throw new Error('The independent text reader did not recover a text layer from the scan.');
  if (!recognized.replace(/\s+/gu, ' ').trim().includes('OCR FIXTURE 4827'))
    throw new Error('OCR_FIXTURE_RECOGNITION_MISMATCH');

  const sourceRender = join(temporaryRoot, 'source-render');
  const outputRender = join(temporaryRoot, 'output-render');
  run('pdftoppm', ['-f', '1', '-singlefile', '-png', '-r', '72', fixture, sourceRender]);
  run('pdftoppm', ['-f', '1', '-singlefile', '-png', '-r', '72', output, outputRender]);
  const [sourcePixels, outputPixels] = await Promise.all([
    readFile(`${sourceRender}.png`),
    readFile(`${outputRender}.png`),
  ]);
  if (!sourcePixels.equals(outputPixels))
    throw new Error('OCR changed the visible page instead of adding only an invisible text layer.');

  const disabled = spawnSync(
    'docker',
    [...dockerArguments.slice(0, -1), '--env', 'PDFMASON_OCR_ENABLED=false', image],
    { cwd: workspace, encoding: 'utf8' },
  );
  if (disabled.status === 0 || !disabled.stderr.includes('OCR_DISABLED'))
    throw new Error('OCR kill switch did not fail closed.');
  process.stdout.write(
    'OCR-001 verified with content-free metrics and unchanged visible rendering.\n',
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
