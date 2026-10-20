export interface SelectedFileHandle {
  readonly bytes: Uint8Array;
  readonly displayName: string;
  readonly size: number;
}

export interface FileTransferProgress {
  readonly completedBytes: number;
  readonly totalBytes: number;
}

export interface FileTransferControl {
  readonly onProgress?: (progress: FileTransferProgress) => void;
  readonly signal?: AbortSignal;
}

export interface RecentFileEntry {
  readonly available: boolean;
  readonly displayName: string;
  readonly id: string;
  readonly lastOpenedAt: string;
}

export interface RecentFilesSnapshot {
  readonly enabled: boolean;
  readonly entries: readonly RecentFileEntry[];
}

export interface RecentFilesAdapter {
  clear(): Promise<void>;
  getSnapshot(): Promise<RecentFilesSnapshot>;
  open(fileId: string, control?: FileTransferControl): Promise<SelectedFileHandle>;
  setEnabled(enabled: boolean): Promise<void>;
}

export interface LaunchFilesAdapter {
  subscribe(onLaunchFile: () => void): Promise<() => void>;
  take(control?: FileTransferControl): Promise<SelectedFileHandle | null>;
}

export interface SaveRequest extends FileTransferControl {
  readonly bytes: Uint8Array;
  readonly filenameSuggestion: string;
  readonly mimeType: string;
}

/** Opens the host's print UI for a printable document already prepared in the DOM. */
export interface PrintAdapter {
  openDialog(): Promise<void>;
}

export const createPrintAdapter = (openDialog: () => void | Promise<void>): PrintAdapter =>
  Object.freeze({
    openDialog: async () => {
      await openDialog();
    },
  });

/** Platform capabilities stay behind this adapter; implementations must keep privilege local. */
export interface PlatformAdapter {
  readonly kind: 'browser' | 'windows';
  chooseFiles(
    options: FileTransferControl & {
      readonly acceptedMimeTypes: readonly string[];
      readonly multiple: boolean;
    },
  ): Promise<readonly SelectedFileHandle[]>;
  isOnline(): boolean;
  /** Opens only the fixed developer GitHub profile, never arbitrary renderer URLs. */
  readonly openDeveloperProfile?: () => Promise<void>;
  readonly launchFiles?: LaunchFilesAdapter;
  readonly recentFiles?: RecentFilesAdapter;
  saveFile(request: SaveRequest): Promise<'cancelled' | 'saved'>;
}
