import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const readStoredZipEntries = (bytes: Uint8Array): ReadonlyMap<string, Uint8Array> => {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (method !== 0) throw new Error('Expected deterministic stored ZIP entries.');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength) throw new Error('ZIP entry exceeds the archive boundary.');
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.set(name, bytes.slice(dataStart, dataEnd));
    offset = dataEnd;
  }
  return entries;
};

const inspectBrowserImage = async (
  page: Page,
  bytes: Uint8Array,
  mimeType: 'image/jpeg' | 'image/png',
): Promise<{ height: number; maximumAlpha: number; minimumAlpha: number; width: number }> =>
  page.evaluate(
    async ({ base64, type }) => {
      const binary = atob(base64);
      const imageBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([imageBytes], { type }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Image inspection canvas is unavailable.');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let minimumAlpha = 255;
      let maximumAlpha = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        const alpha = pixels[index] ?? 0;
        minimumAlpha = Math.min(minimumAlpha, alpha);
        maximumAlpha = Math.max(maximumAlpha, alpha);
      }
      return { height: canvas.height, maximumAlpha, minimumAlpha, width: canvas.width };
    },
    { base64: Buffer.from(bytes).toString('base64'), type: mimeType },
  );

test('marketing entry and workspace shell are truthful and reachable', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await expect(page).toHaveTitle('PDFrig — Build better PDFs.');
  await expect(page.getByRole('heading', { level: 1, name: 'Build better PDFs.' })).toBeVisible();
  await expect(page.getByText(/view, organize, annotate, fill/i)).toBeVisible();

  await page.getByRole('link', { name: 'Edit a PDF locally' }).click();
  await expect(page).toHaveURL(/\/workspace$/u);
  await expect(page.getByRole('navigation', { name: 'Editor tools' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Drop in a PDF.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose a PDF' })).toBeEnabled();
  await expect(page.getByText('On this device', { exact: true })).toBeVisible();
});

test('account control room exercises job progress, retention preference, and deletion UI', async ({
  page,
}) => {
  await page.goto('/account');
  await expect(
    page.getByRole('heading', { name: 'Processing you can account for.' }),
  ).toBeVisible();
  await expect(page.getByText('Local demo', { exact: true })).toBeVisible();
  await expect(page.getByText('Normal output deletion')).toBeVisible();

  const queuedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/jobs/demo') && response.request().method() === 'POST',
  );
  const refreshedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/account') && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Run safe cloud check' }).click();
  expect((await queuedResponse).status()).toBe(201);
  expect((await refreshedResponse).status()).toBe(200);
  const job = page.getByRole('listitem').filter({ hasText: 'Cloud integrity check' }).first();
  await expect(job.getByText('Cloud integrity check')).toBeVisible();
  await expect(job.getByText('complete', { exact: true })).toBeVisible({ timeout: 10_000 });

  const history = page.getByRole('checkbox', { name: /Keep job metadata/i });
  const historyWasEnabled = await history.isChecked();
  await history.click();
  await expect(history).toBeChecked({ checked: !historyWasEnabled });
  await expect(
    page.getByText(historyWasEnabled ? 'Metadata history disabled.' : 'Metadata history enabled.'),
  ).toBeVisible();

  const deletionResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/jobs\/[^/]+\/delete$/.test(response.url()) &&
      response.request().method() === 'POST',
  );
  await job.getByRole('button', { name: 'Delete now' }).click();
  expect((await deletionResponse).status()).toBe(200);
  await expect(page.getByText('Deletion queued.')).toBeVisible();

  const deletion = page.getByLabel('Type DELETE to request permanent account deletion');
  await deletion.fill('DELETE');
  await page.getByRole('button', { name: 'Request account deletion' }).click();
  await expect(page.getByText(/object reconciliation is queued/i)).toBeVisible();
});

test('account mutations wait for hydration when application scripts are delayed', async ({
  page,
}) => {
  let releaseScripts: () => void = () => undefined;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await scriptsReady;
    await route.continue();
  });
  try {
    await page.goto('/account', { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: 'Run safe cloud check' });
    await expect(button).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: /Keep job metadata/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Choose Pro monthly' })).toBeDisabled();
    await expect(
      page.getByLabel('Type DELETE to request permanent account deletion'),
    ).toBeDisabled();
    releaseScripts();
    await expect(button).toBeEnabled();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/jobs/demo') && response.request().method() === 'POST',
    );
    await button.click();
    expect((await responsePromise).status()).toBe(201);
    await expect(page.getByRole('status')).toContainText('Cloud check queued.');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Cloud integrity check' }).first(),
    ).toBeVisible();
  } finally {
    releaseScripts();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('CREATE-002 utility selection waits for hydration when application scripts are delayed', async ({
  page,
}) => {
  let releaseScripts: () => void = () => undefined;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await scriptsReady;
    await route.continue();
  });
  try {
    await page.goto('/tools', { waitUntil: 'domcontentloaded' });
    const selectors = page.getByRole('navigation', { name: 'PDF utility tools' });
    const images = page.getByRole('button', { name: /Images to PDF/u });
    await expect(images).toBeDisabled();
    await expect(page.locator('input[type="file"]')).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Balanced' })).toBeDisabled();
    releaseScripts();
    await expect(images).toBeEnabled();
    await images.click();
    await expect(page.getByRole('heading', { name: 'Images to PDF' })).toBeVisible();
    await expect(page.locator('input[type="file"]')).toBeEnabled();
    await expect(selectors.getByRole('button', { name: /Images to PDF/u })).toHaveAttribute(
      'aria-current',
      'page',
    );
  } finally {
    releaseScripts();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('shared utility bench processes and protects a synthetic PDF entirely locally', async ({
  page,
}) => {
  await page.goto('/tools');
  await expect(
    page.getByRole('heading', { name: 'Finish a PDF job without surrendering the file.' }),
  ).toBeVisible();
  await expect(page.getByText(/files and passwords stay in memory/i)).toBeVisible();

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const compressedDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const compressedDownload = await compressedDownloadPromise;
  expect(compressedDownload.suggestedFilename()).toBe('pdfmason-optimized.pdf');
  const compressedPath = await compressedDownload.path();
  expect((await readFile(compressedPath)).subarray(0, 5).toString('ascii')).toBe('%PDF-');

  await page.getByRole('button', { name: /Protect \/ unlock/u }).click();
  await expect(page.getByRole('heading', { name: 'Protect / unlock' })).toBeVisible();
  await input.setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  const password = page.getByLabel('New open password');
  await password.fill('synthetic-browser-password');
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  await expect(password).toHaveValue('');
  const protectedDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  expect((await protectedDownloadPromise).suggestedFilename()).toBe('pdfmason-protected.pdf');

  await page.getByRole('button', { name: /PDF to images/u }).click();
  await expect(page.getByRole('heading', { name: 'PDF to images' })).toBeVisible();
  await input.setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const imagesDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const imagesDownload = await imagesDownloadPromise;
  expect(imagesDownload.suggestedFilename()).toBe('pdfmason-pages.zip');
  expect((await readFile(await imagesDownload.path())).subarray(0, 4).toString('hex')).toBe(
    '504b0304',
  );
});

test('CONV-001 exports deterministic selected PNG and JPEG page images locally', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/tools');
  await page.getByRole('button', { name: /PDF to images/u }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const source = path.resolve('packages/test-corpus/fixtures/multipage-three.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').setInputFiles(source);

  await page.getByLabel('PDF page range').fill('1, 1');
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('without duplicates');
  await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);

  await page.getByLabel('PDF page range').fill('1, 3');
  await page.getByLabel('Resolution').selectOption('1');
  await page.getByLabel(/Keep unpainted page areas transparent/u).check();
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  await expect(page.getByText(/2 PNG page images · 1×/u)).toBeVisible();
  const pngDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const pngDownload = await pngDownloadPromise;
  const pngZipBytes = new Uint8Array(await readFile(await pngDownload.path()));
  const pngEntries = readStoredZipEntries(pngZipBytes);
  expect([...pngEntries.keys()]).toEqual(['page-001.png', 'page-003.png']);
  const firstPng = pngEntries.get('page-001.png');
  const thirdPng = pngEntries.get('page-003.png');
  if (firstPng === undefined || thirdPng === undefined) throw new Error('PNG pages are missing.');
  expect(await inspectBrowserImage(page, firstPng, 'image/png')).toEqual({
    height: 792,
    maximumAlpha: 255,
    minimumAlpha: 0,
    width: 612,
  });
  expect(await inspectBrowserImage(page, thirdPng, 'image/png')).toEqual({
    height: 792,
    maximumAlpha: 255,
    minimumAlpha: 0,
    width: 612,
  });

  await page.getByLabel('Image format').selectOption('jpeg');
  await expect(page.getByLabel(/Keep unpainted page areas transparent/u)).toBeDisabled();
  await page.getByLabel('PDF page range').fill('2');
  await page.getByLabel('Resolution').selectOption('2');
  await page.getByLabel('JPEG quality').selectOption('0.72');
  await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const lowDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const lowEntries = readStoredZipEntries(
    new Uint8Array(await readFile(await (await lowDownloadPromise).path())),
  );
  expect([...lowEntries.keys()]).toEqual(['page-002.jpg']);
  const lowJpeg = lowEntries.get('page-002.jpg');
  if (lowJpeg === undefined) throw new Error('JPEG page is missing.');
  expect(await inspectBrowserImage(page, lowJpeg, 'image/jpeg')).toEqual({
    height: 1584,
    maximumAlpha: 255,
    minimumAlpha: 255,
    width: 1224,
  });

  await page.getByLabel('JPEG quality').selectOption('0.92');
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const highDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const highEntries = readStoredZipEntries(
    new Uint8Array(await readFile(await (await highDownloadPromise).path())),
  );
  const highJpeg = highEntries.get('page-002.jpg');
  if (highJpeg === undefined) throw new Error('High-quality JPEG page is missing.');
  expect(highJpeg).not.toEqual(lowJpeg);
  expect(highJpeg.byteLength).toBeGreaterThan(lowJpeg.byteLength);

  await mkdir(path.resolve('tmp/conv-001'), { recursive: true });
  await writeFile(path.resolve('tmp/conv-001/page-001-transparent.png'), firstPng);
  await writeFile(path.resolve('tmp/conv-001/page-002-high.jpg'), highJpeg);
  expect(await readFile(source)).toEqual(sourceBefore);

  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/large-dimensions.pdf'));
  await page.getByLabel('PDF page range').fill('all');
  await page.getByLabel('Resolution').selectOption('3');
  await page.getByLabel('Image format').selectOption('png');
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('20-megapixel local limit');
  await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
});

test('CREATE-001 creates a measured blank PDF locally without a source file', async ({
  page,
}, testInfo) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Create blank PDF/u }).click();
  await expect(page.getByRole('heading', { name: 'Create blank PDF' })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByLabel('Page size').selectOption('a4');
  await page.getByLabel('Orientation').selectOption('landscape');
  await page.getByRole('combobox', { name: /Content-safe margin/u }).selectOption('72');
  await expect(page.getByLabel('Blank page preview')).toContainText('841.89 × 595.28 pt');
  await expect(page.getByText(/ordinary readers may not display that guide/i)).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('.utility-bench')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([]);

  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('pdfmason-blank-a4-landscape.pdf');
  const output = testInfo.outputPath('blank-a4-landscape.pdf');
  await download.saveAs(output);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const pythonPrefix =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  execFileSync(
    python,
    [
      ...pythonPrefix,
      '-c',
      'import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1], strict=True); assert len(r.pages)==1; p=r.pages[0]; close=lambda a,b: all(abs(float(x)-y)<0.02 for x,y in zip(a,b)); assert close(p.mediabox,(0,0,841.89,595.28)); assert close(p.cropbox,(0,0,841.89,595.28)); assert close(p.artbox,(72,72,769.89,523.28)); assert p.get_contents() is None; assert (p.extract_text() or "")==""; assert "/Annots" not in p',
      output,
    ],
    { stdio: 'pipe' },
  );

  await page.getByRole('combobox', { name: /Content-safe margin/u }).selectOption('36');
  await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Settings changed');
  await expect(page.getByRole('button', { name: 'Create export' })).toBeEnabled();
});

test('ORG-008 and CREATE-002 normalize WebP and EXIF orientation in the local worker', async ({
  page,
}, testInfo) => {
  const orientedJpeg = path.resolve(
    'packages/test-corpus/fixtures/images/quadrants-orientation-6.jpg',
  );
  const orientedPng = path.resolve(
    'packages/test-corpus/fixtures/images/quadrants-orientation-6.png',
  );
  const webp = path.resolve('packages/test-corpus/fixtures/images/split-colours.webp');
  const animatedWebp = path.resolve('packages/test-corpus/fixtures/images/animated-two-frame.webp');
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const pythonPrefix =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];

  await page.goto('/tools');
  await page.getByRole('button', { name: /Images to PDF/u }).click();
  await expect(page.getByRole('heading', { name: 'Images to PDF' })).toBeVisible();
  await expect(
    page.getByText(/WebP and EXIF-oriented images are normalized to PNG/i),
  ).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([orientedJpeg, orientedPng, webp]);
  await expect(page.getByRole('status')).toContainText('3 images ready');
  await page.getByLabel('Page size').selectOption('image');
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const utilityDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const utilityOutput = testInfo.outputPath('normalized-images.pdf');
  await (await utilityDownloadPromise).saveAs(utilityOutput);
  execFileSync(qpdf, ['--check', utilityOutput], { stdio: 'pipe' });
  execFileSync(
    python,
    [
      ...pythonPrefix,
      '-c',
      'import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1], strict=True); assert len(r.pages)==3; sizes=[(float(p.mediabox.width),float(p.mediabox.height)) for p in r.pages]; assert sizes==[(20.0,40.0),(20.0,40.0),(30.0,18.0)]; assert all(not p.get("/Annots") for p in r.pages)',
      utilityOutput,
    ],
    { stdio: 'pipe' },
  );
  const render = execFileSync('pdftoppm', ['-singlefile', '-f', '1', '-r', '72', utilityOutput], {
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(render.subarray(0, 80).toString('ascii'));
  expect(header).not.toBeNull();
  expect(header?.slice(1, 3)).toEqual(['20', '40']);
  const pixelOffset = Buffer.byteLength(header?.[0] ?? '', 'ascii');
  const pixel = (x: number, y: number): readonly [number, number, number] => {
    const offset = pixelOffset + (y * 20 + x) * 3;
    return [render[offset] ?? 0, render[offset + 1] ?? 0, render[offset + 2] ?? 0];
  };
  const [blue, red, yellow, green] = [pixel(5, 10), pixel(15, 10), pixel(5, 30), pixel(15, 30)];
  expect(blue[2]).toBeGreaterThan(blue[0] + 80);
  expect(red[0]).toBeGreaterThan(red[1] + 80);
  expect(yellow[0]).toBeGreaterThan(160);
  expect(yellow[1]).toBeGreaterThan(140);
  expect(green[1]).toBeGreaterThan(green[0] + 60);

  await page.locator('input[type="file"]').setInputFiles(animatedWebp);
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Animated WebP is not supported');
  await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);

  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await expect(page.locator('.status-bar')).toContainText('1 page');
  await page.getByLabel('Insert image').setInputFiles(webp);
  await expect(page.locator('.status-bar')).toContainText('2 pages');
  await page.getByRole('button', { name: 'Review export' }).click();
  const editorDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const editorOutput = testInfo.outputPath('webp-inserted.pdf');
  await (await editorDownloadPromise).saveAs(editorOutput);
  execFileSync(qpdf, ['--check', editorOutput], { stdio: 'pipe' });
  execFileSync(
    python,
    [
      ...pythonPrefix,
      '-c',
      'import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1], strict=True); assert len(r.pages)==2; p=r.pages[1]; assert abs(float(p.mediabox.width)-30)<0.01; assert abs(float(p.mediabox.height)-18)<0.01',
      editorOutput,
    ],
    { stdio: 'pipe' },
  );
});

for (const mode of ['kept-original', 'rewritten'] as const) {
  test(`OPT-001 preset regeneration preserves ${mode} content and immutable input`, async ({
    page,
  }, testInfo) => {
    const fixture = path.resolve(
      `packages/test-corpus/fixtures/${mode === 'kept-original' ? 'smoke-one-page.pdf' : 'multipage-three.pdf'}`,
    );
    const fixtureBytes = await readFile(fixture);
    const qpdf =
      process.env.PDFMASON_QPDF_PATH ??
      (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
    // Expand a fixed synthetic fixture only in ignored test output to exercise a real rewrite.
    const source = mode === 'kept-original' ? fixture : testInfo.outputPath('expanded-source.pdf');
    if (mode === 'rewritten') {
      await mkdir(path.dirname(source), { recursive: true });
      execFileSync(
        qpdf,
        ['--object-streams=disable', '--stream-data=uncompress', fixture, source],
        { stdio: 'pipe' },
      );
    }
    const original = await readFile(source);
    const pageCount = mode === 'kept-original' ? 1 : 3;
    const sourceText = execFileSync('pdftotext', [source, '-'], { encoding: 'utf8' });
    const renderPage = (file: string, pageNumber: number) =>
      execFileSync('pdftoppm', ['-singlefile', '-f', String(pageNumber), '-r', '72', file], {
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const sourceRenders = Array.from({ length: pageCount }, (_, index) =>
      renderPage(source, index + 1),
    );
    await page.goto('/tools');
    await page.locator('input[type="file"]').setInputFiles(source);
    await page.getByRole('button', { name: 'Create export' }).click();
    await expect(page.getByRole('button', { name: 'Download new copy' })).toBeVisible();
    let smallerOutputs = 0;
    for (const [preset, label] of [
      ['highest-quality', 'Highest quality'],
      ['smaller', 'Smaller'],
      ['balanced', 'Balanced'],
    ] as const) {
      const radio = page.getByRole('radio', { name: label });
      await radio.focus();
      await page.keyboard.press('Space');
      await expect(radio).toBeChecked();
      await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
      await expect(page.getByRole('status')).toContainText('Settings changed');
      await expect(page.getByText(/Lossless only: no image resampling/u)).toBeVisible();
      await page.getByRole('button', { name: 'Create export' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('status')).toContainText('Export ready');
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download new copy' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('pdfmason-optimized.pdf');
      const output = testInfo.outputPath(`regenerated-${preset}.pdf`);
      await download.saveAs(output);
      const bytes = await readFile(output);
      expect(bytes.byteLength).toBeLessThanOrEqual(original.byteLength);
      if (bytes.byteLength === original.byteLength) {
        expect(bytes).toEqual(original);
        await expect(page.getByText(/Already structurally optimized/u)).toBeVisible();
      } else {
        smallerOutputs++;
        const reduction =
          Math.round(((original.byteLength - bytes.byteLength) / original.byteLength) * 1000) / 10;
        await expect(
          page.getByText(new RegExp(`${String(reduction).replace('.', '\\.')}% smaller`, 'u')),
        ).toBeVisible();
      }
      execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
      expect(execFileSync('pdftotext', [output, '-'], { encoding: 'utf8' })).toBe(sourceText);
      const python =
        process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
      const pythonPrefix =
        process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32'
          ? ['-3']
          : [];
      execFileSync(
        python,
        [
          ...pythonPrefix,
          '-c',
          'import sys; from pypdf import PdfReader; a,b=map(PdfReader,sys.argv[1:]); assert len(a.pages)==len(b.pages); assert a.metadata==b.metadata; assert [(list(p.mediabox),list(p.cropbox),p.rotation) for p in a.pages]==[(list(p.mediabox),list(p.cropbox),p.rotation) for p in b.pages]',
          source,
          output,
        ],
        { stdio: 'pipe' },
      );
      for (let index = 0; index < pageCount; index++) {
        // Equality proves every output pixel matches this fixed source at the controlled DPI.
        expect(renderPage(output, index + 1).equals(sourceRenders[index] ?? Buffer.alloc(0))).toBe(
          true,
        );
      }
    }
    if (mode === 'kept-original') expect(smallerOutputs).toBe(0);
    else expect(smallerOutputs).toBeGreaterThan(0);
    expect(await readFile(source)).toEqual(original);
    expect(await readFile(fixture)).toEqual(fixtureBytes);
    await page.locator('input[type="file"]').setInputFiles([]);
    await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create export' })).toBeDisabled();
  });
}

test('OPT-001 preserves metadata, forms, annotations, links, tags, outlines, layers, and output intents', async ({
  page,
}, testInfo) => {
  const source = path.resolve('packages/test-corpus/fixtures/compression-preservation.pdf');
  const original = await readFile(source);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const pythonPrefix =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  const verifyStructure = String.raw`
import sys
from pypdf import PdfReader

def snapshot(path):
    reader = PdfReader(path)
    root = reader.trailer['/Root']
    fields = reader.get_fields() or {}
    field_values = sorted((name, str(value.get('/FT', '')), str(value.get('/V', ''))) for name, value in fields.items())
    annotations = []
    for page in reader.pages:
        for reference in page.get('/Annots', []):
            annotation = reference.get_object()
            action = annotation.get('/A')
            if action is not None and hasattr(action, 'get_object'):
                action = action.get_object()
            annotations.append((str(annotation.get('/Subtype', '')), str(annotation.get('/Contents', '')), str(action.get('/S', '')) if action else '', str(action.get('/URI', '')) if action else ''))
    oc_properties = root['/OCProperties'].get_object()
    output_intents = root['/OutputIntents'].get_object()
    xmp = root['/Metadata'].get_object().get_data()
    def optional_order(value):
        resolved = value.get_object() if hasattr(value, 'get_object') else value
        if isinstance(resolved, list):
            return tuple(optional_order(item) for item in resolved)
        if hasattr(resolved, 'get') and str(resolved.get('/Type', '')) == '/OCG':
            return str(resolved.get('/Name', ''))
        return str(resolved)
    return {
        'metadata': dict(reader.metadata or {}),
        'fields': field_values,
        'annotations': sorted(annotations),
        'lang': str(root['/Lang']),
        'xmp': xmp,
        'catalog_families': tuple(key in root for key in ['/Metadata', '/MarkInfo', '/StructTreeRoot', '/Outlines', '/OCProperties', '/OutputIntents']),
        'outlines': tuple(str(item.get('/Title', '')) for item in reader.outline),
        'ocg_names': tuple(str(item.get_object().get('/Name', '')) for item in oc_properties['/OCGs']),
        'ocg_config_name': str(oc_properties['/D'].get('/Name', '')),
        'ocg_off_names': tuple(str(item.get_object().get('/Name', '')) for item in oc_properties['/D'].get('/OFF', [])),
        'ocg_order': optional_order(oc_properties['/D']['/Order']),
        'ocg_radio_groups': tuple(
            tuple(str(item.get_object().get('/Name', '')) for item in group.get_object())
            for group in oc_properties['/D'].get('/RBGroups', [])
        ),
        'output_intents': tuple(str(item.get_object().get('/OutputConditionIdentifier', '')) for item in output_intents),
    }

source, output = map(snapshot, sys.argv[1:])
assert source == output
assert source['fields'] == [('synthetic', '', ''), ('synthetic.preservation', '', ''), ('synthetic.preservation.name', '/Tx', 'Preserved synthetic value')]
assert source['catalog_families'] == (True, True, True, True, True, True)
assert source['outlines'] == ('Synthetic preservation bookmark',)
assert source['ocg_names'] == (
    'Synthetic optional content group',
    'Synthetic hidden optional content group',
)
assert source['ocg_config_name'] == 'Synthetic layer configuration'
assert source['ocg_off_names'] == ('Synthetic hidden optional content group',)
assert source['ocg_order'] == ((
    'Review layers',
    'Synthetic optional content group',
    ('Secondary', 'Synthetic hidden optional content group'),
),)
assert source['ocg_radio_groups'] == ((
    'Synthetic optional content group',
    'Synthetic hidden optional content group',
),)
assert source['output_intents'] == ('Synthetic output intent',)
assert ('/Text', 'Synthetic preservation note', '', '') in source['annotations']
assert ('/Link', '', '/URI', 'https://example.invalid/pdfmason-preservation') in source['annotations']
`;
  const render = (file: string) =>
    execFileSync('pdftoppm', ['-singlefile', '-f', '1', '-r', '72', file], {
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const sourceRender = render(source);

  await page.goto('/tools');
  await page.locator('input[type="file"]').setInputFiles(source);
  for (const [preset, label] of [
    ['balanced', 'Balanced'],
    ['smaller', 'Smaller'],
    ['highest-quality', 'Highest quality'],
  ] as const) {
    if (preset !== 'balanced') await page.getByRole('radio', { name: label }).click();
    await page.getByRole('button', { name: 'Create export' }).click();
    await expect(page.getByRole('status')).toContainText('Export ready');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download new copy' }).click();
    const output = testInfo.outputPath(`preservation-${preset}.pdf`);
    await (await downloadPromise).saveAs(output);
    const outputBytes = await readFile(output);
    expect(outputBytes.byteLength).toBeLessThanOrEqual(original.byteLength);
    if (preset === 'highest-quality') expect(outputBytes).toEqual(original);
    else expect(outputBytes.byteLength).toBeLessThan(original.byteLength);
    execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
    execFileSync(python, [...pythonPrefix, '-c', verifyStructure, source, output], {
      stdio: 'pipe',
    });
    expect(render(output).equals(sourceRender)).toBe(true);
  }
  expect(await readFile(source)).toEqual(original);
});

test('OPT-001 blocks incremental revision history before parsing and recovers safely', async ({
  page,
}, testInfo) => {
  const source = path.resolve('packages/test-corpus/fixtures/compression-incremental.pdf');
  const sourceBytes = await readFile(source);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', source], { stdio: 'pipe' });
  const sourceText = sourceBytes.toString('latin1');
  expect(sourceText.match(/startxref\s+\d+\s+%%EOF/gu)).toHaveLength(2);
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const pythonPrefix =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  execFileSync(
    python,
    [
      ...pythonPrefix,
      '-c',
      'import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1], strict=True); assert len(r.pages)==1; assert r.metadata.subject=="Current synthetic incremental revision; no user data"',
      source,
    ],
    { stdio: 'pipe' },
  );

  await page.goto('/tools');
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(source);
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('contains earlier revisions');
  await expect(page.getByRole('status')).toContainText('Your original was not changed');
  await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);

  const supported = path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');
  await input.setInputFiles(supported);
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const output = testInfo.outputPath('incremental-recovery.pdf');
  await (await downloadPromise).saveAs(output);
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  expect(await readFile(source)).toEqual(sourceBytes);
});

test('OPT-001 rejects malformed structures with content-free recovery', async ({
  page,
}, testInfo) => {
  const source = path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');
  const sourceBytes = await readFile(source);
  const sourceText = sourceBytes.toString('latin1');
  const startXref = /startxref\s+(\d+)\s+%%EOF\s*$/u.exec(sourceText)?.[1];
  if (startXref === undefined) throw new Error('Missing synthetic startxref.');
  const mutate = (pattern: RegExp, replacement: string) => {
    const text = sourceText.replace(pattern, replacement);
    if (text === sourceText || text.length !== sourceText.length)
      throw new Error('Synthetic malformed mutation failed.');
    return Buffer.from(text, 'latin1');
  };
  const wrongStartXref = mutate(
    new RegExp(`startxref\\s+${startXref}`, 'u'),
    `startxref\n${'0'.repeat(startXref.length)}`,
  );
  const malformedObject = mutate(/1 0 obj/u, '1 0 obx');
  const accepted = Buffer.concat([sourceBytes, Buffer.from('\n\t \r\n', 'ascii')]);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const pythonPrefix =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  const strictOpen =
    'import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1], strict=True); assert len(r.pages)==1';
  const derived = [
    { bytes: wrongStartXref, name: 'wrong-startxref.pdf', pypdfStatus: 1 },
    { bytes: malformedObject, name: 'malformed-object.pdf', pypdfStatus: 0 },
  ] as const;
  for (const entry of derived) {
    const file = testInfo.outputPath(entry.name);
    await writeFile(file, entry.bytes);
    // Older distro qpdf can recover this broken object header with warnings (3),
    // while 12.4 rejects it (2). Both independently identify damage, never a clean
    // PDF (0). PDFrig must still reject each input with no export below.
    const check = spawnSync(qpdf, ['--check', file], { encoding: 'utf8' });
    expect(check.error).toBeUndefined();
    expect([2, 3]).toContain(check.status);
    expect(check.stderr).toMatch(/WARNING|error/iu);
    expect(
      spawnSync(python, [...pythonPrefix, '-c', strictOpen, file], { stdio: 'pipe' }).status,
    ).toBe(entry.pypdfStatus);
  }

  await page.goto('/tools');
  const input = page.locator('input[type="file"]');
  for (const entry of derived) {
    await input.setInputFiles({
      buffer: entry.bytes,
      mimeType: 'application/pdf',
      name: entry.name,
    });
    await page.getByRole('button', { name: 'Create export' }).click();
    await expect(page.getByRole('status')).toContainText('damaged or incomplete structure');
    await expect(page.getByRole('status')).toContainText('Your original was not changed');
    await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
  }

  await input.setInputFiles({
    buffer: accepted,
    mimeType: 'application/pdf',
    name: 'legal-trailing-whitespace.pdf',
  });
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const output = testInfo.outputPath('malformed-recovery.pdf');
  await (await downloadPromise).saveAs(output);
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  expect(await readFile(source)).toEqual(sourceBytes);
});

test('OPT-001 rejects 501 pages and recovers with a verified 500-page export', async ({
  page,
}, testInfo) => {
  const fixture = path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');
  const fixtureBytes = await readFile(fixture);
  const supported = testInfo.outputPath('synthetic-500.pdf');
  const oversized = testInfo.outputPath('synthetic-501.pdf');
  await mkdir(path.dirname(supported), { recursive: true });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const prefix =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  // Fixed synthetic corpus only; larger boundary variants stay in ignored test output.
  execFileSync(
    python,
    [
      ...prefix,
      '-c',
      'import sys; from pypdf import PdfReader,PdfWriter; r=PdfReader(sys.argv[1]); w=PdfWriter(); [w.add_page(r.pages[0]) for _ in range(500)]; w.write(sys.argv[2]); w.add_page(r.pages[0]); w.write(sys.argv[3])',
      fixture,
      supported,
      oversized,
    ],
    { stdio: 'pipe' },
  );
  const original = await readFile(supported);
  const rejected = await readFile(oversized);
  await page.goto('/tools');
  await page.locator('input[type="file"]').setInputFiles(oversized);
  for (const label of ['Highest quality', 'Balanced', 'Smaller']) {
    await page.getByRole('radio', { name: label }).check();
    await page.getByRole('button', { name: 'Create export' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Compression supports PDFs up to 500 pages. Choose a smaller PDF. Your original was not changed.',
    );
    await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
    await expect(page.getByText('UTILITY_PDF_PAGE_LIMIT', { exact: true })).toHaveCount(0);
  }
  await page.locator('input[type="file"]').setInputFiles(supported);
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const output = testInfo.outputPath('compressed-500.pdf');
  await (await downloadPromise).saveAs(output);
  expect((await readFile(output)).byteLength).toBeLessThanOrEqual(original.byteLength);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  execFileSync(
    python,
    [
      ...prefix,
      '-c',
      'import sys; from pypdf import PdfReader; a,b=map(PdfReader,sys.argv[1:]); assert len(a.pages)==len(b.pages)==500; assert a.metadata==b.metadata; assert [(list(p.mediabox),list(p.cropbox),p.rotation,p.extract_text()) for p in a.pages]==[(list(p.mediabox),list(p.cropbox),p.rotation,p.extract_text()) for p in b.pages]',
      supported,
      output,
    ],
    { stdio: 'pipe' },
  );
  const render = (file: string, pageNumber: number) =>
    execFileSync('pdftoppm', ['-singlefile', '-f', String(pageNumber), '-r', '72', file], {
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  // Structural/text checks cover all 500 pages; pixels sample first, middle, and last.
  for (const pageNumber of [1, 250, 500])
    expect(render(output, pageNumber).equals(render(supported, pageNumber))).toBe(true);
  expect((await readFile(supported)).equals(original)).toBe(true);
  expect((await readFile(oversized)).equals(rejected)).toBe(true);
  expect((await readFile(fixture)).equals(fixtureBytes)).toBe(true);
});

test('OPT-001 blocks active content and attachments, then preserves a supported form', async ({
  page,
}, testInfo) => {
  const input = page.locator('input[type="file"]');
  const risky = [
    ['embedded-javascript.pdf', /contains active content/u],
    ['file-attachment.pdf', /contains attachments/u],
  ] as const;
  await page.goto('/tools');
  for (const [filename, message] of risky) {
    const source = path.resolve(`packages/test-corpus/fixtures/${filename}`);
    const snapshot = await readFile(source);
    await input.setInputFiles(source);
    await page.getByRole('button', { name: 'Create export' }).click();
    await expect(page.getByRole('status')).toHaveText(message);
    await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
    expect((await readFile(source)).equals(snapshot)).toBe(true);
  }
  const formSource = path.resolve('packages/test-corpus/fixtures/acroform-text-field.pdf');
  const formSnapshot = await readFile(formSource);
  await input.setInputFiles(formSource);
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const output = testInfo.outputPath('supported-acroform-compressed.pdf');
  await (await downloadPromise).saveAs(output);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const prefix =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  execFileSync(
    python,
    [
      ...prefix,
      '-c',
      'import sys; from pypdf import PdfReader; a,b=map(PdfReader,sys.argv[1:]); assert len(a.pages)==len(b.pages)==1; assert a.metadata==b.metadata; assert sorted((a.get_fields() or {}).keys())==sorted((b.get_fields() or {}).keys())==["synthetic","synthetic.approved","synthetic.choice","synthetic.name","synthetic.province"]; assert [(k,v.get("/V")) for k,v in (a.get_fields() or {}).items()]==[(k,v.get("/V")) for k,v in (b.get_fields() or {}).items()]',
      formSource,
      output,
    ],
    { stdio: 'pipe' },
  );
  const render = (file: string) =>
    execFileSync('pdftoppm', ['-singlefile', '-f', '1', '-r', '72', file], {
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  expect(render(output).equals(render(formSource))).toBe(true);
  expect((await readFile(formSource)).equals(formSnapshot)).toBe(true);
});

test('headers, footers, page tokens, and watermarks export entirely locally', async ({ page }) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Header, footer \+ watermark/u }).click();
  await expect(page.getByRole('heading', { name: 'Header, footer + watermark' })).toBeVisible();

  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/multipage-three.pdf'));
  await page.getByLabel('Header text (optional)').fill('Synthetic review copy');
  await page.getByText('Optional text watermark', { exact: true }).click();
  await page.getByLabel('Watermark text (optional)').fill('INTERNAL');
  await page.getByLabel('Apply to pages').selectOption('all');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.getByRole('status')).toContainText('Preview ready');
  await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
  await page.getByLabel('I checked the relevant pages for overlap and placement.').check();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviewed copy' }).click();
  const result = await downloadPromise;
  expect(result.suggestedFilename()).toBe('pdfmason-decorated.pdf');
  expect((await readFile(await result.path())).subarray(0, 5).toString('ascii')).toBe('%PDF-');
});

test('EDIT-006 custom ranges preview actual pages, invalidate stale output, and fit compact screens', async ({
  page,
}) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Header, footer \+ watermark/u }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/multipage-three.pdf'));
  await page.getByLabel('Header text (optional)').fill('Preview {page}/{pages}');
  await page.getByLabel('Apply to pages').selectOption('custom');
  await page.getByLabel('PDF page range').fill('1, 3');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.getByRole('status')).toContainText('2 of 3 pages receive marks');
  const preview = page.getByRole('region', { name: 'Decoration preview', exact: true });
  await expect(preview).toContainText('Preview 1/3');
  await expect(
    page.getByRole('img', { name: 'Rendered decoration preview, PDF page 1' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next preview page' }).click();
  await expect(page.getByRole('status')).toContainText('No marks applied');
  await expect(preview).toContainText('Unchanged page');
  await page.getByLabel('Preview page', { exact: true }).selectOption('3');
  await expect(page.getByRole('status')).toContainText('Marks applied');
  await expect(preview).toContainText('Preview 3/3');
  const accessibility = await new AxeBuilder({ page })
    .include('.decoration-workbench')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByLabel('I checked the relevant pages for overlap and placement.').check();
  await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeEnabled();
  const reviewedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviewed copy' }).click();
  const reviewedPath = await (await reviewedDownload).path();
  for (const number of [1, 2, 3]) {
    const text = execFileSync(
      'pdftotext',
      ['-f', String(number), '-l', String(number), reviewedPath, '-'],
      { encoding: 'utf8' },
    );
    expect(text).toContain(`Synthetic page ${number}`);
    if (number === 2) expect(text).not.toContain('Preview');
    else expect(text).toContain(`Preview ${number}/3`);
  }
  await page.getByLabel('Header alignment').selectOption('right');
  await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
  await expect(preview).toContainText('Not built');
  await page.getByLabel('PDF page range').fill('1-2,2');
  await expect(page.getByRole('button', { name: 'Build preview' })).toBeDisabled();
  await page.getByLabel('PDF page range').fill('4');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.getByRole('status')).toContainText('Use pages that exist');
  await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
  await page.getByLabel('PDF page range').fill('1,3');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.getByRole('status')).toContainText('Preview ready');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await expect(preview).toContainText('Not built');
  await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
});

test('EDIT-006 rotated and cropped previews stop safely on clipped headers', async ({ page }) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Header, footer \+ watermark/u }).click();
  for (const fixture of ['rotated-pages.pdf', 'cropped-page.pdf']) {
    await page
      .locator('input[type="file"]')
      .setInputFiles(path.resolve(`packages/test-corpus/fixtures/${fixture}`));
    await page.getByLabel('Edge margin (pt)').fill(fixture === 'cropped-page.pdf' ? '12' : '28');
    await page.getByRole('button', { name: 'Build preview' }).click();
    await expect(page.getByRole('status')).toContainText('Preview ready');
    await expect(page.locator('.decoration-preview canvas')).toBeVisible();
  }
  await page.getByLabel('Header text (optional)').fill('W'.repeat(120));
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.getByRole('status')).toContainText('does not fit');
  await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
});

test('EDIT-006 source ink warnings cover text, vectors, images, forms, uncertainty, and reviewed bytes', async ({
  page,
}) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Header, footer \+ watermark/u }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/decoration-placement.pdf'));
  await page.getByLabel('Header text (optional)').fill('Review {page}');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.getByRole('status')).toContainText('Preview ready');
  const warnings = page.getByRole('region', { name: 'Placement warnings', exact: true });
  await expect(warnings).toContainText('1 of 11 selected pages sampled. 10 not checked.');
  await expect(warnings).toContainText(
    'No ink detected at sampled resolution. Still inspect visually.',
  );
  await page.getByLabel('I checked the relevant pages for overlap and placement.').check();
  const firstDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviewed copy' }).click();
  const firstBytes = await readFile(await (await firstDownload).path());
  const expected: readonly (readonly boolean[])[] = [
    [true, false],
    [false, true],
    [true, false],
    [true, false],
    [false, false],
    [true, true],
    [true, false],
    [true, false],
    [true, false],
  ];
  for (const [index, findings] of expected.entries()) {
    await warnings.getByRole('button', { name: 'Review next unchecked page' }).click();
    await expect(page.getByRole('status')).toContainText(`Preview page ${index + 2} of 11`);
    for (const [band, ink] of findings.entries()) {
      await expect(
        warnings.locator('.decoration-placement__findings > div').nth(band),
      ).toHaveAttribute('data-finding', ink ? 'ink-detected' : 'no-ink-detected');
    }
    await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
  }
  await expect(warnings).toContainText(
    '10 of 11 selected pages sampled. 1 not checked. 0 unavailable.',
  );
  await warnings.getByRole('button', { name: 'Review next unchecked page' }).click();
  await expect(page.getByRole('status')).toContainText('Preview page 11 of 11');
  await expect(warnings).toContainText(
    '10 of 11 selected pages sampled. 0 not checked. 1 unavailable.',
  );
  await expect(warnings.getByRole('button', { name: 'Review next unchecked page' })).toHaveCount(0);
  await warnings.getByLabel('Pages needing attention').selectOption('2');
  await expect(page.getByRole('status')).toContainText('Preview page 2 of 11');
  await page.getByLabel('I checked the relevant pages for overlap and placement.').check();
  const secondDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviewed copy' }).click();
  expect(Buffer.compare(firstBytes, await readFile(await (await secondDownload).path()))).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  expect(
    (
      await new AxeBuilder({ page })
        .include('.decoration-workbench')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByLabel('Edge margin (pt)').fill('12');
  await expect(warnings).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
});

test('EDIT-006 unavailable sampling and watermark-only previews retain manual review', async ({
  page,
}) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Header, footer \+ watermark/u }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/decoration-placement.pdf'));
  await page.getByLabel('Apply to pages').selectOption('custom');
  await page.getByLabel('PDF page range').fill('11');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.getByRole('status')).toContainText('Preview ready');
  const warnings = page.getByRole('region', { name: 'Placement warnings', exact: true });
  await expect(warnings).toContainText('Check unavailable for this page');
  await expect(warnings).toContainText(
    '0 of 1 selected pages sampled. 0 not checked. 1 unavailable.',
  );
  await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await expect(warnings).toHaveCount(0);
  await page.getByLabel('Footer text (optional)').fill('');
  await page.getByLabel('Apply to pages').selectOption('all');
  await page.getByText('Optional text watermark', { exact: true }).click();
  await page.getByLabel('Watermark text (optional)').fill('DRAFT');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.getByRole('status')).toContainText('Preview ready');
  await expect(warnings).toContainText('No header or footer to sample.');
  await expect(warnings).toContainText('Watermark placement is not sampled.');
  await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
});

test('EDIT-006 text-area warnings follow alignment and retain full-margin context', async ({
  page,
}) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Header, footer \+ watermark/u }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/decoration-placement.pdf'));
  await page.getByLabel('Header text (optional)').fill('Review near right edge');
  await page.getByLabel('Footer text (optional)').fill('');
  await page.getByLabel('Apply to pages').selectOption('custom');
  await page.getByLabel('PDF page range').fill('8');
  const warnings = page.getByRole('region', { name: 'Placement warnings', exact: true });
  for (const alignment of ['left', 'center', 'right']) {
    await page.getByLabel('Header alignment').selectOption(alignment);
    await page.getByRole('button', { name: 'Build preview' }).click();
    await expect(page.getByRole('status')).toContainText('Preview ready');
    await expect(warnings.locator('[data-finding]')).toHaveAttribute(
      'data-finding',
      'ink-detected',
    );
    await expect(warnings.locator('[data-text-area]')).toHaveAttribute(
      'data-text-area',
      alignment === 'right' ? 'ink-detected' : 'no-ink-detected',
    );
    await expect(warnings).toContainText(
      alignment === 'right' ? 'Possible overlap' : 'Ink detected elsewhere',
    );
    await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (
      await new AxeBuilder({ page })
        .include('.decoration-workbench')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test('EDIT-006 rejects unsupported glyphs instead of exporting replacement characters', async ({
  page,
}) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Header, footer \+ watermark/u }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await page.getByLabel('Header text (optional)').fill('Lost ☃');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.getByRole('status')).toContainText('Use basic Latin characters');
  await expect(page.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
  await page.getByLabel('Header text (optional)').fill('Review');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.getByRole('status')).toContainText('Preview ready');
});

test('logical page labels and Bates numbering preview, export, and report locally', async ({
  page,
}) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Page \+ Bates numbering/u }).click();
  await expect(page.getByRole('heading', { name: 'Page + Bates numbering' })).toBeVisible();
  await expect(page.getByLabel('Numbering preview')).toContainText('PDFM-1');

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path.resolve('packages/test-corpus/fixtures/multipage-three.pdf'));
  await page.getByLabel('Prefix (optional)').fill('SEC-');
  await page.getByLabel('Number style').selectOption('roman-lower');
  await page.getByLabel('First PDF page').fill('2');
  await page.getByLabel('Last PDF page (optional)').fill('3');
  await expect(page.getByLabel('Numbering preview')).toContainText('SEC-i');
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const labeledDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const labeledDownload = await labeledDownloadPromise;
  expect(labeledDownload.suggestedFilename()).toBe('pdfmason-page-numbered.pdf');
  expect((await readFile(await labeledDownload.path())).subarray(0, 5).toString('ascii')).toBe(
    '%PDF-',
  );

  await page.goto('/tools');
  await page.getByRole('button', { name: /Page \+ Bates numbering/u }).click();
  await page.getByRole('button', { name: 'Bates sequence' }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/multipage-three.pdf'));
  await expect(page.getByRole('status')).toContainText('PDF ready');
  await page.getByLabel('Prefix (optional)').fill('CASE-');
  await page.getByLabel('Start number').fill('42');
  await page.getByLabel('Minimum digits').fill('6');
  await expect(page.getByLabel('Numbering preview')).toContainText('CASE-000042');
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');

  const reportDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download numbering report' }).click();
  const reportDownload = await reportDownloadPromise;
  expect(reportDownload.suggestedFilename()).toBe('pdfmason-numbering-report.json');
  const report: unknown = JSON.parse(await readFile(await reportDownload.path(), 'utf8'));
  expect(report).toMatchObject({
    firstIdentifier: 'CASE-000042',
    lastIdentifier: 'CASE-000044',
    sourcePages: 3,
  });
});

test('ORG-012 rejects clipped numbering without a partial result and recovers with shorter identifiers', async ({
  page,
}) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Page \+ Bates numbering/u }).click();
  await page.getByRole('button', { name: 'Bates sequence' }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await page.getByLabel('Prefix (optional)').fill('W'.repeat(40));
  await page.getByLabel('Suffix (optional)').fill('W'.repeat(40));
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Numbering would clip on a selected page');
  await expect(page.getByRole('status')).toContainText('Your original was not changed');
  await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download numbering report' })).toHaveCount(0);
  await page.getByLabel('Prefix (optional)').fill('QA-');
  await page.getByLabel('Suffix (optional)').fill('');
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download numbering report' }).click();
  const report: unknown = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(report).toMatchObject({
    firstIdentifier: 'QA-000001',
    lastIdentifier: 'QA-000001',
    operationVersion: '1.0.3',
    appliedPages: 1,
  });
  // Selecting a new input clears the previous successful PDF/report before another attempt.
  await page.locator('input[type="file"]').setInputFiles([]);
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download numbering report' })).toHaveCount(0);
  await page.getByLabel('Prefix (optional)').fill('W'.repeat(40));
  await page.getByLabel('Suffix (optional)').fill('W'.repeat(40));
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Numbering would clip');
  await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download numbering report' })).toHaveCount(0);
});

test('ORG-011 alphabetic boundaries and literal prefixes agree in preview and report', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tools');
  await page.getByRole('button', { name: /Page \+ Bates numbering/u }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/multipage-three.pdf'));
  await page.getByLabel('Number style').selectOption('letters-upper');
  await page.getByLabel('Prefix (optional)').fill(' QA  ');
  await page.getByLabel('Start number').fill('26');
  await page.getByLabel('Last PDF page (optional)').fill('3');
  const identifiers = page.getByRole('region', { name: 'Numbering preview' }).getByRole('listitem');
  expect(await identifiers.allTextContents()).toEqual([' QA  Z', ' QA  AA', ' QA  BB']);
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const pendingReport = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download numbering report' }).click();
  const report: unknown = JSON.parse(await readFile(await (await pendingReport).path(), 'utf8'));
  expect(report).toMatchObject({
    firstIdentifier: ' QA  Z',
    lastIdentifier: ' QA  BB',
    appliedPages: 3,
    operationVersion: '1.0.3',
  });
  await page.locator('input[type="file"]').setInputFiles([]);
  await page.getByLabel('Start number').fill('999999999');
  await expect(page.getByRole('region', { name: 'Numbering preview' })).toContainText(
    '120-character limit',
  );
  await expect(page.getByRole('button', { name: 'Create export' })).toBeDisabled();
  await page.getByLabel('Number style').selectOption('decimal');
  await page.getByLabel('Last PDF page (optional)').fill('1');
  expect(await identifiers.allTextContents()).toEqual([' QA  999999999']);
  await page.getByLabel('Prefix (optional)').fill('W'.repeat(40));
  await expect(identifiers.first()).toHaveCSS('overflow-wrap', 'anywhere');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

for (const mode of ['page-labels', 'bates'] as const) {
  test(`ORG-011 / ORG-012 ${mode} settings invalidate old downloads and regenerate matching bytes`, async ({
    page,
  }, testInfo) => {
    await page.goto('/tools');
    await page.getByRole('button', { name: /Page \+ Bates numbering/u }).click();
    if (mode === 'bates') await page.getByRole('button', { name: 'Bates sequence' }).click();
    const fixture = path.resolve('packages/test-corpus/fixtures/multipage-three.pdf');
    const original = await readFile(fixture);
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByLabel('Prefix (optional)').fill('OLD-');
    await page.getByRole('button', { name: 'Create export' }).click();
    await expect(page.getByRole('status')).toContainText('Export ready');
    const prefix = page.getByLabel('Prefix (optional)');
    await prefix.focus();
    await prefix.press('ControlOrMeta+A');
    await prefix.pressSequentially('NEW-');
    await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download numbering report' })).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Settings changed');
    await page.getByLabel('Start number').fill('8');
    const create = page.getByRole('button', { name: 'Create export' });
    await create.focus();
    await create.press('Enter');
    await expect(page.getByRole('status')).toContainText('Export ready');
    const reportDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download numbering report' }).click();
    const report: unknown = JSON.parse(await readFile(await (await reportDownload).path(), 'utf8'));
    const identifiers =
      mode === 'bates' ? ['NEW-000008', 'NEW-000009', 'NEW-000010'] : ['NEW-8', 'NEW-9', 'NEW-10'];
    expect(report).toMatchObject({
      firstIdentifier: identifiers[0],
      lastIdentifier: identifiers[2],
      appliedPages: 3,
      operationVersion: '1.0.3',
      kind: mode,
    });
    const pdfDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download new copy' }).click();
    const output = testInfo.outputPath('regenerated-numbering.pdf');
    await (await pdfDownload).saveAs(output);
    const qpdf =
      process.env.PDFMASON_QPDF_PATH ??
      (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
    execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
    for (let pageNumber = 1; pageNumber <= 3; pageNumber++) {
      const text = execFileSync(
        'pdftotext',
        ['-f', String(pageNumber), '-l', String(pageNumber), output, '-'],
        { encoding: 'utf8' },
      );
      expect(text).toContain(identifiers[pageNumber - 1]);
      expect(text).not.toContain('OLD-');
      expect(text).toContain(`Synthetic page ${pageNumber}`);
    }
    expect(await readFile(fixture)).toEqual(original);
    await page.locator('input[type="file"]').setInputFiles([]);
    await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create export' })).toBeDisabled();
  });
}

test('crop and mixed-size normalization use measured previews and local exports', async ({
  page,
}) => {
  await page.goto('/tools');
  await page.getByRole('button', { name: /Crop \+ resize pages/u }).click();
  await expect(page.getByRole('heading', { name: 'Crop + resize pages' })).toBeVisible();
  await expect(page.getByText(/hidden content remains in the PDF/i)).toBeVisible();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/multipage-three.pdf'));
  await expect(page.getByRole('status')).toContainText('3 pages measured locally');
  await expect(page.getByLabel('Page geometry preview')).toContainText('Result:');
  await page.getByLabel('Top margin (pt)').fill('10');
  await page.getByLabel('Right margin (pt)').fill('20');
  await page.getByLabel('Bottom margin (pt)').fill('30');
  await page.getByLabel('Left margin (pt)').fill('40');
  await expect(page.getByRole('button', { name: 'Create export' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const cropDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const cropDownload = await cropDownloadPromise;
  expect(cropDownload.suggestedFilename()).toBe('pdfmason-cropped.pdf');
  expect((await readFile(await cropDownload.path())).subarray(0, 5).toString('ascii')).toBe(
    '%PDF-',
  );

  await page.goto('/tools');
  await page.getByRole('button', { name: /Crop \+ resize pages/u }).click();
  await page.getByRole('button', { name: 'Normalize page size' }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/multipage-three.pdf'));
  await expect(page.getByRole('status')).toContainText('3 pages measured locally');
  await page.getByLabel('Target size').selectOption('a4');
  await page.getByLabel('Orientation').selectOption('landscape');
  await page.getByLabel('Content fit').selectOption('cover');
  await expect(page.getByLabel('Page geometry preview')).toContainText(
    'edges may sit outside the visible target',
  );
  await page.getByRole('button', { name: 'Create export' }).click();
  await expect(page.getByRole('status')).toContainText('Export ready');
  const resizeDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download new copy' }).click();
  const resizeDownload = await resizeDownloadPromise;
  expect(resizeDownload.suggestedFilename()).toBe('pdfmason-resized.pdf');
  expect((await readFile(await resizeDownload.path())).subarray(0, 5).toString('ascii')).toBe(
    '%PDF-',
  );
});

for (const kind of ['crop', 'resize'] as const) {
  test(`ORG-009 / ORG-010 ${kind} settings discard old output and regenerate from the original`, async ({
    page,
  }, testInfo) => {
    const fixture = path.resolve('packages/test-corpus/fixtures/multipage-three.pdf');
    const original = await readFile(fixture);
    await page.goto('/tools');
    await page.getByRole('button', { name: /Crop \+ resize pages/u }).click();
    if (kind === 'resize') await page.getByRole('button', { name: 'Normalize page size' }).click();
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await expect(page.getByRole('status')).toContainText('3 pages measured locally');
    await page.getByRole('button', { name: 'Create export' }).click();
    await expect(page.getByRole('button', { name: 'Download new copy' })).toBeVisible();
    await page.getByLabel('First PDF page').focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('2');
    await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Settings changed');
    await page.getByLabel('Last PDF page (optional)').fill('2');
    if (kind === 'crop') await page.getByLabel('Left margin (pt)').fill('12');
    else {
      await page.getByLabel('Target size').selectOption('custom');
      await page.getByLabel('Target width (pt)').fill('720');
      await page.getByLabel('Target height (pt)').fill('600');
    }
    const dimensions = kind === 'crop' ? '564 × 720' : '720 × 600';
    await expect(page.getByLabel('Page geometry preview')).toContainText(
      `Result: ${dimensions} pt`,
    );
    await page.getByRole('button', { name: 'Create export' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('Export ready');
    await expect(
      page.getByText(`1 page · ${dimensions} pt first result`, { exact: false }),
    ).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download new copy' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `pdfmason-${kind === 'crop' ? 'cropped' : 'resized'}.pdf`,
    );
    const output = testInfo.outputPath(`regenerated-${kind}.pdf`);
    await download.saveAs(output);
    const qpdf =
      process.env.PDFMASON_QPDF_PATH ??
      (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
    execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
    const python =
      process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
    const pythonPrefix =
      process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
    // Independent reader: the selected page matches the preview/report; other pages stay original.
    const boxes: unknown = JSON.parse(
      execFileSync(
        python,
        [
          ...pythonPrefix,
          '-c',
          'import json,sys; from pypdf import PdfReader; print(json.dumps([{"crop": list(map(float,p.cropbox)), "media": list(map(float,p.mediabox))} for p in PdfReader(sys.argv[1]).pages]))',
          output,
        ],
        { encoding: 'utf8' },
      ),
    );
    const originalBoxes = { crop: [0, 0, 612, 792], media: [0, 0, 612, 792] };
    expect(boxes).toEqual([
      originalBoxes,
      kind === 'crop'
        ? { crop: [12, 36, 576, 756], media: [0, 0, 612, 792] }
        : { crop: [0, 0, 720, 600], media: [0, 0, 720, 600] },
      originalBoxes,
    ]);
    for (let pageNumber = 1; pageNumber <= 3; pageNumber++) {
      const text = execFileSync(
        'pdftotext',
        ['-f', String(pageNumber), '-l', String(pageNumber), output, '-'],
        { encoding: 'utf8' },
      );
      expect(text).toContain(`Synthetic page ${pageNumber}`);
    }
    expect(await readFile(fixture)).toEqual(original);
    await page.locator('input[type="file"]').setInputFiles([]);
    await expect(page.getByRole('button', { name: 'Download new copy' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create export' })).toBeDisabled();
  });
}

test('local viewer renders, searches, organizes, undoes, and exports a synthetic PDF', async ({
  page,
}) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/searchable-text.pdf'));

  await expect(page.getByRole('heading', { name: 'Page 1' })).toBeVisible();
  await expect(page.locator('.status-bar').getByText('2 pages', { exact: true })).toBeVisible();
  const canvas = page.getByLabel('Rendered page 1');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
    .toBeGreaterThan(0);

  await page.getByPlaceholder('Search this PDF').fill('masonry compass');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByRole('button', { name: /Page 1.*masonry compass/i })).toBeVisible();

  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.locator('.status-bar').getByText('3 pages', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actual size (100%)' }).click();
  const initialWidth = await canvas.evaluate((element) => (element as HTMLCanvasElement).width);
  const initialHeight = await canvas.evaluate((element) => (element as HTMLCanvasElement).height);
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await expect
    .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
    .toBe(initialHeight);
  await expect
    .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).height))
    .toBe(initialWidth);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.status-bar').getByText('2 pages', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Review export' }).click();
  await expect(page.getByText('Annotations become page content.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Review your completed copy' })).toBeHidden();
  await page.getByRole('button', { name: 'Review export' }).click();
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('searchable-text-completed.pdf');
});

test('VIEW-003 presentation view keeps the document local and supports complete keyboard navigation', async ({
  page,
}) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/searchable-text.pdf'));
  await expect(page.getByLabel('Rendered page 1')).toBeVisible();

  await page.getByRole('button', { name: 'Actual size (100%)' }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const navigation = page.getByRole('toolbar', { name: 'Document navigation' });
  await expect(navigation.getByText('110%')).toBeVisible();
  const present = navigation.getByRole('button', { name: 'Present' });
  await present.click();

  const presentation = page.getByRole('region', { name: 'Presentation view' });
  const controls = page.getByRole('toolbar', { name: 'Presentation controls' });
  await expect(presentation).toBeVisible();
  await expect(controls).toContainText('Page 1 of 2');
  await expect(controls).toContainText('Runs on this device');
  await expect(page.getByRole('navigation', { name: 'Editor tools' })).toBeHidden();
  await expect(page.getByLabel('Page properties and search')).toBeHidden();
  await expect(controls.getByRole('button', { name: 'Exit presentation' })).toBeFocused();
  const accessibility = await new AxeBuilder({ page })
    .include('.app-frame--presenting')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([]);

  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Rendered page 2')).toBeVisible();
  await expect(controls).toContainText('Page 2 of 2');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Rendered page 2')).toBeVisible();
  await page.keyboard.press('PageUp');
  await expect(page.getByLabel('Rendered page 1')).toBeVisible();
  await page.keyboard.press('PageDown');
  await expect(page.getByLabel('Rendered page 2')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Rendered page 1')).toBeVisible();
  await page.getByRole('group', { name: 'Presented document page 1' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Rendered page 2')).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('Rendered page 1')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByLabel('Rendered page 2')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(presentation).toBeHidden();
  await expect(present).toBeFocused();
  await expect(
    page.getByRole('toolbar', { name: 'Document navigation' }).getByText('110%'),
  ).toBeVisible();
});

test('VIEW-006 EDIT-001 navigates and preserves bookmarks during local annotation export', async ({
  page,
}, testInfo) => {
  const source = path.resolve('packages/test-corpus/fixtures/outline-navigation.pdf');
  const sourceBefore = await readFile(source);
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(source);

  const outline = page.getByRole('region', { name: 'Document outline' });
  const overview = outline.getByRole('button', { name: /Overview/u });
  const namedSection = outline.getByRole('button', { name: /Chapitre 二 — 安全/u });
  const actionOnly = outline.getByRole('button', { name: /External action is never followed/u });
  const missing = outline.getByRole('button', { name: /Missing destination/u });
  const longTitle = outline.getByRole('button', { name: /Long synthetic bookmark/u });
  const finalPage = outline.getByRole('button', { name: /Final page/u });

  await expect(overview).toContainText('Page 1');
  await expect(namedSection).toContainText('Page 2');
  await expect(actionOnly).toBeDisabled();
  await expect(actionOnly).toContainText('No page destination');
  await expect(missing).toBeDisabled();
  await expect(missing).toContainText('No page destination');
  await expect(finalPage).toContainText('Page 3');
  expect(await longTitle.locator('span').innerText()).toHaveLength(200);

  const parentIndent = Number.parseFloat(
    await overview.locator('..').evaluate((element) => getComputedStyle(element).paddingLeft),
  );
  const childIndent = Number.parseFloat(
    await namedSection.locator('..').evaluate((element) => getComputedStyle(element).paddingLeft),
  );
  expect(childIndent).toBeGreaterThan(parentIndent);

  await namedSection.click();
  await expect(page.getByRole('heading', { name: 'Page 2' })).toBeVisible();
  await finalPage.click();
  await expect(page.getByRole('heading', { name: 'Page 3' })).toBeVisible();
  await overview.click();
  await expect(page.getByRole('heading', { name: 'Page 1' })).toBeVisible();
  await expect(page).toHaveURL(/\/workspace$/u);
  await expect(page.getByText('Original unchanged', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeEnabled();
  await expect(page.locator('.workspace-warning')).toContainText('Bookmarks preserved');
  await expect(page.locator('.workspace-warning')).toContainText('Page organizing stays locked');
  await expect(page.getByRole('button', { name: 'Extract this page' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export parts' })).toBeDisabled();
  await expect(page.getByRole('button', { exact: true, name: 'PDF' }).first()).toBeDisabled();
  expect(await readFile(source)).toEqual(sourceBefore);

  const accessibility = await new AxeBuilder({ page })
    .include('[aria-labelledby="document-outline-title"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Synthetic bookmark overlay');
  await page.getByRole('button', { name: 'Review export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('bookmarks-edited.pdf');
  await (await downloadPromise).saveAs(output);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const pythonArgs =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  execFileSync(python, [...pythonArgs, path.resolve('scripts/verify-pdf-outline.py'), output], {
    stdio: 'pipe',
  });
  expect(
    execFileSync('pdftotext', ['-f', '1', '-l', '1', output, '-'], { encoding: 'utf8' }).replace(
      /\s+/gu,
      ' ',
    ),
  ).toContain('Synthetic bookmark overlay');
  for (const pageNumber of [2, 3]) {
    const render = (file: string, name: string): Buffer => {
      const prefix = testInfo.outputPath(`${name}-${pageNumber}`);
      execFileSync(
        'pdftoppm',
        [
          '-f',
          String(pageNumber),
          '-l',
          String(pageNumber),
          '-singlefile',
          '-r',
          '72',
          '-png',
          file,
          prefix,
        ],
        { stdio: 'pipe' },
      );
      return execFileSync(
        python,
        [
          ...pythonArgs,
          '-c',
          'import sys; from PIL import Image; sys.stdout.buffer.write(Image.open(sys.argv[1]).convert("RGB").tobytes())',
          `${prefix}.png`,
        ],
        { maxBuffer: 4 * 1024 * 1024 },
      );
    };
    expect(render(output, 'output')).toEqual(render(source, 'source'));
  }
  await page.getByLabel('Open PDF').setInputFiles(output);
  await expect(page.locator('.status-bar')).toContainText('3 pages');
  await page
    .getByRole('region', { name: 'Document outline' })
    .getByRole('button', { name: /Final page/u })
    .click();
  await expect(page.getByRole('heading', { name: 'Page 3' })).toBeVisible();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('VIEW-007 inspects attachment metadata locally without exposing its payload', async ({
  page,
}) => {
  const source = path.resolve('packages/test-corpus/fixtures/file-attachment.pdf');
  const sourceBefore = await readFile(source);
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(source);

  const contents = page.getByRole('region', { name: 'Document contents' });
  await expect(contents.getByText('synthetic-note.txt')).toBeVisible();
  await expect(contents.getByText(/does not open or extract embedded files/u)).toBeVisible();
  await expect(contents.getByRole('button')).toHaveCount(0);
  await expect(contents.getByRole('link')).toHaveCount(0);
  await expect(page.getByText('Original unchanged', { exact: true })).toBeVisible();
  expect(await readFile(source)).toEqual(sourceBefore);

  const accessibility = await new AxeBuilder({ page })
    .include('[aria-labelledby="document-contents-title"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test('VIEW-007 reports optional-content visibility without layer controls', async ({ page }) => {
  const source = path.resolve('packages/test-corpus/fixtures/compression-preservation.pdf');
  const sourceBefore = await readFile(source);
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(source);

  const contents = page.getByRole('region', { name: 'Document contents' });
  await expect(contents.getByText('Synthetic optional content group')).toBeVisible();
  await expect(contents.getByText('Synthetic layer configuration')).toBeVisible();
  await expect(contents.getByText('Visible in source')).toBeVisible();
  await expect(contents.getByText('Synthetic hidden optional content group')).toBeVisible();
  await expect(contents.getByText('Review layers › Secondary')).toBeVisible();
  await expect(contents.getByText('Hidden in source')).toBeVisible();
  await expect(contents.getByText('Mutually exclusive layer set in source')).toHaveCount(2);
  await expect(contents.getByText(/cannot be changed here/u)).toBeVisible();
  await expect(contents.getByRole('checkbox')).toHaveCount(0);
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('ANNO-008 calibrated guides support keyboard input, zoom, rotation, undo, and local-only export disclosure', async ({
  page,
}) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/searchable-text.pdf'));
  await page.getByRole('button', { exact: true, name: 'Measure' }).click();
  const panel = page.getByRole('region', { name: 'Measure this page' });
  const result = panel.getByLabel('Measurement result');
  await expect(result).toContainText('calibrate this page');
  await panel.getByLabel('Known A–B length').fill('3');
  await panel.getByRole('button', { name: 'Calibrate from A–B' }).click();
  await expect(result).toContainText('3.00 m');
  await panel.getByLabel('B X percent').fill('50');
  await panel.getByRole('button', { name: 'Apply coordinates' }).click();
  await expect(result).toContainText('1.50 m');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(result).toContainText('1.50 m');
  await page.getByRole('button', { exact: true, name: 'Undo' }).click();
  await expect(result).toContainText('3.00 m');
  await page.getByRole('button', { exact: true, name: 'Redo' }).click();
  await expect(result).toContainText('1.50 m');
  await page.getByRole('button', { exact: true, name: 'Pages' }).click();
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await page.getByRole('button', { exact: true, name: 'Measure' }).click();
  await expect(result).toContainText('1.50 m');
  await panel.getByLabel('Measurement shape').selectOption('rectangle');
  await panel.getByLabel('B X percent').fill('50');
  await panel.getByRole('button', { name: 'Apply coordinates' }).click();
  await expect(result).toContainText('Perimeter:');
  await expect(result).toContainText('m²');
  // Each page starts independently uncalibrated; returning restores its own scale.
  await page.getByRole('button', { exact: true, name: 'Next' }).click();
  await expect(result).toContainText('calibrate this page');
  await page.getByRole('button', { exact: true, name: 'Previous' }).click();
  await expect(result).toContainText('Perimeter:');
  // No PDF mark is created, and the save review explicitly states the omission.
  await expect(page.locator('.annotation-item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review export' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Measurement guides and page calibration are session-only',
  );
  const completedCopy = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  await completedCopy;
  // Even after PDF export, replacing a workspace warns about its unsaved session guides.
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('session-only measurement guides');
    await dialog.dismiss();
  });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await expect(result).toContainText('Perimeter:');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Drop in a PDF.' })).toBeVisible();
});

for (const example of [
  { fixture: 'cropped-page.pdf', page: 1, area: '12.00', perimeter: '14.00' },
  { fixture: 'rotated-pages.pdf', page: 2, area: '6.95', perimeter: '10.64' },
] as const) {
  test(`ANNO-008 uses visible geometry and safe pointer guides on ${example.fixture}`, async ({
    page,
  }) => {
    await page.goto('/workspace');
    await expect(page.getByLabel('Open PDF')).toBeEnabled();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(path.resolve(`packages/test-corpus/fixtures/${example.fixture}`));
    if (example.page === 2) await page.getByRole('button', { exact: true, name: 'Next' }).click();
    await page.getByRole('button', { exact: true, name: 'Measure' }).click();
    const panel = page.getByRole('region', { name: 'Measure this page' });
    const result = panel.getByLabel('Measurement result');
    await panel.getByLabel('Known A–B length').fill('3');
    await panel.getByRole('button', { name: 'Calibrate from A–B' }).click();
    await panel.getByLabel('Measurement shape').selectOption('rectangle');
    await panel.getByLabel('B Y percent').fill('75');
    await panel.getByRole('button', { name: 'Apply coordinates' }).click();
    await expect(result).toContainText(`${example.area} m²`);
    await expect(result).toContainText(`Perimeter: ${example.perimeter} m`);
    const accessibility = await new AxeBuilder({ page })
      .include('.measurement-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await panel.getByLabel('Measurement shape').selectOption('distance');
    const overlay = page.locator('.measurement-overlay');
    await overlay.scrollIntoViewIfNeeded();
    const box = await overlay.boundingBox();
    if (box === null) throw new Error('Synthetic measurement overlay did not render');
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.25, { steps: 4 });
    await page.mouse.up();
    await expect(result).toContainText('1.50 m');
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.25, { steps: 4 });
    await overlay.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    await expect(result).toContainText('1.50 m');
  });
}

test('passwords stay ephemeral and risky documents lock organizer export', async ({ page }) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/password-aes256.pdf'));
  await expect(page.getByRole('heading', { name: 'Enter its password.' })).toBeVisible();
  await page.getByLabel('Document password').fill('pdfmason-test');
  await page.getByRole('button', { name: 'Open locally' }).click();
  await expect(page.getByRole('heading', { name: 'Page 1' })).toBeVisible();
  await expect(page.getByText(/editing export is locked.*password encryption/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();

  await page.reload();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/embedded-javascript.pdf'));
  await expect(page.getByText(/editing export is locked.*embedded JavaScript/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();
});

test('ORG-001 ORG-002 ORG-006 and ORG-007 block incompatible organizer structures', async ({
  page,
}) => {
  const preservationFixture = path.resolve(
    'packages/test-corpus/fixtures/compression-preservation.pdf',
  );
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(preservationFixture);
  const outline = page.getByRole('region', { name: 'Document outline' });
  await expect(outline.getByText('Synthetic preservation bookmark')).toBeVisible();
  await expect(outline.getByText('Page 1')).toBeVisible();
  await outline.getByRole('button', { name: /Synthetic preservation bookmark/u }).click();
  await expect(page.getByRole('heading', { name: 'Page 1' })).toBeVisible();
  const outlineAccessibility = await new AxeBuilder({ page })
    .include('[aria-labelledby="document-outline-title"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(outlineAccessibility.violations).toEqual([]);
  await expect(page.getByText(/document-level metadata is not copied/i)).toBeVisible();
  await expect(page.locator('.workspace-warning')).toContainText('Editing available');
  await expect(page.locator('.workspace-warning')).toContainText('Existing tags and bookmarks');
  await expect(page.getByText(/editing export is locked/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Extract this page' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export parts' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeEnabled();

  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/compression-incremental.pdf'));
  await expect(page.getByText(/editing export is locked/i)).toContainText(
    'earlier saved revisions',
  );
  await expect(page.getByRole('button', { name: 'Extract this page' })).toBeDisabled();

  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await expect(page.locator('.status-bar')).toContainText('1 page');
  await expect(page.getByText('This PDF has no outline bookmarks.')).toBeVisible();
  await page.getByLabel('Insert PDF').setInputFiles(preservationFixture);
  await expect(page.locator('.workspace-alert')).toContainText('interactive forms');
  await expect(page.locator('.workspace-alert')).toContainText('bookmarks');
  await expect(page.locator('.status-bar')).toContainText('1 page');
});

test('ORG-001 and ORG-007 review insertion position and preserve final page order', async ({
  page,
}, testInfo) => {
  const destination = path.resolve('packages/test-corpus/fixtures/searchable-text.pdf');
  const incoming = path.resolve('packages/test-corpus/fixtures/multipage-three.pdf');
  const destinationBefore = await readFile(destination);
  const incomingBefore = await readFile(incoming);
  const addPdf = page.getByRole('button', { exact: true, name: 'PDF' }).first();

  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(destination);
  await expect(page.locator('.status-bar')).toContainText('2 pages');

  let chooserPromise = page.waitForEvent('filechooser');
  await addPdf.click();
  await (await chooserPromise).setFiles(incoming);
  const review = page.getByRole('dialog', { name: 'Review PDF insertion' });
  await expect(review).toBeVisible();
  await expect(review).toContainText('Add 3 pages after page 1');
  await expect(review).toContainText('pages 2–4');
  await expect(review).toContainText('both originals stay unchanged');
  await expect(page.locator('.status-bar')).toContainText('2 pages');
  await expect(review.getByRole('button', { name: 'Cancel PDF insertion' })).toBeFocused();
  const accessibility = await new AxeBuilder({ page })
    .include('.editor-dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([]);
  await review.press('Escape');
  await expect(review).toBeHidden();
  await expect(page.locator('.status-bar')).toContainText('2 pages');
  await expect(addPdf).toBeFocused();

  chooserPromise = page.waitForEvent('filechooser');
  await addPdf.click();
  await (await chooserPromise).setFiles(incoming);
  await expect(review).toContainText('Add 3 pages after page 1');
  await review.getByRole('button', { name: 'Insert pages' }).click();
  await expect(review).toBeHidden();
  await expect(page.locator('.status-bar')).toContainText('5 pages');
  await expect(page.getByRole('heading', { name: 'Page 2' })).toBeVisible();

  await page.getByRole('button', { name: 'Review export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('reviewed-pdf-insertion.pdf');
  await (await downloadPromise).saveAs(output);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const pageText = Array.from({ length: 5 }, (_, index) =>
    execFileSync('pdftotext', ['-f', String(index + 1), '-l', String(index + 1), output, '-'], {
      encoding: 'utf8',
    }),
  );
  expect(pageText[0]).toContain('masonry compass');
  expect(pageText[1]).toContain('Synthetic page 1');
  expect(pageText[2]).toContain('Synthetic page 2');
  expect(pageText[3]).toContain('Synthetic page 3');
  expect(pageText[4]).toContain('masonry compass second result');
  expect(await readFile(destination)).toEqual(destinationBefore);
  expect(await readFile(incoming)).toEqual(incomingBefore);
});

test('annotations and a one-time visual signature are keyboard complete and export locally', async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 900 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await expect(page.getByRole('heading', { name: 'Text overlay' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Text' }).fill('Reviewed locally');
  const annotation = page.getByRole('button', { name: /Text overlay.*Arrow keys move it/i });
  await annotation.focus();
  await annotation.press('ArrowRight');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Callout', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await expect(annotation).toHaveCount(2);
  await annotation.last().focus();
  await annotation.last().press('Delete');
  await expect(annotation).toHaveCount(1);
  await page.getByRole('button', { exact: true, name: 'Comment' }).click();
  await page.getByRole('button', { name: 'Place comment at page centre' }).click();
  await expect(
    page.getByLabel('Page properties and search').getByRole('heading', { name: 'Comment' }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Comment' }).fill('Confirm the synthetic totals.');
  await page.getByRole('button', { exact: true, name: 'Comment' }).click();
  const reviewLedger = page.getByRole('region', { name: 'Review ledger' });
  await expect(reviewLedger).toBeVisible();
  await expect(reviewLedger.getByText('Confirm the synthetic totals.')).toBeVisible();
  await reviewLedger.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(reviewLedger.getByText('Comment resolved.')).toBeVisible();
  await reviewLedger.getByLabel('Comment status filter').selectOption('resolved');
  const reportDownloadPromise = page.waitForEvent('download');
  await reviewLedger.getByRole('button', { name: 'Export all comments (.json)' }).click();
  const reportDownload = await reportDownloadPromise;
  expect(reportDownload.suggestedFilename()).toBe('pdfmason-comment-summary.json');
  const reportPath = await reportDownload.path();
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
    readonly comments: readonly {
      readonly commentId: string;
      readonly pageNumber: number;
      readonly status: string;
      readonly text: string;
    }[];
    readonly schema: string;
    readonly summary: { readonly resolved: number; readonly total: number };
  };
  expect(report).toMatchObject({
    schema: 'pdfmason.comment-summary',
    summary: { resolved: 1, total: 1 },
  });
  expect(report.comments[0]).toMatchObject({
    pageNumber: 1,
    status: 'resolved',
    text: 'Confirm the synthetic totals.',
  });
  expect(report.comments[0]?.commentId).toMatch(/^[0-9a-f-]{36}$/u);
  await page.getByRole('button', { name: 'Sign' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a visual signature' })).toBeVisible();
  await expect(page.getByText(/not a certificate-backed digital signature/i)).toBeVisible();
  await page.getByLabel('Type your signature').fill('Synthetic Signer');
  await page.getByRole('button', { name: 'Place visual signature' }).click();
  await expect(
    page
      .getByLabel('Page properties and search')
      .getByRole('heading', { name: 'Visual signature' }),
  ).toBeVisible();

  await page.getByRole('button', { exact: true, name: 'Stamp' }).click();
  const stampDialog = page.getByRole('dialog', { name: 'Place a stamp' });
  await expect(stampDialog).toBeVisible();
  await stampDialog.getByLabel('Custom stamp text').fill('QA passed');
  await stampDialog.getByLabel('Save this custom stamp on this device').check();
  await stampDialog.getByRole('button', { name: 'Place stamp' }).click();
  await expect(
    page
      .getByLabel('Page properties and search')
      .getByRole('heading', { name: 'Stamp: QA passed' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => globalThis.localStorage.getItem('pdfmason.custom-stamps.v1')),
  ).toContain('QA passed');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Review export' }).click();
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('smoke-one-page-completed.pdf');
});

test('SEC-007 requires informed confirmation before editing a signature-field copy', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-field.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('A signature field was detected');
  await expect(warning).toContainText('may invalidate a digital signature associated with it');
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();

  await warning.getByRole('button', { name: 'Continue editing a new copy' }).click();
  await expect(warning).toContainText('PDFrig does not verify signature validity');
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { exact: true, name: 'PDF' }).first()).toBeDisabled();

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await page.getByRole('textbox', { name: 'Text' }).fill('Reviewed signed copy');
  await expect(page.getByLabel('Document status')).toContainText('Changes not exported');

  await page.getByRole('button', { name: 'Review export' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review your completed copy' });
  await expect(dialog).toContainText('A signature field was detected');
  await expect(dialog).toContainText('associated with this field');
  await expect(dialog).toContainText('does not verify signature validity');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('signature-field-edited-copy.pdf');
  await (await downloadPromise).saveAs(output);

  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const pythonArgs =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  execFileSync(
    python,
    [
      ...pythonArgs,
      '-c',
      'import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1], strict=True); f=r.get_fields() or {}; assert f["synthetic.signature-field"]["/FT"]=="/Sig"; assert "Reviewed signed copy" in (r.pages[0].extract_text() or "")',
      output,
    ],
    { stdio: 'pipe' },
  );
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-007 treats an empty signature field as field-only without a current-signature claim', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-field-empty.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('A signature field was detected');
  await expect(warning).toContainText('may invalidate a digital signature associated with it');
  await expect(warning).not.toContainText('current digital signature');
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();

  await warning.getByRole('button', { name: 'Continue editing a new copy' }).click();
  await expect(warning).toContainText('PDFrig does not verify signature validity');
  await expect(warning).not.toContainText('current digital signature');
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeEnabled();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-007 recovers from a malformed signature value without a validity claim', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-malformed-value.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('A signature field was detected');
  await expect(warning).toContainText('may invalidate a digital signature associated with it');
  await expect(warning).not.toContainText('current digital signature');
  await expect(warning).not.toContainText('parser');
  await expect(warning.getByRole('button', { name: 'Continue editing a new copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-007 detects an orphaned signature widget outside the AcroForm field tree', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-orphan-widget.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('Viewing is local and safe');
  await expect(warning).toContainText('signature fields');
  await expect(warning).toContainText('damaged document structure');
  await expect(warning).not.toContainText('current digital signature');
  await expect(warning.getByRole('button', { name: 'Continue editing a new copy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-007 keeps action-free form widgets editable after signature acknowledgement', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-with-text-field.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('A signature field was detected');
  await expect(warning).not.toContainText('embedded JavaScript');
  await expect(warning.getByRole('button', { name: 'Continue editing a new copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();

  await warning.getByRole('button', { name: 'Continue editing a new copy' }).click();
  await expect(warning).toContainText('PDFrig does not verify signature validity');
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-006 and SEC-007 keep action-bearing form widgets fail-closed', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-with-text-field-action.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('Viewing is local and safe');
  await expect(warning).toContainText('embedded JavaScript');
  await expect(warning).toContainText('signature fields');
  await expect(warning).not.toContainText('text-field action canary');
  await expect(warning.getByRole('button', { name: 'Continue editing a new copy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-006 and SEC-007 keep explicit signature-field actions fail-closed', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-field-action.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('Viewing is local and safe');
  await expect(warning).toContainText('embedded JavaScript');
  await expect(warning).toContainText('signature fields');
  await expect(warning).not.toContainText('signature action canary');
  await expect(warning.getByRole('button', { name: 'Continue editing a new copy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-006 and SEC-007 keep inherited signature-field actions fail-closed', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-parent-field-action.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('Viewing is local and safe');
  await expect(warning).toContainText('embedded JavaScript');
  await expect(warning).toContainText('signature fields');
  await expect(warning).not.toContainText('parent signature action canary');
  await expect(warning.getByRole('button', { name: 'Continue editing a new copy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-006 and SEC-007 keep child signature-widget actions fail-closed', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-child-widget-action.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('Viewing is local and safe');
  await expect(warning).toContainText('embedded JavaScript');
  await expect(warning).toContainText('signature fields');
  await expect(warning).not.toContainText('child signature action canary');
  await expect(warning.getByRole('button', { name: 'Continue editing a new copy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-006 and SEC-007 scan beyond signature pages for annotation actions', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-cross-page-action.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('Viewing is local and safe');
  await expect(warning).toContainText('embedded JavaScript');
  await expect(warning).toContainText('signature fields');
  await expect(warning).not.toContainText('cross-page action canary');
  await expect(warning.getByRole('button', { name: 'Continue editing a new copy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-007 strengthens recognized signature metadata warnings without exposing metadata fields', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-metadata-placeholder.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const metadataCanaries = [
    'Synthetic metadata signer canary',
    'Synthetic metadata reason canary',
    'Synthetic metadata location canary',
    'synthetic-contact-canary@example.invalid',
  ];
  const body = page.locator('body');
  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('A digital-signature structure was detected');
  await expect(warning).toContainText('may invalidate its current digital signature');
  for (const canary of metadataCanaries) await expect(body).not.toContainText(canary);
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();

  await warning.getByRole('button', { name: 'Continue editing a new copy' }).click();
  await expect(warning).toContainText('PDFrig does not verify signature validity');
  for (const canary of metadataCanaries) await expect(body).not.toContainText(canary);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await page.getByRole('textbox', { name: 'Text' }).fill('Reviewed metadata copy');

  await page.getByRole('button', { name: 'Review export' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review your completed copy' });
  await expect(dialog).toContainText('A digital-signature structure was detected');
  await expect(dialog).toContainText('may invalidate its current digital signature');
  await expect(dialog).toContainText('does not verify signature validity');
  for (const canary of metadataCanaries) await expect(body).not.toContainText(canary);
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-007 gives recognized metadata precedence across mixed signature fields', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-mixed-fields.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const metadataCanaries = [
    'Mixed metadata signer canary',
    'Mixed metadata reason canary',
    'Mixed metadata location canary',
    'mixed-contact-canary@example.invalid',
  ];
  const body = page.locator('body');
  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('A digital-signature structure was detected');
  await expect(warning).toContainText('may invalidate its current digital signature');
  for (const canary of metadataCanaries) await expect(body).not.toContainText(canary);
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();

  await warning.getByRole('button', { name: 'Continue editing a new copy' }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await page.getByRole('textbox', { name: 'Text' }).fill('Reviewed mixed signature copy');
  await page.getByRole('button', { name: 'Review export' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review your completed copy' });
  await expect(dialog).toContainText('A digital-signature structure was detected');
  await expect(dialog).toContainText('does not verify signature validity');
  for (const canary of metadataCanaries) await expect(body).not.toContainText(canary);

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('signature-mixed-fields-edited-copy.pdf');
  await (await downloadPromise).saveAs(output);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const pythonArgs =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  execFileSync(
    python,
    [
      ...pythonArgs,
      '-c',
      'import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1], strict=True); fs=r.trailer["/Root"]["/AcroForm"].get_object()["/Fields"]; assert len(fs)==2; e=fs[0].get_object(); m=fs[1].get_object(); assert e["/FT"]=="/Sig" and "/V" not in e; assert m["/FT"]=="/Sig" and m["/V"].get_object()["/Type"]=="/Sig"; assert "Reviewed mixed signature copy" in " ".join((r.pages[0].extract_text() or "").split())',
      output,
    ],
    { stdio: 'pipe' },
  );
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-007 keeps out-of-bounds signature byte ranges field-only and content-free', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve(
    'packages/test-corpus/fixtures/signature-byte-range-out-of-bounds.pdf',
  );
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const metadataCanaries = [
    'Out-of-bounds metadata signer canary',
    'Out-of-bounds metadata reason canary',
    'Out-of-bounds metadata location canary',
    'out-of-bounds-contact-canary@example.invalid',
  ];
  const body = page.locator('body');
  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('A signature field was detected');
  await expect(warning).toContainText('may invalidate a digital signature associated with it');
  await expect(warning).not.toContainText('current digital signature');
  for (const canary of metadataCanaries) await expect(body).not.toContainText(canary);
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();

  await warning.getByRole('button', { name: 'Continue editing a new copy' }).click();
  await expect(warning).toContainText('PDFrig does not verify signature validity');
  await expect(warning).not.toContainText('current digital signature');
  for (const canary of metadataCanaries) await expect(body).not.toContainText(canary);
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeEnabled();
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('SEC-007 preserves parent and widget signature-field hierarchy in edited copies', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/signature-parent-widget.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  const warning = page.locator('.workspace-warning');
  await expect(warning).toContainText('A signature field was detected');
  await expect(warning).toContainText('may invalidate a digital signature associated with it');
  await expect(warning).not.toContainText('current digital signature');
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();

  await warning.getByRole('button', { name: 'Continue editing a new copy' }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await page.getByRole('textbox', { name: 'Text' }).fill('Reviewed parent widget copy');

  await page.getByRole('button', { name: 'Review export' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review your completed copy' });
  await expect(dialog).toContainText('A signature field was detected');
  await expect(dialog).toContainText('does not verify signature validity');
  await expect(dialog).not.toContainText('current digital signature');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('signature-parent-widget-edited-copy.pdf');
  await (await downloadPromise).saveAs(output);

  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const pythonArgs =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  execFileSync(
    python,
    [
      ...pythonArgs,
      '-c',
      'import sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1], strict=True); pref=r.trailer["/Root"]["/AcroForm"].get_object()["/Fields"][0]; p=pref.get_object(); kref=p["/Kids"][0]; k=kref.get_object(); assert p["/FT"]=="/Sig" and "/V" not in p; assert k["/Subtype"]=="/Widget" and k.raw_get("/Parent").idnum==pref.idnum; assert r.pages[0].raw_get("/Annots")[0].idnum==kref.idnum; assert "Reviewed parent widget copy" in " ".join((r.pages[0].extract_text() or "").split())',
      output,
    ],
    { stdio: 'pipe' },
  );
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('PRINT-001 prepares a bounded local range and opens the host dialog without mutating source', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/multipage-three.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await page.getByRole('textbox', { name: 'Text' }).fill('Printed working copy');
  await expect(page.getByLabel('Document status')).toContainText('Changes not exported');

  await page.getByRole('button', { name: 'Print', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Print this working copy' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('source PDF stays unchanged');
  await expect(dialog).toContainText('measurement guides are not printed');

  await dialog.getByLabel('Pages').fill('1-2, 2');
  await dialog.getByRole('button', { name: 'Prepare print' }).click();
  await expect(dialog.getByRole('status')).toContainText('Do not repeat pages');
  await expect(dialog.getByLabel('Printable pages')).toHaveCount(0);

  await dialog.getByLabel('Pages').fill('1, 3');
  await dialog.getByLabel('Preview quality').selectOption('2');
  await dialog.getByRole('button', { name: 'Prepare print' }).click();
  const printablePages = dialog.getByLabel('Printable pages').locator('.print-preview-page');
  await expect(printablePages).toHaveCount(2);
  await expect(printablePages.first()).toHaveAttribute('data-render-state', 'ready', {
    timeout: 30_000,
  });
  await expect(dialog.getByRole('status')).toContainText('2 of 2 pages ready', {
    timeout: 30_000,
  });
  expect(
    await printablePages.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-page-number')),
    ),
  ).toEqual(['1', '3']);
  expect(
    await printablePages.locator('canvas').evaluateAll((canvases) =>
      canvases.map((canvas) => ({
        height: (canvas as HTMLCanvasElement).height,
        width: (canvas as HTMLCanvasElement).width,
      })),
    ),
  ).toEqual([
    { height: 1584, width: 1224 },
    { height: 1584, width: 1224 },
  ]);
  expect(
    (await new AxeBuilder({ page }).include('.print-dialog__panel').analyze()).violations,
  ).toEqual([]);

  await page.evaluate(() => {
    globalThis.print = () => {
      document.documentElement.dataset.pdfmasonPrintCalled = 'true';
    };
  });
  await dialog.getByRole('button', { name: 'Open print dialog' }).click();
  await expect
    .poll(() => page.locator('html').getAttribute('data-pdfmason-print-called'))
    .toBe('true');
  await expect(dialog.getByRole('status')).toContainText(
    'cannot confirm whether pages were printed',
  );
  await expect(page.getByLabel('Document status')).toContainText('Changes not exported');
  expect(await readFile(source)).toEqual(sourceBefore);

  await page.setViewportSize({ height: 780, width: 390 });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Close print dialog' }).click();
  await expect(dialog).toHaveCount(0);
});

test('ANNO-003 partially erases styled freehand strokes with pointer and keyboard undo', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const source = path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');
  const sourceBefore = await readFile(source);
  await page.locator('input[type="file"]').first().setInputFiles(source);

  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const toolOptions = page.locator('.tool-options');
  await toolOptions.getByLabel('Freehand stroke colour').fill('#26756f');
  await toolOptions.getByLabel('Stroke thickness').selectOption('4');
  await toolOptions.getByRole('button', { name: 'Place at page centre' }).click();
  const ink = page.getByRole('button', { name: /Freehand drawing.*Delete removes it/i });
  await expect(ink).toHaveCount(1);
  await expect(page.getByLabel('Selected stroke colour')).toHaveValue('#26756f');
  await expect(
    page.getByLabel('Page properties and search').getByLabel('Stroke thickness'),
  ).toHaveValue('4');

  await toolOptions.getByRole('button', { name: 'Eraser', exact: true }).click();
  await toolOptions.getByLabel('Eraser size').selectOption('0.07');
  // ANNO-003: getPage is asynchronous; default canvas dimensions are not PDF geometry.
  // Wait for the renderer's explicit CSS dimensions before deriving pointer coordinates.
  await expect
    .poll(() =>
      page.getByLabel('Rendered page 1').evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return canvas.style.width !== '' && canvas.style.height !== '';
      }),
    )
    .toBe(true);
  const overlay = page.locator('.document-overlay');
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error('The document overlay was not rendered.');
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.64, { steps: 6 });
  await page.mouse.up();
  await expect(ink).toHaveCount(2);

  await page.getByRole('button', { exact: true, name: 'Undo' }).click();
  await expect(ink).toHaveCount(1);
  await toolOptions.getByRole('button', { name: 'Freehand', exact: true }).click();
  await ink.click();
  await toolOptions.getByRole('button', { name: 'Eraser', exact: true }).click();
  await toolOptions.getByRole('button', { name: 'Erase middle of selected stroke' }).click();
  await expect(ink).toHaveCount(2);
  await page.getByRole('button', { exact: true, name: 'Undo' }).click();
  await expect(ink).toHaveCount(1);
  await page.getByRole('button', { exact: true, name: 'Redo' }).click();
  await expect(ink).toHaveCount(2);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Review export' }).click();
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('smoke-one-page-completed.pdf');
  await (await downloadPromise).saveAs(output);
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const python =
    process.env.PDFMASON_PYTHON_PATH ?? (process.platform === 'win32' ? 'py' : 'python');
  const pythonArgs =
    process.env.PDFMASON_PYTHON_PATH === undefined && process.platform === 'win32' ? ['-3'] : [];
  const inspection = spawnSync(
    python,
    [
      ...pythonArgs,
      '-c',
      'import sys; from pypdf import PdfReader; from pypdf.generic import ContentStream; r=PdfReader(sys.argv[1], strict=True); p=r.pages[0]; ops=ContentStream(p.get_contents(),r).operations; widths=[float(a[0]) for a,o in ops if o==b"w"]; colors=[[float(v) for v in a] for a,o in ops if o==b"RG"]; close=lambda a,b: all(abs(x-y)<0.01 for x,y in zip(a,b)); assert any(abs(w-4)<0.01 for w in widths); assert any(close(c,[38/255,117/255,111/255]) for c in colors); assert sum(o==b"S" for a,o in ops)>=2; assert not p.get("/Annots")',
      output,
    ],
    { encoding: 'utf8' },
  );
  expect(inspection.status, inspection.stderr).toBe(0);
  execFileSync(
    'pdftoppm',
    ['-singlefile', '-png', '-r', '96', output, testInfo.outputPath('rendered')],
    { stdio: 'pipe' },
  );
  expect(await readFile(source)).toEqual(sourceBefore);
});

test('supported AcroForm fields fill locally with explicit interactive or flattened export', async ({
  page,
}) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/acroform-text-field.pdf'));

  await expect(page.getByRole('heading', { name: 'Fill fields' })).toBeVisible();
  await expect(page.getByText(/page organizing stays locked/i)).toBeVisible();
  await page.getByLabel('synthetic.name').fill('Fixture Reviewer');
  await page.getByLabel('synthetic.approved').check();
  await page.getByLabel('synthetic.choice: B').check();
  await page.getByLabel('synthetic.province').selectOption('QC');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Review export' }).click();
  await expect(page.getByText('Keep fields interactive')).toBeVisible();
  await page.getByRole('radio', { name: 'Flatten filled fields' }).check();
  await expect(page.getByText(/removes field editability and form semantics/i)).toBeVisible();
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('acroform-text-field-completed.pdf');
});

test('verified raster redaction removes synthetic content and hidden structures fail-closed', async ({
  page,
}, testInfo) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/redaction-markers.pdf'));

  const redact = page.getByRole('button', { name: 'Redact beta' });
  await expect(redact).toBeEnabled();
  await redact.click();
  await expect(page.getByText('Destructive privacy method')).toBeVisible();
  await page.getByRole('button', { name: 'Mark page centre' }).click();
  await expect(page.getByRole('button', { name: /Removal mark 1/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();
  const processingError = page.locator('.workspace-alert');
  await expect(processingError).toHaveCount(0);
  await page.getByRole('button', { name: 'Review permanent removal' }).click();
  const dialog = page.getByRole('dialog', { name: /Permanently remove 1 marked area/i });
  await expect(dialog).toContainText('If verification is uncertain, PDFrig returns no file.');
  await dialog.getByLabel(/marked content is permanently removed/i).check();
  await dialog.getByLabel(/accept full-document rasterization/i).check();

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Apply permanent removal' }).click();
  const outcome = await Promise.race([
    downloadPromise.then((download) => ({ download, kind: 'download' as const })),
    processingError.waitFor().then(() => ({ kind: 'error' as const })),
  ]);
  if (outcome.kind === 'error') {
    throw new Error(`Redaction worker stopped: ${await processingError.innerText()}`);
  }
  const download = outcome.download;
  expect(download.suggestedFilename()).toBe('redaction-markers-redacted.pdf');
  await expect(page.getByText(/Verified a new 1-page redacted copy/i)).toBeVisible();

  const output = await download.path();
  const qpdf =
    process.env.PDFMASON_QPDF_PATH ??
    (process.platform === 'win32' ? 'C:\\Program Files\\qpdf 12.4.0\\bin\\qpdf.exe' : 'qpdf');
  execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
  const qdf = testInfo.outputPath('redaction-output.qdf.pdf');
  execFileSync(
    qpdf,
    [output, '--qdf', '--object-streams=disable', '--stream-data=uncompress', qdf],
    {
      stdio: 'pipe',
    },
  );
  const searchable = await readFile(qdf, 'latin1');
  expect(searchable).not.toContain('M5_SECRET_BRICK_4827');
  expect(searchable).not.toMatch(/\/(?:AcroForm|EmbeddedFiles|JavaScript)\b/u);
  const extracted = execFileSync('pdftotext', [output, '-'], { encoding: 'utf8' });
  expect(extracted.trim()).toBe('');
});

test('compact workspace keeps the primary canvas within the viewport', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();

  await expect(page.getByRole('heading', { name: 'Drop in a PDF.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose a PDF' })).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf'));
  await page.getByRole('button', { exact: true, name: 'Comment' }).click();
  const reviewLedger = page.getByRole('region', { name: 'Review ledger' });
  await expect(reviewLedger).toBeVisible();
  const ledgerBox = await page.getByLabel('Comment options').boundingBox();
  expect(ledgerBox).not.toBeNull();
  expect((ledgerBox?.x ?? -1) + (ledgerBox?.width ?? 0)).toBeLessThanOrEqual(390);
  await page.getByLabel('Comment options').getByRole('button', { name: 'Close' }).click();
  await expect(reviewLedger).toBeHidden();
  await page.getByRole('button', { exact: true, name: 'Measure' }).click();
  await expect(page.getByRole('region', { name: 'Measure this page' })).toBeVisible();
  const measurementBox = await page.getByLabel('Measure options').boundingBox();
  expect((measurementBox?.x ?? -1) + (measurementBox?.width ?? 0)).toBeLessThanOrEqual(390);
  await page.getByLabel('Measure options').getByRole('button', { name: 'Close' }).click();
  const overflowsHorizontally = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowsHorizontally).toBe(false);
});

test('compact account control room does not overflow the viewport', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/account');
  await expect(
    page.getByRole('heading', { name: 'Processing you can account for.' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test('compact utility bench does not overflow the viewport', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/tools');
  await expect(page.getByRole('heading', { name: 'Compress' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
