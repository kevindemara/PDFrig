import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const fixture = (name: string) => path.resolve('packages/test-corpus/fixtures', name);

test('VIEW-008 selects and copies source text locally across zoom, rotation and page changes', async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors: string[] = [];
  const contentRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('request', (request) => {
    if (request.postData()?.includes('Synthetic page')) contentRequests.push(request.method());
  });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(fixture('rotated-pages.pdf'));
  const layer = page.getByRole('region', { name: 'Selectable PDF text' });
  await expect(layer).toContainText('Synthetic page 1');
  await layer.focus();
  await layer.press('Control+a');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain(
    'Synthetic page 1',
  );
  await layer.press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Synthetic page 1');
  await page.getByRole('button', { name: 'Actual size (100%)' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(layer).toContainText('Synthetic page 1');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(layer).toHaveAttribute('tabindex', '-1');
  await page.getByRole('button', { name: 'Select text', exact: true }).click();
  await expect(layer).toHaveAttribute('tabindex', '0');
  for (let index = 0; index < 4; index += 1) {
    await expect(layer).toContainText(`Synthetic page ${index + 1}`);
    const span = layer
      .locator('span')
      .filter({ hasText: `Synthetic page ${index + 1}` })
      .first();
    const textBounds = await span.boundingBox();
    const canvasBounds = await page.locator('.pdf-page-canvas').boundingBox();
    if (textBounds === null || canvasBounds === null) throw new Error('QA_TEXT_LAYER_MISSING');
    expect(textBounds.x).toBeGreaterThanOrEqual(canvasBounds.x - 1);
    expect(textBounds.y).toBeGreaterThanOrEqual(canvasBounds.y - 1);
    expect(textBounds.x + textBounds.width).toBeLessThanOrEqual(
      canvasBounds.x + canvasBounds.width + 1,
    );
    expect(textBounds.y + textBounds.height).toBeLessThanOrEqual(
      canvasBounds.y + canvasBounds.height + 1,
    );
    // Synthetic corpus baseline is (54, pageHeight-94) PDF points. Verify its
    // transformed position is inside the actual DOM text bounds, not just the page.
    const zoom = 1.1;
    const position =
      index === 0
        ? [54, 94]
        : index === 1
          ? [792 - 94, 54]
          : index === 2
            ? [612 - 54, 792 - 94]
            : [94, 612 - 54];
    const x = canvasBounds.x + (position[0] ?? 0) * zoom;
    const y = canvasBounds.y + (position[1] ?? 0) * zoom;
    expect(x).toBeGreaterThanOrEqual(textBounds.x - 2);
    expect(x).toBeLessThanOrEqual(textBounds.x + textBounds.width + 2);
    expect(y).toBeGreaterThanOrEqual(textBounds.y - 2);
    expect(y).toBeLessThanOrEqual(textBounds.y + textBounds.height + 2);
    await layer.focus();
    await layer.press('Control+a');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toContain(
      `Synthetic page ${index + 1}`,
    );
    await page.screenshot({ path: testInfo.outputPath(`selectable-rotation-${index}.png`) });
    if (index < 3) await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  expect(errors).toEqual([]);
  expect(contentRequests).toEqual([]);
});

test('VIEW-008 explains image-only scans without fabricating text or uploading them', async ({
  page,
}) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(fixture('scanned-ocr.pdf'));
  await expect(page.locator('.pdf-text-status')).toContainText(
    'OCR is needed for image-only scans',
  );
  await expect(page.locator('.pdf-text-layer span')).toHaveCount(0);
});

for (const rotation of [0, 90, 180, 270] as const) {
  test(`EDIT-001 preview and independent export agree on crop, font, lines and baselines at rotation ${rotation}`, async ({
    page,
  }, testInfo) => {
    const source = fixture('cropped-page.pdf');
    const before = await readFile(source);
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto('/workspace');
    await expect(page.getByLabel('Open PDF')).toBeEnabled();
    await page.getByLabel('Open PDF').setInputFiles(source);
    for (let turn = 0; turn < rotation / 90; turn += 1)
      await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByRole('button', { name: 'Place at page centre' }).click();
    await page
      .getByRole('textbox', { name: 'Text', exact: true })
      .fill('Preview export exact wrapped layout\nSecond line');
    await page.getByLabel('Font size (pt)').fill('16');
    await page.getByLabel('Height %', { exact: true }).fill('30');
    await page.getByLabel('Text alignment').selectOption('center');
    await expect(page.locator('.text-overlay__preview text')).toHaveCount(3);
    const preview = await page.locator('.text-overlay').evaluate((element) => {
      const box = element as HTMLElement;
      const svg = box.querySelector('svg');
      if (svg === null) throw new Error('QA_PREVIEW_MISSING');
      const view = svg.viewBox.baseVal;
      return {
        x: parseFloat(box.style.left) / 100,
        y: parseFloat(box.style.top) / 100,
        width: view.width,
        height: view.height,
        lines: Array.from(svg.querySelectorAll('text')).map((line) => ({
          text: line.textContent,
          x: Number(line.getAttribute('x')),
          baseline: Number(line.getAttribute('y')),
          size: Number(line.getAttribute('font-size')),
          width: Number(line.getAttribute('textLength')),
        })),
      };
    });
    expect(preview.lines.map((line) => line.size)).toEqual([16, 16, 16]);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.locator('.text-overlay__preview text').first()).toHaveAttribute(
      'font-size',
      '16',
    );
    await page.screenshot({ path: testInfo.outputPath(`text-preview-${rotation}.png`) });
    await page.getByRole('button', { name: 'Review export' }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export completed copy' }).click();
    const output = testInfo.outputPath(`text-fidelity-${rotation}.pdf`);
    await (await pending).saveAs(output);
    execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], { stdio: 'pipe' });
    execFileSync(
      process.env.PDFMASON_PYTHON_PATH ?? 'python',
      [
        '-c',
        [
          'import sys,json,math',
          'from pypdf import PdfReader',
          'p=PdfReader(sys.argv[1],strict=True).pages[0]; v=json.loads(sys.argv[2]); rot=int(sys.argv[3]); c=p.cropbox; cw=float(c.width); ch=float(c.height); dw=ch if rot%180 else cw; dh=cw if rot%180 else ch; found=[]',
          'def visit(text,cm,tm,font,size):',
          ' if text.strip() and font and font.get("/BaseFont")=="/Helvetica": found.append((text.rstrip("\\n"),tm,float(size)))',
          'p.extract_text(visitor_text=visit)',
          'for line in v["lines"]:',
          ' matches=[item for item in found if item[0]==line["text"]]; assert len(matches)==1, (line["text"],found)',
          ' text,tm,size=matches[0]; x=v["x"]*dw+line["x"]; y=v["y"]*dh+line["baseline"]',
          ' point=(x,ch-y) if rot==0 else (y,x) if rot==90 else (cw-x,y) if rot==180 else (cw-y,ch-x)',
          ' assert abs(size-line["size"])<0.001',
          ' assert abs(tm[4]-float(c.left)-point[0])<0.02 and abs(tm[5]-float(c.bottom)-point[1])<0.02, (tm,point)',
          ' assert abs(tm[0]-math.cos(math.radians(rot)))<0.001 and abs(tm[1]-math.sin(math.radians(rot)))<0.001',
        ].join('\n'),
        output,
        JSON.stringify(preview),
        String(rotation),
      ],
      { stdio: 'pipe' },
    );
    execFileSync(
      'pdftoppm',
      [
        '-png',
        '-singlefile',
        '-cropbox',
        '-r',
        '72',
        output,
        testInfo.outputPath(`text-export-${rotation}`),
      ],
      { stdio: 'pipe' },
    );
    expect(await readFile(source)).toEqual(before);
  });
}
