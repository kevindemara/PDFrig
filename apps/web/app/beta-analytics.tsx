'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { BetaSurface } from '@pdfmason/contracts';
import { sendBetaAnalytics } from '../lib/beta/analytics-client';

const CONSENT_KEY = 'pdfmason-analytics-consent-v1';
const CONSENT_EVENT = 'pdfmason:analytics-consent';
type ConsentChoice = 'accepted' | 'declined' | 'prompt';

const subscribe = (onStoreChange: () => void): (() => void) => {
  globalThis.addEventListener('storage', onStoreChange);
  globalThis.addEventListener(CONSENT_EVENT, onStoreChange);
  return () => {
    globalThis.removeEventListener('storage', onStoreChange);
    globalThis.removeEventListener(CONSENT_EVENT, onStoreChange);
  };
};

const getSnapshot = (): ConsentChoice => {
  const stored = globalThis.localStorage.getItem(CONSENT_KEY);
  return stored === 'accepted' || stored === 'declined' ? stored : 'prompt';
};

const getServerSnapshot = (): ConsentChoice => 'prompt';

const setChoice = (choice: ConsentChoice): void => {
  if (choice === 'prompt') globalThis.localStorage.removeItem(CONSENT_KEY);
  else globalThis.localStorage.setItem(CONSENT_KEY, choice);
  globalThis.dispatchEvent(new Event(CONSENT_EVENT));
};

const surfaceForPathname = (pathname: string): BetaSurface => {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/account')) return 'account';
  if (pathname.startsWith('/help') || pathname.startsWith('/get-started')) return 'help';
  if (pathname.startsWith('/known-limitations')) return 'known_limits';
  if (pathname.startsWith('/pricing')) return 'pricing';
  if (pathname.startsWith('/status')) return 'status';
  if (pathname.startsWith('/support')) return 'support';
  if (pathname.startsWith('/tools')) return 'tools';
  if (pathname.startsWith('/workspace')) return 'workspace';
  return 'policies';
};

export const BetaAnalytics = ({ enabled }: { readonly enabled: boolean }) => {
  const pathname = usePathname();
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [workspacePromptOpen, setWorkspacePromptOpen] = useState(false);
  const reopen = useRef<HTMLButtonElement>(null);
  const workspace = pathname.startsWith('/workspace');

  useEffect(() => {
    if (!enabled || choice !== 'accepted') return;
    const event = pathname.startsWith('/pricing') ? 'pricing_viewed' : 'page_view';
    void sendBetaAnalytics({
      event,
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      surface: surfaceForPathname(pathname),
    });
  }, [choice, enabled, pathname]);

  if (!enabled) return null;
  if (choice !== 'prompt' || (workspace && !workspacePromptOpen)) {
    return (
      <button
        className="analytics-choice__reopen"
        ref={reopen}
        onClick={() => {
          setChoice('prompt');
          setWorkspacePromptOpen(true);
        }}
        type="button"
      >
        Privacy choices
      </button>
    );
  }
  return (
    <aside aria-labelledby="analytics-choice-title" className="analytics-choice">
      <h2 id="analytics-choice-title">Optional, content-free analytics</h2>
      {workspace && (
        <button
          type="button"
          onClick={() => {
            setWorkspacePromptOpen(false);
            queueMicrotask(() => reopen.current?.focus());
          }}
        >
          Close privacy choices
        </button>
      )}
      <p>
        Share only approved event names, product surface, result class, and stable feature ID. No
        PDF, filename, text, account identifier, or persistent cross-session ID is sent.
      </p>
      <div className="analytics-choice__actions">
        <button
          className="button button--primary"
          onClick={() => setChoice('accepted')}
          type="button"
        >
          Allow optional analytics
        </button>
        <button
          className="button button--secondary"
          onClick={() => setChoice('declined')}
          type="button"
        >
          Keep analytics off
        </button>
      </div>
    </aside>
  );
};
