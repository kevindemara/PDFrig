import { MarketingHome } from '@pdfmason/ui';

import { getPublicSite } from '../lib/public-site';

export default function MarketingPage() {
  const { footer, links } = getPublicSite();
  return <MarketingHome footer={footer} links={links} />;
}
