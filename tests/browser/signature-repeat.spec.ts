import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const addSignature = async (page: Page, fixture: string): Promise<void> => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await page.getByLabel('Type your signature').fill('Synthetic Repeat');
  await page.getByRole('button', { name: 'Place visual signature' }).click();
  await expect(
    page.getByRole('button', { name: 'Copy selected signature to other pages' }),
  ).toBeEnabled();
};
const exportCopy = async (page: Page, output: string): Promise<void> => {
  await page.getByRole('button', { name: 'Review export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export completed copy' }).click();
  await (await download).saveAs(output);
};

for (const fixtureName of ['mixed-page-sizes.pdf', 'rotated-pages.pdf']) {
  test(`SIGN-003 reviews each ${fixtureName} placement and exports immutable, undoable copies`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 900, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const source = path.resolve(`packages/test-corpus/fixtures/${fixtureName}`);
    const original = await readFile(source);
    await addSignature(page, source);
    const copy = page.getByRole('button', { name: 'Copy selected signature to other pages' });
    await copy.click();
    const dialog = page.getByRole('dialog', { name: 'Review signature copies' });
    await dialog.getByLabel(/Destination pages/u).fill('2-3');
    await dialog.getByRole('button', { name: 'Build placement preview' }).click();
    const apply = dialog.getByRole('button', { name: 'Apply reviewed signature copies' });
    const first = dialog.getByLabel('I reviewed the placement on page 2');
    await expect(first).toBeEnabled({ timeout: 20_000 });
    await expect(apply).toBeDisabled();
    // The real worker output, not an overlay placeholder, must contain visible ink
    // in the copied mark's normalized rectangle on each rendered destination.
    const assertPlacementInk = async () => {
      expect(
        await dialog
          .locator('.signature-repeat-preview')
          .evaluate((element) => element.getBoundingClientRect().height),
      ).toBeGreaterThan(160);
      expect(
        await dialog.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
          const context = canvas.getContext('2d');
          if (context === null) return 0;
          const pixels = context.getImageData(
            Math.floor(canvas.width * 0.5),
            Math.floor(canvas.height * 0.76),
            Math.floor(canvas.width * 0.36),
            Math.floor(canvas.height * 0.09),
          ).data;
          let ink = 0;
          for (let offset = 0; offset < pixels.length; offset += 4)
            if (
              (pixels[offset] ?? 255) < 180 &&
              (pixels[offset + 1] ?? 255) < 180 &&
              (pixels[offset + 2] ?? 255) < 180
            )
              ink += 1;
          return ink;
        }),
      ).toBeGreaterThan(40);
    };
    await assertPlacementInk();
    await first.check();
    await expect(apply).toBeDisabled();
    await dialog.getByRole('button', { name: 'Next destination' }).click();
    const second = dialog.getByLabel('I reviewed the placement on page 3');
    await expect(second).toBeEnabled();
    await assertPlacementInk();
    await expect(apply).toBeDisabled();
    await second.check();
    await expect(apply).toBeEnabled();
    expect(
      (
        await new AxeBuilder({ page })
          .include('.signature-repeat-dialog')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await dialog.screenshot({ path: testInfo.outputPath('signature-review.png') });
    await apply.click();
    await expect(dialog).toHaveCount(0);
    const output = testInfo.outputPath('signature-copies.pdf');
    await exportCopy(page, output);
    const qpdf = process.env.PDFMASON_QPDF_PATH ?? 'qpdf';
    execFileSync(qpdf, ['--check', output], { stdio: 'pipe' });
    execFileSync(
      process.env.PDFMASON_PYTHON_PATH ?? 'python',
      [
        '-c',
        'import sys; from pypdf import PdfReader; a,b=map(PdfReader,sys.argv[1:]); assert len(a.pages)==len(b.pages); assert [(list(p.mediabox),list(p.cropbox),p.rotation) for p in a.pages]==[(list(p.mediabox),list(p.cropbox),p.rotation) for p in b.pages]; assert a.metadata==b.metadata; assert all((p.extract_text() or "").count("Synthetic Repeat")==int(i<3) for i,p in enumerate(b.pages))',
        source,
        output,
      ],
      { stdio: 'pipe' },
    );
    execFileSync(
      'pdftoppm',
      [
        '-f',
        '2',
        '-l',
        '3',
        '-scale-to',
        '800',
        '-png',
        output,
        testInfo.outputPath('signature-independent'),
      ],
      { stdio: 'pipe' },
    );
    await page.keyboard.press('ControlOrMeta+z');
    const undone = testInfo.outputPath('signature-undone.pdf');
    await exportCopy(page, undone);
    const text = execFileSync('pdftotext', [undone, '-'], { encoding: 'utf8' });
    expect(text.match(/Synthetic Repeat/gu)).toHaveLength(1);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    const redone = testInfo.outputPath('signature-redone.pdf');
    await exportCopy(page, redone);
    expect(
      execFileSync('pdftotext', [redone, '-'], { encoding: 'utf8' }).match(/Synthetic Repeat/gu),
    ).toHaveLength(3);
    expect(await readFile(source)).toEqual(original);
    expect(errors).toEqual([]);
  });
}

test('SIGN-003 cancellation and invalid destinations never add or save marks', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await addSignature(page, path.resolve('packages/test-corpus/fixtures/multipage-three.pdf'));
  const copy = page.getByRole('button', { name: 'Copy selected signature to other pages' });
  await copy.click();
  const dialog = page.getByRole('dialog', { name: 'Review signature copies' });
  await dialog.getByLabel(/Destination pages/u).fill('1,2');
  await dialog.getByRole('button', { name: 'Build placement preview' }).click();
  await expect(dialog.getByRole('alert')).toContainText('No copies were added');
  await dialog.getByLabel(/Destination pages/u).fill('2-3');
  await dialog.getByRole('button', { name: 'Build placement preview' }).click();
  await expect(dialog.getByLabel('I reviewed the placement on page 2')).toBeEnabled({
    timeout: 20_000,
  });
  await dialog.getByLabel('I reviewed the placement on page 2').check();
  await dialog.getByLabel(/Destination pages/u).fill('3');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Apply reviewed signature copies' }),
  ).toBeDisabled();
  await dialog.screenshot({ path: testInfo.outputPath('signature-compact-review.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Keep current signatures' }).click();
  await expect(copy).toBeFocused();
  const output = testInfo.outputPath('cancelled-signature-copy.pdf');
  await exportCopy(page, output);
  expect(
    execFileSync('pdftotext', [output, '-'], { encoding: 'utf8' }).match(/Synthetic Repeat/gu),
  ).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      Object.entries(localStorage).some(([key, value]) =>
        /signature|Synthetic Repeat/iu.test(key + String(value)),
      ),
    ),
  ).toBe(false);
});
