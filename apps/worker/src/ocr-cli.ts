import { createSearchablePdf } from './ocr.js';

if (process.env.PDFMASON_OCR_ENABLED !== 'true') {
  process.stderr.write('{"error":{"code":"OCR_DISABLED"}}\n');
  process.exitCode = 2;
} else {
  try {
    const metrics = await createSearchablePdf();
    process.stdout.write(
      `${JSON.stringify({ metrics, output: '/job/output/output.pdf', status: 'completed' })}\n`,
    );
  } catch (error: unknown) {
    const code =
      error instanceof Error && /^OCR_[A-Z_]+$/u.test(error.message)
        ? error.message
        : 'OCR_PROCESSING_FAILED';
    process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
    process.exitCode = 1;
  }
}
