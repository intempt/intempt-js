import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntemptJs } from '../../src/intemptJs/intemptJs.ts';

/**
 * The code path, distinct from the visual-editor path the rest of this SDK serves.
 *
 * `ChoicesModule` fetches `choose-web` and applies changes against the DOM without the caller
 * branching. `variation` reads `choose-api` and hands back a value the caller branches on. Both are
 * legitimate; a React component gated on a flag needs a branch, not a DOM mutation.
 *
 * The assertions that matter are the failure ones. A flag SDK is judged on what it returns when the
 * service is unreachable, not on the happy path.
 */
describe('variation', () => {
  const CTX = { userId: 'u-1', profileId: 'p-1' };

  const respond = (body: unknown, ok = true) =>
    vi.fn().mockResolvedValue({ ok, json: async () => body });

  /**
   * Constructing IntemptJs starts the auto-tracker, which issues its own requests. Indexing
   * `mock.calls[0]` therefore asserts against whichever call happened to be first — which is how a
   * test can pass while the method under test never ran at all.
   */
  const chooseCall = (fetchMock: ReturnType<typeof respond>) => {
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/optimization/choose-api'),
    );
    expect(call, 'no choose-api request was made').toBeDefined();
    return call as [string, { body: string }];
  };

  const sdk = () =>
    new IntemptJs({
      organization: 'acme',
      project: 'web',
      sourceId: '42',
      writeKey: 'pfx.sec',
    } as never);

  beforeEach(() => {
    vi.stubGlobal('btoa', (s: string) =>
      Buffer.from(s, 'binary').toString('base64'),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the served value and its reason', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        choices: [
          { name: 'checkout_v2', group: 'B', body: true, reason: 'targeted' },
        ],
      }),
    );

    const detail = await sdk().variationDetail('checkout_v2', CTX, false);

    expect(detail).toEqual({ value: true, reason: 'targeted', variant: 'B' });
  });

  it('reports a holdout as a holdout rather than as an absent answer', async () => {
    // Before the reason existed, a held-back person and a failed request were both an absent entry
    // and a caller could not tell them apart.
    vi.stubGlobal(
      'fetch',
      respond({ choices: [{ name: 'k', body: null, reason: 'holdout' }] }),
    );

    const detail = await sdk().variationDetail('k', CTX, 'fallback');

    expect(detail.reason).toBe('holdout');
    expect(detail.value).toBe('fallback');
  });

  it('returns the default when the service is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );

    await expect(sdk().variation('k', CTX, 'safe')).resolves.toBe('safe');
  });

  it('returns the default on a non-2xx response', async () => {
    vi.stubGlobal('fetch', respond({}, false));

    await expect(sdk().variation('k', CTX, 'safe')).resolves.toBe('safe');
  });

  it('returns the default when the key is unknown', async () => {
    vi.stubGlobal('fetch', respond({ choices: [] }));

    const detail = await sdk().variationDetail('never_created', CTX, 'safe');

    expect(detail.value).toBe('safe');
    expect(detail.reason).toBe('off');
  });

  it('refuses an empty key and a missing default', async () => {
    // A programming mistake throws; a runtime condition does not. That difference is the point.
    await expect(sdk().variation('  ', CTX, 'x')).rejects.toThrow(
      /key is required/,
    );
    await expect(
      (
        sdk() as unknown as {
          variation: (k: string, c: unknown) => Promise<unknown>;
        }
      ).variation('k', CTX),
    ).rejects.toThrow(/defaultValue is required/);
  });

  it('reads choose-api, alongside the visual editor rather than instead of it', async () => {
    // choose-web applies changes against the DOM without the caller branching, and is left
    // untouched so the visual editor keeps working exactly as it does today.
    const fetchMock = respond({ choices: [] });
    vi.stubGlobal('fetch', fetchMock);

    await sdk().variation('k', CTX, 'd');

    const [url] = chooseCall(fetchMock);
    expect(url).toContain('/optimization/choose-api');

    // The two channels coexist on the same page, and this test exists to keep it that way.
    // ChoicesModule fetches choose-web on init and applies changes against the DOM without the
    // caller branching; variation reads choose-api and hands back a value to branch on. Adding the
    // second must not have replaced the first, so both endpoints are asserted present.
    const endpoints = fetchMock.mock.calls.map(([u]) => String(u));
    expect(endpoints.some((u) => u.includes('choose-api'))).toBe(true);
    expect(
      endpoints.some((u) => u.includes('choose-web')),
      'the visual editor path must keep working',
    ).toBe(true);
  });

  it('sends the key, the source and both identifiers', async () => {
    const fetchMock = respond({ choices: [] });
    vi.stubGlobal('fetch', fetchMock);

    await sdk().variation('checkout_v2', CTX, 'd');

    const body = JSON.parse(chooseCall(fetchMock)[1].body);
    expect(body.names).toEqual(['checkout_v2']);
    expect(body.identification).toMatchObject({
      sourceId: '42',
      userId: 'u-1',
      profileId: 'p-1',
    });
  });

  it('omits names entirely for allFlags rather than sending an empty list', async () => {
    // An empty names list asks for NO keys. Omitting it asks for every key.
    const fetchMock = respond({ choices: [{ name: 'a', body: 1 }] });
    vi.stubGlobal('fetch', fetchMock);

    const all = await sdk().allFlags(CTX);

    expect(all).toEqual({ a: 1 });
    expect(JSON.parse(chooseCall(fetchMock)[1].body)).not.toHaveProperty(
      'names',
    );
  });

  it('falls back rather than coercing a wrong-typed value', async () => {
    // Boolean('false') is true. A silent coercion is indistinguishable from a correct answer.
    vi.stubGlobal(
      'fetch',
      respond({ choices: [{ name: 'f', body: 'false', reason: 'targeted' }] }),
    );

    await expect(sdk().boolVariation('f', CTX, false)).resolves.toBe(false);
  });

  it('accepts a correctly typed value', async () => {
    vi.stubGlobal(
      'fetch',
      respond({ choices: [{ name: 'f', body: 42, reason: 'targeted' }] }),
    );

    await expect(sdk().numberVariation('f', CTX, 0)).resolves.toBe(42);
  });

  it('waitForInitialization resolves without a request', async () => {
    const fetchMock = respond({ choices: [] });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sdk().waitForInitialization(5000)).resolves.toBeUndefined();

    // Evaluation is remote, so there is no local store to wait for and this makes no request of
    // its own. Asserted against the choose endpoint rather than fetch as a whole, because the
    // auto-tracker is calling out independently.
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).includes('/optimization/choose-api'),
      ),
    ).toBe(false);
  });
});
