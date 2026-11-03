import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageJump, pageJumpIndex } from './page-jump.js';

describe('VIEW-004 direct working-copy navigation', () => {
  it('accepts only complete in-range integer page numbers', () => {
    for (const value of ['', '0', '-1', '2.5', '2e1', '3x', 'Infinity', '999999999999999999999'])
      expect(pageJumpIndex(value, 100)).toBeNull();
    expect(pageJumpIndex(' 042 ', 100)).toBe(41);
    expect(pageJumpIndex('100', 100)).toBe(99);
    expect(pageJumpIndex('101', 100)).toBeNull();
    expect(pageJumpIndex('1', 0)).toBeNull();
  });
  it('waits for submit, announces invalid input and lets Escape restore the current page', () => {
    const jump = vi.fn();
    const view = render(<PageJump current={2} count={12} onJump={jump} />);
    const ui = within(view.container);
    const input = ui.getByRole('textbox', { name: 'Go to page' });
    fireEvent.change(input, { target: { value: '13' } });
    expect(jump).not.toHaveBeenCalled();
    fireEvent.click(ui.getByRole('button', { name: 'Go to page' }));
    expect(ui.getByRole('alert')).toHaveTextContent('1 to 12');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('2');
    expect(ui.queryByRole('alert')).toBeNull();
    fireEvent.change(input, { target: { value: '12' } });
    const form = input.closest('form');
    if (!form) throw new Error('Missing page jump form');
    fireEvent.submit(form);
    expect(jump).toHaveBeenCalledExactlyOnceWith(11);
  });
});
