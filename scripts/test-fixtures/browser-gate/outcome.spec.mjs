import { expect, test } from '@playwright/test';

test('clean outcome', () => {
  expect(true).toBe(true);
});
test('retry-dependent outcome', () => {
  expect(test.info().retry).toBeGreaterThan(0);
});
test('persistent failure outcome', () => {
  expect(false).toBe(true);
});
