import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChoicesService } from '../../src/intemptJs/modules/choices/choices.service.ts';
import { ChoicesModule } from '../../src/intemptJs/modules/choices/choices.module.ts';
import { WebEditorModificationHandler } from '../../src/intemptJs/modules/choices/models/WebEditorModificationHandler.ts';
import { localStorageCache } from '../../src/shared/storageHandler.ts';

/**
 * Ro-bot impact:F1 on intempt-js#271: a choose-web response slower than 320 ms left the page
 * on cached changes with their `js` stripped (INT-2483), and the late response only refreshed
 * the cache, so on a consistently slow connection custom JS never ran. Ruling (Beso,
 * 2026-11-10, option 1): the late response's own `js` runs once it arrives, for changes that
 * match what was applied; nothing read from localStorage is ever executed.
 */

const PATH = '/product';
const KEY = `changes_${PATH}`;
const args = {
  changesRequest: {} as any,
  authRequest: { auth: { username: 'u', password: 'p' } } as any,
  orgName: 'acme',
  project: 'p',
  apiBaseUrl: 'https://api.example.com',
};
const serverInsert = {
  id: 'a',
  type: 'insert',
  html: '<div>x</div>',
  js: 'window.__ran = 1',
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', PATH);
  localStorageCache.set(KEY, { changes: [serverInsert] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('getChoicesData reports a late choose-web response', () => {
  it('calls onLateFresh with the server changes (js included) when the response arrives after the timeout', async () => {
    vi.useFakeTimers();
    let respond!: (v: unknown) => void;
    vi.spyOn(ChoicesService, 'fetchChoices').mockImplementation(
      () => new Promise((r) => (respond = r)) as any,
    );
    const onLateFresh = vi.fn();

    const pending = ChoicesService.getChoicesData({ ...args, onLateFresh });
    await vi.advanceTimersByTimeAsync(400);
    const applied = (await pending) as any[];
    expect(applied[0].js).toBeUndefined();
    expect(onLateFresh).not.toHaveBeenCalled();

    respond({ choices: [{ choiceId: 1, changes: [serverInsert] }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(onLateFresh).toHaveBeenCalledTimes(1);
    expect(
      (onLateFresh.mock.calls[0][0] as any[]).some(
        (c) => c.js === serverInsert.js,
      ),
    ).toBe(true);
  });

  it('does not call onLateFresh when the late response fails', async () => {
    vi.useFakeTimers();
    let respond!: (v: unknown) => void;
    vi.spyOn(ChoicesService, 'fetchChoices').mockImplementation(
      () => new Promise((r) => (respond = r)) as any,
    );
    const onLateFresh = vi.fn();

    const pending = ChoicesService.getChoicesData({ ...args, onLateFresh });
    await vi.advanceTimersByTimeAsync(400);
    await pending;
    respond(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(onLateFresh).not.toHaveBeenCalled();
  });

  it('does not call onLateFresh when the response was in time (its js already ran)', async () => {
    vi.spyOn(ChoicesService, 'fetchChoices').mockResolvedValue({
      choices: [{ choiceId: 1, changes: [serverInsert] }],
    } as any);
    const onLateFresh = vi.fn();
    await ChoicesService.getChoicesData({ ...args, onLateFresh });
    await new Promise((r) => setTimeout(r, 0));
    expect(onLateFresh).not.toHaveBeenCalled();
  });
});

describe('ChoicesModule runs confirmed js from the late response', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const cached = { ...serverInsert, js: undefined, parent: undefined };

  function stubGetChoices(late: unknown[]) {
    return vi.spyOn(ChoicesService, 'getChoices').mockImplementation((async (
      _cfg: unknown,
      onLateFresh?: (c: unknown[]) => void,
    ) => {
      setTimeout(() => onLateFresh?.(late), 5);
      return [cached];
    }) as any);
  }

  it('runs the js of a late change identical to the applied one, once', async () => {
    stubGetChoices([serverInsert]);
    const run = vi
      .spyOn(WebEditorModificationHandler.prototype, 'runCustomJs')
      .mockImplementation(() => {});
    await new ChoicesModule({} as any).init();
    await new Promise((r) => setTimeout(r, 20));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(serverInsert.js);
  });

  it('does not run js of a late change that differs from what was applied', async () => {
    stubGetChoices([{ ...serverInsert, html: '<div>other</div>' }]);
    const run = vi
      .spyOn(WebEditorModificationHandler.prototype, 'runCustomJs')
      .mockImplementation(() => {});
    await new ChoicesModule({} as any).init();
    await new Promise((r) => setTimeout(r, 20));
    await flush();
    expect(run).not.toHaveBeenCalled();
  });
});
