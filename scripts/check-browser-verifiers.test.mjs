import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBrowserVerifiers } from './check-browser-verifiers.mjs';
import { browserTestServer } from './browser-test-server.mjs';

const ready = (executable) => ({
  status: 0,
  stdout: executable.includes('python') ? 'PDFMASON_PYPDF_READY\n' : '',
  stderr: executable.includes('qpdf') ? 'qpdf version 12.4.0\n' : `${executable} version 26.07.0\n`,
});

test('launch-core browser QA checks all verifiers before building or starting a server', () => {
  assert.match(
    browserTestServer().command,
    /^node scripts\/check-browser-verifiers\.mjs && pnpm build:packages &&/u,
  );
  const calls = [];
  assert.deepEqual(
    checkBrowserVerifiers(
      { PDFMASON_QPDF_PATH: 'qpdf-custom', PDFMASON_PYTHON_PATH: 'python-custom' },
      'win32',
      (executable, args, options) => {
        calls.push({ executable, args, options });
        return ready(executable);
      },
    ),
    [],
  );
  assert.deepEqual(
    calls.map(({ executable }) => executable),
    ['qpdf-custom', 'python-custom', 'pdftotext', 'pdftoppm'],
  );
  assert.equal(calls[1].args[0], '-c');
  assert.ok(
    calls.every(
      ({ options }) =>
        options.timeout === 5000 &&
        options.maxBuffer === 4096 &&
        options.windowsHide === true &&
        options.shell === undefined,
    ),
  );
});

test('missing tools, invalid capabilities, nonzero exits and thrown errors become only safe codes', () => {
  const failures = checkBrowserVerifiers({}, 'linux', (executable) => {
    if (executable === 'qpdf') return { status: null, error: new Error('restricted-path-canary') };
    if (executable === 'python') throw new Error('restricted-python-canary');
    if (executable === 'pdftotext')
      return { status: 0, stdout: 'restricted-invalid-capability-canary' };
    return { status: 1, stderr: 'restricted-stderr-canary' };
  });
  assert.deepEqual(failures, [
    'QA_QPDF_UNAVAILABLE',
    'QA_PYPDF_UNAVAILABLE',
    'QA_PDFTOTEXT_UNAVAILABLE',
    'QA_PDFTOPPM_UNAVAILABLE',
  ]);
  assert.ok(Object.isFrozen(failures));
  assert.doesNotMatch(JSON.stringify(failures), /restricted|canary/u);
});

test('Windows default Python uses the launcher while explicit Python paths do not', () => {
  const calls = [];
  checkBrowserVerifiers({}, 'win32', (executable, args) => {
    calls.push({ executable, args });
    return { status: 1 };
  });
  assert.equal(calls[1].executable, 'py');
  assert.deepEqual(calls[1].args.slice(0, 2), ['-3', '-c']);
});
