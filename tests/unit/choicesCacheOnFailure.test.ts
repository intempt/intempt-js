import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChoicesService } from '../../src/intemptJs/modules/choices/choices.service.ts';
import { localStorageCache } from '../../src/shared/storageHandler.ts';

/**
 * INT-6060 item 2 (SDK-21) — a failed `choose-web` wiped the cached changes.
 *
 * `fetchChoices` returned `[]` on any failure, `choicesDataGuard([])` turned that
 * into "no changes", and `setChangesData` then wrote `{changes: []}` over the
 * good cache (its catch did the same). "The request failed" and "the server says
 * there are no changes" were the same value. Now the cache is written only on a
 * 2xx response carrying a `choices` array; any failure leaves it untouched.
 */

const KEY = 'changes_/product';
const GOOD = { changes: [{ id: 'cached-change' }] };

const params = {
  key: KEY,
  url: 'acme/projects/p/optimization/choose-web',
  body: {} as any,
  auth_config: { auth: { username: 'u', password: 'p' } } as any,
  apiBaseUrl: 'https://api.example.com',
};

beforeEach(() => {
  localStorage.clear();
  localStorageCache.set(KEY, GOOD);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('choose-web failure keeps the existing cache (INT-6060 item 2)', () => {
  it.each([
    [
      'HTTP 500',
      async () => ({ ok: false, status: 500, json: async () => ({}) }),
    ],
    [
      'HTTP 401',
      async () => ({ ok: false, status: 401, json: async () => ({}) }),
    ],
    [
      'network error',
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ],
    [
      'non-JSON 200 body',
      async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      }),
    ],
    [
      '200 without a choices array',
      async () => ({ ok: true, status: 200, json: async () => ({}) }),
    ],
  ])('%s: leaves the cached changes untouched', async (_name, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl));

    await ChoicesService.setChangesData(params);

    expect(localStorageCache.get(KEY)).toEqual(GOOD);
  });

  it('fetchChoices signals failure distinctly (null), not as an empty answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
    await expect(
      ChoicesService.fetchChoices(
        params.url,
        params.body,
        params.auth_config.auth,
        params.apiBaseUrl,
      ),
    ).resolves.toBeNull();
  });

  it('a 2xx with an empty choices array still clears the cache (experience turned off)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      })),
    );

    await ChoicesService.setChangesData(params);

    expect(localStorageCache.get(KEY)).toEqual({ changes: [] });
  });

  it('a 2xx with choices replaces the cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ changes: [{ id: 'fresh' }] }] }),
      })),
    );

    await ChoicesService.setChangesData(params);

    expect(localStorageCache.get(KEY)).toEqual({ changes: [{ id: 'fresh' }] });
  });

  it('a throw inside the cache write path does not stamp an empty list over the cache', async () => {
    vi.spyOn(ChoicesService, 'fetchChoices').mockRejectedValue(
      new Error('boom'),
    );

    await ChoicesService.setChangesData(params);

    expect(localStorageCache.get(KEY)).toEqual(GOOD);
  });
});
