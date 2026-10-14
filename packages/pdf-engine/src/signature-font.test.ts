import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { embedSignatureFont, layoutScriptSignature } from './signature-font.js';
import { signatureFontBase64 } from './signature-font-data.js';

const rect = { x: 0.5, y: 0.7, width: 0.36, height: 0.09 };
describe('SIGN-001/002 fixed local script font', () => {
  it('ships the complete unmodified font licence in both app surfaces and source notices', async () => {
    const files = [
      '../../../docs/dependencies/DancingScript-OFL.txt',
      '../../../apps/web/public/third-party/DancingScript-OFL.txt',
      '../../../apps/desktop/public/third-party/DancingScript-OFL.txt',
    ];
    const copies = await Promise.all(
      files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')),
    );
    for (const copy of copies) {
      const bytes = Buffer.from(copy.replace(/\r\n/gu, '\n'), 'utf8');
      expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')).toBe(
        '07ff8df965f089a2b89071b3d46cfd15777634a6',
      );
    }
  });
  it('retains the exact unmodified upstream font blob', () => {
    const bytes = Buffer.from(signatureFontBase64, 'base64');
    expect(bytes.length).toBe(133636);
    expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')).toBe(
      '9f521e7fb357ec9ea9820ebd36a9d7b1f72f2935',
    );
  });
  it('shares glyph advances with the embedded font and reuses only within a document', async () => {
    const document = await PDFDocument.create();
    const [font, same] = await Promise.all([
      embedSignatureFont(document),
      embedSignatureFont(document),
    ]);
    expect(font).toBe(same);
    const layout = await layoutScriptSignature('QA Signature', 'signature', rect, 612, 792);
    expect(font.name).toContain('DancingScript');
    expect(layout.glyphs).toHaveLength('QA Signature'.length);
    expect(layout.glyphs[0]?.path).toContain('M');
    const advance = font.widthOfTextAtSize('QA Signature', layout.fontSize);
    expect(advance + layout.x * 2).toBeCloseTo(layout.width, 5);
    expect(layout.baseline).toBeLessThan(layout.height);
    expect(await embedSignatureFont(await PDFDocument.create())).not.toBe(font);
  });
  it.each(['', 'QA\nSignature', 'QA\u0000Signature', 'QA😀', 'a'.repeat(201)])(
    'rejects unsupported signature text without substitution',
    async (text) => {
      await expect(layoutScriptSignature(text, 'signature', rect, 612, 792)).rejects.toThrow(
        'EDIT_SIGNATURE_TEXT_UNSUPPORTED',
      );
    },
  );
  it('rejects tiny boxes and invalid page geometry rather than silently overflowing', async () => {
    await expect(
      layoutScriptSignature('QA Signature', 'signature', { ...rect, width: 0.01 }, 612, 792),
    ).rejects.toThrow('EDIT_SIGNATURE_BOX_TOO_SMALL');
    await expect(layoutScriptSignature('QA', 'signature', rect, NaN, 792)).rejects.toThrow(
      'EDIT_SIGNATURE_BOX_TOO_SMALL',
    );
  });
});
