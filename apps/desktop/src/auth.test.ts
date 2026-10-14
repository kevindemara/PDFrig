import { describe, expect, it } from 'vitest';

import { DesktopSecureAuthStorage, parseDesktopAuthConfig } from './auth.js';

describe('desktop secure authentication storage', () => {
  it('serializes Supabase session and PKCE slots through the fixed DPAPI command', async () => {
    let encryptedPayload: string | null = null;
    const commands: string[] = [];
    const storage = new DesktopSecureAuthStorage(
      <T>(command: string, arguments_?: Readonly<Record<string, unknown>>): Promise<T> => {
        commands.push(command);
        if (command === 'get_secure_session') return Promise.resolve(encryptedPayload as T);
        if (command === 'store_secure_session') {
          encryptedPayload = String(arguments_?.sessionJson);
          return Promise.resolve(null as T);
        }
        encryptedPayload = null;
        return Promise.resolve(null as T);
      },
    );
    const verifierKey = 'pdfmason-desktop-auth-v1-flow-synthetic_flow_1-code-verifier';

    await Promise.all([
      storage.setItem('pdfmason-desktop-auth-v1', '{"access_token":"synthetic"}'),
      storage.setItem(verifierKey, 'synthetic-verifier'),
    ]);
    await expect(storage.getItem('pdfmason-desktop-auth-v1')).resolves.toBe(
      '{"access_token":"synthetic"}',
    );
    await expect(storage.getItem(verifierKey)).resolves.toBe('synthetic-verifier');

    await storage.removeItem(verifierKey);
    await storage.removeItem('pdfmason-desktop-auth-v1');
    expect(encryptedPayload).toBeNull();
    expect(commands).toContain('store_secure_session');
    expect(commands.at(-1)).toBe('clear_secure_session');
  });

  it('blocks arbitrary storage keys before they reach native code', async () => {
    const storage = new DesktopSecureAuthStorage(<T>(): Promise<T> =>
      Promise.reject(new Error('must not be called')),
    );
    await expect(storage.setItem('passwords', 'synthetic')).rejects.toThrow(
      'NATIVE_SESSION_KEY_BLOCKED',
    );
  });

  it('accepts HTTPS production endpoints and loopback HTTP only', () => {
    expect(
      parseDesktopAuthConfig({
        VITE_PDFMASON_WEB_URL: 'http://127.0.0.1:3000',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_key',
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      }),
    ).toMatchObject({
      supabaseUrl: 'http://127.0.0.1:54321/',
      webAccountUrl: 'http://127.0.0.1:3000/account',
    });
    expect(parseDesktopAuthConfig({})).toBeNull();
    expect(() =>
      parseDesktopAuthConfig({
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_key',
        VITE_SUPABASE_URL: 'http://example.com',
      }),
    ).toThrow('HTTPS');
  });
});
