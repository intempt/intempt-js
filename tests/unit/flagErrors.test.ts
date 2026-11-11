import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntemptJs } from '../../src/intemptJs/intemptJs.ts';

// INT-7454 (CONTRACT-R2 §S3): flag errors reach the caller through onFlagError and
// variationDetail, while the default is still returned.
// INT-7456 (CONTRACT-R2 §S4): allFlags evaluates without recording an exposure; a single-flag
// read records it unless disableExposure is set.

const CTX = { profileId: 'p-1' };

const chooseCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).includes('/optimization/choose-api'),
  );
const chooseBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse((chooseCalls(fetchMock)[0][1] as { body: string }).body);

function sdk(extra: Record<string, unknown> = {}) {
  return new IntemptJs({
    organization: 'acme',
    project: 'web',
    sourceId: '42',
    writeKey: 'pfx.sec',
    ...extra,
  } as never);
}

beforeEach(() => {
  vi.stubGlobal('btoa', (s: string) =>
    Buffer.from(s, 'binary').toString('base64'),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('flag errors (INT-7454)', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [400, 'bad_request'],
    [404, 'bad_request'],
    [500, 'server'],
    [503, 'server'],
  ])(
    'a %i calls onFlagError with kind %s and returns the default',
    async (status, kind) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue({ ok: false, status, json: async () => ({}) }),
      );
      const errors: unknown[] = [];
      const client = sdk({ onFlagError: (e: unknown) => errors.push(e) });

      await expect(client.variation('checkout', CTX, 'dflt')).resolves.toBe(
        'dflt',
      );
      expect(errors).toEqual([{ key: 'checkout', kind, status }]);
    },
  );

  it('classifies a thrown fetch as network and an unparseable body as parse', async () => {
    const errors: Array<{ kind: string }> = [];
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const client = sdk({
      onFlagError: (e: { kind: string }) => errors.push(e),
    });
    await client.variation('a', CTX, 1);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json');
        },
      }),
    );
    await client.variation('a', CTX, 1);

    expect(errors.map((e) => e.kind)).toEqual(['network', 'parse']);
  });

  it('classifies the 2 s cut-off as timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: unknown, init: { signal: AbortSignal }) =>
          new Promise((_r, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            ),
          ),
      ),
    );
    const errors: Array<{ kind: string }> = [];
    const client = sdk({
      onFlagError: (e: { kind: string }) => errors.push(e),
    });
    const pending = client.variation('a', CTX, 1);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe(1);
    expect(errors.map((e) => e.kind)).toEqual(['timeout']);
  });

  it('a hook that throws is swallowed and the default still returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );
    const client = sdk({
      onFlagError: () => {
        throw new Error('hook bug');
      },
    });
    await expect(client.variation('a', CTX, 'd')).resolves.toBe('d');
  });

  it('variationDetail is public and says error, with the error attached', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );
    await expect(sdk().variationDetail('a', CTX, false)).resolves.toEqual({
      value: false,
      reason: 'error',
      error: { key: 'a', kind: 'auth', status: 401 },
    });
  });

  it('a 200 with no choice stays reason off, with no error (INT-7457)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      }),
    );
    const errors: unknown[] = [];
    const client = sdk({ onFlagError: (e: unknown) => errors.push(e) });
    await expect(client.variationDetail('a', CTX, 0)).resolves.toEqual({
      value: 0,
      reason: 'off',
    });
    expect(errors).toEqual([]);
  });

  it('allFlags reports an error with a null key', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );
    const errors: unknown[] = [];
    await sdk({ onFlagError: (e: unknown) => errors.push(e) }).allFlags(CTX);
    expect(errors).toEqual([{ key: null, kind: 'server', status: 500 }]);
  });
});

describe('evaluation vs exposure (INT-7456)', () => {
  const ok = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ name: 'a', body: true }] }),
    });

  it('allFlags evaluates only: it sends exposure false', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    await sdk().allFlags(CTX);
    expect(chooseBody(fetchMock).exposure).toBe(false);
  });

  it('a single-flag read records the exposure: exposure is absent', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    await sdk().variation('a', CTX, false);
    expect(chooseBody(fetchMock)).not.toHaveProperty('exposure');
  });

  it('disableExposure on a single-flag read sends exposure false', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    await sdk().variation('a', CTX, false, { disableExposure: true });
    expect(chooseBody(fetchMock).exposure).toBe(false);
  });
});
