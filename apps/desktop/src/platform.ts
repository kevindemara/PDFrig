import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type {
  FileTransferControl,
  PlatformAdapter,
  RecentFilesSnapshot,
  SelectedFileHandle,
} from '@pdfmason/editor-core';

interface NativePdfSelection {
  readonly displayName: string;
  readonly selectionToken: string;
  readonly size: number;
}

interface NativeSaveSelection {
  readonly transferToken: string;
}

interface InvokeOptions {
  readonly headers: Readonly<Record<string, string>>;
}

type NativeInvoke = <T>(
  command: string,
  arguments_?: Readonly<Record<string, unknown>> | Uint8Array,
  options?: InvokeOptions,
) => Promise<T>;

type NativeListen = (eventName: string, handler: () => void) => Promise<() => void>;

const safeNativeError = (error: unknown): Error => {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return new Error(/^NATIVE_[A-Z_]+$/u.test(message) ? message : 'NATIVE_FILE_OPERATION_FAILED');
};

const asBytes = (value: ArrayBuffer | Uint8Array): Uint8Array =>
  value instanceof Uint8Array ? value : new Uint8Array(value);

const CHUNK_BYTES = 1024 * 1024;

const throwIfCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw new Error('NATIVE_TRANSFER_CANCELLED');
};

const readNativePdf = async (
  invokeCommand: NativeInvoke,
  selection: NativePdfSelection,
  { onProgress, signal }: FileTransferControl = {},
): Promise<SelectedFileHandle> => {
  const bytes = new Uint8Array(selection.size);
  let offset = 0;
  onProgress?.({ completedBytes: 0, totalBytes: selection.size });
  try {
    while (offset < selection.size) {
      throwIfCancelled(signal);
      const chunk = asBytes(
        await invokeCommand<ArrayBuffer | Uint8Array>('read_pdf_chunk', {
          offset,
          selectionToken: selection.selectionToken,
        }),
      );
      if (chunk.byteLength === 0 || chunk.byteLength > CHUNK_BYTES)
        throw new Error('NATIVE_FILE_CHANGED');
      const nextOffset = offset + chunk.byteLength;
      if (nextOffset > selection.size) throw new Error('NATIVE_FILE_CHANGED');
      bytes.set(chunk, offset);
      offset = nextOffset;
      onProgress?.({ completedBytes: offset, totalBytes: selection.size });
    }
  } catch (error: unknown) {
    await invokeCommand<null>('cancel_pdf_read', {
      selectionToken: selection.selectionToken,
    }).catch(() => undefined);
    throw error;
  }
  return Object.freeze({
    bytes,
    displayName: selection.displayName,
    size: selection.size,
  });
};

export const createWindowsPlatformAdapter = (
  invokeCommand: NativeInvoke = invoke,
  listenToEvent: NativeListen = listen,
): PlatformAdapter => ({
  chooseFiles: async (options) => {
    const { acceptedMimeTypes, multiple } = options;
    if (multiple || !acceptedMimeTypes.includes('application/pdf'))
      throw new Error('NATIVE_FILE_SELECTION_UNSUPPORTED');
    try {
      const selection = await invokeCommand<NativePdfSelection | null>('choose_pdf');
      if (selection === null) return [];
      return Object.freeze([await readNativePdf(invokeCommand, selection, options)]);
    } catch (error: unknown) {
      throw safeNativeError(error);
    }
  },
  isOnline: () => globalThis.navigator.onLine,
  kind: 'windows',
  launchFiles: {
    subscribe: (onLaunchFile) => listenToEvent('pdfmason-launch-file', onLaunchFile),
    take: async (control) => {
      try {
        throwIfCancelled(control?.signal);
        const selection = await invokeCommand<NativePdfSelection | null>('take_launch_pdf');
        if (selection === null) return null;
        return await readNativePdf(invokeCommand, selection, control);
      } catch (error: unknown) {
        throw safeNativeError(error);
      }
    },
  },
  recentFiles: {
    clear: async () => {
      try {
        await invokeCommand<null>('clear_recent_files');
      } catch (error: unknown) {
        throw safeNativeError(error);
      }
    },
    getSnapshot: async () => {
      try {
        return await invokeCommand<RecentFilesSnapshot>('get_recent_files');
      } catch (error: unknown) {
        throw safeNativeError(error);
      }
    },
    open: async (fileId, control) => {
      try {
        throwIfCancelled(control?.signal);
        const selection = await invokeCommand<NativePdfSelection>('open_recent_pdf', {
          recentFileId: fileId,
        });
        return await readNativePdf(invokeCommand, selection, control);
      } catch (error: unknown) {
        throw safeNativeError(error);
      }
    },
    setEnabled: async (enabled) => {
      try {
        await invokeCommand<null>('set_recent_files_enabled', { enabled });
      } catch (error: unknown) {
        throw safeNativeError(error);
      }
    },
  },
  saveFile: async ({ bytes, filenameSuggestion, mimeType, onProgress, signal }) => {
    if (mimeType !== 'application/pdf' && mimeType !== 'application/json')
      throw new Error('NATIVE_SAVE_TYPE_UNSUPPORTED');
    try {
      throwIfCancelled(signal);
      const selected = await invokeCommand<NativeSaveSelection | null>('choose_save_pdf', {
        expectedSize: bytes.byteLength,
        filenameSuggestion,
        mimeType,
      });
      if (selected === null) return 'cancelled';
      let offset = 0;
      onProgress?.({ completedBytes: 0, totalBytes: bytes.byteLength });
      try {
        while (offset < bytes.byteLength) {
          throwIfCancelled(signal);
          const end = Math.min(offset + CHUNK_BYTES, bytes.byteLength);
          const chunk = bytes.subarray(offset, end);
          await invokeCommand<null>('write_pdf_chunk', chunk, {
            headers: {
              // Tauri owns Content-Type for binary IPC. Keep document metadata
              // separate so its application/octet-stream override cannot erase it.
              'content-type': 'application/octet-stream',
              'x-pdfmason-content-type': mimeType,
              'x-pdfmason-final': String(end === bytes.byteLength),
              'x-pdfmason-offset': String(offset),
              'x-pdfmason-transfer': selected.transferToken,
            },
          });
          offset = end;
          onProgress?.({ completedBytes: offset, totalBytes: bytes.byteLength });
        }
      } catch (error: unknown) {
        await invokeCommand<null>('cancel_pdf_write', {
          transferToken: selected.transferToken,
        }).catch(() => undefined);
        throw error;
      }
      return 'saved';
    } catch (error: unknown) {
      throw safeNativeError(error);
    }
  },
});
