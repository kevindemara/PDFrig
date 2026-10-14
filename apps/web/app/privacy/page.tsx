import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description: 'How PDFrig handles local files, temporary cloud data, account data, and analytics.',
  title: 'Privacy — PDFrig',
};

export default function PrivacyPage() {
  const { config, footer, links } = getPublicSite();
  return (
    <PublicPage
      {...footer}
      eyebrow={`Privacy · ${config.policy.effectiveDate}`}
      introduction="PDFrig is designed for sensitive documents: process locally when practical, collect little, label cloud processing before upload, and delete temporary objects on a short schedule."
      links={links}
      title="Your PDF is not analytics."
    >
      <PublicSection title="Local work stays local.">
        <p>
          The browser viewer, organizer, annotations, supported forms, visual signatures,
          protection, metadata, image, and optimization tools run in the active browser tab. PDFrig
          does not receive those PDF bytes unless you separately choose an action labelled for cloud
          processing.
        </p>
      </PublicSection>
      <PublicSection title="Cloud processing is temporary and explicit.">
        <p>
          When an enabled OCR or Office conversion beta needs cloud processing, the action explains
          why, what is uploaded, the applicable limit, and deletion timing before upload. Input is
          deleted when no longer needed; output defaults to {config.policy.retention.outputHours}{' '}
          hour, with a {config.policy.retention.safetyNetHours}-hour lifecycle safety net.
        </p>
        <p>Processing-location disclosure: {config.policy.processingLocation}</p>
      </PublicSection>
      <PublicSection title="Account, billing, and support data have separate purposes.">
        <ul>
          <li>Identity and workspace membership support authentication and authorization.</li>
          <li>
            Stripe-hosted pages handle payment details; PDFrig stores necessary references only.
          </li>
          <li>
            Job history is content-free, opt-in, and defaults to{' '}
            {config.policy.retention.historyDays} days.
          </li>
          <li>
            Support starts with email, category, safe error code, and opaque request ID—never a PDF.
          </li>
        </ul>
      </PublicSection>
      <PublicSection title="Optional analytics require a separate choice.">
        <p>
          If enabled, the local consent control can send only approved event names, product surface,
          stable feature ID, result class, application version, and time. It does not send
          filenames, document text, PDF bytes, account identifiers, or a persistent cross-session
          identifier. Necessary authentication and billing state are separate from this choice.
        </p>
      </PublicSection>
      <PublicSection title="Your choices and contact.">
        <p>
          You can keep optional analytics off, opt out of content-free job history, delete cloud
          objects immediately, and request account deletion. Contact {config.brand.privacyContact}{' '}
          for access, correction, or privacy questions after the production address is approved.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
