import type { Metadata } from 'next';

import { PublicPage, PublicSection } from '@pdfmason/ui';

import { formatPlanAmount, getPublicSite } from '../../lib/public-site';

export const metadata: Metadata = {
  description: 'Straightforward PDFrig Free and Pro plan information.',
  title: 'Pricing — PDFrig',
};

export default function PricingPage() {
  const { config, footer, links } = getPublicSite();
  const monthly = formatPlanAmount(config.commerce.proMonthlyMinor, config.commerce.currency);
  const annual = formatPlanAmount(config.commerce.proAnnualMinor, config.commerce.currency);
  return (
    <PublicPage
      {...footer}
      eyebrow="Plain pricing"
      introduction="Useful local tools stay free. Pro is for the complete Windows experience and costly cloud work, with limits stated before processing."
      links={links}
      title="Pay for the work that costs money."
    >
      <PublicSection title="Two individual plans, no output watermark.">
        <p>
          Amounts are shown in {config.commerce.currency}. The current catalogue is{' '}
          <strong>{config.commerce.pricingStatus}</strong> and cannot become a production offer
          until pricing, taxes, support cost, and refund wording are approved.
        </p>
        <div className="price-grid">
          <article className="price-card">
            <h3>PDFrig Free</h3>
            <div className="price-card__amount">
              <strong>$0</strong>
              <span>local tools</span>
            </div>
            <ul>
              <li>Open, search, organize, annotate, fill, and visually sign locally</li>
              <li>Local compression, protection, metadata, and image tools</li>
              <li>No account required for safe local work</li>
              <li>No PDFrig watermark</li>
            </ul>
            <a className="button button--secondary" href={links.workspace}>
              Open local workspace
            </a>
          </article>
          <article className="price-card price-card--featured">
            <h3>PDFrig Pro monthly</h3>
            <div className="price-card__amount">
              <strong>{monthly}</strong>
              <span>/ month</span>
            </div>
            <ul>
              <li>Full PDFrig for Windows entitlement</li>
              <li>Higher limits and paid cloud beta allowances</li>
              <li>OCR and Office conversion only when their release gates are enabled</li>
              <li>Billing managed through hosted Stripe pages</li>
            </ul>
            <a className="button button--primary" href={links.account}>
              Review account options
            </a>
          </article>
          <article className="price-card">
            <h3>PDFrig Pro annual</h3>
            <div className="price-card__amount">
              <strong>{annual}</strong>
              <span>/ year</span>
            </div>
            <ul>
              <li>The same individual entitlement as Pro monthly</li>
              <li>Normal cancellation keeps access through the paid period</li>
              <li>Temporary cloud objects keep their normal short retention</li>
              <li>Team pricing is not part of the beta offer</li>
            </ul>
            <a className="button button--secondary" href={links.refunds}>
              Refunds & cancellation
            </a>
          </article>
        </div>
      </PublicSection>
      <PublicSection eyebrow="Before checkout" title="Limits and taxes are part of the price.">
        <p>
          Cloud quotas are measured in cost-aligned units such as OCR pages and Office documents.
          Applicable taxes and the final renewal disclosure must appear in the hosted checkout
          before payment. Local development never processes a real purchase.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
