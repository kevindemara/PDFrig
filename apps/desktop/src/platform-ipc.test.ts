import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { createWindowsPlatformAdapter } from './platform.js';

const fixtures = new URL('../test-fixtures/tauri-ipc/', import.meta.url);
const load = (filename: string): Promise<string> => readFile(new URL(filename, fixtures), 'utf8');
type Invoke = NonNullable<Parameters<typeof createWindowsPlatformAdapter>[0]>;
interface BridgeMessage {
  readonly callback: number;
  readonly cmd: string;
  readonly error: number;
  readonly options: { readonly headers: Readonly<Record<string, string>> } | undefined;
  readonly payload: Readonly<Record<string, unknown>> | Uint8Array | undefined;
}
interface WriteObservation {
  readonly bytes: Uint8Array;
  readonly headers: Headers;
}

// Execute the pinned upstream bridge, not a mock of its header handling. Only
// responses/native MIME validation are modeled: this is not a Rust or WebView test.
const transportHarness = async (mimeType: string, mutateHeaders?: (headers: Headers) => void) => {
  const callbacks = new Map<number, (result: unknown) => void>();
  const writes: WriteObservation[] = [];
  const commands: string[] = [];
  let nextCallback = 1;
  const window = {
    __TAURI_INTERNALS__: {
      convertFileSrc: (command: string) => `http://ipc.localhost/${command}`,
      postMessage: (_message: BridgeMessage): void => {
        void _message;
        throw new Error('Transport has not been initialized.');
      },
      runCallback: (id: number, result: unknown): void => {
        const callback = callbacks.get(id);
        if (!callback) throw new Error('Unexpected test callback.');
        callbacks.delete(id);
        callback(result);
      },
    },
  };
  const context = vm.createContext({
    ArrayBuffer,
    Headers,
    Map,
    Uint8Array,
    fetch: (_url: string, request: { readonly body: Uint8Array; readonly headers: Headers }) => {
      const headers = new Headers(request.headers);
      mutateHeaders?.(headers);
      writes.push({ bytes: request.body.slice(), headers });
      // Mirror only the two native header checks. Rust also independently checks
      // the raw body, byte limits/header, token, offsets, final size and destination.
      const documentType = headers.get('x-pdfmason-content-type');
      const failure =
        documentType === null
          ? 'NATIVE_TRANSFER_HEADERS_REQUIRED'
          : headers.get('content-type') !== 'application/octet-stream' || documentType !== mimeType
            ? 'NATIVE_SAVE_TYPE_UNSUPPORTED'
            : null;
      return Promise.resolve(
        new Response(JSON.stringify(failure), {
          headers: {
            'content-type': 'application/json',
            'Tauri-Response': failure === null ? 'ok' : 'error',
          },
        }),
      );
    },
    window,
  });
  const source = (await load('ipc-protocol.js.txt'))
    .replace('__TEMPLATE_invoke_key__', JSON.stringify('synthetic-invoke-key'))
    .replace('__RAW_process_ipc_message_fn__', await load('process-ipc-message-fn.js.txt'))
    .replace('__TEMPLATE_os_name__', JSON.stringify('windows'))
    .replace('__TEMPLATE_fetch_channel_data_command__', JSON.stringify('plugin:channel|fetch'));
  vm.runInContext(source, context, { timeout: 1_000 });
  const invoke: Invoke = <T>(
    command: string,
    payload?: Readonly<Record<string, unknown>> | Uint8Array,
    options?: { readonly headers: Readonly<Record<string, string>> },
  ): Promise<T> => {
    commands.push(command);
    if (command === 'choose_save_pdf')
      return Promise.resolve({ transferToken: 'synthetic-save-token' } as T);
    if (command === 'cancel_pdf_write') return Promise.resolve(null as T);
    return new Promise<T>((resolve, reject) => {
      const callback = nextCallback++;
      const error = nextCallback++;
      callbacks.set(callback, (result) => resolve(result as T));
      callbacks.set(error, reject);
      window.__TAURI_INTERNALS__.postMessage({ callback, cmd: command, error, options, payload });
    });
  };
  return { adapter: createWindowsPlatformAdapter(invoke), commands, invoke, writes };
};

describe('Windows export through the actual pinned Tauri JavaScript transport', () => {
  it('binds unmodified transport fixtures and MIT terms to the locked Rust runtime', async () => {
    const provenance = JSON.parse(await load('provenance.json')) as {
      readonly files: readonly { readonly filename: string; readonly sha256: string }[];
      readonly version: string;
    };
    const lock = await readFile(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8');
    expect(lock).toContain(`name = "tauri"\nversion = "${provenance.version}"`);
    expect(provenance.files).toHaveLength(3);
    for (const file of provenance.files)
      expect(
        createHash('sha256')
          .update(await load(file.filename))
          .digest('hex'),
      ).toBe(file.sha256);
  });

  it.each([32, 1024 * 1024, 1024 * 1024 + 5])(
    'retains every byte and distinct MIME metadata in a %i-byte PDF transfer',
    async (size) => {
      const bytes = new Uint8Array(size).fill(65);
      bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
      const harness = await transportHarness('application/pdf');
      const progress: number[] = [];
      await expect(
        harness.adapter.saveFile({
          bytes,
          filenameSuggestion: 'synthetic-copy.pdf',
          mimeType: 'application/pdf',
          onProgress: ({ completedBytes }) => progress.push(completedBytes),
        }),
      ).resolves.toBe('saved');
      expect(Buffer.compare(Buffer.concat(harness.writes.map((write) => write.bytes)), bytes)).toBe(
        0,
      );
      let offset = 0;
      for (const write of harness.writes) {
        expect(write.headers.get('content-type')).toBe('application/octet-stream');
        expect(write.headers.get('x-pdfmason-content-type')).toBe('application/pdf');
        expect(write.headers.get('x-pdfmason-transfer')).toBe('synthetic-save-token');
        expect(write.headers.get('x-pdfmason-offset')).toBe(String(offset));
        offset += write.bytes.byteLength;
        expect(write.headers.get('x-pdfmason-final')).toBe(String(offset === size));
      }
      expect(progress.at(-1)).toBe(size);
      expect(harness.commands).not.toContain('cancel_pdf_write');
    },
  );

  it('preserves JSON comment-report metadata without changing the binary transport type', async () => {
    const bytes = new TextEncoder().encode(
      '{\n  "schema": "pdfmason.comment-summary", "version": 1}',
    );
    const harness = await transportHarness('application/json');
    await expect(
      harness.adapter.saveFile({
        bytes,
        filenameSuggestion: 'synthetic-comments.json',
        mimeType: 'application/json',
      }),
    ).resolves.toBe('saved');
    expect(harness.writes[0]?.headers.get('content-type')).toBe('application/octet-stream');
    expect(harness.writes[0]?.headers.get('x-pdfmason-content-type')).toBe('application/json');
    expect(Buffer.compare(harness.writes[0]?.bytes ?? new Uint8Array(), bytes)).toBe(0);
  });

  it('reproduces why putting document MIME in Content-Type loses it in the actual bridge', async () => {
    const harness = await transportHarness('application/pdf');
    await expect(
      harness.invoke('write_pdf_chunk', new TextEncoder().encode('%PDF-1.7\n'), {
        headers: { 'content-type': 'application/pdf' },
      }),
    ).rejects.toBe('NATIVE_TRANSFER_HEADERS_REQUIRED');
    expect(harness.writes[0]?.headers.get('content-type')).toBe('application/octet-stream');
  });

  it.each(['missing', 'wrong-document', 'wrong-transport'])(
    'cancels a refused transfer when %s MIME metadata reaches the native boundary',
    async (mode) => {
      const harness = await transportHarness('application/pdf', (headers) => {
        if (mode === 'missing') headers.delete('x-pdfmason-content-type');
        if (mode === 'wrong-document') headers.set('x-pdfmason-content-type', 'application/json');
        if (mode === 'wrong-transport') headers.set('content-type', 'application/json');
      });
      await expect(
        harness.adapter.saveFile({
          bytes: new TextEncoder().encode('%PDF-1.7\nsynthetic'),
          filenameSuggestion: 'synthetic-copy.pdf',
          mimeType: 'application/pdf',
        }),
      ).rejects.toThrow(
        mode === 'missing' ? 'NATIVE_TRANSFER_HEADERS_REQUIRED' : 'NATIVE_SAVE_TYPE_UNSUPPORTED',
      );
      expect(harness.commands).toEqual(['choose_save_pdf', 'write_pdf_chunk', 'cancel_pdf_write']);
    },
  );
});
