import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';
import { FeedbackForm, SupportForm } from './support-form';

export const metadata: Metadata = {
  description: 'Contact PDFrig support with content-free diagnostics.',
  title: 'Support — PDFrig',
};

export default function SupportPage() {
  const { config, footer, links } = getPublicSite();
  return (
    <PublicPage
      {...footer}
      eyebrow="Support"
      introduction="Start with a safe error code and opaque request ID. Ordinary support never needs your PDF, filename, password, signature, or document text."
      links={links}
      title="Get help without handing over the document."
    >
      <PublicSection title="Send content-free diagnostics.">
        <p>
          Local development uses a non-persistent fake intake. It proves the contract and receipt
          flow but does not send email or create a real support ticket.
        </p>
        <SupportForm
          applicationVersion={config.applicationVersion}
          enabled={config.beta.intakeEnabled}
        />
      </PublicSection>
      <PublicSection eyebrow="Beta feedback" title="Rate the outcome, not the document.">
        <p>
          This form accepts a stable feature ID, outcome class, platform, and rating only. It has no
          free-text or attachment field by design.
        </p>
        <FeedbackForm
          applicationVersion={config.applicationVersion}
          enabled={config.beta.intakeEnabled}
        />
      </PublicSection>
      <PublicSection title="Security or privacy concern?">
        <p>
          Use {config.brand.privacyContact} for a privacy request. A production security-reporting
          channel, encryption key, response hours, and escalation owner remain launch approvals; do
          not send exploit files or customer documents to an unapproved address.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
