import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

/**
 * INT-3957 — the INIT payload was spread wholesale into the editor mount
 * (`editorPayload = {...p}`), with only a truthiness check on three fields.
 * The loader now builds a clean object with exactly the six fields of the
 * web-editor's `EditorPayload` (organization, project, experience, variantId,
 * token, view), type-checks them, and hands the same object to `mod.mount` and
 * the `window.__INTEMPT_MOUNT` fallback.
 *
 * INT-3953 (residual) — the `openerOrigin` query param was never compared with
 * `event.origin`: any allow-listed origin could drive the editor. When the page
 * was opened with `openerOrigin`, the message must now come from exactly that
 * origin (on top of the allow-list).
 */

const OPENER = 'https://editor.example.com';
const OTHER_ALLOWED = 'https://other.example.com';
const FIXTURE_BASE = resolve(
  process.cwd(),
  'tests/unit/fixtures/webEditorGlobalMount',
);

type Handler = {
  handleMessageFromOpener: (event: MessageEvent) => unknown;
  injectWebEditorScript: (payload: unknown, root: HTMLElement) => unknown;
  injectCssIntoShadow: (url: string, shadow: ShadowRoot) => unknown;
};

const ESM_FIXTURE_BASE = resolve(
  process.cwd(),
  'tests/unit/fixtures/webEditorEsmMount',
);

async function loadEditor(
  search: string,
  base: string = FIXTURE_BASE,
): Promise<Handler> {
  window.history.replaceState({}, '', search);
  vi.resetModules();

  const { EnvConfig } = await import('../../src/shared/envConfig.ts');
  EnvConfig.reset();
  EnvConfig.initFromValues({
    VITE_OPENER_LINKS: `${OPENER},${OTHER_ALLOWED}`,
    VITE_WEB_EDITOR_BASE_LINK: base,
  });

  const { WEB_EDITOR } = await import('../../src/loaders/webEditorLoader.ts');
  return WEB_EDITOR as unknown as Handler;
}

const GOOD_PAYLOAD = {
  organization: 'acme',
  project: 'proj-1',
  experience: { id: 7 },
  variantId: 'var-1',
  token: 'tok-1',
  view: 'control',
};

function initMessage(payload: unknown, origin = OPENER, channel = 'nonce-1') {
  const postMessage = vi.fn();
  const event = new MessageEvent('message', {
    data: { type: 'INIT', channel, payload },
    origin,
  });
  Object.defineProperty(event, 'source', { value: { postMessage } });
  return { event, postMessage };
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
  delete (window as any).__INTEMPT_MOUNT;
  document.getElementById('intempt-root-host')?.remove();
  vi.restoreAllMocks();
});

describe('web editor — clean INIT payload (INT-3957)', () => {
  it('mounts with exactly the six EditorPayload fields, dropping extras', async () => {
    const editor = await loadEditor('/?channel=nonce-1');
    vi.spyOn(editor, 'injectCssIntoShadow').mockResolvedValue(undefined);
    const mount = vi.fn();
    (window as any).__INTEMPT_MOUNT = mount;

    const { event } = initMessage({
      ...GOOD_PAYLOAD,
      __proto_pollution: 'x',
      apiBaseUrl: 'https://attacker.example.com',
    });
    await editor.handleMessageFromOpener(event);

    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0][1]).toEqual(GOOD_PAYLOAD);
    expect(Object.keys(mount.mock.calls[0][1]).sort()).toEqual(
      Object.keys(GOOD_PAYLOAD).sort(),
    );
  });

  it('passes the same clean payload to an ESM `mount` export (INT-3706)', async () => {
    const editor = await loadEditor('/?channel=nonce-1', ESM_FIXTURE_BASE);
    vi.spyOn(editor, 'injectCssIntoShadow').mockResolvedValue(undefined);
    (window as any).__testEsmMountCalls = [];

    const { event } = initMessage({ ...GOOD_PAYLOAD, extra: 1 });
    await editor.handleMessageFromOpener(event);

    expect((window as any).__testEsmMountCalls).toEqual([GOOD_PAYLOAD]);
  });

  it.each([
    ['token is not a string', { ...GOOD_PAYLOAD, token: 123 }],
    ['variantId is not a string', { ...GOOD_PAYLOAD, variantId: ['v'] }],
    ['organization is not a string', { ...GOOD_PAYLOAD, organization: {} }],
    ['project is not a string', { ...GOOD_PAYLOAD, project: 1 }],
    ['view is not a string', { ...GOOD_PAYLOAD, view: { mode: 'control' } }],
    ['payload is not an object', 'just-a-string'],
  ])('rejects a bad shape: %s', async (_name, payload) => {
    const editor = await loadEditor('/?channel=nonce-1');
    const inject = vi
      .spyOn(editor, 'injectWebEditorScript')
      .mockResolvedValue(undefined);
    vi.spyOn(editor, 'injectCssIntoShadow').mockResolvedValue(undefined);

    const { event, postMessage } = initMessage(payload);
    await editor.handleMessageFromOpener(event);

    expect(inject).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'invalid_payload' }),
      OPENER,
    );
  });
});

describe('web editor — openerOrigin binding (INT-3953)', () => {
  it('rejects an allow-listed origin that is not the openerOrigin', async () => {
    const editor = await loadEditor(
      `/?channel=nonce-1&openerOrigin=${encodeURIComponent(OPENER)}`,
    );
    const inject = vi
      .spyOn(editor, 'injectWebEditorScript')
      .mockResolvedValue(undefined);

    const { event, postMessage } = initMessage(GOOD_PAYLOAD, OTHER_ALLOWED);
    await editor.handleMessageFromOpener(event);

    expect(postMessage).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
  });

  it('accepts the openerOrigin itself (trailing slash in the param ignored)', async () => {
    const editor = await loadEditor(
      `/?channel=nonce-1&openerOrigin=${encodeURIComponent(OPENER + '/')}`,
    );
    const inject = vi
      .spyOn(editor, 'injectWebEditorScript')
      .mockResolvedValue(undefined);
    vi.spyOn(editor, 'injectCssIntoShadow').mockResolvedValue(undefined);

    const { event } = initMessage(GOOD_PAYLOAD, OPENER);
    await editor.handleMessageFromOpener(event);

    expect(inject).toHaveBeenCalledTimes(1);
  });

  it('still applies the allow-list when openerOrigin names a non-allowed origin', async () => {
    const evil = 'https://attacker.example.com';
    const editor = await loadEditor(
      `/?channel=nonce-1&openerOrigin=${encodeURIComponent(evil)}`,
    );
    const inject = vi
      .spyOn(editor, 'injectWebEditorScript')
      .mockResolvedValue(undefined);

    const { event, postMessage } = initMessage(GOOD_PAYLOAD, evil);
    await editor.handleMessageFromOpener(event);

    expect(postMessage).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
  });
});
