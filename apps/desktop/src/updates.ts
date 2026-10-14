import { invoke } from '@tauri-apps/api/core';

type NativeInvoke = <T>(
  command: string,
  arguments_?: Readonly<Record<string, unknown>>,
) => Promise<T>;

export interface AvailableDesktopUpdate {
  readonly currentVersion: string;
  readonly notes: string | null;
  readonly publishedAt: string | null;
  readonly version: string;
}

const availableUpdate = (value: unknown): AvailableDesktopUpdate => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('NATIVE_UPDATE_INVALID');
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    typeof candidate.currentVersion !== 'string' ||
    (candidate.notes !== null && typeof candidate.notes !== 'string') ||
    (candidate.publishedAt !== null && typeof candidate.publishedAt !== 'string') ||
    typeof candidate.version !== 'string'
  ) {
    throw new Error('NATIVE_UPDATE_INVALID');
  }
  return Object.freeze({
    currentVersion: candidate.currentVersion,
    notes: candidate.notes,
    publishedAt: candidate.publishedAt,
    version: candidate.version,
  });
};

export class DesktopUpdateManager {
  readonly #invokeCommand: NativeInvoke;

  public constructor(invokeCommand: NativeInvoke = invoke) {
    this.#invokeCommand = invokeCommand;
  }

  public async check(): Promise<AvailableDesktopUpdate | null> {
    const result = await this.#invokeCommand<unknown>('check_for_update');
    return result === null ? null : availableUpdate(result);
  }

  public async install(version: string): Promise<void> {
    await this.#invokeCommand<null>('install_available_update', { expectedVersion: version });
  }
}
