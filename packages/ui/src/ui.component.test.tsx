import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { calibrateMeasurement, createPageMeasurement } from '@pdfmason/editor-core';
import * as pdfEngine from '@pdfmason/pdf-engine/browser';
import { MeasurementPanel } from './measurement-panel.js';
import { DecorationWorkbench } from './decoration-workbench.js';
import { DecorationPlacementPanel } from './decoration-placement-panel.js';
import { reviewDecorationSourcePage } from './decoration-source-review.js';
import { supportedImageMimeType } from './image-input.js';
import { DeveloperCredit } from './developer-credit.js';

import {
  AccountDashboard,
  BrandLockup,
  MarketingHome,
  parseSavedCustomStamps,
  UtilityWorkbench,
  WorkspaceShell,
} from './index.js';

describe('shared application shell', () => {
  it.each([
    ['Web', '/tools'],
    ['Windows', '#tools'],
  ] as const)(
    'VIEW-001 exposes All tools on %s and uses its host-local route',
    (surface, toolsHref) => {
      const assign = vi.spyOn(globalThis.location, 'assign').mockImplementation(() => undefined);
      const confirm = vi.fn().mockReturnValue(false);
      vi.stubGlobal('confirm', confirm);
      try {
        render(<WorkspaceShell surface={surface} toolsHref={toolsHref} />);
        const tools = screen.getByRole('button', { name: /^All tools$/u });
        expect(tools).toBeEnabled();
        fireEvent.click(tools);
        expect(assign).toHaveBeenCalledExactlyOnceWith(toolsHref);
        expect(confirm).not.toHaveBeenCalled();
      } finally {
        assign.mockRestore();
        vi.unstubAllGlobals();
      }
    },
  );

  it('shows a developer GitHub credit separately from document status', () => {
    render(<WorkspaceShell surface="Web" />);
    const footer = screen.getByRole('contentinfo');
    const credit = within(footer).getByRole('link', { name: 'Kevin DeMara on GitHub' });
    expect(credit).toHaveAttribute('href', 'https://github.com/kevindemara');
    expect(credit).toHaveAttribute('target', '_blank');
    expect(credit).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(footer).getByText('On this device')).toBeVisible();
    expect(within(footer).getByText('0 pages')).toBeVisible();
    expect(within(footer).getByText('100%')).toBeVisible();
  });

  it('opens the fixed developer profile through the Windows adapter without navigating the editor', () => {
    const openProfile = vi.fn().mockResolvedValue(undefined);
    render(<DeveloperCredit openProfile={openProfile} />);
    const cancelled = !fireEvent.click(
      screen.getByRole('link', { name: 'Kevin DeMara on GitHub' }),
    );
    expect(cancelled).toBe(true);
    expect(openProfile).toHaveBeenCalledExactlyOnceWith();
  });

  it('handles native profile-opening failure without leaking diagnostics or changing a document', async () => {
    const openProfile = vi.fn().mockRejectedValue(new Error('private native details'));
    render(<DeveloperCredit openProfile={openProfile} />);
    fireEvent.click(screen.getByRole('link', { name: 'Kevin DeMara on GitHub' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Couldn’t open GitHub.');
    expect(screen.queryByText('private native details')).not.toBeInTheDocument();
    openProfile.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('link', { name: 'Kevin DeMara on GitHub' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('keeps file entry points disabled in server HTML and enables them after hydration', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<WorkspaceShell surface="Web" />);
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type="file"]'))
      expect(input.disabled).toBe(true);
    const open = container.querySelector<HTMLButtonElement>('button[title="Open PDF"]');
    expect(open?.disabled).toBe(true);
    expect(
      [...container.querySelectorAll('button')].find((button) => button.textContent === 'All tools')
        ?.disabled,
    ).toBe(true);
    const view = render(<WorkspaceShell surface="Web" />);
    expect(view.getByLabelText('Open PDF')).toBeEnabled();
    expect(view.getByRole('button', { name: 'Choose a PDF' })).toBeEnabled();
  });
  it('shows source sampling coverage, uncertainty, and warning navigation without certifying placement', () => {
    const navigate = vi.fn();
    render(
      <DecorationPlacementPanel
        pageNumber={1}
        selectedPages={[1, 2, 3, 4]}
        reviews={{
          1: {
            status: 'sampled',
            bands: [{ kind: 'header', top: 0.1, bottom: 0.2, finding: 'ink-detected' }],
          },
          2: { status: 'unavailable', reason: 'render' },
        }}
        busy={false}
        hasWatermark
        onNavigate={navigate}
      />,
    );
    expect(
      screen.getByText('1 of 4 selected pages sampled. 2 not checked. 1 unavailable.'),
    ).toBeVisible();
    expect(screen.getByText(/Warning: existing ink detected/u)).toBeVisible();
    expect(screen.getByText(/Text-area check unavailable/u)).toBeVisible();
    expect(screen.getByText(/Watermark placement is not sampled/u)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review next unchecked page' }));
    expect(navigate).toHaveBeenCalledWith(3);
    fireEvent.change(screen.getByLabelText('Pages needing attention'), { target: { value: '2' } });
    expect(navigate).toHaveBeenCalledWith(2);
  });

  it('distinguishes possible text overlap from other margin ink without a safe-placement claim', () => {
    const props = {
      pageNumber: 1,
      selectedPages: [1],
      busy: false,
      hasWatermark: false,
      onNavigate: vi.fn(),
    };
    const area = { kind: 'header' as const, top: 0.1, bottom: 0.2, left: 0.1, right: 0.2 };
    const view = render(
      <DecorationPlacementPanel
        {...props}
        reviews={{
          1: {
            status: 'sampled',
            bands: [
              {
                kind: 'header',
                top: 0.1,
                bottom: 0.2,
                finding: 'ink-detected',
                textArea: { status: 'sampled', finding: 'ink-detected', bounds: area },
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText(/Possible overlap: existing ink near the added text/u)).toBeVisible();
    view.rerender(
      <DecorationPlacementPanel
        {...props}
        reviews={{
          1: {
            status: 'sampled',
            bands: [
              {
                kind: 'header',
                top: 0.1,
                bottom: 0.2,
                finding: 'ink-detected',
                textArea: { status: 'sampled', finding: 'no-ink-detected', bounds: area },
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText(/Ink detected elsewhere in this margin band/u)).toBeVisible();
    expect(screen.getByText(/Nothing here certifies safe placement/u)).toBeVisible();
    expect(screen.getByLabelText('Pages needing attention')).toBeVisible();
  });

  it('does not present unavailable, unvisited, or unselected pages as sampled negatives', () => {
    const view = render(
      <DecorationPlacementPanel
        pageNumber={1}
        selectedPages={[1, 2]}
        reviews={{ 1: { status: 'unavailable', reason: 'render' } }}
        busy
        hasWatermark={false}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText(/Check unavailable for this page/u)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review next unchecked page' })).toBeDisabled();
    view.rerender(
      <DecorationPlacementPanel
        pageNumber={3}
        selectedPages={[1, 2]}
        reviews={{}}
        busy={false}
        hasWatermark={false}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText(/No marks on this page/u)).toBeVisible();
  });

  it('source sampling handles oversized pages, renderer errors, and stale completion without leaking raw errors', async () => {
    const options = {
      header: { text: 'Review', alignment: 'left' as const, color: '#17232d', fontSize: 9 },
      footer: null,
      watermark: null,
      marginPoints: 28,
      pageSelection: 'all' as const,
    };
    const renderPage = vi.fn(() => Promise.reject(new Error('restricted synthetic canary')));
    const source = {
      pageCount: 1,
      getPageMetrics: vi.fn(() => Promise.resolve({ width: 612, height: 792, rotation: 0 })),
      renderPage,
    };
    expect(await reviewDecorationSourcePage(source, 1, options, () => true)).toEqual({
      status: 'unavailable',
      reason: 'render',
    });
    expect(renderPage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 1, 0, 1);
    renderPage.mockClear();
    source.getPageMetrics.mockResolvedValue({ width: 2049, height: 792, rotation: 0 });
    expect(await reviewDecorationSourcePage(source, 1, options, () => true)).toMatchObject({
      reason: 'geometry',
    });
    expect(renderPage).not.toHaveBeenCalled();
    expect(await reviewDecorationSourcePage(source, 1, options, () => false)).toMatchObject({
      reason: 'render',
    });
  });
  it.each(['failure', 'stale'] as const)(
    'keeps metric %s distinct from a negative text-area finding and releases the raster',
    async (scenario) => {
      let current = true;
      const metrics = vi.spyOn(pdfEngine, 'measureDecorationTextAreas').mockImplementation(() => {
        if (scenario === 'stale') current = false;
        return Promise.reject(new Error('restricted metric canary'));
      });
      const data = new Uint8ClampedArray(100 * 100 * 4);
      for (let pixel = 0; pixel < 100 * 100; pixel++) data[pixel * 4 + 3] = 255;
      const getImageData = vi.fn(() => ({ width: 100, height: 100, data }));
      // Minimal raster/RenderTask doubles: the helper only reads pixels after render resolves.
      const context = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);
      const renderPage = vi.fn((canvas: HTMLCanvasElement) => {
        canvas.width = 100;
        canvas.height = 100;
        return Promise.resolve(
          {} as Awaited<ReturnType<pdfEngine.BrowserPdfDocument['renderPage']>>,
        );
      });
      try {
        const result = await reviewDecorationSourcePage(
          {
            pageCount: 1,
            getPageMetrics: () => Promise.resolve({ width: 100, height: 100, rotation: 0 }),
            renderPage,
          },
          1,
          {
            header: { text: 'Review', alignment: 'left', color: '#17232d', fontSize: 9 },
            footer: null,
            watermark: null,
            marginPoints: 28,
            pageSelection: 'all',
          },
          () => current,
        );
        if (scenario === 'failure') {
          expect(result).toMatchObject({
            status: 'sampled',
            bands: [
              {
                finding: 'ink-detected',
                textArea: { status: 'unavailable' },
              },
            ],
          });
        } else {
          expect(result).toEqual({ status: 'unavailable', reason: 'render' });
          expect(getImageData).not.toHaveBeenCalled();
        }
        expect(JSON.stringify(result)).not.toContain('canary');
        const canvas = renderPage.mock.calls[0]?.[0];
        expect(canvas?.width).toBe(1);
        expect(canvas?.height).toBe(1);
      } finally {
        metrics.mockRestore();
        context.mockRestore();
      }
    },
  );
  it.each(['opening', 'rendering'] as const)(
    'releases source and candidate documents when cancelled during source %s',
    async (stage) => {
      let finish: () => void = () => undefined;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const candidate = { pageCount: 1, destroy: vi.fn(() => Promise.resolve()) };
      const source = {
        pageCount: 1,
        getPageMetrics: vi.fn(() => Promise.resolve({ width: 612, height: 792, rotation: 0 })),
        renderPage: vi.fn(async () => {
          await pending;
          throw new Error('synthetic cancellation');
        }),
        destroy: vi.fn(() => Promise.resolve()),
      };
      // Deliberately minimal document doubles: cancelled work must never render the candidate.
      const open = vi
        .spyOn(pdfEngine, 'openBrowserPdf')
        .mockResolvedValueOnce(candidate as unknown as pdfEngine.BrowserPdfDocument)
        .mockImplementationOnce(async () => {
          if (stage === 'opening') await pending;
          return source as unknown as pdfEngine.BrowserPdfDocument;
        });
      const postMessage = vi.fn();
      const worker = Object.assign(new EventTarget(), { postMessage, terminate: vi.fn() });
      const view = render(<DecorationWorkbench createWorker={() => worker as unknown as Worker} />);
      try {
        const input = view.container.querySelector('input[type="file"]');
        if (input === null) throw new Error('Missing synthetic file chooser');
        fireEvent.change(input, {
          target: {
            files: [new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' })],
          },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Build preview' }));
        await waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
        const request: unknown = postMessage.mock.calls[0]?.[0];
        if (typeof request !== 'object' || request === null || !('id' in request))
          throw new Error('Missing worker request');
        act(() => {
          worker.dispatchEvent(
            new MessageEvent('message', {
              data: {
                id: request.id,
                ok: true,
                payload: { kind: 'bytes', bytes: new Uint8Array([37, 80, 68, 70]) },
              },
            }),
          );
        });
        await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
        expect(open.mock.calls[1]?.[1]).toEqual({ strictParsing: true });
        if (stage === 'rendering')
          await waitFor(() => expect(source.renderPage).toHaveBeenCalledOnce());
        fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
        expect(candidate.destroy).toHaveBeenCalledOnce();
        await act(async () => {
          finish();
          await pending;
        });
        await waitFor(() => expect(source.destroy).toHaveBeenCalledOnce());
        expect(screen.getByRole('status')).toHaveTextContent('cancelled');
        expect(screen.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
        expect(screen.queryByRole('region', { name: 'Placement warnings' })).toBeNull();
      } finally {
        finish();
        view.unmount();
        open.mockRestore();
      }
    },
  );
  it('requires a current reviewed decoration preview and validates the custom range', () => {
    render(<DecorationWorkbench />);
    expect(screen.getByRole('button', { name: 'Build preview' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Apply to pages'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('PDF page range'), { target: { value: '1-3,3' } });
    expect(screen.getByText('Check the text, range, size, and margin settings.')).toBeVisible();
    expect(screen.getByText(/not an overlap or accessibility certification/u)).toBeVisible();
  });

  it.each(['settings', 'cancel', 'replacement', 'unmount'] as const)(
    'cancels in-flight decoration work after %s and ignores late replies',
    async (action) => {
      const postMessage = vi.fn();
      const terminate = vi.fn();
      // Minimal event-capable worker double: this test intentionally never produces PDF bytes.
      const worker = Object.assign(new EventTarget(), { postMessage, terminate });
      const view = render(<DecorationWorkbench createWorker={() => worker as unknown as Worker} />);
      const input = view.container.querySelector('input[type="file"]');
      if (input === null) throw new Error('Missing synthetic file chooser');
      fireEvent.change(input, {
        target: {
          files: [new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' })],
        },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Build preview' }));
      await waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
      expect(screen.getByRole('button', { name: 'Cancel preview' })).toBeVisible();
      if (action === 'settings')
        fireEvent.change(screen.getByLabelText('Header text (optional)'), {
          target: { value: 'Changed' },
        });
      else if (action === 'cancel')
        fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
      else if (action === 'replacement')
        fireEvent.change(input, {
          target: { files: [new File(['%PDF-next'], 'next.pdf', { type: 'application/pdf' })] },
        });
      else view.unmount();
      expect(terminate).toHaveBeenCalledOnce();
      const request: unknown = postMessage.mock.calls[0]?.[0];
      if (typeof request !== 'object' || request === null || !('id' in request))
        throw new Error('Missing worker request');
      worker.dispatchEvent(
        new MessageEvent('message', {
          data: { id: request.id, ok: false, message: 'late synthetic error' },
        }),
      );
      if (action !== 'unmount') {
        await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent('Building'));
        expect(screen.getByRole('status')).not.toHaveTextContent('could not be built');
        expect(screen.getByRole('button', { name: 'Download reviewed copy' })).toBeDisabled();
      }
      view.unmount();
    },
  );
  it('shows calibration, units, precision, and non-export limitations for ANNO-008', () => {
    const onChange = vi.fn();
    const metrics = { width: 600, height: 800 };
    const measurement = calibrateMeasurement(createPageMeasurement('synthetic'), metrics, 3, 'm');
    render(<MeasurementPanel measurement={measurement} metrics={metrics} onChange={onChange} />);
    expect(screen.getByLabelText('Measurement result')).toHaveTextContent('3.00 m');
    expect(screen.getByText(/Display precision is not accuracy/u)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Decimal places'), { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith({ ...measurement, precision: 4 });
    fireEvent.click(screen.getByRole('button', { name: 'Clear calibration' }));
    expect(onChange).toHaveBeenCalledWith({ ...measurement, calibration: null });
  });

  it('keeps measurement unavailable by default and reports geometry failure safely', () => {
    const shell = render(<WorkspaceShell surface="Web" />);
    expect(screen.queryByRole('button', { name: 'Measure' })).toBeNull();
    shell.unmount();
    render(
      <MeasurementPanel
        geometryUnavailable
        measurement={createPageMeasurement('synthetic')}
        metrics={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Measurement result')).toHaveTextContent(
      'Page geometry could not be read safely',
    );
    expect(screen.getByRole('button', { name: 'Calibrate from A–B' })).toBeDisabled();
  });
  it('uses the approved PDFrig logo and truthful local-workspace copy', () => {
    render(
      <MarketingHome
        footer={{
          legalEntity: 'PDFrig development',
          policyStatus: 'development-draft',
          supportEmail: 'support@example.invalid',
        }}
        links={{
          account: '/account',
          help: '/help',
          home: '/',
          knownLimits: '/known-limitations',
          pricing: '/pricing',
          privacy: '/privacy',
          refunds: '/refunds',
          retention: '/retention',
          security: '/security',
          status: '/status',
          subprocessors: '/subprocessors',
          support: '/support',
          terms: '/terms',
          tools: '/tools',
          workspace: '/workspace',
        }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Build better PDFs.' })).toBeVisible();
    expect(screen.getByText(/view, organize, annotate, fill/i)).toBeVisible();
    expect(screen.getAllByRole('img', { name: 'PDFrig' })).toHaveLength(2);
    expect(screen.queryByText('Logo placeholder')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PDFrig home' })).toHaveAttribute('href', '/');
  });

  it('keeps the compact PDFrig logo accessible and intrinsic image sizing stable', () => {
    render(<BrandLockup compact />);
    const logo = screen.getByRole('img', { name: 'PDFrig' });
    expect(logo).toHaveAttribute('src', '/brand/pdfrig-logo.png');
    expect(logo).toHaveAttribute('width', '2172');
    expect(logo).toHaveAttribute('height', '724');
    expect(logo.parentElement).toHaveClass('brand-lockup--compact');
  });

  it('shares a truthful local utility bench across web and Windows surfaces', () => {
    render(<UtilityWorkbench surface="Web" />);
    expect(
      screen.getByRole('heading', { name: 'Finish a PDF job without surrendering the file.' }),
    ).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'PDF utility tools' })).toBeVisible();
    expect(screen.getAllByText('On this device')).not.toHaveLength(0);
    expect(screen.getByText(/lossless only/i)).toBeVisible();
    expect(screen.getByText(/office to pdf/i)).toBeVisible();
  });

  it('fails closed to the first enabled local utility when a capability is disabled', () => {
    render(
      <UtilityWorkbench
        enabledFeatures={{
          blank: true,
          text: false,
          compress: false,
          decorate: true,
          geometry: true,
          images: true,
          metadata: true,
          number: true,
          permissions: false,
          protect: true,
          render: true,
        }}
        surface="Windows"
      />,
    );
    expect(
      screen.getByRole('button', { name: /Compress.*Temporarily unavailable/u }),
    ).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Protect / unlock' })).toBeVisible();
  });

  it('creates a source-free CREATE-001 setup with measured page and margin controls', () => {
    const view = render(<UtilityWorkbench surface="Web" />);
    const local = within(view.container);
    fireEvent.click(local.getByRole('button', { name: /Create blank PDF/u }));
    expect(local.getByRole('heading', { name: 'Create blank PDF' })).toBeVisible();
    expect(local.queryByLabelText(/Choose a PDF/u)).toBeNull();
    expect(local.getByRole('button', { name: 'Create export' })).toBeEnabled();
    expect(local.getByLabelText('Blank page preview')).toHaveTextContent('612 × 792 pt');
    fireEvent.change(local.getByLabelText('Page size'), { target: { value: 'a4' } });
    fireEvent.change(local.getByLabelText('Orientation'), { target: { value: 'landscape' } });
    fireEvent.change(local.getByLabelText('Content-safe margin'), { target: { value: '72' } });
    expect(local.getByLabelText('Blank page preview')).toHaveTextContent('841.89 × 595.28 pt');
    expect(local.getByRole('status')).toHaveTextContent('Settings changed');
    expect(local.getByText(/ordinary readers may not display that guide/i)).toBeVisible();
  });

  it('bounds CREATE-001 page count and explains that the preview is representative', () => {
    const view = render(<UtilityWorkbench surface="Windows" />);
    const local = within(view.container);
    fireEvent.click(local.getByRole('button', { name: /Create blank PDF/u }));
    const count = local.getByLabelText('Number of pages');
    for (const value of ['', '0', '-1', '1.5', '501']) {
      fireEvent.change(count, { target: { value } });
      expect(local.getByRole('button', { name: 'Create export' })).toBeDisabled();
      expect(count).toHaveAttribute('aria-invalid', 'true');
      expect(local.getByRole('alert')).toHaveTextContent('whole page count from 1 to 500');
    }
    for (const value of ['1', '3', '500']) {
      fireEvent.change(count, { target: { value } });
      expect(local.getByRole('button', { name: 'Create export' })).toBeEnabled();
      expect(count).toHaveAttribute('aria-invalid', 'false');
      expect(local.queryByRole('alert')).toBeNull();
      expect(local.getByLabelText('Blank page preview')).toHaveTextContent(`${value} blank page`);
    }
    expect(local.getByText(/preview shows one page’s geometry/u)).toBeVisible();
  });

  it('accepts WebP and extension-derived image types for ORG-008 and CREATE-002', () => {
    expect(supportedImageMimeType(new File(['x'], 'synthetic.webp', { type: '' }))).toBe(
      'image/webp',
    );
    expect(
      supportedImageMimeType(new File(['x'], 'synthetic.svg', { type: 'image/svg+xml' })),
    ).toBe(null);
    const view = render(<UtilityWorkbench surface="Windows" />);
    const local = within(view.container);
    fireEvent.click(local.getByRole('button', { name: /Images to PDF/u }));
    const input = view.container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['RIFF synthetic'], 'synthetic.webp', { type: 'image/webp' })] },
    });
    expect(local.getByRole('status')).toHaveTextContent('1 image ready');
    expect(local.getByText(/WebP and EXIF-oriented images are normalized to PNG/i)).toBeVisible();
  });

  it('exposes page-label and Bates controls with a deterministic local preview', () => {
    const view = render(<UtilityWorkbench surface="Web" />);
    const local = within(view.container);
    fireEvent.click(local.getByRole('button', { name: /Page \+ Bates numbering/u }));
    expect(local.getByRole('heading', { name: 'Page + Bates numbering' })).toBeVisible();
    expect(local.getByLabelText('Numbering preview')).toHaveTextContent('PDFM-1');
    fireEvent.click(local.getByRole('button', { name: 'Bates sequence' }));
    expect(local.getByLabelText('Minimum digits')).toHaveValue(6);
    expect(local.getByText(/produces a local JSON export report/i)).toBeVisible();
    expect(local.getByText(/Identifiers that do not fit.*stop safely/u)).toBeVisible();
    expect(local.getByText(/sequence preview does not check placement/u)).toBeVisible();
  });

  it('ORG-011 previews repeated-letter boundaries and bounds the known range', () => {
    const view = render(<UtilityWorkbench surface="Web" />);
    const local = within(view.container);
    fireEvent.click(local.getByRole('button', { name: /Page \+ Bates numbering/u }));
    fireEvent.change(local.getByLabelText('Number style'), { target: { value: 'letters-upper' } });
    fireEvent.change(local.getByLabelText('Start number'), { target: { value: '26' } });
    const preview = within(local.getByLabelText('Numbering preview'));
    expect(preview.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'PDFM-Z',
      'PDFM-AA',
      'PDFM-BB',
    ]);
    fireEvent.change(local.getByLabelText('Last PDF page (optional)'), { target: { value: '1' } });
    expect(preview.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(local.getByLabelText('Start number'), { target: { value: '999999999' } });
    expect(preview.getByText(/120-character limit/u)).toBeVisible();
    expect(preview.queryByRole('list')).not.toBeInTheDocument();
  });

  it('ORG-012 shows safe control-character errors and preserves literal preview spaces', () => {
    const view = render(<UtilityWorkbench surface="Windows" />);
    const local = within(view.container);
    fireEvent.click(local.getByRole('button', { name: /Page \+ Bates numbering/u }));
    fireEvent.click(local.getByRole('button', { name: 'Bates sequence' }));
    fireEvent.change(local.getByLabelText('Prefix (optional)'), { target: { value: 'QA\u0000' } });
    const preview = within(local.getByLabelText('Numbering preview'));
    expect(preview.getByText(/without tabs or control characters/u)).toBeVisible();
    expect(preview.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.change(local.getByLabelText('Prefix (optional)'), { target: { value: ' QA  ' } });
    const first = preview.getAllByRole('listitem')[0];
    expect(first?.textContent).toBe(' QA  000001');
    expect(first).toHaveStyle({ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' });
  });

  it('states that crop is not redaction and exposes measured resize controls', () => {
    const view = render(<UtilityWorkbench surface="Web" />);
    const local = within(view.container);
    fireEvent.click(local.getByRole('button', { name: /Crop \+ resize pages/u }));
    expect(local.getByRole('heading', { name: 'Crop + resize pages' })).toBeVisible();
    expect(local.getByText(/hidden content remains in the PDF/i)).toBeVisible();
    fireEvent.click(local.getByRole('button', { name: 'Normalize page size' }));
    expect(local.getByLabelText('Content fit')).toHaveValue('contain');
    expect(local.getByLabelText('Page geometry preview')).toBeVisible();
  });

  it('shows explicit cloud processing, retention, billing, and deletion controls', () => {
    render(
      <AccountDashboard
        initialSnapshot={{
          email: 'local@example.invalid',
          emailVerified: true,
          entitlements: [
            {
              enabled: true,
              featureKey: 'cloud.demo.integrity',
              limitUnit: 'jobs',
              limitValue: 3,
              usedValue: 0,
            },
          ],
          historyEnabled: false,
          jobs: [],
          localDemo: true,
          planKey: 'free',
          processingRegion: 'Local development',
          retention: { historyDays: 30, outputHours: 1, safetyNetHours: 24 },
          subscriptionStatus: 'none',
          workspaceId: '02222222-2222-4222-8222-222222222222',
        }}
        workspaceHref="/workspace"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Processing you can account for.' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run safe cloud check' })).toBeVisible();
    expect(screen.getByText('Normal output deletion')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Request account deletion' })).toBeDisabled();
  });

  it('exposes the main workspace regions and processing location in semantic HTML', () => {
    render(<WorkspaceShell surface="Web" />);
    expect(screen.getByRole('navigation', { name: 'Editor tools' })).toBeVisible();
    expect(screen.getByLabelText('Pages options')).toBeVisible();
    expect(screen.getByLabelText('Page properties and search')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Drop in a PDF.' })).toBeVisible();
    expect(screen.getAllByText('On this device')).not.toHaveLength(0);
    expect(screen.getByText(/never uploaded/i)).toBeVisible();
  });

  it('VIEW-001 gives every editor tool an original decorative SVG without changing accessible labels', () => {
    render(<WorkspaceShell measurementEnabled stampsEnabled surface="Web" />);
    const rail = screen.getByRole('navigation', { name: 'Editor tools' });
    const tools = rail.querySelectorAll<HTMLButtonElement>('li button');
    expect(tools).toHaveLength(14);
    for (const button of tools) {
      const icon = button.querySelector('svg[data-tool-icon]');
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
      expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
      expect(button.querySelector('.tool-glyph')).toHaveTextContent('');
      expect(button).toHaveAccessibleName(button.textContent);
    }
    expect(within(rail).getByRole('button', { name: 'Pages' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(rail).getByRole('button', { name: 'Redact beta' })).toBeDisabled();
  });

  it('VIEW-001 VIEW-004 collapses contextual content independently without changing tool gates', () => {
    render(<WorkspaceShell surface="Web" />);
    const collapse = screen.getByRole('button', { name: 'Collapse tool options' });
    expect(collapse).toHaveAttribute('aria-controls', 'workspace-context-content');
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapse);
    expect(screen.getByRole('button', { name: 'Expand tool options' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText('Page thumbnails appear after you open a PDF.')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Collapse tools' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Pages' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Expand tool options' }));
    expect(screen.getByRole('button', { name: 'Collapse tool options' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Page thumbnails appear after you open a PDF.')).toBeVisible();
  });

  it('VIEW-001 collapses only tool labels without changing tool access or selection', () => {
    render(<WorkspaceShell measurementEnabled stampsEnabled surface="Web" />);
    const collapse = screen.getByRole('button', { name: 'Collapse tools' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(collapse).toHaveAttribute('aria-controls', 'workspace-tool-list');
    fireEvent.click(collapse);
    expect(screen.getByRole('button', { name: 'Expand tools' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('navigation', { name: 'Editor tools' }).parentElement).toHaveClass(
      'workspace-grid--tools-collapsed',
    );
    expect(screen.getByRole('button', { name: 'Pages' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Text' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Expand tools' }));
    expect(screen.getByRole('button', { name: 'Collapse tools' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('navigation', { name: 'Editor tools' }).parentElement).not.toHaveClass(
      'workspace-grid--tools-collapsed',
    );
  });

  it('ignores a native drop without transfer data and leaves the current workspace unchanged', () => {
    render(<WorkspaceShell surface="Web" />);
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: null });
    expect(() => fireEvent(screen.getByRole('main'), event)).not.toThrow();
    expect(screen.getByRole('heading', { name: 'Drop in a PDF.' })).toBeVisible();
    expect(screen.getByLabelText('Document status')).toHaveTextContent('Original unchanged');
  });

  it('keeps the Milestone 8 stamp surface behind its explicit capability flag', () => {
    render(<WorkspaceShell stampsEnabled surface="Web" />);
    expect(screen.getByRole('button', { name: 'Stamp' })).toBeDisabled();
  });

  it('accepts only bounded exact-schema custom stamp records from device storage', () => {
    expect(
      parseSavedCustomStamps(
        JSON.stringify([
          { color: '#26756f', id: 'safe', text: 'QA passed' },
          { color: '#26756f', id: 'unicode', text: 'Not supported ☃' },
          { color: '#26756f', extra: 'untrusted', id: 'extra', text: 'Extra field' },
        ]),
      ),
    ).toEqual([{ color: '#26756f', id: 'safe', text: 'QA passed' }]);
    expect(parseSavedCustomStamps('{not-json')).toEqual([]);
  });
});

describe('ORG-011 / ORG-012 result lifecycle', () => {
  const settle = async (action: () => void): Promise<void> => {
    await act(async () => {
      action();
      await Promise.resolve();
    });
  };
  const setup = () => {
    // Only the Worker transport is doubled; exercise the real client and React event lifecycle.
    const workers: ReturnType<typeof makeWorker>[] = [];
    const makeWorker = () =>
      Object.assign(new EventTarget(), {
        postMessage: vi.fn<(request: pdfEngine.PdfWorkerRequest) => void>(),
        terminate: vi.fn(),
      });
    const createWorker = () => {
      const worker = makeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    };
    const view = render(<UtilityWorkbench createWorker={createWorker} surface="Windows" />);
    const ui = within(view.container);
    fireEvent.click(ui.getByRole('button', { name: /Page \+ Bates numbering/u }));
    const select = (
      files = [new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' })],
    ) => {
      const input = view.container.querySelector('input[type="file"]');
      if (input === null) throw new Error('Missing synthetic chooser');
      fireEvent.change(input, { target: { files } });
    };
    select();
    const start = async () => {
      fireEvent.click(ui.getByRole('button', { name: 'Create export' }));
      await waitFor(() => expect(workers.at(-1)?.postMessage).toHaveBeenCalled());
      const worker = workers.at(-1);
      const request = worker?.postMessage.mock.calls.at(-1)?.[0];
      if (worker === undefined || request?.kind !== 'number')
        throw new Error('Missing numbering request');
      return { worker, request };
    };
    const finish = ({ worker, request }: Awaited<ReturnType<typeof start>>, ok = true) => {
      const identifier = pdfEngine.formatNumberingIdentifier(request.options, 0);
      const response: pdfEngine.PdfWorkerResponse = ok
        ? {
            id: request.id,
            ok: true,
            payload: {
              kind: 'numbering',
              bytes: new Uint8Array([37, 80, 68, 70]),
              report: {
                appliedPages: 1,
                firstIdentifier: identifier,
                lastIdentifier: identifier,
                kind: request.options.kind,
                operationVersion: '1.0.3',
                range: { startPage: 1, endPage: 1 },
                sourcePages: 1,
              },
            },
          }
        : { id: request.id, ok: false, message: 'restricted stale failure canary' };
      worker.dispatchEvent(new MessageEvent('message', { data: response }));
    };
    const noDownload = () => {
      expect(ui.queryByRole('button', { name: 'Download new copy' })).toBeNull();
      expect(ui.queryByRole('button', { name: 'Download numbering report' })).toBeNull();
    };
    return { ...view, ui, select, start, finish, noDownload, workers };
  };

  it.each([
    ['Prefix (optional)', 'NEW-'],
    ['Number style', 'letters-upper'],
    ['Start number', '7'],
    ['Start number', '0'],
    ['First PDF page', '2'],
    ['Last PDF page (optional)', '1'],
    ['Position', 'header'],
    ['Alignment', 'left'],
    ['Minimum digits', '8'],
    ['Suffix (optional)', '-END'],
    ['mode', 'bates'],
    ['replacement consent', 'true'],
  ])('clears both completed downloads after changing %s', async (label, value) => {
    const test = setup();
    if (label === 'Minimum digits' || label === 'Suffix (optional)')
      fireEvent.click(test.ui.getByRole('button', { name: 'Bates sequence' }));
    const job = await test.start();
    await settle(() => test.finish(job));
    expect(test.ui.getByRole('button', { name: 'Download numbering report' })).toBeEnabled();
    if (label === 'mode') fireEvent.click(test.ui.getByRole('button', { name: 'Bates sequence' }));
    else if (label === 'replacement consent') fireEvent.click(test.ui.getByRole('checkbox'));
    else fireEvent.change(test.ui.getByLabelText(label), { target: { value } });
    test.noDownload();
    expect(test.ui.getByRole('status')).toHaveTextContent('Settings changed');
    const create = test.ui.getByRole('button', { name: 'Create export' });
    if (value === '0') expect(create).toBeDisabled();
    else expect(create).toBeEnabled();
  });

  it.each(['pending', 'success', 'failure'] as const)(
    'ignores %s old completion after settings change and lets a newer attempt finish',
    async (completion) => {
      const test = setup();
      const old = await test.start();
      await settle(() => {
        if (completion !== 'pending') test.finish(old, completion === 'success');
        fireEvent.change(test.ui.getByLabelText('Prefix (optional)'), {
          target: { value: 'NEW-' },
        });
      });
      expect(old.worker.terminate).toHaveBeenCalledOnce();
      test.noDownload();
      expect(test.ui.getByRole('status')).toHaveTextContent('Settings changed');
      const current = await test.start();
      expect(current.worker).not.toBe(old.worker);
      await settle(() => test.finish(current));
      await settle(() => test.finish(old));
      expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
      expect(test.ui.getByText(/NEW-1 → NEW-1/u)).toBeVisible();
      expect(test.ui.queryByText(/canary/u)).toBeNull();
    },
  );

  it.each(['replace', 'clear', 'invalid', 'tool', 'unmount'] as const)(
    'invalidates a pending numbering request on %s',
    async (action) => {
      const test = setup();
      const old = await test.start();
      await settle(() => {
        test.finish(old);
        if (action === 'replace') test.select();
        if (action === 'clear') test.select([]);
        if (action === 'invalid')
          test.select([new File(['text'], 'synthetic.txt', { type: 'text/plain' })]);
        if (action === 'tool') fireEvent.click(test.ui.getByRole('button', { name: /Compress/u }));
        if (action === 'unmount') test.unmount();
      });
      expect(old.worker.terminate).toHaveBeenCalledOnce();
      test.noDownload();
      if (action !== 'unmount')
        expect(test.ui.getByRole('status')).not.toHaveTextContent('Export ready');
    },
  );

  it.each(['compress', 'metadata-read', 'metadata-remove', 'geometry-inspect'] as const)(
    'isolates an already resolved %s from the newly selected numbering tool',
    async (kind) => {
      const test = setup();
      fireEvent.click(
        test.ui.getByRole('button', {
          name:
            kind === 'compress'
              ? /Compress/u
              : kind === 'geometry-inspect'
                ? /Crop \+ resize pages/u
                : /Metadata/u,
        }),
      );
      test.select();
      if (kind !== 'geometry-inspect')
        fireEvent.click(
          test.ui.getByRole('button', {
            name:
              kind === 'compress'
                ? 'Create export'
                : kind === 'metadata-read'
                  ? 'Read metadata'
                  : 'Remove common + XMP',
          }),
        );
      await waitFor(() => expect(test.workers.at(-1)?.postMessage).toHaveBeenCalled());
      const worker = test.workers.at(-1);
      const request = worker?.postMessage.mock.calls.at(-1)?.[0];
      if (worker === undefined || request?.kind !== kind)
        throw new Error('Missing utility request');
      const payload: pdfEngine.PdfWorkerSuccessPayload =
        kind === 'compress'
          ? {
              kind: 'compression',
              bytes: new Uint8Array([37, 80, 68, 70]),
              report: {
                method: 'lossless-structural',
                originalBytes: 4,
                outputBytes: 4,
                preset: 'balanced',
                reductionPercent: 0,
                usedOriginal: true,
                warningCodes: [],
              },
            }
          : kind === 'metadata-read'
            ? {
                kind: 'metadata',
                metadata: {
                  author: '',
                  creationDate: null,
                  creator: '',
                  hasXmpPacket: false,
                  keywords: '',
                  modificationDate: null,
                  producer: '',
                  subject: '',
                  title: 'stale metadata canary',
                },
              }
            : kind === 'geometry-inspect'
              ? { kind: 'geometry-inspection', inspection: { pageCount: 1, pages: [] } }
              : { kind: 'bytes', bytes: new Uint8Array([37, 80, 68, 70]) };
      await settle(() => {
        worker.dispatchEvent(
          new MessageEvent('message', { data: { id: request.id, ok: true, payload } }),
        );
        fireEvent.click(test.ui.getByRole('button', { name: /Page \+ Bates numbering/u }));
      });
      expect(worker.terminate).toHaveBeenCalledOnce();
      test.noDownload();
      expect(test.ui.getByRole('status')).toHaveTextContent('Choose a file');
      test.select();
      const current = await test.start();
      await settle(() => test.finish(current));
      expect(test.ui.getByRole('status')).toHaveTextContent('Export ready');
      expect(test.ui.queryByText(/canary/u)).toBeNull();
    },
  );

  it('does not let a superseded protection attempt clear a new in-memory password', async () => {
    const test = setup();
    fireEvent.click(test.ui.getByRole('button', { name: /Protect \/ unlock/u }));
    test.select();
    const password = test.container.querySelector('input[type="password"]');
    if (password === null) throw new Error('Missing password control');
    fireEvent.change(password, { target: { value: 'synthetic-old-only' } });
    fireEvent.click(test.ui.getByRole('button', { name: 'Create export' }));
    await waitFor(() => expect(test.workers.at(-1)?.postMessage).toHaveBeenCalled());
    const worker = test.workers.at(-1);
    const request = worker?.postMessage.mock.calls.at(-1)?.[0];
    if (worker === undefined || request?.kind !== 'protect')
      throw new Error('Missing protection request');
    await settle(() => {
      worker.dispatchEvent(
        new MessageEvent('message', {
          data: {
            id: request.id,
            ok: true,
            payload: { kind: 'bytes', bytes: new Uint8Array([37, 80, 68, 70]) },
          },
        }),
      );
      test.select();
      fireEvent.change(password, { target: { value: 'synthetic-new-only' } });
    });
    expect(password).toHaveValue('synthetic-new-only');
    expect(test.ui.getByRole('status')).toHaveTextContent(
      'Settings changed. Create a new export. Your original remains unchanged.',
    );
    test.noDownload();
  });

  it('does not enqueue a superseded file read and can recover from a current failure', async () => {
    const test = setup();
    let completeRead: (bytes: ArrayBuffer) => void = () => undefined;
    const delayed = new Promise<ArrayBuffer>((resolve) => {
      completeRead = resolve;
    });
    const file = new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
    vi.spyOn(file, 'arrayBuffer').mockReturnValue(delayed);
    test.select([file]);
    fireEvent.click(test.ui.getByRole('button', { name: 'Create export' }));
    fireEvent.change(test.ui.getByLabelText('Start number'), { target: { value: '5' } });
    await act(async () => {
      completeRead(new ArrayBuffer(4));
      await delayed;
    });
    expect(test.workers.every((worker) => worker.postMessage.mock.calls.length === 0)).toBe(true);
    test.select();
    const failed = await test.start();
    await settle(() => test.finish(failed, false));
    test.noDownload();
    expect(test.ui.queryByText(/canary/u)).toBeNull();
    const retry = await test.start();
    await settle(() => test.finish(retry));
    expect(test.ui.getByText(/PDFM-5 → PDFM-5/u)).toBeVisible();
  });
});
