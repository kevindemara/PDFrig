/** OCR-001: only exact reviewed raw models may reach native initialization.
 * No user models, gzip decoding, worker cache or unbounded response allocation. */
export const localOcrModels = {
  eng: {
    bytes: 4_113_088,
    sha256: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  },
  fra: {
    bytes: 1_130_365,
    sha256: 'ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca',
  },
} as const;

export async function loadPinnedOcrModel(
  language: 'eng' | 'fra',
  base: string,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const cancelled = () => {
    if (signal.aborted) throw new Error('OCR_CANCELLED');
  };
  cancelled();
  if (!Object.hasOwn(localOcrModels, language)) throw new Error('OCR_LANGUAGE_UNSUPPORTED');
  const pin = localOcrModels[language];
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(new URL(`${language}.traineddata`, base), {
      signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    cancelled();
    if (!response.ok || !response.body || response.redirected) throw new Error('OCR_MODEL_FAILED');
    reader = response.body.getReader();
    const bytes = new Uint8Array(pin.bytes);
    let length = 0;
    for (;;) {
      const chunk = await reader.read();
      cancelled();
      if (chunk.done) break;
      if (chunk.value.length > pin.bytes - length) throw new Error('OCR_MODEL_FAILED');
      bytes.set(chunk.value, length);
      length += chunk.value.length;
    }
    if (length !== pin.bytes) throw new Error('OCR_MODEL_FAILED');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    cancelled();
    const actual = Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('');
    if (actual !== pin.sha256) throw new Error('OCR_MODEL_FAILED');
    return bytes;
  } catch {
    cancelled();
    throw new Error('OCR_MODEL_FAILED'); // Never expose native/network paths or model contents.
  } finally {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}
