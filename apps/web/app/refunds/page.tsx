import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description: 'PDFrig subscription cancellation and refund disclosure draft.',
  title: 'Refunds & cancellation — PDFrig',
};

export default function RefundsPage() {
  const { config, footer, links } = getPublicSite();
  return (
    <PublicPage
      {...footer}
      eyebrow="Billing disclosure"
      introduction="Cancellation should be no harder than signup. Hosted billing shows the effective date before a customer confirms a change."
      links={links}
      title="Know what stops, and when."
    >
      <PublicSection title="Cancellation.">
        <p>
          The intended normal flow uses the hosted Customer Portal. A cancellation at period end
          keeps paid access until that period ends and prevents the next renewal. It does not extend
          temporary cloud-object retention. Immediate cancellation, refunds, fraud, or chargeback
          handling may change entitlement sooner under the approved policy.
        </p>
      </PublicSection>
      <PublicSection title="Refunds.">
        <p>{config.commerce.refundSummary}</p>
        <p>
          Any final policy must preserve rights required by applicable consumer law, state the
          process and timing, and appear before payment. Local development never accepts a real
          charge.
        </p>
      </PublicSection>
      <PublicSection title="Cloud allowance and saved results.">
        <p>
          A plan change does not restore used quota or keep outputs indefinitely. Completed output
          remains available only within its normal short retention; customers should download the
          copy they intend to keep.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
