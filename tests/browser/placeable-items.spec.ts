import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');
const readRect = (box: Locator) =>
  box.evaluate((node) => {
    const style = (node as HTMLElement).style;
    return {
      x: parseFloat(style.left) / 100,
      y: parseFloat(style.top) / 100,
      width: parseFloat(style.width) / 100,
      height: parseFloat(style.height) / 100,
    };
  });
const drag = async (page: Page, control: Locator, dx: number, dy: number) => {
  const bounds = await control.boundingBox();
  if (bounds === null) throw new Error('QA_PLACEABLE_CONTROL_MISSING');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
};
const open = async (page: Page) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(source);
  await expect(page.getByLabel('Rendered page 1')).toBeVisible();
};
for (const item of [
  { rail: 'Markup', option: 'Highlight area', name: 'highlight markup' },
  { rail: 'Markup', option: 'Underline area', name: 'underline markup' },
  { rail: 'Markup', option: 'Strike out area', name: 'strikeout markup' },
  { rail: 'Shapes', option: 'Rectangle', name: 'rectangle' },
  { rail: 'Shapes', option: 'Ellipse', name: 'ellipse' },
  { rail: 'Shapes', option: 'Line', name: 'line' },
  { rail: 'Shapes', option: 'Arrow', name: 'arrow' },
  { rail: 'Draw', option: 'Freehand', name: 'Freehand drawing' },
  { rail: 'Comment', option: null, name: 'Comment' },
] as const) {
  test(`ANNO-001–006 ${item.name} direct drag/resize preserves single-step history and keyboard controls`, async ({
    page,
  }) => {
    await open(page);
    await page
      .getByRole('navigation', { name: 'Editor tools' })
      .getByRole('button', { name: item.rail, exact: true })
      .click();
    if (item.option !== null)
      await page
        .locator('.tool-options')
        .getByRole('button', { name: item.option, exact: true })
        .click();
    await page
      .getByRole('button', {
        name: item.rail === 'Comment' ? 'Place comment at page centre' : 'Place at page centre',
        exact: true,
      })
      .click();
    const body = page.getByRole('button', { name: new RegExp(`^${item.name}\\. Drag`, 'u') });
    const box = body.locator('..');
    const start = await readRect(box);
    const pageBounds = await page.locator('.document-overlay').boundingBox();
    if (pageBounds === null) throw new Error('QA_PAGE_MISSING');
    await drag(page, body, 17, -13);
    const moved = await readRect(box);
    expect(moved.x).toBeCloseTo(start.x + 17 / pageBounds.width, 5);
    expect(moved.y).toBeCloseTo(start.y - 13 / pageBounds.height, 5);
    await expect(page.locator('.placeable-overlay')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await readRect(box)).toEqual(start);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await readRect(box)).toEqual(moved);
    const corner = page.getByRole('button', { name: /Resize .* bottom right\./u });
    await drag(page, corner, 19, 11);
    const resized = await readRect(box);
    expect(resized.width).toBeCloseTo(moved.width + 19 / pageBounds.width, 5);
    expect(resized.height).toBeCloseTo(moved.height + 11 / pageBounds.height, 5);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await readRect(box)).toEqual(moved);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await readRect(box)).toEqual(resized);
    await corner.focus();
    await corner.press('ArrowRight');
    expect((await readRect(box)).width).toBeCloseTo(resized.width + 0.001, 5);
    await expect(corner).toBeFocused();
    expect(
      (await new AxeBuilder({ page }).include('.placeable-overlay').analyze()).violations,
    ).toEqual([]);
    await body.focus();
    await body.press('Delete');
    await expect(page.locator('.placeable-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(body).toHaveCount(1);
  });
}

test('ANNO-003 live stroke preview follows every point before release, cancels safely, and exports moved/resized geometry', async ({
  page,
}, testInfo) => {
  const before = await readFile(source);
  await open(page);
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const overlay = page.locator('.document-overlay');
  const bounds = await overlay.boundingBox();
  if (bounds === null) throw new Error('QA_PAGE_MISSING');
  const x = bounds.x + bounds.width * 0.3;
  const y = bounds.y + bounds.height * 0.35;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 50, y - 25, { steps: 4 });
  const preview = page.locator('.annotation-placement-preview');
  const first = await preview.locator('path').getAttribute('d');
  expect(first).toContain('M');
  await page.mouse.move(x + 100, y + 35, { steps: 4 });
  expect(await preview.locator('path').getAttribute('d')).not.toEqual(first);
  await expect(page.locator('.annotation-draft')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.placeable-overlay')).toHaveCount(0);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 50, y - 25, { steps: 4 });
  await page.mouse.move(x + 100, y + 35, { steps: 4 });
  await page.screenshot({ path: testInfo.outputPath('live-ink-preview.png') });
  await page.mouse.up();
  const body = page.getByRole('button', { name: /^Freehand drawing\./u });
  await expect(body).toHaveCount(1);
  await expect(preview).toHaveCount(0);
  await drag(page, body, 23, 17);
  await drag(page, page.getByRole('button', { name: /Resize .* bottom right\./u }), 31, 29);
  const final = await readRect(body.locator('..'));
  await page.getByRole('button', { name: 'Review export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('direct-ink.pdf');
  await (await download).saveAs(output);
  execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], { stdio: 'pipe' });
  execFileSync(
    process.env.PDFMASON_PYTHON_PATH ?? 'python',
    [
      '-c',
      [
        'import sys,json; from pypdf import PdfReader',
        'p=PdfReader(sys.argv[1],strict=True).pages[0]; r=json.loads(sys.argv[2]); vertices=[]',
        'def visit(op,args,cm,tm):',
        ' if op in (b"m",b"l"):',
        '  x,y=map(float,args); vertices.append([cm[0]*x+cm[2]*y+cm[4],cm[1]*x+cm[3]*y+cm[5]])',
        'text=p.extract_text(visitor_operand_before=visit)',
        'w=float(p.mediabox.width); h=float(p.mediabox.height)',
        'assert "Synthetic page 1" in text',
        'xs=[x/w for x,y in vertices]; ys=[1-y/h for x,y in vertices]',
        'assert abs(min(xs)-r["x"])<0.00001 and abs(max(xs)-r["x"]-r["width"])<0.00001',
        'assert abs(min(ys)-r["y"])<0.00001 and abs(max(ys)-r["y"]-r["height"])<0.00001',
      ].join('\n'),
      output,
      JSON.stringify(final),
    ],
    { stdio: 'pipe' },
  );
  execFileSync(
    'pdftoppm',
    ['-png', '-singlefile', '-r', '72', output, testInfo.outputPath('direct-ink')],
    { stdio: 'pipe' },
  );
  expect(await readFile(source)).toEqual(before);
});

test('SIGN-001 script signature previews the embedded font and remains draggable/resizable with verified local export', async ({
  page,
}, testInfo) => {
  const before = await readFile(source);
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('request', (request) => requests.push(request.url()));
  await open(page);
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await page.getByLabel('Type your signature').fill('Synthetic Signature');
  await expect(
    page.locator('.signature-typed-preview [data-signature-font="Dancing Script"]'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Place visual signature' }).click();
  const body = page.getByRole('button', { name: /^Visual signature\./u });
  await expect(body.locator('[data-signature-font="Dancing Script"]')).toBeVisible();
  await drag(page, body, -71, -39);
  await drag(page, page.getByRole('button', { name: /Resize .* bottom right\./u }), 41, 19);
  await expect(body.locator('[data-signature-font="Dancing Script"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('script-signature-editor.png') });
  await page.getByRole('button', { name: 'Review export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  const output = testInfo.outputPath('script-signature.pdf');
  await (await download).saveAs(output);
  execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], { stdio: 'pipe' });
  execFileSync(
    process.env.PDFMASON_PYTHON_PATH ?? 'python',
    [
      '-c',
      [
        'import sys; from pypdf import PdfReader',
        'p=PdfReader(sys.argv[1],strict=True).pages[0]; assert "Synthetic Signature" in p.extract_text()',
        'fonts=[f.get_object() for f in p["/Resources"]["/Font"].values()]',
        'script=[f for f in fonts if "DancingScript" in str(f.get("/BaseFont"))]; assert script',
        'assert script[0]["/DescendantFonts"][0].get_object()["/FontDescriptor"].get_object()["/FontFile2"].get_data()',
      ].join('\n'),
      output,
    ],
    { stdio: 'pipe' },
  );
  execFileSync(
    'pdftoppm',
    ['-png', '-singlefile', '-r', '72', output, testInfo.outputPath('script-signature')],
    { stdio: 'pipe' },
  );
  expect(
    requests.every((url) => url.startsWith('http://127.0.0.1:3100') || url.startsWith('blob:')),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(await readFile(source)).toEqual(before);
});

for (const kind of ['stamp', 'date', 'checkmark', 'drawn', 'image'] as const) {
  test(`ANNO-006 SIGN-001/002 ${kind} uses direct controls and retains its real appearance`, async ({
    page,
  }, testInfo) => {
    await open(page);
    if (kind === 'stamp') {
      await page.getByRole('button', { name: 'Stamp', exact: true }).click();
      if (!(await page.getByRole('button', { name: 'Place stamp', exact: true }).isVisible()))
        await page.getByRole('button', { name: 'Choose stamp', exact: true }).click();
      await page.getByRole('button', { name: 'Place stamp', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Sign', exact: true }).click();
      if (kind === 'date' || kind === 'checkmark') {
        await page.getByRole('button', { name: 'Close visual signature dialog' }).click();
        await page
          .getByRole('button', {
            name: kind === 'date' ? 'Today’s date' : 'Checkmark',
            exact: true,
          })
          .click();
        await page.getByRole('button', { name: 'Place at page centre', exact: true }).click();
      } else if (kind === 'drawn') {
        await page.getByRole('tab', { name: 'Drawn', exact: true }).click();
        const pad = await page.getByLabel('Draw visual signature').boundingBox();
        if (pad === null) throw new Error('QA_PAD_MISSING');
        await page.mouse.move(pad.x + pad.width * 0.1, pad.y + pad.height * 0.7);
        await page.mouse.down();
        await page.mouse.move(pad.x + pad.width * 0.4, pad.y + pad.height * 0.2, { steps: 4 });
        await page.mouse.move(pad.x + pad.width * 0.9, pad.y + pad.height * 0.6, { steps: 4 });
        await page.mouse.up();
        await page.getByRole('button', { name: 'Place visual signature' }).click();
      } else {
        await page.getByRole('tab', { name: 'Upload', exact: true }).click();
        await page
          .getByLabel('Upload a PNG or JPEG (5 MB maximum)')
          .setInputFiles(
            path.resolve('packages/test-corpus/fixtures/images/quadrants-orientation-6.png'),
          );
        await page.getByRole('button', { name: 'Place visual signature' }).click();
      }
    }
    const body = page.locator('.placeable-overlay > .annotation-item');
    const box = body.locator('..');
    const start = await readRect(box);
    if (kind === 'drawn') await expect(body.locator('svg line')).not.toHaveCount(0);
    if (kind === 'image')
      await expect(body.locator('svg image')).toHaveAttribute('href', /^blob:/u);
    await drag(page, body, -37, -19);
    const moved = await readRect(box);
    expect(moved.x).toBeLessThan(start.x);
    expect(moved.y).toBeLessThan(start.y);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await readRect(box)).toEqual(start);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await readRect(box)).toEqual(moved);
    await drag(page, page.getByRole('button', { name: /Resize .* bottom right\./u }), 23, 17);
    expect((await readRect(box)).width).toBeGreaterThan(moved.width);
    await expect(body).toHaveCount(1);
    if (kind === 'image')
      await expect(body.locator('svg image')).toHaveAttribute('href', /^blob:/u);
    await page.screenshot({ path: testInfo.outputPath(`direct-${kind}.png`) });
    await page.getByRole('button', { name: 'Review export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export completed copy' }).click();
    const output = testInfo.outputPath(`direct-${kind}.pdf`);
    await (await download).saveAs(output);
    execFileSync(process.env.PDFMASON_QPDF_PATH ?? 'qpdf', ['--check', output], { stdio: 'pipe' });
    execFileSync(
      'pdftoppm',
      ['-png', '-singlefile', '-r', '72', output, testInfo.outputPath(`export-${kind}`)],
      { stdio: 'pipe' },
    );
  });
}

test('ANNO-004 reverse-direction arrow placement shows its actual vector before release', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.locator('.tool-options').getByRole('button', { name: 'Arrow', exact: true }).click();
  const bounds = await page.locator('.document-overlay').boundingBox();
  if (bounds === null) throw new Error('QA_PAGE_MISSING');
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.6, {
    steps: 5,
  });
  const line = page.locator('.annotation-placement-preview line').first();
  expect(Number(await line.getAttribute('x1'))).toBeGreaterThan(
    Number(await line.getAttribute('x2')),
  );
  expect(Number(await line.getAttribute('y1'))).toBeLessThan(Number(await line.getAttribute('y2')));
  await expect(page.locator('.placeable-overlay')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.placeable-overlay')).toHaveCount(1);
  const final = page.locator('.annotation-item--shape line').first();
  expect(Number(await final.getAttribute('x1'))).toBeGreaterThan(
    Number(await final.getAttribute('x2')),
  );
});
