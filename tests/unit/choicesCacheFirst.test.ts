import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChoicesService } from '../../src/intemptJs/modules/choices/choices.service.ts';
import { ChoicesModule } from '../../src/intemptJs/modules/choices/choices.module.ts';
import { localStorageCache } from '../../src/shared/storageHandler.ts';

/**
 * INT-7451, Beso's ruling 2026-11-13: cache-first, no flicker. When choose-web misses the
 * 320 ms budget the page keeps the cached variant; a late reply carrying a DIFFERENT variant
 * only refreshes the cache and is served on the next load. Rejected: swapping the DOM to the
 * late variant mid-page-view (visible flicker).
 */

const PATH = '/pricing';
const KEY = `changes_${PATH}`;
const args = {
  changesRequest: {} as any,
  authRequest: { auth: { username: 'u', password: 'p' } } as any,
  orgName: 'acme',
  project: 'p',
  apiBaseUrl: 'https://api.example.com',
};
const variantA = { id: 'a', type: 'update', html: '<h1>A</h1>' };
const variantB = { id: 'b', type: 'update', html: '<h1>B</h1>' };

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', PATH);
  localStorageCache.set(KEY, { changes: [variantA] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

function lateFetch() {
  let respond!: (v: unknown) => void;
  vi.spyOn(ChoicesService, 'fetchChoices').mockImplementation(
    () => new Promise((r) => (respond = r)) as any,
  );
  return (v: unknown) => respond(v);
}

describe('INT-7451 cache-first on a choose-web timeout', () => {
  it('serves the cached variant now and the late variant on the next load', async () => {
    vi.useFakeTimers();
    const respond = lateFetch();

    const first = ChoicesService.getChoicesData({
      ...args,
      onLateFresh: () => {},
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(await first).toEqual([variantA]);

    respond({ choices: [{ choiceId: 2, changes: [variantB] }] });
    await vi.advanceTimersByTimeAsync(0);
    expect((localStorageCache.get(KEY) as any).changes).toEqual([variantB]);

    lateFetch();
    const next = ChoicesService.getChoicesData({
      ...args,
      onLateFresh: () => {},
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(await next).toEqual([variantB]);
  });

  it('does not apply a late reply with a different variant to the current page', async () => {
    vi.spyOn(ChoicesService, 'getChoices').mockImplementation((async (
      _cfg: unknown,
      onLateFresh?: (c: unknown[]) => void,
    ) => {
      setTimeout(() => onLateFresh?.([variantB]), 5);
      return [variantA];
    }) as any);
    const apply = vi
      .spyOn(ChoicesModule.prototype as any, '_applyChanges')
      .mockResolvedValue(undefined);

    await new ChoicesModule({} as any).init();
    await new Promise((r) => setTimeout(r, 20));

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith([variantA]);
  });
});
