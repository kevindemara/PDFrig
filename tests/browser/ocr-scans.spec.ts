import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createOcrScanQa, loadOcrQaCandidate } from '../../scripts/ocr-scan-qa.mjs';
const candidateLoads = new WeakMap<object, { count: number }>();

test.beforeEach(async ({ page }) => {
  const file = process.env.PDFRIG_OCR_QA_CANDIDATE;
  if (!file) return;
  const bytes = Buffer.from(await loadOcrQaCandidate(file));
  const loaded = { count: 0 };
  candidateLoads.set(page, loaded);
  // Per-test browser interception only: never copy candidate bytes into app assets.
  await page
    .context()
    .route(/\/ocr\/tesseract-core(?:-simd|-relaxedsimd)?-lstm\.wasm\.js$/u, (route) => {
      loaded.count++;
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: bytes });
    });
});
test.afterEach(({ page }) => {
  if (process.env.PDFRIG_OCR_QA_CANDIDATE)
    expect(candidateLoads.get(page)?.count ?? 0).toBeGreaterThan(0);
});

for (const language of ['eng', 'fra'] as const)
  for (const layout of ['portrait', 'landscape-crop'] as const)
    test(`OCR-001 ${language} ${layout}: coloured scans and untouched pages survive searchable export`, async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      await page.goto('/workspace');
      await expect(page.getByLabel('Open PDF')).toBeEnabled();
      const png = await page.evaluate((language) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 800;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('QA_CANVAS');
        context.fillStyle = '#f5f1e8';
        context.fillRect(0, 0, 1200, 800);
        context.fillStyle = '#142830';
        context.font = 'bold 64px Arial';
        context.fillText('OCR FIXTURE 4827', 70, 130);
        context.font = 'bold 56px Arial';
        context.fillText(language === 'fra' ? 'BONJOUR 2026' : 'QUARTERLY REPORT', 70, 260);
        context.font = '48px Arial';
        context.fillText(language === 'fra' ? 'ÉCOLE ÉTÉ' : 'LEFT TOTAL 120', 70, 400);
        context.fillText(language === 'fra' ? 'TOTAL 240' : 'RIGHT 240', 650, 400);
        context.fillStyle = '#bd5a35';
        context.fillRect(70, 500, 480, 100);
        context.fillStyle = '#217d87';
        context.fillRect(650, 500, 440, 100);
        // Bounded deterministic paper specks outside text; no random/retry-dependent fixture.
        context.fillStyle = '#c9c6be';
        for (let i = 0; i < 100; i++)
          context.fillRect((i * 97) % 1200, 660 + ((i * 17) % 120), 2, 2);
        return canvas.toDataURL('image/png').split(',')[1] ?? '';
      }, language);
      const source = Buffer.from(await createOcrScanQa(Buffer.from(png, 'base64'), layout));
      const before = info.outputPath('synthetic-source.pdf');
      await writeFile(before, source);
      const errors: string[] = [];
      const outbound: string[] = [];
      page.on('pageerror', (error) => errors.push(error.name));
      page.on('request', (request) => {
        if (
          request.method() === 'POST' ||
          !/^(?:http:\/\/127\.0\.0\.1:3100\/|blob:|data:)/u.test(request.url())
        )
          outbound.push('unexpected');
      });
      await page
        .getByLabel('Open PDF')
        .setInputFiles({ name: 'synthetic-scan.pdf', mimeType: 'application/pdf', buffer: source });
      await page.getByRole('button', { name: 'Text', exact: true }).click();
      await page.getByRole('button', { name: 'OCR this page', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'OCR · search and copy' });
      await dialog.getByLabel('OCR language').selectOption(language);
      await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
      await expect(dialog.getByRole('status')).toContainText('Scan appearance is unchanged', {
        timeout: 60_000,
      });
      await expect(
        dialog.getByRole('textbox', { name: 'Recognized text', exact: true }),
      ).toHaveValue(/OCR FIXTURE 4827/);
      if (language === 'fra')
        await expect(
          dialog.getByRole('textbox', { name: 'Recognized text', exact: true }),
        ).toHaveValue(/BONJOUR/);
      await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Apply reviewed copy' }).click();
      await page.getByRole('button', { name: 'Review export' }).click();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export completed copy' }).click();
      const output = info.outputPath('searchable-copy.pdf');
      await (await download).saveAs(output);
      execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], {
        stdio: 'pipe',
      });
      const text = execFileSync('pdftotext', [output, '-'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(text).toContain('OCR FIXTURE 4827');
      if (language === 'fra') {
        expect(text).toContain('BONJOUR');
        expect(text).toMatch(/ÉCOLE|ÉTÉ/u);
      }
      for (const dpi of [96, 144])
        for (const crop of [false, true]) {
          const prefixes = [
            info.outputPath(`before-${dpi}-${crop ? 'crop' : 'media'}`),
            info.outputPath(`after-${dpi}-${crop ? 'crop' : 'media'}`),
          ];
          for (const [index, file] of [before, output].entries())
            execFileSync(
              'pdftoppm',
              [
                ...(crop ? ['-cropbox'] : []),
                '-png',
                '-r',
                String(dpi),
                file,
                prefixes[index] ?? '',
              ],
              { stdio: 'pipe' },
            );
          for (const pageNumber of layout === 'portrait' ? [1] : [1, 2]) {
            const images = await Promise.all(
              prefixes.map((prefix) => readFile(`${prefix}-${pageNumber}.png`)),
            );
            expect(images[0]?.equals(images[1] ?? Buffer.alloc(0))).toBe(true);
          }
        }
      expect((await readFile(before)).equals(source)).toBe(true);
      expect(errors).toEqual([]);
      expect(outbound).toEqual([]);
    });

test('OCR-001 same-size corrupted model is rejected before native model initialization', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & { ocrQaActions: string[] };
    state.ocrQaActions = [];
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes('/ocr/worker.min.js')) {
          const send = this.postMessage.bind(this);
          this.postMessage = (message: unknown) => {
            if (
              typeof message === 'object' &&
              message !== null &&
              'action' in message &&
              typeof message.action === 'string'
            )
              state.ocrQaActions.push(message.action);
            send(message);
          };
        }
      }
    };
  });
  await page.route('**/ocr/eng.traineddata', async (route) => {
    const response = await route.fetch();
    const bytes = Buffer.from(await response.body());
    bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;
    await route.fulfill({ response, body: bytes });
  });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles('packages/test-corpus/fixtures/scanned-ocr.pdf');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'OCR this page', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'OCR · search and copy' });
  await dialog.getByRole('button', { name: 'Build actual PDF preview' }).click();
  await expect(dialog.getByRole('status')).toContainText('language model failed integrity checks', {
    timeout: 60_000,
  });
  await expect(dialog.getByRole('button', { name: 'Apply reviewed copy' })).toBeDisabled();
  expect(
    await page.evaluate(
      () => (globalThis as typeof globalThis & { ocrQaActions: string[] }).ocrQaActions,
    ),
  ).toEqual(['load']);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
