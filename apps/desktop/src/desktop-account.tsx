import type { Session } from '@supabase/supabase-js';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';

import type { DesktopAuthClient, DesktopAuthConfig } from './auth.js';
import type { DesktopEntitlementDecision, DesktopEntitlementManager } from './entitlement.js';
import type { AvailableDesktopUpdate, DesktopUpdateManager } from './updates.js';

export interface DesktopAccountControlProps {
  readonly client: DesktopAuthClient | null;
  readonly config: DesktopAuthConfig | null;
  readonly entitlementManager: DesktopEntitlementManager | null;
  readonly enforceEntitlement: boolean;
  readonly onAccessChange: (access: 'checking' | 'locked' | 'ready') => void;
  readonly updateManager: DesktopUpdateManager;
}

const entitlementCopy = (
  decision: DesktopEntitlementDecision | null,
  configured: boolean,
): { readonly detail: string; readonly label: string } => {
  if (!configured)
    return {
      detail: 'This local build has no public entitlement verification key.',
      label: 'Verification not configured',
    };
  switch (decision?.status) {
    case 'active':
      return {
        detail:
          'This signed access snapshot is current. Cloud actions still require online authorization.',
        label: 'Desktop access verified',
      };
    case 'offline_grace':
      return {
        detail: 'Local desktop work is available during the signed offline grace window.',
        label: 'Offline access window',
      };
    case 'disabled':
      return {
        detail: 'The signed workspace entitlement is not active.',
        label: 'Access inactive',
      };
    case 'expired':
      return { detail: 'Connect to refresh desktop access.', label: 'Access refresh required' };
    case 'clock_invalid':
      return {
        detail: 'The device clock moved backwards. Connect after correcting the clock.',
        label: 'Clock verification required',
      };
    default:
      return {
        detail: 'Sign in while online to retrieve a signed access snapshot.',
        label: 'Access not yet verified',
      };
  }
};

export const DesktopAccountControl = ({
  client,
  config,
  entitlementManager,
  enforceEntitlement,
  onAccessChange,
  updateManager,
}: DesktopAccountControlProps) => {
  const [availableUpdate, setAvailableUpdate] = useState<AvailableDesktopUpdate | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [email, setEmail] = useState('');
  const [entitlement, setEntitlement] = useState<DesktopEntitlementDecision | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (client === null) return;
    let current = true;
    void client.auth.getSession().then(({ data }) => {
      if (current) setSession(data.session);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (current) setSession(nextSession);
    });
    return () => {
      current = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (session === null || entitlementManager === null) return;
    let current = true;
    const synchronize = async (): Promise<void> => {
      const cached = await entitlementManager.load(session.user.id);
      if (current) setEntitlement(cached);
      try {
        const refreshed = await entitlementManager.refresh(session.access_token, session.user.id);
        if (current) setEntitlement(refreshed);
      } catch {
        if (current && cached.status === 'unavailable') setEntitlement(cached);
      }
    };
    void synchronize();
    return () => {
      current = false;
    };
  }, [entitlementManager, session]);

  useEffect(() => {
    if (!enforceEntitlement) {
      onAccessChange('ready');
      return;
    }
    if (session === null || entitlementManager === null) {
      onAccessChange('locked');
      return;
    }
    if (entitlement === null) {
      onAccessChange('checking');
      return;
    }
    onAccessChange(entitlement.localDesktopAllowed ? 'ready' : 'locked');
  }, [enforceEntitlement, entitlement, entitlementManager, onAccessChange, session]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (client === null || config === null) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const result =
        mode === 'signin'
          ? await client.auth.signInWithPassword({ email, password })
          : await client.auth.signUp({
              email,
              options: {
                emailRedirectTo: new URL('/auth/confirm', config.webAccountUrl).toString(),
              },
              password,
            });
      if (result.error !== null) {
        setStatus('Account access did not complete. Check your details and try again.');
      } else if (mode === 'signup' && result.data.session === null) {
        setStatus('Check your inbox to verify this address, then sign in here.');
      } else {
        setStatus('Your account session is protected by Windows on this device.');
      }
    } catch {
      setStatus('Account access is temporarily unavailable. Local PDF tools still work.');
    } finally {
      setPassword('');
      setSubmitting(false);
    }
  };

  const signOut = async (): Promise<void> => {
    if (client === null) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error === null) await entitlementManager?.clear();
      setStatus(
        error === null
          ? 'Signed out on this device.'
          : 'Sign-out did not complete. Close the app and try again.',
      );
    } catch {
      setStatus('Sign-out did not complete. Close the app and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const checkForUpdates = async (): Promise<void> => {
    setUpdating(true);
    setUpdateStatus('Checking the signed update channel…');
    try {
      const update = await updateManager.check();
      setAvailableUpdate(update);
      setUpdateStatus(
        update === null
          ? 'This build is up to date.'
          : `PDFrig ${update.version} is ready to install.`,
      );
    } catch {
      setAvailableUpdate(null);
      setUpdateStatus(
        'Updates are not configured for this internal build, or the channel is unavailable.',
      );
    } finally {
      setUpdating(false);
    }
  };

  const installUpdate = async (): Promise<void> => {
    if (availableUpdate === null) return;
    setUpdating(true);
    setUpdateStatus('Verifying and installing the update…');
    try {
      await updateManager.install(availableUpdate.version);
      setUpdateStatus('The verified installer started. PDFrig will restart when it is ready.');
    } catch {
      setUpdateStatus('The update was not installed. Your current version is unchanged.');
      setUpdating(false);
    }
  };

  const sessionEmail = session?.user.email;
  const entitlementStatus = entitlementCopy(entitlement, entitlementManager !== null);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="desktop-account-button"
        onClick={() => {
          setOpen(true);
          setStatus(null);
        }}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`status-dot ${session === null ? '' : 'status-dot--local'}`}
        />
        <span>{sessionEmail ?? 'Account'}</span>
      </button>
      {open && (
        <div className="desktop-account-backdrop" role="presentation">
          <section
            aria-labelledby="desktop-account-title"
            aria-modal="true"
            className="desktop-account-dialog"
            role="dialog"
          >
            <div className="desktop-account-dialog__heading">
              <div>
                <p className="eyebrow">Windows account</p>
                <h2 id="desktop-account-title">
                  {session === null ? 'Connect your workspace.' : 'Session on this device.'}
                </h2>
              </div>
              <button onClick={() => setOpen(false)} ref={closeRef} type="button">
                Close
              </button>
            </div>
            {config === null || client === null ? (
              <div className="desktop-account-dialog__note" role="status">
                Account access is not configured in this local build. Add the public Supabase URL
                and publishable key described in the local setup guide. Local PDF tools remain
                available without an account.
              </div>
            ) : session === null ? (
              <>
                <p className="desktop-account-dialog__intro">
                  Account access enables verified entitlements and cloud services. PDF editing in
                  this workspace stays on this device.
                </p>
                <form onSubmit={(event) => void submit(event)}>
                  <label className="field-stack">
                    Email
                    <input
                      autoComplete="email"
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      type="email"
                      value={email}
                    />
                  </label>
                  <label className="field-stack">
                    Password
                    <input
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                      minLength={8}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      type="password"
                      value={password}
                    />
                  </label>
                  <button className="button button--primary" disabled={submitting} type="submit">
                    {submitting
                      ? 'Working…'
                      : mode === 'signin'
                        ? 'Sign in securely'
                        : 'Create account'}
                  </button>
                </form>
                <button
                  className="text-button"
                  onClick={() => {
                    setMode(mode === 'signin' ? 'signup' : 'signin');
                    setStatus(null);
                  }}
                  type="button"
                >
                  {mode === 'signin' ? 'Create a PDFrig account' : 'Return to sign in'}
                </button>
              </>
            ) : (
              <div className="desktop-account-session">
                <span className="status-dot status-dot--local" aria-hidden="true" />
                <div>
                  <strong>{sessionEmail ?? 'Verified account session'}</strong>
                  <p>
                    Refresh credentials are encrypted with Windows DPAPI for this Windows user and
                    this PC. Document content is not part of the session cache.
                  </p>
                </div>
                <button
                  className="button button--quiet"
                  disabled={submitting}
                  onClick={() => void signOut()}
                  type="button"
                >
                  Sign out on this device
                </button>
              </div>
            )}
            {session !== null && (
              <div className="desktop-entitlement-status" role="status">
                <span
                  aria-hidden="true"
                  className={`status-dot ${entitlement?.localDesktopAllowed === true ? 'status-dot--local' : ''}`}
                />
                <div>
                  <strong>{entitlementStatus.label}</strong>
                  <p>{entitlementStatus.detail}</p>
                </div>
              </div>
            )}
            <div className="desktop-update-status">
              <div>
                <p className="eyebrow">Signed updates</p>
                <strong>
                  {availableUpdate === null
                    ? 'Release channel'
                    : `${availableUpdate.currentVersion} → ${availableUpdate.version}`}
                </strong>
                {availableUpdate?.notes !== null && availableUpdate?.notes !== undefined && (
                  <p>{availableUpdate.notes}</p>
                )}
              </div>
              <button
                className="button button--quiet"
                disabled={updating}
                onClick={() => void checkForUpdates()}
                type="button"
              >
                {updating ? 'Working…' : 'Check for updates'}
              </button>
              {availableUpdate !== null && (
                <button
                  className="button button--primary"
                  disabled={updating}
                  onClick={() => void installUpdate()}
                  type="button"
                >
                  Install signed update
                </button>
              )}
            </div>
            {updateStatus !== null && (
              <p className="desktop-account-dialog__status" role="status">
                {updateStatus}
              </p>
            )}
            {status !== null && (
              <p className="desktop-account-dialog__status" role="status">
                {status}
              </p>
            )}
            <p className="desktop-account-dialog__privacy">
              Passwords are sent only to the configured Supabase Auth endpoint and are never written
              to PDFrig logs or files.
            </p>
          </section>
        </div>
      )}
    </>
  );
};
