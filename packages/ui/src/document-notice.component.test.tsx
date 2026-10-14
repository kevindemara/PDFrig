import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentNotice } from './document-notice.js';

describe('VIEW-001 document notice', () => {
  it('dismisses/restores without acknowledging permission or changing editor state', () => {
    const acknowledge = vi.fn();
    render(
      <DocumentNotice title="Protected document" message="Editing needs explicit approval.">
        <button onClick={acknowledge}>Continue editing a new copy</button>
      </DocumentNotice>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss document notice' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show document notice' })).toHaveFocus();
    expect(acknowledge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show document notice' }));
    expect(screen.getByRole('status')).toHaveTextContent('Editing needs explicit approval.');
    expect(screen.getByRole('button', { name: 'Dismiss document notice' })).toHaveFocus();
    expect(acknowledge).not.toHaveBeenCalled();
  });
  it('shows changed warnings and resets dismissal for a different document owner', () => {
    const view = render(
      <DocumentNotice key="one" title="Tags" message="Existing tags retained." />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss document notice' }));
    view.rerender(
      <DocumentNotice key="one" title="Signature" message="Signature may become invalid." />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Signature may become invalid.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss document notice' }));
    view.rerender(
      <DocumentNotice key="two" title="Signature" message="Signature may become invalid." />,
    );
    expect(screen.getByRole('status')).toBeVisible();
  });
});
