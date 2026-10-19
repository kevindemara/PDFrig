import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('VIEW-001 file entry points wait for hydration instead of losing an early selection', async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/u, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/workspace', { waitUntil: 'commit' });
    await expect(page.getByLabel('Open PDF')).toBeAttached();
    await expect(page.getByLabel('Open PDF')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Choose a PDF' })).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .getByLabel('Open PDF')
    .setInputFiles('packages/test-corpus/fixtures/smoke-one-page.pdf');
  await expect(page.getByLabel('Rendered page 1')).toBeVisible();
});
import path from 'node:path';

const fixture = path.resolve('packages/test-corpus/fixtures/smoke-one-page.pdf');

test('VIEW-001 VIEW-004 Pages options collapse independently without losing navigation or text edits', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/multipage-three.pdf'));
  const panel = page.locator('.context-panel');
  const pages = page.getByRole('list', { name: 'Page thumbnails' });
  await pages.getByRole('button', { name: 'Page 2', exact: true }).click();
  const canvas = page.locator('.document-stage');
  const before = await canvas.boundingBox();
  expect((await panel.boundingBox())?.width).toBe(160);
  const collapse = page.getByRole('button', { name: 'Collapse tool options' });
  await collapse.focus();
  await collapse.press('Enter');
  const expand = page.getByRole('button', { name: 'Expand tool options' });
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(pages).toBeHidden();
  expect((await panel.boundingBox())?.width).toBe(52);
  expect((await canvas.boundingBox())?.width).toBeGreaterThanOrEqual((before?.width ?? 0) + 108);
  await expect(page.getByLabel('Rendered page 2')).toBeVisible();
  await expect(page.getByLabel('Document status')).toContainText('Original unchanged');
  await page.getByRole('button', { name: 'Collapse tools' }).click();
  expect((await page.locator('.tool-rail').boundingBox())?.width).toBe(64);
  expect((await panel.boundingBox())?.width).toBe(52);
  expect((await new AxeBuilder({ page }).include('.context-panel').analyze()).violations).toEqual(
    [],
  );
  await page.screenshot({ path: testInfo.outputPath('collapsed-pages-and-tools.png') });
  await expand.press('Enter');
  await expect(pages.getByRole('button', { name: 'Page 2', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await panel.getByRole('button', { name: 'Collapse tool options' }).click();
  const rail = page.getByRole('navigation', { name: 'Editor tools' });
  await rail.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.getByLabel('Add text options')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse tool options' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Kept while panels collapse');
  await page.getByRole('button', { name: 'Collapse tool options' }).click();
  await expect(page.getByRole('button', { name: /^Text overlay/u })).toContainText(
    'Kept while panels collapse',
  );
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(
    'Kept while panels collapse',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Type here');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(
    'Kept while panels collapse',
  );
  await rail.getByRole('button', { name: 'Pages', exact: true }).click();
  await pages.getByRole('button', { name: 'Page 3', exact: true }).focus();
  await pages.getByRole('button', { name: 'Page 3', exact: true }).press('Enter');
  await expect(page.getByLabel('Rendered page 3')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse tool options' }).click();
  await page.setViewportSize({ width: 1024, height: 900 });
  expect((await panel.boundingBox())?.width).toBe(52);
  await page.getByRole('button', { name: 'Expand tool options' }).click();
  expect((await panel.boundingBox())?.width).toBe(160);
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(panel).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(pages.getByRole('button', { name: 'Page 3', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('VIEW-001 VIEW-004 tool icons retain labels, keyboard selection and capability gates', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  const rail = page.getByRole('navigation', { name: 'Editor tools' });
  const buttons = rail.locator('li button');
  await expect(buttons).toHaveCount(14);
  for (const button of await buttons.all()) {
    await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(button.locator('svg')).toHaveAttribute('focusable', 'false');
    await expect(button.locator('.tool-glyph')).toHaveText('');
  }
  await expect(rail.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await page.getByLabel('Open PDF').setInputFiles(fixture);
  const text = rail.getByRole('button', { name: 'Text', exact: true });
  await expect(text).toBeEnabled();
  await text.focus();
  await text.press('Enter');
  await expect(text).toHaveAttribute('aria-current', 'true');
  await expect(page.getByLabel('Add text options')).toBeVisible();
  await expect(page.locator('svg[data-tool-icon="text"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Place at page centre' }).click();
  await expect(page.getByRole('heading', { name: 'Text overlay' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: /Text overlay.*Arrow keys move it/u })).toHaveCount(
    0,
  );

  await expect(rail).toMatchAriaSnapshot(`
    - navigation "Editor tools":
      - paragraph: Tools
      - button "Collapse tools" [expanded]
      - list:
        - listitem:
          - button "Open"
        - listitem:
          - button "Pages"
        - listitem:
          - button "Text"
        - listitem:
          - button "Markup"
        - listitem:
          - button "Draw"
        - listitem:
          - button "Shapes"
        - listitem:
          - button "Comment"
        - listitem:
          - button "Measure"
        - listitem:
          - button "Stamp"
        - listitem:
          - button "Fill"
        - listitem:
          - button "Sign"
        - listitem:
          - button "Redact beta"
        - listitem:
          - button "PDF"
        - listitem:
          - button "Image"
  `);
  const accessibility = await new AxeBuilder({ page })
    .include('.tool-rail')
    .include('.context-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('pdfrig-tools-desktop.png') });

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Starting another PDF clears working changes');
    await dialog.accept();
  });
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/embedded-javascript.pdf'));
  await expect(text).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled();
});

test('VIEW-001 tool panels fit desktop, tablet, mobile and enlarged text with visible high-contrast selection', async ({
  page,
}) => {
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page.getByLabel('Open PDF').setInputFiles(fixture);
  const rail = page.getByRole('navigation', { name: 'Editor tools' });
  await expect(rail.getByRole('button', { name: 'Text', exact: true })).toBeEnabled();
  for (const width of [1440, 1280, 1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      railWidth: document.querySelector('.tool-rail')?.getBoundingClientRect().width ?? 0,
      panelWidth: document.querySelector('.context-panel')?.getBoundingClientRect().width ?? 0,
    }));
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewport);
    if (width >= 768) {
      expect(layout.railWidth).toBeGreaterThanOrEqual(144);
      expect(layout.panelWidth).toBeGreaterThanOrEqual(148);
      expect(layout.panelWidth).toBeLessThanOrEqual(176);
    }
    const image = rail.getByRole('button', { name: 'Image', exact: true });
    await image.scrollIntoViewIfNeeded();
    const bounds = await image.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const oversizedText = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  expect(oversizedText.width).toBeLessThanOrEqual(oversizedText.viewport);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  const text = rail.getByRole('button', { name: 'Text', exact: true });
  await text.focus();
  await text.press('Enter');
  await expect(text).toHaveAttribute('aria-current', 'true');
  await expect
    .poll(() =>
      text.locator('..').evaluate((element) => ({
        tag: element.tagName,
        selected: element.classList.contains('is-current'),
        outlineStyle: getComputedStyle(element).outlineStyle,
        outlineWidth: getComputedStyle(element).outlineWidth,
      })),
    )
    .toEqual({ tag: 'LI', selected: true, outlineStyle: 'solid', outlineWidth: '2px' });
});

test('VIEW-001 VIEW-004 compact Pages and collapsible tools return space to the document without losing state', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');
  await expect(page.getByLabel('Open PDF')).toBeEnabled();
  await page
    .getByLabel('Open PDF')
    .setInputFiles(path.resolve('packages/test-corpus/fixtures/multipage-three.pdf'));
  const rail = page.getByRole('navigation', { name: 'Editor tools' });
  const thumbnails = page.getByRole('list', { name: 'Page thumbnails' });
  await thumbnails.getByRole('button', { name: 'Page 2', exact: true }).click();
  await expect(page.getByLabel('Rendered page 2')).toBeVisible();
  const canvas = page.locator('.document-stage');
  const before = await canvas.boundingBox();
  const collapse = rail.getByRole('button', { name: 'Collapse tools' });
  await collapse.focus();
  await collapse.press('Enter');
  const expand = rail.getByRole('button', { name: 'Expand tools' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(expand).toBeFocused();
  expect((await rail.boundingBox())?.width).toBe(64);
  expect((await page.locator('.context-panel').boundingBox())?.width).toBe(160);
  const after = await canvas.boundingBox();
  expect(after?.width).toBeGreaterThanOrEqual((before?.width ?? 0) + 88);
  await expect(thumbnails.getByRole('button', { name: 'Page 2', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByLabel('Document status')).toContainText('Original unchanged');
  const text = rail.getByRole('button', { name: 'Text', exact: true });
  await expect(text).toHaveAttribute('title', 'Text');
  const target = await text.boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(target?.height).toBeGreaterThanOrEqual(44);
  await text.focus();
  await text.press('Enter');
  await expect(text).toHaveAttribute('aria-current', 'true');
  expect((await page.locator('.context-panel').boundingBox())?.width).toBeGreaterThanOrEqual(260);
  await rail.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.getByLabel('Rendered page 2')).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('.tool-rail')
    .include('.context-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('pdfrig-collapsed-tools.png') });
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(expand).toBeHidden();
  // The horizontal compact rail keeps labels even if desktop was collapsed.
  const label = rail.getByRole('button', { name: 'Text', exact: true }).locator('.tool-label');
  expect(await label.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(
    1,
  );
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(expand).toBeVisible();
  expect((await rail.boundingBox())?.width).toBe(64);
  expect((await page.locator('.context-panel').boundingBox())?.width).toBe(160);
  await expand.focus();
  await expand.press('Enter');
  await expect(rail.getByRole('button', { name: 'Collapse tools' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect((await rail.boundingBox())?.width).toBe(144);
  await expect(page.getByLabel('Rendered page 2')).toBeVisible();
});
