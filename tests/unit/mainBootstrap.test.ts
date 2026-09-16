import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-3767 — the web editor must load even where tracking is blocked.
 *
 * `src/main.ts` is the bundle's entry point: an IIFE that decides, once per page
 * load, whether this is a normal tracked page or a page the web editor opened
 * for authoring (`?openerOrigin=...&channel=...`). The order used to be
 *
 *     blocked = await shouldBlockTracking(...)   // localhost, crawler UA, ...
 *     if (blocked) return
 *     cameFromOpener ? WEB_EDITOR.init() : SDK.init()
 *
 * so the editor sat BEHIND the tracking guard. The editor is an authoring tool,
 * not tracking — and the single most likely place to open it is a dev or staging
 * site on `localhost`, which is exactly what `block-localhost` blocks. The editor
 * therefore failed to load on the machines it is used from. The opener branch is
 * now decided first and returns before the guard is consulted.
 *
 * The whole module is side effects at import time, so each case re-imports it
 * fresh under a different query string. The three collaborators are mocked
 * because what is under test is purely the ORDER of the two decisions.
 */

const mocks = vi.hoisted(() => ({
  webEditorInit: vi.fn(),
  sdkInit: vi.fn(),
  shouldBlockTracking: vi.fn(),
}));

vi.mock('../../src/loaders/webEditorLoader.ts', () => ({
  WEB_EDITOR: { init: mocks.webEditorInit },
}));

vi.mock('../../src/loaders/sdkLoader.ts', () => ({
  SDK: { init: mocks.sdkInit },
}));

vi.mock('../../src/guard/trackingGuard.checker.ts', () => ({
  shouldBlockTracking: mocks.shouldBlockTracking,
}));

/** Loads `main.ts` against a given page URL and lets its async IIFE finish. */
async function bootWith(search: string) {
  window.history.replaceState({}, '', search);
  vi.resetModules();
  await import('../../src/main.ts');
  // The IIFE awaits the guard, so its tail runs a microtask or two after import.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const OPENER_QUERY =
  '/?openerOrigin=https%3A%2F%2Feditor.example.com&channel=nonce-1';

beforeEach(() => {
  mocks.webEditorInit.mockClear();
  mocks.sdkInit.mockClear();
  mocks.shouldBlockTracking.mockReset();
  mocks.shouldBlockTracking.mockResolvedValue(false);
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('main.ts bootstrap order (INT-3767)', () => {
  it('starts the web editor without consulting the tracking guard', async () => {
    // THE MUTANT: move the opener branch back below the guard and
    // `shouldBlockTracking` is called — which is the defect, because on
    // localhost it answers "blocked" and the editor never mounts.
    mocks.shouldBlockTracking.mockResolvedValue(true);

    await bootWith(OPENER_QUERY);

    expect(mocks.webEditorInit).toHaveBeenCalledTimes(1);
    expect(mocks.shouldBlockTracking).not.toHaveBeenCalled();
    // Authoring is not tracking: the SDK stays out of the editor's page.
    expect(mocks.sdkInit).not.toHaveBeenCalled();
  });

  it('starts the web editor even when the guard would allow tracking', async () => {
    // The early return is unconditional on the guard's answer in BOTH
    // directions — an opener page never initialises the tracking SDK.
    await bootWith(OPENER_QUERY);

    expect(mocks.webEditorInit).toHaveBeenCalledTimes(1);
    expect(mocks.sdkInit).not.toHaveBeenCalled();
  });

  it('does not initialise the SDK on an ordinary page the guard blocks', async () => {
    mocks.shouldBlockTracking.mockResolvedValue(true);

    await bootWith('/');

    expect(mocks.sdkInit).not.toHaveBeenCalled();
    expect(mocks.webEditorInit).not.toHaveBeenCalled();
  });

  it('initialises the SDK on an ordinary page the guard allows', async () => {
    await bootWith('/');

    expect(mocks.shouldBlockTracking).toHaveBeenCalledTimes(1);
    expect(mocks.sdkInit).toHaveBeenCalledTimes(1);
    expect(mocks.webEditorInit).not.toHaveBeenCalled();
  });

  it('treats a half-specified opener query as an ordinary page', async () => {
    // `cameFromOpener` needs BOTH parameters. One alone is not an editor
    // handshake, so the guard still decides — this pins that the early return
    // did not widen into "any openerOrigin skips the guard".
    mocks.shouldBlockTracking.mockResolvedValue(true);

    await bootWith('/?openerOrigin=https%3A%2F%2Feditor.example.com');

    expect(mocks.webEditorInit).not.toHaveBeenCalled();
    expect(mocks.shouldBlockTracking).toHaveBeenCalledTimes(1);
    expect(mocks.sdkInit).not.toHaveBeenCalled();
  });
});
