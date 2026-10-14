import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description: 'Development terms draft for the PDFrig public beta.',
  title: 'Terms — PDFrig',
};

export default function TermsPage() {
  const { config, footer, links } = getPublicSite();
  return (
    <PublicPage
      {...footer}
      eyebrow={`Terms · ${config.policy.effectiveDate}`}
      introduction="These development terms describe the intended product boundaries. They cannot become effective until legal entity, jurisdiction, consumer, tax, warranty, and dispute terms are approved by counsel."
      links={links}
      title="Use the tools carefully and lawfully."
    >
      <PublicSection title="The service.">
        <p>
          PDFrig provides supported web and Windows tools for viewing, organizing, annotating,
          filling, visually signing, protecting, converting, OCR, and beta redaction workflows. A
          capability is supported only within its published input, platform, fidelity, and release
          limits.
        </p>
      </PublicSection>
      <PublicSection title="Your documents and authority.">
        <ul>
          <li>You keep ownership of your documents and outputs.</li>
          <li>You must have authority to process, decrypt, change, and share the files you use.</li>
          <li>
            Do not use the service to violate law, privacy, intellectual property, or another
            person's rights.
          </li>
          <li>Keep a trusted original and review every completed copy before relying on it.</li>
        </ul>
      </PublicSection>
      <PublicSection title="Important product limits.">
        <ul>
          <li>Adding text does not edit existing PDF text.</li>
          <li>
            A visual signature is not a certificate-backed digital signature or identity proof.
          </li>
          <li>Editing can invalidate an existing digital signature.</li>
          <li>Crop is not redaction; redaction stays beta-gated and fail-closed.</li>
          <li>
            OCR and Office conversion can make recognition or layout mistakes and require review.
          </li>
          <li>
            The interface does not make an exported PDF automatically accessible or
            archival-compliant.
          </li>
        </ul>
        <p>
          See the <a href={links.knownLimits}>known limitations</a> for the current engineering
          contract.
        </p>
      </PublicSection>
      <PublicSection title="Accounts, subscriptions, and cancellation.">
        <p>
          Cloud work and the full Windows entitlement can require a verified account and active
          plan. Server-side state—not a checkout redirect—controls access and quotas. Normal
          cancellation keeps access until the paid period ends unless a refund, fraud, or legal
          requirement calls for earlier change.
        </p>
      </PublicSection>
      <PublicSection title="Legal provisions still required.">
        <p>
          The approved agreement must still define the contracting entity, age/capacity, launch
          jurisdictions, service changes, suspension, renewal, taxes, refunds, disclaimers,
          liability, indemnity if appropriate, governing law, dispute process, termination, and
          notice method. Development does not fill those terms in by guesswork.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
