import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { FixtureManifest, ImageFixtureManifest } from './index.js';

describe('synthetic PDF corpus', () => {
  it('keeps the realistic OCR scan manifest-backed without redistributing a font program', async () => {
    const directory = new URL('../fixtures/sources/', import.meta.url);
    const manifest = JSON.parse(
      await readFile(new URL('scanned-ocr.manifest.json', directory), 'utf8'),
    ) as {
      expectedText: string;
      fontProgramBundled: boolean;
      license: string;
      sensitivity: string;
      sha256: string;
    };
    const bytes = await readFile(new URL('scanned-ocr.png', directory));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(1667);
    expect(bytes.readUInt32BE(20)).toBe(500);
    expect(manifest.expectedText).toBe('OCR FIXTURE 4827');
    expect(manifest.fontProgramBundled).toBe(false);
    expect(manifest.license).toBe('CC0-1.0');
    expect(manifest.sensitivity).toBe('none');
  });
  it('contains 42 safe, manifest-backed, integrity-checked fixtures', async () => {
    const fixtureDirectory = new URL('../fixtures/', import.meta.url);
    const manifest = JSON.parse(
      await readFile(new URL('manifest.json', fixtureDirectory), 'utf8'),
    ) as FixtureManifest;
    expect(manifest.fixtures).toHaveLength(42);
    expect(new Set(manifest.fixtures.map(({ filename }) => filename)).size).toBe(42);
    const manifestFilenames = manifest.fixtures.map(({ filename }) => filename).sort();
    const fixtureFilenames = (await readdir(fixtureDirectory))
      .filter((filename) => filename.endsWith('.pdf'))
      .sort();
    expect(fixtureFilenames).toEqual(manifestFilenames);
    for (const entry of manifest.fixtures) {
      const bytes = await readFile(new URL(entry.filename, fixtureDirectory));
      expect(bytes.subarray(0, 7).toString('ascii'), entry.filename).toMatch(/^%PDF-1\./u);
      expect(bytes.toString('ascii'), entry.filename).toContain('%%EOF');
      expect(createHash('sha256').update(bytes).digest('hex'), entry.filename).toBe(entry.sha256);
      expect(entry.sensitivity).toBe('none');
      expect(entry.origin).toContain('Purpose-created');
    }
  });

  it('contains four safe, manifest-backed synthetic image inputs', async () => {
    const fixtureDirectory = new URL('../fixtures/images/', import.meta.url);
    const manifest = JSON.parse(
      await readFile(new URL('manifest.json', fixtureDirectory), 'utf8'),
    ) as ImageFixtureManifest;
    expect(manifest.fixtures).toHaveLength(4);
    const fixtureFilenames = (await readdir(fixtureDirectory))
      .filter((filename) => !filename.endsWith('.json'))
      .sort();
    expect(fixtureFilenames).toEqual(manifest.fixtures.map(({ filename }) => filename).sort());
    for (const entry of manifest.fixtures) {
      const bytes = await readFile(new URL(entry.filename, fixtureDirectory));
      expect(createHash('sha256').update(bytes).digest('hex'), entry.filename).toBe(entry.sha256);
      expect(entry.featureIds).toContain('ORG-008');
      expect(entry.sensitivity).toBe('none');
      expect(entry.origin).toContain('Purpose-created');
      expect(entry.license).toBe('CC0-1.0');
    }
  });
});
