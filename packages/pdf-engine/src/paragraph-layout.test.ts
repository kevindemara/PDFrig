import { describe, it, expect } from 'vitest';
import { wrapParagraph } from './paragraph-layout.js';
describe('EDIT-002 natural paragraph wrapping', () => {
  it('wraps words at natural width and keeps explicit line/paragraph breaks', () => {
    expect(wrapParagraph('one two three four\n\nfive', 9, (text) => text.length)).toEqual([
      'one two',
      'three',
      'four',
      '',
      'five',
    ]);
  });
  it('breaks long tokens without adding hyphens or dropping characters', () => {
    expect(wrapParagraph('abcdefgh', 3, (text) => text.length)).toEqual(['abc', 'def', 'gh']);
  });
  it('refuses invalid frames and excessive line counts instead of shrinking', () => {
    expect(() => wrapParagraph('abc', NaN, (text) => text.length)).toThrow('INVALID_FRAME');
    expect(() => wrapParagraph('a', 0.5, (text) => text.length)).toThrow('INVALID_FRAME');
    expect(() => wrapParagraph('a\n'.repeat(201), 2, (text) => text.length)).toThrow('OVERFLOW');
  });
});
