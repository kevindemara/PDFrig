import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
const fixtureRoot = join(workspace, 'apps', 'worker', 'test-fixtures');
const image = 'pdfmason-office-worker:test';
const qpdf =
  process.env.PDFMASON_QPDF_PATH ??
  (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: workspace,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

run('docker', ['build', '--file', 'apps/worker/Dockerfile.office', '--tag', image, '.']);

const user = run('docker', ['image', 'inspect', image, '--format', '{{.Config.User}}'], {
  capture: true,
}).trim();
if (user !== 'node') throw new Error(`Office image must run as node, received ${user || 'root'}.`);

const temporaryRoot = await mkdtemp(join(tmpdir(), 'pdfmason-office-test-'));

const dockerArguments = (inputDirectory, outputDirectory, extension) => [
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
  `/job/input/source${extension}`,
];

try {
  for (const fixture of [
    'synthetic-letter.docx',
    'synthetic-table.xlsx',
    'synthetic-slides.pptx',
  ]) {
    const caseRoot = join(temporaryRoot, fixture);
    const inputDirectory = join(caseRoot, 'input');
    const outputDirectory = join(caseRoot, 'output');
    await mkdir(inputDirectory, { recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    await chmod(outputDirectory, 0o777);
    const extension = fixture.slice(fixture.lastIndexOf('.'));
    await cp(join(fixtureRoot, fixture), join(inputDirectory, `source${extension}`));
    run('docker', dockerArguments(inputDirectory, outputDirectory, extension));
    const output = join(outputDirectory, 'output.pdf');
    const outputBytes = await readFile(output);
    if (new TextDecoder('ascii').decode(outputBytes.subarray(0, 5)) !== '%PDF-') {
      throw new Error(`${fixture} did not produce a PDF.`);
    }
    if ((await stat(output)).size === 0) throw new Error(`${fixture} produced an empty PDF.`);
    run(qpdf, ['--check', output]);
    run('pdftoppm', [
      '-f',
      '1',
      '-singlefile',
      '-png',
      '-r',
      '72',
      output,
      join(outputDirectory, 'render'),
    ]);
    if ((await stat(join(outputDirectory, 'render.png'))).size === 0) {
      throw new Error(`${fixture} did not render independently.`);
    }
    process.stdout.write(`verified ${basename(fixture)}\n`);
  }

  const macroRoot = join(temporaryRoot, 'macro-negative');
  const macroInput = join(macroRoot, 'input');
  const macroOutput = join(macroRoot, 'output');
  await mkdir(macroInput, { recursive: true });
  await mkdir(macroOutput, { recursive: true });
  await chmod(macroOutput, 0o777);
  await cp(join(fixtureRoot, 'source-with-macro-marker.docx'), join(macroInput, 'source.docx'));
  const blocked = spawnSync('docker', dockerArguments(macroInput, macroOutput, '.docx'), {
    cwd: workspace,
    encoding: 'utf8',
  });
  if (blocked.status === 0 || !blocked.stderr.includes('OFFICE_ACTIVE_CONTENT_BLOCKED')) {
    throw new Error('Macro-bearing OOXML fixture was not blocked before conversion.');
  }
  process.stdout.write('verified macro marker blocked before engine start\n');
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
