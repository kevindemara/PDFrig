// Private artifact profiles only. No production identity or release approval is granted here.
export function internalWindowsProfile(args = []) {
  const qa = args.includes('--installer-qa');
  const branded = args.includes('--private-test');
  if (qa && branded) throw new Error('Choose only one internal installer profile.');
  if (args.some((arg) => !['--installer-qa', '--private-test'].includes(arg)))
    throw new Error('Unknown internal installer option.');
  return Object.freeze(
    branded
      ? {
          version: '0.1.0-alpha.20261019.3',
          buildId: 'private-test-20261019-branded',
          productName: 'PDFrig',
          title: 'PDFrig',
          identifier: 'com.pdfmason.desktop.privatetest',
          publisher: 'PDFrig',
          description: 'PDFrig — Build better PDFs. Local PDF editing for Windows.',
        }
      : {
          version: qa ? '0.1.0-alpha.20261019.2' : '0.1.0-alpha.20261012.1',
          buildId: qa ? 'installer-qa-20261019-export-fix' : 'internal-pdfrig-20261012',
          productName: qa ? 'PDFrig Installer QA' : 'PDFrig Internal Test',
          title: qa ? 'PDFrig — Installer QA' : 'PDFrig — Internal testing',
          identifier: qa ? 'com.pdfmason.desktop.installerqa' : 'com.pdfmason.desktop.internal',
          publisher: 'PDFrig development',
          description: 'PDFrig internal test build. Not approved for public distribution.',
        },
  );
}

export function applyInternalWindowsProfile(config, profile) {
  config.productName = profile.productName;
  config.app = {
    windows: [
      {
        label: 'main',
        title: profile.title,
        width: 1280,
        height: 820,
        minWidth: 760,
        minHeight: 600,
        dragDropEnabled: false,
        resizable: true,
      },
    ],
  };
  config.bundle.publisher = profile.publisher;
  config.bundle.shortDescription = profile.description;
  config.bundle.longDescription = profile.description;
  config.bundle.fileAssociations = [];
  return config;
}
