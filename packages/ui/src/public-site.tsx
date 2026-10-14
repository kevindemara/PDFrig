import type { ReactNode } from 'react';

import { BrandLockup } from './brand-lockup.js';

export interface PublicSiteLinks {
  readonly account: string;
  readonly help: string;
  readonly home: string;
  readonly knownLimits: string;
  readonly pricing: string;
  readonly privacy: string;
  readonly refunds: string;
  readonly retention: string;
  readonly security: string;
  readonly status: string;
  readonly subprocessors: string;
  readonly support: string;
  readonly terms: string;
  readonly tools: string;
  readonly workspace: string;
}

export interface PublicSiteFooterProps {
  readonly legalEntity: string;
  readonly links: PublicSiteLinks;
  readonly policyStatus: 'approved' | 'development-draft';
  readonly supportEmail: string;
}

export const PublicSiteHeader = ({ links }: { readonly links: PublicSiteLinks }) => (
  <header className="marketing-nav public-site-nav">
    <a aria-label="PDFrig home" className="brand-link" href={links.home}>
      <BrandLockup />
    </a>
    <nav aria-label="Primary navigation" className="marketing-nav__links">
      <a href={links.tools}>All tools</a>
      <a href={links.pricing}>Pricing</a>
      <a href={links.security}>Security & privacy</a>
      <a href={links.help}>Help</a>
      <a href={links.account}>Account</a>
    </nav>
    <a className="button button--quiet marketing-nav__action" href={links.workspace}>
      Open local workspace
    </a>
  </header>
);

export const PublicSiteFooter = ({
  legalEntity,
  links,
  policyStatus,
  supportEmail,
}: PublicSiteFooterProps) => (
  <footer className="public-footer">
    <div className="public-footer__brand">
      <BrandLockup />
      <p>
        Build better PDFs with plain limits, careful output, and local processing when practical.
      </p>
    </div>
    <nav aria-label="Product and support" className="public-footer__links">
      <strong>Product</strong>
      <a href={links.pricing}>Pricing</a>
      <a href={links.knownLimits}>Known limitations</a>
      <a href={links.status}>Service status</a>
      <a href={links.support}>Contact support</a>
    </nav>
    <nav aria-label="Policies" className="public-footer__links">
      <strong>Policies</strong>
      <a href={links.privacy}>Privacy</a>
      <a href={links.terms}>Terms</a>
      <a href={links.refunds}>Refunds & cancellation</a>
      <a href={links.retention}>Retention</a>
      <a href={links.subprocessors}>Subprocessors</a>
    </nav>
    <div className="public-footer__meta">
      <p>{legalEntity}</p>
      <p>{supportEmail}</p>
      <p>
        {policyStatus === 'approved' ? 'Approved public policies' : 'Development policy drafts'}
      </p>
    </div>
  </footer>
);

export interface PublicPageProps extends PublicSiteFooterProps {
  readonly children: ReactNode;
  readonly eyebrow: string;
  readonly introduction: string;
  readonly title: string;
}

export const PublicPage = ({
  children,
  eyebrow,
  introduction,
  legalEntity,
  links,
  policyStatus,
  supportEmail,
  title,
}: PublicPageProps) => (
  <div className="public-site">
    <PublicSiteHeader links={links} />
    <main className="public-page">
      <header className="public-page__hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{introduction}</p>
        {policyStatus === 'development-draft' && (
          <p className="draft-notice" role="note">
            Development draft — this page is local product evidence, not an approved public policy
            or legal commitment.
          </p>
        )}
      </header>
      <div className="public-page__body">{children}</div>
    </main>
    <PublicSiteFooter
      legalEntity={legalEntity}
      links={links}
      policyStatus={policyStatus}
      supportEmail={supportEmail}
    />
  </div>
);

export const PublicSection = ({
  children,
  eyebrow,
  title,
}: {
  readonly children: ReactNode;
  readonly eyebrow?: string;
  readonly title: string;
}) => (
  <section className="public-section">
    {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
    <h2>{title}</h2>
    {children}
  </section>
);
