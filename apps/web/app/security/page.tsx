import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description: 'PDFrig security architecture, privacy boundaries, and reporting limitations.',
  title: 'Security — PDFrig',
};

export default function SecurityPage() {
  const { config, footer, links } = getPublicSite();
  return (
    <PublicPage
      {...footer}
      eyebrow="Security & privacy"
      introduction="PDFrig assumes a PDF can be sensitive and hostile at the same time. Controls protect tenant boundaries, preserve originals, constrain parsers, and keep content out of diagnostics."
      links={links}
      title="Trust boundaries you can see."
    >
      <PublicSection title="Local-first where it is reliable.">
        <p>
          Local browser and Windows workflows do not silently upload. The Windows webview has a
          deny-by-default native surface, no remote application code, user-mediated file access,
          DPAPI-protected sessions, and signed bounded entitlement snapshots.
        </p>
      </PublicSection>
      <PublicSection title="Tenant and cloud isolation.">
        <ul>
          <li>
            Workspace membership is resolved from the authenticated session, never a client owner
            ID.
          </li>
          <li>
            Every exposed table uses Row Level Security with anonymous and cross-tenant negative
            tests.
          </li>
          <li>Private storage uses opaque keys and short, method-bound grants.</li>
          <li>
            Workers are non-root, network-restricted, resource-bounded, and operate on immutable
            inputs.
          </li>
          <li>
            Cloud completion never depends on a billing redirect; verified server state is
            authoritative.
          </li>
        </ul>
      </PublicSection>
      <PublicSection title="Content-free operations.">
        <p>
          Logs, traces, analytics, alerts, and ordinary support prohibit document bytes and text,
          filenames and paths, PDF passwords, signature images, form values, object keys, signed
          URLs, auth tokens, cookies, and raw webhook bodies.
        </p>
      </PublicSection>
      <PublicSection title="Independent work still required.">
        <p>
          Public beta remains gated on an independent penetration test, production threat review,
          provider and regional approval, signed Windows reference-machine testing, alert delivery,
          restore exercises, and a reviewed security-reporting channel. Development evidence is not
          a certification or a claim of universal compliance.
        </p>
        <p>Privacy contact placeholder: {config.brand.privacyContact}</p>
      </PublicSection>
    </PublicPage>
  );
}
