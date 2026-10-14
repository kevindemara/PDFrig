'use client';

import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState } from 'react';

import { BrandLockup } from '@pdfmason/ui';

import { createSupabaseBrowserClient } from '../../lib/supabase/client';

export interface AuthPanelProps {
  readonly applicationUrl: string;
  readonly authEnabled: boolean;
}

export const AuthPanel = ({ applicationUrl, authEnabled }: AuthPanelProps) => {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!authEnabled) return;
    setSubmitting(true);
    setStatus(null);
    const supabase = createSupabaseBrowserClient();
    const result =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            options: { emailRedirectTo: new URL('/auth/confirm', applicationUrl).toString() },
            password,
          });
    setSubmitting(false);
    if (result.error !== null) {
      setStatus('Sign-in did not complete. Check your details or confirmation email.');
      return;
    }
    if (mode === 'signup' && result.data.session === null) {
      setStatus('Check your inbox to verify this address, then return here.');
      return;
    }
    router.refresh();
  };

  return (
    <main className="auth-page">
      <a aria-label="PDFrig home" className="brand-link" href="/">
        <BrandLockup />
      </a>
      <section className="auth-card">
        <p className="eyebrow">Personal workspace</p>
        <h1>{mode === 'signin' ? 'Return to your work.' : 'Create a private workspace.'}</h1>
        <p>
          An account is only needed for cloud processing, billing, and opted-in job history. Local
          PDF tools remain available without one.
        </p>
        {!authEnabled ? (
          <div className="auth-configuration-note" role="status">
            Production sign-in is not configured in this local shell. Use the local cloud demo or
            add the Supabase public URL and publishable key from the setup guide.
          </div>
        ) : (
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
              {submitting ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create workspace'}
            </button>
          </form>
        )}
        {status !== null && (
          <p className="auth-status" role="status">
            {status}
          </p>
        )}
        {authEnabled && (
          <button
            className="text-button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setStatus(null);
            }}
            type="button"
          >
            {mode === 'signin'
              ? 'Need a workspace? Create one'
              : 'Already have a workspace? Sign in'}
          </button>
        )}
        <a className="text-link" href="/workspace">
          Continue to local workspace →
        </a>
      </section>
    </main>
  );
};
