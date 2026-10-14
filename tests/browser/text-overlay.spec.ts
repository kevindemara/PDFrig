import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');
const boxRect = (box: Locator) =>
  box.evaluate((element) => ({
    x: parseFloat((element as HTMLElement).style.left) / 100,
    y: parseFloat((element as HTMLElement).style.top) / 100,
    width: parseFloat((element as HTMLElement).style.width) / 100,
    height: parseFloat((element as HTMLElement).style.height) / 100,
  }));
const drag = async (page: Page, control: Locator, dx: number, dy: number) => {
  const bounds = await control.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds === null) throw new Error('QA_TEXT_CONTROL_MISSING');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
};

test('EDIT-001 drags and resizes text with precise geometry, single-step undo, keyboard access and verified export', async ({
  page,
}, testInfo) => {
  const before = await readFile(source);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/workspace');
  await page.getByLabel('Open PDF').setInputFiles(source);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Text box', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Drag resize proof');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const body = page.getByRole('button', { name: /^Text overlay/u });
  const box = page.locator('.text-overlay');
  const overlay = page.locator('.document-overlay');
  const start = await boxRect(box);
  const bounds = await overlay.boundingBox();
  if (bounds === null) throw new Error('QA_PAGE_GEOMETRY_MISSING');
  await drag(page, body, 37, -19);
  const moved = await boxRect(box);
  expect(moved.x).toBeCloseTo(start.x + 37 / bounds.width, 5);
  expect(moved.y).toBeCloseTo(start.y - 19 / bounds.height, 5);
  await expect(body).toHaveCount(1); // no accidental second annotation
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await boxRect(box)).toEqual(start);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await boxRect(box)).toEqual(moved);
  const corner = page.getByRole('button', { name: /^Resize text box bottom right\./u });
  await drag(page, corner, 49, 29);
  const resized = await boxRect(box);
  expect(resized.x).toBeCloseTo(moved.x, 5);
  expect(resized.y).toBeCloseTo(moved.y, 5);
  expect(resized.width).toBeCloseTo(moved.width + 49 / bounds.width, 5);
  expect(resized.height).toBeCloseTo(moved.height + 29 / bounds.height, 5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await boxRect(box)).toEqual(moved);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await boxRect(box)).toEqual(resized);
  await corner.focus();
  await corner.press('ArrowRight');
  await expect(corner).toBeFocused();
  expect((await boxRect(box)).width).toBeCloseTo(resized.width + 0.001, 5);
  await corner.press('Shift+ArrowDown');
  await expect(corner).toBeFocused();
  expect((await boxRect(box)).height).toBeCloseTo(resized.height + 0.01, 5);
  for (const handle of await page.locator('.text-resize-handle').all()) {
    const target = await handle.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(24);
    expect(target?.height).toBeGreaterThanOrEqual(24);
  }
  expect((await new AxeBuilder({ page }).include('.text-overlay').analyze()).violations).toEqual(
    [],
  );
  const final = await boxRect(box);
  await page.screenshot({ path: testInfo.outputPath('text-box-direct-controls.png') });
  await page.getByRole('button', { name: 'Review export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('text-box-edited.pdf');
  await (await download).saveAs(output);
  execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], { stdio: 'pipe' });
  execFileSync(
    process.env.PDFMASON_PYTHON_PATH ?? 'python',
    [
      '-c',
      [
        'import sys,json',
        'from pypdf import PdfReader',
        'p=PdfReader(sys.argv[1],strict=True).pages[0]; r=json.loads(sys.argv[2]); w=float(p.mediabox.width); h=float(p.mediabox.height); vertices=[]',
        'def visit(op,args,cm,tm):',
        ' if op in (b"m",b"l"):',
        '  x,y=map(float,args); vertices.append([cm[0]*x+cm[2]*y+cm[4],cm[1]*x+cm[3]*y+cm[5]])',
        'text=p.extract_text(visitor_operand_before=visit)',
        'expected=[[x*w,(1-y)*h] for x in [r["x"],r["x"]+r["width"]] for y in [r["y"],r["y"]+r["height"]]]',
        'assert all(any(all(abs(a-b)<0.02 for a,b in zip(vertex,point)) for vertex in vertices) for point in expected)',
        'assert "Drag resize proof" in text and "Synthetic page 1" in text',
      ].join('\n'),
      output,
      JSON.stringify(final),
    ],
    { stdio: 'pipe' },
  );
  execFileSync(
    'pdftoppm',
    ['-png', '-singlefile', '-r', '72', output, testInfo.outputPath('text-box-export')],
    { stdio: 'pipe' },
  );
  expect(await readFile(source)).toEqual(before);
  expect(errors).toEqual([]);
});

test('EDIT-001 cancel, zoom, rotation and page boundaries do not publish stale text-box drags', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/workspace');
  await page.getByLabel('Open PDF').setInputFiles(source);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  const body = page.getByRole('button', { name: /^Text overlay/u });
  const box = page.locator('.text-overlay');
  const start = await boxRect(box);
  const bounds = await body.boundingBox();
  if (bounds === null) throw new Error('QA_TEXT_CONTROL_MISSING');
  await page.mouse.move(bounds.x + 30, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 80, bounds.y + 50);
  await body.press('Escape');
  await page.mouse.up();
  expect(await boxRect(box)).toEqual(start);
  await page.mouse.move(bounds.x + 30, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 80, bounds.y + 50);
  await body.dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  expect(await boxRect(box)).toEqual(start);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomRect = await page.locator('.document-overlay').boundingBox();
  if (zoomRect === null) throw new Error('QA_PAGE_GEOMETRY_MISSING');
  await drag(page, body, 23, 13);
  expect((await boxRect(box)).x).toBeCloseTo(start.x + 23 / zoomRect.width, 5);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await expect(page.locator('.pdf-page-canvas')).toBeVisible();
  const rotated = await boxRect(box);
  const rotatedPage = await page.locator('.document-overlay').boundingBox();
  if (rotatedPage === null) throw new Error('QA_PAGE_GEOMETRY_MISSING');
  await drag(page, body, 17, -11);
  expect((await boxRect(box)).x).toBeCloseTo(rotated.x + 17 / rotatedPage.width, 5);
  expect((await boxRect(box)).y).toBeCloseTo(rotated.y - 11 / rotatedPage.height, 5);
  await drag(page, body, 2000, -2000);
  const edge = await boxRect(box);
  expect(edge.x + edge.width).toBeCloseTo(1, 5);
  expect(edge.y).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(body).toHaveCount(1);
});
