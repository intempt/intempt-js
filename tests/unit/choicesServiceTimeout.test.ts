import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChoicesService } from '../../src/intemptJs/modules/choices/choices.service.ts';
import { localStorageCache } from '../../src/shared/storageHandler.ts';

/**
 * INT-3827 — `setChangesData`'s 320 ms budget was not a budget.
 *
 * The line was:
 *
 *     await Promise.race([timeoutPromise, await changesPromise]);
 *
 * The inner `await` runs BEFORE `Promise.race` is called: the argument list has
 * to be evaluated first, so the fetch is awaited to completion and `race` then
 * receives its settled value. A slow or hanging backend therefore blocked
 * `setChangesData` for as long as it liked, and the timeout it raced against was
 * decorative. That matters because this call sits in front of rendering the
 * experience — the visitor waits on it.
 *
 * Dropping the inner `await` makes both branches real promises, so the timeout
 * can actually win.
 *
 * Fake timers are what make this observable: with them, `changesPromise` cannot
 * settle unless the test lets it, so "did the call return" is precisely "did the
 * timeout win the race".
 */

const params = {
  key: 'choices-key',
  url: 'optimization/choose-web',
  body: {} as any,
  auth_config: { auth: { username: 'u', password: 'p' } } as any,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ChoicesService.setChangesData — the 320ms race (INT-3827)', () => {
  it('returns on the timeout while the fetch is still in flight', async () => {
    vi.useFakeTimers();

    // A fetch that never settles on its own — the hanging-backend case.
    let release!: (value: { choices: unknown[] }) => void;
    vi.spyOn(ChoicesService, 'fetchChoices').mockImplementation(
      () =>
        new Promise<{ choices: unknown[] }>((resolve) => {
          release = resolve;
        }) as any,
    );
    const setSpy = vi.spyOn(localStorageCache, 'set');

    let settled = false;
    const pending = ChoicesService.setChangesData(params).then(() => {
      settled = true;
    });

    // THE MUTANT: restore the inner `await` and this is still false — the call
    // is parked on the fetch and no amount of clock movement frees it.
    await vi.advanceTimersByTimeAsync(320);
    expect(settled).toBe(true);

    // The timeout branch writes nothing: a slow response must leave whatever is
    // already cached alone rather than stamping an empty change list over it.
    expect(setSpy).not.toHaveBeenCalled();

    // Let the late response land so the suite leaves no pending promise behind.
    release({ choices: [] });
    await pending;
  });

  it('still caches the changes when the fetch beats the timeout', async () => {
    // The other side of the race — the normal case must be unaffected.
    vi.spyOn(ChoicesService, 'fetchChoices').mockResolvedValue({
      choices: [{ changes: [{ id: 'change-1' }] }],
    } as any);
    const setSpy = vi
      .spyOn(localStorageCache, 'set')
      .mockImplementation(() => {});

    await ChoicesService.setChangesData(params);

    expect(setSpy).toHaveBeenCalledWith('choices-key', {
      changes: [{ id: 'change-1' }],
    });
  });
});

/**
 * SDK-21 (INT-6060) — a failed `choose-web` wiped the cached variant.
 *
 * `fetchChoices` turned every failure (non-2xx, network error) into `[]`, and the
 * fetch branch then cached that as "no changes", so one failed call removed the
 * experience until the next successful one. When the failure beat the 320 ms
 * budget the visitor lost the variant on this very load; a slower failure wiped
 * it for the next one. A failure now leaves the cache alone. An answered request
 * still replaces it, including an empty answer, which is how a turned-off
 * experience clears.
 */
describe('ChoicesService.getChoicesData — the cached variant survives a failed call (SDK-21)', () => {
  const pathKey = `changes_${window.location.pathname}`;
  const cached = [{ type: 'remove', iweId: 'cached-1' }];
  const args = {
    changesRequest: {} as any,
    authRequest: { auth: { username: 'u', password: 'p' } } as any,
    orgName: 'acme',
    project: 'proj-1',
  };

  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it.each([400, 404, 500, 503])(
    'a %i keeps the cached change and still serves it',
    async (status) => {
      localStorageCache.set(pathKey, { changes: cached });
      vi.stubGlobal('fetch', respond(status, { message: 'nope' }));

      const served = await ChoicesService.getChoicesData(args);

      expect(served, 'the visitor still gets the cached variant').toEqual(
        cached,
      );
      expect(localStorageCache.get(pathKey)).toEqual({ changes: cached });
    },
  );

  it('a network error keeps the cached change', async () => {
    localStorageCache.set(pathKey, { changes: cached });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await ChoicesService.getChoicesData(args)).toEqual(cached);
    expect(localStorageCache.get(pathKey)).toEqual({ changes: cached });
  });

  it('a 200 whose body is not JSON keeps the cached change', async () => {
    localStorageCache.set(pathKey, { changes: cached });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>gateway</html>', { status: 200 })),
    );

    expect(await ChoicesService.getChoicesData(args)).toEqual(cached);
    expect(localStorageCache.get(pathKey)).toEqual({ changes: cached });
  });

  it('a failure after the 320 ms budget does not wipe the cache for the next load', async () => {
    vi.useFakeTimers();
    localStorageCache.set(pathKey, { changes: cached });
    let fail!: () => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            fail = () => resolve(new Response('{}', { status: 502 }));
          }),
      ),
    );

    const pending = ChoicesService.getChoicesData(args);
    await vi.advanceTimersByTimeAsync(320);
    expect(await pending, 'this load reads the cache').toEqual(cached);

    fail();
    await vi.advanceTimersByTimeAsync(0);

    expect(
      localStorageCache.get(pathKey),
      'the late failure leaves the variant for the next load',
    ).toEqual({ changes: cached });
  });

  it('a failed call followed by a successful one replaces the cache with the new answer', async () => {
    localStorageCache.set(pathKey, { changes: cached });
    vi.stubGlobal('fetch', respond(500, {}));
    expect(await ChoicesService.getChoicesData(args)).toEqual(cached);

    const fresh = { type: 'remove', iweId: 'fresh-1' };
    vi.stubGlobal('fetch', respond(200, { choices: [{ changes: [fresh] }] }));

    expect(await ChoicesService.getChoicesData(args)).toEqual([fresh]);
    expect(localStorageCache.get(pathKey)).toEqual({ changes: [fresh] });
  });

  it('a 200 with no choices clears the cache — a turned-off experience stops applying', async () => {
    localStorageCache.set(pathKey, { changes: cached });
    vi.stubGlobal('fetch', respond(200, { choices: [] }));

    expect(await ChoicesService.getChoicesData(args)).toEqual([]);
    expect(localStorageCache.get(pathKey)).toEqual({ changes: [] });
  });
});
