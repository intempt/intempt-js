import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChoicesService } from '../../src/intemptJs/modules/choices/choices.service.ts';
import { localStorageCache } from '../../src/shared/storageHandler.ts';

/**
 * INT-2483 — custom JS must not replay from the localStorage cache.
 *
 * `getChoicesData` applies whatever sits in `changes_<path>` when `choose-web`
 * is late (>320 ms) or fails. Any script on the host page can write that key, so
 * one XSS could plant a change with `js` that then runs on every later visit.
 * Custom JS now runs only when it came in this page load's fresh response;
 * cached changes are still applied, with `js` dropped.
 */

const PATH = '/product';
const KEY = `changes_${PATH}`;
const PLANTED = {
  changes: [
    { id: 'planted', type: 'insert', html: '<div></div>', js: 'steal()' },
    { id: 'plain', type: 'update', html: '<p>hi</p>' },
  ],
};

const args = {
  changesRequest: {} as any,
  authRequest: { auth: { username: 'u', password: 'p' } } as any,
  orgName: 'acme',
  project: 'p',
  apiBaseUrl: 'https://api.example.com',
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', PATH);
  localStorageCache.set(KEY, PLANTED);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('cached changes never run custom JS (INT-2483)', () => {
  it.each([
    ['HTTP failure', async () => null],
    [
      'network error',
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ],
    ['malformed 200 body', async () => ({ nope: true })],
  ])('%s → cached changes applied without js', async (_label, impl) => {
    vi.spyOn(ChoicesService, 'fetchChoices').mockImplementation(impl as any);

    const changes = (await ChoicesService.getChoicesData(args)) as any[];

    expect(changes.map((c) => c.id)).toEqual(['planted', 'plain']);
    expect(changes[0].js).toBeUndefined();
    expect(changes[0].html).toBe('<div></div>');
    expect(changes[1]).toEqual(PLANTED.changes[1]);
  });

  it('late response (timeout) → cached changes applied without js', async () => {
    vi.useFakeTimers();
    vi.spyOn(ChoicesService, 'fetchChoices').mockImplementation(
      () => new Promise(() => {}),
    );

    const pending = ChoicesService.getChoicesData(args);
    await vi.advanceTimersByTimeAsync(400);
    const changes = (await pending) as any[];

    expect(changes[0].id).toBe('planted');
    expect(changes[0].js).toBeUndefined();
  });

  it('does not rewrite the stored cache (only the returned copy is stripped)', async () => {
    vi.spyOn(ChoicesService, 'fetchChoices').mockResolvedValue(null as any);

    await ChoicesService.getChoicesData(args);

    expect((localStorageCache.get(KEY) as any).changes[0].js).toBe('steal()');
  });

  it('fresh response in time → its js is kept', async () => {
    vi.spyOn(ChoicesService, 'fetchChoices').mockResolvedValue({
      choices: [
        {
          changes: [
            { id: 'fresh', type: 'insert', html: '<i></i>', js: 'carousel()' },
          ],
        },
      ],
    } as any);

    const changes = (await ChoicesService.getChoicesData(args)) as any[];

    expect(changes).toHaveLength(1);
    expect(changes[0].id).toBe('fresh');
    expect(changes[0].js).toBe('carousel()');
  });

  it('fresh empty response → no changes (experience turned off)', async () => {
    vi.spyOn(ChoicesService, 'fetchChoices').mockResolvedValue({
      choices: [],
    } as any);

    expect(await ChoicesService.getChoicesData(args)).toEqual([]);
  });
});
