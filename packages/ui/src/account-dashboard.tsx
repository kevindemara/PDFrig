'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { BrandLockup } from './brand-lockup.js';

export interface AccountJobView {
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly deleteAfter: string;
  readonly errorCode: string | null;
  readonly id: string;
  readonly operation: string;
  readonly progressStage: string;
  readonly progressValue: number | null;
  readonly state: string;
}

export interface AccountDashboardSnapshot {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly entitlements: readonly {
    readonly enabled: boolean;
    readonly featureKey: string;
    readonly limitUnit: 'bytes' | 'jobs' | 'pages' | null;
    readonly limitValue: number | null;
    readonly usedValue: number;
  }[];
  readonly historyEnabled: boolean;
  readonly jobs: readonly AccountJobView[];
  readonly localDemo: boolean;
  readonly planKey: 'free' | 'pro_annual' | 'pro_monthly';
  readonly processingRegion: string;
  readonly retention: {
    readonly historyDays: number;
    readonly outputHours: number;
    readonly safetyNetHours: number;
  };
  readonly subscriptionStatus: string;
  readonly workspaceId: string;
}

export interface AccountDashboardProps {
  readonly initialSnapshot: AccountDashboardSnapshot;
  readonly workspaceHref: string;
}

const activeStates = new Set([
  'awaiting_upload',
  'queued',
  'processing',
  'retry_wait',
  'cancelling',
  'deleting',
]);

const isSnapshot = (value: unknown): value is AccountDashboardSnapshot => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AccountDashboardSnapshot>;
  return (
    typeof candidate.email === 'string' &&
    typeof candidate.historyEnabled === 'boolean' &&
    Array.isArray(candidate.jobs) &&
    Array.isArray(candidate.entitlements) &&
    typeof candidate.processingRegion === 'string' &&
    typeof candidate.workspaceId === 'string'
  );
};

const messageFromResponse = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { readonly error?: unknown }).error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const message = (error as { readonly message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
  }
  return 'The request stopped safely. Try again.';
};

const postJson = async (path: string, body: unknown): Promise<Response> =>
  fetch(path, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

const shortDate = (value: string): string =>
  new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );

const readableState = (value: string): string => value.replaceAll('_', ' ');

// Server HTML is not interactive. Enable mutations only after handlers attach;
// an empty subscription also avoids a synchronous setState in an effect.
const subscribeToHydration = () => () => undefined;
const clientHydrated = () => true;
const serverHydrated = () => false;

export const AccountDashboard = ({ initialSnapshot, workspaceHref }: AccountDashboardProps) => {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deletionConfirmation, setDeletionConfirmation] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const refreshRevision = useRef(0);
  const mutationPending = useRef(false);
  const actionsDisabled = !hydrated || busyAction !== null;

  const refresh = useCallback(async (): Promise<void> => {
    const revision = ++refreshRevision.current;
    const response = await fetch('/api/v1/account', { cache: 'no-store' });
    const body: unknown = await response.json().catch(() => null);
    if (revision === refreshRevision.current && response.ok && isSnapshot(body)) setSnapshot(body);
  }, []);

  useEffect(
    () => () => {
      refreshRevision.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!snapshot.jobs.some((job) => activeStates.has(job.state))) return;
    const timer = window.setInterval(() => {
      if (!mutationPending.current) void refresh().catch(() => undefined);
    }, 700);
    return () => window.clearInterval(timer);
  }, [refresh, snapshot.jobs]);

  const mutate = async (
    action: string,
    path: string,
    body: unknown,
    successMessage: string,
  ): Promise<void> => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    refreshRevision.current += 1;
    setBusyAction(action);
    setNotice(null);
    try {
      const response = await postJson(path, body);
      if (!response.ok) throw new Error(await messageFromResponse(response));
      setNotice(successMessage);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The request stopped safely.');
    } finally {
      mutationPending.current = false;
      setBusyAction(null);
    }
  };

  const openBilling = async (path: string, body: unknown): Promise<void> => {
    setBusyAction(path);
    setNotice(null);
    try {
      const response = await postJson(path, body);
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(await messageFromResponse(new Response(JSON.stringify(value), response)));
      const url =
        typeof value === 'object' && value !== null && 'url' in value
          ? (value as { readonly url?: unknown }).url
          : null;
      if (typeof url !== 'string') throw new Error('Billing did not return a safe redirect.');
      window.location.assign(url);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Billing stopped safely.');
      setBusyAction(null);
    }
  };

  const quota = snapshot.entitlements.find(
    (entitlement) => entitlement.featureKey === 'cloud.demo.integrity',
  );

  return (
    <main className="account-page">
      <header className="account-topbar">
        <a aria-label="PDFrig home" className="brand-link" href="/">
          <BrandLockup />
        </a>
        <nav aria-label="Account navigation">
          <a href={workspaceHref}>Local workspace</a>
          <a aria-current="page" href="/account">
            Account
          </a>
        </nav>
        <div className="account-identity">
          <span>{snapshot.email}</span>
          <span className="planned-label">{snapshot.localDemo ? 'Local demo' : 'Signed in'}</span>
          {!snapshot.localDemo && (
            <button
              className="text-button"
              disabled={actionsDisabled}
              onClick={() =>
                void postJson('/auth/signout', {}).then(() => window.location.assign('/account'))
              }
              type="button"
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      <section className="account-hero">
        <div>
          <p className="eyebrow">Cloud control room</p>
          <h1>Processing you can account for.</h1>
          <p>
            Every cloud job is workspace-scoped, metered before it starts, and paired with an
            explicit deletion deadline. Local PDF tools still work without an upload.
          </p>
        </div>
        <dl className="account-measure">
          <div>
            <dt>Region</dt>
            <dd>{snapshot.processingRegion}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>{snapshot.planKey.replaceAll('_', ' ')}</dd>
          </div>
          <div>
            <dt>Cloud check allowance</dt>
            <dd>
              {quota?.usedValue ?? 0} / {quota?.limitValue ?? 0}
            </dd>
          </div>
        </dl>
      </section>

      {notice !== null && (
        <p className="account-notice" role="status">
          {notice}
        </p>
      )}

      <div className="account-grid">
        <section className="account-panel account-panel--jobs" aria-labelledby="jobs-heading">
          <div className="account-panel__heading">
            <div>
              <p className="panel-kicker">Harmless demonstration</p>
              <h2 id="jobs-heading">Job lifecycle</h2>
            </div>
            <button
              className="button button--primary"
              disabled={actionsDisabled}
              onClick={() =>
                void mutate(
                  'demo',
                  '/api/v1/jobs/demo',
                  { idempotencyKey: `demo-${crypto.randomUUID()}` },
                  'Cloud check queued.',
                )
              }
              type="button"
            >
              Run safe cloud check
            </button>
          </div>
          <p className="account-panel__intro">
            This exercise checks queueing, progress, quota, cancellation, and deletion. It does not
            upload or alter a PDF.
          </p>
          {snapshot.jobs.length === 0 ? (
            <div className="job-empty">
              <span aria-hidden="true">00</span>
              <p>No cloud jobs yet. Your local workspace is ready.</p>
            </div>
          ) : (
            <ol className="job-list">
              {snapshot.jobs.map((job) => (
                <li key={job.id}>
                  <div className="job-list__measure" aria-hidden="true">
                    <span style={{ width: `${job.progressValue ?? 0}%` }} />
                  </div>
                  <div className="job-list__title">
                    <strong>
                      {job.operation === 'demo.integrity' ? 'Cloud integrity check' : job.operation}
                    </strong>
                    <span>{hydrated ? shortDate(job.createdAt) : job.createdAt}</span>
                  </div>
                  <p>
                    <span
                      className={`status-dot status-dot--${job.state === 'completed' ? 'local' : 'cloud'}`}
                    />{' '}
                    {readableState(job.progressStage)}
                  </p>
                  <p className="job-list__retention">
                    Delete by {hydrated ? shortDate(job.deleteAfter) : job.deleteAfter}
                  </p>
                  <div className="job-list__actions">
                    {['queued', 'processing', 'retry_wait'].includes(job.state) && (
                      <button
                        disabled={actionsDisabled}
                        onClick={() =>
                          void mutate(
                            `cancel-${job.id}`,
                            `/api/v1/jobs/${job.id}/cancel`,
                            {},
                            'Cancellation requested.',
                          )
                        }
                        type="button"
                      >
                        Cancel
                      </button>
                    )}
                    {['cancelled', 'completed', 'failed', 'expired', 'deletion_attention'].includes(
                      job.state,
                    ) && (
                      <button
                        disabled={actionsDisabled}
                        onClick={() =>
                          void mutate(
                            `delete-${job.id}`,
                            `/api/v1/jobs/${job.id}/delete`,
                            {},
                            'Deletion queued.',
                          )
                        }
                        type="button"
                      >
                        Delete now
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside
          className="account-panel account-panel--retention"
          aria-labelledby="retention-heading"
        >
          <p className="panel-kicker">Retention ruler</p>
          <h2 id="retention-heading">Short by default.</h2>
          <ol className="retention-ruler">
            <li>
              <strong>{snapshot.retention.outputHours}h</strong>
              <span>Normal output deletion</span>
            </li>
            <li>
              <strong>{snapshot.retention.safetyNetHours}h</strong>
              <span>Storage lifecycle backstop</span>
            </li>
            <li>
              <strong>{snapshot.retention.historyDays}d</strong>
              <span>Metadata only, when opted in</span>
            </li>
          </ol>
          <label className="history-switch">
            <input
              checked={snapshot.historyEnabled}
              disabled={actionsDisabled}
              onChange={(event) => {
                const retainJobHistory = event.currentTarget.checked;
                setSnapshot((current) => ({ ...current, historyEnabled: retainJobHistory }));
                void mutate(
                  'history',
                  '/api/v1/privacy/preferences',
                  { retainJobHistory },
                  retainJobHistory ? 'Metadata history enabled.' : 'Metadata history disabled.',
                );
              }}
              type="checkbox"
            />
            <span>
              <strong>Keep job metadata</strong>Content-free history only. Document names and
              contents are excluded.
            </span>
          </label>
        </aside>

        <section className="account-panel account-panel--billing" aria-labelledby="billing-heading">
          <p className="panel-kicker">Subscription</p>
          <h2 id="billing-heading">A plan mirror, not a promise.</h2>
          <p>
            Access changes only after a verified billing webhook updates the server-side entitlement
            mirror. Returning from checkout never unlocks a feature by itself.
          </p>
          <div className="billing-actions">
            <button
              className="button button--secondary"
              disabled={actionsDisabled}
              onClick={() =>
                void openBilling('/api/v1/billing/checkout', {
                  idempotencyKey: `checkout-${crypto.randomUUID()}`,
                  planKey: 'pro_monthly',
                })
              }
              type="button"
            >
              Choose Pro monthly
            </button>
            <button
              className="button button--secondary"
              disabled={actionsDisabled}
              onClick={() =>
                void openBilling('/api/v1/billing/checkout', {
                  idempotencyKey: `checkout-${crypto.randomUUID()}`,
                  planKey: 'pro_annual',
                })
              }
              type="button"
            >
              Choose Pro annual
            </button>
            {snapshot.subscriptionStatus !== 'none' && (
              <button
                className="text-button"
                disabled={actionsDisabled}
                onClick={() => void openBilling('/api/v1/billing/portal', {})}
                type="button"
              >
                Manage billing
              </button>
            )}
          </div>
          <p className="account-fineprint">
            CAD pricing remains provider-configured until the commercial amounts are approved.
          </p>
        </section>

        <section className="account-panel account-panel--privacy" aria-labelledby="privacy-heading">
          <p className="panel-kicker">Privacy controls</p>
          <h2 id="privacy-heading">Leave cleanly.</h2>
          <p>
            Deleting your account immediately queues workspace objects for reconciliation. Storage
            failures remain visible to operations until absence is confirmed.
          </p>
          <label className="field-stack">
            Type DELETE to request permanent account deletion
            <input
              autoComplete="off"
              disabled={actionsDisabled}
              onChange={(event) => setDeletionConfirmation(event.target.value)}
              value={deletionConfirmation}
            />
          </label>
          <button
            className="button button--danger"
            disabled={deletionConfirmation !== 'DELETE' || actionsDisabled}
            onClick={() =>
              void mutate(
                'account-delete',
                '/api/v1/privacy/account-deletion',
                { confirmation: deletionConfirmation },
                'Account deletion accepted. Object reconciliation is queued.',
              )
            }
            type="button"
          >
            Request account deletion
          </button>
          {!snapshot.localDemo && (
            <p className="account-fineprint">
              For safety, this requires a sign-in from the last five minutes.
            </p>
          )}
        </section>
      </div>
    </main>
  );
};
