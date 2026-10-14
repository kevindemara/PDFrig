import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Launch-core QA only: never install, replace tools or expose native error/path data.
export const checkBrowserVerifiers = (
  env = process.env,
  platform = process.platform,
  run = spawnSync,
) => {
  const python = env.PDFMASON_PYTHON_PATH ?? (platform === 'win32' ? 'py' : 'python');
  const pythonPrefix = platform === 'win32' && env.PDFMASON_PYTHON_PATH === undefined ? ['-3'] : [];
  const checks = [
    {
      code: 'QA_QPDF_UNAVAILABLE',
      executable:
        env.PDFMASON_QPDF_PATH ??
        (platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf'),
      args: ['--version'],
      expected: /^qpdf version /mu,
    },
    {
      code: 'QA_PYPDF_UNAVAILABLE',
      executable: python,
      args: [
        ...pythonPrefix,
        '-c',
        'from pypdf import PdfReader; from pypdf.generic import ContentStream; print("PDFMASON_PYPDF_READY")',
      ],
      expected: /^PDFMASON_PYPDF_READY$/mu,
    },
    ...['pdftotext', 'pdftoppm'].map((name) => ({
      code: `QA_${name.toUpperCase()}_UNAVAILABLE`,
      executable: name,
      args: ['-v'],
      expected: new RegExp(`^${name} version `, 'mu'),
    })),
  ];
  return Object.freeze(
    checks
      .filter((check) => {
        try {
          const result = run(check.executable, check.args, {
            encoding: 'utf8',
            maxBuffer: 4096,
            timeout: 5000,
            windowsHide: true,
          });
          return (
            result.error !== undefined ||
            result.status !== 0 ||
            !check.expected.test(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
          );
        } catch {
          return true;
        }
      })
      .map((check) => check.code),
  );
};

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const failures = checkBrowserVerifiers();
  if (failures.length > 0) {
    console.error(`Browser PDF verification prerequisites failed: ${failures.join(', ')}.`);
    console.error(
      'Configure PDFMASON_QPDF_PATH, PDFMASON_PYTHON_PATH and Poppler on PATH. See README.md#development-and-verification. No tools were installed or changed.',
    );
    process.exitCode = 1;
  } else {
    console.log('Browser PDF verification prerequisites passed.');
  }
}
