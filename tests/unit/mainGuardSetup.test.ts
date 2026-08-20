import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvConfig } from '../../src/shared/envConfig.ts';

/**
 * `src/main.ts` — `setupDefaultGuards()`'s `?allow_local_hosts` opt-out.
 *
 * `main.ts` is a bootstrap file: importing it runs its top-level IIFE
 * immediately (registers guards, evaluates them, then calls `SDK.init()` or
 * `WEB_EDITOR.init()`). There is no other entry point, so this is the first
 * test to import it at all — `SDK`/`WEB_EDITOR` are mocked to no-ops so the
 * bootstrap's side effects stay confined to guard registration, which is the
 * only thing this test cares about.
 *
 * The assertion surface is `window.__intemptGuardManager`, the seam `main.ts`
 * itself documents as existing "for inspection and tests" (see the comment
 * directly above where it's assigned).
 *
 * Why this guard's default matters: an ordinary website's `localhost` really
 * does mean "developer's machine" and should stay blocked, but a desktop
 * embedder (Tauri, Electron) reports a `localhost`-shaped hostname in its real,
 * shipped, production build — there is no other hostname available to it. The
 * opt-out has to default to *off* so it doesn't weaken tracking hygiene for
 * every other embedder, and it has to exist at all so that class of embedder
 * has anything usable.
 */

const CDN_LINK = 'https://cdn.example.com/v1/intempt.min.js';
const REQUIRED_QUERY =
  'project=proj-1&key=write-key-1&source=src-1&organization=acme';

function appendScript(query: string): void {
  const script = document.createElement('script');
  script.src = `${CDN_LINK}?${query}`;
  document.body.appendChild(script);
}

vi.mock('../../src/loaders/webEditorLoader.ts', () => ({
  WEB_EDITOR: { init: vi.fn() },
}));

async function importMainWithMockedSdkInit() {
  const sdkInit = vi.fn();
  vi.doMock('../../src/loaders/sdkLoader.ts', async (importOriginal) => {
    const actual =
      await importOriginal<typeof import('../../src/loaders/sdkLoader.ts')>();
    return { ...actual, SDK: { init: sdkInit } };
  });

  await import('../../src/main.ts');
  // The bootstrap IIFE's first `await` (shouldBlockTracking) resolves in a
  // microtask before guard registration is observable from here as "settled";
  // flushing microtasks once is enough since none of the guards or the mocked
  // SDK.init do any real async work.
  await Promise.resolve();
  await Promise.resolve();

  return { sdkInit };
}

function getGuardManager() {
  return (window as unknown as { __intemptGuardManager: any })
    .__intemptGuardManager;
}

describe('main.ts — block-localhost guard vs. ?allow_local_hosts', () => {
  beforeEach(() => {
    vi.resetModules();
    EnvConfig.initFromValues({ VITE_CDN_LINK: CDN_LINK });
    document.querySelectorAll('script').forEach((s) => s.remove());
    delete (window as any).__intemptGuardManager;
    delete (window as any).intempt;
  });

  afterEach(() => {
    document.querySelectorAll('script').forEach((s) => s.remove());
    delete (window as any).__intemptGuardManager;
    delete (window as any).intempt;
    vi.doUnmock('../../src/loaders/sdkLoader.ts');
  });

  it('registers block-localhost enabled by default, with no script-URL param', async () => {
    appendScript(REQUIRED_QUERY);
    await importMainWithMockedSdkInit();

    const guard = getGuardManager()
      .getGuards()
      .find((g: { id: string }) => g.id === 'block-localhost');
    expect(guard.enabled).toBe(true);
  });

  it('disables block-localhost when ?allow_local_hosts=true is present', async () => {
    appendScript(`${REQUIRED_QUERY}&allow_local_hosts=true`);
    await importMainWithMockedSdkInit();

    const guard = getGuardManager()
      .getGuards()
      .find((g: { id: string }) => g.id === 'block-localhost');
    expect(guard.enabled).toBe(false);
  });

  it('keeps block-localhost enabled for ?allow_local_hosts=false — no accidental opt-out', async () => {
    appendScript(`${REQUIRED_QUERY}&allow_local_hosts=false`);
    await importMainWithMockedSdkInit();

    const guard = getGuardManager()
      .getGuards()
      .find((g: { id: string }) => g.id === 'block-localhost');
    expect(guard.enabled).toBe(true);
  });

  it('does not block SDK.init() on localhost once the opt-out is set', async () => {
    appendScript(`${REQUIRED_QUERY}&allow_local_hosts=true`);
    // jsdom's default test origin is http://localhost:3000 — exactly the host
    // the guard exists to block, so this is the real end-to-end assertion:
    // with the opt-out set, bootstrap must actually reach SDK.init().
    const { sdkInit } = await importMainWithMockedSdkInit();

    expect(sdkInit).toHaveBeenCalledTimes(1);
  });

  it('still blocks SDK.init() on localhost with no opt-out', async () => {
    appendScript(REQUIRED_QUERY);
    const { sdkInit } = await importMainWithMockedSdkInit();

    expect(sdkInit).not.toHaveBeenCalled();
  });
});
