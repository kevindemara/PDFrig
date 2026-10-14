import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  assertOfficeArchiveEntriesSafe,
  buildOfficeCommand,
  inspectOfficeArchive,
  parseOfficeLimits,
  resolveOfficeInput,
} from './office-conversion.js';

describe('dedicated Office conversion boundary', () => {
  it('allows only fixed OOXML input paths beneath the mounted input root', () => {
    expect(resolveOfficeInput('/job/input', '/job/input/source.docx')).toMatch(
      /(?:^|[\\/])job[\\/]input[\\/]source\.docx$/u,
    );
    expect(() => resolveOfficeInput('/job/input', '/job/input/source.docm')).toThrow(
      'OFFICE_INPUT_UNSUPPORTED',
    );
    expect(() => resolveOfficeInput('/job/input', '/job/input/customer-name.docx')).toThrow(
      'OFFICE_INPUT_UNSUPPORTED',
    );
    expect(() => resolveOfficeInput('/job/input', '/job/input/../secret.docx')).toThrow(
      'OFFICE_INPUT_UNSUPPORTED',
    );
  });

  it('blocks macros, embedded objects, templates, and external-link containers', () => {
    expect(() =>
      assertOfficeArchiveEntriesSafe(['[Content_Types].xml', 'word/document.xml']),
    ).not.toThrow();
    for (const activeEntry of [
      'word/vbaProject.bin',
      'word/embeddings/object.bin',
      'word/attachedTemplate/template.dotm',
      'xl/externalLinks/externalLink1.xml',
    ]) {
      expect(() => assertOfficeArchiveEntriesSafe(['[Content_Types].xml', activeEntry])).toThrow(
        'OFFICE_ACTIVE_CONTENT_BLOCKED',
      );
    }
  });

  it('inspects a real synthetic OOXML central directory before conversion', async () => {
    const fixture = await readFile(resolve('test-fixtures/synthetic-letter.docx'));
    const entries = inspectOfficeArchive(fixture);
    expect(entries).toContain('word/document.xml');
    expect(() => inspectOfficeArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(
      'OFFICE_ARCHIVE_INVALID',
    );
  });

  it('applies validated operator resource-limit configuration', () => {
    expect(
      parseOfficeLimits({
        PDFMASON_OFFICE_EXPANDED_LIMIT_BYTES: '125000000',
        PDFMASON_OFFICE_INPUT_LIMIT_BYTES: '25000000',
        PDFMASON_OFFICE_JOB_TIMEOUT_SECONDS: '90',
        PDFMASON_OFFICE_OUTPUT_LIMIT_BYTES: '75000000',
      }),
    ).toEqual({
      expandedLimitBytes: 125_000_000,
      inputLimitBytes: 25_000_000,
      outputLimitBytes: 75_000_000,
      timeoutMilliseconds: 90_000,
    });
    expect(() => parseOfficeLimits({ PDFMASON_OFFICE_JOB_TIMEOUT_SECONDS: 'unbounded' })).toThrow(
      'OFFICE_CONFIGURATION_INVALID',
    );
  });

  it('builds a shell-free command with a fresh isolated profile', () => {
    const command = buildOfficeCommand('/job/input/source.pptx', '/job/output', '/tmp/profile');
    expect(command.executable).toBe('/opt/libreoffice26.2/program/soffice');
    expect(command.args).toContain('--headless');
    expect(command.args).toContain('-env:UserInstallation=file:///tmp/profile');
    expect(command.args).toContain('/job/input/source.pptx');
    expect(command.args.join(' ')).not.toMatch(/[;&|`]/u);
  });
});
