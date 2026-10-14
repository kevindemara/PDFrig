import { convertOfficeDocument } from './office-conversion.js';

const input = process.argv[2];
if (input === undefined) {
  process.stderr.write('{"error":{"code":"OFFICE_INPUT_REQUIRED"}}\n');
  process.exitCode = 2;
} else {
  try {
    const metrics = await convertOfficeDocument(input);
    process.stdout.write(
      `${JSON.stringify({ metrics, output: '/job/output/output.pdf', status: 'completed' })}\n`,
    );
  } catch (error: unknown) {
    const code =
      error instanceof Error && /^OFFICE_[A-Z_]+$/u.test(error.message)
        ? error.message
        : 'OFFICE_CONVERSION_FAILED';
    process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
    process.exitCode = 1;
  }
}
