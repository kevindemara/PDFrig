import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AccountDashboard, type AccountDashboardSnapshot } from './account-dashboard.js';

const snapshot: AccountDashboardSnapshot = {
  email: 'synthetic@example.invalid',
  emailVerified: true,
  entitlements: [],
  historyEnabled: false,
  jobs: [
    {
      id: 'synthetic-job',
      operation: 'demo.integrity',
      state: 'completed',
      progressStage: 'complete',
      progressValue: 100,
      createdAt: '2026-10-03T12:00:00.000Z',
      completedAt: '2026-10-03T12:00:02.000Z',
      deleteAfter: '2026-10-03T13:00:00.000Z',
      errorCode: null,
    },
  ],
  localDemo: false,
  planKey: 'pro_monthly',
  processingRegion: 'synthetic',
  retention: { historyDays: 30, outputHours: 1, safetyNetHours: 24 },
  subscriptionStatus: 'active',
  workspaceId: 'synthetic-workspace',
};

describe('account hydration boundary', () => {
  it('does not let a pre-mutation poll replace the accepted post-mutation snapshot', async () => {
    vi.useFakeTimers();
    let resolvePoll: (response: Response) => void = () => undefined;
    const oldPoll = new Promise<Response>((resolve) => {
      resolvePoll = resolve;
    });
    const updated = { ...snapshot, historyEnabled: true };
    const initialJob = snapshot.jobs[0];
    if (initialJob === undefined) throw new Error('Missing synthetic account job.');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => oldPoll)
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(updated)));
    const view = render(
      <AccountDashboard
        initialSnapshot={{ ...snapshot, jobs: [{ ...initialJob, state: 'processing' }] }}
        workspaceHref="/workspace"
      />,
    );
    try {
      await act(() => vi.advanceTimersByTimeAsync(700));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: /Keep job metadata/i }));
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(screen.getByRole('checkbox', { name: /Keep job metadata/i })).toBeChecked();
      await act(async () => {
        resolvePoll(new Response(JSON.stringify(snapshot)));
        await Promise.resolve();
      });
      expect(screen.getByRole('checkbox', { name: /Keep job metadata/i })).toBeChecked();
    } finally {
      view.unmount();
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it('disables every mutation in server HTML and leaves dates timezone-independent', () => {
    const html = renderToString(
      <AccountDashboard initialSnapshot={snapshot} workspaceHref="/workspace" />,
    );
    const container = document.createElement('div');
    container.innerHTML = html;
    const controls = container.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button,input',
    );
    expect(controls.length).toBeGreaterThan(5);
    expect([...controls].every((control) => control.disabled)).toBe(true);
    expect(container.textContent).toContain(snapshot.jobs[0]?.createdAt);
    expect(container.textContent).toContain(snapshot.jobs[0]?.deleteAfter);
  });

  it('enables hydrated actions but retains explicit deletion confirmation', () => {
    render(<AccountDashboard initialSnapshot={snapshot} workspaceHref="/workspace" />);
    expect(screen.getByRole('button', { name: 'Run safe cloud check' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Request account deletion' })).toBeDisabled();
  });
});
