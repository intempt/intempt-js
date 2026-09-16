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
