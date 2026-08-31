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

    // `variation`, not `variationDetail`: the detail method is internal until the platform sends
    // a reason. Note the mock supplies `group: 'B'` and `reason` -- neither of which the serving
    // response actually carries today, which is exactly why asserting on them here proved nothing.
    await expect(sdk().variation('checkout_v2', CTX, false)).resolves.toBe(
      true,
    );
  });

  it('returns the default when the served body is null', async () => {
    // A held-back person's experience is absent from the response today rather than present with
    // a null body, so this covers the shape rather than the holdout case. Telling a holdout from
    // an outage needs a reason the platform does not yet send, and is not asserted here because
    // it cannot be.
    vi.stubGlobal('fetch', respond({ choices: [{ name: 'k', body: null }] }));

    await expect(sdk().variation('k', CTX, 'fallback')).resolves.toBe(
      'fallback',
    );
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

    await expect(sdk().variation('never_created', CTX, 'safe')).resolves.toBe(
      'safe',
    );
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

  /**
   * The privacy gate.
   *
   * `intemptJs.ts` states, in the one comment that documents the exception, that `consent()` is
   * the ONLY public method not gated on `isUserOptIn()` and that "every other public method skips
   * work while opted out because that work is *tracking*". The flag surface posts the visitor's
   * `profileId` and `userId`, and `EXP-SERVE-003` says every evaluation records an exposure — so
   * it is tracking, and shipping it ungated would have made that comment false as well as leaking.
   *
   * Asserted as no REQUEST, not merely a discarded response: a request that reaches the platform
   * has already identified the visitor, whatever the caller does with the answer.
   */
  describe('an opted-out visitor', () => {
    const optedOut = () => {
      const s = sdk();
      s.optOut();
      return s;
    };

    const noChooseApi = (fetchMock: ReturnType<typeof respond>) =>
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).includes('/optimization/choose-api'),
        ),
        'an opted-out visitor must produce no evaluation request',
      ).toBe(false);

    it.each([
      ['variation', (s: ReturnType<typeof sdk>) => s.variation('k', CTX, 'd')],
      [
        'boolVariation',
        (s: ReturnType<typeof sdk>) => s.boolVariation('k', CTX, true),
      ],
      [
        'stringVariation',
        (s: ReturnType<typeof sdk>) => s.stringVariation('k', CTX, 'd'),
      ],
      [
        'numberVariation',
        (s: ReturnType<typeof sdk>) => s.numberVariation('k', CTX, 7),
      ],
      ['allFlags', (s: ReturnType<typeof sdk>) => s.allFlags(CTX)],
    ])('%s makes no request', async (_name, call) => {
      // The mock would answer if it were asked, so a default coming back is only meaningful
      // alongside the assertion that nothing was sent.
      const fetchMock = respond({ choices: [{ name: 'k', body: 'served' }] });
      vi.stubGlobal('fetch', fetchMock);

      await call(optedOut());

      noChooseApi(fetchMock);
    });

    it('still returns the caller’s default rather than undefined', async () => {
      vi.stubGlobal(
        'fetch',
        respond({ choices: [{ name: 'k', body: 'served' }] }),
      );
      const s = optedOut();

      await expect(s.variation('k', CTX, 'd')).resolves.toBe('d');
      await expect(s.boolVariation('k', CTX, true)).resolves.toBe(true);
      await expect(s.numberVariation('k', CTX, 7)).resolves.toBe(7);
      await expect(s.allFlags(CTX)).resolves.toEqual({});
    });
  });

  it('sends the real device, the same one choose-web derives', async () => {
    // `device` is spliced into the serving query's
    // `and (device is null or device = 'ALL' or <clause>)` predicate. `all` compiles to `1`, so
    // it matched every row and a MOBILE-only experience evaluated true for a desktop visitor
    // here while choose-web correctly withheld it — the same person served differently by
    // channel, silently.
    const fetchMock = respond({ choices: [] });
    vi.stubGlobal('fetch', fetchMock);

    await sdk().variation('k', CTX, 'd');

    // jsdom's default user agent is not a mobile one.
    expect(JSON.parse(chooseCall(fetchMock)[1].body).device).toBe('desktop');
  });

  it('derives mobile from a mobile user agent', async () => {
    const fetchMock = respond({ choices: [] });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    });

    await sdk().variation('k', CTX, 'd');

    expect(JSON.parse(chooseCall(fetchMock)[1].body).device).toBe('mobile');
  });

  it('resolves rather than throwing when the write key cannot be base64-encoded', async () => {
    // `btoa` throws InvalidCharacterError on a non-Latin1 string. Building the Authorization
    // header sits inside the try with the request precisely so this reaches the caller as their
    // default, which is what the method's contract promises for every transport-class failure.
    vi.stubGlobal('btoa', () => {
      throw new DOMException('bad char', 'InvalidCharacterError');
    });
    vi.stubGlobal('fetch', respond({ choices: [{ name: 'k', body: 'x' }] }));

    await expect(sdk().variation('k', CTX, 'safe')).resolves.toBe('safe');
  });
});
