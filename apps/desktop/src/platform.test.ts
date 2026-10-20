import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

import { createWindowsPlatformAdapter } from './platform.js';

describe('Windows platform adapter', () => {
  it('opens only the native fixed developer profile, without renderer URL arguments', async () => {
    const calls: unknown[] = [];
    const adapter = createWindowsPlatformAdapter(
      <T>(command: string, arguments_?: unknown): Promise<T> => {
        calls.push({ command, arguments_ });
        return Promise.resolve(undefined as T);
      },
    );
    await adapter.openDeveloperProfile?.();
    expect(calls).toEqual([{ command: 'open_developer_profile', arguments_: undefined }]);
  });

  it('does not expose native profile-opening error details', async () => {
    const adapter = createWindowsPlatformAdapter(() =>
      Promise.reject(new Error('sensitive diagnostics')),
    );
    await expect(adapter.openDeveloperProfile?.()).rejects.toThrow('NATIVE_PROFILE_OPEN_FAILED');
  });

  it('opens a user-selected PDF in bounded raw-byte chunks', async () => {
    const calls: { readonly arguments_: unknown; readonly command: string }[] = [];
    const bytes = new Uint8Array(1024 * 1024 + 5);
    bytes.set([37, 80, 68, 70, 45]);
    const adapter = createWindowsPlatformAdapter(
      <T>(
        command: string,
        arguments_?: Readonly<Record<string, unknown>> | Uint8Array,
      ): Promise<T> => {
        calls.push({ arguments_, command });
        if (command === 'choose_pdf')
          return Promise.resolve({
            displayName: 'synthetic.pdf',
            selectionToken: 'open-token',
            size: bytes.byteLength,
          } as T);
        const offset = Number((arguments_ as Readonly<Record<string, unknown>>).offset);
        return Promise.resolve(bytes.slice(offset, offset + 1024 * 1024).buffer as T);
      },
    );
    const progress: number[] = [];

    const selected = await adapter.chooseFiles({
      acceptedMimeTypes: ['application/pdf'],
      multiple: false,
      onProgress: ({ completedBytes }) => progress.push(completedBytes),
    });

    expect(calls).toEqual([
      { arguments_: undefined, command: 'choose_pdf' },
      {
        arguments_: { offset: 0, selectionToken: 'open-token' },
        command: 'read_pdf_chunk',
      },
      {
        arguments_: { offset: 1024 * 1024, selectionToken: 'open-token' },
        command: 'read_pdf_chunk',
      },
    ]);
    expect(progress).toEqual([0, 1024 * 1024, bytes.byteLength]);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.displayName).toBe('synthetic.pdf');
    // Compare every byte without recursively inspecting a million indexed properties.
    expect(Buffer.compare(selected[0]?.bytes ?? new Uint8Array(), bytes)).toBe(0);
  });

  it('cancels a native read when the caller aborts between chunks', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const adapter = createWindowsPlatformAdapter(<T>(command: string): Promise<T> => {
      calls.push(command);
      if (command === 'choose_pdf')
        return Promise.resolve({
          displayName: 'synthetic.pdf',
          selectionToken: 'open-token',
          size: 1024 * 1024 + 1,
        } as T);
      if (command === 'read_pdf_chunk') {
        controller.abort();
        return Promise.resolve(new Uint8Array(1024 * 1024).buffer as T);
      }
      return Promise.resolve(undefined as T);
    });

    await expect(
      adapter.chooseFiles({
        acceptedMimeTypes: ['application/pdf'],
        multiple: false,
        signal: controller.signal,
      }),
    ).rejects.toThrow('NATIVE_TRANSFER_CANCELLED');
    expect(calls).toEqual(['choose_pdf', 'read_pdf_chunk', 'cancel_pdf_read']);
  });

  it('streams completed PDF bytes only after save selection', async () => {
    const calls: {
      readonly arguments_: unknown;
      readonly command: string;
      readonly headers: Readonly<Record<string, string>> | undefined;
    }[] = [];
    const bytes = new Uint8Array(1024 * 1024 + 5);
    bytes.set([37, 80, 68, 70, 45]);
    const adapter = createWindowsPlatformAdapter(
      <T>(
        command: string,
        arguments_?: Readonly<Record<string, unknown>> | Uint8Array,
        options?: { readonly headers: Readonly<Record<string, string>> },
      ): Promise<T> => {
        calls.push({ arguments_, command, headers: options?.headers });
        return Promise.resolve(
          (command === 'choose_save_pdf' ? { transferToken: 'save-token' } : undefined) as T,
        );
      },
    );

    await expect(
      adapter.saveFile({
        bytes,
        filenameSuggestion: 'synthetic-completed.pdf',
        mimeType: 'application/pdf',
      }),
    ).resolves.toBe('saved');
    expect(calls[0]).toEqual({
      arguments_: {
        expectedSize: bytes.byteLength,
        filenameSuggestion: 'synthetic-completed.pdf',
        mimeType: 'application/pdf',
      },
      command: 'choose_save_pdf',
      headers: undefined,
    });
    expect(calls.slice(1).map(({ command }) => command)).toEqual([
      'write_pdf_chunk',
      'write_pdf_chunk',
    ]);
    expect(calls[1]?.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      'x-pdfmason-content-type': 'application/pdf',
      'x-pdfmason-final': 'false',
      'x-pdfmason-offset': '0',
      'x-pdfmason-transfer': 'save-token',
    });
    expect(calls[2]?.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      'x-pdfmason-content-type': 'application/pdf',
      'x-pdfmason-final': 'true',
      'x-pdfmason-offset': String(1024 * 1024),
      'x-pdfmason-transfer': 'save-token',
    });
  });

  it('streams a bounded local comment summary through the same reviewed save surface', async () => {
    const calls: {
      readonly arguments_: unknown;
      readonly command: string;
      readonly headers: Readonly<Record<string, string>> | undefined;
    }[] = [];
    const bytes = new TextEncoder().encode(
      '{\n  "schema": "pdfmason.comment-summary",\n  "version": 1\n}\n',
    );
    const adapter = createWindowsPlatformAdapter(
      <T>(
        command: string,
        arguments_?: Readonly<Record<string, unknown>> | Uint8Array,
        options?: { readonly headers: Readonly<Record<string, string>> },
      ): Promise<T> => {
        calls.push({ arguments_, command, headers: options?.headers });
        return Promise.resolve(
          (command === 'choose_save_pdf' ? { transferToken: 'report-token' } : undefined) as T,
        );
      },
    );

    await expect(
      adapter.saveFile({
        bytes,
        filenameSuggestion: 'pdfmason-comment-summary.json',
        mimeType: 'application/json',
      }),
    ).resolves.toBe('saved');
    expect(calls[0]).toEqual({
      arguments_: {
        expectedSize: bytes.byteLength,
        filenameSuggestion: 'pdfmason-comment-summary.json',
        mimeType: 'application/json',
      },
      command: 'choose_save_pdf',
      headers: undefined,
    });
    expect(calls[1]?.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      'x-pdfmason-content-type': 'application/json',
      'x-pdfmason-final': 'true',
      'x-pdfmason-transfer': 'report-token',
    });
  });

  it('does not issue a write when the save dialog is cancelled', async () => {
    const calls: string[] = [];
    const adapter = createWindowsPlatformAdapter(<T>(command: string): Promise<T> => {
      calls.push(command);
      return Promise.resolve(null as T);
    });

    await expect(
      adapter.saveFile({
        bytes: new Uint8Array([37, 80, 68, 70, 45]),
        filenameSuggestion: 'cancelled.pdf',
        mimeType: 'application/pdf',
      }),
    ).resolves.toBe('cancelled');
    expect(calls).toEqual(['choose_save_pdf']);
  });

  it('normalizes untrusted native errors to stable content-free codes', async () => {
    const adapter = createWindowsPlatformAdapter(<T>(): Promise<T> =>
      Promise.reject(new Error('C:\\secret.pdf')),
    );

    await expect(
      adapter.chooseFiles({ acceptedMimeTypes: ['application/pdf'], multiple: false }),
    ).rejects.toThrow('NATIVE_FILE_OPERATION_FAILED');
  });
});
