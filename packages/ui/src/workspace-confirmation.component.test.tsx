import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceConfirmation } from './workspace-confirmation.js';

const Harness = ({ result }: { readonly result: (confirmed: boolean) => void }) => {
  const { requestConfirmation, confirmation } = useWorkspaceConfirmation();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void requestConfirmation('Synthetic unsaved work will be lost.').then(result);
        }}
      >
        Leave
      </button>
      {confirmation}
    </>
  );
};

describe('VIEW-001 in-app unsaved-work confirmation', () => {
  it.each(['Cancel', 'Escape'] as const)(
    'waits for a decision and safely handles %s',
    async (action) => {
      const result = vi.fn();
      render(<Harness result={result} />);
      const trigger = screen.getByRole('button', { name: 'Leave' });
      trigger.focus();
      fireEvent.click(trigger);
      expect(screen.getByRole('alertdialog', { name: 'Discard unsaved work?' })).toHaveTextContent(
        'Synthetic unsaved work',
      );
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(cancel).toHaveFocus();
      expect(result).not.toHaveBeenCalled();
      if (action === 'Cancel') fireEvent.click(cancel);
      else fireEvent.keyDown(cancel, { key: 'Escape' });
      await waitFor(() => expect(result).toHaveBeenCalledExactlyOnceWith(false));
      expect(trigger).toHaveFocus();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    },
  );
  it('requires an explicit discard and contains keyboard focus', async () => {
    const result = vi.fn();
    render(<Harness result={result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const discard = screen.getByRole('button', { name: 'Discard and continue' });
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(discard).toHaveFocus();
    fireEvent.keyDown(discard, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.click(discard);
    await waitFor(() => expect(result).toHaveBeenCalledExactlyOnceWith(true));
  });
  it('settles an outstanding request as cancelled when unmounted', async () => {
    const result = vi.fn();
    const view = render(<Harness result={result} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    view.unmount();
    await waitFor(() => expect(result).toHaveBeenCalledExactlyOnceWith(false));
  });
});
