import { invoke } from '@tauri-apps/api/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const AUTH_STORAGE_KEY = 'pdfmason-desktop-auth-v1';
const MAXIMUM_STORAGE_VALUE_BYTES = 96 * 1024;

type NativeInvoke = <T>(
  command: string,
  arguments_?: Readonly<Record<string, unknown>>,
) => Promise<T>;

interface AsyncStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

interface DesktopAuthDatabase {
  public: {
    Functions: Record<never, never>;
    Tables: Record<never, never>;
    Views: Record<never, never>;
  };
}

export type DesktopAuthClient = SupabaseClient<DesktopAuthDatabase>;

export interface DesktopAuthConfig {
  readonly publishableKey: string;
  readonly supabaseUrl: string;
  readonly webAccountUrl: string;
}

const allowedStorageKey = (key: string): boolean =>
  key === AUTH_STORAGE_KEY ||
  key === `${AUTH_STORAGE_KEY}-flows-code-verifier` ||
  new RegExp(`^${AUTH_STORAGE_KEY}-flow-[A-Za-z0-9_-]{16,128}-code-verifier$`, 'u').test(key);

const parseStorageRecord = (value: string | null): Record<string, string> => {
  if (value === null) return {};
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.entries(parsed).some(
      ([key, entry]) => !allowedStorageKey(key) || typeof entry !== 'string',
    )
  ) {
    throw new Error('NATIVE_SESSION_TAMPERED');
  }
  return parsed as Record<string, string>;
};

export class DesktopSecureAuthStorage implements AsyncStorage {
  readonly #invokeCommand: NativeInvoke;
  #queue: Promise<void> = Promise.resolve();

  public constructor(invokeCommand: NativeInvoke = invoke) {
    this.#invokeCommand = invokeCommand;
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #validateKey(key: string): void {
    if (!allowedStorageKey(key)) throw new Error('NATIVE_SESSION_KEY_BLOCKED');
  }

  public async getItem(key: string): Promise<string | null> {
    this.#validateKey(key);
    return await this.#serialize(async () => {
      const stored = await this.#invokeCommand<string | null>('get_secure_session');
      return parseStorageRecord(stored)[key] ?? null;
    });
  }

  public async removeItem(key: string): Promise<void> {
    this.#validateKey(key);
    await this.#serialize(async () => {
      const stored = parseStorageRecord(
        await this.#invokeCommand<string | null>('get_secure_session'),
      );
      Reflect.deleteProperty(stored, key);
      if (Object.keys(stored).length === 0) {
        await this.#invokeCommand<null>('clear_secure_session');
        return;
      }
      await this.#invokeCommand<null>('store_secure_session', {
        sessionJson: JSON.stringify(stored),
      });
    });
  }

  public async setItem(key: string, value: string): Promise<void> {
    this.#validateKey(key);
    if (new TextEncoder().encode(value).byteLength > MAXIMUM_STORAGE_VALUE_BYTES)
      throw new Error('NATIVE_SESSION_INVALID');
    await this.#serialize(async () => {
      const stored = parseStorageRecord(
        await this.#invokeCommand<string | null>('get_secure_session'),
      );
      stored[key] = value;
      await this.#invokeCommand<null>('store_secure_session', {
        sessionJson: JSON.stringify(stored),
      });
    });
  }
}

export const parseDesktopAuthConfig = (
  input: Readonly<Record<string, string | undefined>>,
): DesktopAuthConfig | null => {
  const publishableKey = input.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const supabaseUrl = input.VITE_SUPABASE_URL?.trim();
  if (publishableKey === undefined && supabaseUrl === undefined) return null;
  if (publishableKey === undefined || publishableKey.length < 20 || supabaseUrl === undefined)
    throw new Error('Desktop Supabase configuration is incomplete.');
  const endpoint = new URL(supabaseUrl);
  const localEndpoint = endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost';
  if (endpoint.protocol !== 'https:' && !(localEndpoint && endpoint.protocol === 'http:'))
    throw new Error('Desktop Supabase must use HTTPS outside local development.');
  const webAccountUrl = new URL(
    '/account',
    input.VITE_PDFMASON_WEB_URL ?? 'http://127.0.0.1:3000',
  ).toString();
  return Object.freeze({ publishableKey, supabaseUrl: endpoint.toString(), webAccountUrl });
};

export const createDesktopAuthClient = (config: DesktopAuthConfig): DesktopAuthClient =>
  createClient<DesktopAuthDatabase>(config.supabaseUrl, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      persistSession: true,
      storage: new DesktopSecureAuthStorage(),
      storageKey: AUTH_STORAGE_KEY,
    },
  });
